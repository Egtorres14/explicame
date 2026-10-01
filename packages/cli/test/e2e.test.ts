import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateGuide } from "@explicame/core";
import { build } from "../src/build.js";
import { ConfigSchema } from "../src/config.js";
import { createFakeDriver, loadFakeScript } from "../src/generate/fakeDriver.js";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
import { startServer, type TestServer } from "./helpers/server.js";

const DEMO = fileURLToPath(new URL("../../../examples/demo-app/", import.meta.url));
let server: TestServer;
let out: string;
let home: string;

beforeAll(async () => {
  await viteBuild({ root: DEMO, logLevel: "silent" });
  server = await startServer(join(DEMO, "dist"));
  out = await mkdtemp(join(tmpdir(), "explicame-e2e-out-"));
  home = await mkdtemp(join(tmpdir(), "explicame-e2e-home-"));
});
afterAll(async () => {
  await server.close();
});

describe("explicame build on the demo app", () => {
  it("goes from the patch to a verified, voiced, bilingual guide without writing anything to the app", async () => {
    const config = ConfigSchema.parse({ appUrl: server.url, startUrl: "/", languages: ["es", "en"], outputDir: out, voice: { provider: "fake" } });
    const driver = createFakeDriver(await loadFakeScript(join(DEMO, "explicame.fake-script.json")));
    const { guide, dir } = await build({
      cwd: DEMO, config, credentials: {}, diffFile: "feature.patch", driver, voiceProviders: [createFakeVoiceProvider()], home,
    });

    expect(guide.id).toBe("nuevo-filtro-por-fecha");
    expect(guide.steps).toHaveLength(6);
    expect(guide.steps[0]!.target!.strategies[0]).toEqual({ by: "testid", value: "filtro-fecha" });
    expect(guide.steps[4]!.action).toBeUndefined();
    expect(guide.source).toMatchObject({ base: "patch", head: "feature.patch", generatedBy: "fake" });
    for (const index of guide.steps.keys()) {
      for (const lang of ["es", "en"] as const) {
        expect(existsSync(join(dir, "audio", lang, `${String(index + 1).padStart(2, "0")}.mp3`))).toBe(true);
      }
    }
    const index = JSON.parse(await readFile(join(out, "guides.json"), "utf8")) as { id: string }[];
    expect(index.map((g) => g.id)).toEqual(["nuevo-filtro-por-fecha"]);
    expect(validateGuide(JSON.parse(await readFile(join(dir, "guide.json"), "utf8"))).ok).toBe(true);
    expect(server.hits.filter((hit) => hit.method !== "GET")).toEqual([]);
  }, 120_000);
});
