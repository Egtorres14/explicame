import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { t, type Guide, type Lang, type LocalizedText, type Step } from "@explicame/core";

export interface VoiceRequest {
  text: string;
  lang: Lang;
  voice?: string;
  speed: number;
}

export interface VoiceProvider {
  readonly id: string;
  readonly model: string;
  synthesize(request: VoiceRequest): Promise<Buffer>;
}

export class VoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function cacheKey(provider: VoiceProvider, r: VoiceRequest): string {
  return createHash("sha256").update([provider.id, provider.model, r.voice ?? "", r.lang, String(r.speed), r.text].join("|")).digest("hex");
}

export async function synthesizeWithCache(
  providers: VoiceProvider[],
  request: VoiceRequest,
  cacheDir: string,
  retries = 3,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<{ audio: Buffer; provider: string }> {
  // Any provider's cached audio wins before a single network call, so a cached fallback never waits on a dead primary.
  for (const provider of providers) {
    try {
      return { audio: await readFile(join(cacheDir, `${cacheKey(provider, request)}.mp3`)), provider: provider.id };
    } catch {
      // not cached for this provider
    }
  }
  const errors: string[] = [];
  for (const provider of providers) {
    const file = join(cacheDir, `${cacheKey(provider, request)}.mp3`);
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const audio = await provider.synthesize(request);
        await mkdir(cacheDir, { recursive: true });
        await writeFile(file, audio);
        return { audio, provider: provider.id };
      } catch (error) {
        errors.push(`${provider.id}: ${(error as Error).message}`);
        if (attempt < retries - 1) await sleep(500 * 2 ** attempt);
      }
    }
  }
  throw new VoiceError(errors.length ? errors.join(" | ") : "no voice provider configured");
}

export interface VoiceGuideOptions {
  providers: VoiceProvider[];
  guideDir: string;
  cacheDir: string;
  voices: LocalizedText;
  speed: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  onWarn?: (message: string) => void;
}

export async function voiceGuide(guide: Guide, o: VoiceGuideOptions): Promise<Guide> {
  const steps: Step[] = [];
  for (const [index, step] of guide.steps.entries()) {
    const audio: LocalizedText = {};
    for (const lang of guide.languages) {
      const text = step.narration[lang];
      if (!text) continue;
      try {
        const result = await synthesizeWithCache(o.providers, { text, lang, voice: o.voices[lang], speed: o.speed }, o.cacheDir, o.retries ?? 3, o.sleep);
        const relative = `audio/${lang}/${String(index + 1).padStart(2, "0")}.mp3`;
        const file = join(o.guideDir, relative);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, result.audio);
        audio[lang] = relative;
      } catch (error) {
        if (!(error instanceof VoiceError)) throw error;
        o.onWarn?.(t("en", "voice.allFailed", { index: index + 1, lang }));
      }
    }
    steps.push(Object.keys(audio).length ? { ...step, audio } : step);
  }
  return { ...guide, steps };
}
