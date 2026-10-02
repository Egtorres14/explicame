// Renders video/out/explicame.<lang>.mp4: narration through explicame's own voice pipeline, the clip recorded by
// explicame on the demo app, frames captured one by one from the GSAP timeline, and the mix with ffmpeg.
//   npm run video -- [--lang es|en|all] [--voice piper|elevenlabs]
// ElevenLabs v4 needs ELEVENLABS_API_KEY, EXPLICAME_VIDEO_VOICE_ES and EXPLICAME_VIDEO_VOICE_EN; otherwise Piper.
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { chromium } from "playwright";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cli = join(root, "packages", "cli", "dist", "bin.js");
const { values } = parseArgs({
  options: {
    lang: { type: "string", default: "all" },
    voice: { type: "string" },
    fps: { type: "string", default: "30" },
    demo: { type: "string", default: join(root, "examples", "demo-app") },
  },
});
const langs = values.lang === "all" ? ["es", "en"] : [values.lang];
const fps = Number(values.fps);
const out = join(here, "out");
const script = JSON.parse(await readFile(join(here, "script.json"), "utf8"));
const elevenReady = Boolean(process.env.ELEVENLABS_API_KEY && process.env.EXPLICAME_VIDEO_VOICE_ES && process.env.EXPLICAME_VIDEO_VOICE_EN);
const voiceProvider = values.voice ?? (elevenReady ? "elevenlabs" : "piper");
if (voiceProvider === "elevenlabs" && !elevenReady) {
  throw new Error("ElevenLabs needs ELEVENLABS_API_KEY, EXPLICAME_VIDEO_VOICE_ES and EXPLICAME_VIDEO_VOICE_EN.");
}

const LEAD = 0.35;
const GAP = 0.45;
const PAD = 0.7;
/** The spec caps the video at 120 s; the clip ends at an earlier step when a language runs long. */
const LIMIT = 119.5;
const MIN = { intro: 9, flow: 14, safety: 6, modes: 9, demo: 2, outro: 6.5 };

async function seconds(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
}

/** Every chunk of the script becomes a narration-only step of a throwaway guide, voiced by `explicame voice`.
 * A chunk's es_say / en_say is what the voice reads when it must differ from the caption (how to say a name). */
async function narrate() {
  const project = await mkdtemp(join(tmpdir(), "explicame-video-"));
  const chunks = script.scenes.flatMap((scene) => scene.chunks);
  const voice =
    voiceProvider === "elevenlabs"
      ? { provider: "elevenlabs", model: "eleven_v4", voices: { es: process.env.EXPLICAME_VIDEO_VOICE_ES, en: process.env.EXPLICAME_VIDEO_VOICE_EN } }
      : { provider: "piper" };
  await writeFile(join(project, "explicame.config.json"), JSON.stringify({ languages: ["es", "en"], voice }));
  const dir = join(project, "public", "explicame", "video");
  await mkdir(dir, { recursive: true });
  const guide = {
    schemaVersion: 1, id: "video", languages: ["es", "en"], title: { es: "Video", en: "Video" }, startUrl: "/",
    steps: chunks.map((chunk) => ({ narration: { es: chunk.es_say ?? chunk.es, en: chunk.en_say ?? chunk.en } })),
    source: { base: "video", head: "video", commit: "video", generatedBy: "fake", createdAt: new Date().toISOString() },
  };
  await writeFile(join(dir, "guide.json"), JSON.stringify(guide));
  await run(process.execPath, [cli, "voice", "public/explicame/video/guide.json"], { cwd: project, maxBuffer: 16 * 1024 * 1024 });
  const voiced = JSON.parse(await readFile(join(dir, "guide.json"), "utf8"));
  for (const [i, step] of voiced.steps.entries()) {
    for (const lang of langs) if (!step.audio?.[lang]) throw new Error(`No ${lang} audio for chunk ${i + 1}: check the ${voiceProvider} voice.`);
  }
  return { dir, steps: voiced.steps };
}

function parseSrt(text) {
  const time = (value) => {
    const [h, m, rest] = value.split(":");
    const [s, ms] = rest.split(",");
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  return text
    .replace(/\r/g, "")
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const [index, range, ...lines] = block.split("\n");
      const [from, to] = range.split(" --> ");
      return { index: Number(index), start: time(from), end: time(to), text: lines.join(" ") };
    });
}

