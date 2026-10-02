# explicame — Plan 3: servidor MCP y plugin de Claude Code

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Claude Code, con la cuenta del propio usuario, genere la guía verificada de una funcionalidad nueva usando las mismas herramientas del bucle (`observe`, `act`, `add_step`, `finish`) a través de `explicame mcp`, y que `explicame build --from-guide` le ponga voz y video sin usar IA.

**Architecture:** `GuideSession` mantiene el navegador entre llamadas y reutiliza `executeCall` del bucle del modo API; su `finish` arma la guía, la reproduce en un navegador limpio y, si un paso falla, abre una reparación en ese paso (un intento por paso, como en modo API) que se resuelve con un `add_step`. `explicame mcp` expone esa sesión con el SDK oficial de MCP (servidor de bajo nivel, para publicar tal cual los JSON Schema de `core`). El plugin (`plugin/`) trae el manifiesto, una skill con el flujo y un `.mcp.json` que arranca un lanzador incluido en el plugin; el lanzador encuentra la CLI por `EXPLICAME_CLI` o por la instalación global (`npm link -w explicame`), porque Claude Code copia el plugin a su caché y desde ahí no ve el repo clonado.

**Tech Stack:** las versiones de los planes 1 y 2, más `@modelcontextprotocol/sdk` ^1.31.0.

**Spec:** `docs/superpowers/specs/2026-10-01-explicame-design.md` (§3 herramientas del bucle, §10 modo plugin y configuración, §11 errores)

**Decisiones frente al spec (se registran como rulings al ejecutar):**
- `finish` guarda `guide.json` **después** de que la verificación pasa, no antes: así el reproductor nunca sirve una guía rota desde `outputDir`.
- El comando `/explicame` del spec es la propia skill del plugin (`skills/explicame/SKILL.md`): la documentación de Claude Code pide `skills/` en lugar de `commands/` para plugins nuevos, y una skill ya se invoca como comando (`/explicame:explicame`).
- `"mode": "plugin"` en la configuración hace que `explicame build` sin `--from-guide` se niegue con la instrucción del flujo del plugin, en lugar de pedir una API key.

## Global Constraints

- Las de los planes 1 y 2 siguen vigentes (Node ≥ 20, TS 5.9.3, ESM, imports con `.js`, textos por i18n, sin secretos en archivos, nada escribe en la app).
- Las herramientas del servidor MCP salen de `buildTools(languages)` de `core`: las mismas definiciones que el modo API. Los textos que reciben las IA van en inglés.
- El servidor MCP habla por stdio: en stdout solo viajan mensajes del protocolo; nada de `console.log`.
- El plugin sigue el formato oficial de Claude Code: `plugin/.claude-plugin/plugin.json`, `plugin/.mcp.json`, `plugin/skills/<nombre>/SKILL.md`, y el marketplace en `.claude-plugin/marketplace.json` en la raíz del repo. Rutas dentro del plugin solo con `${CLAUDE_PLUGIN_ROOT}`; nada con `..`.
- No se ofrece «iniciar sesión con Claude» dentro de la herramienta (spec §10): el modo plugin usa la sesión de Claude Code del usuario.
- Un paso fallido tiene **un** intento de reparación; si vuelve a fallar, la guía no se guarda.

## Review Focus

1. **Claude Code arranca el servidor desde otra carpeta o sin expandir `${CLAUDE_PROJECT_DIR}`**: el servidor debe usar la carpeta del proyecto (variable expandida) y, si llega el texto literal, su carpeta de trabajo. Prueba en la Tarea 3.
2. **Algo escrito en stdout fuera del protocolo** corrompe el JSON-RPC: arrancar y cerrar el servidor no imprime nada en stdout, y al cerrarse el canal se cierra el navegador y el proceso termina con 0. Prueba en la Tarea 3.
3. **Claude Code manda llamadas en paralelo** sobre la misma página: las llamadas se ejecutan una tras otra. Prueba en la Tarea 2.
4. **App apagada, configuración rota o Chromium sin instalar**: cada llamada devuelve el error con lo que hay que hacer, y el servidor sigue vivo. Prueba en la Tarea 2.
5. **El plugin instalado no ve el repo clonado**: el lanzador encuentra la CLI por `EXPLICAME_CLI` o la instalación global y, si no la encuentra, dice cómo instalarla y sale con 1 sin escribir en stdout. Prueba en la Tarea 4.

## Mapa de archivos

```
packages/cli/src/build.ts              + fromGuide, guardia de modo plugin, publish() compartido, assembleGuide con source
packages/cli/src/verify.ts             + openAtStep (reutilizado por verifyAndRepair y por GuideSession)
packages/cli/src/diff.ts               + headCommit
packages/core/src/prompts.ts           + pluginPrompt
packages/cli/src/mcp/guideSession.ts   estado del bucle en modo plugin: exploración, verificación, reparación
packages/cli/src/mcp/server.ts         servidor MCP (stdio) sobre GuideSession
packages/cli/src/cli.ts                build --from-guide, comando mcp, VERSION
vitest.global-setup.ts                 construye reproductor y CLI una sola vez antes de las pruebas
.claude-plugin/marketplace.json        marketplace del repo
plugin/.claude-plugin/plugin.json      manifiesto del plugin
plugin/.mcp.json                       servidor MCP del plugin
plugin/scripts/mcp.mjs                 lanzador que encuentra la CLI
plugin/skills/explicame/SKILL.md       flujo completo para Claude Code
plugin/README.md                       instalación y uso (ES/EN)
```

---

### Task 1: `build --from-guide` y guardia del modo plugin

**Files:**
- Modify: `packages/cli/src/build.ts` (reescritura completa abajo)
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/core/src/i18n.ts`
- Test: `packages/cli/test/build.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `readGuide(path)` de `output.ts`; `voiceGuide`, `writeGuide`, `copyPlayer` (planes 1 y 2).
- Produces: `BuildOptions.fromGuide?: string`; `type GuideSource = Omit<Guide["source"], "createdAt">`; `assembleGuide({ id?, languages, title, steps, startUrl, source: GuideSource }): Guide` (ya no recibe `context` ni `driver`); `sessionPath(home, cwd)` sin cambios. Claves i18n `build.pluginMode` y `guide.unreadable`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar a los imports de `packages/cli/test/build.test.ts`:

```ts
import { existsSync } from "node:fs";
import type { Guide } from "@explicame/core";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
```

y al final del archivo:

```ts
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
```

En `packages/cli/test/cli.test.ts`, dentro de la prueba `"builds and answers --help under both names"`, después de `expect(help).toContain("login");` agregar:

```ts
    expect(help).toContain("record");
    const buildHelp = execFileSync(process.execPath, [`${ROOT}packages/cli/dist/bin.js`, "build", "--help"], { encoding: "utf8" });
    expect(buildHelp).toContain("--from-guide");
    expect(buildHelp).toContain("--video");
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/build.test.ts packages/cli/test/cli.test.ts`
Expected: FAIL — las tres pruebas de `build --from-guide` (la primera intenta leer el diff con git; la segunda y la tercera no reciben `ConfigError`) y la de `--help` (no aparece `--from-guide`).

- [ ] **Step 3: Agregar los textos**

En `packages/core/src/i18n.ts`, en el diccionario `es`, antes de `"record.noFfmpeg"`:

