# DDAS Browser Extension

Intercepts dataset download links on any page and checks them against the DDAS registry
*before* the download happens — no manual upload step, no visiting the DDAS web app.

## How it works

The extension intercepts dataset downloads via two complementary layers:

1. **Direct Link Click Interception (`content.js`):**
   - Intercepts clicks on dataset links (`.csv`, `.json`, `.pdf`, `.xls`, `.xlsx`, `.tsv`, `.parquet`).
   - Cancels immediate navigation, computes fingerprint, and checks the registry before initiating the download.

2. **Global Browser Download Interception (`chrome.downloads.onDeterminingFilename` in `background.js`):**
   - Catches **all** downloads in the browser, including **WhatsApp Web**, **Blob URLs (`blob:`)**, **Google Drive**, **email attachments**, and JavaScript-initiated downloads (`URL.createObjectURL`).
   - Computes SHA-256 and structural fingerprints (using background worker or tab context for memory-isolated blobs).
   - If a duplicate or similar dataset exists, renders an in-page Shadow DOM modal with duplicate metadata, match breakdown, and options to **"Use existing dataset"** (cancels download) or **"Continue anyway"** (resumes download).
   - If no tab context is present, falls back gracefully to Chrome desktop notifications.

## Install (unpacked, for development/demo)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** (or click the reload icon if already loaded), select this `extension/` folder
4. Click the DDAS icon in your toolbar → sign in with your DDAS credentials
5. By default it points at `http://localhost:4000` (or `http://localhost:5173` via proxy) — change this in the extension's options page if your backend runs elsewhere

## Try it

1. Ensure the DDAS backend and frontend are running (`npm start` in `backend/` and `npm run dev` in `frontend/` or `docker compose up`).
2. Log into the extension popup.
3. Download any dataset file (.csv, .json, .pdf, etc.) from **WhatsApp Web**, Google Drive, or standard web links.
4. If the file or similar content exists in DDAS, the duplicate warning modal will appear immediately with confidence score and similarity breakdown!
