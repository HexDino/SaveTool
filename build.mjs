// node build.mjs  ->  dist/threads.exe  (single-file Windows exe, no Node needed on the target PC)
import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
const run = c => execSync(c, { stdio: "inherit" });
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
run("npx --yes esbuild src/app.mjs --bundle --platform=node --format=cjs --target=node24 --outfile=dist/app.cjs");
writeFileSync("dist/sea-config.json", JSON.stringify({ main: "dist/app.cjs", output: "dist/sea.blob", disableExperimentalSEAWarning: true }));
run("node --experimental-sea-config dist/sea-config.json");
copyFileSync(process.execPath, "dist/threads.exe");
run("npx --yes postject dist/threads.exe NODE_SEA_BLOB dist/sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");
copyFileSync("src/core.mjs", "dist/core.mjs.example");
console.log("built dist/threads.exe");
