// node app/build.mjs  ->  app/dist/savetool.exe  (single-file Windows exe, no Node needed on the target PC)
import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(dirname(fileURLToPath(import.meta.url)));
const run = c => execSync(c, { stdio: "inherit" });
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
copyFileSync("src/core.mjs", "dist/core.mjs");
copyFileSync("RELEASE.txt", "dist/README.txt");
rmSync("dist/app.cjs"); rmSync("dist/sea.blob"); rmSync("dist/sea-config.json");
console.log("built app/dist/savetool.exe");
