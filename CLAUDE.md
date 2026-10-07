# Savefrom – project notes (for Claude)

Two independent products in one repo. User-facing docs are in `README.md`; this file is the quick map so the code doesn't need re-reading.

## 1. Save Tool (`app/`) – the main, active product
Standalone Windows exe (`savetool.exe`): local web UI to download videos/audio from Threads, YouTube, Instagram, Facebook, TikTok, X, etc. Plain ESM JS, no dependencies, Node 24+.

| File | Role |
|---|---|
| `app/src/app.mjs` | Entry. Modes: no args = start UI + open browser; `<link> [folder]` = CLI download; `update` = `yt-dlp -U`. `exeDir` = folder of the exe (tools + cookies.txt + optional `core.mjs` live there). Default out dir `~/Downloads/SaveTool`. If port busy (EADDRINUSE) it just opens the already-running page. |
| `app/src/server.mjs` | HTTP server on `127.0.0.1:47821`. Checks Host header; `/` serves `ui.html` with `__TOKEN__` replaced; all `/api/*` need `x-token` header. Routes: `GET /api/state`, `/api/jobs`, `/api/jobs/:id/(cancel\|remove\|open)`, `/api/folder`, `/api/update`. Exits when the page stops pinging (`onIdleExit`). |
| `app/src/ui.html` | Single-file UI (imported as text by esbuild). |
| `app/src/jobs.mjs` | Job manager, one job per link. Threads URLs -> `runThreads` (core.mjs, direct fetch). Everything else -> `runYtdlp` (spawns yt-dlp, parses progress, ffmpeg merge/MP3). `FORMATS` = quality caps best/1080/720/480. Job options: `cookies` (auto = cookies.txt if present / none / chrome|edge|firefox|brave via `--cookies-from-browser`), `playlist` (`--yes-playlist`, output in a folder named after the playlist, progress across items). yt-dlp is told to print `TITLE`/`ITEM`/`FILE`/`PROG` lines that `runOnce` parses. |
| `app/src/tools.mjs` | `update()` (shared `yt-dlp -U`, stamp file `yt-dlp.updated`; auto-run daily at UI start, and once as retry when a job fails), `pending()`. Lazily downloads `yt-dlp.exe`, ffmpeg (gyan.dev zip) and, for YouTube links only, `deno.exe` (JS runtime yt-dlp needs; passed via `--js-runtimes deno:<path>`) next to the exe on first use; `spawnYtdlp`, `ensureYtdlp`, `ensureFfmpeg`. |
| `app/src/core.mjs` | Threads extractor (`getThreadsMedia`, `parseThreadsUrl`, `fetchRetry`, `VERSION`). **The file to fix when Threads changes its page.** A newer `core.mjs` next to the exe overrides the built-in one (no rebuild). Bump `VERSION` on change. |
| `app/build.mjs` | `node app/build.mjs` -> esbuild bundle -> Node SEA blob -> postject into a copy of node.exe -> `app/dist/savetool.exe` (+ `core.mjs`, `README.txt` from `app/RELEASE.txt`). Uses `npx` (needs network). |
| `app/RELEASE.txt` | End-user readme shipped inside the release zip. |

Dev run without building: `SAVETOOL_NO_OPEN=1 node app/src/app.mjs` (note: `./ui.html` import needs the esbuild text loader, so plain `node` won't resolve it – build, or use `npx esbuild ... --loader:.html=text`).
Releases are published on GitHub releases (exe built from `app/dist/`, which is gitignored).

## 2. Chrome extension (repo root) – older, legacy
MV3 extension "Social Media Downloader". Must stay at the repo root (Chrome loads this folder; native host is registered to this path).
- `popup.html/js` UI, `background.js` service worker talks to native host `com.socialdownloader.ytdlp` via `chrome.runtime.connectNative` (fresh port per request, 65s timeout), `utils.js`, `options.html/js` (cookie paste), `extractors/*.js` = fallback HTML extractors (unused when native host active).
- `native_host/yt_dlp_host.py` wraps yt-dlp (actions `extract` / `download`; cookies -> temp Netscape file). `native_host/install.ps1 -ExtensionId <id>` generates `yt_dlp_host.bat` + manifest and registers under HKCU. The generated `.bat` and `com.socialdownloader.ytdlp.json` are gitignored (per machine).

## Conventions / gotchas
- Windows machine; shell is PowerShell/Git Bash. Paths: `D:\Workspace\Savefrom`.
- 4-space indent in `app/src`, double quotes, ESM `.mjs`. Keep it dependency-free.
- Security: server must stay bound to localhost with token + Host check (other websites can reach localhost).
- Don't commit `app/dist/`, `node_modules/`, `*.mp4`, `out*/`.
- Commit style: short imperative message ("Save Tool: ..."). Main branch is `main`.
