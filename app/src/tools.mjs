// yt-dlp + ffmpeg: downloaded next to the exe on first use.
import { writeFile, rename, rm } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

export function makeTools(exeDir) {
    const YTDLP = join(exeDir, "yt-dlp.exe");
    const FFMPEG = join(exeDir, "ffmpeg.exe");
    const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    const FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

    // note(text) reports a status line; progress(0..100) reports download progress
    // concurrent jobs share one in-flight setup instead of writing the same file twice
    let ytP, ffP;
    const ensureYtdlp = (...a) => existsSync(YTDLP) ? Promise.resolve() : (ytP ??= setupYtdlp(...a).finally(() => ytP = null));
    const ensureFfmpeg = (...a) => existsSync(FFMPEG) ? Promise.resolve(true) : (ffP ??= setupFfmpeg(...a).finally(() => ffP = null));

    async function setupYtdlp(note = () => {}) {
        note("Setting up yt-dlp (first run only, ~18 MB)...");
        const r = await fetch(YTDLP_URL);
        if (!r.ok) throw new Error(`could not download yt-dlp (HTTP ${r.status})`);
        await writeFile(YTDLP + ".part", Buffer.from(await r.arrayBuffer()));
        await rename(YTDLP + ".part", YTDLP);
    }

    // YouTube etc. serve video and audio separately; ffmpeg merges them.
    async function setupFfmpeg(note = () => {}, progress = () => {}) {
        note("Setting up ffmpeg (first run only, ~115 MB)...");
        const zip = join(exeDir, "ffmpeg.zip.part");
        try {
            const r = await fetch(FFMPEG_URL);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const total = +r.headers.get("content-length") || 0;
            let got = 0;
            const src = Readable.fromWeb(r.body);
            src.on("data", c => { got += c.length; if (total) progress(Math.round(got / total * 100)); });
            await pipeline(src, createWriteStream(zip));
            const tar = join(process.env.SystemRoot || "C:\Windows", "System32", "tar.exe");
            const code = await new Promise(res => spawn(tar, ["-xf", zip, "-C", exeDir, "--strip-components=2", "*/bin/ffmpeg.exe"], { stdio: "ignore", windowsHide: true })
                .on("close", res).on("error", () => res(1)));
            if (code !== 0 || !existsSync(FFMPEG)) throw new Error("could not unpack");
            return true;
        } catch (e) {
            note(`ffmpeg unavailable (${e.message}); using lower-quality single-file formats`);
            return false;
        } finally {
            await rm(zip, { force: true });
        }
    }

    return {
        exeDir, YTDLP, FFMPEG, ensureYtdlp, ensureFfmpeg,
        hasFfmpeg: () => existsSync(FFMPEG),
        hasYtdlp: () => existsSync(YTDLP),
        spawnYtdlp: (args, opts = {}) => spawn(YTDLP, args, { windowsHide: true, ...opts }),
    };
}
