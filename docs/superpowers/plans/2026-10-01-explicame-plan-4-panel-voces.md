# explicame — Plan 4: voces y panel local

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar las voces del spec (Deepgram, OpenAI, Piper gratis y local, comando propio, voz del navegador, clonación de ElevenLabs con consentimiento) y el panel local bilingüe (`explicame panel`) desde el que se configura todo, se guardan las claves sin mostrarlas nunca completas y se genera la guía con avance en vivo, capturas, vista previa y descarga.

**Architecture:** Cada proveedor de voz recibe al construirse sus propias voces (las configuradas si es el principal, las suyas por defecto si es de respaldo) y las expone con `voiceFor(lang)`; la caché y los reintentos no cambian. Lo que entrega WAV (Piper, comando) pasa a MP3 con el ffmpeg del sistema. El panel es un servidor HTTP de la CLI, solo en `127.0.0.1`, con token aleatorio por sesión, comprobación del `Host`, API JSON, trabajos de generación con eventos SSE y archivos servidos sin salir de sus carpetas; su interfaz es TypeScript sin framework (paquete `@explicame/panel`, construido con Vite).

**Tech Stack:** las versiones de los planes 1–3; Vite (ya en el repo) para el panel; Piper y ffmpeg del sistema para las voces locales.

**Spec:** `docs/superpowers/specs/2026-10-01-explicame-design.md` (§9 voz, §10 panel, configuración y secretos, §11 errores)

**Decisiones frente al spec (se registran como rulings al ejecutar):**
- `voice.voices` y `voice.model` son del proveedor principal; los de respaldo usan sus voces y modelos por defecto (el spec tiene un único `voice.voices` y pasarle un id de ElevenLabs a Deepgram falla siempre).
- ElevenLabs solo entra como proveedor principal: sin ids de voz configurados no puede hablar, así que como respaldo nunca serviría.
- La vista previa de la guía en el panel es la lista de pasos con su audio y el video grabado; reproducirla dentro de la app es el trabajo del reproductor.

## Global Constraints

- Las de los planes 1–3 siguen vigentes (Node ≥ 20, TS 5.9.3, ESM, imports con `.js`, textos por i18n, nada escribe en la app, commits a nombre del autor).
- El panel solo escucha en `127.0.0.1`, exige el token de la sesión en la URL y en cada petición, rechaza cualquier `Host` que no sea `127.0.0.1:<puerto>` o `localhost:<puerto>`, y nunca devuelve una clave completa: solo «configurada ✓» y los últimos 4 caracteres.
- Los secretos viven en variables de entorno o en `~/.explicame/credentials.json` (permisos 0600); `explicame.config.json` sigue sin aceptar claves.
- La clonación de voz de ElevenLabs exige la casilla de consentimiento explícito, y el servidor lo comprueba además de la interfaz.
- El texto de la narración nunca pasa por una shell: `voice.command` se ejecuta sin shell y cada marcador es un argumento.
- Interfaz del panel en ES y EN; puerto por defecto 4747.

## Review Focus

1. **Otra página del navegador intenta usar el panel** (DNS rebinding, peticiones sin token): `Host` ajeno → 403, sin token → 401. Prueba en la Tarea 5.
2. **Una clave que se escapa** a la página, a un log o a una respuesta: ninguna respuesta del panel contiene la clave completa. Prueba en la Tarea 5.
3. **Narraciones con caracteres de shell** (`"; rm -rf ~ &`) en `voice.command`: llegan intactas como texto y no se ejecuta nada. Prueba en la Tarea 2.
4. **Un proveedor de respaldo con las voces del principal**: cada proveedor habla con su voz. Prueba en la Tarea 1.
5. **Rutas de archivo que salen de su carpeta** (`/files/output/..%2f..%2f.env`): 404. Prueba en la Tarea 5.

## Mapa de archivos

```
packages/cli/src/voice/provider.ts     voiceFor por proveedor; sin voices en VoiceGuideOptions
packages/cli/src/voice/deepgram.ts     Deepgram Aura-2
packages/cli/src/voice/openai.ts       OpenAI gpt-4o-mini-tts
packages/cli/src/voice/command.ts      comando propio sin shell
packages/cli/src/voice/piper.ts        Piper: descarga del motor y las voces, síntesis
packages/cli/src/voice/elevenlabs.ts   + voces por proveedor y clonación con consentimiento
packages/cli/src/voice/index.ts        cadena principal + respaldos
packages/cli/src/ffmpeg.ts             findFfmpeg (movido de record.ts) y toMp3
packages/cli/src/record.ts             + recordLanguages (movido de cli.ts)
packages/cli/src/generate/loop.ts      + afterStep
packages/cli/src/build.ts              + onShot; la voz del navegador no genera audio
packages/cli/src/config.ts             + voice.command, saveConfig
packages/cli/src/credentials.ts        + saveCredential, describeCredentials
packages/cli/src/version.ts            VERSION
packages/cli/src/panel/server.ts       servidor del panel
packages/panel/                        interfaz del panel (Vite)
```

---

### Task 1: Voces por proveedor, Deepgram y OpenAI

**Files:**
- Modify: `packages/cli/src/voice/provider.ts`, `packages/cli/src/voice/fake.ts`, `packages/cli/src/voice/elevenlabs.ts`, `packages/cli/src/voice/index.ts`, `packages/cli/src/build.ts`, `packages/cli/src/cli.ts`
- Create: `packages/cli/src/voice/deepgram.ts`, `packages/cli/src/voice/openai.ts`
- Test: `packages/cli/test/voice.test.ts`

**Interfaces:**
- Consumes: `VoiceProvider`, `VoiceRequest`, `synthesizeWithCache`, `voiceGuide` (plan 1); `Config`, `Credentials`.
- Produces: `VoiceProvider.voiceFor?(lang): string | undefined`; `VoiceGuideOptions` sin `voices`; `createElevenLabsProvider({ apiKey, model?, voices?, fetchImpl? })`; `createDeepgramProvider({ apiKey, voices?, fetchImpl? })` con `DEEPGRAM_VOICES = { es: "aura-2-celeste-es", en: "aura-2-thalia-en" }`; `createOpenAiProvider({ apiKey, model?, voices?, fetchImpl? })` con `OPENAI_VOICE = "coral"`; `buildVoiceProviders(config, creds, o?: { home?: string })`.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `packages/cli/test/voice.test.ts`:
- agregar a los imports `import { ConfigSchema } from "../src/config.js";`, `import { createDeepgramProvider } from "../src/voice/deepgram.js";`, `import { buildVoiceProviders } from "../src/voice/index.js";` y `import { createOpenAiProvider } from "../src/voice/openai.js";`;
- quitar `voices: {}, ` de las tres llamadas a `voiceGuide` (la opción desaparece);
- agregar al final:

```ts
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
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/voice.test.ts`
Expected: FAIL — `Cannot find module '../src/voice/deepgram.js'`.

- [ ] **Step 3: Cada proveedor con su voz**

En `packages/cli/src/voice/provider.ts`:
- en `VoiceProvider`, después de `readonly model: string;`, agregar:

```ts
  /** The voice this provider speaks with in a language: the configured one for the main provider, its own default otherwise. */
  voiceFor?(lang: Lang): string | undefined;
```

- en `synthesizeWithCache`, reemplazar el cuerpo por:

```ts
  // Each provider speaks with its own voice: a fallback never receives the main provider's voice ids.
  const askFor = (provider: VoiceProvider): VoiceRequest => ({ ...request, voice: provider.voiceFor?.(request.lang) ?? request.voice });
  // Any provider's cached audio wins before a single network call, so a cached fallback never waits on a dead primary.
  for (const provider of providers) {
    try {
      return { audio: await readFile(join(cacheDir, `${cacheKey(provider, askFor(provider))}.mp3`)), provider: provider.id };
    } catch {
      // not cached for this provider
    }
  }
  const errors: string[] = [];
  for (const provider of providers) {
    const ask = askFor(provider);
    const file = join(cacheDir, `${cacheKey(provider, ask)}.mp3`);
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const audio = await provider.synthesize(ask);
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
```

- en `VoiceGuideOptions`, borrar la línea `  voices: LocalizedText;`;
- en `voiceGuide`, cambiar `{ text, lang, voice: o.voices[lang], speed: o.speed }` por `{ text, lang, speed: o.speed }`;
- si `LocalizedText` queda sin uso en el import, quitarlo de ahí solo si el typecheck lo marca (sigue usándose en `voiceGuide` para `audio`).

En `packages/cli/src/voice/fake.ts`, dentro del objeto que devuelve `createFakeVoiceProvider`, después de `model: "silence",` agregar `voiceFor: () => undefined,`.

En `packages/cli/src/voice/elevenlabs.ts`:
- el import pasa a `import type { LocalizedText } from "@explicame/core";` más el existente de `./provider.js`;
- la firma pasa a `createElevenLabsProvider(o: { apiKey: string; model?: string; voices?: LocalizedText; fetchImpl?: typeof fetch }): VoiceProvider`;
- después de `model,` agregar `voiceFor: (lang) => o.voices?.[lang],`.

En `packages/cli/src/build.ts` (en `publish`) y en `packages/cli/src/cli.ts` (comando `voice`), borrar `voices: o.config.voice.voices, ` y `voices: config.voice.voices, ` de las opciones de `voiceGuide`.

- [ ] **Step 4: Deepgram y OpenAI**

`packages/cli/src/voice/deepgram.ts`:
```ts
import type { Lang, LocalizedText } from "@explicame/core";
import { VoiceError, type VoiceProvider } from "./provider.js";

/** Aura-2 voices used when none is configured: a Colombian Spanish voice and a US English one. */
export const DEEPGRAM_VOICES: Record<Lang, string> = { es: "aura-2-celeste-es", en: "aura-2-thalia-en" };

export function createDeepgramProvider(o: { apiKey: string; voices?: LocalizedText; fetchImpl?: typeof fetch }): VoiceProvider {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    id: "deepgram",
    model: "aura-2",
    voiceFor: (lang) => o.voices?.[lang] ?? DEEPGRAM_VOICES[lang],
    async synthesize(request) {
      const params = new URLSearchParams({ model: request.voice ?? DEEPGRAM_VOICES[request.lang], encoding: "mp3" });
      if (request.speed !== 1) params.set("speed", String(request.speed));
      const response = await doFetch(`https://api.deepgram.com/v1/speak?${params}`, {
        method: "POST",
        headers: { Authorization: `Token ${o.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: request.text }),
      });
      if (!response.ok) throw new VoiceError(`Deepgram ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
```

`packages/cli/src/voice/openai.ts`:
```ts
import type { Lang, LocalizedText } from "@explicame/core";
import { VoiceError, type VoiceProvider } from "./provider.js";

export const OPENAI_VOICE = "coral";

/** gpt-4o-mini-tts follows instructions about accent and tone; tts-1 and tts-1-hd do not accept them. */
const INSTRUCTIONS: Record<Lang, string> = {
  es: "Habla en español latinoamericano neutro, con tono cálido, claro y profesional, como quien enseña a usar una aplicación.",
  en: "Speak in clear, friendly American English, like someone showing a colleague how to use an app.",
};

export function createOpenAiProvider(o: { apiKey: string; model?: string; voices?: LocalizedText; fetchImpl?: typeof fetch }): VoiceProvider {
  const model = o.model ?? "gpt-4o-mini-tts";
  const doFetch = o.fetchImpl ?? fetch;
  return {
    id: "openai",
    model,
    voiceFor: (lang) => o.voices?.[lang] ?? OPENAI_VOICE,
    async synthesize(request) {
      const body: Record<string, unknown> = {
        model,
        input: request.text,
        voice: request.voice ?? OPENAI_VOICE,
        response_format: "mp3",
        speed: request.speed,
      };
      if (!model.startsWith("tts-1")) body.instructions = INSTRUCTIONS[request.lang];
      const response = await doFetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new VoiceError(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
```

`packages/cli/src/voice/index.ts`:
```ts
import type { Config } from "../config.js";
import type { Credentials } from "../credentials.js";
import { createDeepgramProvider } from "./deepgram.js";
import { createElevenLabsProvider } from "./elevenlabs.js";
import { createFakeVoiceProvider } from "./fake.js";
import { createOpenAiProvider } from "./openai.js";
import type { VoiceProvider } from "./provider.js";

/**
 * The main provider first, then the fallbacks. The configured voices and model belong to the main provider:
 * fallbacks speak with their own defaults. ElevenLabs only works with configured voice ids, so it never
 * serves as a fallback.
 */
// o.home is where Piper keeps its engine and voices (Task 3).
export function buildVoiceProviders(config: Config, creds: Credentials, o: { home?: string } = {}): VoiceProvider[] {
  const ids = [config.voice.provider, ...config.voice.fallback.filter((id) => id !== config.voice.provider)];
  const providers: VoiceProvider[] = [];
  for (const id of ids) {
    const main = id === config.voice.provider;
    const voices = main ? config.voice.voices : {};
    const model = main ? config.voice.model : undefined;
    if (id === "fake") providers.push(createFakeVoiceProvider());
    if (id === "elevenlabs" && main && creds.elevenlabs) providers.push(createElevenLabsProvider({ apiKey: creds.elevenlabs, model, voices }));
    if (id === "deepgram" && creds.deepgram) providers.push(createDeepgramProvider({ apiKey: creds.deepgram, voices }));
    if (id === "openai" && creds.openai) providers.push(createOpenAiProvider({ apiKey: creds.openai, model, voices }));
  }
  return providers;
}
```

- [ ] **Step 5: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/voice.test.ts`
Expected: PASS (todas, incluidas las de caché, `voiceGuide` y ElevenLabs).

- [ ] **Step 6: Suite y tipos**

Run: `npm test && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/voice packages/cli/src/build.ts packages/cli/src/cli.ts packages/cli/test/voice.test.ts
git commit -m "feat(voz): Deepgram y OpenAI, y cada proveedor de respaldo habla con su propia voz"
```

---

### Task 2: Comando propio, voz del navegador, ffmpeg compartido y clonación con consentimiento

**Files:**
- Create: `packages/cli/src/ffmpeg.ts`, `packages/cli/src/voice/command.ts`
- Modify: `packages/cli/src/record.ts`, `packages/cli/src/config.ts`, `packages/cli/src/voice/index.ts`, `packages/cli/src/voice/elevenlabs.ts`, `packages/cli/src/build.ts`, `packages/core/src/i18n.ts`
- Test: `packages/cli/test/command.test.ts`, `packages/cli/test/build.test.ts`, `packages/cli/test/voice.test.ts`

**Interfaces:**
- Consumes: `VoiceProvider` con `voiceFor` (Tarea 1); `findFfmpeg` de `record.ts` (plan 2).
- Produces: `findFfmpeg(lang, candidate?)` y `toMp3(input, output, ffmpeg): Promise<Buffer>` en `ffmpeg.ts` (`record.ts` reexporta `findFfmpeg`); `splitCommand(template): string[]`; `createCommandProvider({ template, voices?, ffmpeg: () => Promise<string>, timeoutMs? })`; `voice.command?: string` en la configuración; `cloneElevenLabsVoice({ apiKey, name, files, consent, fetchImpl? }): Promise<string>`; clave i18n `voice.browser`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`packages/cli/test/command.test.ts`:
```ts
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findFfmpeg } from "../src/ffmpeg.js";
import { createCommandProvider, splitCommand } from "../src/voice/command.js";
import { VoiceError } from "../src/voice/provider.js";

let dir: string;
let script: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "explicame-cmd-"));
  script = join(dir, "tts.mjs");
  // A stand-in TTS: copies the text and its arguments next to it and writes a short WAV (or an MP3 with --mp3).
  await writeFile(
    script,
    `import { readFileSync, writeFileSync } from "node:fs";
const [textFile, out, lang, voice, raw] = process.argv.slice(2);
writeFileSync(${JSON.stringify(join(dir, "seen.json"))}, JSON.stringify({ text: readFileSync(textFile, "utf8"), lang, voice, raw }));
if (process.argv.includes("--mp3")) { writeFileSync(out, Buffer.from([0xff, 0xfb, 0x90, 0xc0])); process.exit(0); }
const samples = 8000, data = Buffer.alloc(samples * 2), h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32);
h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
writeFileSync(out, Buffer.concat([h, data]));
`,
  );
});

const template = (extra = "") => `"${process.execPath}" "${script}" {textFile} {out} {lang} {voice} {text}${extra}`;

describe("splitCommand", () => {
  it("splits like a shell, honoring quotes, without running one", () => {
    expect(splitCommand(`kokoro "my voice" 'a b' {out}`)).toEqual(["kokoro", "my voice", "a b", "{out}"]);
    expect(() => splitCommand(`tts "open`)).toThrow(VoiceError);
  });
});

