# VoiceGuard ID: Biometric Call Verification System

VoiceGuard ID is a premium, client-side web application that registers vocal signatures (voiceprints) and verifies speaker identity in real-time during simulated incoming calls.

The application leverages the **Web Audio API** for real-time feature extraction and **IndexedDB** for secure local storage of voice prints and audio call recordings.

---

## ✨ Features

- **Biometric Calibration**: Captures vocal frequency distributions, pitch variations, and spectral centroids to create a unique 3D "voiceprint" vector.
- **Biometric Call Security**: Simulates incoming calls with cadence ringing, real-time waveform visualizers (oscilloscope & circular frequency radar), and instant verification checking.
- **Visual Analytics**: Interactive overlay chart comparison mapping the caller's live spectral energy bands against the registered signature.
- **Audio Call Logger**: Automatically logs verified and unauthorized calls with name, match score, duration, date/time, and an inline custom audio player to playback saved call recordings.
- **Cyberpunk Dark Theme**: A glassmorphic dashboard styled with responsive layouts, neon highlights, and custom progress gauges.

---

## 🛠️ Biometric Voice Verification Logic

1. **Fundamental Pitch (F0)**: Extracted using a time-domain Autocorrelation algorithm focusing on vocal range boundaries (50Hz - 400Hz).
2. **Spectral Centroid**: Computes the frequency center-of-mass, representing the brightness or tone of the speaker's vocal cords.
3. **Log-Spaced Energy Bands**: Groups the linear frequency spectrum bins into 16 logarithmically spaced frequency bands representing the speaker's vocal tract resonance (timbre).
4. **Cosine Similarity Matching**: Compares the 16-band vector using cosine similarity (dot product of normalized unit vectors) and applies weight factors for pitch delta and spectral centroid alignment.
   - If the resulting match score is **&ge; 78%**, the speaker's identity is verified.
   - Otherwise, the call flags a **Verification Failure** (Unauthorized Impostor).

---

## 🚀 How to Run Locally

Because the Web Audio API requires a secure origin (`localhost` or `https`) to access the microphone, the files must be served over HTTP:

### Option A: Using Python
Open your terminal in the project directory and run:
```bash
python -m http.server 8000
```
Then visit **[http://localhost:8000](http://localhost:8000)** in your browser.

### Option B: Using Node.js
If you have Node.js installed, run:
```bash
npx http-server -p 8000
```
Then visit **[http://localhost:8000](http://localhost:8000)** in your browser.

### Option C: Using PowerShell (Native Windows)
If you don't have Python or Node installed, you can use the native PowerShell server script provided in the repository:
```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```
Then visit **[http://localhost:8000](http://localhost:8000)** in your browser.

---

## 📂 Project Structure

- `index.html` - The application dashboard structure.
- `styles.css` - Custom styling rules and neon visual assets.
- `audio-processor.js` - Web Audio analyzer & feature comparison logic.
- `app.js` - Database, UI events, Canvas drawing, and recorder orchestration.
- `server.ps1` - Native PowerShell HTTP server script.
