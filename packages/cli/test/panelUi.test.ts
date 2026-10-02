import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeDriver } from "../src/generate/fakeDriver.js";
import { startPanel, type Panel } from "../src/panel/server.js";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
import { startServer, type TestServer } from "./helpers/server.js";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd });
const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
const say = (es: string, en: string) => ({ es, en });

let site: TestServer;
let panel: Panel;
let browser: Browser;
let page: Page;
let cwd: string;
let home: string;

beforeAll(async () => {
  site = await startServer(SITE);
  cwd = await mkdtemp(join(tmpdir(), "explicame-panel-ui-"));
  home = await mkdtemp(join(tmpdir(), "explicame-panel-ui-home-"));
  await git(cwd, "init", "-b", "main");
  await writeFile(join(cwd, "explicame.config.json"), `${JSON.stringify({ appUrl: site.url, voice: { provider: "fake" } }, null, 2)}\n`);
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "base");
  await git(cwd, "checkout", "-b", "feature");
  await writeFile(join(cwd, "filter.ts"), "export const filter = true;\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "feature");
  const script = {
    turns: [
      [{ name: "observe", input: {} }],
      [{ name: "add_step", input: { narration: say("Abre el filtro.", "Open the filter."), element: { name: "Filtrar" }, action: "click", value: null, url: null, opens: "dialog" } }],
      [{ name: "add_step", input: { narration: say("Elige la fecha.", "Pick the date."), element: { label: "Desde" }, action: "type", value: "2026-09-01", url: null, opens: null } }],
      [{ name: "finish", input: { title: say("Filtro por fecha", "Date filter") } }],
    ],
  };
  panel = await startPanel({ cwd, home, port: 0, env: {}, driver: () => createFakeDriver(script), voiceProviders: () => [createFakeVoiceProvider()], login: async () => "ok" });
  browser = await chromium.launch();
  page = await browser.newPage();
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await panel?.close();
  await site?.close();
});

describe("panel page", () => {
  it("shows every section in Spanish and switches to English", async () => {
    await page.goto(panel.url);
    for (const title of ["Proyecto", "Idiomas", "IA", "Voz", "Generar", "Guías"]) await expect.poll(() => page.getByRole("heading", { name: title, exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect.poll(() => page.getByRole("heading", { name: "Project", exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "ES", exact: true }).click();
  });

  it("saves the project settings", async () => {
    await page.getByLabel("Rama base").fill("main");
    await page.locator("#project").getByRole("button", { name: "Guardar" }).click();
    await expect.poll(async () => JSON.parse(await readFile(join(cwd, "explicame.config.json"), "utf8")).base).toBe("main");
    // The page re-renders when the answer arrives, after the file is written: wait for it before typing elsewhere.
    await expect.poll(() => page.locator("#toast").textContent()).toBe("Guardado");
  });

  it("stores a key and only ever shows its last four characters", async () => {
    await page.locator("#ai").getByLabel("API key").fill("sk-ant-secret-1234");
    await page.locator("#ai").getByRole("button", { name: "Guardar clave" }).click();
    await expect.poll(() => page.locator("#ai").textContent()).toContain("••••1234");
    expect(await page.content()).not.toContain("sk-ant-secret");
    expect(JSON.parse(await readFile(join(home, "credentials.json"), "utf8")).anthropic).toBe("sk-ant-secret-1234");
  });

  it("generates a guide with live progress and lists it with its audio", async () => {
    await page.getByLabel("Qué hace la funcionalidad (opcional)").fill("Filtro por fecha en Reportes");
    await page.getByRole("button", { name: "Generar guía" }).click();
    await expect.poll(() => page.locator("#generate .status").textContent(), { timeout: 60_000 }).toBe("Listo");
    expect(await page.locator("#generate .shots img").count()).toBe(2);
    await expect.poll(() => page.locator("#results summary").first().textContent()).toContain("Filtro por fecha");
    expect(await page.locator("#results audio").count()).toBe(4);
  }, 90_000);
});