```ts
  "build.pluginMode": "Este proyecto está en modo plugin: la guía la genera Claude Code con el plugin de explicame (/explicame). Después ejecuta «explicame build --from-guide <ruta>». Para usar una API key, pon \"mode\": \"api\" en explicame.config.json.",
  "guide.unreadable": "No pude leer la guía {path}: {error}",
```

y en `en`, antes de `"record.noFfmpeg"`:

```ts
  "build.pluginMode": "This project is in plugin mode: Claude Code generates the guide with the explicame plugin (/explicame). Then run `explicame build --from-guide <path>`. To use an API key instead, set \"mode\": \"api\" in explicame.config.json.",
  "guide.unreadable": "I couldn't read the guide {path}: {error}",
```

- [ ] **Step 4: Implementar en `build.ts`**

`packages/cli/src/build.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import {
  buildTools, initialMessage, systemPrompt, t, validateGuide,
  type Guide, type Lang, type LocalizedText, type Step,
} from "@explicame/core";
import { openSession } from "./browser/session.js";
import { ConfigError, type Config } from "./config.js";
import { explicameHome, requireCredential, type Credentials } from "./credentials.js";
import { getChangeContext } from "./diff.js";
import { countFirstTurnTokens, createAnthropicDriver, estimateCostUsd } from "./generate/anthropicDriver.js";
import type { LlmDriver, Usage } from "./generate/driver.js";
import { LoopError, runExploration, type ExplorationResult } from "./generate/loop.js";
import { readGuide, slugify, writeGuide } from "./output.js";
import { copyPlayer } from "./player.js";
import { writeReport, writeReportSync } from "./report.js";
import { verifyAndRepair } from "./verify.js";
import { buildVoiceProviders } from "./voice/index.js";
import { voiceGuide, type VoiceProvider } from "./voice/provider.js";

export interface BuildOptions {
  cwd: string;
  config: Config;
  credentials: Credentials;
  base?: string;
  head?: string;
  diffFile?: string;
  files?: string[];
  describe?: string;
  id?: string;
  voice?: boolean;
  /** A guide already generated and verified (plugin mode): only its voice and publishing, no AI. */
  fromGuide?: string;
  driver?: LlmDriver;
  voiceProviders?: VoiceProvider[];
  home?: string;
  log?: (message: string) => void;
}

export interface BuildResult {
  guide: Guide;
  dir: string;
  usage: Usage;
}

/** Where a guide came from; assembleGuide adds the timestamp. */
export type GuideSource = Omit<Guide["source"], "createdAt">;

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

export function sessionPath(home: string, cwd: string): string {
  const absolute = resolve(cwd);
  const hash = createHash("sha256").update(absolute).digest("hex").slice(0, 8);
  return join(home, "sessions", `${basename(absolute)}-${hash}.json`);
}

export function assembleGuide(x: {
  id?: string;
  languages: Lang[];
  title: LocalizedText;
  steps: Step[];
  startUrl: string;
  source: GuideSource;
}): Guide {
  const firstTitle = x.title[x.languages[0]!] ?? "guia";
  const candidate = {
    schemaVersion: 1,
    id: x.id ?? slugify(firstTitle),
    languages: x.languages,
    title: x.title,
    startUrl: x.startUrl,
    steps: x.steps,
    source: { ...x.source, createdAt: new Date().toISOString() },
  };
  const result = validateGuide(candidate);
  if (!result.ok) throw new LoopError(`The generated guide is not valid: ${result.errors.join("; ")}`);
  return result.guide;
}

export async function build(o: BuildOptions): Promise<BuildResult> {
  const reportDir = join(resolve(o.cwd), ".explicame", "reports", new Date().toISOString().replace(/[:.]/g, "-"));
  const events: string[] = [];
  const log = (message: string) => {
    events.push(message);
    (o.log ?? (() => {}))(message);
  };
  // Playwright closes its browsers on Ctrl+C by itself (handleSIGINT); this only leaves a partial report behind.
  const onInterrupt = () => {
    writeReportSync(reportDir, { interrupted: true, events });
    process.exit(130);
  };
  process.once("SIGINT", onInterrupt);
  try {
    return await (o.fromGuide !== undefined ? runFromGuide(o, o.fromGuide, log) : runBuild(o, log, reportDir));
  } catch (error) {
    await writeReport(reportDir, { error: (error as Error).message, events });
    (o.log ?? (() => {}))(t(o.config.uiLanguage, "report.saved", { path: reportDir }));
    if (error instanceof Error) Object.assign(error, { reportDir });
    throw error;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
  }
}

async function runBuild(o: BuildOptions, log: (message: string) => void, reportDir: string): Promise<BuildResult> {
  const lang = o.config.uiLanguage;
  if (o.id !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(o.id)) throw new ConfigError(t(lang, "config.invalidId", { id: o.id }));
  // In plugin mode Claude Code writes the guide through `explicame mcp`; only a scripted driver may generate here.
  if (o.config.mode === "plugin" && !o.driver) throw new ConfigError(t(lang, "build.pluginMode"));
  const home = o.home ?? explicameHome();
  const context = await getChangeContext({
    cwd: o.cwd, base: o.base ?? o.config.base, head: o.head ?? "HEAD",
    diffFile: o.diffFile, files: o.files, description: o.describe, lang,
  });
  if (context.omittedFiles.length) log(t(lang, "diff.truncated", { files: context.omittedFiles.join(", ") }));

  let driver = o.driver;
  if (!driver) {
    const apiKey = requireCredential(o.credentials, "anthropic", lang);
    const client = new Anthropic({ apiKey });
    const user = initialMessage({
      languages: o.config.languages, appUrl: o.config.appUrl, startUrl: o.config.startUrl, maxSteps: o.config.maxSteps,
      diff: context.diff, files: context.files, description: context.description, omittedFiles: context.omittedFiles,
    });
    const first = await countFirstTurnTokens(client, o.config.model, systemPrompt(o.config.languages, o.config.maxSteps), user, buildTools(o.config.languages));
    const usd = estimateCostUsd(o.config.model, first, o.config.maxSteps);
    if (usd !== null) log(t(lang, "estimate.cost", { usd: usd.toFixed(2), model: o.config.model, steps: o.config.maxSteps }));
    driver = createAnthropicDriver({ apiKey, model: o.config.model, effort: o.config.effort, client });
  }

  const open = () =>
    openSession({
      appUrl: o.config.appUrl, startUrl: o.config.startUrl, allowRequests: o.config.safety.allowRequests,
      storageStatePath: sessionPath(home, o.cwd), lang,
    });
  const session = await open();
  let exploration: ExplorationResult;
  try {
    exploration = await runExploration({
      driver, session, languages: o.config.languages, maxSteps: o.config.maxSteps, context,
      appUrl: o.config.appUrl, startUrl: o.config.startUrl, onEvent: (event) => log(event.message), lang,
    });
  } finally {
    await session.close();
  }

  let guide = assembleGuide({
    id: o.id, languages: o.config.languages, title: exploration.title, steps: exploration.steps, startUrl: o.config.startUrl,
    source: { base: context.base, head: context.head, commit: context.commit, generatedBy: driver.id, model: driver.model },
  });
  guide = await verifyAndRepair({ guide, driver, pendingResults: exploration.pendingResults, open, log, reportDir, lang });
  return publish(o, guide, home, log, driver.usage());
}

async function runFromGuide(o: BuildOptions, path: string, log: (message: string) => void): Promise<BuildResult> {
  const file = resolve(o.cwd, path);
  let guide: Guide;
  try {
    guide = await readGuide(file);
  } catch (error) {
    throw new ConfigError(t(o.config.uiLanguage, "guide.unreadable", { path: file, error: (error as Error).message }));
  }
  return publish(o, guide, o.home ?? explicameHome(), log, NO_USAGE);
}

/** Voice (unless --no-voice), guide.json and the index, and the player next to them. */
async function publish(o: BuildOptions, verified: Guide, home: string, log: (message: string) => void, usage: Usage): Promise<BuildResult> {
  const lang = o.config.uiLanguage;
  const outputRoot = resolve(o.cwd, o.config.outputDir);
  const dir = join(outputRoot, verified.id);
  let guide = verified;
  if (o.voice !== false) {
    const providers = o.voiceProviders ?? buildVoiceProviders(o.config, o.credentials);
    if (providers.length === 0) log(t(lang, "voice.noProvider"));
    guide = await voiceGuide(guide, {
      providers, guideDir: dir, cacheDir: join(home, "cache", "voice"),
      voices: o.config.voice.voices, speed: o.config.voice.speed, onWarn: log, lang,
    });
  }
  await writeGuide(outputRoot, guide);
  await copyPlayer(outputRoot);
  log(t(lang, "player.hint"));
  log(t(lang, "build.done", { count: guide.steps.length, langs: guide.languages.join(" + "), path: dir }));
  return { guide, dir, usage };
}
```