describe("command provider", () => {
  it("passes the narration as one argument and converts the WAV to MP3", async () => {
    const provider = createCommandProvider({ template: template(), voices: { es: "dave" }, ffmpeg: () => findFfmpeg("es") });
    const text = `Hola "; rm -rf ~ & echo pwned > ${join(dir, "pwned.txt")}`;
    const audio = await provider.synthesize({ text, lang: "es", voice: provider.voiceFor?.("es"), speed: 1 });
    expect(audio.subarray(0, 3).toString("latin1") === "ID3" || (audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0)).toBe(true);
    expect(JSON.parse(await readFile(join(dir, "seen.json"), "utf8"))).toEqual({ text, lang: "es", voice: "dave", raw: text });
    expect(existsSync(join(dir, "pwned.txt"))).toBe(false);
  });

  it("takes an MP3 written to {outMp3} as it is", async () => {
    const provider = createCommandProvider({ template: `"${process.execPath}" "${script}" {textFile} {outMp3} {lang} {voice} x --mp3`, ffmpeg: () => findFfmpeg("es") });
    expect([...(await provider.synthesize({ text: "Hola", lang: "es", speed: 1 }))]).toEqual([0xff, 0xfb, 0x90, 0xc0]);
  });

  it("changes its cache identity with the template and reports failures", async () => {
    const a = createCommandProvider({ template: template(), ffmpeg: () => findFfmpeg("es") });
    const b = createCommandProvider({ template: template(" extra"), ffmpeg: () => findFfmpeg("es") });
    expect(a.model).not.toBe(b.model);
    const broken = createCommandProvider({ template: `"${process.execPath}" -e "process.exit(3)"`, ffmpeg: () => findFfmpeg("es") });
    await expect(broken.synthesize({ text: "x", lang: "es", speed: 1 })).rejects.toThrow(/voice.command/);
  });
});
```

En `packages/cli/test/voice.test.ts`, agregar `import { cloneElevenLabsVoice } from "../src/voice/elevenlabs.js";` (o sumar `cloneElevenLabsVoice` al import existente de `elevenlabs.js`) y al final:

```ts
describe("ElevenLabs voice cloning", () => {
  const files = [{ name: "muestra.mp3", data: Buffer.from([1, 2, 3]) }];

  it("refuses to clone without explicit consent", async () => {
    const fetchImpl = vi.fn();
    await expect(cloneElevenLabsVoice({ apiKey: "k", name: "Gabriel", files, consent: false, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/consent/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uploads the recordings and returns the new voice id", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ voice_id: "cloned123", requires_verification: false }));
    expect(await cloneElevenLabsVoice({ apiKey: "el", name: "Gabriel", files, consent: true, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("cloned123");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/voices/add");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("el");
    const form = init.body as FormData;
    expect(form.get("name")).toBe("Gabriel");
    expect(form.getAll("files")).toHaveLength(1);
  });
});
```

En `packages/cli/test/build.test.ts`, dentro de `describe("build --from-guide", ...)`:

```ts
  it("leaves the narration to the browser voice without generating audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explicame-browser-voice-"));
    await writeFile(join(dir, "guide.json"), JSON.stringify(verified()));
    const logs: string[] = [];
    const config = ConfigSchema.parse({ outputDir: "public/explicame", voice: { provider: "browser" } });
    const result = await build({ cwd: dir, config, credentials: {}, fromGuide: "guide.json", home, log: (m) => logs.push(m) });
    expect(result.guide.steps[0]!.audio).toBeUndefined();
    expect(existsSync(join(dir, "public", "explicame", "filtro-por-fecha", "audio"))).toBe(false);
    expect(logs).toContain("Voz del navegador: la guía se narrará con la voz del sistema de quien la vea. Para el MP4 elige otro proveedor.");
  });
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/command.test.ts packages/cli/test/voice.test.ts packages/cli/test/build.test.ts`
Expected: FAIL — `Cannot find module '../src/ffmpeg.js'`, `cloneElevenLabsVoice is not a function` y la prueba de la voz del navegador (no está el aviso).

- [ ] **Step 3: ffmpeg compartido**

`packages/cli/src/ffmpeg.ts`:
```ts
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { t, type Lang } from "@explicame/core";
import { ConfigError } from "./config.js";

const run = promisify(execFile);

/** The ffmpeg to use, or a ConfigError that says how to install it on each system. */
export async function findFfmpeg(lang: Lang, candidate = "ffmpeg"): Promise<string> {
  try {
    await run(candidate, ["-version"]);
    return candidate;
  } catch {
    throw new ConfigError(t(lang, "record.noFfmpeg"));
  }
}

/** Encodes any audio ffmpeg reads (a WAV from Piper or a local TTS) as the MP3 the guide and the video use. */
export async function toMp3(input: string, output: string, ffmpeg: string): Promise<Buffer> {
  await run(ffmpeg, ["-y", "-v", "error", "-i", input, "-codec:a", "libmp3lame", "-q:a", "4", output]);
  return readFile(output);
}
```

En `packages/cli/src/record.ts`, borrar la función `findFfmpeg` y agregar después de los imports:

```ts
import { findFfmpeg } from "./ffmpeg.js";

export { findFfmpeg };
```

(si `ConfigError` deja de usarse en `record.ts`, quitarlo del import).

- [ ] **Step 4: El comando propio**

`packages/cli/src/voice/command.ts`:
```ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LocalizedText } from "@explicame/core";
import { toMp3 } from "../ffmpeg.js";
import { VoiceError, type VoiceProvider } from "./provider.js";

const run = promisify(execFile);

/** Splits a command template into arguments like a shell would, honoring "double" and 'single' quotes, without running one. */
export function splitCommand(template: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (const ch of template) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) throw new VoiceError(`voice.command has an unclosed quote: ${template}`);
  if (started) args.push(current);
  return args;
}

/**
 * Any local TTS (Kokoro, Coqui, …) through voice.command. Placeholders: {text}, {textFile}, {lang}, {voice},
 * {speed}, {out} (a .wav path) and {outMp3} (a .mp3 path). No shell runs: every placeholder becomes part of one
 * argument, so a narration can never be read as a command.
 */
export function createCommandProvider(o: { template: string; voices?: LocalizedText; ffmpeg: () => Promise<string>; timeoutMs?: number }): VoiceProvider {
  const parts = splitCommand(o.template);
  if (parts.length === 0) throw new VoiceError("voice.command is empty");
  return {
    id: "command",
    model: createHash("sha256").update(o.template).digest("hex").slice(0, 12),
    voiceFor: (lang) => o.voices?.[lang],
    async synthesize(request) {
      const dir = await mkdtemp(join(tmpdir(), "explicame-tts-"));
      try {
        const textFile = join(dir, "text.txt");
        const out = join(dir, "voice.wav");
        const outMp3 = join(dir, "voice.mp3");
        await writeFile(textFile, request.text, "utf8");
        const values: Record<string, string> = {
          text: request.text, textFile, lang: request.lang, voice: request.voice ?? "", speed: String(request.speed), out, outMp3,
        };
        const [file, ...args] = parts.map((part) => part.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match));
        try {
          await run(file!, args, { timeout: o.timeoutMs ?? 120_000, windowsHide: true });
        } catch (error) {
          throw new VoiceError(`voice.command failed: ${((error as Error).message.split("\n")[0] ?? "").slice(0, 200)}`);
        }
        if (existsSync(outMp3)) return await readFile(outMp3);
        if (existsSync(out)) return await toMp3(out, join(dir, "converted.mp3"), await o.ffmpeg());
        throw new VoiceError("voice.command wrote neither {out} nor {outMp3}");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
```

En `packages/cli/src/config.ts`, dentro del objeto `voice`, después de `fallback: ...,` agregar:

```ts
      /** Local TTS command for provider "command", e.g. "kokoro {textFile} {out} --voice {voice}". */
      command: z.string().min(1).optional(),
```

En `packages/cli/src/voice/index.ts`, agregar los imports `import { findFfmpeg } from "../ffmpeg.js";` y `import { createCommandProvider } from "./command.js";`, y dentro del `for`, después de la línea de OpenAI:

```ts
    if (id === "command" && config.voice.command) {
      providers.push(createCommandProvider({ template: config.voice.command, voices, ffmpeg: () => findFfmpeg(config.uiLanguage) }));
    }
```

- [ ] **Step 5: La voz del navegador**

En `packages/core/src/i18n.ts`, en `es` antes de `"voice.noProvider"`:

```ts
  "voice.browser": "Voz del navegador: la guía se narrará con la voz del sistema de quien la vea. Para el MP4 elige otro proveedor.",
```

y en `en` antes de `"voice.noProvider"`:

```ts
  "voice.browser": "Browser voice: the guide will be narrated with the viewer's system voice. Pick another provider for the MP4.",
```

En `packages/cli/src/build.ts`, en `publish`, reemplazar el bloque `if (o.voice !== false) { ... }` por:

```ts
  if (o.voice !== false) {
    const providers = o.voiceProviders ?? buildVoiceProviders(o.config, o.credentials, { home });
    if (providers.length === 0) {
      // Without audio files the player narrates with speechSynthesis; record asks for real audio.
      log(t(lang, o.config.voice.provider === "browser" ? "voice.browser" : "voice.noProvider"));
    } else {
      guide = await voiceGuide(guide, {
        providers, guideDir: dir, cacheDir: join(home, "cache", "voice"),
        speed: o.config.voice.speed, onWarn: log, lang,
      });
    }
  }
```

- [ ] **Step 6: Clonación con consentimiento**

Al final de `packages/cli/src/voice/elevenlabs.ts`:

```ts
/**
 * Instant Voice Clone from recordings of the person who trains. Only with their explicit consent (spec §9):
 * the panel shows the checkbox and this function refuses without it.
 */
export async function cloneElevenLabsVoice(o: {
  apiKey: string;
  name: string;
  files: { name: string; data: Buffer }[];
  consent: boolean;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  if (o.consent !== true) throw new VoiceError("Cloning a voice needs the explicit consent of the person whose voice it is.");
  if (o.files.length === 0) throw new VoiceError("Cloning a voice needs at least one recording.");
  const form = new FormData();
  form.append("name", o.name);
  form.append("remove_background_noise", "true");
  for (const file of o.files) form.append("files", new Blob([new Uint8Array(file.data)]), file.name);
  const response = await (o.fetchImpl ?? fetch)("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": o.apiKey },
    body: form,
  });
  if (!response.ok) throw new VoiceError(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return ((await response.json()) as { voice_id: string }).voice_id;
}
```

- [ ] **Step 7: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/command.test.ts packages/cli/test/voice.test.ts packages/cli/test/build.test.ts packages/cli/test/record.test.ts`
Expected: PASS (el grabador sigue encontrando ffmpeg por el reexport).

- [ ] **Step 8: Suite y tipos**

Run: `npm test && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/ffmpeg.ts packages/cli/src/record.ts packages/cli/src/config.ts packages/cli/src/voice packages/cli/src/build.ts packages/core/src/i18n.ts packages/cli/test/command.test.ts packages/cli/test/voice.test.ts packages/cli/test/build.test.ts
git commit -m "feat(voz): comando propio sin shell, voz del navegador y clonación de ElevenLabs con consentimiento"
```

---

### Task 3: Piper, gratis y local

**Files:**
- Create: `packages/cli/src/voice/piper.ts`
- Modify: `packages/cli/src/voice/index.ts`, `packages/cli/src/build.ts`, `packages/core/src/i18n.ts`
- Test: `packages/cli/test/piper.test.ts`, `packages/cli/test/piper.live.test.ts` (solo con `EXPLICAME_LIVE_PIPER=1`)

**Interfaces:**
- Consumes: `VoiceProvider` con `voiceFor` (Tarea 1); `toMp3`, `findFfmpeg` (Tarea 2); `explicameHome`.
- Produces: `PIPER_RELEASE`; `piperAsset(platform, arch): PiperAsset`; `PIPER_VOICES = { es: "es_ES-carlfm-x_low", en: "en_US-ljspeech-medium" }`; `piperVoiceUrls(name)`; `download(url, dest, { sha256?, fetchImpl? })`; `ensurePiperEngine(o)`; `ensurePiperVoice(o)`; `createPiperProvider(o)`; `buildVoiceProviders(config, creds, o?: { home?: string; log?: (message: string) => void })`; claves i18n `piper.engine` y `piper.voice`.

Hechos verificados (investigación del 2026-10-01, ver ledger):
- Piper ya no publica ejecutables: los últimos son los de `rhasspy/piper` `2023.11.14-2` (MIT, con espeak-ng GPL-3.0 dentro). Funcionan en Windows x64 (necesitan el runtime de Visual C++ 2015–2022) y Linux x86_64/aarch64 (glibc ≥ 2.29). Los de macOS vienen sin sus bibliotecas y no arrancan: en macOS se pide el proveedor `command`.
- La release no publica sumas: estas son las SHA-256 calculadas al descargarlas: Windows `f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea`, Linux x86_64 `a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992`, Linux aarch64 `fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb`. Cada archivo trae una carpeta `piper/` con el ejecutable y `espeak-ng-data/`.
- Voces de `rhasspy/piper-voices` en la revisión fija `c10ece1aade47bb51c153c893d14e5bf8e5b7117`. Por licencia: `en_US-ljspeech-medium` es de dominio público; ninguna voz española de calidad media tiene una cadena limpia (todas parten de `lessac`, de licencia solo para investigación), y la única limpia es `es_ES-carlfm-x_low` (dominio público, entrenada desde cero, 16 kHz). Esas dos son las de por defecto; `es_MX-ald-medium` y `es_ES-davefx-medium` se pueden elegir y se documenta la advertencia.
- Piper 2023 lee el texto de stdin hasta EOF, escribe WAV con `--output_file`, `--length_scale` > 1 es más lento, y en Windows rompe las rutas con caracteres no ASCII: se ejecuta con `cwd` en su carpeta y argumentos relativos ASCII.

- [ ] **Step 1: Escribir las pruebas que fallan**

`packages/cli/test/piper.test.ts`:
```ts
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findFfmpeg } from "../src/ffmpeg.js";
import { download, ensurePiperEngine, createPiperProvider, piperAsset, piperVoiceUrls, PIPER_VOICES, type PiperRunner } from "../src/voice/piper.js";
import { VoiceError } from "../src/voice/provider.js";

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const respond = (data: Uint8Array | string) => vi.fn(async () => new Response(typeof data === "string" ? data : new Uint8Array(data)));

/** One second of silent 16-bit mono WAV, like Piper writes. */
function wav(): Buffer {
  const data = Buffer.alloc(16000 * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("piper downloads", () => {
  it("picks the checked build for Windows and Linux and sends macOS to the command provider", () => {
    expect(piperAsset("win32", "x64")).toEqual({ file: "piper_windows_amd64.zip", sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea", exe: "piper.exe" });
    expect(piperAsset("linux", "x64").file).toBe("piper_linux_x86_64.tar.gz");
    expect(piperAsset("linux", "arm64").file).toBe("piper_linux_aarch64.tar.gz");
    expect(() => piperAsset("darwin", "arm64")).toThrow(/command/);
  });

  it("finds catalog voices at the pinned revision and knows the checked ones", () => {
    expect(PIPER_VOICES).toEqual({ es: "es_ES-carlfm-x_low", en: "en_US-ljspeech-medium" });
    const ald = piperVoiceUrls("es_MX-ald-medium");
    expect(ald.onnx).toBe("https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/es/es_MX/ald/medium/es_MX-ald-medium.onnx");
    expect(ald.json).toBe(`${ald.onnx}.json`);
    expect(ald.sha256).toBe("019b3803293c93e34a206dd2e53a3889209a514e786fd7144f7b70196c579b63");
    expect(piperVoiceUrls("pt_BR-faber-medium").sha256).toBeUndefined();
    expect(() => piperVoiceUrls("../../evil")).toThrow(VoiceError);
  });

  it("keeps a download only when its SHA-256 matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explicame-dl-"));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await download("https://x/ok.bin", join(dir, "ok.bin"), { sha256: sha(bytes), fetchImpl: respond(bytes) as unknown as typeof fetch });
    expect([...(await readFile(join(dir, "ok.bin")))]).toEqual([1, 2, 3, 4]);
    await expect(download("https://x/bad.bin", join(dir, "bad.bin"), { sha256: "0".repeat(64), fetchImpl: respond(bytes) as unknown as typeof fetch })).rejects.toThrow(/SHA-256/);
    expect(readdirSync(dir)).toEqual(["ok.bin"]);
  });

  it("installs the engine once, without the Arabic-only model", async () => {
    const home = await mkdtemp(join(tmpdir(), "explicame-piper-home-"));
    const archive = new Uint8Array([9, 9, 9]);
    const fetchImpl = respond(archive);
    const extract = vi.fn(async (_archive: string, dir: string) => {
      await mkdir(join(dir, "piper", "espeak-ng-data"), { recursive: true });
      await writeFile(join(dir, "piper", "piper.exe"), "stub");
      await writeFile(join(dir, "piper", "libtashkeel_model.ort"), "arabic");
    });
    const asset = { file: "piper_test.zip", sha256: sha(archive), exe: "piper.exe" };
    const first = await ensurePiperEngine({ home, asset, fetchImpl: fetchImpl as unknown as typeof fetch, extract });
    expect(first.exe).toBe(join(home, "piper", "2023.11.14-2", "piper", "piper.exe"));
    expect(existsSync(join(first.dir, "libtashkeel_model.ort"))).toBe(false);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_test.zip");
    await ensurePiperEngine({ home, asset, fetchImpl: fetchImpl as unknown as typeof fetch, extract });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("piper provider", () => {
  async function provider(run: PiperRunner) {
    const home = await mkdtemp(join(tmpdir(), "explicame-piper-run-"));
    const archive = new Uint8Array([7]);
    const fetchImpl = vi.fn(async (url: string) => new Response(url.endsWith(".zip") ? archive : "{}"));
    return createPiperProvider({
      home,
      voices: { es: "es_ES-prueba-medium" },
      ffmpeg: () => findFfmpeg("es"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      asset: { file: "piper_test.zip", sha256: sha(archive), exe: "piper.exe" },
      extract: async (_archive, dir) => {
        await mkdir(join(dir, "piper"), { recursive: true });
        await writeFile(join(dir, "piper", "piper.exe"), "stub");
      },
      run,
    });
  }

  it("runs Piper from its own folder with relative arguments and returns MP3", async () => {
    let seen: { args: string[]; cwd: string; input: string } | undefined;
    const p = await provider(async (_exe, args, o) => {
      seen = { args, cwd: o.cwd, input: o.input };
      await writeFile(join(o.cwd, args[args.indexOf("--output_file") + 1]!), wav());
    });
    expect(p.voiceFor?.("es")).toBe("es_ES-prueba-medium");
    expect(p.voiceFor?.("en")).toBe("en_US-ljspeech-medium");
    const audio = await p.synthesize({ text: "Hola, José", lang: "es", voice: "es_ES-prueba-medium", speed: 1.25 });
    expect(audio.subarray(0, 3).toString("latin1") === "ID3" || audio[0] === 0xff).toBe(true);
    expect(seen!.input).toBe("Hola, José");
    expect(seen!.args.slice(0, 4)).toEqual(["--model", "voices/es_ES-prueba-medium.onnx", "--config", "voices/es_ES-prueba-medium.onnx.json"]);
    expect(seen!.args).toEqual(expect.arrayContaining(["--length_scale", "0.8", "--espeak_data", "espeak-ng-data"]));
    expect(seen!.args[seen!.args.indexOf("--output_file") + 1]).toMatch(/^out-[0-9a-f]+\.wav$/);
    expect(readdirSync(seen!.cwd).filter((file) => file.startsWith("out-"))).toEqual([]);
  });

  it("explains the missing Visual C++ runtime on Windows", async () => {
    const p = await provider(async () => {
      throw Object.assign(new Error("exit"), { code: 3221225781 });
    });
    await expect(p.synthesize({ text: "Hola", lang: "es", speed: 1 })).rejects.toThrow(/vc_redist\.x64\.exe/);
  });
});
```

`packages/cli/test/piper.live.test.ts`:
```ts
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
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/piper.test.ts`
Expected: FAIL — `Cannot find module '../src/voice/piper.js'`.

- [ ] **Step 3: Implementar Piper**

`packages/cli/src/voice/piper.ts`:
```ts
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { once } from "node:events";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { t, type Lang, type LocalizedText } from "@explicame/core";
import { toMp3 } from "../ffmpeg.js";
import { VoiceError, type VoiceProvider } from "./provider.js";

const run = promisify(execFile);

/** The last standalone Piper builds (MIT; espeak-ng inside is GPL-3.0 and runs as a separate program). */
export const PIPER_RELEASE = "2023.11.14-2";
const ENGINE_BASE = `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}`;
const VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117";

export interface PiperAsset {
  file: string;
  sha256: string;
  exe: string;
}

/** The checked build for this system. The macOS builds ship without their libraries and never start. */
export function piperAsset(platform: NodeJS.Platform, arch: string): PiperAsset {
  if (platform === "win32" && arch === "x64") {
    return { file: "piper_windows_amd64.zip", sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea", exe: "piper.exe" };
  }
  if (platform === "linux" && arch === "x64") {
    return { file: "piper_linux_x86_64.tar.gz", sha256: "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992", exe: "piper" };
  }
  if (platform === "linux" && arch === "arm64") {
    return { file: "piper_linux_aarch64.tar.gz", sha256: "fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb", exe: "piper" };
  }
  throw new VoiceError(`Piper has no working build for ${platform}/${arch}: use voice.provider "command" with Piper for Python (pip install piper-tts), or a cloud voice.`);
}

/** Default voices with a clean license chain: LJ Speech is public domain; carlfm was trained from scratch on public-domain data. */
export const PIPER_VOICES: Record<Lang, string> = { es: "es_ES-carlfm-x_low", en: "en_US-ljspeech-medium" };

/** SHA-256 of the .onnx of the voices checked for this release (X-Linked-ETag at the pinned revision). */
const CHECKED_VOICES: Record<string, string> = {
  "en_US-ljspeech-medium": "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22",
  "es_ES-carlfm-x_low": "d69677323a907cd4963f42b29c20a98b5d6bfa7f3e64df339915e4650c00d125",
  "es_MX-ald-medium": "019b3803293c93e34a206dd2e53a3889209a514e786fd7144f7b70196c579b63",
  "es_ES-davefx-medium": "6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917",
};

/** Where a catalog voice lives: "es_MX-ald-medium" → es/es_MX/ald/medium/es_MX-ald-medium.onnx at the pinned revision. */
export function piperVoiceUrls(name: string): { onnx: string; json: string; sha256?: string } {
  const match = /^([a-z]{2,3})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$/.exec(name);
  if (!match) throw new VoiceError(`"${name}" is not a Piper voice name such as es_MX-ald-medium.`);
  const [, family, region, speaker, quality] = match;
  const onnx = `${VOICES_BASE}/${family}/${family}_${region}/${speaker}/${quality}/${name}.onnx`;
  return { onnx, json: `${onnx}.json`, sha256: CHECKED_VOICES[name] };
}

/** Downloads through a temporary file and keeps it only when its SHA-256 matches (when one is known). */
export async function download(url: string, dest: string, o: { sha256?: string; fetchImpl?: typeof fetch } = {}): Promise<void> {
  const response = await (o.fetchImpl ?? fetch)(url);
  if (!response.ok || !response.body) throw new VoiceError(`Download failed (${response.status}): ${url}`);
  const partial = `${dest}.${randomBytes(4).toString("hex")}.part`;
  const hash = createHash("sha256");
  const file = createWriteStream(partial);
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      if (!file.write(chunk)) await once(file, "drain");
    }
    file.end();
    await finished(file);
    const digest = hash.digest("hex");
    if (o.sha256 && digest !== o.sha256) throw new VoiceError(`The download of ${url} does not match its SHA-256 (got ${digest}).`);
    await rename(partial, dest);
  } catch (error) {
    file.destroy();
    throw error;
  } finally {
    await rm(partial, { force: true });
  }
}

async function extractArchive(archive: string, dir: string): Promise<void> {
  // Windows 10+ ships bsdtar, which also reads .zip; a tar from Git or MSYS earlier on PATH would not.
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  await run(tar, ["-xf", archive, "-C", dir]);
}

const inFlight = new Map<string, Promise<unknown>>();
/** One download per path at a time, even when several steps ask for it together. */
function single<T>(key: string, task: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = task().finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

export interface EngineOptions {
  home: string;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Test seams. */
  asset?: PiperAsset;
  fetchImpl?: typeof fetch;
  extract?: (archive: string, dir: string) => Promise<void>;
  log?: (message: string) => void;
  lang?: Lang;
}

/** Installs the engine once into <home>/piper/<release>/piper and returns its folder and executable. */
export async function ensurePiperEngine(o: EngineOptions): Promise<{ dir: string; exe: string }> {
  const asset = o.asset ?? piperAsset(o.platform ?? process.platform, o.arch ?? process.arch);
  const root = join(o.home, "piper", PIPER_RELEASE);
  const dir = join(root, "piper");
  const exe = join(dir, asset.exe);
  if (existsSync(exe)) return { dir, exe };
  return single(root, async () => {
    o.log?.(t(o.lang ?? "es", "piper.engine", { release: PIPER_RELEASE, dir: root }));
    await mkdir(root, { recursive: true });
    const staging = await mkdtemp(join(root, "staging-"));
    try {
      const archive = join(staging, asset.file);
      await download(`${ENGINE_BASE}/${asset.file}`, archive, { sha256: asset.sha256, fetchImpl: o.fetchImpl });
      await (o.extract ?? extractArchive)(archive, staging);
      if (!existsSync(join(staging, "piper", asset.exe))) throw new VoiceError("The Piper archive does not contain its executable.");
      await rm(join(staging, "piper", "libtashkeel_model.ort"), { force: true }); // Arabic-only model, 10 MB
      await rename(join(staging, "piper"), dir).catch((error: unknown) => {
        if (!existsSync(exe)) throw error;
      });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return { dir, exe };
  });
}

/** Downloads a catalog voice once into the engine's voices/ folder; returns its path relative to the engine. */
export async function ensurePiperVoice(o: { engineDir: string; name: string; fetchImpl?: typeof fetch; log?: (message: string) => void; lang?: Lang }): Promise<string> {
  const relative = `voices/${o.name}.onnx`;
  const onnx = join(o.engineDir, "voices", `${o.name}.onnx`);
  if (existsSync(onnx) && existsSync(`${onnx}.json`)) return relative;
  const urls = piperVoiceUrls(o.name);
  return single(onnx, async () => {
    o.log?.(t(o.lang ?? "es", "piper.voice", { voice: o.name }));
    await mkdir(join(o.engineDir, "voices"), { recursive: true });
    await download(urls.json, `${onnx}.json`, { fetchImpl: o.fetchImpl });
    await download(urls.onnx, onnx, { sha256: urls.sha256, fetchImpl: o.fetchImpl });
    return relative;
  });
}

export type PiperRunner = (exe: string, args: string[], o: { cwd: string; input: string }) => Promise<void>;

const runPiper: PiperRunner = (exe, args, o) =>
  new Promise((done, fail) => {
    const child = spawn(exe, args, { cwd: o.cwd, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { code }))));
    child.stdin.end(o.input, "utf8");
  });

/** 0xC0000135, "a DLL was not found": on Windows that is the Visual C++ runtime Piper needs. */
const MISSING_DLL = new Set([3221225781, -1073741515]);

export function createPiperProvider(o: EngineOptions & { voices?: LocalizedText; ffmpeg: () => Promise<string>; run?: PiperRunner }): VoiceProvider {
  return {
    id: "piper",
    model: PIPER_RELEASE,
    voiceFor: (lang) => o.voices?.[lang] ?? PIPER_VOICES[lang],
    async synthesize(request) {
      const name = request.voice ?? PIPER_VOICES[request.lang];
      const engine = await ensurePiperEngine(o);
      const model = await ensurePiperVoice({ engineDir: engine.dir, name, fetchImpl: o.fetchImpl, log: o.log, lang: o.lang });
      const out = `out-${randomBytes(6).toString("hex")}.wav`;
      const wav = join(engine.dir, out);
      // Relative ASCII arguments from the engine's folder: Piper 2023 garbles non-ASCII paths on Windows.
      const args = [
        "--model", model, "--config", `${model}.json`, "--output_file", out,
        "--length_scale", String(Math.round((1 / request.speed) * 100) / 100), "--espeak_data", "espeak-ng-data", "-q",
      ];
      try {
        try {
          await (o.run ?? runPiper)(engine.exe, args, { cwd: engine.dir, input: request.text });
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          if (typeof code === "number" && MISSING_DLL.has(code)) {
            throw new VoiceError("Piper needs the Microsoft Visual C++ runtime: install it from https://aka.ms/vs/17/release/vc_redist.x64.exe");
          }
          throw new VoiceError(`Piper failed: ${((error as Error).message.split("\n")[0] ?? "").slice(0, 200)}`);
        }
        if (!existsSync(wav)) throw new VoiceError("Piper wrote no audio.");
        return await toMp3(wav, `${wav}.mp3`, await o.ffmpeg());
      } finally {
        await rm(wav, { force: true });
        await rm(`${wav}.mp3`, { force: true });
      }
    },
  };
}
```

En `packages/core/src/i18n.ts`, en `es` antes de `"player.hint"`:

```ts
  "piper.engine": "Descargando Piper {release} (unos 25 MB) en {dir}. Piper (MIT) trae espeak-ng (GPL-3.0); explicame lo ejecuta como un programa aparte.",
  "piper.voice": "Descargando la voz de Piper {voice}…",
```

y en `en` antes de `"player.hint"`:

```ts
  "piper.engine": "Downloading Piper {release} (about 25 MB) into {dir}. Piper (MIT) bundles espeak-ng (GPL-3.0); explicame runs it as a separate program.",
  "piper.voice": "Downloading the Piper voice {voice}…",
```

En `packages/cli/src/voice/index.ts`:
- agregar `import { explicameHome } from "../credentials.js";` e `import { createPiperProvider } from "./piper.js";`;
- la firma pasa a `buildVoiceProviders(config: Config, creds: Credentials, o: { home?: string; log?: (message: string) => void } = {}): VoiceProvider[]` (y el comentario `// o.home is where Piper keeps its engine and voices (Task 3).` se borra);
- dentro del `for`, después del bloque de `command`:

```ts
    if (id === "piper") {
      providers.push(createPiperProvider({ home: o.home ?? explicameHome(), voices, ffmpeg: () => findFfmpeg(config.uiLanguage), log: o.log, lang: config.uiLanguage }));
    }
```

En `packages/cli/src/build.ts`, en `publish`, cambiar `buildVoiceProviders(o.config, o.credentials, { home })` por `buildVoiceProviders(o.config, o.credentials, { home, log })`.

- [ ] **Step 4: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/piper.test.ts packages/cli/test/voice.test.ts`
Expected: PASS (la prueba en vivo queda saltada).

- [ ] **Step 5: Prueba en vivo en esta máquina**

Run: `EXPLICAME_LIVE_PIPER=1 npx vitest run packages/cli/test/piper.live.test.ts`
Expected: PASS — descarga el motor (verificado por SHA-256) y las dos voces la primera vez, y deja dos MP3 de más de 1 s. Si Windows no tiene el runtime de Visual C++, el error dice cómo instalarlo; se registra en el ledger.

- [ ] **Step 6: Suite y tipos**

Run: `npm test && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/voice packages/cli/src/build.ts packages/core/src/i18n.ts packages/cli/test/piper.test.ts packages/cli/test/piper.live.test.ts
git commit -m "feat(voz): Piper gratis y local, con descargas verificadas y voces de licencia limpia por defecto"
```

---

### Task 4: Capturas del avance y grabación por idiomas reutilizable

**Files:**
- Modify: `packages/cli/src/generate/loop.ts`, `packages/cli/src/build.ts`, `packages/cli/src/record.ts`, `packages/cli/src/cli.ts`, `packages/core/src/i18n.ts`
- Test: `packages/cli/test/build.test.ts`, `packages/cli/test/record.test.ts`

**Interfaces:**
- Consumes: `executeCall`/`ExplorationState` (plan 1); `recordGuide` (plan 2); `readGuide`, `sessionPath`.
- Produces: `ExplorationState.afterStep?: () => Promise<void>` y `ExplorationOptions.afterStep?`; `BuildOptions.onShot?: (jpeg: Buffer) => void`; `recordLanguages(o: { guidePath; config; cwd; home; langs?; log }): Promise<string[]>` que valida los idiomas (clave i18n `record.badLang`).

- [ ] **Step 1: Escribir las pruebas que fallan**

En `packages/cli/test/build.test.ts`, dentro de `describe("build guards", ...)`:

```ts
  it("hands over a screenshot after every step it adds", async () => {
    const shots: Buffer[] = [];
    const driver = createFakeDriver({
      turns: [
        [{ name: "observe", input: {} }],
        [{ name: "add_step", input: { narration: { es: "Abre el filtro.", en: "Open the filter." }, element: { name: "Filtrar" }, action: "click", value: null, url: null, opens: "dialog" } }],
        [{ name: "add_step", input: { narration: { es: "Elige la fecha.", en: "Pick the date." }, element: { label: "Desde" }, action: "type", value: "2026-09-01", url: null, opens: null } }],
        [{ name: "finish", input: { title: { es: "Capturas", en: "Shots" } } }],
      ],
    });
    const config = ConfigSchema.parse({ appUrl: server.url, outputDir: join(cwd, "out-shots"), voice: { provider: "fake" } });
    await build({ cwd, config, credentials: {}, diffFile: "x.patch", driver, voiceProviders: [createFakeVoiceProvider()], home, onShot: (jpeg) => shots.push(jpeg) });
    expect(shots).toHaveLength(2);
    for (const shot of shots) expect([shot[0], shot[1]]).toEqual([0xff, 0xd8]);
  });
```

En `packages/cli/test/record.test.ts`, agregar `recordLanguages` al import de `../src/record.js` y, dentro de `describe("what the recorded page may ask for", ...)`:

```ts
  it("refuses languages it does not know before opening a browser", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explicame-rec-langs-"));
    const file = join(dir, "g", "guide.json");
    await mkdir(join(dir, "g"), { recursive: true });
    await writeFile(file, JSON.stringify(guideOf([{ narration: { es: "Uno." } }])));
    const config = ConfigSchema.parse({});
    await expect(recordLanguages({ guidePath: file, config, cwd: dir, home: dir, langs: ["fr" as "es"], log: () => {} })).rejects.toThrow(/Idioma no válido: fr/);
  });
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/build.test.ts packages/cli/test/record.test.ts`
Expected: FAIL — `shots` vacío (`expected [] to have a length of 2`) y `recordLanguages is not a function`.

- [ ] **Step 3: El gancho después de cada paso**

En `packages/cli/src/generate/loop.ts`:
- en `ExplorationState`, después de `onEvent?: ...;`, agregar `  /** Runs after every step is added (the panel takes a screenshot here). */\n  afterStep?: () => Promise<void>;`;
- en `ExplorationOptions`, después de `lang?: Lang;`, agregar `  afterStep?: () => Promise<void>;`;
- en `runExploration`, cambiar la creación de `state` por `const state: ExplorationState = { session: o.session, languages: o.languages, maxSteps: o.maxSteps, steps: [], title: null, onEvent: o.onEvent, afterStep: o.afterStep };`;
- en `executeCall`, después de `state.steps.push(await buildStep(state, c));` agregar `    await state.afterStep?.();`.

En `packages/cli/src/build.ts`:
- en `BuildOptions`, después de `log?: ...;`, agregar `  /** Receives a JPEG of the screen after every step the AI adds (live progress in the panel). */\n  onShot?: (jpeg: Buffer) => void;`;
- en `runBuild`, en la llamada a `runExploration`, después de `onEvent: (event) => log(event.message), lang,` agregar:

```ts
      afterStep: o.onShot ? async () => o.onShot?.(await session.page.screenshot({ type: "jpeg", quality: 60 })) : undefined,
```

- [ ] **Step 4: `recordLanguages`**

En `packages/core/src/i18n.ts`, en `es` antes de `"record.noFfmpeg"`: `  "record.badLang": "Idioma no válido: {langs}. Usa {valid}.",` y en `en` antes de `"record.noFfmpeg"`: `  "record.badLang": "Unknown language: {langs}. Use {valid}.",`.

En `packages/cli/src/record.ts`:
- imports: agregar `dirname` y `resolve` al import de `node:path` (si faltan), `import { sessionPath } from "./build.js";`, `import { ConfigError, type Config } from "./config.js";` (unir con el import existente de `./config.js` si lo hay) e `import { readGuide } from "./output.js";`;
- al final:

```ts
/** Records the guide at guidePath in each language (all of the guide's by default) and returns the MP4 paths. */
export async function recordLanguages(o: {
  guidePath: string;
  config: Config;
  cwd: string;
  home: string;
  langs?: Lang[];
  log: (message: string) => void;
}): Promise<string[]> {
  const guide = await readGuide(o.guidePath);
  const wanted = o.langs ?? guide.languages;
  const unknown = wanted.filter((lang) => !(LANGUAGES as readonly string[]).includes(lang));
  if (unknown.length) throw new ConfigError(t(o.config.uiLanguage, "record.badLang", { langs: unknown.join(", "), valid: LANGUAGES.join(", ") }));
  const videos: string[] = [];
  for (const lang of wanted.filter((l) => guide.languages.includes(l))) {
    const result = await recordGuide({
      guide, guidesRoot: dirname(dirname(o.guidePath)), appUrl: o.config.appUrl, lang,
      outDir: resolve(o.cwd, o.config.videoDir), allowRequests: o.config.safety.allowRequests,
      storageStatePath: sessionPath(o.home, o.cwd), uiLang: o.config.uiLanguage,
    });
    o.log(t(o.config.uiLanguage, "record.done", { path: result.video }));
    videos.push(result.video);
  }
  return videos;
}
```

En `packages/cli/src/cli.ts`, reemplazar la función `recordAll` por:

```ts
const recordAll = (ctx: RunContext, guidePath: string, langs?: Lang[]) =>
  recordLanguages({ guidePath: resolve(ctx.cwd, guidePath), config: ctx.config, cwd: ctx.cwd, home: explicameHome(), langs, log: ctx.log });
```

cambiar el import `import { recordGuide, RecordError } from "./record.js";` por `import { recordLanguages, RecordError } from "./record.js";`, `langsOf` por:

```ts
const langsOf = (value: string | undefined): Lang[] | undefined =>
  !value || value === "all" ? undefined : (value.split(",").map((s) => s.trim()) as Lang[]);
```

y sus usos: en `build`, `recordAll({ cwd, config, credentials, log }, join(result.dir, "guide.json"))`; en `record`, `run((ctx) => recordAll(ctx, guidePath, langsOf(opts.lang)))`. Quitar `t` del import de `@explicame/core` en `cli.ts` solo si el typecheck lo marca sin uso.

- [ ] **Step 5: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/build.test.ts packages/cli/test/record.test.ts packages/cli/test/loop.test.ts packages/cli/test/guideSession.test.ts`
Expected: PASS.

- [ ] **Step 6: Suite, tipos y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/generate/loop.ts packages/cli/src/build.ts packages/cli/src/record.ts packages/cli/src/cli.ts packages/core/src/i18n.ts packages/cli/test/build.test.ts packages/cli/test/record.test.ts
git commit -m "feat(cli): capturas tras cada paso para el avance en vivo y grabación por idiomas con validación"
```

---

### Task 5: El servidor del panel

**Files:**
- Create: `packages/cli/src/version.ts`, `packages/cli/src/panel/server.ts`
- Modify: `packages/cli/src/config.ts`, `packages/cli/src/credentials.ts`, `packages/cli/src/cli.ts`, `packages/core/src/i18n.ts`
- Create: `packages/panel/package.json`, `packages/panel/index.html`, `packages/panel/vite.config.ts` (página mínima; la interfaz llega en la Tarea 6)
- Test: `packages/cli/test/panel.test.ts`

**Interfaces:**
- Consumes: `build` con `onShot` y `fromGuide`, `recordLanguages` (Tarea 4); `buildVoiceProviders`, `synthesizeWithCache`, `cloneElevenLabsVoice` (Tareas 1–2); `login` (plan 1); `readGuide`.
- Produces: `VERSION` en `version.ts` (y `cli.ts` lo reexporta); `saveConfig(cwd, patch): Promise<Config>`; `saveCredential(home, name, value | null)`; `describeCredentials(env, home): Promise<Record<keyof Credentials, CredentialStatus>>`; `startPanel(o: PanelOptions): Promise<Panel>` con `PanelOptions { cwd; home; port?; token?; driver?; voiceProviders?; login?; fetchImpl?; env? }` y `Panel { url; token; close() }`; `containedPath(root, relative): string | null`; `panelDist(): string`. API: `GET /api/state`, `PUT /api/config`, `PUT|DELETE /api/credentials/:name`, `POST /api/voice/test`, `POST /api/voice/clone`, `POST /api/login`, `POST /api/jobs`, `GET /api/jobs/:id/events` (SSE), `GET /files/output/...`, `GET /files/videos/...`.

- [ ] **Step 1: El paquete del panel, todavía con una página mínima**

La CLI encuentra la interfaz por `@explicame/panel`. En esta tarea basta con una página que la Tarea 6 reemplaza.

`packages/panel/package.json`:
```json
{
  "name": "@explicame/panel",
  "version": "0.1.0",
  "description": "Panel local de explicame · explicame local panel",
  "license": "MIT",
  "type": "module",
  "files": ["dist"],
  "exports": { "./package.json": "./package.json" },
  "scripts": { "build": "vite build" }
}
```

`packages/panel/index.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>explicame · panel</title>
  </head>
  <body>
    <main id="app"></main>
  </body>
</html>
```

`packages/panel/vite.config.ts`:
```ts
import { defineConfig } from "vite";

// Relative asset URLs: the CLI serves the panel from the root of its own local server.
export default defineConfig({ base: "./", build: { outDir: "dist", emptyOutDir: true } });
```

En el `package.json` raíz, el script `build` pasa a `npm run build -w @explicame/player && npm run build -w @explicame/panel && npm run build -w explicame`. En `packages/cli/package.json`, agregar `"@explicame/panel": "0.1.0"` a `dependencies`.

Run: `npm install && npm run build`
Expected: `packages/panel/dist/index.html` existe y el build termina en verde.

- [ ] **Step 2: Escribir las pruebas que fallan**

`packages/cli/test/panel.test.ts`:
```ts
import { execFile } from "node:child_process";
import { request } from "node:http";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LlmDriver } from "../src/generate/driver.js";
import { startPanel, type Panel } from "../src/panel/server.js";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
import { startServer, type TestServer } from "./helpers/server.js";

const run = promisify(execFile);
const git = (dir: string, ...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir });
const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));

