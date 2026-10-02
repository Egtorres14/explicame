import type { LocalizedText } from "@explicame/core";
import { VoiceError, type VoiceProvider } from "./provider.js";

export function createElevenLabsProvider(o: { apiKey: string; model?: string; voices?: LocalizedText; fetchImpl?: typeof fetch }): VoiceProvider {
  const model = o.model ?? "eleven_v4";
  const doFetch = o.fetchImpl ?? fetch;
  return {
    id: "elevenlabs",
    model,
    voiceFor: (lang) => o.voices?.[lang],
    async synthesize(request) {
      if (!request.voice) throw new VoiceError(`ElevenLabs needs a voice id for ${request.lang} (voice.voices.${request.lang})`);
      const response = await doFetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voice)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": o.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text: request.text,
            model_id: model,
            language_code: request.lang,
            voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: request.speed },
          }),
        },
      );
      if (!response.ok) throw new VoiceError(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

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
