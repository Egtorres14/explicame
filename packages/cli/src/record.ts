import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { t, type AllowRule, type Guide, type Lang } from "@explicame/core";
import { openSession } from "./browser/session.js";
import { ConfigError } from "./config.js";
import { playerBundlePath } from "./player.js";

const run = promisify(execFile);
const TAIL_MS = 1200;

export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordError";
  }
}

export interface StepTiming {
  index: number;
  startMs: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function srtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(Math.floor(ms % 1000), 3)}`;
}

/** One cue per narration: it lasts until 100 ms before the next one (or the end). */
export function buildSrt(guide: Guide, lang: Lang, timings: StepTiming[], endMs: number): string {
  return timings
    .map((timing, i) => {
      const next = timings[i + 1]?.startMs ?? endMs;
      const end = Math.max(timing.startMs + 500, next - 100);
      return `${i + 1}\n${srtTime(timing.startMs)} --> ${srtTime(end)}\n${guide.steps[timing.index]?.narration[lang] ?? ""}\n`;
    })
    .join("\n");
}

export function ffmpegArgs(o: { video: string; audios: { file: string; offsetMs: number }[]; out: string }): string[] {
  const delays = o.audios.map((a, i) => `[${i + 1}:a]adelay=${Math.round(a.offsetMs)}:all=1[a${i}]`);
  const mix = `${o.audios.map((_, i) => `[a${i}]`).join("")}amix=inputs=${o.audios.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5,apad[aout]`;
  return [
    "-y", "-i", o.video, ...o.audios.flatMap((a) => ["-i", a.file]),
    "-filter_complex", [...delays, mix].join(";"),
    "-map", "0:v", "-map", "[aout]",
    "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", o.out,
  ];
}

export async function findFfmpeg(lang: Lang, candidate = "ffmpeg"): Promise<string> {
  try {
    await run(candidate, ["-version"]);
    return candidate;
  } catch {
    throw new ConfigError(t(lang, "record.noFfmpeg"));
  }
}

export interface RecordOptions {
  guide: Guide;
  /** Folder that contains <id>/guide.json and its audio (the build output root). */
  guidesRoot: string;
  appUrl: string;
  lang: Lang;
  outDir: string;
  allowRequests?: AllowRule[];
  storageStatePath?: string;
  uiLang?: Lang;
  ffmpeg?: string;
}

/** Plays the guide with the real player in record mode, films it and mixes each narration at its moment. */
export async function recordGuide(o: RecordOptions): Promise<{ video: string; subtitles: string; durationMs: number }> {
  const uiLang = o.uiLang ?? "es";
  const missing = o.guide.steps.findIndex((step) => !step.audio?.[o.lang]);
  if (missing >= 0) throw new RecordError(t(uiLang, "record.noAudio", { index: missing + 1, lang: o.lang }));
  const ffmpeg = await findFfmpeg(uiLang, o.ffmpeg);
  const videoDir = await mkdtemp(join(tmpdir(), "explicame-video-"));
  const events: { type: string; index?: number; at: number }[] = [];
  const session = await openSession({
    appUrl: o.appUrl,
    startUrl: o.guide.startUrl,
    allowRequests: o.allowRequests,
    storageStatePath: o.storageStatePath,
    lang: uiLang,
    viewport: { width: 1920, height: 1080 },
    recordVideoDir: videoDir,
    launchArgs: ["--autoplay-policy=no-user-gesture-required"],
    beforePage: async (context) => {
      await context.exposeBinding("__explicameRecordEvent", (_source, event: { type: string; index?: number }) => {
        events.push({ ...event, at: Date.now() });
      });
      await context.route("**/__explicame__/**", (route) => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/__explicame__\//, ""));
        return route.fulfill({ path: join(o.guidesRoot, relative) });
      });
    },
  });
  let closed = false;
  try {
    await session.page.addScriptTag({ path: playerBundlePath() });
    await session.page.evaluate(
      async ({ id, lang }) => {
        const api = (window as unknown as { Explicame: { mount(o: object): void; play(id: string, o: object): Promise<boolean> } }).Explicame;
        api.mount({ base: "/__explicame__", button: false, lang, record: true });
        return api.play(id, { lang });
      },
      { id: o.guide.id, lang: o.lang },
    );
    await session.page.waitForTimeout(TAIL_MS);
    const video = session.page.video();
    await session.close();
    closed = true;
    if (!video) throw new RecordError("Playwright did not record a video.");
    const raw = await video.path();
    const t0 = session.createdAt;
    const timings: StepTiming[] = events.filter((e) => e.type === "narration").map((e) => ({ index: e.index ?? 0, startMs: e.at - t0 }));
    const endMs = (events.find((e) => e.type === "end")?.at ?? Date.now()) - t0 + TAIL_MS;
    await mkdir(o.outDir, { recursive: true });
    const base = join(o.outDir, `${o.guide.id}.${o.lang}`);
    const audios = timings.map((timing) => ({
      file: join(o.guidesRoot, o.guide.id, o.guide.steps[timing.index]!.audio![o.lang]!),
      offsetMs: timing.startMs,
    }));
    await run(ffmpeg, ffmpegArgs({ video: raw, audios, out: `${base}.mp4` }), { maxBuffer: 64 * 1024 * 1024 });
    await writeFile(`${base}.srt`, buildSrt(o.guide, o.lang, timings, endMs));
    return { video: `${base}.mp4`, subtitles: `${base}.srt`, durationMs: endMs };
  } finally {
    if (!closed) await session.close().catch(() => {});
    await rm(videoDir, { recursive: true, force: true });
  }
}
