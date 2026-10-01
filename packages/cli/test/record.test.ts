import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { build } from "../src/build.js";
import { ConfigError, ConfigSchema } from "../src/config.js";
import { createFakeDriver, loadFakeScript } from "../src/generate/fakeDriver.js";
import { buildSrt, ffmpegArgs, findFfmpeg, recordGuide, RecordError, srtTime } from "../src/record.js";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
import { startServer, type TestServer } from "./helpers/server.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEMO = join(ROOT, "examples/demo-app");
const guideOf = (steps: Guide["steps"]): Guide => ({
  schemaVersion: 1, id: "g", languages: ["es"], title: { es: "G" }, startUrl: "/", steps,
  source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
});

describe("subtitles and ffmpeg arguments", () => {
  it("formats SRT times and cues", () => {
    expect(srtTime(3_723_456)).toBe("01:02:03,456");
    const srt = buildSrt(guideOf([{ narration: { es: "Uno." } }, { narration: { es: "Dos." } }]), "es", [{ index: 0, startMs: 1000 }, { index: 1, startMs: 4000 }], 7000);
    expect(srt).toBe("1\n00:00:01,000 --> 00:00:03,900\nUno.\n\n2\n00:00:04,000 --> 00:00:06,900\nDos.\n");
  });

  it("places every narration at its offset and normalizes loudness", () => {
    const args = ffmpegArgs({ video: "v.webm", audios: [{ file: "a.mp3", offsetMs: 1500 }, { file: "b.mp3", offsetMs: 4200.4 }], out: "o.mp4" });
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("[1:a]adelay=1500:all=1[a0]");
    expect(graph).toContain("[2:a]adelay=4200:all=1[a1]");
    expect(graph).toContain("amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5,apad[aout]");
    expect(args).toEqual(expect.arrayContaining(["-map", "0:v", "[aout]", "libx264", "aac", "-shortest", "o.mp4"]));
  });

  it("explains how to install ffmpeg when it is missing", async () => {
    await expect(findFfmpeg("es", "ffmpeg-que-no-existe")).rejects.toBeInstanceOf(ConfigError);
    await expect(findFfmpeg("es", "ffmpeg-que-no-existe")).rejects.toThrow(/winget install Gyan\.FFmpeg/);
  });

  it("refuses to record a step without audio in that language", async () => {
    await expect(
      recordGuide({ guide: guideOf([{ narration: { es: "Sin audio." } }]), guidesRoot: ".", appUrl: "http://127.0.0.1:9", lang: "es", outDir: "." }),
    ).rejects.toThrow(RecordError);
  });
});

describe("recordGuide on the demo app", () => {
  let server: TestServer;
  beforeAll(async () => {
    execSync("npm run build -w @explicame/player", { cwd: ROOT, stdio: "pipe" });
    await viteBuild({ root: DEMO, logLevel: "silent" });
    server = await startServer(join(DEMO, "dist"));
  }, 180_000);
  afterAll(async () => {
    await server?.close();
  });

  it("produces an H.264 + AAC video and one subtitle per step", async () => {
    const out = await mkdtemp(join(tmpdir(), "explicame-rec-out-"));
    const home = await mkdtemp(join(tmpdir(), "explicame-rec-home-"));
    const config = ConfigSchema.parse({ appUrl: server.url, languages: ["es"], outputDir: out, voice: { provider: "fake" } });
    const script = await loadFakeScript(join(DEMO, "explicame.fake-script.json"));
    for (const turn of script.turns) for (const call of turn) {
      const narration = (call.input as { narration?: { es: string; en?: string } }).narration;
      if (narration) delete narration.en;
      const title = (call.input as { title?: { es: string; en?: string } }).title;
      if (title) delete title.en;
    }
    const { guide } = await build({ cwd: DEMO, config, credentials: {}, diffFile: "feature.patch", driver: createFakeDriver(script), voiceProviders: [createFakeVoiceProvider()], home });
    const result = await recordGuide({ guide, guidesRoot: out, appUrl: server.url, lang: "es", outDir: join(out, "videos") });

    expect(existsSync(result.video)).toBe(true);
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name:format=duration", "-of", "json", result.video], { encoding: "utf8" });
    const info = JSON.parse(probe) as { streams: { codec_name: string }[]; format: { duration: string } };
    expect(info.streams.map((s) => s.codec_name).sort()).toEqual(["aac", "h264"]);
    expect(Number(info.format.duration)).toBeGreaterThan(6);
    expect(readFileSync(result.subtitles, "utf8").match(/^\d+$/gm)).toEqual(["1", "2", "3", "4", "5", "6"]);
  }, 240_000);
});
