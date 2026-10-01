import type { VoiceProvider } from "./provider.js";

// One silent MPEG-1 Layer III frame: 128 kbps, 44.1 kHz, mono, no padding (417 bytes, 1152 samples).
const FRAME_SECONDS = 1152 / 44100;
const FRAME = (() => {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0xc0;
  return frame;
})();

export function silentMp3(seconds: number): Buffer {
  const frames = Math.max(1, Math.ceil(seconds / FRAME_SECONDS));
  return Buffer.concat(Array.from({ length: frames }, () => FRAME));
}

/** Silence whose length grows with the text (~15 characters per second); for tests and CI. */
export function createFakeVoiceProvider(): VoiceProvider {
  return {
    id: "fake",
    model: "silence",
    async synthesize(request) {
      return silentMp3(Math.max(1, request.text.length / 15));
    },
  };
}
