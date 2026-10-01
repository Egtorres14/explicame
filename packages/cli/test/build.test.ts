import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../src/build.js";
import { ConfigError, ConfigSchema } from "../src/config.js";
import type { LlmDriver } from "../src/generate/driver.js";
import { createFakeDriver } from "../src/generate/fakeDriver.js";
import { LoopError } from "../src/generate/loop.js";
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
