# Social Media Downloader - Chrome Extension

Download videos and images from YouTube, TikTok, Twitter/X, Instagram, Facebook, and Threads.

## Requirements

- **Python 3** in PATH (`python --version` should work)
- **yt-dlp**: `pip install yt-dlp`
- **ffmpeg** (optional but recommended): needed to merge best-quality video+audio and to convert to true MP3. Without it, downloads fall back to the best progressive (with-audio) MP4 and audio is saved in its original format.

## Installation

### 1. Install yt-dlp
```bash
pip install yt-dlp
```

### 2. Load the Extension in Chrome
1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the folder `D:\Workspace\Savefrom`
5. **Copy the Extension ID** shown on the extension card (e.g., `abcdefghijklmnopqrstuvwxyz`)

### 3. Install the Native Messaging Host
No Administrator rights are needed (the host is registered under HKCU).

1. Open a normal PowerShell window
2. Navigate to the project folder:
   ```powershell
   cd D:\Workspace\Savefrom
   ```
3. Run the install script with your Extension ID:
   ```powershell
   .\native_host\install.ps1 -ExtensionId YOUR_EXTENSION_ID
   ```
   Example:
   ```powershell
   .\native_host\install.ps1 -ExtensionId abcdefghijklmnopqrstuvwxyz
   ```

The script detects Python, generates `native_host\yt_dlp_host.bat` (Chrome cannot pass arguments to a host on Windows, so the manifest points at this wrapper, which calls `python -u yt_dlp_host.py`), writes the real native messaging manifest with your extension ID, and registers it in `HKCU:\Software\Google\Chrome\NativeMessagingHosts`.

### 4. (Optional) Configure Cookies for Login-Gated Platforms
Some platforms (Threads, Instagram, Facebook) require login. Export cookies from your browser:

1. Install **EditThisCookie** extension in Chrome/Edge, or **Cookie Editor** in Firefox
2. Go to the platform's website (e.g., threads.com) and log in
3. Export cookies in **Netscape format** (`.txt` file)
4. Open the extension's **Options page** (right-click extension → "Options")
5. Paste the cookies into the textarea and click **Save**

### 5. Reload the Extension
1. Go back to `chrome://extensions/`
2. Click the **Reload** button on your extension
3. Done!

## Usage

1. Click the extension icon in Chrome
2. Paste a video/post URL
3. Click **Download** once to fetch the media info — the extension shows a preview plus the quality list
4. Pick a format (MP4 or MP3) and a quality
5. Click **Download Selected** — yt-dlp downloads the file to your `Downloads` folder (merging video+audio via ffmpeg when available)

## Supported Platforms

- YouTube
- TikTok
- Twitter / X
- Instagram
- Facebook
- Threads
- And 1000+ other sites supported by yt-dlp

## How It Works

1. You paste a URL into the extension popup
2. The extension sends the URL to a small Python host (`yt_dlp_host.py`) via Chrome's native messaging API
3. For **Fetch Info**, the host runs `yt-dlp --dump-json --no-playlist` and returns the title, thumbnail, and format list
4. For **Download**, the host runs yt-dlp again with the chosen `format_id`: `format_id+bestaudio` merged to MP4 when ffmpeg exists, otherwise the best progressive MP4; MP3 uses `-x --audio-format mp3` when ffmpeg exists. Cookies are written to a temporary Netscape file and passed via `--cookies`.

## Troubleshooting

### "Native host ..." / "disconnected without a reply"
- Run `.\native_host\install.ps1 -ExtensionId YOUR_EXTENSION_ID` (no admin needed)
- Make sure the Extension ID matches the one in `chrome://extensions/`
- Reload the extension after installing the native host

### "yt-dlp timed out"
- The video might be too long or the platform is slow
- Try again, or try a different video

### "No downloadable media found"
- The platform might require login - configure cookies (step 4 above)
- Try a public video/post
- Update yt-dlp: `pip install --upgrade yt-dlp`

### Video has no sound / MP3 isn't really MP3
- Install ffmpeg and make sure `ffmpeg` is in PATH, then try again
- Without ffmpeg the host can only grab progressive (with-audio) formats and cannot convert audio to MP3

### TikTok: "Unexpected response from webpage request"
- TikTok has aggressive anti-bot measures
- Workaround: export cookies from your browser (step 4) and try again

### Facebook videos don't work
- Facebook is the most difficult platform
- Make sure the video is public
- Update yt-dlp: `pip install --upgrade yt-dlp`
- If still failing, use `yt-dlp` directly in terminal with cookies

## Updating yt-dlp

yt-dlp needs to be updated regularly as platforms change their APIs:
```bash
pip install --upgrade yt-dlp
```

## Files

- `manifest.json` - Chrome extension manifest (MV3)
- `popup.html` + `popup.js` - Extension popup UI
- `background.js` - Background service worker (native messaging client)
- `extractors/` - HTML extractors (fallback, not used when native host is active)
- `native_host/` - yt-dlp native messaging host
  - `yt_dlp_host.py` - Python script that wraps yt-dlp
  - `yt_dlp_host.bat` - Launcher generated by install.ps1 (manifest points at it)
  - `install.ps1` - Windows installation script (no admin required)
  - `com.socialdownloader.ytdlp.json` - Native messaging manifest (placeholder; install.ps1 overwrites it with real paths)

## License

Personal use only. Not for redistribution.

## Save Tool (standalone Windows app)

No browser extension, Python or install needed. Download `savetool.exe` from the [latest release](../../releases/latest) and double-click it: your browser opens a small page where you paste links and click **Download**. Files go to `DownloadsSaveTool`.

Works with **Threads, YouTube, Instagram, Facebook, TikTok, X** and other sites yt-dlp supports. Pick video (MP4) or audio (MP3) and a quality cap, paste several links at once, watch progress, cancel, and open the file or folder from the page.

- Command line: `savetool.exe <link> [folder]`
- First use of a non-Threads link downloads yt-dlp (~18 MB) and ffmpeg (~115 MB) next to the exe, once.
- Stopped working? Click **Update** on the page (updates yt-dlp). For Threads, put the newer `core.mjs` from the release next to the exe.
- Private / age-restricted / login-only videos: export browser cookies as `cookies.txt` and put it next to the exe.
- The page only listens on `127.0.0.1` and every request needs a per-run token, so other websites cannot drive it.

### Project layout

- `app/` — Save Tool. `app/src/`: `app.mjs` (entry), `server.mjs` + `ui.html` (web UI), `jobs.mjs` (download jobs), `tools.mjs` (yt-dlp/ffmpeg setup), `core.mjs` (Threads extractor, the file to fix when Threads changes). Build: `node app/build.mjs` (Node 24+) gives `app/dist/savetool.exe`.
- Repo root — the Chrome extension (below). It stays at the root because Chrome loads this folder and the native host is registered to it.
