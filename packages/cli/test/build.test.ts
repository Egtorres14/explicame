import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { build, sessionPath } from "../src/build.js";
import { ConfigError, ConfigSchema } from "../src/config.js";
import type { LlmDriver } from "../src/generate/driver.js";
import { createFakeDriver } from "../src/generate/fakeDriver.js";
import { LoopError } from "../src/generate/loop.js";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
import { startServer, type TestServer } from "./helpers/server.js";

const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
let server: TestServer;
let cwd: string;
let home: string;
beforeAll(async () => {
  server = await startServer(SITE);
  cwd = await mkdtemp(join(tmpdir(), "explicame-build-"));
  home = await mkdtemp(join(tmpdir(), "explicame-build-home-"));
  await writeFile(join(cwd, "x.patch"), "diff --git a/a.ts b/a.ts\n+export {}\n");
});
afterAll(async () => {
  await server.close();
});

describe("sessionPath", () => {
  it("finds the same saved session for one Windows folder written two ways", () => {
    expect(sessionPath("H", "c:/users/ana/app", "win32")).toBe(sessionPath("H", "C:\\Users\\Ana\\App", "win32"));
    expect(sessionPath("H", "/home/ana/App", "linux")).not.toBe(sessionPath("H", "/home/ana/app", "linux"));
  });
});

describe("build guards", () => {
  it("validates --id before opening the browser or calling the AI", async () => {
    let started = false;
    const driver: LlmDriver = {
      id: "fake",
      async start() {
        started = true;
        throw new Error("the AI must not be called");
      },
      async reply() {
        throw new Error("the AI must not be called");
      },
      usage: () => ({ inputTokens: 0, outputTokens: 0 }),
    };
    const config = ConfigSchema.parse({ appUrl: server.url, outputDir: join(cwd, "out") });
    await expect(build({ cwd, config, credentials: {}, diffFile: "x.patch", id: "Bad Id", driver, home })).rejects.toBeInstanceOf(ConfigError);
    expect(started).toBe(false);
  });

  it("says where the failure report is, in the UI language", async () => {
    const logs: string[] = [];
    const driver = createFakeDriver({ turns: [[{ name: "observe", input: {} }]] });
    const config = ConfigSchema.parse({ appUrl: server.url, uiLanguage: "es", outputDir: join(cwd, "out") });
    const error = (await build({ cwd, config, credentials: {}, diffFile: "x.patch", driver, home, log: (m) => logs.push(m) }).catch((e: unknown) => e)) as Error & { reportDir?: string };
    expect(error).toBeInstanceOf(LoopError);
    expect(error.message).toBe("La IA terminó sin llamar a finish.");
    expect(error.reportDir).toBeDefined();
    expect(JSON.parse(await readFile(join(error.reportDir!, "report.json"), "utf8")).error).toBe(error.message);
    expect(logs.some((line) => line.includes(error.reportDir!))).toBe(true);
  });
});

const verified = (): Guide => ({
  schemaVersion: 1,
  id: "filtro-por-fecha",
  languages: ["es", "en"],
  title: { es: "Filtro por fecha", en: "Date filter" },
  startUrl: "/",
  steps: [
    { narration: { es: "Abre el filtro.", en: "Open the filter." }, target: { strategies: [{ by: "testid", value: "filtro-fecha" }] }, action: { type: "click" }, opens: "dialog" },
    { narration: { es: "Elige la fecha.", en: "Pick the date." }, target: { strategies: [{ by: "label", value: "Desde" }] }, action: { type: "type", value: "2026-09-01" } },
  ],
  source: { base: "main", head: "HEAD", commit: "abc1234", generatedBy: "claude-code", createdAt: "2026-10-01T00:00:00.000Z" },
});

describe("build --from-guide", () => {
  it("voices and publishes a verified guide without the AI, also in plugin mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explicame-from-"));
    await writeFile(join(dir, "guide.json"), JSON.stringify(verified()));
    const config = ConfigSchema.parse({ mode: "plugin", outputDir: "public/explicame", voice: { provider: "fake" } });
    const result = await build({ cwd: dir, config, credentials: {}, fromGuide: "guide.json", voiceProviders: [createFakeVoiceProvider()], home });
    const out = join(dir, "public", "explicame");
    expect(result.dir).toBe(join(out, "filtro-por-fecha"));
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(result.guide.steps[1]!.audio).toEqual({ es: "audio/es/02.mp3", en: "audio/en/02.mp3" });
    expect(existsSync(join(out, "filtro-por-fecha", "audio", "en", "02.mp3"))).toBe(true);
    expect(JSON.parse(await readFile(join(out, "guides.json"), "utf8"))).toEqual([
      { id: "filtro-por-fecha", title: { es: "Filtro por fecha", en: "Date filter" }, startUrl: "/", languages: ["es", "en"] },
    ]);
    expect(existsSync(join(out, "explicame-player.js"))).toBe(true);
  });

  it("says which guide it could not read", async () => {
    const config = ConfigSchema.parse({ outputDir: join(cwd, "out") });
    const error = await build({ cwd, config, credentials: {}, fromGuide: "no-existe.json", home }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toMatch(/^No pude leer la guía .*no-existe\.json/);
  });

  it("refuses to generate in plugin mode before reading the diff", async () => {
    const config = ConfigSchema.parse({ mode: "plugin", appUrl: server.url, outputDir: join(cwd, "out") });
    const error = await build({ cwd, config, credentials: {}, diffFile: "no-existe.patch", home }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain("explicame build --from-guide");
  });
});
