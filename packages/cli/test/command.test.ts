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