/** The demo clip recorded by explicame, cut before step `untilStep`: a VP8 copy for Chromium and its audio. */
async function prepareClip(lang, untilStep) {
  const base = join(values.demo, ".explicame", "videos", `${script.clip.guide}.${lang}`);
  if (!existsSync(`${base}.mp4`)) throw new Error(`Missing ${base}.mp4: record the demo guide first (video/README.md).`);
  const cues = parseSrt(await readFile(`${base}.srt`, "utf8"));
  const until = cues.find((cue) => cue.index === untilStep)?.start ?? (await seconds(`${base}.mp4`));
  const duration = Math.max(1, until - 0.25);
  await mkdir(join(here, "assets"), { recursive: true });
  const webm = join(here, "assets", `clip.${lang}.webm`);
  const wav = join(here, "assets", `clip.${lang}.wav`);
  await run("ffmpeg", ["-y", "-v", "error", "-i", `${base}.mp4`, "-t", String(duration), "-an", "-c:v", "libvpx", "-b:v", "6M", "-deadline", "realtime", "-cpu-used", "8", webm]);
  await run("ffmpeg", ["-y", "-v", "error", "-i", `${base}.mp4`, "-t", String(duration), "-vn", "-ac", "2", "-ar", "48000", wav]);
  return {
    src: `assets/clip.${lang}.webm`,
    wav,
    duration,
    cues: cues.filter((cue) => cue.start < duration).map((cue) => ({ start: cue.start, end: Math.min(cue.end, duration), text: cue.text })),
  };
}

async function timing(lang, narration, clip) {
  let t = 0;
  let k = 0;
  const scenes = [];
  for (const scene of script.scenes) {
    const start = t;
    let cursor = start + LEAD;
    const chunks = [];
    for (const chunk of scene.chunks) {
      const file = join(narration.dir, narration.steps[k].audio[lang]);
      const duration = await seconds(file);
      chunks.push({ start: cursor, end: cursor + duration, text: chunk[lang], file });
      cursor += duration + GAP;
      k += 1;
    }
    let end = Math.max(cursor - GAP + PAD, start + MIN[scene.id]);
    let sceneClip = null;
    if (scene.id === "demo") {
      const clipStart = end + 0.2;
      sceneClip = {
        src: clip.src,
        start: clipStart,
        duration: clip.duration,
        cues: clip.cues.map((cue) => ({ start: cue.start + clipStart, end: cue.end + clipStart, text: cue.text })),
      };
      end = clipStart + clip.duration + 0.9;
    }
    scenes.push({ id: scene.id, start, end, chunks, clip: sceneClip });
    t = end;
  }
  const flow = scenes.find((scene) => scene.id === "flow");
  return { lang, duration: t, scenes, panel: `assets/panel.${lang}.png`, poster: flow.chunks[2].start + 1.4 };
}

async function frames(plan, file) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${pathToFileURL(join(here, "index.html")).href}?lang=${plan.lang}`);
    const duration = await page.evaluate((p) => window.__setup(p), plan);
    const ffmpeg = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", file], { stdio: ["pipe", "inherit", "inherit"] });
    const closed = new Promise((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
    const total = Math.ceil(duration * fps);
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.__seek(t), i / fps);
      const jpeg = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
      if (i % (fps * 10) === 0) console.log(`${plan.lang}: ${Math.round((i / total) * 100)}%`);
    }
    ffmpeg.stdin.end();
    await closed;
    await page.evaluate((t) => window.__seek(t), plan.poster);
    await page.screenshot({ path: join(out, `poster.${plan.lang}.png`) });
  } finally {
    await browser.close();
  }
}

async function mix(plan, video, clipWav, file) {
  const inputs = [];
  const delays = [];
  for (const scene of plan.scenes) {
    for (const chunk of scene.chunks) {
      inputs.push(chunk.file);
      delays.push(chunk.start);
    }
    if (scene.clip) {
      inputs.push(clipWav);
      delays.push(scene.clip.start);
    }
  }
  const parts = inputs.map((_, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(delays[i] * 1000)}:all=1[a${i}]`);
  const graph = `${parts.join(";")};${inputs.map((_, i) => `[a${i}]`).join("")}amix=inputs=${inputs.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5,apad[aout]`;
  const args = ["-y", "-v", "error", "-i", video];
  for (const input of inputs) args.push("-i", input);
  args.push("-filter_complex", graph, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", file);
  await run("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
}

await mkdir(out, { recursive: true });
console.log(`narration: ${voiceProvider}`);
const narration = await narrate();
for (const lang of langs) {
  let untilStep = script.clip.untilStep;
  let clip = await prepareClip(lang, untilStep);
  let plan = await timing(lang, narration, clip);
  while (plan.duration > LIMIT && untilStep > 2) {
    untilStep -= 1;
    clip = await prepareClip(lang, untilStep);
    plan = await timing(lang, narration, clip);
  }
  console.log(`${lang}: clip until step ${untilStep}, ${plan.duration.toFixed(1)} s`);
  const silent = join(out, `.frames.${lang}.mp4`);
  await frames(plan, silent);
  const file = join(out, `explicame.${lang}.mp4`);
  await mix(plan, silent, clip.wav, file);
  await rm(silent, { force: true });
  console.log(`ready: ${file} (${(await seconds(file)).toFixed(1)} s)`);
}
