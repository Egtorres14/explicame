import { VoiceError, type VoiceProvider } from "./provider.js";

export function createElevenLabsProvider(o: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): VoiceProvider {
  const model = o.model ?? "eleven_v4";
  const doFetch = o.fetchImpl ?? fetch;
  return {
    id: "elevenlabs",
    model,
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
