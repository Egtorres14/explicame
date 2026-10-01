import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";
import { loadCredentials, maskKey, requireCredential } from "../src/credentials.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "explicame-cfg-"));
});

describe("loadConfig", () => {
  it("uses the defaults when there is no config file", async () => {
    const config = await loadConfig(dir);
    expect(config).toMatchObject({
      appUrl: "http://localhost:5173", startUrl: "/", base: "main", languages: ["es", "en"], uiLanguage: "es",
      mode: "api", model: "claude-opus-5-5", effort: "high", maxSteps: 15, outputDir: "public/explicame",
    });
    expect(config.voice).toEqual({ provider: "elevenlabs", voices: {}, speed: 1, fallback: [] });
    expect(config.safety.allowRequests).toEqual([]);
  });

  it("merges a partial file with the defaults", async () => {
    await writeFile(join(dir, "explicame.config.json"), JSON.stringify({ languages: ["es"], voice: { provider: "fake" } }));
    const config = await loadConfig(dir);
    expect(config.languages).toEqual(["es"]);
    expect(config.voice.provider).toBe("fake");
    expect(config.voice.speed).toBe(1);
  });

  it("refuses keys inside the config file", async () => {
    await writeFile(join(dir, "explicame.config.json"), JSON.stringify({ voice: { apiKey: "sk_123" } }));
    await expect(loadConfig(dir)).rejects.toThrow(/voice\.apiKey/);
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError);
  });

  it("explains invalid values", async () => {
    await writeFile(join(dir, "explicame.config.json"), JSON.stringify({ maxSteps: 99 }));
    await expect(loadConfig(dir)).rejects.toThrow(/maxSteps/);
  });
});

describe("credentials", () => {
  it("prefers environment variables over the credentials file", async () => {
    await writeFile(join(dir, "credentials.json"), JSON.stringify({ anthropic: "from-file", elevenlabs: "el-file" }));
    const creds = await loadCredentials({ ANTHROPIC_API_KEY: "from-env" }, dir);
    expect(creds).toEqual({ anthropic: "from-env", elevenlabs: "el-file" });
  });

  it("names the environment variable when a key is missing", () => {
    expect(() => requireCredential({}, "anthropic", "es")).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("masks keys", () => {
    expect(maskKey("sk_abcd1234")).toBe("••••1234");
    expect(maskKey("abc")).toBe("••••");
  });
});