- [ ] **Step 5: Agregar la opción a la CLI**

En `packages/cli/src/cli.ts`, después de `.option("--video", "grabar también el MP4 de cada idioma")`:

```ts
    .option("--from-guide <path>", "solo voz y publicación de una guía ya verificada (modo plugin), sin IA")
```

cambiar el tipo de `opts` de la acción de `build` de `voice: boolean; video?: boolean }` a `voice: boolean; video?: boolean; fromGuide?: string }`, y en la llamada a `build(...)` cambiar `describe: opts.describe, id: opts.id, voice: opts.voice,` por `describe: opts.describe, id: opts.id, voice: opts.voice, fromGuide: opts.fromGuide,`.

- [ ] **Step 6: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/build.test.ts packages/cli/test/cli.test.ts`
Expected: PASS (todas, incluidas las dos guardas anteriores de `build`).

- [ ] **Step 7: Suite, tipos y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: todo en verde; el typecheck confirma que ningún otro archivo llamaba a `assembleGuide` con `context`/`driver`.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/build.ts packages/cli/src/cli.ts packages/core/src/i18n.ts packages/cli/test/build.test.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): build --from-guide pone voz y publica una guía ya verificada, y el modo plugin no genera sin Claude Code"
```

---

### Task 2: La sesión de guía del modo plugin

**Files:**
- Modify: `packages/cli/src/verify.ts` (reescritura completa abajo: se extrae `openAtStep`)
- Modify: `packages/cli/src/diff.ts`
- Modify: `packages/core/src/prompts.ts`
- Create: `packages/cli/src/mcp/guideSession.ts`
- Test: `packages/core/test/prompts.test.ts`, `packages/cli/test/diff.test.ts`, `packages/cli/test/guideSession.test.ts`

**Interfaces:**
- Consumes: `executeCall(call, state)` y `ExplorationState` de `generate/loop.ts`; `assembleGuide`, `GuideSource`, `sessionPath` (Tarea 1); `verifyGuide`; `writeGuide`; `copyPlayer`; `observe`; `openSession`; `repairMessage`, `systemPrompt`, `TOOL_NAMES` de `core`.
- Produces: `openAtStep(guide, index, open, timeoutMs, lang = "en"): Promise<Session>`; `headCommit(cwd): Promise<string>`; `pluginPrompt(languages, maxSteps): string`; `interface ToolReply { text: string; isError: boolean }`; `class GuideSession { constructor(o: GuideSessionOptions); call(name: string, input: unknown): Promise<ToolReply>; close(): Promise<void> }` con `GuideSessionOptions { cwd; home; config?; timeoutMs?; cliCommand? }`.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `packages/core/test/prompts.test.ts`, cambiar el import a `import { initialMessage, pluginPrompt, repairMessage, systemPrompt } from "../src/prompts.js";` y agregar dentro de `describe("prompts", ...)`:

```ts
  it("plugin prompt keeps the loop rules and explains how finish verifies and repairs", () => {
    const text = pluginPrompt(["es"], 8);
    expect(text.startsWith(systemPrompt(["es"], 8))).toBe(true);
    expect(text).toContain("finish replays the whole guide in a fresh browser");
    expect(text).toContain("call add_step once with the replacement");
  });
```

En `packages/cli/test/diff.test.ts`, cambiar el import a `import { fitDiff, getChangeContext, headCommit } from "../src/diff.js";` y agregar al final:

```ts
describe("headCommit", () => {
  it("returns the short hash of HEAD, or unknown outside a repository", async () => {
    const { stdout } = await git(repo, "rev-parse", "--short", "HEAD");
    expect(await headCommit(repo)).toBe(stdout.trim());
    expect(await headCommit(await mkdtemp(join(tmpdir(), "explicame-nogit-")))).toBe("unknown");
  });
});
```

`packages/cli/test/guideSession.test.ts`:
```ts
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
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/core/test/prompts.test.ts packages/cli/test/diff.test.ts packages/cli/test/guideSession.test.ts`
Expected: FAIL — `pluginPrompt is not a function`, `headCommit is not a function` y `Cannot find module '../src/mcp/guideSession.js'`.

- [ ] **Step 3: `pluginPrompt` y `headCommit`**

Al final de `packages/core/src/prompts.ts`:

```ts
/** System prompt for plugin mode: the same rules, plus how finish verifies the guide and how a step is repaired. */
export function pluginPrompt(languages: Lang[], maxSteps: number): string {
  return [
    systemPrompt(languages, maxSteps),
    "",
    "In this mode you read the diff yourself (for example with git diff) before you start exploring.",
    "finish replays the whole guide in a fresh browser. If a step fails, finish returns the error and the screen right before that step: call add_step once with the replacement for that step (you may observe or act first). The guide is then verified again automatically, and it is saved only when every step passes.",
  ].join("\n");
}
```

Al final de `packages/cli/src/diff.ts`:

```ts
/** Short hash of HEAD, or "unknown" outside a git repository. */
export async function headCommit(cwd: string): Promise<string> {
  try {
    return (await run("git", ["rev-parse", "--short", "HEAD"], { cwd })).stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}
```

- [ ] **Step 4: Extraer `openAtStep`**

