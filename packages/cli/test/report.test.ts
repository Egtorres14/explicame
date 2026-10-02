import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { openSession } from "../src/browser/session.js";
import { createFakeDriver } from "../src/generate/fakeDriver.js";
import { runExploration } from "../src/generate/loop.js";
import { writeReport } from "../src/report.js";
import { verifyGuide } from "../src/verify.js";
import { startServer, type TestServer } from "./helpers/server.js";

const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
let server: TestServer;
beforeAll(async () => {
  server = await startServer(SITE);
});
afterAll(async () => {
  await server.close();
});

describe("failure report", () => {
  it("saves a screenshot of the failing step when a report folder is given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explicame-report-"));
    const guide: Guide = {
      schemaVersion: 1, id: "roto", languages: ["es"], title: { es: "Roto" }, startUrl: "/",
      steps: [{ narration: { es: "No existe." }, target: { strategies: [{ by: "css", value: "#no-existe" }] }, action: { type: "click" } }],
      source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
    };
    const [failure] = await verifyGuide(guide, () => openSession({ appUrl: server.url, startUrl: "/" }), { timeoutMs: 300, reportDir: dir });
    expect(failure!.screenshot).toBe(join(dir, "step-01.png"));
    expect(existsSync(failure!.screenshot!)).toBe(true);
  });

  it("writes report.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explicame-report-"));
    const file = await writeReport(join(dir, "nested"), { error: "x", events: ["observe"] });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ error: "x", events: ["observe"] });
  });
});

describe("token budget", () => {
  it("stops the exploration when the conversation exceeds the budget", async () => {
    const session = await openSession({ appUrl: server.url, startUrl: "/" });
    const fake = createFakeDriver({ turns: [[{ name: "observe", input: {} }], [{ name: "observe", input: {} }]] });
    const driver = { ...fake, usage: () => ({ inputTokens: 10, outputTokens: 0 }) };
    try {
      await expect(
        runExploration({
          driver, session, languages: ["es"], maxSteps: 5, tokenBudget: 5, appUrl: server.url, startUrl: "/",
          context: { base: "a", head: "b", commit: "c", diff: "diff --git a/x b/x\n+x\n", files: [], omittedFiles: [] },
        }),
      ).rejects.toThrow(/token budget/);
    } finally {
      await session.close();
    }
  });
});
