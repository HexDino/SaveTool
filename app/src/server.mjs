// Local web UI server. The main server binds to 127.0.0.1 only; every API call needs the
// per-run token (a random page on the internet can reach localhost, so the token + Host check
// matter). "Use on phone" opens a second server on the LAN (same token), so a phone on the
// same Wi-Fi can open the same page; downloads still land on this PC.
// "Open to internet" (and SAVETOOL_PUBLIC=1 behind a Cloudflare Worker) expose it beyond the LAN.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, statSync, createReadStream } from "node:fs";
import { join, basename } from "node:path";
import { networkInterfaces } from "node:os";
import html from "./ui.html";

export const PORT = 47821;
export const PHONE_PORT = 47822;

// private IPv4 addresses of this machine (phone URL candidates), best guess first
const lanIps = () => {
    const ips = [];
    for (const list of Object.values(networkInterfaces())) {
        for (const ni of list || []) {
            if (ni.family === "IPv4" && !ni.internal) ips.push(ni.address);
        }
    }
    const rank = ip => ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2;
    return ips.sort((a, b) => rank(a) - rank(b));
};

const ps = (script, env = {}) => new Promise(resolve => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
        { windowsHide: true, env: { ...process.env, ...env } });
    let out = "";
    p.stdout.setEncoding("utf8").on("data", d => out += d);
    p.on("error", () => resolve(""));
    p.on("close", () => resolve(out.trim()));
});

// Windows folder picker; resolves the chosen path, or "" if cancelled
const chooseFolder = start => ps(`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'; $owner.Show(); $owner.Activate()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose where to save downloads'
$d.ShowNewFolderButton = $true
if ($env:ST_START -and (Test-Path -LiteralPath $env:ST_START)) { $d.SelectedPath = $env:ST_START }
if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }
$owner.Close()`, { ST_START: start });

// Desktop + Start menu shortcuts (Start menu entries show up in Windows search)
async function createShortcuts() {
    const out = await ps(`
$exe = $env:ST_EXE
$shell = New-Object -ComObject WScript.Shell
$made = @()
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'))) {
  try {
    $lnk = $shell.CreateShortcut((Join-Path $dir 'Save Tool.lnk'))
    $lnk.TargetPath = $exe; $lnk.WorkingDirectory = Split-Path $exe
    $lnk.IconLocation = "$exe,0"; $lnk.Description = 'Save Tool - download videos'
    $lnk.Save(); $made += $dir
  } catch {}
}
$made.Count`, { ST_EXE: process.execPath });
    if (out !== "2") throw new Error("Could not create the shortcuts.");
    return "Added Save Tool to your Desktop and Start menu.";
}