`packages/cli/src/verify.ts`:
```ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { repairMessage, t, type Guide, type Lang, type Step } from "@explicame/core";
import { observe, performAction, resolveHandle } from "./browser/page.js";
import type { Session } from "./browser/session.js";
import type { LlmDriver, ToolResult } from "./generate/driver.js";
import { executeCall, type ExplorationState } from "./generate/loop.js";

export interface VerifyFailure {
  index: number;
  error: string;
  screenshot?: string;
}

export class VerifyError extends Error {
  readonly failure: VerifyFailure;
  constructor(failure: VerifyFailure, lang: Lang = "en") {
    super(t(lang, "verify.failed", { index: failure.index + 1, error: failure.error }));
    this.name = "VerifyError";
    this.failure = failure;
  }
}

export interface VerifyOptions {
  timeoutMs?: number;
  /** When set, a screenshot of the failing step is saved here. */
  reportDir?: string;
}

async function replayStep(session: Session, step: Step, timeoutMs: number): Promise<string | null> {
  let handle = null;
  if (step.target) {
    handle = await resolveHandle(session.page, step.target.strategies, timeoutMs);
    if (!handle) return "target not found on the screen";
  }
  if (step.action) {
    try {
      await performAction(session.page, handle, step.action, session.appUrl);
    } catch (error) {
      return (error as Error).message.split("\n")[0] ?? "the action failed";
    }
  }
  return null;
}

/** Replays the guide in a fresh browser and returns the first failing step, if any. */
export async function verifyGuide(guide: Guide, open: () => Promise<Session>, o: VerifyOptions = {}): Promise<VerifyFailure[]> {
  const session = await open();
  try {
    for (const [index, step] of guide.steps.entries()) {
      const error = await replayStep(session, step, o.timeoutMs ?? 5000);
      if (!error) continue;
      const failure: VerifyFailure = { index, error };
      if (o.reportDir) {
        await mkdir(o.reportDir, { recursive: true });
        failure.screenshot = join(o.reportDir, `step-${String(index + 1).padStart(2, "0")}.png`);
        await session.page.screenshot({ path: failure.screenshot });
      }
      return [failure];
    }
    return [];
  } finally {
    await session.close();
  }
}

/** Opens a fresh session and replays the steps before `index`, so the screen is where that step starts. */
export async function openAtStep(guide: Guide, index: number, open: () => Promise<Session>, timeoutMs: number, lang: Lang = "en"): Promise<Session> {
  const session = await open();
  try {
    for (const step of guide.steps.slice(0, index)) {
      const error = await replayStep(session, step, timeoutMs);
      if (error) throw new VerifyError({ index, error }, lang);
    }
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

export interface RepairOptions {
  guide: Guide;
  driver: LlmDriver;
  /** Unsent results of the conversation's last turn. */
  pendingResults: ToolResult[];
  open: () => Promise<Session>;
  timeoutMs?: number;
  reportDir?: string;
  log?: (message: string) => void;
  /** Language of the messages for the person running the CLI. */
  lang?: Lang;
}

/** Verifies; for each failing step the model gets one chance to replace it, then everything is verified again. */
export async function verifyAndRepair(o: RepairOptions): Promise<Guide> {
  const timeoutMs = o.timeoutMs ?? 5000;
  const lang = o.lang ?? "en";
  let guide = o.guide;
  let pending = o.pendingResults;
  const attempted = new Set<number>();
  for (;;) {
    const failure = (await verifyGuide(guide, o.open, { timeoutMs, reportDir: o.reportDir }))[0];
    if (!failure) return guide;
    if (attempted.has(failure.index)) throw new VerifyError(failure, lang);
    attempted.add(failure.index);
    o.log?.(t(lang, "verify.failed", { index: failure.index + 1, error: failure.error }));

    const session = await openAtStep(guide, failure.index, o.open, timeoutMs, lang);
    try {
      const state: ExplorationState = { session, languages: guide.languages, maxSteps: Number.MAX_SAFE_INTEGER, steps: [], title: null };
      let turn = await o.driver.reply(pending, repairMessage(failure.index, failure.error, JSON.stringify(await observe(session.page))));
      pending = [];
      let replacement: Step | undefined;
      for (let round = 0; round < 6 && turn.calls.length > 0; round++) {
        const results: ToolResult[] = [];
        for (const call of turn.calls) results.push(await executeCall(call, state));
        replacement = state.steps[0];
        if (replacement) {
          pending = results;
          break;
        }
        turn = await o.driver.reply(results);
      }
      if (!replacement) throw new VerifyError(failure, lang);
      const fixed = replacement;
      guide = { ...guide, steps: guide.steps.map((step, index) => (index === failure.index ? fixed : step)) };
    } finally {
      await session.close();
    }
  }
}
```

- [ ] **Step 5: Implementar `GuideSession`**

`packages/cli/src/mcp/guideSession.ts`:
```ts
import { join, relative, resolve } from "node:path";
import { repairMessage, TOOL_NAMES, type Guide } from "@explicame/core";
import { observe } from "../browser/page.js";
import { openSession, type Session } from "../browser/session.js";
import { assembleGuide, sessionPath } from "../build.js";
import { loadConfig, type Config } from "../config.js";
import { headCommit } from "../diff.js";
import { executeCall, type ExplorationState } from "../generate/loop.js";
import { writeGuide } from "../output.js";
import { copyPlayer } from "../player.js";
import { openAtStep, verifyGuide } from "../verify.js";

export interface ToolReply {
  text: string;
  isError: boolean;
}

export interface GuideSessionOptions {
  /** Project folder: explicame.config.json, the outputs and the saved app session are relative to it. */
  cwd: string;
  /** explicame home (~/.explicame). */
  home: string;
  /** Loaded from cwd on the first call when absent, so a broken config becomes a tool error instead of a crash. */
  config?: Config;
  /** How long verification waits for each target, in ms (default 5000). */
  timeoutMs?: number;
  /** How the next-step hint calls the CLI (default "explicame"). */
  cliCommand?: string;
}

type Repairing = { kind: "repairing"; guide: Guide; index: number; attempted: Set<number>; state: ExplorationState };
type Phase = { kind: "idle" } | { kind: "exploring"; state: ExplorationState } | Repairing;

const ok = (text: string): ToolReply => ({ text, isError: false });
const fail = (text: string): ToolReply => ({ text, isError: true });
const toolNames: readonly string[] = TOOL_NAMES;

/**
 * The exploration loop of plugin mode. Claude Code calls the tools through the MCP server and this class
 * keeps the browser between calls. finish verifies the guide in a fresh browser and either saves it or opens
 * a repair at the failing step, which the next add_step resolves (one attempt per step, as in API mode).
 */
export class GuideSession {
  private phase: Phase = { kind: "idle" };
  private queue: Promise<unknown> = Promise.resolve();
  private config: Config | undefined;
  private calls = 0;

  constructor(private readonly o: GuideSessionOptions) {
    this.config = o.config;
  }

  /** Runs one tool call. Calls run one after another because they share one browser page. */
  call(name: string, input: unknown): Promise<ToolReply> {
    const next = this.queue.then(() => this.handle(name, input));
    this.queue = next.catch(() => {});
    return next;
  }

  /** Closes any browser still open. */
  async close(): Promise<void> {
    await this.queue;
    await this.closePhase();
  }

  private async handle(name: string, input: unknown): Promise<ToolReply> {
    try {
      if (!toolNames.includes(name)) return fail(`Unknown tool ${name}.`);
      const config = (this.config ??= await loadConfig(this.o.cwd));
      if (this.phase.kind === "repairing") return await this.repair(config, this.phase, name, input);
      let state: ExplorationState;
      if (this.phase.kind === "exploring") {
        state = this.phase.state;
      } else {
        if (name === "finish") return fail("There is no guide in progress: start with observe.");
        state = { session: await this.open(config), languages: config.languages, maxSteps: config.maxSteps, steps: [], title: null };
        this.phase = { kind: "exploring", state };
      }
      const result = await executeCall({ id: this.nextId(), name, input }, state);
      if (name !== "finish" || result.isError) return { text: result.content, isError: result.isError === true };
      return await this.finish(config, state);
    } catch (error) {
      return fail((error as Error).message);
    }
  }

  private async finish(config: Config, state: ExplorationState): Promise<ToolReply> {
    const title = state.title;
    state.title = null;
    if (!title || state.steps.length === 0) return fail("The guide has no steps yet: add them with add_step, then call finish.");
    const guide = assembleGuide({
      languages: config.languages, title, steps: state.steps, startUrl: config.startUrl,
      source: { base: config.base, head: "HEAD", commit: await headCommit(this.o.cwd), generatedBy: "claude-code" },
    });
    await this.closePhase();
    return this.verifyAndSave(config, guide, new Set());
  }

  private async repair(config: Config, phase: Repairing, name: string, input: unknown): Promise<ToolReply> {
    if (name === "finish") return fail(`First call add_step once with the replacement for step ${phase.index + 1}.`);
    const result = await executeCall({ id: this.nextId(), name, input }, phase.state);
    const replacement = phase.state.steps[0];
    if (!replacement) return { text: result.content, isError: result.isError === true };
    await this.closePhase();
    const guide = { ...phase.guide, steps: phase.guide.steps.map((step, index) => (index === phase.index ? replacement : step)) };
    return this.verifyAndSave(config, guide, phase.attempted);
  }

  private async verifyAndSave(config: Config, guide: Guide, attempted: Set<number>): Promise<ToolReply> {
    const timeoutMs = this.o.timeoutMs ?? 5000;
    const open = () => this.open(config);
    const reportDir = join(resolve(this.o.cwd), ".explicame", "reports", new Date().toISOString().replace(/[:.]/g, "-"));
    const failure = (await verifyGuide(guide, open, { timeoutMs, reportDir }))[0];
    if (!failure) {
      const outputRoot = resolve(this.o.cwd, config.outputDir);
      const dir = await writeGuide(outputRoot, guide);
      await copyPlayer(outputRoot);
      const path = relative(resolve(this.o.cwd), join(dir, "guide.json")).split("\\").join("/");
      const arg = /\s/.test(path) ? `"${path}"` : path;
      return ok(
        `The guide "${guide.id}" passed verification (${guide.steps.length} steps) and was saved to ${path}. ` +
          `To generate its voice, run: ${this.o.cliCommand ?? "explicame"} build --from-guide ${arg} (add --video for one MP4 per language).`,
      );
    }
    if (attempted.has(failure.index)) {
      const shot = failure.screenshot ? ` Screenshot: ${failure.screenshot}` : "";
      return fail(`Step ${failure.index + 1} failed again when the guide was replayed: ${failure.error}. The guide was not saved.${shot}`);
    }
    attempted.add(failure.index);
    const session = await openAtStep(guide, failure.index, open, timeoutMs);
    const state: ExplorationState = { session, languages: guide.languages, maxSteps: Number.MAX_SAFE_INTEGER, steps: [], title: null };
    this.phase = { kind: "repairing", guide, index: failure.index, attempted, state };
    return fail(repairMessage(failure.index, failure.error, JSON.stringify(await observe(session.page))));
  }

  private async closePhase(): Promise<void> {
    const phase = this.phase;
    this.phase = { kind: "idle" };
    if (phase.kind !== "idle") await phase.state.session.close().catch(() => {});
  }

  private open(config: Config): Promise<Session> {
    return openSession({
      appUrl: config.appUrl, startUrl: config.startUrl, allowRequests: config.safety.allowRequests,
      storageStatePath: sessionPath(this.o.home, this.o.cwd), lang: config.uiLanguage,
    });
  }

  private nextId(): string {
    this.calls += 1;
    return `call-${this.calls}`;
  }
}
```

