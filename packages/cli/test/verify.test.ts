import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { openSession } from "../src/browser/session.js";
import { createFakeDriver } from "../src/generate/fakeDriver.js";
import { VerifyError, verifyAndRepair, verifyGuide } from "../src/verify.js";
import { startServer, type TestServer } from "./helpers/server.js";

const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
let server: TestServer;
beforeAll(async () => {
  server = await startServer(SITE);
});
afterAll(async () => {
  await server.close();
});
const open = () => openSession({ appUrl: server.url, startUrl: "/" });

const guide = (): Guide => ({
  schemaVersion: 1,
  id: "filtro",
  languages: ["es"],
  title: { es: "Filtro" },
  startUrl: "/",
  steps: [
    { narration: { es: "Abre el filtro." }, target: { strategies: [{ by: "testid", value: "filtro-fecha" }] }, action: { type: "click" }, opens: "dialog" },
    { narration: { es: "Elige la fecha." }, target: { strategies: [{ by: "label", value: "Desde" }] }, action: { type: "type", value: "2026-09-01" } },
    { narration: { es: "Aplica." }, target: { strategies: [{ by: "role", role: "button", name: "Aplicar" }] }, action: { type: "click" } },
  ],
  source: { base: "main", head: "feature", commit: "abc1234", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
});

const broken = (): Guide => {
  const g = guide();
  g.steps[1]!.target = { strategies: [{ by: "css", value: "#no-existe" }] };
  return g;
};

describe("verifyGuide", () => {
  it("replays a correct guide without failures", async () => {
    expect(await verifyGuide(guide(), open, { timeoutMs: 500 })).toEqual([]);
  });

  it("stops at the first step whose target is gone", async () => {
    expect(await verifyGuide(broken(), open, { timeoutMs: 500 })).toEqual([{ index: 1, error: "target not found on the screen" }]);
  });
});

describe("verifyAndRepair", () => {
  it("reports failures in the UI language", async () => {
    const driver = createFakeDriver({ turns: [] });
    await expect(verifyAndRepair({ guide: broken(), driver, pendingResults: [], open, timeoutMs: 500, lang: "es" })).rejects.toThrow(/El paso 2 no se pudo verificar/);
  });

  it("lets the model replace the failing step once", async () => {
    const driver = createFakeDriver({
      turns: [[{ name: "add_step", input: { narration: { es: "Elige la fecha." }, element: { label: "Desde" }, action: "type", value: "2026-09-01", url: null, opens: null } }]],
    });
    const repaired = await verifyAndRepair({ guide: broken(), driver, pendingResults: [], open, timeoutMs: 500 });
    expect(repaired.steps[1]!.target!.strategies).toContainEqual({ by: "label", value: "Desde" });
    expect(driver.notes[0]).toContain("step 2 failed");
  });

  it("gives up with VerifyError when the repair does not work", async () => {
    const driver = createFakeDriver({
      turns: [[{ name: "add_step", input: { narration: { es: "Otra cosa." }, element: { label: "No existe" }, action: null, value: null, url: null, opens: null } }]],
    });
    await expect(verifyAndRepair({ guide: broken(), driver, pendingResults: [], open, timeoutMs: 500 })).rejects.toBeInstanceOf(VerifyError);
  });
});
