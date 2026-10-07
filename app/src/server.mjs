// Local web UI server. Binds to 127.0.0.1 only; every API call needs the per-run token
// (a random page on the internet can reach localhost, so the token + Host check matter).
import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import html from "./ui.html";

export const PORT = 47821;

export function startServer({ jobs, tools, outDir, version, source, onIdleExit }) {
    const token = randomBytes(16).toString("hex");
    let lastPing = 0, seen = false;

    const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const readBody = req => new Promise(r => { let s = ""; req.on("data", c => s += c); req.on("end", () => { try { r(JSON.parse(s || "{}")); } catch { r({}); } }); });
    const explorer = args => spawn("explorer.exe", args, { detached: true, stdio: "ignore" }).unref();

    const server = http.createServer(async (req, res) => {
        const host = req.headers.host || "";
        if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) { res.writeHead(403); return res.end(); }
        const url = new URL(req.url, "http://x");

        if (req.method === "GET" && url.pathname === "/") {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
            return res.end(html.replace("__TOKEN__", token));
        }
        if (!url.pathname.startsWith("/api/") || req.headers["x-token"] !== token) { res.writeHead(403); return res.end(); }

        try {
            if (req.method === "GET" && url.pathname === "/api/state") {
                seen = true; lastPing = Date.now();
                return json(res, 200, { jobs: jobs.list(), outDir, version, source, tools: { ytdlp: tools.hasYtdlp(), ffmpeg: tools.hasFfmpeg() } });
            }
            if (req.method !== "POST") { res.writeHead(405); return res.end(); }
            const body = await readBody(req);

            if (url.pathname === "/api/jobs") {
                const urls = String(body.url || "").split(/\s+/).filter(Boolean);
                if (!urls.length) return json(res, 400, { error: "Paste a link first." });
                for (const u of urls) jobs.add({ url: u, kind: body.kind, quality: body.quality, cookies: body.cookies, playlist: body.playlist });
                return json(res, 200, { ok: true });
            }
            const m = url.pathname.match(/^\/api\/jobs\/(\d+)\/(cancel|remove|open)$/);
            if (m) {
                const id = +m[1], job = jobs.get(id);
                if (!job) return json(res, 404, { error: "no such job" });
                if (m[2] === "cancel") jobs.cancel(id);
                else if (m[2] === "remove") jobs.remove(id);
                else if (job.file && existsSync(job.file)) explorer([`/select,${job.file}`]);
                else explorer([outDir]);
                return json(res, 200, { ok: true });
            }
            if (url.pathname === "/api/folder") { explorer([outDir]); return json(res, 200, { ok: true }); }
            if (url.pathname === "/api/update") {
                return json(res, 200, { message: (await tools.update()).message });
            }
            res.writeHead(404); res.end();
        } catch (e) { json(res, 500, { error: e.message }); }
    });

    // close itself a few minutes after the browser tab is gone (never during a download)
    setInterval(() => { if (seen && Date.now() - lastPing > 180000 && !jobs.active()) onIdleExit(); }, 10000).unref();

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(PORT, "127.0.0.1", () => resolve(`http://127.0.0.1:${PORT}/`));
    });
}
