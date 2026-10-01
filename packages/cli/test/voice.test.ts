import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Guide } from "@explicame/core";
import { createElevenLabsProvider } from "../src/voice/elevenlabs.js";
import { createFakeVoiceProvider, silentMp3 } from "../src/voice/fake.js";
import { cacheKey, synthesizeWithCache, VoiceError, voiceGuide, type VoiceProvider } from "../src/voice/provider.js";

const noSleep = async () => {};
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "explicame-voice-"));
});

const failing = (): VoiceProvider & { calls: number } => {
  const p = { id: "down", model: "m", calls: 0, async synthesize(): Promise<Buffer> { p.calls++; throw new VoiceError("down"); } };
  return p;
};

describe("synthesizeWithCache", () => {
  it("retries, falls back to the next provider and serves repeats from the cache", async () => {
    const down = failing();
    const fake = createFakeVoiceProvider();
    const spy = vi.spyOn(fake, "synthesize");
    const request = { text: "Hola", lang: "es" as const, speed: 1 };
    const first = await synthesizeWithCache([down, fake], request, dir, 3, noSleep);
    expect(first.provider).toBe("fake");
    expect(down.calls).toBe(3);
    const again = await synthesizeWithCache([down, fake], request, dir, 3, noSleep);
    expect(again.audio.equals(first.audio)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(down.calls).toBe(3); // the cached fallback answered without retrying the dead primary
    expect(await readdir(dir)).toEqual([`${cacheKey(fake, request)}.mp3`]);
  });

  it("throws VoiceError when every provider fails", async () => {
    await expect(synthesizeWithCache([failing()], { text: "x", lang: "es", speed: 1 }, dir, 2, noSleep)).rejects.toBeInstanceOf(VoiceError);
  });

  it("changes the cache key when the text or voice changes", () => {
    const fake = createFakeVoiceProvider();
    const a = cacheKey(fake, { text: "Hola", lang: "es", speed: 1 });
    expect(cacheKey(fake, { text: "Hola.", lang: "es", speed: 1 })).not.toBe(a);
    expect(cacheKey(fake, { text: "Hola", lang: "es", speed: 1, voice: "v2" })).not.toBe(a);
  });
});

describe("voiceGuide", () => {
  const guide = (): Guide => ({
    schemaVersion: 1, id: "g", languages: ["es", "en"], title: { es: "G", en: "G" }, startUrl: "/",
    steps: [{ narration: { es: "Uno.", en: "One." } }, { narration: { es: "Dos.", en: "Two." } }],
    source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
  });

  it("writes one file per step and language and records the paths", async () => {
    const out = join(dir, "guide");
    const voiced = await voiceGuide(guide(), { providers: [createFakeVoiceProvider()], guideDir: out, cacheDir: join(dir, "cache"), voices: {}, speed: 1 });
    expect(voiced.steps[1]!.audio).toEqual({ es: "audio/es/02.mp3", en: "audio/en/02.mp3" });
    expect(existsSync(join(out, "audio/en/01.mp3"))).toBe(true);
  });

  it("warns and leaves the step for the browser voice when nothing answers", async () => {
    const onWarn = vi.fn();
    const voiced = await voiceGuide(guide(), { providers: [failing()], guideDir: dir, cacheDir: join(dir, "cache"), voices: {}, speed: 1, retries: 1, sleep: noSleep, onWarn });
    expect(voiced.steps[0]!.audio).toBeUndefined();
    expect(onWarn).toHaveBeenCalledTimes(4);
  });
});

describe("providers", () => {
  it("fake audio is a sequence of valid silent MP3 frames", () => {
    const audio = silentMp3(1);
    expect(audio.length % 417).toBe(0);
    expect([audio[0], audio[1]]).toEqual([0xff, 0xfb]);
  });

  it("calls ElevenLabs with the model, language and voice", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const provider = createElevenLabsProvider({ apiKey: "el_key", fetchImpl: fetchImpl as unknown as typeof fetch });
    const audio = await provider.synthesize({ text: "Hola", lang: "es", voice: "voice123", speed: 1 });
    expect([...audio]).toEqual([1, 2, 3]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("el_key");
    expect(JSON.parse(init.body as string)).toMatchObject({ text: "Hola", model_id: "eleven_v4", language_code: "es" });
  });

  it("ElevenLabs needs a voice and reports HTTP errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad key", { status: 401 }));
    const provider = createElevenLabsProvider({ apiKey: "x", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.synthesize({ text: "Hola", lang: "es", speed: 1 })).rejects.toBeInstanceOf(VoiceError);
    await expect(provider.synthesize({ text: "Hola", lang: "es", voice: "v", speed: 1 })).rejects.toThrow(/401/);
  });
});
