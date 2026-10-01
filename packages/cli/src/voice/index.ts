import type { Config } from "../config.js";
import type { Credentials } from "../credentials.js";
import { createElevenLabsProvider } from "./elevenlabs.js";
import { createFakeVoiceProvider } from "./fake.js";
import type { VoiceProvider } from "./provider.js";

/** Main provider first, then the fallbacks. Deepgram, OpenAI, Piper and command arrive in plan 4. */
export function buildVoiceProviders(config: Config, creds: Credentials): VoiceProvider[] {
  const ids = [config.voice.provider, ...config.voice.fallback.filter((id) => id !== config.voice.provider)];
  const providers: VoiceProvider[] = [];
  for (const id of ids) {
    if (id === "fake") providers.push(createFakeVoiceProvider());
    if (id === "elevenlabs" && creds.elevenlabs) providers.push(createElevenLabsProvider({ apiKey: creds.elevenlabs, model: config.voice.model }));
  }
  return providers;
}
