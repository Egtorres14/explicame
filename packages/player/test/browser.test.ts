import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium, type Browser, type Page } from "playwright";
import { build as viteBuild } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { startServer, type TestServer } from "../../cli/test/helpers/server.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEMO = join(ROOT, "examples/demo-app");
const BUNDLE = join(ROOT, "packages/player/dist/explicame-player.js");
const GUIDE: Guide = {
  schemaVersion: 1, id: "nuevo-filtro-por-fecha", languages: ["es", "en"],
  title: { es: "Nuevo filtro por fecha", en: "New date filter" }, startUrl: "/",
  steps: [
    { narration: { es: "Abre el filtro.", en: "Open the filter." }, target: { strategies: [{ by: "testid", value: "filtro-fecha" }] }, action: { type: "click" }, opens: "dialog" },
    { narration: { es: "Desde.", en: "From." }, target: { strategies: [{ by: "label", value: "Desde" }] }, action: { type: "type", value: "2026-09-01" } },
    { narration: { es: "Hasta.", en: "To." }, target: { strategies: [{ by: "label", value: "Hasta" }] }, action: { type: "type", value: "2026-09-30" } },
    { narration: { es: "Agrupa.", en: "Group." }, target: { strategies: [{ by: "label", value: "Agrupar por" }] }, action: { type: "select", value: "Semana" } },
    { narration: { es: "Solo te lo señalo.", en: "Only pointed at." }, target: { strategies: [{ by: "role", role: "button", name: "Guardar como predeterminado" }] } },
    { narration: { es: "Aplica.", en: "Apply." }, target: { strategies: [{ by: "role", role: "button", name: "Aplicar" }] }, action: { type: "click" } },
  ],
  source: { base: "patch", head: "feature.patch", commit: "patch", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
};

let server: TestServer;
let browser: Browser;

beforeAll(async () => {
  execSync("npm run build -w @explicame/player", { cwd: ROOT, stdio: "pipe" });
  await viteBuild({ root: DEMO, logLevel: "silent" });
  const site = mkdtempSync(join(tmpdir(), "explicame-player-"));
  cpSync(join(DEMO, "dist"), site, { recursive: true });
  mkdirSync(join(site, "explicame", GUIDE.id), { recursive: true });
  writeFileSync(join(site, "explicame", "guides.json"), JSON.stringify([{ id: GUIDE.id, title: GUIDE.title, startUrl: "/", languages: GUIDE.languages }]));
  writeFileSync(join(site, "explicame", GUIDE.id, "guide.json"), JSON.stringify(GUIDE));
  cpSync(BUNDLE, join(site, "explicame", "explicame-player.js"));
  server = await startServer(site);
  browser = await chromium.launch();
}, 180_000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function openApp(): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${server.url}/`);
  await page.waitForSelector("tbody tr");
  await page.addScriptTag({ url: "/explicame/explicame-player.js" });
  return page;
}

describe("player bundle in a real browser", () => {
  it("weighs at most 25 KB gzipped", () => {
    expect(gzipSync(readFileSync(BUNDLE)).length).toBeLessThanOrEqual(25 * 1024);
  });

  it("shows the button and plays the guide on the demo app until the table is filtered", async () => {
    const page = await openApp();
    const completed = await page.evaluate(async () => {
      const api = (window as unknown as { Explicame: typeof import("../src/index.js") }).Explicame;
      api.mount({ lang: "es", typeDelay: 0, narrator: () => ({ done: new Promise((r) => setTimeout(r, 30)), stop() {}, pause() {}, resume() {}, update() {} }) });
      return api.play("nuevo-filtro-por-fecha");
    });
    expect(completed).toBe(true);
    expect(await page.$$eval("tbody tr", (rows) => rows.length)).toBe(3);
    expect(await page.evaluate(() => document.querySelector("explicame-player")!.shadowRoot!.querySelector(".button")!.textContent)).toBe("¿Cómo funciona?");
    expect(await page.evaluate(() => document.querySelector("dialog[open]"))).toBeNull();
    await page.close();
  });

  it("blocks write requests while the guide plays", async () => {
    const page = await openApp();
    await page.evaluate(() => {
      const api = (window as unknown as { Explicame: typeof import("../src/index.js") }).Explicame;
      api.mount({ lang: "es", narrator: () => ({ done: new Promise(() => {}), stop() {}, pause() {}, resume() {}, update() {} }) });
      void api.play("nuevo-filtro-por-fecha");
    });
    await page.waitForFunction(() => !!document.querySelector("explicame-player")!.shadowRoot!.querySelector(".veil"));
    const outcome = await page.evaluate(() => fetch("/api/preferences", { method: "POST", body: "{}" }).then(() => "sent", () => "blocked"));
    expect(outcome).toBe("blocked");
    expect(server.hits.filter((hit) => hit.method !== "GET")).toEqual([]);
    await page.evaluate(() => (window as unknown as { Explicame: { stop(): void } }).Explicame.stop());
    await page.close();
  });
});
