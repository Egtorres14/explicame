import type { Lang, LocalizedText } from "@explicame/core";
import { retryableStatus, VoiceError, type VoiceProvider } from "./provider.js";

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
      if (!response.ok) throw new VoiceError(`Deepgram ${response.status}: ${(await response.text()).slice(0, 200)}`, retryableStatus(response.status));
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
