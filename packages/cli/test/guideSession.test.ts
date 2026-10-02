import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Observation } from "@explicame/core";
import { ConfigSchema } from "../src/config.js";
import { GuideSession, type ToolReply } from "../src/mcp/guideSession.js";
import { readGuide } from "../src/output.js";
import { startServer, type TestServer } from "./helpers/server.js";

const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
const say = (es: string, en: string) => ({ es, en });
const step = (narration: { es: string; en: string }, elementId: string | null, action: string | null = null, value: string | null = null, opens: string | null = null) =>
  ({ narration, element_id: elementId, action, value, url: null, opens });

/** The observation inside an observe/act reply, an add_step reply or a repair message. */
function screenOf(reply: ToolReply): Observation {
  const json = reply.text.split("\n").find((line) => line.startsWith("{")) ?? reply.text;
  const parsed = JSON.parse(json) as Observation | { observation: Observation };
  return "observation" in parsed ? parsed.observation : parsed;
}

function idOf(reply: ToolReply, name: string): string {
  const element = screenOf(reply).elements.find((e) => e.name === name);
  if (!element) throw new Error(`${name} is not on the screen: ${reply.text.slice(0, 300)}`);
  return element.id;
}

interface Flaky {
  url: string;
  loads: number;
  close(): Promise<void>;
}

