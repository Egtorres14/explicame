import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSession } from "../src/browser/session.js";
import type { ChangeContext } from "../src/diff.js";
import { createFakeDriver, type FakeCall } from "../src/generate/fakeDriver.js";
import { LoopError, runExploration } from "../src/generate/loop.js";
import { startServer, type TestServer } from "./helpers/server.js";

const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
const CONTEXT: ChangeContext = {
  base: "main", head: "feature", commit: "abc1234",
  diff: "diff --git a/src/filter.ts b/src/filter.ts\n+export const filter = true;\n",
  files: [], omittedFiles: [],
};
const say = (es: string, en: string) => ({ es, en });
const addStep = (narration: { es: string; en: string }, element: Record<string, string> | null, action: string | null, value: string | null = null, opens: string | null = null): FakeCall => ({
  name: "add_step",
  input: { narration, ...(element ? { element } : { element_id: null }), action, value, url: null, opens },
});

let server: TestServer;
beforeAll(async () => {
  server = await startServer(SITE);
});
afterAll(async () => {
  await server.close();
});

async function explore(turns: FakeCall[][], maxSteps = 15) {
  const session = await openSession({ appUrl: server.url, startUrl: "/" });
  const driver = createFakeDriver({ turns });
  try {
    const result = await runExploration({ driver, session, languages: ["es", "en"], maxSteps, context: CONTEXT, appUrl: server.url, startUrl: "/" });
    return { result, driver };
  } finally {
    await session.close();
  }
}

describe("runExploration", () => {
  it("builds grounded steps and refuses to click a submit button", async () => {
    const { result, driver } = await explore([
      [{ name: "observe", input: {} }],
      [addStep(say("Con este botón abres el filtro.", "This button opens the filter."), { name: "Filtrar" }, "click", null, "dialog")],
      [addStep(say("Elige desde qué fecha.", "Pick the start date."), { label: "Desde" }, "type", "2026-09-01")],
      [addStep(say("Guardar deja el filtro por defecto.", "Save keeps the filter as default."), { name: "Guardar" }, "click")],
      [addStep(say("Guardar deja el filtro por defecto.", "Save keeps the filter as default."), { name: "Guardar" }, null)],
      [addStep(say("Aplicar filtra la tabla.", "Apply filters the table."), { name: "Aplicar" }, "click")],
      [{ name: "finish", input: { title: say("Nuevo filtro por fecha", "New date filter") } }],
    ]);
    expect(result.steps).toHaveLength(4);
    expect(result.steps[0]!.target!.strategies[0]).toEqual({ by: "testid", value: "filtro-fecha" });
    expect(result.steps[0]!.opens).toBe("dialog");
    expect(result.steps[1]!.action).toEqual({ type: "type", value: "2026-09-01" });
    expect(result.steps[2]!.action).toBeUndefined();
    expect(result.title).toEqual(say("Nuevo filtro por fecha", "New date filter"));
    const rejected = driver.received[3]!.find((r) => r.isError);
    expect(rejected?.content).toContain("submits a form");
    expect(result.pendingResults).toEqual([expect.objectContaining({ content: "ok" })]);
  });

  it("answers unknown elements, missing languages and the step limit with tool errors", async () => {
    const { result, driver } = await explore(
      [
        [{ name: "observe", input: {} }],
        [{ name: "add_step", input: { narration: say("Paso.", "Step."), element_id: "e999", action: null, value: null, url: null, opens: null } }],
        [{ name: "add_step", input: { narration: { es: "Solo español." }, element_id: null, action: null, value: null, url: null, opens: null } }],
        [addStep(say("Bienvenida.", "Welcome."), null, null)],
        [addStep(say("Otro paso.", "Another step."), null, null)],
        [{ name: "finish", input: { title: say("Guía", "Guide") } }],
      ],
      1,
    );
    expect(driver.received[1]![0]!.content).toContain("not on the current screen");
    expect(driver.received[2]![0]!.content).toContain("narration.en");
    expect(driver.received[4]![0]!.content).toContain("maximum of 1 steps");
    expect(result.steps).toHaveLength(1);
  });

  it("nudges once and then fails when the model never calls finish", async () => {
    const session = await openSession({ appUrl: server.url, startUrl: "/" });
    const driver = createFakeDriver({ turns: [[{ name: "observe", input: {} }]] });
    try {
      await expect(
        runExploration({ driver, session, languages: ["es", "en"], maxSteps: 15, context: CONTEXT, appUrl: server.url, startUrl: "/" }),
      ).rejects.toBeInstanceOf(LoopError);
      expect(driver.notes).toHaveLength(1);
    } finally {
      await session.close();
    }
  });
});