let site: TestServer;
let cwd: string;
let home: string;
let panel: Panel;
let release: () => void = () => {};
let markStarted: () => void = () => {};
const started = new Promise<void>((done) => (markStarted = done));
const fetchImpl = vi.fn(async () => Response.json({ voice_id: "cloned123", requires_verification: false }));

/** An AI that says when it was called and then waits until the test releases it, to see a job running. */
const waitingDriver = (): LlmDriver => ({
  id: "fake",
  async start() {
    markStarted();
    await new Promise<void>((done) => (release = done));
    throw new Error("released");
  },
  async reply() {
    throw new Error("unused");
  },
  usage: () => ({ inputTokens: 0, outputTokens: 0 }),
});

beforeAll(async () => {
  site = await startServer(SITE);
  cwd = await mkdtemp(join(tmpdir(), "explicame-panel-"));
  home = await mkdtemp(join(tmpdir(), "explicame-panel-home-"));
  await git(cwd, "init", "-b", "main");
  await writeFile(join(cwd, "explicame.config.json"), JSON.stringify({ appUrl: site.url, voice: { provider: "fake" } }));
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "base");
  await git(cwd, "checkout", "-b", "feature");
  await writeFile(join(cwd, "filter.ts"), "export const filter = true;\n");
  await git(cwd, "add", "filter.ts");
  await git(cwd, "commit", "-m", "feature");
  panel = await startPanel({
    cwd, home, port: 0, env: {}, driver: waitingDriver, voiceProviders: () => [createFakeVoiceProvider()],
    login: async () => join(home, "sessions", "app.json"), fetchImpl: fetchImpl as unknown as typeof fetch,
  });
});
afterAll(async () => {
  release();
  await panel.close();
  await site.close();
});