- [ ] **Step 6: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/core/test/prompts.test.ts packages/cli/test/diff.test.ts packages/cli/test/guideSession.test.ts packages/cli/test/verify.test.ts`
Expected: PASS (incluidas las pruebas de `verifyAndRepair`, que ahora pasan por `openAtStep`).

- [ ] **Step 7: Suite y tipos**

Run: `npm test && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/prompts.ts packages/core/test/prompts.test.ts packages/cli/src/diff.ts packages/cli/test/diff.test.ts packages/cli/src/verify.ts packages/cli/src/mcp/guideSession.ts packages/cli/test/guideSession.test.ts
git commit -m "feat(cli): sesión de guía del modo plugin con verificación y una reparación por paso"
```

---

### Task 3: `explicame mcp` por stdio

**Files:**
- Modify: `packages/cli/package.json` (dependencia), `package-lock.json`
- Create: `vitest.global-setup.ts`
- Modify: `vitest.config.ts`, `tsconfig.json`
- Modify: `packages/cli/test/cli.test.ts`, `packages/cli/test/e2e.test.ts`, `packages/cli/test/record.test.ts`, `packages/player/test/browser.test.ts` (sin builds propios)
- Create: `packages/cli/src/mcp/server.ts`, `packages/cli/test/helpers/env.ts`
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/mcp.test.ts`

**Interfaces:**
- Consumes: `GuideSession`, `ToolReply` (Tarea 2); `buildTools`, `pluginPrompt` de `core`; `loadConfig`, `ConfigSchema`.
- Produces: `createMcpServer(session: GuideSession, config: Config, version: string): Server`; `runMcpServer(o: { cwd; home; version; cliCommand? }): Promise<void>`; comando `explicame mcp`, que lee `EXPLICAME_PROJECT_DIR` (si no trae `${`) o usa su carpeta de trabajo, y `EXPLICAME_CLI` para la pista del siguiente comando; `export const VERSION = "0.1.0"` en `cli.ts`; `childEnv(extra)` en `test/helpers/env.ts`.

- [ ] **Step 1: Instalar el SDK de MCP**

Run: `npm install @modelcontextprotocol/sdk@^1.31.0 -w explicame`
Expected: `packages/cli/package.json` gana `"@modelcontextprotocol/sdk": "^1.31.0"` en `dependencies` y se actualiza `package-lock.json`.

- [ ] **Step 2: Construir una sola vez antes de las pruebas**

Varias pruebas construyen el reproductor o la CLI en su `beforeAll` y Vitest las corre en paralelo; tsup vacía `dist/` en cada build, así que una puede leer el `dist/` que otra está borrando. Se construye una vez antes de todas:

`vitest.global-setup.ts`:
```ts
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Builds the player bundle and the CLI binary once, before the test files run in parallel:
 * several of them need dist/, and tsup empties it on every build.
 */
export default function setup(): void {
  execSync("npm run build", { cwd: fileURLToPath(new URL("./", import.meta.url)), stdio: "pipe" });
}
```

En `vitest.config.ts`, dentro de `test`, agregar `globalSetup: ["./vitest.global-setup.ts"],`. En `tsconfig.json`, agregar `"vitest.global-setup.ts"` a `include`.

Quitar los builds propios:
- `packages/cli/test/cli.test.ts`: borrar la línea `execSync("npm run build -w explicame", { cwd: ROOT, stdio: "pipe" });` y cambiar el import a `import { execFileSync } from "node:child_process";`.
- `packages/cli/test/e2e.test.ts`: borrar la línea `execSync("npm run build -w @explicame/player", ...)` y el import `import { execSync } from "node:child_process";`.
- `packages/cli/test/record.test.ts`: borrar la línea `execSync("npm run build -w @explicame/player", { cwd: ROOT, stdio: "pipe" });` y cambiar el import a `import { execFileSync } from "node:child_process";`.
- `packages/player/test/browser.test.ts`: borrar la línea `execSync("npm run build -w @explicame/player", { cwd: ROOT, stdio: "pipe" });` y el import `import { execSync } from "node:child_process";`.

Run: `npm test`
Expected: la misma suite en verde, con un solo build al principio.