export function startServer({ jobs, tools, getOutDir, setOutDir, version, source, onIdleExit }) {
    const token = randomBytes(16).toString("hex");
    let lastPing = 0, seen = false;

    const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const readBody = req => new Promise(r => { let s = ""; req.on("data", c => s += c); req.on("end", () => { try { r(JSON.parse(s || "{}")); } catch { r({}); } }); });
    const explorer = args => spawn("explorer.exe", args, { detached: true, stdio: "ignore" }).unref();

    // hosts the main server answers on; the tunnel host is added later by /api/tunnel
    const localHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

    // opened on demand by /api/phone: same page + token, but reachable from the Wi-Fi
    let phoneP;
    const openPhoneServer = () => phoneP ??= (async () => {
        const ips = lanIps();
        if (!ips.length) throw new Error("no Wi-Fi / network connection found on this PC");
        const allowed = new Set([...ips.map(ip => `${ip}:${PHONE_PORT}`), `127.0.0.1:${PHONE_PORT}`, `localhost:${PHONE_PORT}`]);
        const s = http.createServer(makeHandler(allowed));
        await new Promise((resolve, reject) => { s.once("error", reject); s.listen(PHONE_PORT, "0.0.0.0", resolve); });
        return { server: s, urls: ips.map(ip => `http://${ip}:${PHONE_PORT}/`) };
    })().catch(e => { phoneP = null; throw e; });

    // opened on demand by /api/tunnel: a free, temporary cloudflare tunnel so the page works
    // from anywhere (not just the same Wi-Fi). Whoever has the link has the token - link = key.
    let tunnelP, tunnelChild;
    const CLOUDFLARED = process.env.CLOUDFLARED || "cloudflared";
    const openTunnel = () => tunnelP ??= (async () => {
        const child = spawn(CLOUDFLARED, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`], { windowsHide: true });
        tunnelChild = child;
        process.on("exit", () => { try { child.kill(); } catch {} });
        const out = new Promise(resolve => {
            let buf = "";
            const onLine = d => {
                buf += d;
                const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (m) resolve(m[0]);
            };
            child.stdout.setEncoding("utf8").on("data", onLine);
            child.stderr.setEncoding("utf8").on("data", onLine);
            child.on("error", () => resolve(null));
            child.on("close", () => resolve(null));
            setTimeout(() => resolve(null), 30000);
        });
        const publicUrl = await out;
        if (!publicUrl) { tunnelP = null; tunnelChild = null; throw new Error("could not create the tunnel - is cloudflared installed?"); }
        localHosts.add(new URL(publicUrl).host); // the main server now accepts the tunnel host
        return { url: publicUrl };
    })().catch(e => { tunnelP = null; throw e; });

    // one request handler shared by both servers; allowedHosts differs per server
    // SAVETOOL_PUBLIC=1 skips the Host check (used when the app sits behind a Cloudflare Worker/tunnel);
    // the per-run token still guards every /api/* call.
    const publicMode = !!process.env.SAVETOOL_PUBLIC;
    const makeHandler = allowedHosts => async (req, res) => {
        if (!publicMode && !allowedHosts.has(req.headers.host || "")) { res.writeHead(403); return res.end(); }
        const url = new URL(req.url, "http://x");

        // browser downloads cannot send custom headers, so the file route takes the token in the query
        const isFile = req.method === "GET" && url.pathname.startsWith("/api/file/");

        if (req.method === "GET" && url.pathname === "/") {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            return res.end(html.replace("__TOKEN__", token));
        }
        if (isFile && url.searchParams.get("t") === token) {
            const job = jobs.get(+url.pathname.slice("/api/file/".length));
            if (!job || job.status !== "done" || !job.file || !existsSync(job.file)) { res.writeHead(404); return res.end("no file"); }
            const size = statSync(job.file).size;
            const name = basename(job.file);
            // ASCII fallback + RFC 5987 name: Android browsers want the plain filename,
            // iOS/desktop use filename* - sending both makes "save to Downloads" work everywhere
            const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
            const headers = {
                "content-type": job.file.endsWith(".mp3") ? "audio/mpeg" : job.file.endsWith(".mp4") ? "video/mp4" : "application/octet-stream",
                "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
                "accept-ranges": "bytes", // lets phone download managers resume / stream the file
                "cache-control": "no-store",
            };
            // range requests (resume, video players, Android download manager)
            const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || "").trim());
            if (range) {
                const start = range[1] ? +range[1] : 0;
                const end = range[2] ? Math.min(+range[2], size - 1) : size - 1;
                if (start >= size || start > end) {
                    res.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
                    return res.end();
                }
                res.writeHead(206, { ...headers, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}` });
                return createReadStream(job.file, { start, end }).pipe(res);
            }
            res.writeHead(200, { ...headers, "content-length": size });
            return createReadStream(job.file).pipe(res);
        }
        if (!url.pathname.startsWith("/api/") || req.headers["x-token"] !== token) { res.writeHead(403); return res.end(); }

        try {
            if (req.method === "GET" && url.pathname === "/api/state") {
                seen = true; lastPing = Date.now();
                return json(res, 200, { jobs: jobs.list(), outDir: getOutDir(), version, source, setup: tools.setup, hasCookies: existsSync(join(tools.exeDir, "cookies.txt")) });
            }
            if (req.method !== "POST") { res.writeHead(405); return res.end(); }
            const body = await readBody(req);

            if (url.pathname === "/api/jobs") {
                const urls = String(body.url || "").split(/\s+/).filter(Boolean);
                if (!urls.length) return json(res, 400, { error: "Paste a link first." });
                for (const u of urls) jobs.add({ url: u, kind: body.kind, quality: body.quality, cookies: body.cookies, playlist: body.playlist });
                return json(res, 200, { ok: true });
            }
            const m = url.pathname.match(/^\/api\/jobs\/(\d+)\/(cancel|remove|open|retry)$/);
            if (m) {
                const id = +m[1], job = jobs.get(id);
                if (!job) return json(res, 404, { error: "no such job" });
                if (m[2] === "cancel") jobs.cancel(id);
                else if (m[2] === "retry") jobs.retry(id);
                else if (m[2] === "remove") jobs.remove(id);
                else if (job.file && existsSync(job.file)) explorer([`/select,${job.file}`]);
                else explorer([job.outDir]);
                return json(res, 200, { ok: true });
            }
            if (url.pathname === "/api/folder") { explorer([getOutDir()]); return json(res, 200, { ok: true }); }
            if (url.pathname === "/api/choose-folder") {
                const picked = await chooseFolder(getOutDir());
                if (picked) setOutDir(picked);
                return json(res, 200, { outDir: getOutDir(), changed: !!picked });
            }
            if (url.pathname === "/api/shortcut") return json(res, 200, { message: await createShortcuts() });
            if (url.pathname === "/api/update") {
                return json(res, 200, { message: (await tools.update()).message });
            }
            if (url.pathname === "/api/phone") {
                const { urls } = await openPhoneServer();
                return json(res, 200, { url: urls[0], urls });
            }
            if (url.pathname === "/api/tunnel") {
                const { url: publicUrl } = await openTunnel();
                return json(res, 200, { url: publicUrl });
            }
            res.writeHead(404); res.end();
        } catch (e) { json(res, 500, { error: e.message }); }
    };

    const server = http.createServer(makeHandler(localHosts));

    // close itself a few minutes after the browser tab is gone (never during a download).
    // In public mode the app is a server behind a tunnel: it must stay up until the launcher stops it.
    if (!publicMode) setInterval(() => { if (seen && Date.now() - lastPing > 180000 && !jobs.active()) onIdleExit(); }, 10000).unref();

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(PORT, "127.0.0.1", () => resolve(`http://127.0.0.1:${PORT}/`));
    });
}