/** A page whose "Exportar" button exists only on odd loads: a step on it explores fine and fails on replay. */
async function startFlaky(): Promise<Flaky> {
  const flaky: Flaky = { url: "", loads: 0, close: async () => {} };
  const server = createServer((req, res) => {
    if (req.url !== "/") {
      res.writeHead(404);
      res.end();
      return;
    }
    flaky.loads += 1;
    const exportar = flaky.loads % 2 === 1 ? '<button type="button" data-testid="exportar">Exportar</button>' : "";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reportes</title></head><body><h1>Reportes</h1><button type="button">Filtrar</button>${exportar}<a href="/ayuda">Ayuda</a></body></html>`);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const address = server.address();
  flaky.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  flaky.close = () => new Promise<void>((done) => server.close(() => done()));
  return flaky;
}

let site: TestServer;
let flaky: Flaky;
let home: string;

beforeAll(async () => {
  site = await startServer(SITE);
  flaky = await startFlaky();
  home = await mkdtemp(join(tmpdir(), "explicame-plugin-home-"));
});
afterAll(async () => {
  await site.close();
  await flaky.close();
});

async function project(appUrl: string) {
  const cwd = await mkdtemp(join(tmpdir(), "explicame-plugin-"));
  const config = ConfigSchema.parse({ appUrl, languages: ["es", "en"], outputDir: "public/explicame" });
  return { cwd, session: new GuideSession({ cwd, home, config, timeoutMs: 500 }) };
}

describe("GuideSession", () => {
  it("explores, verifies and saves the guide, then points to build --from-guide", async () => {
    const { cwd, session } = await project(site.url);
    try {
      const first = await session.call("observe", {});
      expect(first.isError).toBe(false);
      const opened = await session.call("add_step", step(say("Abre el filtro.", "Open the filter."), idOf(first, "Filtrar"), "click", null, "dialog"));
      expect(opened.isError).toBe(false);
      const typed = await session.call("add_step", step(say("Elige desde qué fecha.", "Pick the start date."), idOf(opened, "Desde"), "type", "2026-09-01"));
      expect(typed.isError).toBe(false);
      const done = await session.call("finish", { title: say("Filtro por fecha", "Date filter") });
      expect(done).toEqual({ isError: false, text: expect.stringContaining("explicame build --from-guide public/explicame/filtro-por-fecha/guide.json") });
      const saved = await readGuide(join(cwd, "public", "explicame", "filtro-por-fecha", "guide.json"));
      expect(saved.steps).toHaveLength(2);
      expect(saved.source).toMatchObject({ base: "main", head: "HEAD", generatedBy: "claude-code" });
      expect(existsSync(join(cwd, "public", "explicame", "explicame-player.js"))).toBe(true);
      expect((await session.call("observe", {})).isError).toBe(false);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("answers finish before observe, finish without steps and unknown tools with errors, and keeps going", async () => {
    const { session } = await project(site.url);
    try {
      expect(await session.call("finish", { title: say("Nada", "Nothing") })).toEqual({ isError: true, text: "There is no guide in progress: start with observe." });
      expect((await session.call("observe", {})).isError).toBe(false);
      expect(await session.call("finish", { title: say("Nada", "Nothing") })).toEqual({ isError: true, text: "The guide has no steps yet: add them with add_step, then call finish." });
      expect(await session.call("nope", {})).toEqual({ isError: true, text: "Unknown tool nope." });
      expect((await session.call("observe", {})).isError).toBe(false);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("runs concurrent calls one after another on the shared page", async () => {
    const { session } = await project(site.url);
    try {
      await session.call("observe", {});
      const [moved, seen] = await Promise.all([
        session.call("act", { element_id: null, action: "navigate", value: null, url: "/help.html" }),
        session.call("observe", {}),
      ]);
      expect(moved.isError).toBe(false);
      expect(screenOf(seen).url).toMatch(/\/help\.html$/);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("opens a repair at the step that fails on replay and saves the guide once it passes", async () => {
    flaky.loads = 0;
    const { cwd, session } = await project(flaky.url);
    try {
      const first = await session.call("observe", {});
      await session.call("add_step", step(say("Aquí filtras.", "Here you filter."), idOf(first, "Filtrar")));
      await session.call("add_step", step(say("Y aquí exportas.", "And here you export."), idOf(first, "Exportar")));
      const failed = await session.call("finish", { title: say("Exportar", "Export") });
      expect(failed.isError).toBe(true);
      expect(failed.text).toContain("step 2 failed: target not found on the screen");
      expect(await session.call("finish", { title: say("Exportar", "Export") })).toEqual({ isError: true, text: "First call add_step once with the replacement for step 2." });
      const saved = await session.call("add_step", step(say("La ayuda explica cómo exportar.", "Help explains how to export."), idOf(failed, "Ayuda")));
      expect(saved).toEqual({ isError: false, text: expect.stringContaining("passed verification (2 steps)") });
      const guide = await readGuide(join(cwd, "public", "explicame", "exportar", "guide.json"));
      expect(guide.steps[1]!.narration.es).toBe("La ayuda explica cómo exportar.");
    } finally {
      await session.close();
    }
  }, 60_000);

  it("gives each step one repair and does not save a guide that keeps failing", async () => {
    flaky.loads = 0;
    const { cwd, session } = await project(flaky.url);
    try {
      const first = await session.call("observe", {});
      await session.call("add_step", step(say("Exporta el reporte.", "Export the report."), idOf(first, "Exportar")));
      const failed = await session.call("finish", { title: say("Exportar otra vez", "Export again") });
      expect(failed.text).toContain("step 1 failed");
      const final = await session.call("add_step", step(say("Exporta el reporte.", "Export the report."), idOf(failed, "Exportar")));
      expect(final.isError).toBe(true);
      expect(final.text).toMatch(/^Step 1 failed again when the guide was replayed: target not found on the screen\. The guide was not saved\./);
      expect(existsSync(join(cwd, "public", "explicame", "exportar-otra-vez"))).toBe(false);
      expect((await session.call("observe", {})).isError).toBe(false);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("keeps the finished guide when the app is down during verification and verifies it again on the next finish", async () => {
    const app = await startServer(SITE);
    const port = Number(new URL(app.url).port);
    const { cwd, session } = await project(app.url);
    try {
      const first = await session.call("observe", {});
      await session.call("add_step", step(say("Aquí filtras.", "Here you filter."), idOf(first, "Filtrar")));
      await app.close();
      const down = await session.call("finish", { title: say("Reintento", "Retry") });
      expect(down.isError).toBe(true);
      expect(down.text).toContain("call finish again");
      expect((await session.call("observe", {})).text).toContain("call finish again");
      const back = await startServer(SITE, { port });
      try {
        expect(await session.call("finish", { title: say("Reintento", "Retry") })).toEqual({ isError: false, text: expect.stringContaining("passed verification (1 steps)") });
        expect((await readGuide(join(cwd, "public", "explicame", "reintento", "guide.json"))).steps).toHaveLength(1);
      } finally {
        await back.close();
      }
    } finally {
      await session.close();
    }
  }, 60_000);

  it("reports an app that is not running as a tool error", async () => {
    const { session } = await project("http://127.0.0.1:9");
    expect(await session.call("observe", {})).toEqual({ isError: true, text: "No pude abrir http://127.0.0.1:9/: ¿está corriendo la app?" });
    await session.close();
  }, 60_000);

  it("reports a broken explicame.config.json instead of crashing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "explicame-plugin-bad-"));
    await writeFile(join(cwd, "explicame.config.json"), JSON.stringify({ apiKey: "sk-123" }));
    const session = new GuideSession({ cwd, home });
    expect(await session.call("observe", {})).toEqual({ isError: true, text: expect.stringContaining("apiKey") });
    await session.close();
  });
});
