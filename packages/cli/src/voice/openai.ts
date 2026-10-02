import type { Lang, LocalizedText } from "@explicame/core";
import { retryableStatus, VoiceError, type VoiceProvider } from "./provider.js";

export const OPENAI_VOICE = "coral";

/** gpt-4o-mini-tts follows instructions about accent and tone; tts-1 and tts-1-hd do not accept them. */
const INSTRUCTIONS: Record<Lang, string> = {
  es: "Habla en español latinoamericano neutro, con tono cálido, claro y profesional, como quien enseña a usar una aplicación.",
  en: "Speak in clear, friendly American English, like someone showing a colleague how to use an app.",
};

/** gpt-4o-mini-tts ignores the speed parameter (OpenAI community reports), so the pace is also asked for in words. */
const PACE: Record<Lang, (speed: number) => string> = {
  es: (speed) => ` Habla a unas ${speed} veces tu ritmo normal.`,
  en: (speed) => ` Speak at about ${speed} times your normal pace.`,
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
      if (!model.startsWith("tts-1")) body.instructions = INSTRUCTIONS[request.lang] + (request.speed !== 1 ? PACE[request.lang](request.speed) : "");
      const response = await doFetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new VoiceError(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`, retryableStatus(response.status));
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
