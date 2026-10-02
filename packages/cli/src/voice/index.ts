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
