import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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

async function readCredentialsFile(home: string): Promise<Credentials> {
  try {
    return JSON.parse(await readFile(join(home, "credentials.json"), "utf8")) as Credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ConfigError(`credentials.json: ${(error as Error).message}`);
    return {};
  }
}

export async function loadCredentials(env: NodeJS.ProcessEnv = process.env, home: string = explicameHome(env)): Promise<Credentials> {
  const file = await readCredentialsFile(home);
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

export interface CredentialStatus {
  set: boolean;
  /** Only the last four characters, never the key. */
  masked: string;
  source: "env" | "file" | null;
}

/** What the panel may know about each key: whether it is set, where from, and its last four characters. */
export async function describeCredentials(env: NodeJS.ProcessEnv, home: string): Promise<Record<keyof Credentials, CredentialStatus>> {
  const file = await readCredentialsFile(home);
  const out = {} as Record<keyof Credentials, CredentialStatus>;
  for (const name of Object.keys(CREDENTIAL_ENV) as (keyof Credentials)[]) {
    const fromEnv = env[CREDENTIAL_ENV[name]];
    const value = fromEnv ?? file[name];
    out[name] = value ? { set: true, masked: maskKey(value), source: fromEnv ? "env" : "file" } : { set: false, masked: "", source: null };
  }
  return out;
}

/** Stores (or removes, with null) one key in ~/.explicame/credentials.json, readable only by the user. */
export async function saveCredential(home: string, name: keyof Credentials, value: string | null): Promise<void> {
  const current = await readCredentialsFile(home);
  if (value) current[name] = value.trim();
  else delete current[name];
  await mkdir(home, { recursive: true });
  const file = join(home, "credentials.json");
  await writeFile(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
}
