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
