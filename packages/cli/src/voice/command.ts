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
  if (quote) throw new VoiceError(`voice.command has an unclosed quote: ${template}`, false);
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
  if (parts.length === 0) throw new VoiceError("voice.command is empty", false);
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
          throw new VoiceError(`voice.command failed: ${((error as Error).message.split("\n")[0] ?? "").slice(0, 200)}`, false);
        }
        if (existsSync(outMp3)) return await readFile(outMp3);
        if (existsSync(out)) return await toMp3(out, join(dir, "converted.mp3"), await o.ffmpeg());
        throw new VoiceError("voice.command wrote neither {out} nor {outMp3}", false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
