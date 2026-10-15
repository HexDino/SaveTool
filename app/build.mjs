// node app/build.mjs         -> app/dist/savetool.exe + savetoolw.exe + yt-dlp.exe + ffmpeg.exe + deno.exe (ready to zip: no first-run download)
// node app/build.mjs --slim  -> savetool.exe only (the tools are downloaded on first use)
import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(dirname(fileURLToPath(import.meta.url)));
const run = c => execSync(c, { stdio: "inherit" });
const slim = process.argv.includes("--slim");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
run("npx --yes esbuild src/app.mjs --bundle --platform=node --format=cjs --target=node24 --loader:.html=text --outfile=dist/app.cjs");
writeFileSync("dist/sea-config.json", JSON.stringify({ main: "dist/app.cjs", output: "dist/sea.blob", disableExperimentalSEAWarning: true }));
run("node --experimental-sea-config dist/sea-config.json");
copyFileSync(process.execPath, "dist/savetool.exe");
// give the exe our icon + name (before injecting the blob)
const RCEDIT = ".cache/rcedit-x64.exe";
if (!existsSync(RCEDIT)) {
    mkdirSync(".cache", { recursive: true });
    writeFileSync(RCEDIT, Buffer.from(await (await fetch("https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe")).arrayBuffer()));
}
run(`"${RCEDIT.replaceAll("/", "\\")}" dist/savetool.exe --set-icon assets/icon.ico --set-version-string ProductName "Save Tool" --set-version-string FileDescription "Save Tool" --set-version-string OriginalFilename savetool.exe --set-version-string CompanyName "" --set-version-string LegalCopyright ""`);
run("npx --yes postject dist/savetool.exe NODE_SEA_BLOB dist/sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");
// Ship the tools next to the exe so the release needs no first-run download. Cached in .cache/tools
// so repeated builds don't re-download ~130 MB.
if (!slim) {
    const CACHE = ".cache/tools";
    mkdirSync(CACHE, { recursive: true });
    const fetchTo = async (url, dest) => {
        if (existsSync(dest)) return;
        console.log(`downloading ${dest} ...`);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    };
    await fetchTo("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", `${CACHE}/yt-dlp.exe`);
    copyFileSync(`${CACHE}/yt-dlp.exe`, "dist/yt-dlp.exe");
    const ffzip = `${CACHE}/ffmpeg.zip`;
    await fetchTo("https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip", ffzip);
    if (!existsSync(`${CACHE}/ffmpeg.exe`)) {
        const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
        run(`"${tar}" -xf "${ffzip}" -C "${CACHE}" --strip-components=2 "*/bin/ffmpeg.exe"`);
    }
    copyFileSync(`${CACHE}/ffmpeg.exe`, "dist/ffmpeg.exe");
    const denozip = `${CACHE}/deno.zip`;
    await fetchTo("https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip", denozip);
    if (!existsSync(`${CACHE}/deno.exe`)) {
        const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
        run(`"${tar}" -xf "${denozip}" -C "${CACHE}" deno.exe`);
    }
    copyFileSync(`${CACHE}/deno.exe`, "dist/deno.exe");
}
// savetoolw.exe: same binary with the PE subsystem switched from console (3) to windows (2),
// so double-clicking it opens no black terminal window. savetool.exe stays for command-line use.
const toWindowed = buf => {
    const pe = buf.readUInt32LE(0x3c); // e_lfanew
    if (buf.toString("ascii", pe, pe + 4) !== "PE\0\0") throw new Error("not a PE file");
    if (![0x10b, 0x20b].includes(buf.readUInt16LE(pe + 24))) throw new Error("unknown optional header");
    buf.writeUInt16LE(2, pe + 24 + 68); // Subsystem field, same offset in PE32 and PE32+
    return buf;
};
writeFileSync("dist/savetoolw.exe", toWindowed(readFileSync("dist/savetool.exe")));
copyFileSync("src/core.mjs", "dist/core.mjs");
copyFileSync("RELEASE.txt", "dist/README.txt");
rmSync("dist/app.cjs"); rmSync("dist/sea.blob"); rmSync("dist/sea-config.json");
console.log(`built app/dist/${slim ? "savetool.exe (slim)" : "savetool.exe + savetoolw.exe + yt-dlp.exe + ffmpeg.exe + deno.exe"}`);