const origin = () => new URL(panel.url).origin;
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${origin()}${path}`, { ...init, headers: { "x-explicame-token": panel.token, "content-type": "application/json", ...init.headers } });

function rawGet(path: string, host: string): Promise<number> {
  const url = new URL(panel.url);
  return new Promise((done, fail) => {
    const req = request({ host: url.hostname, port: url.port, path, headers: { host, "x-explicame-token": panel.token } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on("error", fail);
    req.end();
  });
}

describe("panel server", () => {
  it("listens on 127.0.0.1 and asks for the session token on the page and the API", async () => {
    expect(new URL(panel.url).hostname).toBe("127.0.0.1");
    expect(panel.token.length).toBeGreaterThanOrEqual(32);
    expect((await fetch(`${origin()}/?t=wrong`)).status).toBe(401);
    expect((await fetch(panel.url)).status).toBe(200);
    expect((await fetch(`${origin()}/api/state`)).status).toBe(401);
    const state = (await (await api("/api/state")).json()) as { config: { appUrl: string }; version: string };
    expect(state.config.appUrl).toBe(site.url);
    expect(state.version).toBe("0.1.0");
  });

  it("rejects requests that arrive under another host name", async () => {
    expect(await rawGet("/api/state", "evil.example")).toBe(403);
    expect(await rawGet("/api/state", `localhost:${new URL(panel.url).port}`)).toBe(200);
  });

  it("stores a key in the user's folder and never sends it back whole", async () => {
    const saved = await api("/api/credentials/openai", { method: "PUT", body: JSON.stringify({ value: "sk-openai-secret-9876" }) });
    const body = await saved.text();
    expect(body).not.toContain("sk-openai-secret");
    expect(JSON.parse(body).credentials.openai).toEqual({ set: true, masked: "••••9876", source: "file" });
    expect(await (await api("/api/state")).text()).not.toContain("sk-openai-secret");
    const file = join(home, "credentials.json");
    expect(JSON.parse(await readFile(file, "utf8")).openai).toBe("sk-openai-secret-9876");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    await api("/api/credentials/openai", { method: "DELETE" });
    expect(JSON.parse(await readFile(file, "utf8")).openai).toBeUndefined();
  });

  it("merges config changes into explicame.config.json and refuses secrets or invalid values", async () => {
    const ok = await api("/api/config", { method: "PUT", body: JSON.stringify({ maxSteps: 12, voice: { speed: 1.25 } }) });
    expect(ok.status).toBe(200);
    expect(JSON.parse(await readFile(join(cwd, "explicame.config.json"), "utf8"))).toEqual({ appUrl: site.url, maxSteps: 12, voice: { provider: "fake", speed: 1.25 } });
    expect((await api("/api/config", { method: "PUT", body: JSON.stringify({ apiKey: "x" }) })).status).toBe(400);
    expect((await api("/api/config", { method: "PUT", body: JSON.stringify({ maxSteps: 99 }) })).status).toBe(400);
    expect(JSON.parse(await readFile(join(cwd, "explicame.config.json"), "utf8")).maxSteps).toBe(12);
  });

  it("plays a voice sample as MP3", async () => {
    const sample = await api("/api/voice/test", { method: "POST", body: JSON.stringify({ lang: "es", provider: "fake", text: "Hola" }) });
    expect(sample.headers.get("content-type")).toBe("audio/mpeg");
    const bytes = new Uint8Array(await sample.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfb]);
  });

  it("clones a voice only with consent", async () => {
    await api("/api/credentials/elevenlabs", { method: "PUT", body: JSON.stringify({ value: "el-key-0000" }) });
    const files = [{ name: "muestra.mp3", data: Buffer.from([1, 2, 3]).toString("base64") }];
    expect((await api("/api/voice/clone", { method: "POST", body: JSON.stringify({ name: "Gabriel", consent: false, files }) })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    const cloned = await api("/api/voice/clone", { method: "POST", body: JSON.stringify({ name: "Gabriel", consent: true, files }) });
    expect(await cloned.json()).toEqual({ voiceId: "cloned123" });
  });

  it("serves files inside the output and video folders only", async () => {
    await mkdir(join(cwd, "public", "explicame"), { recursive: true });
    await writeFile(join(cwd, "public", "explicame", "guides.json"), "[]");
    expect((await fetch(`${origin()}/files/output/guides.json?t=${panel.token}`)).status).toBe(200);
    expect((await fetch(`${origin()}/files/output/guides.json`)).status).toBe(401);
    expect((await fetch(`${origin()}/files/output/..%2f..%2fexplicame.config.json?t=${panel.token}`)).status).toBe(404);
    expect((await fetch(`${origin()}/files/output/..%5c..%5cexplicame.config.json?t=${panel.token}`)).status).toBe(404);
  });

  it("logs in through the app and runs one job at a time, streaming its events", async () => {
    expect(await (await api("/api/login", { method: "POST" })).json()).toEqual({ path: join(home, "sessions", "app.json") });
    const first = await api("/api/jobs", { method: "POST", body: JSON.stringify({ kind: "build", describe: "Filtro" }) });
    expect(first.status).toBe(202);
    const { id } = (await first.json()) as { id: string };
    expect((await api("/api/jobs", { method: "POST", body: JSON.stringify({ kind: "build" }) })).status).toBe(409);
    await started;
    release();
    const stream = await fetch(`${origin()}/api/jobs/${id}/events?t=${panel.token}`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const text = await stream.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("released");
    expect(existsSync(join(cwd, ".explicame", "reports"))).toBe(true);
  });
});
```

