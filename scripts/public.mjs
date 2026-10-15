// run-public: start Save Tool on this PC, open a cloudflared tunnel to it, and point the
// Cloudflare Worker (secret BACKEND_ORIGIN) at that tunnel. Then the Worker URL works from
// anywhere - phone on 4G, another laptop, etc. Ctrl+C stops everything.
//
//   npm run public            (or double-click run-public.bat)
//   npm run tunnel            tunnel + secret only (you start savetool yourself)
//
// Options:
//   --tunnel-only   do not start savetool, only the tunnel + secret sync
//   --url <url>     public Worker URL to print (default: the deployed savetool Worker)
import { spawn } from "node:child_process";
import { existsSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const APP_PORT = 47821;
const WORKER_NAME = "savetool";
const DEFAULT_PUBLIC_URL = "https://savetool.thanhhung33.workers.dev";
const LOG_FILE = join(ROOT, "public-run.log");

const args = process.argv.slice(2);
const tunnelOnly = args.includes("--tunnel-only");
const urlFlag = args.indexOf("--url");
const publicUrl = urlFlag >= 0 ? args[urlFlag + 1] : DEFAULT_PUBLIC_URL;

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
// prefer the locally installed wrangler (run `npm install` once) - no shim, no download
const localWrangler = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const children = [];

// everything goes to the console and to public-run.log (so a failed run can be inspected later)
const log = (...a) => {
    const line = `[${new Date().toISOString()}] ${a.join(" ")}`;
    console.log("[public]", ...a);
    try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
};

function findApp() {
    for (const name of ["savetoolw.exe", "savetool.exe"]) {
        const p = join(ROOT, "app", "dist", name);
        if (existsSync(p)) return p;
    }
    return null;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitForApp(timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        try {
            const r = await fetch(`http://127.0.0.1:${APP_PORT}/`, { signal: AbortSignal.timeout(2000) });
            if (r.ok) return true;
        } catch {}
        await wait(700);
    }
    return false;
}

function startTunnel() {
    const exe = process.env.CLOUDFLARED || "cloudflared";
    const child = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${APP_PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    return new Promise((resolve, reject) => {
        let buf = "";
        const scan = d => {
            buf += d;
            const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (m) resolve(m[0]);
        };
        child.stdout.setEncoding("utf8").on("data", scan);
        child.stderr.setEncoding("utf8").on("data", scan);
        child.on("error", () => reject(new Error("cloudflared not found - install it (winget install Cloudflare.cloudflared)")));
        child.on("close", () => reject(new Error("cloudflared exited before reporting a URL")));
        setTimeout(() => reject(new Error("timed out waiting for the tunnel URL")), 45000);
    });
}

// put the value into the Worker secret; resolves on success, rejects with the tail of the output
function runSecret(cmd, cmdArgs, value, useShell) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, cmdArgs, { cwd: ROOT, shell: useShell, stdio: ["pipe", "pipe", "pipe"] });
        let out = "";
        p.stdout.on("data", d => out += d);
        p.stderr.on("data", d => out += d);
        p.on("error", reject);
        p.on("close", code => code === 0 ? resolve(out) : reject(new Error(out.trim().split("\n").slice(-3).join(" "))));
        p.stdin.write(value + "\n");
        p.stdin.end();
    });
}

async function setSecret(value) {
    const useShell = process.platform === "win32";
    if (existsSync(localWrangler)) {
        try {
            log("using the local wrangler");
            await runSecret(process.execPath, [localWrangler, "secret", "put", "BACKEND_ORIGIN"], value, false);
            return;
        } catch (e) {
            log(`local wrangler failed (${String(e.message).slice(0, 80)}) - falling back to npx`);
        }
    }
    log("using npx wrangler@4");
    await runSecret(npx, ["--yes", "wrangler@4", "secret", "put", "BACKEND_ORIGIN"], value, useShell);
}

function stopAll() {
    for (const c of children) { try { c.kill(); } catch {} }
}
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("exit", stopAll);

async function main() {
    if (!tunnelOnly) {
        const app = findApp();
        if (!app) throw new Error("app/dist/savetoolw.exe not found - build it first: node app/build.mjs");
        log(`starting ${app.split(/[\\/]/).pop()} (public mode)...`);
        children.push(spawn(app, [], { env: { ...process.env, SAVETOOL_PUBLIC: "1" }, stdio: "ignore", detached: false }));
        if (!await waitForApp()) throw new Error("savetool did not answer on 127.0.0.1:47821");
        log("app is up");
    }

    log("opening the tunnel...");
    const tunnelUrl = await startTunnel();
    log(`tunnel: ${tunnelUrl}`);

    log("pointing the Worker at it (wrangler secret put BACKEND_ORIGIN)...");
    await setSecret(tunnelUrl);
    log("secret updated");

    console.log("\n  Save Tool is now reachable from anywhere:\n");
    console.log(`    ${publicUrl}\n`);
    console.log("  Keep this window open while you use it. Ctrl+C stops the tunnel and the app.\n");
    await new Promise(() => {});
}

main().catch(e => { console.error("[public] error:", e.message); stopAll(); process.exit(1); });
