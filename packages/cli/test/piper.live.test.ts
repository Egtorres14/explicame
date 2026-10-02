import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findFfmpeg } from "../src/ffmpeg.js";
import { createPiperProvider } from "../src/voice/piper.js";

// Real download (~120 MB the first time) and real synthesis. Opt in with EXPLICAME_LIVE_PIPER=1.
describe.skipIf(!process.env.EXPLICAME_LIVE_PIPER)("piper, for real", () => {
  it("speaks Spanish and English with the default voices", async () => {
    const provider = createPiperProvider({ home: process.env.EXPLICAME_HOME ?? join(homedir(), ".explicame"), ffmpeg: () => findFfmpeg("es"), log: console.log });
    const out = await mkdtemp(join(tmpdir(), "explicame-piper-live-"));
    for (const [lang, text] of [["es", "Aquí eliges el rango de fechas del reporte."], ["en", "Here you pick the date range of the report."]] as const) {
      const file = join(out, `${lang}.mp3`);
      await writeFile(file, await provider.synthesize({ text, lang, voice: provider.voiceFor?.(lang), speed: 1 }));
      const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
      expect(seconds).toBeGreaterThan(1);
    }
  }, 600_000);
});
