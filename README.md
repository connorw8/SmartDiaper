# Smart Diaper: pH Sensor Analysis

A React Native (Expo) mobile application that uses computer vision and color analysis to estimate pH levels from a 4×4 chemical sensor array.

## Overview

The Smart Diaper Sensor Analysis App allows users to scan a 4×4 colorimetric sensor grid using their phone camera and quickly determine an estimated pH value.

### How it works

1. The user aligns a 4×4 sensor array inside a guided viewfinder.
2. The app captures and crops the image.
3. Each square is analyzed using RGB → HSL color conversion.
4. Hue values are compared against a reference pH table.
5. A best-match algorithm estimates the pH level.
6. The result is displayed as a diagnostic-style report.

The entire analysis runs **on-device** and does not require an internet connection or backend server.

## 🛠 Tech Stack

- React Native (Expo)
- expo-camera — camera access
- expo-image-manipulator — image cropping and resizing
- pngjs/browser — pixel data extraction
- buffer — base64 decoding
- expo-router — navigation

---

## 📦 Installation

### 0. Download Node.js and git

Visit the following website and download:

- nodejs: https://nodejs.org/en
- git: https://git-scm.com/install/windows

### 1. Clone the Repository

```bash
git clone https://github.com/connorw8/SmartDiaper
cd .\SmartDiaper\
```

### 2. Install Dependencies

```bash
npm install
```

If you run into dependency issues:

```bash
npm install --legacy-peer-deps
```

### 3. Install Expo CLI (if not installed)

```bash
npm install -g expo
```

---

## Running the App

Start the development server:

```bash
npx expo start
```

This will open the Expo developer tools in your browser.

---

## Running on Expo Go

### Option 1: Phone (Recommended)

1. Download **Expo Go** from the App Store or Google Play.
2. Run the project:

```bash
npx expo start
```

3. Scan the QR code:
   - iPhone → Use the Camera app
   - Android → Use the Expo Go app

The app should open automatically on your phone.

---

### Option 2: Emulator

#### iOS (Mac only):

```bash
npx expo start --ios
```

#### Android:

```bash
npx expo start --android
```

---

## How to Use the App

1. Open the app in Expo Go.
2. Allow camera permissions.
3. Align the 4×4 sensor grid inside the square viewfinder.
4. Adjust zoom using the vertical slider if needed.
5. Tap the capture button.
6. Confirm the image alignment.
7. View the diagnostic report screen with the estimated pH value.

---

## Important Configuration Notes

### Crop Calibration

Inside the code:

```js
const Y_CROP_OFFSET = -100;
```

Adjust this value if the capture area is vertically misaligned with the grid.

---

### Image Processing Details

- Captured image is resized to **400 × 400 pixels**
- Each square in the 4×4 grid is sampled
- Padding is applied to avoid sampling edges
- Average RGB values are converted to HSL
- Hue values are compared to reference values

---

## pH Classification Logic

| pH Value | Classification |
| -------- | -------------- |
| < 5      | Low pH         |
| 5 – 8    | Normal Range   |
| > 8      | High pH        |

---

## Debugging

The app logs the following during analysis:

- Raw HSL values for each square
- Saturation values
- Column match scores
- Final pH decision and score

To view logs:

```bash
npx expo start
```

Then check the terminal or browser console.

---

## ⚠️ Limitations

- Poor Lighting conditions can affect accuracy
- Strong colored lighting may distort results
- Glare should be avoided
- Shadows are okay
- Results are estimates and not medical-grade measurements

---

## Troubleshooting

### Camera not working

- Make sure camera permissions are enabled
- Restart Expo Go
- Restart the Expo server

### App won’t start

```bash
rm -rf node_modules
npm install
npx expo start -c
```

### Clear Expo cache

```bash
npx expo start --clear
```

---

## 📁 Project Structure

```
- some folders may be missing from this list -

project-root/
│
├── app/
│   └── index.js
│
├── assets/
│
├── node_modules/
│
├── package.json
├── package-lock.json
└── README.md
```

---

## Future Improvements

- Automatic grid detection (remove manual alignment)
- Lighting normalization / white balance correction
- Machine learning color classification
- Save scan history
- Cloud database integration
- Multiple scan averaging for higher accuracy

## Summary

This app demonstrates how a smartphone camera and color analysis can be used to estimate chemical properties (pH) from a colorimetric sensor array.
