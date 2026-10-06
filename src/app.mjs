// Save Tool: interactive when double-clicked, or `savetool.exe <url> [folder]`.
// Threads -> built-in extractor (core.mjs). YouTube / Instagram / Facebook / everything else -> yt-dlp,
// which is downloaded next to the exe on first use and updated with the `update` command.
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import * as bundled from "./core.mjs";

const exeDir = dirname(process.execPath.toLowerCase().endsWith("node.exe") ? process.argv[1] : process.execPath);
const YTDLP = join(exeDir, "yt-dlp.exe");
const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const FFMPEG = join(exeDir, "ffmpeg.exe");
const FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const defaultDir = join(homedir(), "Downloads", "SaveTool");

// A fixed core.mjs placed next to the exe overrides the built-in Threads extractor (no rebuild needed).
async function loadCore() {
    const file = join(exeDir, "core.mjs");
    if (existsSync(file)) {
        try { return { core: await import(pathToFileURL(file).href), source: "core.mjs" }; }
        catch (e) { console.log(`(ignoring broken core.mjs: ${e.message})`); }
    }
    return { core: bundled, source: "built-in" };
}

const isThreads = url => { try { return /^(www\.)?threads\.(com|net)$/.test(new URL(url).hostname); } catch { return false; } };

async function saveThreads(core, url, dir) {
    const { code, items } = await core.getThreadsMedia(url);
    await mkdir(dir, { recursive: true });
    for (const [i, it] of items.entries()) {
        const buf = Buffer.from(await core.fetchRetry(it.url, { headers: { "user-agent": core.UA } }).then(r => r.arrayBuffer()));
        const name = `threads_${code}${items.length > 1 ? `_${i + 1}` : ""}.${it.ext}`;
        await writeFile(join(dir, name), buf);
        console.log(`  saved ${join(dir, name)} (${it.type}, ${(buf.length / 1048576).toFixed(1)} MB)`);
    }
}

const run = (args) => new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args, { stdio: "inherit", windowsHide: true });
    p.on("error", reject);
    p.on("close", code => resolve(code));
});

async function ensureYtdlp() {
    if (existsSync(YTDLP)) return;
    console.log("  First use: downloading yt-dlp (one time, ~18 MB)...");
    const r = await fetch(YTDLP_URL);
    if (!r.ok) throw new Error(`could not download yt-dlp (HTTP ${r.status})`);
    const tmp = YTDLP + ".part";
    await writeFile(tmp, Buffer.from(await r.arrayBuffer()));
    await rename(tmp, YTDLP);
}

// YouTube etc. serve video and audio separately; ffmpeg merges them into one mp4.
async function ensureFfmpeg() {
    if (existsSync(FFMPEG)) return;
    console.log("  First use: downloading ffmpeg (one time, ~115 MB) so video and audio can be merged...");
    const zip = join(exeDir, "ffmpeg.zip.part");
    const r = await fetch(FFMPEG_URL);
    if (!r.ok) throw new Error(`could not download ffmpeg (HTTP ${r.status})`);
    const total = +r.headers.get("content-length") || 0;
    let got = 0, last = 0;
    const src = Readable.fromWeb(r.body);
    src.on("data", c => { got += c.length; if (total && got - last > 5e6) { last = got; process.stdout.write(`${String.fromCharCode(13)}  ${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`); } });
    await pipeline(src, createWriteStream(zip));
    process.stdout.write("\n");
    const code = await new Promise(res => spawn(join(process.env.SystemRoot || "C:\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", exeDir, "--strip-components=2", "*/bin/ffmpeg.exe"], { stdio: "ignore", windowsHide: true }).on("close", res).on("error", () => res(1)));
    await rm(zip, { force: true });
    if (code !== 0 || !existsSync(FFMPEG)) throw new Error("could not unpack ffmpeg");
}

async function saveWithYtdlp(url, dir) {
    await ensureYtdlp();
    let hasFfmpeg = true;
    try { await ensureFfmpeg(); } catch (e) { hasFfmpeg = false; console.log(`  (${e.message}; falling back to single-file formats, lower quality)`); }
    await mkdir(dir, { recursive: true });
    const args = [
        "--no-playlist", "--newline", "--no-warnings",
        "-P", dir, "-o", "%(extractor)s_%(id)s.%(ext)s",
        "--ffmpeg-location", exeDir,
        // without ffmpeg, only single-file formats (video+audio in one) can be saved
        "-f", hasFfmpeg ? "bv*+ba/b" : "b[ext=mp4]/b",
    ];
    if (hasFfmpeg) args.push("--merge-output-format", "mp4");
    const cookies = join(exeDir, "cookies.txt");
    if (existsSync(cookies)) args.push("--cookies", cookies);
    args.push(url);
    const code = await run(args);
    if (code !== 0) {
        throw new Error("download failed. If the site changed, type `update`. Private/age-restricted videos need a cookies.txt next to the exe.");
    }
}

async function update() {
    await ensureYtdlp();
    console.log("  Updating yt-dlp...");
    await run(["-U"]);
}

async function save(core, url, dir) {
    if (isThreads(url)) return saveThreads(core, url, dir);
    if (!/^https?:\/\//i.test(url)) throw new Error("that doesn't look like a link");
    return saveWithYtdlp(url, dir);
}

async function main() {
    const { core, source } = await loadCore();
    const [argUrl, argDir] = process.argv.slice(2);

    if (argUrl === "update") { await update(); return; }
    if (argUrl) {
        try { await save(core, argUrl, argDir || "."); }
        catch (e) { console.error("error:", e.message); process.exit(1); }
        return;
    }

    console.log(`Save Tool v${core.VERSION} (${source} Threads extractor)`);
    console.log("Works with Threads, YouTube, Instagram, Facebook, TikTok, X and more.");
    console.log(`Saving to: ${defaultDir}\nPaste a link and press Enter. Type "update" to update, empty line to quit.\n`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    while (true) {
        let url;
        try { url = (await rl.question("Link> ")).trim(); } catch { break; }
        if (!url) break;
        try {
            if (url.toLowerCase() === "update") await update();
            else await save(core, url, defaultDir);
        } catch (e) { console.log(`  error: ${e.message}`); }
    }
    rl.close();
}

main().catch(e => { console.error("fatal:", e.message); process.exit(1); });
