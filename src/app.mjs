// Threads video saver: interactive when double-clicked, or `threads.exe <url> [folder]`.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import * as bundled from "./core.mjs";

const exeDir = dirname(process.execPath.toLowerCase().endsWith("node.exe") ? process.argv[1] : process.execPath);

// A fixed core.mjs placed next to the exe overrides the built-in extractor (no rebuild needed).
async function loadCore() {
    const file = join(exeDir, "core.mjs");
    if (existsSync(file)) {
        try { return { core: await import(pathToFileURL(file).href), source: "core.mjs" }; }
        catch (e) { console.log(`(ignoring broken core.mjs: ${e.message})`); }
    }
    return { core: bundled, source: "built-in" };
}

async function save(core, url, dir) {
    const { code, items } = await core.getThreadsMedia(url);
    await mkdir(dir, { recursive: true });
    for (const [i, it] of items.entries()) {
        const buf = Buffer.from(await core.fetchRetry(it.url, { headers: { "user-agent": core.UA } }).then(r => r.arrayBuffer()));
        const name = `threads_${code}${items.length > 1 ? `_${i + 1}` : ""}.${it.ext}`;
        await writeFile(join(dir, name), buf);
        console.log(`  saved ${join(dir, name)} (${it.type}, ${(buf.length / 1048576).toFixed(1)} MB)`);
    }
}

async function main() {
    const { core, source } = await loadCore();
    const [argUrl, argDir] = process.argv.slice(2);
    const defaultDir = join(homedir(), "Downloads", "Threads");

    if (argUrl) {
        try { await save(core, argUrl, argDir || "."); }
        catch (e) { console.error("error:", e.message); process.exit(1); }
    } else {
        console.log(`Threads Video Saver v${core.VERSION} (${source} extractor)`);
        console.log(`Saving to: ${defaultDir}\nPaste a Threads post link and press Enter. Empty line to quit.\n`);
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        while (true) {
            let url;
            try { url = (await rl.question("Link> ")).trim(); } catch { break; }
            if (!url) break;
            try { await save(core, url, defaultDir); }
            catch (e) { console.log(`  error: ${e.message}`); }
        }
        rl.close();
    }
}

main().catch(e => { console.error("fatal:", e.message); process.exit(1); });
