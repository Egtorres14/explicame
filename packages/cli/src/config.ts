import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { LANGUAGES, t, type Lang } from "@explicame/core";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const VOICE_PROVIDERS = ["elevenlabs", "deepgram", "openai", "piper", "command", "browser", "fake"] as const;

export const ConfigSchema = z.strictObject({
  appUrl: z.url().default("http://localhost:5173"),
  startUrl: z.string().startsWith("/").default("/"),
  base: z.string().min(1).default("main"),
  languages: z.array(z.enum(LANGUAGES)).min(1).default(["es", "en"]),
  uiLanguage: z.enum(LANGUAGES).default("es"),
  mode: z.enum(["api", "plugin"]).default("api"),
  model: z.string().min(1).default("claude-opus-5-5"),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  maxSteps: z.number().int().min(1).max(40).default(15),
  voice: z
    .strictObject({
      provider: z.enum(VOICE_PROVIDERS).default("elevenlabs"),
      voices: z.partialRecord(z.enum(LANGUAGES), z.string().min(1)).default({}),
      model: z.string().min(1).optional(),
      speed: z.number().min(0.5).max(2).default(1),
      fallback: z.array(z.enum(VOICE_PROVIDERS)).default([]),
      /** Local TTS command for provider "command", e.g. "kokoro {textFile} {out} --voice {voice}". */
      command: z.string().min(1).optional(),
    })
    .prefault({}),
  outputDir: z.string().min(1).default("public/explicame"),
  videoDir: z.string().min(1).default(".explicame/videos"),
  safety: z
    .strictObject({
      allowRequests: z.array(z.strictObject({ method: z.string().min(1), url: z.string().min(1) })).default([]),
    })
    .prefault({}),
});
export type Config = z.infer<typeof ConfigSchema>;

const SECRET_KEY = /(api[-_]?key|token|secret|password)/i;

export function findSecretKey(value: unknown, path = ""): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) return here;
    const nested = findSecretKey(inner, here);
    if (nested) return nested;
  }
  return null;
}

export async function loadConfig(cwd: string): Promise<Config> {
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(join(cwd, "explicame.config.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(t("es", "config.invalid", { errors: (error as Error).message }));
    }
  }
  const declared = (raw as { uiLanguage?: unknown }).uiLanguage;
  const lang: Lang = declared === "en" ? "en" : "es";
  const secret = findSecretKey(raw);
  if (secret) throw new ConfigError(t(lang, "config.secretInConfig", { key: secret }));
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(t(lang, "config.invalid", { errors }));
  }
  return result.data;
}
