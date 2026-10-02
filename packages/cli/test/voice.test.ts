import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Guide } from "@explicame/core";
import { ConfigSchema } from "../src/config.js";
import { createDeepgramProvider } from "../src/voice/deepgram.js";
import { createElevenLabsProvider } from "../src/voice/elevenlabs.js";
import { createFakeVoiceProvider, silentMp3 } from "../src/voice/fake.js";
import { buildVoiceProviders } from "../src/voice/index.js";
import { createOpenAiProvider } from "../src/voice/openai.js";
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
    const voiced = await voiceGuide(guide(), { providers: [createFakeVoiceProvider()], guideDir: out, cacheDir: join(dir, "cache"), speed: 1 });
    expect(voiced.steps[1]!.audio).toEqual({ es: "audio/es/02.mp3", en: "audio/en/02.mp3" });
    expect(existsSync(join(out, "audio/en/01.mp3"))).toBe(true);
  });

  it("warns and leaves the step for the browser voice when nothing answers", async () => {
    const onWarn = vi.fn();
    const voiced = await voiceGuide(guide(), { providers: [failing()], guideDir: dir, cacheDir: join(dir, "cache"), speed: 1, retries: 1, sleep: noSleep, onWarn });
    expect(voiced.steps[0]!.audio).toBeUndefined();
    expect(onWarn).toHaveBeenCalledTimes(4);
    await voiceGuide(guide(), { providers: [failing()], guideDir: dir, cacheDir: join(dir, "cache"), speed: 1, retries: 1, sleep: noSleep, onWarn, lang: "es" });
    expect(onWarn).toHaveBeenLastCalledWith(expect.stringContaining("Ningún proveedor"));
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

const audioFetch = () => vi.fn(async () => new Response(new Uint8Array([7, 8]), { status: 200 }));
const callOf = (fetchImpl: ReturnType<typeof audioFetch>) => fetchImpl.mock.calls[0] as unknown as [string, RequestInit];

describe("more providers", () => {
  it("calls Deepgram Aura-2 with its own default voice per language and the speed", async () => {
    const fetchImpl = audioFetch();
    const provider = createDeepgramProvider({ apiKey: "dg_key", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(provider.voiceFor?.("es")).toBe("aura-2-celeste-es");
    expect([...(await provider.synthesize({ text: "Hola", lang: "es", voice: provider.voiceFor?.("es"), speed: 1.2 }))]).toEqual([7, 8]);
    const [url, init] = callOf(fetchImpl);
    expect(url).toBe("https://api.deepgram.com/v1/speak?model=aura-2-celeste-es&encoding=mp3&speed=1.2");
    expect((init.headers as Record<string, string>).Authorization).toBe("Token dg_key");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Hola" });
  });

  it("calls OpenAI speech with instructions in the narration's language, except for tts-1", async () => {
    const fetchImpl = audioFetch();
    const provider = createOpenAiProvider({ apiKey: "sk_key", fetchImpl: fetchImpl as unknown as typeof fetch });
    await provider.synthesize({ text: "Hola", lang: "es", voice: provider.voiceFor?.("es"), speed: 1 });
    const [url, init] = callOf(fetchImpl);
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_key");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-4o-mini-tts", input: "Hola", voice: "coral", response_format: "mp3", speed: 1, instructions: expect.stringContaining("español") });
    const legacy = audioFetch();
    await createOpenAiProvider({ apiKey: "k", model: "tts-1", fetchImpl: legacy as unknown as typeof fetch }).synthesize({ text: "Hi", lang: "en", speed: 1 });
    expect(JSON.parse(callOf(legacy)[1].body as string).instructions).toBeUndefined();
  });

  it("reports HTTP errors of Deepgram and OpenAI as VoiceError", async () => {
    const down = vi.fn(async () => new Response("quota", { status: 429 }));
    await expect(createDeepgramProvider({ apiKey: "k", fetchImpl: down as unknown as typeof fetch }).synthesize({ text: "x", lang: "en", speed: 1 })).rejects.toThrow(/Deepgram 429/);
    await expect(createOpenAiProvider({ apiKey: "k", fetchImpl: down as unknown as typeof fetch }).synthesize({ text: "x", lang: "en", speed: 1 })).rejects.toThrow(/OpenAI 429/);
  });

  it("gives the configured voices to the main provider only; fallbacks keep their own", () => {
    const config = ConfigSchema.parse({ voice: { provider: "elevenlabs", voices: { es: "eleven-es" }, model: "eleven_v4", fallback: ["deepgram", "openai", "elevenlabs"] } });
    const providers = buildVoiceProviders(config, { elevenlabs: "e", deepgram: "d", openai: "o" });
    expect(providers.map((p) => p.id)).toEqual(["elevenlabs", "deepgram", "openai"]);
    expect(providers.map((p) => p.voiceFor?.("es"))).toEqual(["eleven-es", "aura-2-celeste-es", "coral"]);
    expect(providers[2]!.model).toBe("gpt-4o-mini-tts");
  });

  it("skips providers without a key and ElevenLabs as a fallback", () => {
    const config = ConfigSchema.parse({ voice: { provider: "openai", fallback: ["elevenlabs", "deepgram"] } });
    expect(buildVoiceProviders(config, { openai: "o", elevenlabs: "e" }).map((p) => p.id)).toEqual(["openai"]);
  });

  it("asks each provider in the chain with its own voice", async () => {
    const asked: (string | undefined)[] = [];
    const down: VoiceProvider = { id: "a", model: "m", voiceFor: () => "voz-a", async synthesize(r) { asked.push(r.voice); throw new VoiceError("down"); } };
    const up: VoiceProvider = { id: "b", model: "m", voiceFor: () => "voz-b", async synthesize(r) { asked.push(r.voice); return silentMp3(1); } };
    await synthesizeWithCache([down, up], { text: "Hola", lang: "es", speed: 1 }, dir, 1, noSleep);
    expect(asked).toEqual(["voz-a", "voz-b"]);
  });
});
