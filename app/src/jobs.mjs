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

export const isThreads = url => { try { return /^(www\.)?threads\.(com|net)$/.test(new URL(url).hostname); } catch { return false; } };

export function makeJobs({ tools, loadCore, outDir, onChange = () => {} }) {
    const jobs = new Map();
    let seq = 0;

    const set = (job, patch) => { Object.assign(job, patch); onChange(job); };

    async function runThreads(job) {
        const { core } = await loadCore();
        set(job, { status: "running", message: "Reading Threads post..." });
        const { code, items } = await core.getThreadsMedia(job.url);
        await mkdir(outDir, { recursive: true });
        job.title = `Threads ${code}`;
        for (const [i, it] of items.entries()) {
            set(job, { message: items.length > 1 ? `Downloading ${i + 1} of ${items.length}...` : "Downloading...", progress: Math.round(i / items.length * 100) });
            const res = await core.fetchRetry(it.url, { headers: { "user-agent": core.UA }, signal: job.abort.signal });
            const buf = Buffer.from(await res.arrayBuffer());
            const file = join(outDir, `threads_${code}${items.length > 1 ? `_${i + 1}` : ""}.${it.ext}`);
            await writeFile(file, buf);
            job.file = file;
        }
        set(job, { status: "done", progress: 100, message: items.length > 1 ? `${items.length} files saved` : "Saved" });
    }

    async function runYtdlp(job) {
        set(job, { status: "running", message: "Preparing..." });
        const note = message => set(job, { message });
        await tools.ensureYtdlp(note);
        const audio = job.kind === "audio";
        const ff = await tools.ensureFfmpeg(note, p => set(job, { progress: p }));
        set(job, { progress: 0, message: "Starting..." });
        await mkdir(outDir, { recursive: true });

        const args = [
            "--no-playlist", "--newline", "--no-warnings", "--progress",
            "--progress-template", "download:PROG %(progress._percent_str)s",
            "--print", "before_dl:TITLE %(title)s",
            "--print", "after_move:FILE %(filepath)s",
            "-P", outDir, "-o", "%(extractor)s_%(id)s.%(ext)s", "--ffmpeg-location", tools.exeDir,
        ];
        if (audio && ff) args.push("-x", "--audio-format", "mp3");
        else if (ff) args.push("-f", FORMATS[job.quality] || FORMATS.best, "--merge-output-format", "mp4");
        else args.push("-f", "b[ext=mp4]/b");
        const cookies = join(tools.exeDir, "cookies.txt");
        if (existsSync(cookies)) args.push("--cookies", cookies);
        args.push(job.url);

        let tail = [];
        let streams = 0;
        const code = await new Promise((resolve, reject) => {
            const p = tools.spawnYtdlp(args);
            job.kill = () => p.kill();
            p.on("error", reject);
            p.on("close", resolve);
            const onLine = line => {
                if (line.startsWith("TITLE ")) set(job, { title: line.slice(6), message: "Downloading..." });
                else if (line.startsWith("FILE ")) job.file = line.slice(5).trim();
                else if (line.startsWith("PROG ")) {
                    const pct = parseFloat(line.slice(5));
                    if (!isNaN(pct)) set(job, { progress: Math.min(99, Math.round(pct)) });
                } else if (/^\[(Merger|ExtractAudio|VideoConvertor)\]/.test(line)) set(job, { message: "Merging / converting...", progress: 99 });
                else if (/^\[download\] Destination/.test(line)) { streams++; if (streams > 1) set(job, { message: "Downloading audio..." }); }
                if (/^(ERROR|WARNING)/.test(line)) tail.push(line);
            };
            createInterface({ input: p.stdout }).on("line", onLine);
            createInterface({ input: p.stderr }).on("line", onLine);
        });

        if (job.cancelled) return;
        if (code !== 0) {
            const hint = tail.at(-1)?.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "") || "download failed";
            throw new Error(`${hint.slice(0, 220)} — if the site changed, press "Update"; private videos need cookies.txt next to the exe.`);
        }
        set(job, { status: "done", progress: 100, message: "Saved" });
    }

    return {
        add({ url, kind = "video", quality = "best" }) {
            url = String(url || "").trim();
            if (!/^https?:\/\//i.test(url)) throw new Error("That doesn't look like a link.");
            const job = { id: ++seq, url, kind, quality, status: "queued", progress: 0, message: "Queued", title: url, file: null, abort: new AbortController() };
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
