import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { t, type Lang } from "@explicame/core";
import { ConfigError } from "./config.js";

export interface Credentials {
  anthropic?: string;
  elevenlabs?: string;
  deepgram?: string;
  openai?: string;
}

export const CREDENTIAL_ENV: Record<keyof Credentials, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  openai: "OPENAI_API_KEY",
};

const CREDENTIAL_LABEL: Record<keyof Credentials, string> = {
  anthropic: "Claude (Anthropic)",
  elevenlabs: "ElevenLabs",
  deepgram: "Deepgram",
  openai: "OpenAI",
};

export function explicameHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.EXPLICAME_HOME ?? join(homedir(), ".explicame");
}

export async function loadCredentials(env: NodeJS.ProcessEnv = process.env, home: string = explicameHome(env)): Promise<Credentials> {
  let file: Credentials = {};
  try {
    file = JSON.parse(await readFile(join(home, "credentials.json"), "utf8")) as Credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ConfigError(`credentials.json: ${(error as Error).message}`);
  }
  const out: Credentials = {};
  for (const name of Object.keys(CREDENTIAL_ENV) as (keyof Credentials)[]) {
    const value = env[CREDENTIAL_ENV[name]] ?? file[name];
    if (value) out[name] = value;
  }
  return out;
}

export function requireCredential(creds: Credentials, name: keyof Credentials, lang: Lang): string {
  const value = creds[name];
  if (!value) throw new ConfigError(t(lang, "credentials.missing", { name: CREDENTIAL_LABEL[name], env: CREDENTIAL_ENV[name] }));
  return value;
}

export function maskKey(key: string): string {
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}
