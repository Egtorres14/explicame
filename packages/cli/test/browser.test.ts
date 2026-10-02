import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkClickSafety, type Observation, type ObservedElement } from "@explicame/core";
import { AppUnreachableError, openSession } from "../src/browser/session.js";
import { elementFacts, handleById, observe, performAction, resolveHandle, stableStrategies } from "../src/browser/page.js";
import { startServer, type TestServer } from "./helpers/server.js";

const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
let server: TestServer;
beforeAll(async () => {
  server = await startServer(SITE);
});
afterAll(async () => {
  await server.close();
});

const idOf = (obs: Observation, match: (e: ObservedElement) => boolean) => {
  const element = obs.elements.find(match);
  if (!element) throw new Error("element not found in observation");
  return element.id;
};

describe("openSession", () => {
  it("blocks write requests except the allow-listed ones", async () => {
    const session = await openSession({ appUrl: server.url, startUrl: "/", allowRequests: [{ method: "POST", url: "/api/search" }] });
    try {
      expect(session.blocked.map((b) => new URL(b.url).pathname)).toContain("/api/track");
      expect(server.hits).not.toContainEqual({ method: "POST", path: "/api/track" });
      expect(server.hits).toContainEqual({ method: "POST", path: "/api/search" });
    } finally {
      await session.close();
    }
  });

  it("reports an unreachable app", async () => {
    await expect(openSession({ appUrl: "http://127.0.0.1:9", startUrl: "/" })).rejects.toBeInstanceOf(AppUnreachableError);
  });
});

describe("page helpers", () => {
  it("observes, builds unique selectors and finds elements again after a reload", async () => {
    const session = await openSession({ appUrl: server.url, startUrl: "/" });
    try {
      const obs = await observe(session.page);
      const filtrar = idOf(obs, (e) => e.name === "Filtrar");
      expect(obs.elements.find((e) => e.id === filtrar)).toMatchObject({ role: "button", testid: "filtro-fecha" });
      const strategies = await stableStrategies(session.page, filtrar);
      expect(strategies[0]).toEqual({ by: "testid", value: "filtro-fecha" });

      const exportar = idOf(obs, (e) => e.name === "Exportar");
      const ambiguous = await stableStrategies(session.page, exportar);
      expect(ambiguous.some((s) => s.by === "role" || s.by === "text")).toBe(false);
      expect(ambiguous.at(-1)?.by).toBe("css");

      await session.page.reload();
      const handle = await resolveHandle(session.page, strategies, 2000);
      expect(handle).not.toBeNull();
      await performAction(session.page, handle, { type: "click" });
      expect(await session.page.evaluate(() => (document.getElementById("dlg") as HTMLDialogElement).open)).toBe(true);

      const inDialog = await observe(session.page);
      const desde = idOf(inDialog, (e) => e.label === "Desde");
      expect(await stableStrategies(session.page, desde)).toContainEqual({ by: "label", value: "Desde" });
      await performAction(session.page, await handleById(session.page, desde), { type: "type", value: "2026-09-01" });
      expect(await session.page.inputValue("#desde")).toBe("2026-09-01");

      const guardar = idOf(inDialog, (e) => e.name === "Guardar");
      const facts = await elementFacts(session.page, guardar);
      expect(facts).toMatchObject({ tag: "button", type: "submit", inForm: true });
      expect(checkClickSafety(facts!)).toEqual({ ok: false, reason: "submit" });
    } finally {
      await session.close();
    }
  });

  it("returns null for an element the app has re-rendered", async () => {
    const session = await openSession({ appUrl: server.url, startUrl: "/" });
    try {
      const obs = await observe(session.page);
      const recargar = idOf(obs, (e) => e.name === "Recargar lista");
      await performAction(session.page, await handleById(session.page, recargar), { type: "click" });
      expect(await elementFacts(session.page, recargar)).toBeNull();
    } finally {
      await session.close();
    }
  });

  it("navigates within the same origin", async () => {
    const session = await openSession({ appUrl: server.url, startUrl: "/" });
    try {
      await performAction(session.page, null, { type: "navigate", url: "/help.html" });
      expect((await observe(session.page)).url).toBe("/help.html");
    } finally {
      await session.close();
    }
  });
});
