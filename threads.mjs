// Usage: node threads.mjs <threads post url> [output dir]
// Downloads every video/photo of a Threads post (single video, photo, or carousel).
//
// Fetches the post page with browser-like headers, reads the embedded JSON the
// web app hydrates from, finds the post object by shortcode and saves its media.
// No login, cookies or GraphQL doc_id needed.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const pageHeaders = {
    "user-agent": UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
};

export function parseThreadsUrl(input) {
    let u;
    try { u = new URL(input); } catch { throw new Error("invalid url"); }
    if (!/^(www\.)?threads\.(com|net)$/.test(u.hostname)) throw new Error("not a threads.com / threads.net url");
    // /@user/post/CODE  or short form /t/CODE
    const code = u.pathname.match(/\/post\/([\w-]+)/)?.[1] || u.pathname.match(/^\/t\/([\w-]+)/)?.[1];
    if (!code) throw new Error("url is not a post link (expected /@user/post/<code>)");
    return code;
}

async function fetchRetry(url, opts, tries = 3) {
    let err;
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch(url, opts);
            if (r.ok) return r;
            err = new Error(`HTTP ${r.status} for ${new URL(url).hostname}`);
            if (r.status < 500 && r.status !== 429) break;
        } catch (e) { err = e; }
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
    throw err;
}

const area = c => (c.width || 0) * (c.height || 0);

// one media node (the post itself or a carousel child) -> { type, url } | null
function pickMedia(node) {
    if (node.video_versions?.length) {
        // entries usually only carry type+url (101/102/103, same file); use size if present
        const v = node.video_versions.reduce((a, b) => area(a) < area(b) ? b : a);
        return { type: "video", url: v.url, ext: "mp4" };
    }
    const cands = node.image_versions2?.candidates;
    if (cands?.length) {
        const c = cands.reduce((a, b) => area(a) < area(b) ? b : a);
        return { type: "photo", url: c.url, ext: "jpg" };
    }
    return null;
}

export async function getThreadsMedia(input) {
    const code = parseThreadsUrl(input);
    const html = await fetchRetry(`https://www.threads.com/@_/post/${code}`, { headers: pageHeaders }).then(r => r.text());

    const blobs = [...html.matchAll(/<script type="application\/json"[^>]*>(.*?)<\/script>/gs)]
        .map(m => m[1]).filter(b => b.includes(code));

    let post;
    (function walk(o) {
        if (post || !o || typeof o !== "object") return;
        // the post object has the shortcode plus either media fields or a caption
        if (o.code === code && (o.video_versions || o.image_versions2 || o.carousel_media || o.caption !== undefined)) {
            post = o;
            return;
        }
        for (const k in o) walk(o[k]);
    })(blobs.flatMap(b => { try { return [JSON.parse(b)]; } catch { return []; } }));

    if (!post) throw new Error("post not found (private, deleted, or Meta changed the page)");

    const nodes = post.carousel_media?.length ? post.carousel_media : [post];
    const items = nodes.map(pickMedia).filter(Boolean);
    if (!items.length) throw new Error("post has no downloadable video or photo");

    return { code, user: post.user?.username, items };
}

// CLI
if (import.meta.url === new URL(process.argv[1], "file://").href || process.argv[1]?.endsWith("threads.mjs")) {
    const [url, dir = "."] = process.argv.slice(2);
    if (!url) { console.error("usage: node threads.mjs <threads post url> [output dir]"); process.exit(1); }
    try {
        const { code, items } = await getThreadsMedia(url);
        await mkdir(dir, { recursive: true });
        for (const [i, it] of items.entries()) {
            const buf = Buffer.from(await fetchRetry(it.url, { headers: { "user-agent": UA } }).then(r => r.arrayBuffer()));
            const name = `threads_${code}${items.length > 1 ? `_${i + 1}` : ""}.${it.ext}`;
            await writeFile(join(dir, name), buf);
            console.log(`saved ${name} (${it.type}, ${buf.length} bytes)`);
        }
    } catch (e) {
        console.error("error:", e.message);
        process.exit(1);
    }
}
