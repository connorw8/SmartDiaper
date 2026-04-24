import React, { useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  PanResponder,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { Stack } from "expo-router";
import { Buffer } from "buffer";
import { PNG } from "pngjs/browser"; // Use a browser-compatible version for RN
import { phTable } from "../data/phTable"; // Import the pH reference table from a separate file
import * as ImagePicker from "expo-image-picker";

const { width: WINDOW_WIDTH, height: WINDOW_HEIGHT } = Dimensions.get("window");
const VIEWFINDER_SIZE = 240;
const SLIDER_HEIGHT = 350;

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [previewUri, setPreviewUri] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [zoom, setZoom] = useState(0);
  const [qualitative, setQualitative] = useState(null);

  // Calibration: Moves the crop box UP cause it is misaligned
  const Y_CROP_OFFSET = -100;

  // --- CUSTOM SLIDER LOGIC ---
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt, gestureState) => {
        // Calculate touch position relative to the track's location on screen
        const trackTop = WINDOW_HEIGHT / 2 - SLIDER_HEIGHT / 2;
        const touchPos = gestureState.moveY - trackTop;

        // Convert to a percentage (inverted so top is 1, bottom is 0)
        const percent = 1 - touchPos / SLIDER_HEIGHT;

        // Constrain between 0 and 1
        const constrained = Math.min(Math.max(percent, 0), 1);
        setZoom(constrained);
      },
    }),
  ).current;
  //upload image button logic for testing without camera
  const pickImage = async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        alert("Permission required to access photos.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });

      if (!result.canceled) {
        setPreviewUri(result.assets[0].uri);
      }
    } catch (e) {
      alert("Image selection failed: " + e.message);
    }
  };
  // --- COLOR LOGIC ---
  const rgbToHsl = (r, g, b) => {
    const rNorm = r / 255,
      gNorm = g / 255,
      bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm),
      min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;
    let h = 0,
      s = 0,
      l = (max + min) / 2;

    if (delta !== 0) {
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      switch (max) {
        case rNorm:
          h = (gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0);
          break;
        case gNorm:
          h = (bNorm - rNorm) / delta + 2;
          break;
        case bNorm:
          h = (rNorm - gNorm) / delta + 4;
          break;
      }
      h = Math.round(h * 60);
    }
    return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
  };

  const getHueDistance = (h1, h2) => {
    const diff = Math.abs(h1 - h2) % 360;
    return diff > 180 ? 360 - diff : diff;
  };

  const extractGridHSL = (base64) => {
    if (!base64) return [];
    try {
      const compressedBuffer = Buffer.from(base64, "base64");
      const png = PNG.sync.read(compressedBuffer);
      const rgbaData = png.data;
      const gridData = [];
      const imgSize = 400,
        cellSize = 100,
        padding = 40;

      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          let rSum = 0,
            gSum = 0,
            bSum = 0,
            count = 0;
          for (
            let y = row * cellSize + padding;
            y < (row + 1) * cellSize - padding;
            y++
          ) {
            for (
              let x = col * cellSize + padding;
              x < (col + 1) * cellSize - padding;
              x++
            ) {
              const index = (y * imgSize + x) * 4;
              if (index + 2 < rgbaData.length) {
                rSum += rgbaData[index];
                gSum += rgbaData[index + 1];
                bSum += rgbaData[index + 2];
                count++;
              }
            }
          }
          if (count > 0) {
            const hsl = rgbToHsl(rSum / count, gSum / count, bSum / count);
            // DEBUG: Log raw extraction results
            console.log(
              `[Raw Extract] Square R${row}C${col}: H:${hsl.h} S:${hsl.s}% L:${hsl.l}%`,
            );
            gridData.push({ id: row * 4 + col, row, col, ...hsl });
          }
        }
      }
      return gridData;
    } catch (e) {
      console.error("Extraction error:", e);
      return [];
    }
  };

  const getPatternMatches = (allSquares) => {
    const finalMatches = [];

    // CONFIGURATION
    const HUE_THRESHOLD = 25;
    //const MAX_LIGHTNESS = 80;
    const MIN_SATURATION = 13;
    const UNTOUCHED_PENALTY = 8;

    console.log(`--- Analysis Started (Threshold: ${MIN_SATURATION}%) ---`);

    for (let colIdx = 0; colIdx < 4; colIdx++) {
      const scannedColumn = allSquares
        .filter((s) => s.col === colIdx)
        .sort((a, b) => a.row - b.row);

      if (scannedColumn.length !== 4) continue;

      // PREPARE LOG DATA: Get all 4 saturation values for this column first
      const sValues = scannedColumn.map((p) => `${p.s}%`).join(", ");

      let best = {
        label: "No Match",
        score: Infinity,
        value: null,
        activeCount: 0,
      };

      phTable.forEach((ref) => {
        let totalErr = 0;
        let activePadsInCol = 0;

        for (let i = 0; i < 4; i++) {
          const pad = scannedColumn[i];

          // LOGIC: Check if the pad meets the saturation requirement
          if (pad.s >= MIN_SATURATION) {
            const err = getHueDistance(pad.h, ref.referenceSquares[i].h);
            totalErr += err;
            activePadsInCol++;
          }
        }

        if (activePadsInCol > 0) {
          let avgErr = totalErr / activePadsInCol;
          const reliabilityPenalty = (4 - activePadsInCol) * UNTOUCHED_PENALTY;
          const finalScore = avgErr + reliabilityPenalty;

          if (finalScore < best.score) {
            best = {
              label: ref.label,
              score: finalScore,
              value: ref.value,
              activeCount: activePadsInCol,
            };
          }
        }
      });

      // SINGLE LOG PER COLUMN: Shows you everything in one line
      const statusLabel =
        best.score < HUE_THRESHOLD ? `${best.label}` : "No Match";
      console.log(
        `Col ${colIdx} | L-Values: [${sValues}] | Active: ${best.activeCount}/4 | Result: ${statusLabel} (Score: ${best.score.toFixed(1)})`,
      );

      finalMatches.push({
        column: colIdx,
        score: best.score,
        match:
          best.score < HUE_THRESHOLD
            ? best
            : { label: "No Match", value: null },
      });
    }

    console.log("--- Analysis Complete ---");
    return finalMatches;
  };

  const processImage = async (uri) => {
    setIsProcessing(true);
    try {
      const photo = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 400, height: 400 } }],
        { base64: true, format: ImageManipulator.SaveFormat.PNG },
      );
      const allSquares = extractGridHSL(photo.base64);
      const columnMatches = getPatternMatches(allSquares);
      const validMatches = columnMatches
        .filter((m) => m.match && m.match.value !== null)
        .map((m) => m.match.value);

      let finalPH = "No Match";
      let bestOverallScore = Infinity;

      columnMatches.forEach((m) => {
        // IMPORTANT: We must check m.match.score because that's where the value lives
        if (m.match && m.match.value !== null) {
          if (m.match.score < bestOverallScore) {
            bestOverallScore = m.match.score;
            finalPH = m.match.value.toFixed(1);
          }
        }
      });

      console.log(
        `Winner: pH ${finalPH} with a score of ${bestOverallScore.toFixed(2)}`,
      );

      // Set the result - including the score helps for debugging!
      setAnalysisResult({
        ph: finalPH,
        grid: allSquares,
        score:
          bestOverallScore === Infinity ? null : bestOverallScore.toFixed(2),
      });
      if (finalPH != "No Match") {
        if (finalPH < 5) {
          setQualitative("Low pH");
        } else if (finalPH > 8) {
          setQualitative("High pH");
        } else {
          setQualitative("Normal range");
        }
      }
    } catch (e) {
      alert("Analysis failed: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const RenderAlignmentDots = () => {
    const dots = [];
    const step = VIEWFINDER_SIZE / 4;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        dots.push(
          <View
            key={`${row}-${col}`}
            style={[
              styles.dot,
              {
                top: row * step + step / 2 - 4,
                left: col * step + step / 2 - 4,
              },
            ]}
          />,
        );
      }
    }
    return dots;
  };

  if (!permission?.granted) {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={requestPermission}
        >
          <Text style={styles.btnText}>Enable Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* --- CAMERA SCANNING VIEW --- */}
      {!previewUri && !analysisResult && (
        <>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            ref={cameraRef}
            zoom={zoom}
          />
          <View style={styles.overlay} pointerEvents="box-none">
            {/* Diagnostic Status Bar */}
            <View
              style={{ position: "absolute", top: 60, alignItems: "center" }}
            >
              <View
                style={{
                  backgroundColor: "rgba(0,0,0,0.6)",
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                }}
              >
                <Text
                  style={{
                    color: "#FFF",
                    fontSize: 12,
                    fontWeight: "700",
                    letterSpacing: 1,
                  }}
                >
                  SMART DIAPER: SENSOR ANALYSIS
                </Text>
              </View>
            </View>

            {/* Viewfinder */}
            <View style={styles.viewfinder}>
              <RenderAlignmentDots />
            </View>

            <View style={{ alignItems: "center", marginTop: 24 }}>
              <Text style={styles.hintText}>
                Position 4x4 Array within the Frame
              </Text>
              <Text style={styles.hintText2}>
                Avoid glare and colored lighting; Shadows are okay.
              </Text>
            </View>

            {/* Zoom Slider */}
            <View
              style={styles.sideSliderContainer}
              {...panResponder.panHandlers}
            >
              <View style={styles.sliderTrack}>
                <View
                  style={[styles.sliderFill, { height: `${zoom * 100}%` }]}
                />
                <View
                  style={[
                    styles.sliderHandle,
                    {
                      bottom: `${zoom * 100}%`,
                      transform: [{ translateY: 12 }],
                    },
                  ]}
                />
              </View>
              <Text style={styles.zoomValText}>{Math.round(zoom * 100)}%</Text>
            </View>
            <TouchableOpacity
              style={{
                position: "absolute",
                bottom: 20,
                right: 20,
                backgroundColor: "#3b83f687",
                paddingHorizontal: 12,
                paddingVertical: 12,
                borderRadius: 10,
              }}
              onPress={pickImage}
            >
              <Text style={{ color: "#FFF", fontWeight: "600" }}>Upload</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.captureBtn}
              activeOpacity={0.8}
              onPress={async () => {
                const photo = await cameraRef.current.takePictureAsync();
                const cropped = await ImageManipulator.manipulateAsync(
                  photo.uri,
                  [
                    {
                      crop: {
                        originX: (photo.width - 600) / 2,
                        originY: (photo.height - 600) / 2 + Y_CROP_OFFSET,
                        width: 600,
                        height: 600,
                      },
                    },
                  ],
                );
                setPreviewUri(cropped.uri);
              }}
            >
              <View style={styles.innerBtn} />
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* --- PREVIEW / CONFIRMATION VIEW --- */}
      {previewUri && !analysisResult && (
        <View style={styles.previewContainer}>
          <Text
            style={[styles.resultHeader, { color: "#FFF", marginBottom: 20 }]}
          >
            Verify Alignment
          </Text>
          <Image source={{ uri: previewUri }} style={styles.previewImage} />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.retakeBtn]}
              onPress={() => setPreviewUri(null)}
            >
              <Text style={styles.btnText}>RETAKE</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.confirmBtn]}
              onPress={() => processImage(previewUri)}
            >
              {isProcessing ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.btnText}>CONFIRM SCAN</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* --- CLINICAL ANALYSIS REPORT --- */}
      {analysisResult && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "#F8FAFC" }]}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text style={styles.resultHeader}>Diagnostic Report</Text>
            <View style={{ alignItems: "center", marginBottom: 30 }}>
              <Text style={styles.phValue}>{analysisResult.ph}</Text>
              <Text style={styles.resultHeader}>{qualitative}</Text>
              {/* <Text style={{ color: "#64748B", fontWeight: "600" }}>
                Estimated pH Level
              </Text> */}
            </View>

            {/* Visual Reference Scale */}
            <View
              style={{ width: "100%", paddingHorizontal: 10, marginBottom: 40 }}
            >
              <View
                style={{
                  height: 8,
                  backgroundColor: "#E2E8F0",
                  borderRadius: 4,
                  width: "100%",
                  flexDirection: "row",
                  overflow: "hidden",
                }}
              >
                <View style={{ flex: 1, backgroundColor: "#FF4D4D" }} />
                <View style={{ flex: 1, backgroundColor: "#FFD700" }} />
                <View style={{ flex: 1, backgroundColor: "#4CAF50" }} />
                <View style={{ flex: 1, backgroundColor: "#2196F3" }} />
                <View style={{ flex: 1, backgroundColor: "#4B0082" }} />
              </View>
              <View
                style={{
                  position: "absolute",
                  top: -6,
                  left: `${(parseFloat(analysisResult.ph) / 14) * 100}%`,
                  alignItems: "center",
                }}
              >
                <View
                  style={{ width: 2, height: 20, backgroundColor: "#1E293B" }}
                />
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: "#1E293B",
                    marginTop: -5,
                  }}
                />
              </View>
            </View>

            <Text
              style={[
                styles.resultHeader,
                { alignSelf: "flex-start", marginBottom: 10 },
              ]}
            >
              Digital Sensor Readings
            </Text>
            <View style={styles.debugGrid}>
              {analysisResult.grid.map((sq) => (
                <View key={sq.id} style={styles.debugSquare}>
                  <View
                    style={[
                      styles.colorChip,
                      { backgroundColor: `hsl(${sq.h}, ${sq.s}%, ${sq.l}%)` },
                    ]}
                  />
                  <Text style={styles.chipText}>{sq.h}°</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => {
                setPreviewUri(null);
                setAnalysisResult(null);
              }}
            >
              <Text style={styles.secondaryBtnText}>DISMISS REPORT</Text>
            </TouchableOpacity>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: 10,
                marginTop: 20,
                textAlign: "center",
              }}
            >
              Report results are an estimate and can be innacurate.{"\n"}
            </Text>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Main Containers
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  previewContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1E293B", // Darker contrast for image review
  },
  previewImage: {
    width: WINDOW_WIDTH * 0.85,
    height: WINDOW_WIDTH * 0.85,
    borderRadius: 16,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },

  // Viewfinder Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    borderWidth: 2,
    borderColor: "#3B82F6",
    borderRadius: 8,
    backgroundColor: "rgba(59, 130, 246, 0.03)",
  },
  dot: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#3B82F6",
  },

  // Vertical Zoom Slider
  sideSliderContainer: {
    position: "absolute",
    right: 20,
    height: SLIDER_HEIGHT,
    width: 32,
    alignItems: "center",
  },
  sliderTrack: {
    width: 2,
    height: SLIDER_HEIGHT,
    backgroundColor: "rgba(255,255,255,0.3)",
    justifyContent: "flex-end",
  },
  sliderFill: {
    width: 2,
    backgroundColor: "#3B82F6",
  },
  sliderHandle: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    left: -11,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    elevation: 3,
  },
  zoomValText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 15,
  },

  // Capture Interface
  hintText: {
    color: "#fff",
    marginTop: 25,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 40,
  },
  hintText2: {
    color: "rgba(255,255,255,0.7)",
    marginTop: 5,
    fontSize: 12,
  },
  captureBtn: {
    position: "absolute",
    bottom: 50,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  innerBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FFFFFF",
  },

  // Results Screen (Clinical Report Style)
  scrollContent: {
    paddingTop: 60,
    paddingHorizontal: 20,
    alignItems: "center",
    paddingBottom: 40,
    backgroundColor: "#F8FAFC",
  },
  resultHeader: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 1.5,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  phValue: {
    fontSize: 84,
    fontWeight: "300", // Light weight is more elegant/medical
    color: "#1E293B",
    marginBottom: 10,
  },
  debugGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#FFFFFF",
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  debugSquare: {
    width: "25%",
    aspectRatio: 1,
    padding: 6,
  },
  colorChip: {
    flex: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  chipText: {
    fontSize: 10,
    textAlign: "center",
    marginTop: 6,
    color: "#94A3B8",
    fontFamily: "monospace",
  },

  // Action Buttons
  buttonRow: { flexDirection: "row", marginTop: 40, gap: 12, width: "90%" },
  actionBtn: {
    flex: 1,
    height: 52,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  retakeBtn: { backgroundColor: "#64748B" },
  confirmBtn: { backgroundColor: "#3B82F6" },
  doneBtn: {
    backgroundColor: "#FFFFFF",
    height: 56,
    borderRadius: 10,
    width: "100%",
    marginTop: 20,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  secondaryBtnText: { color: "#475569", fontWeight: "600", fontSize: 15 },
});