- [ ] **Step 3: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/panel.test.ts`
Expected: FAIL — `Cannot find module '../src/panel/server.js'`.

- [ ] **Step 4: Configuración y claves que se guardan**

`packages/cli/src/version.ts`:
```ts
export const VERSION = "0.1.0";
```

En `packages/cli/src/cli.ts`, reemplazar `export const VERSION = "0.1.0";` por `export { VERSION } from "./version.js";` y agregar `import { VERSION } from "./version.js";` a los imports.

En `packages/cli/src/config.ts`, agregar `writeFile` al import de `node:fs/promises` y al final:

```ts
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Objects merge, anything else replaces, and null deletes the key. */
function mergeConfig(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeConfig(out[key] as Record<string, unknown>, value);
    else out[key] = value;
  }
  return out;
}

/** Merges a change into explicame.config.json, validates the result and writes only what the user set. */
export async function saveConfig(cwd: string, patch: Record<string, unknown>): Promise<Config> {
  const file = join(cwd, "explicame.config.json");
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (isPlainObject(parsed)) raw = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ConfigError(t("es", "config.invalid", { errors: (error as Error).message }));
  }
  const merged = mergeConfig(raw, patch);
  const lang: Lang = merged.uiLanguage === "en" ? "en" : "es";
  const secret = findSecretKey(merged);
  if (secret) throw new ConfigError(t(lang, "config.secretInConfig", { key: secret }));
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(t(lang, "config.invalid", { errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }));
  }
  await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
  return result.data;
}
```

En `packages/cli/src/credentials.ts`, cambiar el import de `node:fs/promises` a `import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";` y reemplazar `loadCredentials` por:

```ts
async function readCredentialsFile(home: string): Promise<Credentials> {
  try {
    return JSON.parse(await readFile(join(home, "credentials.json"), "utf8")) as Credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ConfigError(`credentials.json: ${(error as Error).message}`);
    return {};
  }
}

export async function loadCredentials(env: NodeJS.ProcessEnv = process.env, home: string = explicameHome(env)): Promise<Credentials> {
  const file = await readCredentialsFile(home);
  const out: Credentials = {};
  for (const name of Object.keys(CREDENTIAL_ENV) as (keyof Credentials)[]) {
    const value = env[CREDENTIAL_ENV[name]] ?? file[name];
    if (value) out[name] = value;
  }
  return out;
}

export interface CredentialStatus {
  set: boolean;
  /** Only the last four characters, never the key. */
  masked: string;
  source: "env" | "file" | null;
}

/** What the panel may know about each key: whether it is set, where from, and its last four characters. */
export async function describeCredentials(env: NodeJS.ProcessEnv, home: string): Promise<Record<keyof Credentials, CredentialStatus>> {
  const file = await readCredentialsFile(home);
  const out = {} as Record<keyof Credentials, CredentialStatus>;
  for (const name of Object.keys(CREDENTIAL_ENV) as (keyof Credentials)[]) {
    const fromEnv = env[CREDENTIAL_ENV[name]];
    const value = fromEnv ?? file[name];
    out[name] = value ? { set: true, masked: maskKey(value), source: fromEnv ? "env" : "file" } : { set: false, masked: "", source: null };
  }
  return out;
}

/** Stores (or removes, with null) one key in ~/.explicame/credentials.json, readable only by the user. */
export async function saveCredential(home: string, name: keyof Credentials, value: string | null): Promise<void> {
  const current = await readCredentialsFile(home);
  if (value) current[name] = value.trim();
  else delete current[name];
  await mkdir(home, { recursive: true });
  const file = join(home, "credentials.json");
  await writeFile(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
}
```

En `packages/core/src/i18n.ts`, en `es` antes de `"player.hint"`:

```ts
  "panel.ready": "Panel listo en {url} (Ctrl+C para cerrarlo)",
  "panel.portBusy": "El puerto {port} está ocupado: prueba con explicame panel --port 4848.",
  "panel.busy": "Ya hay una generación en curso: espera a que termine.",
  "panel.noVoice": "No puedo usar la voz {provider}: revisa su clave o su configuración.",
  "panel.badToken": "Abre el panel con el enlace que mostró la terminal (incluye el token de la sesión).",
```

y en `en` antes de `"player.hint"`:

```ts
  "panel.ready": "Panel ready at {url} (Ctrl+C to close it)",
  "panel.portBusy": "Port {port} is busy: try explicame panel --port 4848.",
  "panel.busy": "A generation is already running: wait for it to finish.",
  "panel.noVoice": "I can't use the {provider} voice: check its key or settings.",
  "panel.badToken": "Open the panel with the link the terminal printed (it carries the session token).",
```

- [ ] **Step 5: El servidor**

`packages/cli/src/panel/server.ts`:
```ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { LANGUAGES, t, type Lang } from "@explicame/core";
import { build } from "../build.js";
import { ConfigError, ConfigSchema, loadConfig, saveConfig, type Config } from "../config.js";
import { CREDENTIAL_ENV, describeCredentials, loadCredentials, saveCredential, type Credentials } from "../credentials.js";
import type { LlmDriver } from "../generate/driver.js";
import { login } from "../login.js";
import { readGuide, type GuideIndexEntry } from "../output.js";
import { recordLanguages } from "../record.js";
import { VERSION } from "../version.js";
import { cloneElevenLabsVoice } from "../voice/elevenlabs.js";
import { buildVoiceProviders } from "../voice/index.js";
import { synthesizeWithCache, VoiceError, type VoiceProvider } from "../voice/provider.js";

export interface PanelOptions {
  cwd: string;
  home: string;
  /** 4747 by default; 0 picks a free port. */
  port?: number;
  token?: string;
  /** Test seams: a scripted AI, silent voices, a login without a window and a fake ElevenLabs. */
  driver?: () => LlmDriver;
  voiceProviders?: () => VoiceProvider[];
  login?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  /** Where environment keys come from (process.env by default). */
  env?: NodeJS.ProcessEnv;
}

export interface Panel {
  url: string;
  token: string;
  close(): Promise<void>;
}

type JobEvent =
  | { type: "log"; message: string }
  | { type: "shot"; data: string }
  | { type: "done"; guide: string; videos: string[] }
  | { type: "error"; message: string };

interface Job {
  id: string;
  events: JobEvent[];
  listeners: Set<(event: JobEvent) => void>;
  finished: boolean;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const CREDENTIAL_NAMES = Object.keys(CREDENTIAL_ENV) as (keyof Credentials)[];
const MAX_BODY = 25 * 1024 * 1024; // voice samples for cloning travel as base64
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const VoiceTestSchema = z.strictObject({
  lang: z.enum(LANGUAGES),
  provider: z.enum(["elevenlabs", "deepgram", "openai", "piper", "command", "fake"]),
  voice: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(300),
});
const CloneSchema = z.strictObject({
  name: z.string().min(1).max(100),
  consent: z.literal(true),
  files: z.array(z.strictObject({ name: z.string().min(1).max(200), data: z.string().min(1) })).min(1).max(10),
});
const JobSchema = z.strictObject({
  kind: z.enum(["build", "from-guide"]),
  describe: z.string().max(2000).optional(),
  files: z.array(z.string().min(1)).max(20).optional(),
  guide: z.string().regex(ID).optional(),
  video: z.boolean().optional(),
});
type JobRequest = z.infer<typeof JobSchema>;

/** Where the built panel lives (the @explicame/panel package). */
export function panelDist(): string {
  return join(dirname(createRequire(import.meta.url).resolve("@explicame/panel/package.json")), "dist");
}

/** A file inside root, or null when the requested path would leave it. */
export function containedPath(root: string, relative: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const file = resolve(base, decoded.replace(/^[/\\]+/, ""));
  return file.startsWith(base + sep) ? file : null;
}

function sameSecret(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, "Not found");
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  // <video> seeks with Range requests.
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end) throw new HttpError(416, "Range not satisfiable");
    res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${info.size}`, "accept-ranges": "bytes", "cache-control": "no-store" });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": info.size, "accept-ranges": "bytes", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}