- [ ] **Step 3: Escribir las pruebas que fallan**

`packages/cli/test/helpers/env.ts`:
```ts
/** The current environment plus `extra`, for child processes (MCP clients take only defined strings). */
export function childEnv(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) base[key] = value;
  return { ...base, ...extra };
}
```

`packages/cli/test/mcp.test.ts`:
```ts
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { GuideSession } from "../src/mcp/guideSession.js";
import { createMcpServer } from "../src/mcp/server.js";
import { childEnv } from "./helpers/env.js";
import { startServer, type TestServer } from "./helpers/server.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BIN = join(ROOT, "packages/cli/dist/bin.js");
const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
let site: TestServer;
let project: string;
let home: string;

type Schema = { properties?: Record<string, { required?: string[] }> };
/** callTool returns a union (the old toolResult shape included), so the text is read through the index signature. */
const textOf = (result: Record<string, unknown>) => (result.content as { type: string; text: string }[])[0]!.text;

beforeAll(async () => {
  site = await startServer(SITE);
  project = await mkdtemp(join(tmpdir(), "explicame-mcp-"));
  home = await mkdtemp(join(tmpdir(), "explicame-mcp-home-"));
  await writeFile(join(project, "explicame.config.json"), JSON.stringify({ appUrl: site.url, languages: ["es", "en"] }));
});
afterAll(async () => {
  await site.close();
});

describe("explicame mcp", () => {
  it("lists the loop tools with the project's languages and runs them", async () => {
    const config = ConfigSchema.parse({ appUrl: site.url, languages: ["es", "en"] });
    const session = new GuideSession({ cwd: project, home, config });
    const server = createMcpServer(session, config, "0.1.0");
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    try {
      expect(client.getInstructions()).toContain("finish replays the whole guide in a fresh browser");
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["observe", "act", "add_step", "finish"]);
      expect((tools.find((tool) => tool.name === "add_step")!.inputSchema as Schema).properties!.narration!.required).toEqual(["es", "en"]);
      const observed = await client.callTool({ name: "observe", arguments: {} });
      expect(observed.isError).toBe(false);
      expect((JSON.parse(textOf(observed)) as { elements: { name: string }[] }).elements.some((e) => e.name === "Filtrar")).toBe(true);
      const missing = await client.callTool({ name: "nope", arguments: {} });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toBe("Unknown tool nope.");
    } finally {
      await client.close();
      await session.close();
    }
  }, 60_000);

  it("serves over stdio from the built binary for the project in EXPLICAME_PROJECT_DIR", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BIN, "mcp"], stderr: "ignore",
      env: childEnv({ EXPLICAME_PROJECT_DIR: project, EXPLICAME_HOME: home }),
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(4);
      const observed = await client.callTool({ name: "observe", arguments: {} });
      expect(observed.isError).toBe(false);
      expect(textOf(observed)).toContain("Filtrar");
    } finally {
      await client.close();
    }
  }, 60_000);

  it("uses its working directory when Claude Code did not expand the project dir", async () => {
    const english = await mkdtemp(join(tmpdir(), "explicame-mcp-en-"));
    await writeFile(join(english, "explicame.config.json"), JSON.stringify({ languages: ["en"] }));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BIN, "mcp"], cwd: english, stderr: "ignore",
      env: childEnv({ EXPLICAME_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}", EXPLICAME_HOME: home }),
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const finish = (await client.listTools()).tools.find((tool) => tool.name === "finish")!;
      expect((finish.inputSchema as Schema).properties!.title!.required).toEqual(["en"]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it("prints nothing on stdout and exits with 0 when the pipe closes", async () => {
    const child = spawn(process.execPath, [BIN, "mcp"], {
      env: childEnv({ EXPLICAME_PROJECT_DIR: project, EXPLICAME_HOME: home }),
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
    child.stdin.end();
    expect(await exited).toBe(0);
    expect(stdout).toBe("");
  }, 60_000);
});
```

En `packages/cli/test/cli.test.ts`, en la prueba `"builds and answers --help under both names"`, después de `expect(help).toContain("record");` agregar `expect(help).toContain("mcp");`.

- [ ] **Step 4: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/mcp.test.ts packages/cli/test/cli.test.ts`
Expected: FAIL — `Cannot find module '../src/mcp/server.js'` y la ayuda sin `mcp`.

- [ ] **Step 5: Implementar el servidor**

`packages/cli/src/mcp/server.ts`:
```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildTools, pluginPrompt } from "@explicame/core";
import { ConfigSchema, loadConfig, type Config } from "../config.js";
import { GuideSession } from "./guideSession.js";

export interface McpServerOptions {
  cwd: string;
  home: string;
  version: string;
  cliCommand?: string;
}

type InputSchema = { type: "object"; properties?: Record<string, object>; required?: string[] };

/**
 * The loop tools as an MCP server, with the same definitions as API mode. The low-level Server is used on
 * purpose: it publishes core's JSON Schemas as they are, where McpServer would ask for Zod shapes.
 */
export function createMcpServer(session: GuideSession, config: Config, version: string): Server {
  const server = new Server(
    { name: "explicame", version },
    { capabilities: { tools: {} }, instructions: pluginPrompt(config.languages, config.maxSteps) },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildTools(config.languages).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input_schema as InputSchema,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const reply = await session.call(request.params.name, request.params.arguments ?? {});
    return { content: [{ type: "text" as const, text: reply.text }], isError: reply.isError };
  });
  return server;
}

/**
 * Serves the tools over stdio until Claude Code closes the pipe, then closes the browser and exits.
 * A broken config only falls back to the defaults for the tool list; each call reports it.
 */
