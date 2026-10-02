import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { t, type Guide, type Lang, type LocalizedText, type Step } from "@explicame/core";
import { throwIfCancelled } from "../cancel.js";

export interface VoiceRequest {
  text: string;
  lang: Lang;
  voice?: string;
  speed: number;
}

export interface VoiceProvider {
  readonly id: string;
  readonly model: string;
  /** The voice this provider speaks with in a language: the configured one for the main provider, its own default otherwise. */
  voiceFor?(lang: Lang): string | undefined;
  synthesize(request: VoiceRequest): Promise<Buffer>;
}

export class VoiceError extends Error {
  /** False for refusals that would fail the same way again (no build for this system, missing voice id, bad key). */
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = "VoiceError";
    this.retryable = retryable;
  }
}

/** Rate limits, timeouts and server errors are worth another try; other HTTP errors are not. */
export const retryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500;

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
  // Each provider speaks with its own voice: a fallback never receives the main provider's voice ids.
  const askFor = (provider: VoiceProvider): VoiceRequest => ({ ...request, voice: provider.voiceFor?.(request.lang) ?? request.voice });
  // The main provider answers first, from its cache or the network: switching providers changes the voice even when the
  // old one stays as a fallback with audio cached. A fallback only answers when every provider before it failed.
  const errors: string[] = [];
  let retryable = false;
  for (const provider of providers) {
    const ask = askFor(provider);
    const file = join(cacheDir, `${cacheKey(provider, ask)}.mp3`);
    try {
      return { audio: await readFile(file), provider: provider.id };
    } catch {
      // not cached for this provider
    }
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const audio = await provider.synthesize(ask);
        await mkdir(cacheDir, { recursive: true });
        await writeFile(file, audio);
        return { audio, provider: provider.id };
      } catch (error) {
        errors.push(`${provider.id}: ${(error as Error).message}`);
        const again = !(error instanceof VoiceError) || error.retryable;
        if (!again) break;
        retryable = true;
        if (attempt < retries - 1) await sleep(500 * 2 ** attempt);
      }
    }
  }
  throw new VoiceError(errors.length ? errors.join(" | ") : "no voice provider configured", retryable);
}

export interface VoiceGuideOptions {
  providers: VoiceProvider[];
  guideDir: string;
  cacheDir: string;
  speed: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  onWarn?: (message: string) => void;
  /** Language of the warnings for the person running the CLI. */
  lang?: Lang;
  /** Stops voicing between steps (the panel's Stop button). */
  signal?: AbortSignal;
}

export async function voiceGuide(guide: Guide, o: VoiceGuideOptions): Promise<Guide> {
  const steps: Step[] = [];
  let unavailable = false;
  for (const [index, step] of guide.steps.entries()) {
    throwIfCancelled(o.signal, o.lang ?? "en");
    const audio: LocalizedText = {};
    for (const lang of guide.languages) {
      const text = step.narration[lang];
      if (!text || unavailable) continue;
      try {
        const result = await synthesizeWithCache(o.providers, { text, lang, speed: o.speed }, o.cacheDir, o.retries ?? 3, o.sleep);
        const relative = `audio/${lang}/${String(index + 1).padStart(2, "0")}.mp3`;
        const file = join(o.guideDir, relative);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, result.audio);
        audio[lang] = relative;
      } catch (error) {
        if (!(error instanceof VoiceError)) throw error;
        if (error.retryable) {
          o.onWarn?.(t(o.lang ?? "en", "voice.allFailed", { index: index + 1, lang, error: error.message.slice(0, 300) }));
        } else {
          // The same refusal would repeat on every step: say why once and leave the rest to the browser voice.
          unavailable = true;
          o.onWarn?.(t(o.lang ?? "en", "voice.gaveUp", { error: error.message.slice(0, 400) }));
        }
      }
    }
    steps.push(Object.keys(audio).length ? { ...step, audio } : step);
  }
  return { ...guide, steps };
}