/**
 * The local panel: only on 127.0.0.1, only under its own host name, and only with the session token in the URL
 * or in every request. Keys go in and never come back out whole.
 */
export async function startPanel(o: PanelOptions): Promise<Panel> {
  const token = o.token ?? randomBytes(24).toString("base64url");
  const env = o.env ?? process.env;
  const dist = panelDist();
  let port = 0;
  let job: Job | null = null;

  const config = () => loadConfig(o.cwd);
  const lenientConfig = () => config().catch(() => ConfigSchema.parse({}));

  async function guides(current: Config) {
    const outputRoot = resolve(o.cwd, current.outputDir);
    const videoDir = resolve(o.cwd, current.videoDir);
    let index: GuideIndexEntry[];
    try {
      index = JSON.parse(await readFile(join(outputRoot, "guides.json"), "utf8")) as GuideIndexEntry[];
    } catch {
      return [];
    }
    const videos = existsSync(videoDir) ? await readdir(videoDir) : [];
    const out = [];
    for (const entry of index) {
      try {
        const guide = await readGuide(join(outputRoot, entry.id, "guide.json"));
        out.push({
          id: guide.id,
          title: guide.title,
          languages: guide.languages,
          steps: guide.steps.map((step) => ({ narration: step.narration, audio: step.audio })),
          videos: videos.filter((file) => file.startsWith(`${guide.id}.`) && file.endsWith(".mp4")),
        });
      } catch {
        // a guide that no longer validates is left out of the list
      }
    }
    return out;
  }

  async function state() {
    let current: Config;
    let configError: string | null = null;
    try {
      current = await config();
    } catch (error) {
      current = ConfigSchema.parse({});
      configError = (error as Error).message;
    }
    return {
      version: VERSION,
      cwd: o.cwd,
      config: current,
      configError,
      credentials: await describeCredentials(env, o.home),
      guides: await guides(current),
      job: job ? { id: job.id, running: !job.finished } : null,
    };
  }

  async function runJob(request: JobRequest, emit: (event: JobEvent) => void): Promise<{ guide: string; videos: string[] }> {
    const current = await config();
    const log = (message: string) => emit({ type: "log", message });
    const fromGuide = request.kind === "from-guide" ? join(resolve(o.cwd, current.outputDir), request.guide!, "guide.json") : undefined;
    const result = await build({
      cwd: o.cwd,
      config: current,
      credentials: await loadCredentials(env, o.home),
      home: o.home,
      log,
      onShot: (jpeg) => emit({ type: "shot", data: jpeg.toString("base64") }),
      describe: request.describe,
      files: request.files,
      fromGuide,
      driver: o.driver?.(),
      voiceProviders: o.voiceProviders?.(),
    });
    const videos = request.video
      ? await recordLanguages({ guidePath: join(result.dir, "guide.json"), config: current, cwd: o.cwd, home: o.home, log })
      : [];
    return { guide: result.guide.id, videos: videos.map((file) => basename(file)) };
  }

  function startJob(request: JobRequest): Job {
    const current: Job = { id: randomBytes(6).toString("hex"), events: [], listeners: new Set(), finished: false };
    const emit = (event: JobEvent) => {
      current.events.push(event);
      for (const listener of current.listeners) listener(event);
    };
    job = current;
    void runJob(request, emit).then(
      (result) => {
        current.finished = true;
        emit({ type: "done", ...result });
      },
      (error: unknown) => {
        current.finished = true;
        emit({ type: "error", message: (error as Error).message });
      },
    );
    return current;
  }

  function streamJob(req: IncomingMessage, res: ServerResponse, current: Job): void {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    const write = (event: JobEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    for (const event of current.events) write(event);
    if (current.finished) {
      res.end();
      return;
    }
    const listener = (event: JobEvent) => {
      write(event);
      if (event.type === "done" || event.type === "error") res.end();
    };
    current.listeners.add(listener);
    req.on("close", () => current.listeners.delete(listener));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? "";
    // A page on another site can resolve its own name to 127.0.0.1 (DNS rebinding); it still carries its own Host.
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, "Forbidden host");
    const url = new URL(req.url ?? "/", `http://${host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    const queryToken = url.searchParams.get("t");

    if (method === "GET" && (path === "/" || path === "/index.html")) {
      if (!sameSecret(queryToken, token)) throw new HttpError(401, t((await lenientConfig()).uiLanguage, "panel.badToken"));
      return sendFile(req, res, join(dist, "index.html"));
    }
    if (method === "GET" && path.startsWith("/assets/")) {
      const file = containedPath(join(dist, "assets"), path.slice("/assets/".length));
      if (!file) throw new HttpError(404, "Not found");
      return sendFile(req, res, file);
    }
    if (method === "GET" && path.startsWith("/files/")) {
      if (!sameSecret(queryToken, token)) throw new HttpError(401, "Unauthorized");
      const current = await lenientConfig();
      const [kind, ...rest] = path.slice("/files/".length).split("/");
      const root = kind === "output" ? resolve(o.cwd, current.outputDir) : kind === "videos" ? resolve(o.cwd, current.videoDir) : null;
      const file = root ? containedPath(root, rest.join("/")) : null;
      if (!file) throw new HttpError(404, "Not found");
      return sendFile(req, res, file);
    }
    if (!path.startsWith("/api/")) throw new HttpError(404, "Not found");
    // EventSource cannot send headers, so the token may also come in the query string.
    const header = req.headers["x-explicame-token"];
    if (!sameSecret(typeof header === "string" ? header : queryToken, token)) throw new HttpError(401, "Unauthorized");

    if (method === "GET" && path === "/api/state") return sendJson(res, 200, await state());

    if (method === "PUT" && path === "/api/config") {
      const body = await readBody(req);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Expected an object");
      return sendJson(res, 200, { config: await saveConfig(o.cwd, body as Record<string, unknown>) });
    }

    const credential = /^\/api\/credentials\/([a-z]+)$/.exec(path);
    if (credential && (method === "PUT" || method === "DELETE")) {
      const name = credential[1] as keyof Credentials;
      if (!CREDENTIAL_NAMES.includes(name)) throw new HttpError(404, "Unknown key");
      let value: string | null = null;
      if (method === "PUT") {
        const given = ((await readBody(req)) as { value?: unknown }).value;
        if (typeof given !== "string" || !given.trim()) throw new HttpError(400, "Empty key");
        value = given;
      }
      await saveCredential(o.home, name, value);
      return sendJson(res, 200, { credentials: await describeCredentials(env, o.home) });
    }

    if (method === "POST" && path === "/api/voice/test") {
      const body = VoiceTestSchema.parse(await readBody(req));
      const current = await lenientConfig();
      const voices = body.voice ? { ...current.voice.voices, [body.lang]: body.voice } : current.voice.voices;
      const providers =
        o.voiceProviders?.() ??
        buildVoiceProviders({ ...current, voice: { ...current.voice, provider: body.provider, fallback: [], voices } }, await loadCredentials(env, o.home), { home: o.home });
      if (providers.length === 0) throw new HttpError(400, t(current.uiLanguage, "panel.noVoice", { provider: body.provider }));
      const { audio } = await synthesizeWithCache(providers.slice(0, 1), { text: body.text, lang: body.lang as Lang, speed: current.voice.speed }, join(o.home, "cache", "voice"), 1);
      res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
      res.end(audio);
      return;
    }

    if (method === "POST" && path === "/api/voice/clone") {
      const body = CloneSchema.parse(await readBody(req));
      const creds = await loadCredentials(env, o.home);
      if (!creds.elevenlabs) throw new HttpError(400, t((await lenientConfig()).uiLanguage, "panel.noVoice", { provider: "elevenlabs" }));
      const voiceId = await cloneElevenLabsVoice({
        apiKey: creds.elevenlabs,
        name: body.name,
        consent: body.consent,
        files: body.files.map((file) => ({ name: file.name, data: Buffer.from(file.data, "base64") })),
        fetchImpl: o.fetchImpl,
      });
      return sendJson(res, 200, { voiceId });
    }

    if (method === "POST" && path === "/api/login") {
      const file = o.login ? await o.login() : await login({ cwd: o.cwd, config: await config(), home: o.home, log: () => {} });
      return sendJson(res, 200, { path: file });
    }

    if (method === "POST" && path === "/api/jobs") {
      const body = JobSchema.parse(await readBody(req));
      if (job && !job.finished) throw new HttpError(409, t((await lenientConfig()).uiLanguage, "panel.busy"));
      if (body.kind === "from-guide" && !body.guide) throw new HttpError(400, "guide is required");
      return sendJson(res, 202, { id: startJob(body).id });
    }

    const events = /^\/api\/jobs\/([a-f0-9]+)\/events$/.exec(path);
    if (method === "GET" && events) {
      if (!job || job.id !== events[1]) throw new HttpError(404, "No such job");
      return streamJob(req, res, job);
    }
    throw new HttpError(404, "Not found");
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status =
        error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof ConfigError || error instanceof VoiceError ? 400 : 500;
      const message = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; ") : (error as Error).message;
      if (res.headersSent) res.end();
      else sendJson(res, status, { error: message });
    });
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(o.port ?? 4747, "127.0.0.1", () => done());
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/?t=${token}`,
    token,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
```

- [ ] **Step 6: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/panel.test.ts`
Expected: PASS (8).

- [ ] **Step 7: Suite, tipos y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: todo en verde.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json packages/panel packages/cli/package.json packages/cli/src/version.ts packages/cli/src/cli.ts packages/cli/src/config.ts packages/cli/src/credentials.ts packages/cli/src/panel/server.ts packages/core/src/i18n.ts packages/cli/test/panel.test.ts
git commit -m "feat(panel): servidor local con token, claves enmascaradas, prueba y clonación de voz, y generaciones con eventos en vivo"
```

---

### Task 6: La interfaz del panel y `explicame panel`

**Files:**
- Modify: `packages/panel/index.html`
- Create: `packages/panel/src/i18n.ts`, `packages/panel/src/api.ts`, `packages/panel/src/main.ts`, `packages/panel/src/styles.css`
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/panelUi.test.ts`

**Interfaces:**
- Consumes: la API de la Tarea 5 y `startPanel`.
- Produces: la página del panel (secciones Proyecto, Idiomas, IA, Voz, Generar y Guías, en ES/EN) y el comando `explicame panel [--port <n>] [--no-open]`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/cli/test/panelUi.test.ts`:
```ts
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeDriver } from "../src/generate/fakeDriver.js";
import { startPanel, type Panel } from "../src/panel/server.js";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
import { startServer, type TestServer } from "./helpers/server.js";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd });
const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
const say = (es: string, en: string) => ({ es, en });

let site: TestServer;
let panel: Panel;
let browser: Browser;
let page: Page;
let cwd: string;
let home: string;

beforeAll(async () => {
  site = await startServer(SITE);
  cwd = await mkdtemp(join(tmpdir(), "explicame-panel-ui-"));
  home = await mkdtemp(join(tmpdir(), "explicame-panel-ui-home-"));
  await git(cwd, "init", "-b", "main");
  await writeFile(join(cwd, "explicame.config.json"), `${JSON.stringify({ appUrl: site.url, voice: { provider: "fake" } }, null, 2)}\n`);
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "base");
  await git(cwd, "checkout", "-b", "feature");
  await writeFile(join(cwd, "filter.ts"), "export const filter = true;\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "feature");
  const script = {
    turns: [
      [{ name: "observe", input: {} }],
      [{ name: "add_step", input: { narration: say("Abre el filtro.", "Open the filter."), element: { name: "Filtrar" }, action: "click", value: null, url: null, opens: "dialog" } }],
      [{ name: "add_step", input: { narration: say("Elige la fecha.", "Pick the date."), element: { label: "Desde" }, action: "type", value: "2026-09-01", url: null, opens: null } }],
      [{ name: "finish", input: { title: say("Filtro por fecha", "Date filter") } }],
    ],
  };
  panel = await startPanel({ cwd, home, port: 0, env: {}, driver: () => createFakeDriver(script), voiceProviders: () => [createFakeVoiceProvider()], login: async () => "ok" });
  browser = await chromium.launch();
  page = await browser.newPage();
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await panel?.close();
  await site?.close();
});

