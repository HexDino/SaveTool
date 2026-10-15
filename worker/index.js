/**
 * Cloudflare Worker for Save Tool — public front door for the app running on your PC.
 *
 * Pure reverse proxy: the page, /api/* and file downloads all go through a cloudflared tunnel
 * (secret BACKEND_ORIGIN) to savetool on your PC. The per-run token lives in the page served by
 * the PC, so this Worker keeps no secrets of its own — if the PC is off, it shows a clear notice.
 *
 * Deploy:  npx wrangler deploy
 * Set the tunnel URL:  npx wrangler secret put BACKEND_ORIGIN
 */

const OFFLINE_PAGE = (reason) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Save Tool - offline</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #faf9f5; color: #141413;
         font: 15px/1.6 system-ui, "Segoe UI", sans-serif; padding: 24px; }
  .card { max-width: 460px; background: #fff; border: 1px solid #e5e2d6; border-radius: 16px; padding: 26px 28px;
          box-shadow: 0 1px 2px rgba(20,20,19,.04), 0 6px 24px rgba(20,20,19,.05); }
  h1 { font-size: 20px; margin: 0 0 10px; }
  p { margin: 0 0 10px; color: #6b6a64; }
  code { background: #f0eee6; border-radius: 6px; padding: 2px 6px; font-size: 13px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #b3402a; margin-right: 8px; }
</style></head>
<body><div class="card">
  <h1><span class="dot"></span>Save Tool is not reachable</h1>
  <p>This page is the public front door; the app itself runs on your PC and it is not answering right now.</p>
  <p>On the PC: start <code>savetoolw.exe</code> and keep the tunnel running (<code>run-public.bat</code>), then reload this page.</p>
  <p style="font-size:12.5px;color:#a6a59d">${reason ? `Details: ${reason}` : ""}</p>
</div></body></html>`;

export default {
    async fetch(request, env) {
        const backend = String(env.BACKEND_ORIGIN || "").trim().replace(/\/+$/, "");
        if (!backend) {
            return new Response(OFFLINE_PAGE("BACKEND_ORIGIN is not set - run the tunnel sync script"), {
                status: 503, headers: { "content-type": "text/html; charset=utf-8" },
            });
        }

        const url = new URL(request.url);
        const headers = new Headers(request.headers);
        headers.delete("host"); // fetch() sets it from the target URL

        const init = { method: request.method, headers, redirect: "manual" };
        if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

        try {
            const res = await fetch(backend + url.pathname + url.search, init);
            // a dead tunnel makes Cloudflare answer with its own 530/5xx error page -
            // show the friendly notice instead (only for the page itself, never for API calls)
            if (url.pathname === "/" && res.status >= 500) {
                return new Response(OFFLINE_PAGE(`backend answered ${res.status}`), {
                    status: 503, headers: { "content-type": "text/html; charset=utf-8" },
                });
            }
            return new Response(res.body, {
                status: res.status,
                statusText: res.statusText,
                headers: new Headers(res.headers),
            });
        } catch (e) {
            return new Response(OFFLINE_PAGE(String(e && e.message || e).slice(0, 120)), {
                status: 502, headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
    },
};
