// yt-dlp + ffmpeg: downloaded next to the exe on first use.
import { writeFile, rename, rm } from "node:fs/promises";
import { existsSync, createWriteStream, statSync, readdirSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

export function makeTools(exeDir) {
    const YTDLP = join(exeDir, "yt-dlp.exe");
    const FFMPEG = join(exeDir, "ffmpeg.exe");
    const DENO = join(exeDir, "deno.exe"); // JS runtime yt-dlp needs for YouTube
    const DENO_URL = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";
    const STAMP = join(exeDir, "yt-dlp.updated"); // mtime = last update check
    const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    // gyan.dev first, GitHub (BtbN) as a mirror: one host being down must not break first run
    const FFMPEG_URLS = [
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
        "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip",
    ];

    // note(text) reports a status line; progress(0..100) reports download progress
    // concurrent jobs share one in-flight setup instead of writing the same file twice
    let ytP, ffP, denoP;
    const ensureYtdlp = (...a) => existsSync(YTDLP) ? Promise.resolve() : (ytP ??= setupYtdlp(...a).finally(() => ytP = null));
    const ensureFfmpeg = (...a) => existsSync(FFMPEG) ? Promise.resolve(true) : (ffP ??= setupFfmpeg(...a).finally(() => ffP = null));

    const ensureDeno = (...a) => existsSync(DENO) ? Promise.resolve(true) : (denoP ??= setupDeno(...a).finally(() => denoP = null));

    // stream a download to disk, reporting progress 0..100 when the server sends a length
    async function download(url, dest, progress = () => {}) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const total = +r.headers.get("content-length") || 0;
        let got = 0;
        const src = Readable.fromWeb(r.body);
        src.on("data", c => { got += c.length; if (total) progress(Math.round(got / total * 100)); });
        await pipeline(src, createWriteStream(dest));
    }

    const findFile = (dir, name) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
            else if (e.name.toLowerCase() === name.toLowerCase()) return p;
        }
        return null;
    };

    // Extract one file out of a zip next to the exe. tar.exe is fastest; PowerShell Expand-Archive
    // (present on every supported Windows) is the fallback when tar.exe is missing or fails.
    async function unzip(zip, tarArgs, outName) {
        const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
        if (existsSync(tar)) {
            const code = await new Promise(res => spawn(tar, ["-xf", zip, "-C", exeDir, ...tarArgs], { stdio: "ignore", windowsHide: true })
                .on("close", res).on("error", () => res(1)));
            if (code === 0 && existsSync(join(exeDir, outName))) return true;
        }
        const tmp = join(exeDir, "unzip.tmp");
        await rm(tmp, { recursive: true, force: true });
        const ok = await new Promise(res => spawn("powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`],
            { stdio: "ignore", windowsHide: true }).on("close", c => res(c === 0)).on("error", () => res(false)));
        let found = null;
        if (ok && existsSync(tmp)) found = findFile(tmp, outName);
        if (found) await rename(found, join(exeDir, outName));
        await rm(tmp, { recursive: true, force: true });
        return !!found;
    }

    async function setupYtdlp(note = () => {}) {
        note("Setting up yt-dlp (first run only, ~18 MB)...");
        const r = await fetch(YTDLP_URL);
        if (!r.ok) throw new Error(`could not download yt-dlp (HTTP ${r.status})`);
        await writeFile(YTDLP + ".part", Buffer.from(await r.arrayBuffer()));
        await rename(YTDLP + ".part", YTDLP);
        await writeFile(STAMP, String(Date.now())).catch(() => {});
    }

    // YouTube etc. serve video and audio separately; ffmpeg merges them.
    async function setupFfmpeg(note = () => {}, progress = () => {}) {
        note("Setting up ffmpeg (first run only, ~115 MB)...");
        const zip = join(exeDir, "ffmpeg.zip.part");
        try {
            let last;
            for (const url of FFMPEG_URLS) {
                try { await download(url, zip, progress); last = null; break; }
                catch (e) { last = e.message; }
            }
            if (last) throw new Error(last);
            if (!await unzip(zip, ["--strip-components=2", "*/bin/ffmpeg.exe"], "ffmpeg.exe")) throw new Error("could not unpack");
            return true;
        } catch (e) {
            note(`ffmpeg unavailable (${e.message}); using lower-quality single-file formats`);
            return false;
        } finally {
            await rm(zip, { force: true });
        }
    }

    // yt-dlp -U, shared so concurrent callers wait for the same run. Resolves {updated, message}.
    let updP;
    const update = () => updP ??= (async () => {
        await ensureYtdlp();
        let out = "";
        await new Promise(r => {
            const p = spawn(YTDLP, ["-U"], { windowsHide: true });
            p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
            p.on("close", r); p.on("error", r);
        });
        await writeFile(STAMP, String(Date.now())).catch(() => {});
        return { updated: /Updated yt-dlp to/i.test(out), message: out.trim().split("\n").pop() || "Done" };
    })().finally(() => updP = null);
    // yt-dlp is installed but was not checked for a day
    const updateDue = () => {
        try { return existsSync(YTDLP) && Date.now() - statSync(STAMP).mtimeMs > 24 * 3600e3; }
        catch { return existsSync(YTDLP); }
    };

    // YouTube needs a JavaScript runtime for yt-dlp; optional, so failure only costs some formats.
    async function setupDeno(note = () => {}, progress = () => {}) {
        note("Setting up YouTube support (first run only, ~40 MB)...");
        const zip = join(exeDir, "deno.zip.part");
        try {
            await download(DENO_URL, zip, progress);
            if (!await unzip(zip, ["deno.exe"], "deno.exe")) throw new Error("could not unpack");
            return true;
        } catch (e) {
            note(`YouTube helper unavailable (${e.message}); some formats may be missing`);
            return false;
        } finally {
            await rm(zip, { force: true });
        }
    }

    // Set everything up in the background at startup so the user never has to think about it.
    const setup = { busy: false, message: "", warning: "" };
    async function prepare() {
        if (setup.busy) return;
        Object.assign(setup, { busy: true, message: "Setting up yt-dlp...", warning: "" });
        const note = m => { setup.message = m; if (/unavailable|could not/i.test(m)) setup.warning = m; };
        try {
            await ensureYtdlp(note);
            await ensureFfmpeg(note, p => setup.message = `Setting up ffmpeg... ${p}%`);
            await ensureDeno(note, p => setup.message = `Setting up YouTube support... ${p}%`);
        } catch (e) {
            setup.warning = `Setup failed (${e.message}). Check your internet connection - it will retry when you download.`;
        } finally { setup.busy = false; }
    }

    return {
        prepare, setup,
        ensureDeno, DENO,
        update, updateDue, pending: () => updP || Promise.resolve(),
        exeDir, YTDLP, FFMPEG, ensureYtdlp, ensureFfmpeg,
        hasFfmpeg: () => existsSync(FFMPEG),
        hasYtdlp: () => existsSync(YTDLP),
        spawnYtdlp: (args, opts = {}) => spawn(YTDLP, args, { windowsHide: true, ...opts }),
    };
}