describe("panel page", () => {
  it("shows every section in Spanish and switches to English", async () => {
    await page.goto(panel.url);
    for (const title of ["Proyecto", "Idiomas", "IA", "Voz", "Generar", "Guías"]) await expect.poll(() => page.getByRole("heading", { name: title, exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect.poll(() => page.getByRole("heading", { name: "Project", exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "ES", exact: true }).click();
  });

  it("saves the project settings", async () => {
    await page.getByLabel("Rama base").fill("main");
    await page.locator("#project").getByRole("button", { name: "Guardar" }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(cwd, "explicame.config.json"), "utf8")).base).toBe("main");
  });

  it("stores a key and only ever shows its last four characters", async () => {
    await page.locator("#ai").getByLabel("API key").fill("sk-ant-secret-1234");
    await page.locator("#ai").getByRole("button", { name: "Guardar clave" }).click();
    await expect.poll(() => page.locator("#ai").textContent()).toContain("••••1234");
    expect(await page.content()).not.toContain("sk-ant-secret");
    expect(JSON.parse(await readFile(join(home, "credentials.json"), "utf8")).anthropic).toBe("sk-ant-secret-1234");
  });

  it("generates a guide with live progress and lists it with its audio", async () => {
    await page.getByLabel("Qué hace la funcionalidad (opcional)").fill("Filtro por fecha en Reportes");
    await page.getByRole("button", { name: "Generar guía" }).click();
    await expect.poll(() => page.locator("#generate .status").textContent(), { timeout: 60_000 }).toBe("Listo");
    expect(await page.locator("#generate .shots img").count()).toBe(2);
    await expect.poll(() => page.locator("#results summary").first().textContent()).toContain("Filtro por fecha");
    expect(await page.locator("#results audio").count()).toBe(4);
  }, 90_000);
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/panelUi.test.ts`
Expected: FAIL — la página mínima de la Tarea 5 no tiene secciones (el `poll` del primer título no llega a 1).

- [ ] **Step 3: La página**

`packages/panel/index.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>explicame · panel</title>
    <link rel="stylesheet" href="./src/styles.css" />
  </head>
  <body>
    <header class="top">
      <h1>explicame <span class="sub" data-t="subtitle"></span></h1>
      <div class="langs" role="group" aria-label="Idioma · Language">
        <button type="button" data-ui-lang="es">ES</button>
        <button type="button" data-ui-lang="en">EN</button>
      </div>
    </header>
    <main id="app"><p data-t="loading"></p></main>
    <div id="toast" role="status" aria-live="polite"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

`packages/panel/src/i18n.ts`:
```ts
export type UiLang = "es" | "en";

const es = {
  subtitle: "panel local",
  loading: "Cargando…",
  save: "Guardar",
  saved: "Guardado",
  saveKey: "Guardar clave",
  remove: "Quitar",
  error: "Error: {error}",
  project: "Proyecto",
  appUrl: "URL de la app",
  startUrl: "Pantalla inicial",
  base: "Rama base",
  login: "Iniciar sesión en la app",
  loginHint: "Se abrió un navegador: entra con tu usuario y cierra la pestaña al terminar.",
  loginDone: "Sesión de la app guardada.",
  languages: "Idiomas",
  uiLanguage: "Idioma de la interfaz",
  narration: "Idiomas de la narración",
  "lang.es": "Español",
  "lang.en": "Inglés",
  ai: "IA",
  mode: "Modo",
  "mode.api": "API key de Claude",
  "mode.plugin": "Plugin de Claude Code (tu propia cuenta)",
  pluginHelp:
    "En Claude Code: /plugin marketplace add Egtorres14/explicame y /plugin install explicame@explicame. Después, en el proyecto de tu app, pide /explicame:explicame. Aquí puedes generar la voz y el video de las guías que haga.",
  apiKey: "API key",
  keySet: "Configurada ✓ {masked}",
  keyFromEnv: "(variable de entorno)",
  keyMissing: "Sin configurar",
  model: "Modelo",
  "model.opus": "Claude Opus 5.5 (recomendado)",
  "model.sonnet": "Claude Sonnet 5.5 (más económico)",
  effort: "Esfuerzo",
  maxSteps: "Pasos máximos",
  voice: "Voz",
  provider: "Proveedor",
  "provider.elevenlabs": "ElevenLabs",
  "provider.deepgram": "Deepgram",
  "provider.openai": "OpenAI",
  "provider.piper": "Piper (gratis, local)",
  "provider.command": "Comando propio (gratis)",
  "provider.browser": "Voz del navegador (gratis)",
  voiceFor: "Voz en {lang}",
  test: "Probar",
  testText: "Hola, así sonará la guía de tu nueva funcionalidad.",
  speed: "Velocidad",
  fallback: "Respaldo si falla",
  command: "Comando",
  commandHelp: "Marcadores: {text} o {textFile}, {lang}, {voice}, {speed}, y {out} (WAV) o {outMp3}. Se ejecuta sin shell.",
  browserHelp: "La voz del navegador no genera audio: sirve para la guía, no para el MP4.",
  clone: "Clonar mi voz",
  cloneName: "Nombre de la voz",
  cloneFiles: "Grabaciones de tu voz (1 a 3 minutos en total)",
  cloneConsent: "Confirmo que la voz es mía, o que su dueño dio su consentimiento explícito para clonarla.",
  cloneButton: "Clonar voz",
  cloneNeedsConsent: "Marca la casilla de consentimiento para clonar una voz.",
  cloned: "Voz clonada: {id}. Guarda la sección para usarla.",
  generate: "Generar",
  describe: "Qué hace la funcionalidad (opcional)",
  files: "Archivos de contexto, uno por línea (opcional)",
  video: "Grabar también el video MP4 (necesita ffmpeg)",
  start: "Generar guía",
  voiceOnly: "Generar voz y video",
  pickGuide: "Guía",
  running: "Generando…",
  done: "Listo",
  failed: "Falló: {error}",
  results: "Guías",
  noGuides: "Todavía no hay guías.",
  steps: "{n} pasos",
  download: "Descargar",
};

const en: Record<keyof typeof es, string> = {
  subtitle: "local panel",
  loading: "Loading…",
  save: "Save",
  saved: "Saved",
  saveKey: "Save key",
  remove: "Remove",
  error: "Error: {error}",
  project: "Project",
  appUrl: "App URL",
  startUrl: "Start screen",
  base: "Base branch",
  login: "Log in to the app",
  loginHint: "A browser opened: log in with your user and close the tab when you're done.",
  loginDone: "App session saved.",
  languages: "Languages",
  uiLanguage: "Interface language",
  narration: "Narration languages",
  "lang.es": "Spanish",
  "lang.en": "English",
  ai: "AI",
  mode: "Mode",
  "mode.api": "Claude API key",
  "mode.plugin": "Claude Code plugin (your own account)",
  pluginHelp:
    "In Claude Code: /plugin marketplace add Egtorres14/explicame and /plugin install explicame@explicame. Then, in your app's project, ask /explicame:explicame. Here you can generate the voice and video of the guides it makes.",
  apiKey: "API key",
  keySet: "Set ✓ {masked}",
  keyFromEnv: "(environment variable)",
  keyMissing: "Not set",
  model: "Model",
  "model.opus": "Claude Opus 5.5 (recommended)",
  "model.sonnet": "Claude Sonnet 5.5 (cheaper)",
  effort: "Effort",
  maxSteps: "Maximum steps",
  voice: "Voice",
  provider: "Provider",
  "provider.elevenlabs": "ElevenLabs",
  "provider.deepgram": "Deepgram",
  "provider.openai": "OpenAI",
  "provider.piper": "Piper (free, local)",
  "provider.command": "Your own command (free)",
  "provider.browser": "Browser voice (free)",
  voiceFor: "{lang} voice",
  test: "Try it",
  testText: "Hi, this is how your new feature's guide will sound.",
  speed: "Speed",
  fallback: "Fallback if it fails",
  command: "Command",
  commandHelp: "Placeholders: {text} or {textFile}, {lang}, {voice}, {speed}, and {out} (WAV) or {outMp3}. It runs without a shell.",
  browserHelp: "The browser voice makes no audio files: it works for the guide, not for the MP4.",
  clone: "Clone my voice",
  cloneName: "Voice name",
  cloneFiles: "Recordings of your voice (1 to 3 minutes in total)",
  cloneConsent: "I confirm the voice is mine, or that its owner gave explicit consent to clone it.",
  cloneButton: "Clone voice",
  cloneNeedsConsent: "Tick the consent box to clone a voice.",
  cloned: "Voice cloned: {id}. Save the section to use it.",
  generate: "Generate",
  describe: "What the feature does (optional)",
  files: "Context files, one per line (optional)",
  video: "Also record the MP4 video (needs ffmpeg)",
  start: "Generate guide",
  voiceOnly: "Generate voice and video",
  pickGuide: "Guide",
  running: "Generating…",
  done: "Done",
  failed: "Failed: {error}",
  results: "Guides",
  noGuides: "No guides yet.",
  steps: "{n} steps",
  download: "Download",
};

export type Key = keyof typeof es;
const MESSAGES: Record<UiLang, Record<Key, string>> = { es, en };

export function t(lang: UiLang, key: Key, params: Record<string, string | number> = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
```

`packages/panel/src/api.ts`:
```ts
const token = new URLSearchParams(location.search).get("t") ?? "";

/** Adds the session token to a URL that the browser loads by itself (audio, video, downloads, EventSource). */
export const withToken = (url: string): string => `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    method,
    headers: { "x-explicame-token": token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `HTTP ${response.status}`);
  }
  return response;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await call(method, path, body)).json()) as T;
}

export async function apiBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  return (await call(method, path, body)).blob();
}
```

`packages/panel/src/main.ts`:
```ts
import { api, apiBlob, withToken } from "./api.js";
import { t, type Key, type UiLang } from "./i18n.js";

type Lang = "es" | "en";
type CredentialName = "anthropic" | "elevenlabs" | "deepgram" | "openai";
interface Config {
  appUrl: string;
  startUrl: string;
  base: string;
  languages: Lang[];
  uiLanguage: Lang;
  mode: "api" | "plugin";
  model: string;
  effort: string;
  maxSteps: number;
  voice: { provider: string; voices: Partial<Record<Lang, string>>; model?: string; speed: number; fallback: string[]; command?: string };
}
interface KeyStatus {
  set: boolean;
  masked: string;
  source: "env" | "file" | null;
}
interface GuideInfo {
  id: string;
  title: Partial<Record<Lang, string>>;
  languages: Lang[];
  steps: { narration: Partial<Record<Lang, string>>; audio?: Partial<Record<Lang, string>> }[];
  videos: string[];
}
interface State {
  version: string;
  cwd: string;
  config: Config;
  configError: string | null;
  credentials: Record<CredentialName, KeyStatus>;
  guides: GuideInfo[];
}
type JobEvent = { type: "log"; message: string } | { type: "shot"; data: string } | { type: "done"; guide: string; videos: string[] } | { type: "error"; message: string };

const LANGS: Lang[] = ["es", "en"];
const PROVIDERS = ["elevenlabs", "deepgram", "openai", "piper", "command", "browser"] as const;
const KEY_OF: Partial<Record<string, CredentialName>> = { elevenlabs: "elevenlabs", deepgram: "deepgram", openai: "openai" };

let lang: UiLang = "es";
let state: State;

type Child = Node | string | null | false | undefined;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(name, value);
  for (const child of children) if (child !== null && child !== false && child !== undefined) node.append(child);
  return node;
}

const tr = (key: Key, params?: Record<string, string | number>) => t(lang, key, params);

function toast(text: string, error = false): void {
  const node = document.getElementById("toast")!;
  node.textContent = text;
  node.className = error ? "show error" : "show";
  window.setTimeout(() => (node.className = ""), 4000);
}

const failMessage = (error: unknown) => tr("error", { error: (error as Error).message });

function button(label: string, onClick: () => unknown, kind = ""): HTMLButtonElement {
  const node = el("button", { type: "button", class: kind || undefined }, label);
  node.addEventListener("click", () => void onClick());
  return node;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  return el("label", { class: "field" }, el("span", {}, label), control);
}

function textInput(value: string, type = "text"): HTMLInputElement {
  const node = el("input", { type });
  node.value = value;
  return node;
}

function choice(options: [string, string][], value: string): HTMLSelectElement {
  const node = el("select");
  for (const [optionValue, label] of options) node.append(el("option", { value: optionValue }, label));
  node.value = value;
  return node;
}

function check(label: string, checked: boolean): [HTMLLabelElement, HTMLInputElement] {
  const box = el("input", { type: "checkbox" });
  box.checked = checked;
  return [el("label", { class: "check" }, box, el("span", {}, label)), box];
}

function section(id: string, title: Key, ...body: Child[]): HTMLElement {
  return el("section", { id, class: "card" }, el("h2", {}, tr(title)), ...body);
}

async function save(patch: Record<string, unknown>): Promise<void> {
  try {
    state.config = (await api<{ config: Config }>("PUT", "/api/config", patch)).config;
    if (patch.uiLanguage) lang = state.config.uiLanguage;
    render();
    toast(tr("saved"));
  } catch (error) {
    toast(failMessage(error), true);
  }
}

function keyControl(name: CredentialName): HTMLElement {
  const info = state.credentials[name];
  const statusText = info.set ? `${tr("keySet", { masked: info.masked })}${info.source === "env" ? ` ${tr("keyFromEnv")}` : ""}` : tr("keyMissing");
  const value = textInput("", "password");
  value.autocomplete = "off";
  const update = async (method: "PUT" | "DELETE") => {
    try {
      state.credentials = (await api<{ credentials: State["credentials"] }>(method, `/api/credentials/${name}`, method === "PUT" ? { value: value.value } : undefined)).credentials;
      render();
      toast(tr("saved"));
    } catch (error) {
      toast(failMessage(error), true);
    }
  };
  return el(
    "div",
    { class: "key" },
    field(tr("apiKey"), value),
    el("p", { class: "hint" }, statusText),
    el("div", { class: "actions" }, button(tr("saveKey"), () => update("PUT")), info.source === "file" ? button(tr("remove"), () => update("DELETE"), "secondary") : null),
  );
}

function projectSection(): HTMLElement {
  const c = state.config;
  const appUrl = textInput(c.appUrl, "url");
  const startUrl = textInput(c.startUrl);
  const base = textInput(c.base);
  const login = async () => {
    toast(tr("loginHint"));
    try {
      await api("POST", "/api/login");
      toast(tr("loginDone"));
    } catch (error) {
      toast(failMessage(error), true);
    }
  };
  return section(
    "project",
    "project",
    field(tr("appUrl"), appUrl),
    field(tr("startUrl"), startUrl),
    field(tr("base"), base),
    el("div", { class: "actions" }, button(tr("save"), () => save({ appUrl: appUrl.value, startUrl: startUrl.value, base: base.value })), button(tr("login"), login, "secondary")),
  );
}

function languagesSection(): HTMLElement {
  const c = state.config;
  const ui = choice(LANGS.map((l): [string, string] => [l, tr(`lang.${l}`)]), c.uiLanguage);
  const boxes = LANGS.map((l) => check(tr(`lang.${l}`), c.languages.includes(l)));
  return section(
    "languages",
    "languages",
    field(tr("uiLanguage"), ui),
    el("fieldset", {}, el("legend", {}, tr("narration")), ...boxes.map(([label]) => label)),
    el("div", { class: "actions" }, button(tr("save"), () => save({ uiLanguage: ui.value, languages: LANGS.filter((_, i) => boxes[i]![1].checked) }))),
  );
}