export async function runMcpServer(o: McpServerOptions): Promise<void> {
  const config = await loadConfig(o.cwd).catch(() => ConfigSchema.parse({}));
  const session = new GuideSession({ cwd: o.cwd, home: o.home, cliCommand: o.cliCommand });
  const server = createMcpServer(session, config, o.version);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await session.close().catch(() => {});
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 6: El comando `mcp`**

En `packages/cli/src/cli.ts`:
- agregar el import `import { runMcpServer } from "./mcp/server.js";`;
- antes de `export function exitCodeFor`, agregar `export const VERSION = "0.1.0";` y cambiar `.version("0.1.0")` por `.version(VERSION)`;
- antes de `return program;`, agregar:

```ts
  program
    .command("mcp")
    .description("servidor MCP para el plugin de Claude Code (stdio) · MCP server for the Claude Code plugin (stdio)")
    .action(async () => {
      // The plugin passes ${CLAUDE_PROJECT_DIR}; a value that still has "${" was not expanded by the client.
      const declared = process.env.EXPLICAME_PROJECT_DIR;
      const cwd = declared && !declared.includes("${") ? resolve(declared) : process.cwd();
      const cli = process.env.EXPLICAME_CLI;
      await runMcpServer({ cwd, home: explicameHome(), version: VERSION, cliCommand: cli ? `node "${cli}"` : "explicame" });
    });
```

- [ ] **Step 7: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/mcp.test.ts packages/cli/test/cli.test.ts`
Expected: PASS (4 de `explicame mcp` y las de la CLI).

- [ ] **Step 8: Suite, tipos y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: todo en verde.

- [ ] **Step 9: Commit**

```bash
git add package-lock.json packages/cli/package.json vitest.global-setup.ts vitest.config.ts tsconfig.json packages/cli/src/mcp/server.ts packages/cli/src/cli.ts packages/cli/test/helpers/env.ts packages/cli/test/mcp.test.ts packages/cli/test/cli.test.ts packages/cli/test/e2e.test.ts packages/cli/test/record.test.ts packages/player/test/browser.test.ts
git commit -m "feat(cli): explicame mcp expone las herramientas del bucle a Claude Code por stdio"
```

---

### Task 4: El plugin, el marketplace y el lanzador

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugin/.claude-plugin/plugin.json`, `plugin/.mcp.json`, `plugin/scripts/mcp.mjs`, `plugin/skills/explicame/SKILL.md`, `plugin/README.md`
- Test: `packages/cli/test/plugin.test.ts`

**Interfaces:**
- Consumes: `explicame mcp`, `EXPLICAME_PROJECT_DIR`, `EXPLICAME_CLI` (Tarea 3); `TOOL_NAMES`; `childEnv` (Tarea 3).
- Produces: el plugin `explicame` en el marketplace `explicame`, con el servidor MCP `explicame` (herramientas `mcp__plugin_explicame_explicame__<tool>`) y la skill `explicame`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`packages/cli/test/plugin.test.ts`:
```ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "@explicame/core";
import { childEnv } from "./helpers/env.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LAUNCHER = join(ROOT, "plugin/scripts/mcp.mjs");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const json = <T>(path: string) => JSON.parse(read(path)) as T;

interface Marketplace {
  name: string;
  owner: { name: string };
  plugins: { name: string; source: string }[];
}
interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}

describe("Claude Code plugin", () => {
  it("is listed by the repo's marketplace and starts its server through the bundled launcher", () => {
    const marketplace = json<Marketplace>(".claude-plugin/marketplace.json");
    expect(marketplace.name).toBe("explicame");
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: "explicame", source: "./plugin" })]);
    const manifest = json<{ name: string; version: string }>("plugin/.claude-plugin/plugin.json");
    expect(manifest.name).toBe("explicame");
    expect(manifest.version).toBe(json<{ version: string }>("packages/cli/package.json").version);
    expect(json<McpConfig>("plugin/.mcp.json").mcpServers).toEqual({
      explicame: {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs"],
        env: { EXPLICAME_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}" },
      },
    });
    expect(existsSync(LAUNCHER)).toBe(true);
  });

  it("has a skill that pre-approves exactly the server's tools and ends with build --from-guide", () => {
    const skill = read("plugin/skills/explicame/SKILL.md");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(front).toMatch(/^name: explicame$/m);
    expect(front).toMatch(/^description: .{40,1024}$/m);
    const allowed = /^allowed-tools: (.*)$/m.exec(front)?.[1]?.split(",").map((tool) => tool.trim()) ?? [];
    for (const tool of TOOL_NAMES) expect(allowed).toContain(`mcp__plugin_explicame_explicame__${tool}`);
    expect(skill).toContain("explicame build --from-guide");
  });

  it("starts the MCP server through the launcher when EXPLICAME_CLI points at the binary", async () => {
    const project = await mkdtemp(join(tmpdir(), "explicame-launcher-"));
    await writeFile(join(project, "explicame.config.json"), JSON.stringify({ languages: ["es"] }));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [LAUNCHER], stderr: "ignore",
      env: childEnv({
        EXPLICAME_CLI: join(ROOT, "packages/cli/dist/bin.js"),
        EXPLICAME_PROJECT_DIR: project,
        EXPLICAME_HOME: await mkdtemp(join(tmpdir(), "explicame-launcher-home-")),
      }),
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
      const finish = tools.find((tool) => tool.name === "finish")!;
      expect((finish.inputSchema as { properties: Record<string, { required: string[] }> }).properties.title!.required).toEqual(["es"]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it("explains how to install the CLI when EXPLICAME_CLI points nowhere", () => {
    const result = spawnSync(process.execPath, [LAUNCHER], {
      env: childEnv({ EXPLICAME_CLI: join(tmpdir(), "no-existe", "bin.js") }),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EXPLICAME_CLI");
    expect(result.stdout).toBe("");
  });
});
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/plugin.test.ts`
Expected: FAIL — `ENOENT` al leer `.claude-plugin/marketplace.json`, y el lanzador no existe.

- [ ] **Step 3: El marketplace y el manifiesto**

`.claude-plugin/marketplace.json`:
```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "explicame",
  "description": "explicame / explain-me: guías de onboarding narradas para cada funcionalidad nueva · narrated onboarding for every new feature",
  "owner": {
    "name": "Gabriel Torres"
  },
  "plugins": [
    {
      "name": "explicame",
      "source": "./plugin",
      "description": "Claude Code genera, a partir del diff, la guía interactiva y narrada (ES/EN) de una funcionalidad nueva, explorando la app real · Claude Code turns the diff into a narrated, bilingual in-app guide"
    }
  ]
}
```

`plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "explicame",
  "displayName": "explicame / explain-me",
  "version": "0.1.0",
  "description": "Guía de onboarding interactiva y narrada (ES/EN) para cada funcionalidad nueva, generada por Claude Code a partir del diff y verificada en la app real · Narrated, bilingual in-app onboarding for every new feature",
  "author": {
    "name": "Gabriel Torres",
    "url": "https://github.com/Egtorres14"
  },
  "homepage": "https://github.com/Egtorres14/explicame",
  "repository": "https://github.com/Egtorres14/explicame",
  "license": "MIT",
  "keywords": ["onboarding", "tutorial", "guide", "voice", "playwright", "mcp"]
}
```

`plugin/.mcp.json`:
```json
{
  "mcpServers": {
    "explicame": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs"],
      "env": {
        "EXPLICAME_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}"
      }
    }
  }
}
```

- [ ] **Step 4: El lanzador**

`plugin/scripts/mcp.mjs`:
```js
// Starts `explicame mcp` from wherever the CLI is installed. Claude Code copies this plugin to its cache,
// so it cannot reach the cloned repo by a relative path: EXPLICAME_CLI (the path to packages/cli/dist/bin.js)
// wins, then a global install (`npm link -w explicame` in the clone). Nothing is printed on stdout,
// which belongs to the MCP protocol.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HELP = [
  "explicame: no encuentro la CLI. En tu copia del repo ejecuta: npm install && npm run build && npm link -w explicame",
  "  (o define EXPLICAME_CLI con la ruta completa a packages/cli/dist/bin.js).",
  "explicame: CLI not found. In your clone of the repo run: npm install && npm run build && npm link -w explicame",
  "  (or set EXPLICAME_CLI to the full path of packages/cli/dist/bin.js).",
].join("\n");

function globalCli() {
  try {
    const root = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const bin = join(root, "explicame", "dist", "bin.js");
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

const explicit = process.env.EXPLICAME_CLI;
if (explicit && !existsSync(explicit)) {
  console.error(`explicame: EXPLICAME_CLI=${explicit} no existe / does not exist.\n${HELP}`);
  process.exit(1);
}
const cli = explicit || globalCli();
if (!cli) {
  console.error(HELP);
  process.exit(1);
}
process.argv = [process.argv[0], cli, "mcp"];
await import(pathToFileURL(cli).href);
```

- [ ] **Step 5: La skill**

`plugin/skills/explicame/SKILL.md`:
```markdown
---
name: explicame
description: Genera la guía de onboarding interactiva y narrada (ES/EN) de una funcionalidad nueva de una app web a partir de su diff, explorando la app real con las herramientas del servidor MCP de explicame. Úsala cuando pidan explicar, documentar o crear el onboarding o el tutorial de un cambio. Generates the narrated in-app onboarding guide of a new feature from its diff.
argument-hint: "[qué hace la funcionalidad / what the feature does]"
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(explicame build:*), Read, Glob, Grep, mcp__plugin_explicame_explicame__observe, mcp__plugin_explicame_explicame__act, mcp__plugin_explicame_explicame__add_step, mcp__plugin_explicame_explicame__finish
---

# explicame: the narrated guide of a new feature

You write the onboarding guide of a new feature of the web app in this project. The explicame MCP server gives you a real browser on the running app through four tools (observe, act, add_step and finish), and its instructions explain how to use them. Every step you add is replayed later inside the app with a highlight ring and a narrated voice, in every language of the project.

What the user says about the feature (may be empty): $ARGUMENTS

Talk to the user in their language. Narrations and titles go in every language of the project.

## 1. Prepare

1. Read `explicame.config.json` at the project root if it exists: `appUrl` (default http://localhost:5173), `startUrl`, `base` (default main), `languages`, `maxSteps` and `outputDir`. It never holds API keys.
2. Read the change: `git diff <base>...HEAD`, plus `git status` and `git diff` for work that is not committed yet. Open the UI files you need to understand what the learner will see, and use any files or description the user gave you.
3. Plan the guide before exploring: what the feature is for, which screens it touches, and the 3 to `maxSteps` steps that show it.

## 2. Explore and add steps

- Start with observe. If it says the app cannot be reached, ask the user to start it (for example `npm run dev`) and stop.
- Use act to reach the screen where the feature lives, and add_step for each thing the learner should see or do, following the server's instructions.
- Never try to get around a rejected action: buttons that save, send, delete, pay, confirm or publish are only pointed at.
- End with finish and a short title in every language.

## 3. Verification

finish replays the whole guide in a fresh browser:

- If every step passes, the guide is saved and the result gives you its path and the next command.
- If a step fails, the result says which one and shows the screen right before it. Call add_step once with the replacement for that step (observe or act first if you need to). The guide is verified again automatically.
- Each step gets one repair. If it fails again, the guide is not saved: tell the user which step failed, why, and where the screenshot is.

## 4. Voice and video

Run the command from the result: `explicame build --from-guide <path>`. Add `--video` for one MP4 per language (it needs ffmpeg). It uses the voice set in explicame.config.json and calls no AI. If the shell says `explicame` is not found, the user has to run `npm link -w explicame` once in their clone of explicame (see the plugin's README).

## 5. Report

Tell the user the guide's title, how many steps it has, where `guide.json` is, which audio or video files were created, and how to show the guide in the app:

~~~html
<script src="/explicame/explicame-player.js"></script>
<script>Explicame.mount()</script>
~~~
```

- [ ] **Step 6: El README del plugin**

`plugin/README.md`:
```markdown
# Plugin de Claude Code para explicame

Con este plugin, Claude Code (con tu propia cuenta) genera la guía narrada de una funcionalidad nueva: lee el diff, explora tu app en un navegador real a través del servidor MCP de explicame, verifica la guía y la deja lista para la voz y el video.

## Instalación (una vez)

1. Clona explicame y prepara la CLI:

~~~bash
git clone https://github.com/Egtorres14/explicame
cd explicame
npm install
npx playwright install chromium
npm run build
npm link -w explicame
~~~

`npm link` deja los comandos `explicame` y `explain-me` disponibles en tu terminal. Si prefieres no instalarlos, define la variable `EXPLICAME_CLI` con la ruta completa a `packages/cli/dist/bin.js`.

2. En Claude Code, agrega el marketplace e instala el plugin:

~~~text
/plugin marketplace add Egtorres14/explicame
/plugin install explicame@explicame
~~~

## Uso

En el proyecto de tu app, con la app corriendo:

1. Opcional: un `explicame.config.json` con `"mode": "plugin"`, la URL de la app (`appUrl`), la rama base (`base`) y los idiomas (`languages`).
2. En Claude Code: `/explicame:explicame Agrega un filtro por fecha a Reportes`, o pide «explícame la funcionalidad nueva».
3. Claude Code explora la app, verifica la guía y la guarda en `public/explicame/<id>/guide.json`.
4. Voz y video: `explicame build --from-guide public/explicame/<id>/guide.json --video`.

Nada se escribe en tu app: los botones de guardar, enviar o borrar se señalan pero no se pulsan, y las peticiones que no son GET, HEAD u OPTIONS se bloquean.

---

# Claude Code plugin for explicame

With this plugin, Claude Code (with your own account) generates the narrated guide of a new feature: it reads the diff, explores your app in a real browser through the explicame MCP server, verifies the guide and leaves it ready for voice and video.

## Install (once)

1. Clone explicame and set up the CLI:

~~~bash
git clone https://github.com/Egtorres14/explicame
cd explicame
npm install
npx playwright install chromium
npm run build
npm link -w explicame
~~~

`npm link` makes the `explicame` and `explain-me` commands available in your terminal. If you'd rather not install them, set the `EXPLICAME_CLI` variable to the full path of `packages/cli/dist/bin.js`.

2. In Claude Code, add the marketplace and install the plugin:

~~~text
/plugin marketplace add Egtorres14/explicame
/plugin install explicame@explicame
~~~

## Usage

In your app's project, with the app running:

1. Optional: an `explicame.config.json` with `"mode": "plugin"`, the app URL (`appUrl`), the base branch (`base`) and the languages (`languages`).
2. In Claude Code: `/explicame:explicame Add a date filter to Reports`, or ask "explain the new feature".
3. Claude Code explores the app, verifies the guide and saves it to `public/explicame/<id>/guide.json`.
4. Voice and video: `explicame build --from-guide public/explicame/<id>/guide.json --video`.

Nothing is written to your app: save, send or delete buttons are pointed at but never clicked, and requests other than GET, HEAD or OPTIONS are blocked.
```

- [ ] **Step 7: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/plugin.test.ts`
Expected: PASS (4).

- [ ] **Step 8: Validar con Claude Code**

Run: `claude plugin validate ./plugin` y `claude plugin validate .`
Expected: `Validation passed` (o `passed with warnings` sin errores) para el plugin; para la raíz, la validación del marketplace si la versión instalada de Claude Code la ofrece. Cualquier advertencia sobre un campo se corrige o se registra como ruling.

- [ ] **Step 9: Prueba de humo con Claude Code (usa la cuenta del usuario; una sola llamada corta)**

Con la app de ejemplo servida en `http://localhost:5173` (`npx vite preview --port 5173 --strictPort` en `examples/demo-app` después de `npx vite build`), desde `examples/demo-app`:

Run: `EXPLICAME_CLI="$(pwd)/../../packages/cli/dist/bin.js" claude -p --plugin-dir ../../plugin --allowedTools "mcp__plugin_explicame_explicame__observe" "Llama una sola vez a la herramienta observe del servidor MCP explicame y responde solo con el número de elementos que devolvió."`
Expected: un número mayor que 0. Si el entorno no permite la llamada (sesión, red), se registra en el ledger y no bloquea la tarea: las pruebas automáticas ya cubren el arranque del servidor por el lanzador.

- [ ] **Step 10: Suite, tipos y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: todo en verde.

- [ ] **Step 11: Commit**

```bash
git add .claude-plugin plugin packages/cli/test/plugin.test.ts
git commit -m "feat(plugin): plugin de Claude Code con marketplace, skill y lanzador del servidor MCP"
```
