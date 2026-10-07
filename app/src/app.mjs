// Save Tool
//   savetool.exe                  -> opens the web UI in your browser
//   savetool.exe <link> [folder]  -> command line download
//   savetool.exe update           -> update yt-dlp
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as bundled from "./core.mjs";
import { makeTools } from "./tools.mjs";
import { makeJobs } from "./jobs.mjs";
import { startServer, PORT } from "./server.mjs";

const exeDir = dirname(process.execPath.toLowerCase().endsWith("node.exe") ? process.argv[1] : process.execPath);
const outDirDefault = join(homedir(), "Downloads", "SaveTool");
const tools = makeTools(exeDir);

// saved settings (next to the exe): currently only the download folder
const settingsFile = join(exeDir, "settings.json");
let outDir = outDirDefault;
try { const s = JSON.parse(readFileSync(settingsFile, "utf8")); if (typeof s.outDir === "string" && s.outDir) outDir = s.outDir; } catch {}
const setOutDir = dir => { outDir = dir; try { writeFileSync(settingsFile, JSON.stringify({ outDir })); } catch {} };

// A fixed core.mjs placed next to the exe overrides the built-in Threads extractor (no rebuild needed).
let coreCache;
async function loadCore() {
    if (coreCache) return coreCache;
    const file = join(exeDir, "core.mjs");
    if (existsSync(file)) {
        try { return coreCache = { core: await import(pathToFileURL(file).href), source: "core.mjs" }; }
        catch (e) { console.log(`(ignoring broken core.mjs: ${e.message})`); }
    }
    return coreCache = { core: bundled, source: "built-in" };
}

async function main() {
    const [arg, argDir] = process.argv.slice(2);
    const { core, source } = await loadCore();

    if (arg === "update") {
        await tools.ensureYtdlp(console.log);
        await new Promise(r => tools.spawnYtdlp(["-U"], { stdio: "inherit" }).on("close", r));
        return;
    }

    if (arg) { // command line mode
        let failed = false;
        const jobs = makeJobs({
            tools, loadCore, outDir: argDir || ".",
            onChange: j => {
                if (j.status === "running" && j.message) process.stdout.write(`\r${j.message.padEnd(50)} ${j.progress}%  `);
                if (j.status === "done") console.log(`\nsaved ${j.file || ""}`);
                if (j.status === "error") { failed = true; console.error("\nerror:", j.message); }
            },
        });
        try { jobs.add({ url: arg }); } catch (e) { console.error("error:", e.message); process.exit(1); }
        await new Promise(r => { const t = setInterval(() => { if (!jobs.active()) { clearInterval(t); r(); } }, 300); });
        process.exit(failed ? 1 : 0);
    }

    // UI mode
    const jobs = makeJobs({ tools, loadCore, outDir: () => outDir });
    let url, already = false;
    try {
        url = await startServer({ jobs, tools, getOutDir: () => outDir, setOutDir, version: core.VERSION, source, onIdleExit: () => process.exit(0) });
    } catch (e) {
        if (e.code !== "EADDRINUSE") throw e;
        url = `http://127.0.0.1:${PORT}/`; already = true; // already running: just bring up its page
    }
    if (!already && tools.updateDue()) tools.update().catch(() => {}); // daily background yt-dlp update
    console.log(`Save Tool is running at ${url}\nKeep this window open while downloading; close it to quit.`);
    if (!process.env.SAVETOOL_NO_OPEN) spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
    if (already) setTimeout(() => process.exit(0), 1500);
}

main().catch(e => { console.error("fatal:", e.message); process.exit(1); });