function aiSection(): HTMLElement {
  const c = state.config;
  const mode = choice([["api", tr("mode.api")], ["plugin", tr("mode.plugin")]], c.mode);
  const models: [string, string][] = [["claude-opus-5-5", tr("model.opus")], ["claude-sonnet-5-5", tr("model.sonnet")]];
  if (!models.some(([id]) => id === c.model)) models.push([c.model, c.model]);
  const model = choice(models, c.model);
  const effort = choice(["low", "medium", "high", "xhigh", "max"].map((e): [string, string] => [e, e]), c.effort);
  const maxSteps = textInput(String(c.maxSteps), "number");
  maxSteps.min = "1";
  maxSteps.max = "40";
  const body: Child[] =
    c.mode === "plugin"
      ? [el("p", { class: "hint" }, tr("pluginHelp"))]
      : [keyControl("anthropic"), field(tr("model"), model), field(tr("effort"), effort), field(tr("maxSteps"), maxSteps)];
  return section(
    "ai",
    "ai",
    field(tr("mode"), mode),
    ...body,
    el("div", { class: "actions" }, button(tr("save"), () => save(c.mode === "plugin" || mode.value === "plugin" ? { mode: mode.value } : { mode: mode.value, model: model.value, effort: effort.value, maxSteps: Number(maxSteps.value) }))),
  );
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function voiceSection(): HTMLElement {
  const v = state.config.voice;
  const provider = choice(PROVIDERS.map((p): [string, string] => [p, tr(`provider.${p}`)]), v.provider);
  provider.addEventListener("change", () => void save({ voice: { provider: provider.value } }));
  const voices = Object.fromEntries(LANGS.map((l) => [l, textInput(v.voices[l] ?? "")])) as Record<Lang, HTMLInputElement>;
  const tryVoice = async (l: Lang) => {
    try {
      const blob = await apiBlob("POST", "/api/voice/test", { lang: l, provider: provider.value, voice: voices[l].value || undefined, text: t(l, "testText") });
      await new Audio(URL.createObjectURL(blob)).play();
    } catch (error) {
      toast(failMessage(error), true);
    }
  };
  const speed = textInput(String(v.speed), "range");
  Object.assign(speed, { min: "0.5", max: "2", step: "0.05" });
  const fallbacks = PROVIDERS.filter((p) => p !== "browser").map((p) => [p, check(tr(`provider.${p}`), v.fallback.includes(p))] as const);
  const command = textInput(v.command ?? "");
  const key = KEY_OF[v.provider];
  const isBrowser = v.provider === "browser";
  const saveVoice = () =>
    save({
      voice: {
        provider: provider.value,
        voices: Object.fromEntries(LANGS.map((l) => [l, voices[l].value.trim() || null])),
        speed: Number(speed.value),
        fallback: fallbacks.filter(([, [, box]]) => box.checked).map(([p]) => p),
        command: command.value.trim() || null,
      },
    });
  return section(
    "voice",
    "voice",
    field(tr("provider"), provider),
    isBrowser ? el("p", { class: "hint" }, tr("browserHelp")) : null,
    key ? keyControl(key) : null,
    ...(isBrowser ? [] : LANGS.map((l) => el("div", { class: "row" }, field(tr("voiceFor", { lang: tr(`lang.${l}`) }), voices[l]), button(tr("test"), () => tryVoice(l), "secondary")))),
    v.provider === "command" ? field(tr("command"), command) : null,
    v.provider === "command" ? el("p", { class: "hint" }, tr("commandHelp")) : null,
    field(`${tr("speed")} (${v.speed}×)`, speed),
    el("fieldset", {}, el("legend", {}, tr("fallback")), ...fallbacks.map(([, [label]]) => label)),
    el("div", { class: "actions" }, button(tr("save"), saveVoice)),
    v.provider === "elevenlabs" ? cloneBox(voices) : null,
  );
}

function cloneBox(voices: Record<Lang, HTMLInputElement>): HTMLElement {
  const name = textInput("explicame");
  const files = el("input", { type: "file", multiple: "", accept: "audio/*" });
  const [consentLabel, consent] = check(tr("cloneConsent"), false);
  const clone = async () => {
    if (!consent.checked) return toast(tr("cloneNeedsConsent"), true);
    try {
      const payload = await Promise.all(Array.from(files.files ?? []).map(async (file) => ({ name: file.name, data: await toBase64(file) })));
      const { voiceId } = await api<{ voiceId: string }>("POST", "/api/voice/clone", { name: name.value || "explicame", consent: true, files: payload });
      for (const l of LANGS) voices[l].value = voiceId;
      toast(tr("cloned", { id: voiceId }));
    } catch (error) {
      toast(failMessage(error), true);
    }
  };
  return el("details", { class: "clone" }, el("summary", {}, tr("clone")), field(tr("cloneName"), name), field(tr("cloneFiles"), files), consentLabel, el("div", { class: "actions" }, button(tr("cloneButton"), clone)));
}

function titleOf(guide: GuideInfo): string {
  return guide.title[lang] ?? Object.values(guide.title)[0] ?? guide.id;
}

function generateSection(): HTMLElement {
  const c = state.config;
  const status = el("p", { class: "status", role: "status" });
  const log = el("ol", { class: "log" });
  const shots = el("div", { class: "shots" });
  const [videoLabel, video] = check(tr("video"), false);
  const start = async (request: Record<string, unknown>) => {
    log.replaceChildren();
    shots.replaceChildren();
    status.textContent = tr("running");
    try {
      const { id } = await api<{ id: string }>("POST", "/api/jobs", request);
      const source = new EventSource(withToken(`/api/jobs/${id}/events`));
      source.onmessage = (message) => {
        const event = JSON.parse(message.data as string) as JobEvent;
        if (event.type === "log") log.append(el("li", {}, event.message));
        if (event.type === "shot") shots.append(el("img", { src: `data:image/jpeg;base64,${event.data}`, alt: "" }));
        if (event.type === "done" || event.type === "error") {
          source.close();
          status.textContent = event.type === "done" ? tr("done") : tr("failed", { error: event.message });
          void refreshResults();
        }
      };
    } catch (error) {
      status.textContent = failMessage(error);
    }
  };
  let body: Child[];
  if (c.mode === "api") {
    const describe = el("textarea", { rows: "3" });
    const files = el("textarea", { rows: "2" });
    body = [
      field(tr("describe"), describe),
      field(tr("files"), files),
      videoLabel,
      el("div", { class: "actions" }, button(tr("start"), () => start({ kind: "build", describe: describe.value.trim() || undefined, files: files.value.split("\n").map((s) => s.trim()).filter(Boolean), video: video.checked }))),
    ];
  } else {
    const guide = choice(state.guides.map((g): [string, string] => [g.id, titleOf(g)]), state.guides[0]?.id ?? "");
    body = [
      el("p", { class: "hint" }, tr("pluginHelp")),
      field(tr("pickGuide"), guide),
      videoLabel,
      el("div", { class: "actions" }, button(tr("voiceOnly"), () => (guide.value ? start({ kind: "from-guide", guide: guide.value, video: video.checked }) : undefined))),
    ];
  }
  return section("generate", "generate", ...body, status, log, shots);
}

function guideCard(guide: GuideInfo): HTMLElement {
  const steps = el(
    "ol",
    { class: "steps" },
    ...guide.steps.map((step) =>
      el(
        "li",
        {},
        ...guide.languages.map((l) => {
          const audio = step.audio?.[l];
          return el("div", { class: "step" }, el("p", {}, step.narration[l] ?? ""), audio ? el("audio", { controls: "", preload: "none", src: withToken(`/files/output/${guide.id}/${audio}`) }) : null);
        }),
      ),
    ),
  );
  const videos = guide.videos.map((file) =>
    el(
      "figure",
      {},
      el("video", { controls: "", preload: "metadata", src: withToken(`/files/videos/${file}`) }),
      el("figcaption", {}, el("a", { href: withToken(`/files/videos/${file}`), download: file }, `${tr("download")} ${file}`)),
    ),
  );
  return el(
    "details",
    { class: "guide" },
    el("summary", {}, `${titleOf(guide)} · ${tr("steps", { n: guide.steps.length })}`),
    steps,
    ...videos,
    el("p", {}, el("a", { href: withToken(`/files/output/${guide.id}/guide.json`), download: `${guide.id}.json` }, `${tr("download")} guide.json`)),
  );
}

function resultsSection(): HTMLElement {
  return section("results", "results", ...(state.guides.length ? state.guides.map(guideCard) : [el("p", { class: "hint" }, tr("noGuides"))]));
}

async function refreshResults(): Promise<void> {
  state = await api<State>("GET", "/api/state");
  document.getElementById("results")?.replaceWith(resultsSection());
}

function render(): void {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((node) => (node.textContent = tr(node.dataset.t as Key)));
  document.querySelectorAll<HTMLButtonElement>("[data-ui-lang]").forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.uiLang === lang)));
  document.getElementById("app")!.replaceChildren(
    state.configError ? el("p", { class: "status error" }, state.configError) : "",
    projectSection(),
    languagesSection(),
    aiSection(),
    voiceSection(),
    generateSection(),
    resultsSection(),
  );
}

async function main(): Promise<void> {
  document.querySelectorAll<HTMLButtonElement>("[data-ui-lang]").forEach((node) =>
    node.addEventListener("click", () => {
      lang = node.dataset.uiLang as UiLang;
      render();
    }),
  );
  try {
    state = await api<State>("GET", "/api/state");
    lang = state.config.uiLanguage;
    render();
  } catch (error) {
    document.getElementById("app")!.replaceChildren(el("p", { class: "status error" }, failMessage(error)));
  }
}

void main();
```

`packages/panel/src/styles.css`:
```css
:root {
  --bg: #f6f7fb;
  --card: #ffffff;
  --text: #1c2033;
  --muted: #5c6378;
  --accent: #4f46e5;
  --accent-text: #ffffff;
  --border: #dfe2ec;
  --error: #b42318;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #11131c;
    --card: #1a1d29;
    --text: #eceef6;
    --muted: #a3a9be;
    --accent: #8b85ff;
    --accent-text: #0f1020;
    --border: #2c3144;
    --error: #ff8a80;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 24px; border-bottom: 1px solid var(--border); background: var(--card); position: sticky; top: 0; z-index: 1; }
.top h1 { margin: 0; font-size: 20px; }
.sub { color: var(--muted); font-weight: 400; font-size: 14px; }
.langs button[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); }
main { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; display: grid; gap: 16px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.card h2 { margin: 0 0 12px; font-size: 17px; }
.field { display: grid; gap: 4px; margin: 0 0 12px; }
.field > span { color: var(--muted); font-size: 13px; }
input, select, textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
input[type="checkbox"], input[type="range"] { width: auto; }
fieldset { border: 1px solid var(--border); border-radius: 8px; margin: 0 0 12px; padding: 8px 12px; }
legend { color: var(--muted); font-size: 13px; }
.check { display: inline-flex; gap: 8px; align-items: center; margin: 4px 16px 4px 0; }
.row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
.row .field { margin: 0 0 12px; }
.row button { margin-bottom: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
button { border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text); padding: 8px 14px; border-radius: 8px; font: inherit; cursor: pointer; }
button.secondary, .langs button { background: transparent; color: var(--accent); }
.hint { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
.status { font-weight: 600; }
.status.error { color: var(--error); }
.log { max-height: 220px; overflow: auto; font: 12px/1.5 ui-monospace, monospace; color: var(--muted); }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
.shots img { width: 100%; border: 1px solid var(--border); border-radius: 6px; }
.guide { border-top: 1px solid var(--border); padding: 8px 0; }
.guide summary { cursor: pointer; font-weight: 600; }
.step { display: grid; gap: 4px; margin: 6px 0; }
.step p { margin: 0; }
audio, video { width: 100%; }
.clone { margin-top: 16px; }
#toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 8px 16px; border-radius: 8px; opacity: 0; transition: opacity 0.2s; pointer-events: none; max-width: 90vw; }
#toast.show { opacity: 1; }
#toast.error { background: var(--error); color: #fff; }
@media (prefers-reduced-motion: reduce) { #toast { transition: none; } }
```

- [ ] **Step 4: El comando `panel`**

En `packages/cli/src/cli.ts`:
- agregar los imports `import { spawn } from "node:child_process";` y `import { startPanel } from "./panel/server.js";`, y sumar `ConfigSchema` al import de `./config.js`;
- después de las funciones auxiliares (antes de `export function createProgram`), agregar:

```ts
/** Opens the default browser without a shell argument that could be re-read (the URL is our own). */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(command, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}
```

- antes de `return program;`:

```ts
  program
    .command("panel")
    .description("panel local en el navegador · local panel in your browser")
    .option("--port <port>", "puerto (por defecto 4747)", "4747")
    .option("--no-open", "no abrir el navegador")
    .action(async (opts: { port: string; open: boolean }) => {
      const cwd = process.cwd();
      // The panel is where a broken config gets fixed, so it starts with the defaults' language if it cannot read it.
      const uiLang = (await loadConfig(cwd).catch(() => ConfigSchema.parse({}))).uiLanguage;
      try {
        const panel = await startPanel({ cwd, home: explicameHome(), port: Number(opts.port) });
        console.log(t(uiLang, "panel.ready", { url: panel.url }));
        if (opts.open) openBrowser(panel.url);
        await new Promise<void>((done) => process.once("SIGINT", () => done()));
        await panel.close();
      } catch (error) {
        const message = (error as NodeJS.ErrnoException).code === "EADDRINUSE" ? t(uiLang, "panel.portBusy", { port: opts.port }) : (error as Error).message;
        console.error(message);
        process.exitCode = 2;
      }
    });
```

En `packages/cli/test/cli.test.ts`, en la prueba de `--help`, después de `expect(help).toContain("mcp");` agregar `expect(help).toContain("panel");`.

- [ ] **Step 5: Construir y ejecutar las pruebas para verlas pasar**

Run: `npm run build && npx vitest run packages/cli/test/panelUi.test.ts packages/cli/test/panel.test.ts packages/cli/test/cli.test.ts`
Expected: PASS.

- [ ] **Step 6: Suite, tipos y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: todo en verde.

- [ ] **Step 7: Vista manual**

Run: `node packages/cli/dist/bin.js panel --no-open --port 4747` en `examples/demo-app` y abrir la URL impresa con el navegador del sistema (o Playwright) para una captura de cada sección en ES y EN.
Expected: las seis secciones se ven bien a 375 px y a 1280 px de ancho, en modo claro y oscuro.

- [ ] **Step 8: Commit**

```bash
git add packages/panel packages/cli/src/cli.ts packages/cli/test/panelUi.test.ts packages/cli/test/cli.test.ts
git commit -m "feat(panel): interfaz bilingüe del panel y comando explicame panel"
```
