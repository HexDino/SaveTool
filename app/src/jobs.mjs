// Job manager: one job = one pasted link. Threads uses core.mjs, everything else yt-dlp.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const FORMATS = {
    best: "bv*+ba/b",
    "1080": "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
    "720": "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
    "480": "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b",
};

// browsers yt-dlp can read login cookies from
const BROWSERS = ["chrome", "edge", "firefox", "brave"];

const isYoutube = url => { try { return /(^|\.)(youtube\.com|youtu\.be)$/.test(new URL(url).hostname); } catch { return false; } };

export const isThreads = url => { try { return /^(www\.)?threads\.(com|net)$/.test(new URL(url).hostname); } catch { return false; } };

// outDir: folder path, or a function returning it (read when a job is added, so the user can change it)
export function makeJobs({ tools, loadCore, outDir, onChange = () => {} }) {
    const jobs = new Map();
    let seq = 0;

    const set = (job, patch) => { Object.assign(job, patch); onChange(job); };

    async function runThreads(job) {
        const { core } = await loadCore();
        set(job, { status: "running", message: "Reading Threads post..." });
        const { code, items } = await core.getThreadsMedia(job.url);
        await mkdir(job.outDir, { recursive: true });
        job.title = `Threads ${code}`;
        for (const [i, it] of items.entries()) {
            set(job, { message: items.length > 1 ? `Downloading ${i + 1} of ${items.length}...` : "Downloading...", progress: Math.round(i / items.length * 100) });
            const res = await core.fetchRetry(it.url, { headers: { "user-agent": core.UA }, signal: job.abort.signal });
            const buf = Buffer.from(await res.arrayBuffer());
            const file = join(job.outDir, `threads_${code}${items.length > 1 ? `_${i + 1}` : ""}.${it.ext}`);
            await writeFile(file, buf);
            job.file = file;
        }
        set(job, { status: "done", progress: 100, message: items.length > 1 ? `${items.length} files saved` : "Saved" });
    }

    async function runYtdlp(job) {
        set(job, { status: "running", message: "Preparing..." });
        const note = message => set(job, { message });
        await tools.ensureYtdlp(note);
        await tools.pending(); // an auto-update may be replacing yt-dlp.exe right now
        const audio = job.kind === "audio";
        const ff = await tools.ensureFfmpeg(note, p => set(job, { progress: p }));
        const deno = isYoutube(job.url) && await tools.ensureDeno(note, p => set(job, { progress: p }));
        set(job, { progress: 0, message: "Starting..." });
        await mkdir(job.outDir, { recursive: true });

        const args = [
            job.playlist ? "--yes-playlist" : "--no-playlist", "--newline", "--no-warnings", "--progress",
            "--progress-template", "download:PROG %(progress._percent_str)s",
            "--print", "before_dl:TITLE %(title)s",
            "--print", "before_dl:ITEM %(playlist_index|)s/%(n_entries|)s %(playlist_title|)s",
            "--print", "after_move:FILE %(filepath)s",
            "-P", job.outDir, "--ffmpeg-location", tools.exeDir,
            "-o", job.playlist
                ? "%(playlist_title,extractor)s/%(playlist_index|)s%(playlist_index& - |)s%(title).100B [%(id)s].%(ext)s"
                : "%(extractor)s_%(id)s.%(ext)s",
        ];
        if (audio && ff) args.push("-x", "--audio-format", "mp3");
        else if (ff) args.push("-f", FORMATS[job.quality] || FORMATS.best, "--merge-output-format", "mp4");
        else args.push("-f", "b[ext=mp4]/b");
        if (deno) args.push("--js-runtimes", `deno:${tools.DENO}`);
        const cookieFile = join(tools.exeDir, "cookies.txt");
        if (BROWSERS.includes(job.cookies)) args.push("--cookies-from-browser", job.cookies);
        else if (job.cookies !== "none" && existsSync(cookieFile)) args.push("--cookies", cookieFile);
        args.push(job.url);

        let r = await runOnce(job, args);
        // yt-dlp breaks when sites change: if it failed, update it once and try again.
        if (r.code !== 0 && !r.saved && !job.cancelled) {
            set(job, { message: "Failed - checking for a yt-dlp update...", progress: 0 });
            const u = await tools.update().catch(() => ({ updated: false }));
            if (u.updated && !job.cancelled) {
                set(job, { message: "yt-dlp updated, retrying..." });
                r = await runOnce(job, args);
            }
        }

        if (job.cancelled) return;
        if (r.code !== 0 && !r.saved) {
            let hint = r.tail.at(-1)?.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "") || "download failed";
            hint = hint.slice(0, 220);
            const extra = /cookie/i.test(r.tail.join(" "))
                ? "Close the browser and try again (Chrome/Edge lock their cookie file), or pick Firefox / cookies.txt."
                : "private videos need login cookies (pick your browser in the Login option).";
            throw new Error(`${hint} - ${extra}`);
        }
        const partial = r.code !== 0;
        set(job, {
            status: "done", progress: 100,
            message: r.saved > 1 ? `${r.saved} files saved${partial ? " (some items failed)" : ""}` : "Saved",
        });
    }

    // one yt-dlp run; reports progress on the job, resolves {code, tail, saved}
    async function runOnce(job, args) {
        const tail = [];
        let streams = 0, idx = 0, total = 0, saved = 0;
        const status = () => total > 1 ? `Item ${idx} of ${total}: ` : "";
        const code = await new Promise((resolve, reject) => {
            const p = tools.spawnYtdlp(args);
            job.kill = () => p.kill();
            p.on("error", reject);
            p.on("close", resolve);
            const onLine = line => {
                if (line.startsWith("ITEM ")) {
                    const m = line.match(/^ITEM (\d*)\/(\d*) ?(.*)$/);
                    if (m) {
                        idx = +m[1] || 1; total = +m[2] || 0; streams = 0;
                        if (total > 1 && m[3]) set(job, { title: `Playlist: ${m[3]}` });
                    }
                } else if (line.startsWith("TITLE ")) {
                    const title = line.slice(6);
                    set(job, { ...(total > 1 ? {} : { title }), message: `${status()}Downloading${total > 1 ? " " + title : "..."}` });
                } else if (line.startsWith("FILE ")) { job.file = line.slice(5).trim(); saved++; }
                else if (line.startsWith("PROG ")) {
                    const pct = parseFloat(line.slice(5));
                    if (!isNaN(pct)) set(job, { progress: Math.min(99, Math.round(total > 1 ? ((idx - 1 + pct / 100) / total) * 100 : pct)) });
                } else if (/^\[(Merger|ExtractAudio|VideoConvertor)\]/.test(line)) set(job, { message: `${status()}Merging / converting...`, ...(total > 1 ? {} : { progress: 99 }) });
                else if (/^\[download\] Destination/.test(line)) { streams++; if (streams > 1) set(job, { message: `${status()}Downloading audio...` }); }
                if (/^(ERROR|WARNING)/.test(line)) tail.push(line);
            };
            createInterface({ input: p.stdout }).on("line", onLine);
            createInterface({ input: p.stderr }).on("line", onLine);
        });
        return { code, tail, saved };
    }

    return {
        add({ url, kind = "video", quality = "best", cookies = "auto", playlist = false }) {
            url = String(url || "").trim();
            if (!/^https?:\/\//i.test(url)) throw new Error("That doesn't look like a link.");
            const job = { id: ++seq, outDir: typeof outDir === "function" ? outDir() : outDir, url, kind, quality, cookies: String(cookies), playlist: !!playlist, status: "queued", progress: 0, message: "Queued", title: url, file: null, abort: new AbortController() };
            jobs.set(job.id, job);
            onChange(job);
            (isThreads(url) ? runThreads : runYtdlp)(job).catch(e => {
                if (!job.cancelled) set(job, { status: "error", message: e.message });
            });
            return job;
        },
        cancel(id) {
            const j = jobs.get(id);
            if (!j || !["queued", "running"].includes(j.status)) return;
            j.cancelled = true; j.abort.abort(); j.kill?.();
            set(j, { status: "cancelled", message: "Cancelled" });
        },
        remove(id) { jobs.delete(id); },
        get: id => jobs.get(id),
        list: () => [...jobs.values()].reverse().map(({ abort, kill, ...j }) => j),
        active: () => [...jobs.values()].some(j => j.status === "queued" || j.status === "running"),
    };
}
