# explicame — Plan 2: el reproductor en la app y el video MP4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la guía generada por el plan 1 se reproduzca dentro de cualquier app web (anillo, rótulo, voz, acciones simuladas, controles, modo demostración) y que `explicame record` la grabe como MP4 con subtítulos, por idioma.

**Architecture:** El runtime DOM pasa a ser una función real (`installDomRuntime`) de la que sale el string para Playwright, así el reproductor no necesita `eval` y funciona con CSP estricta. `packages/player` es TypeScript sin dependencias en tiempo de ejecución, empaquetado como IIFE (`window.Explicame`) y como ESM; su interfaz vive en un Shadow DOM. La grabación reutiliza la sesión de Playwright (con video), inyecta el reproductor en modo grabación, recibe los instantes de cada narración por un binding y mezcla el audio con ffmpeg.

**Tech Stack:** las mismas versiones del plan 1; ffmpeg del sistema para el MP4.

**Spec:** `docs/superpowers/specs/2026-10-01-explicame-design.md` (§6.2–6.3, §7, §8a)

## Global Constraints

- Las del plan 1 siguen vigentes (Node ≥ 20, TS 5.9.3, ESM, imports con `.js`, textos por i18n, sin secretos en archivos).
- El reproductor no tiene dependencias en tiempo de ejecución, no usa `eval` ni `new Function`, y pesa ≤ 25 KB comprimido con gzip.
- Del núcleo, el reproductor solo importa `@explicame/core/runtime` y `@explicame/core/safety` (nunca el índice, que arrastra Zod) y tipos.
- Modo demostración mientras suena una guía: bloquea `fetch`/`XMLHttpRequest` con método distinto de `GET`, `HEAD`, `OPTIONS` salvo `allowRequests`; velo que impide tocar la app; al salir cierra lo abierto (Escape, `dialog[open]`) y vuelve a `startUrl` si hay `navigate`.
- Teclado: Esc sale, flecha derecha avanza, flecha izquierda retrocede, Espacio pausa. Respeta `prefers-reduced-motion`. Rótulo con `aria-live="polite"`.
- Grabación: 1920×1080, 30 fps, H.264 + AAC, `loudnorm=I=-16:TP=-1.5`, un `.srt` por idioma; sin ffmpeg, error con la instrucción de instalación por sistema (código 2).

## Review Focus

1. **Apps con CSP estricta**: el reproductor no debe depender de `eval`; la prueba de la Tarea 1 lo fija.
2. **Elemento que tarda en aparecer** (apps de una sola página): el reproductor espera hasta 5 s antes de narrar sin anillo. Prueba en la Tarea 3.
3. **Campos controlados por React**: escribir con el setter nativo y disparar `input`/`change`, o el valor se pierde. Prueba en la Tarea 3.
4. **Autoplay bloqueado o audio que falla**: la narración no puede quedarse colgada; cae a un temporizador estimado. Prueba en la Tarea 3.
5. **Un paso sin audio al grabar**: error claro que dice qué paso y qué idioma, sin generar un MP4 mudo. Prueba en la Tarea 6.

## Mapa de archivos

```
packages/core/src/domRuntimeImpl.js     runtime DOM como función real (ES5)
packages/core/src/domRuntimeImpl.d.ts   su tipo
packages/core/src/domRuntime.ts         DOM_RUNTIME = "(" + installDomRuntime + ")();"
packages/player/                        package.json, tsup.config.ts
  src/i18n.ts      textos del reproductor ES/EN
  src/guard.ts     bloqueo de escrituras en fetch/XHR
  src/narrator.ts  audio o voz del navegador, con respaldo por tiempo
  src/actions.ts   clic, escribir (setter nativo), elegir, navegar
  src/overlay.ts   Shadow DOM: botón, lista, rótulo, controles, anillo, velo, cursor
  src/runner.ts    reproducción de una guía (pasos, pausa, saltos, salida)
  src/index.ts     mount / play / stop / on / unmount
  src/global.ts    window.Explicame para el bundle IIFE
  test/*.test.ts
packages/cli/src/player.ts   copia del bundle a la carpeta de salida
packages/cli/src/record.ts   grabación MP4 + SRT
```

---

### Task 1: Runtime DOM como función real (sin eval)

**Files:**
- Create: `packages/core/src/domRuntimeImpl.js`, `packages/core/src/domRuntimeImpl.d.ts`
- Modify: `packages/core/src/domRuntime.ts` (el string pasa a derivarse de la función), `packages/core/package.json` (subrutas), `vitest.config.ts`, `tsconfig.json`
- Test: `packages/core/test/domRuntimeImpl.test.ts`

**Interfaces:**
- Consumes: el runtime de la Tarea 4 del plan 1 (mismo comportamiento).
- Produces: `installDomRuntime(): void` (importable como `@explicame/core/runtime`), `DOM_RUNTIME` (igual que antes, ahora derivado), subruta `@explicame/core/safety`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/core/test/domRuntimeImpl.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { installDomRuntime } from "@explicame/core/runtime";
import { DOM_RUNTIME } from "../src/domRuntime.js";

describe("installDomRuntime", () => {
  it("installs the runtime without eval", () => {
    document.body.innerHTML = `<button>Filtrar</button>`;
    window.__explicame = undefined;
    window.__explicameNoLayout = true;
    installDomRuntime();
    expect(window.__explicame!.observe().elements.map((e) => e.name)).toEqual(["Filtrar"]);
  });

  it("DOM_RUNTIME is the same function, self-contained and free of bundler helpers", () => {
    expect(DOM_RUNTIME.startsWith("(function installDomRuntime(")).toBe(true);
    expect(DOM_RUNTIME.endsWith(")();")).toBe(true);
    expect(DOM_RUNTIME).not.toContain("__name");
    expect(DOM_RUNTIME).not.toMatch(/\brequire\(|\bimport\b/);
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/core/test/domRuntimeImpl.test.ts`
Expected: FAIL — no se resuelve `@explicame/core/runtime`.

- [ ] **Step 3: Implementar**

Mover el cuerpo de la función del string `DOM_RUNTIME` actual a un archivo JavaScript real, sin cambiar ni una línea de lógica:

`packages/core/src/domRuntimeImpl.js`: contiene exactamente
```
// Plain ES5, dependency-free: Playwright injects it as text (DOM_RUNTIME) and the player calls it directly.
export function installDomRuntime() {
  <el cuerpo actual entre "(function () {" y "})();" de DOM_RUNTIME, sin cambios>
}
```
(Se genera con el script del Step 3b para no reescribir a mano 150 líneas.)

- [ ] **Step 3b: Generar el archivo desde el string actual y reemplazar el string**

Run:
```bash
node -e '
const fs=require("fs");
const src=fs.readFileSync("packages/core/src/domRuntime.ts","utf8");
const start=src.indexOf("String.raw`(function () {")+"String.raw`(function () {".length;
const end=src.lastIndexOf("})();`;");
const body=src.slice(start,end);
fs.writeFileSync("packages/core/src/domRuntimeImpl.js","// Plain ES5, dependency-free: Playwright injects it as text (DOM_RUNTIME) and the player calls it directly.\nexport function installDomRuntime() {"+body+"}\n");
const head=src.slice(0,src.indexOf("/**\n * Plain JavaScript installed"));
fs.writeFileSync("packages/core/src/domRuntime.ts", head.replace("import type { Strategy } from \"./guide.js\";","import type { Strategy } from \"./guide.js\";\nimport { installDomRuntime } from \"./domRuntimeImpl.js\";")+"/** The runtime as text, for Playwright: the same function the player calls directly. */\nexport const DOM_RUNTIME = `(${installDomRuntime.toString()})();`;\nexport { installDomRuntime };\n");
'
```
Expected: `domRuntimeImpl.js` empieza con `export function installDomRuntime() {` y `domRuntime.ts` ya no contiene `String.raw`. El texto se copia tal cual: `String.raw` no procesa escapes, así que el código fuente dentro del string ya es JavaScript válido carácter por carácter.

`packages/core/src/domRuntimeImpl.d.ts`:
```ts
/** Installs window.__explicame (observe, resolve, uniqueStrategies, …) in the current page. Idempotent. */
export declare function installDomRuntime(): void;
```

`packages/core/package.json` — reemplazar `exports` por:
```json
  "exports": {
    ".": "./src/index.ts",
    "./runtime": "./src/domRuntimeImpl.js",
    "./safety": "./src/safety.ts"
  },
```

`vitest.config.ts` — reemplazar el bloque `resolve.alias` por:
```ts
  resolve: {
    alias: [
      { find: /^@explicame\/core$/, replacement: fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) },
      { find: /^@explicame\/core\/runtime$/, replacement: fileURLToPath(new URL("./packages/core/src/domRuntimeImpl.js", import.meta.url)) },
      { find: /^@explicame\/core\/safety$/, replacement: fileURLToPath(new URL("./packages/core/src/safety.ts", import.meta.url)) },
    ],
  },
```

`tsconfig.json` — en `paths` añadir:
```json
      "@explicame/core/runtime": ["./packages/core/src/domRuntimeImpl.js"],
      "@explicame/core/safety": ["./packages/core/src/safety.ts"]
```

- [ ] **Step 4: Ejecutar todas las pruebas**

Run: `npx vitest run packages/core && npx vitest run packages/cli/test/browser.test.ts && npm run typecheck`
Expected: PASS (las pruebas del runtime en jsdom y en Chromium siguen verdes con el string derivado).

- [ ] **Step 5: Commit**

```bash
git add packages/core vitest.config.ts tsconfig.json
git commit -m "refactor(core): runtime DOM como función real para usarlo sin eval"
```

---

### Task 2: Paquete del reproductor, textos y bloqueo de escrituras

**Files:**
- Create: `packages/player/package.json`, `packages/player/tsup.config.ts`, `packages/player/src/i18n.ts`, `packages/player/src/guard.ts`
- Test: `packages/player/test/guard.test.ts`

**Interfaces:**
- Consumes: `isRequestAllowed`, `AllowRule` desde `@explicame/core/safety`; `Lang` (tipo).
- Produces: `UI`, `type UiKey`, `ui(lang, key, params?)`; `interface BlockedInfo { method: string; url: string }`, `installWriteGuard(o: { allow?: AllowRule[]; onBlocked?: (info: BlockedInfo) => void }): () => void` (devuelve la función que restaura `fetch` y XHR).

- [ ] **Step 1: Crear el paquete**

`packages/player/package.json`:
```json
{
  "name": "@explicame/player",
  "version": "0.1.0",
  "description": "Reproductor de guías de explicame · explicame guide player",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./explicame-player.js": "./dist/explicame-player.js"
  },
  "files": ["dist"],
  "scripts": { "build": "tsup" },
  "devDependencies": { "@explicame/core": "0.1.0", "tsup": "^8.5.1" }
}
```

`packages/player/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "explicame-player": "src/global.ts" },
    format: ["iife"],
    platform: "browser",
    target: "es2020",
    minify: true,
    clean: true,
    noExternal: [/^@explicame\/core/],
    outExtension: () => ({ js: ".js" }),
  },
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    platform: "browser",
    target: "es2020",
    noExternal: [/^@explicame\/core/],
  },
]);
```

Run: `npm install`
Expected: enlaza `@explicame/player` en `node_modules`.

- [ ] **Step 2: Escribir la prueba que falla**

`packages/player/test/guard.test.ts`:
```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWriteGuard } from "../src/guard.js";
import { ui } from "../src/i18n.js";

let restore: (() => void) | undefined;
const realFetch = vi.fn(async () => new Response("{}"));
beforeEach(() => {
  window.fetch = realFetch as unknown as typeof fetch;
  realFetch.mockClear();
});
afterEach(() => restore?.());

describe("installWriteGuard", () => {
  it("lets reads through and rejects writes, reporting them", async () => {
    const onBlocked = vi.fn();
    restore = installWriteGuard({ onBlocked });
    await window.fetch("/api/reports");
    expect(realFetch).toHaveBeenCalledTimes(1);
    await expect(window.fetch("/api/preferences", { method: "POST", body: "{}" })).rejects.toThrow(/blocked/);
    expect(realFetch).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({ method: "POST", url: `${location.origin}/api/preferences` });
  });

  it("respects the allow list and restores fetch afterwards", async () => {
    restore = installWriteGuard({ allow: [{ method: "POST", url: "/graphql" }] });
    await window.fetch("/graphql", { method: "POST" });
    expect(realFetch).toHaveBeenCalledTimes(1);
    restore();
    restore = undefined;
    expect(window.fetch).toBe(realFetch);
  });

  it("blocks XMLHttpRequest writes with an error event", async () => {
    const onBlocked = vi.fn();
    restore = installWriteGuard({ onBlocked });
    const xhr = new XMLHttpRequest();
    const failed = new Promise((resolve) => xhr.addEventListener("error", resolve));
    xhr.open("DELETE", "/api/item/1");
    xhr.send();
    await failed;
    expect(onBlocked).toHaveBeenCalledWith({ method: "DELETE", url: `${location.origin}/api/item/1` });
  });
});

describe("ui", () => {
  it("has the same texts in both languages and fills parameters", () => {
    expect(ui("es", "howItWorks")).toBe("¿Cómo funciona?");
    expect(ui("en", "howItWorks")).toBe("How does it work?");
    expect(ui("es", "step", { n: 2, total: 6 })).toBe("Paso 2 de 6");
  });
});
```

- [ ] **Step 3: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/player/test/guard.test.ts`
Expected: FAIL — no se resuelve `../src/guard.js`.

- [ ] **Step 4: Implementar**

`packages/player/src/i18n.ts`:
```ts
import type { Lang } from "@explicame/core";

export const UI = {
  es: {
    howItWorks: "¿Cómo funciona?",
    noGuides: "No hay guías para esta pantalla.",
    step: "Paso {n} de {total}",
    pause: "Pausar",
    resume: "Seguir",
    next: "Siguiente",
    prev: "Anterior",
    exit: "Salir",
    mute: "Silenciar",
    unmute: "Activar voz",
    speed: "Velocidad",
    volume: "Volumen",
    language: "Idioma",
  },
  en: {
    howItWorks: "How does it work?",
    noGuides: "There are no guides for this screen.",
    step: "Step {n} of {total}",
    pause: "Pause",
    resume: "Resume",
    next: "Next",
    prev: "Back",
    exit: "Exit",
    mute: "Mute",
    unmute: "Unmute",
    speed: "Speed",
    volume: "Volume",
    language: "Language",
  },
} as const;

export type UiKey = keyof (typeof UI)["es"];

export function ui(lang: Lang, key: UiKey, params: Record<string, string | number> = {}): string {
  return UI[lang][key].replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
```

`packages/player/src/guard.ts`:
```ts
import { isRequestAllowed, type AllowRule } from "@explicame/core/safety";

export interface BlockedInfo {
  method: string;
  url: string;
}

type TrackedXhr = XMLHttpRequest & { __explicame?: BlockedInfo };

/** Demo mode: write requests fail while a guide plays. Returns the function that restores fetch and XHR. */
export function installWriteGuard(o: { allow?: AllowRule[]; onBlocked?: (info: BlockedInfo) => void }): () => void {
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const absolute = (url: string) => new URL(url, location.href).toString();

  window.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = absolute(input instanceof Request ? input.url : String(input));
    if (!isRequestAllowed(method, url, o.allow)) {
      o.onBlocked?.({ method, url });
      return Promise.reject(new TypeError(`explicame: ${method} ${url} blocked during the guide`));
    }
    return originalFetch.call(window, input, init);
  } as typeof window.fetch;

  XMLHttpRequest.prototype.open = function guardedOpen(this: TrackedXhr, method: string, url: string | URL, ...rest: unknown[]) {
    this.__explicame = { method: method.toUpperCase(), url: absolute(String(url)) };
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function guardedSend(this: TrackedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = this.__explicame;
    if (info && !isRequestAllowed(info.method, info.url, o.allow)) {
      o.onBlocked?.(info);
      setTimeout(() => this.dispatchEvent(new ProgressEvent("error")));
      return;
    }
    originalSend.call(this, body);
  };

  return () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  };
}
```

`tsconfig.json` ya incluye `packages/*/src` y `packages/*/test`: el reproductor entra al typecheck sin más cambios.

- [ ] **Step 5: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/player && npm run typecheck`
Expected: PASS (4 pruebas).

- [ ] **Step 6: Commit**

```bash
git add package-lock.json packages/player
git commit -m "feat(player): paquete del reproductor, textos y bloqueo de escrituras"
```

---

### Task 3: El reproductor (narrador, acciones, interfaz y ejecución)

**Files:**
- Create: `packages/player/src/narrator.ts`, `packages/player/src/actions.ts`, `packages/player/src/overlay.ts`, `packages/player/src/runner.ts`, `packages/player/src/index.ts`, `packages/player/src/global.ts`
- Test: `packages/player/test/player.test.ts`

**Interfaces:**
- Consumes: `installDomRuntime` (`@explicame/core/runtime`), `AllowRule` (`@explicame/core/safety`), tipos `Guide`, `Step`, `Action`, `Lang`; `installWriteGuard`, `BlockedInfo`, `ui` (Task 2).
- Produces:
  - `narrator.ts`: `interface NarratorOptions { muted: boolean; rate: number; volume: number }`, `interface Narration { done: Promise<void>; stop(); pause(); resume(); update(o: NarratorOptions) }`, `type Narrator = (text, lang, audioUrl | undefined, o) => Narration`, `defaultNarrator`, `estimateMs(text, rate?)`.
  - `actions.ts`: `performStepAction(el: Element | null, action: Action, o: { navigate?; typeDelay: number }): Promise<void>`.
  - `overlay.ts`: `class Overlay` (botón, lista, velo, anillo, rótulo con controles, cursor) con `interface StepView` e `interface ControlHandlers`.
  - `runner.ts`: `class GuideRun { start(): Promise<boolean>; next(); prev(); toggle(); stop() }` con `interface RunOptions`.
  - `index.ts`: `mount(options?: MountOptions): void`, `play(id: string, o?: { lang?: Lang }): Promise<boolean>`, `stop(): void`, `on(event: "step" | "end" | "blocked", listener): () => void`, `unmount(): void`, `loadIndex(): Promise<GuideSummary[]>`; `interface MountOptions { base?; lang?; button?; navigate?; allowRequests?; onBlockedRequest?; zIndex?; record?; narrator?; typeDelay?; resolveTimeoutMs? }`.
  - `global.ts`: asigna `window.Explicame`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/player/test/player.test.ts`:
```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Guide } from "@explicame/core";
import * as Explicame from "../src/index.js";
import { defaultNarrator, estimateMs, type Narrator } from "../src/narrator.js";

const instant: Narrator = () => ({ done: Promise.resolve(), stop() {}, pause() {}, resume() {}, update() {} });
/** A narration that only ends when stopped, to drive the controls by hand. */
const held: Narrator = () => {
  let end!: () => void;
  const done = new Promise<void>((resolve) => (end = resolve));
  return { done, stop: () => end(), pause() {}, resume() {}, update() {} };
};

const GUIDE: Guide = {
  schemaVersion: 1, id: "demo", languages: ["es", "en"], title: { es: "Demo", en: "Demo" }, startUrl: "/",
  steps: [
    { narration: { es: "Abre el panel.", en: "Open the panel." }, target: { strategies: [{ by: "testid", value: "abrir" }] }, action: { type: "click" }, opens: "dialog" },
    { narration: { es: "Escribe el nombre.", en: "Type the name." }, target: { strategies: [{ by: "label", value: "Nombre" }] }, action: { type: "type", value: "Ana" } },
    { narration: { es: "Elige el grupo.", en: "Pick the group." }, target: { strategies: [{ by: "label", value: "Grupo" }] }, action: { type: "select", value: "Semana" } },
    { narration: { es: "Listo.", en: "Done." } },
  ],
  source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
};

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.__explicame = undefined;
  window.__explicameNoLayout = true;
  document.body.innerHTML = `
    <button data-testid="abrir">Abrir</button>
    <dialog id="d"><label for="n">Nombre</label><input id="n"><label for="g">Grupo</label><select id="g"><option>Día</option><option>Semana</option></select></dialog>`;
  document.querySelector("[data-testid=abrir]")!.addEventListener("click", () => document.getElementById("d")!.setAttribute("open", ""));
  fetchMock = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith("guides.json") ? json([{ id: "demo", title: GUIDE.title, startUrl: "/", languages: GUIDE.languages }]) : json(GUIDE)));
  window.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => Explicame.unmount());

const shadow = () => document.querySelector("explicame-player")!.shadowRoot!;

describe("mount", () => {
  it("shows the button in the chosen language and lists the guides of this screen", async () => {
    Explicame.mount({ lang: "es" });
    const button = shadow().querySelector<HTMLButtonElement>(".button")!;
    expect(button.textContent).toBe("¿Cómo funciona?");
    button.click();
    await vi.waitFor(() => expect(shadow().querySelector(".list")?.textContent).toContain("Demo"));
  });
});

describe("play", () => {
  it("runs every step: click, typing with input events, selecting, and cleans up", async () => {
    Explicame.mount({ lang: "es", button: false, narrator: instant, typeDelay: 0 });
    const steps: unknown[] = [];
    Explicame.on("step", (e) => steps.push(e.index));
    const inputs: string[] = [];
    document.getElementById("n")!.addEventListener("input", (e) => inputs.push((e.target as HTMLInputElement).value));

    expect(await Explicame.play("demo")).toBe(true);
    expect(steps).toEqual([0, 1, 2, 3]);
    expect((document.getElementById("n") as HTMLInputElement).value).toBe("Ana");
    expect(inputs).toEqual(["Ana"]);
    expect((document.getElementById("g") as HTMLSelectElement).value).toBe("Semana");
    expect(document.getElementById("d")!.hasAttribute("open")).toBe(false);
    expect(shadow().querySelector(".veil")).toBeNull();
    expect(shadow().querySelector(".caption")).toBeNull();
  });

  it("waits for a target that appears later", async () => {
    document.querySelector("[data-testid=abrir]")!.remove();
    setTimeout(() => {
      const late = document.createElement("button");
      late.dataset.testid = "abrir";
      late.textContent = "Abrir";
      late.addEventListener("click", () => document.getElementById("d")!.setAttribute("open", ""));
      document.body.prepend(late);
    }, 300);
    Explicame.mount({ lang: "es", button: false, narrator: instant, typeDelay: 0 });
    expect(await Explicame.play("demo")).toBe(true);
    expect((document.getElementById("g") as HTMLSelectElement).value).toBe("Semana");
  });

  it("narrates without a ring when a target never appears", async () => {
    document.body.innerHTML = "";
    Explicame.mount({ lang: "en", button: false, narrator: instant, resolveTimeoutMs: 100 });
    expect(await Explicame.play("demo")).toBe(true);
  });

  it("Escape stops, ArrowRight skips, and fetch is restored", async () => {
    Explicame.mount({ lang: "es", button: false, narrator: held, typeDelay: 0 });
    const steps: unknown[] = [];
    Explicame.on("step", (e) => steps.push(e.index));
    const playing = Explicame.play("demo");
    await vi.waitFor(() => expect(shadow().querySelector(".caption")).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await vi.waitFor(() => expect(steps).toEqual([0, 1]));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await playing).toBe(false);
    expect(window.fetch).toBe(fetchMock);
  });

  it("blocks write requests while a guide plays", async () => {
    const onBlockedRequest = vi.fn();
    Explicame.mount({ lang: "es", button: false, narrator: held, onBlockedRequest });
    const playing = Explicame.play("demo");
    await vi.waitFor(() => expect(shadow().querySelector(".veil")).not.toBeNull());
    await expect(window.fetch("/api/preferences", { method: "POST" })).rejects.toThrow(/blocked/);
    expect(onBlockedRequest).toHaveBeenCalledWith(expect.objectContaining({ method: "POST" }));
    Explicame.stop();
    expect(await playing).toBe(false);
  });
});

describe("defaultNarrator", () => {
  it("falls back to a timer when the audio cannot play", async () => {
    vi.useFakeTimers();
    try {
      let ended = false;
      const narration = defaultNarrator("Hola mundo", "es", "/no-existe.mp3", { muted: false, rate: 1, volume: 1 });
      void narration.done.then(() => (ended = true));
      await vi.advanceTimersByTimeAsync(estimateMs("Hola mundo") + 10);
      expect(ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/player/test/player.test.ts`
Expected: FAIL — no se resuelve `../src/index.js`.

- [ ] **Step 3: Implementar el narrador y las acciones**

`packages/player/src/narrator.ts`:
```ts
import type { Lang } from "@explicame/core";

export interface NarratorOptions {
  muted: boolean;
  rate: number;
  volume: number;
}

export interface Narration {
  done: Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  update(o: NarratorOptions): void;
}

export type Narrator = (text: string, lang: Lang, audioUrl: string | undefined, o: NarratorOptions) => Narration;

/** How long a narration takes when there is nothing to listen to (~15 characters per second). */
export function estimateMs(text: string, rate = 1): number {
  return Math.max(1500, text.length * 65) / rate;
}

function timer(ms: number, onDone: () => void) {
  let remaining = ms;
  let started = Date.now();
  let handle = setTimeout(onDone, remaining);
  return {
    pause() {
      clearTimeout(handle);
      remaining -= Date.now() - started;
    },
    resume() {
      started = Date.now();
      handle = setTimeout(onDone, Math.max(0, remaining));
    },
    stop() {
      clearTimeout(handle);
    },
  };
}

/** Plays the step's MP3; without one, the browser voice; if neither works, waits the estimated time. Never hangs. */
export const defaultNarrator: Narrator = (text, lang, audioUrl, options) => {
  let finish!: () => void;
  let finished = false;
  const done = new Promise<void>((resolve) => {
    finish = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };
  });
  let fallback: ReturnType<typeof timer> | null = null;
  const useTimer = () => {
    if (!fallback && !finished) fallback = timer(estimateMs(text, options.rate), finish);
  };
  let audio: HTMLAudioElement | null = null;
  let speaking = false;

  if (audioUrl && typeof Audio !== "undefined") {
    audio = new Audio(audioUrl);
    audio.muted = options.muted;
    audio.volume = options.volume;
    audio.playbackRate = options.rate;
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", useTimer);
    try {
      const started = audio.play() as Promise<void> | undefined;
      if (started && typeof started.catch === "function") started.catch(useTimer);
      else useTimer();
    } catch {
      useTimer();
    }
  } else if (typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined") {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "es" ? "es-ES" : "en-US";
    utterance.rate = options.rate;
    utterance.volume = options.muted ? 0 : options.volume;
    utterance.onend = finish;
    utterance.onerror = useTimer;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    speaking = true;
    // Some browsers never fire onend (no voices installed, long texts): never wait forever.
    setTimeout(finish, estimateMs(text, options.rate) * 2 + 2000);
  } else {
    useTimer();
  }

  return {
    done,
    stop() {
      audio?.pause();
      if (speaking) speechSynthesis.cancel();
      fallback?.stop();
      finish();
    },
    pause() {
      audio?.pause();
      if (speaking) speechSynthesis.pause();
      fallback?.pause();
    },
    resume() {
      if (audio && !fallback) void Promise.resolve(audio.play()).catch(useTimer);
      if (speaking) speechSynthesis.resume();
      fallback?.resume();
    },
    update(o) {
      if (!audio) return;
      audio.muted = o.muted;
      audio.volume = o.volume;
      audio.playbackRate = o.rate;
    },
  };
};
```

`packages/player/src/actions.ts`:
```ts
import type { Action } from "@explicame/core";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const INSTANT_TYPES = new Set(["date", "time", "datetime-local", "month", "week", "color", "range"]);

/** Uses the prototype's setter so frameworks that track the value (React) notice the change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string, delay: number): Promise<void> {
  el.focus();
  if (delay <= 0 || INSTANT_TYPES.has((el as HTMLInputElement).type)) {
    setNativeValue(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    for (let i = 1; i <= value.length; i++) {
      setNativeValue(el, value.slice(0, i));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(delay);
    }
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectOption(el: HTMLSelectElement, label: string): void {
  const option = Array.from(el.options).find((o) => o.label === label || o.text === label || o.value === label);
  if (!option) return;
  el.value = option.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function performStepAction(
  el: Element | null,
  action: Action,
  o: { navigate?: (url: string) => void | Promise<void>; typeDelay: number },
): Promise<void> {
  if (action.type === "navigate") {
    if (o.navigate) await o.navigate(action.url);
    else location.assign(action.url);
    return;
  }
  if (!el) return;
  if (action.type === "click") (el as HTMLElement).click();
  else if (action.type === "type") await typeInto(el as HTMLInputElement, action.value, o.typeDelay);
  else selectOption(el as HTMLSelectElement, action.value);
}
```

- [ ] **Step 4: Implementar la interfaz (Shadow DOM)**

`packages/player/src/overlay.ts`:
```ts
import type { Lang } from "@explicame/core";
import { ui } from "./i18n.js";

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.button { position: fixed; right: 20px; bottom: 20px; padding: 10px 16px; border: 0; border-radius: 999px; background: #1d1b26; color: #fff; font-size: 14px; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25); pointer-events: auto; }
.button:focus-visible, .controls button:focus-visible, .list button:focus-visible { outline: 2px solid #ff8fb8; outline-offset: 2px; }
.list { position: fixed; right: 20px; bottom: 70px; width: 280px; max-height: 50vh; overflow: auto; padding: 6px; border-radius: 12px; background: #fff; color: #1d1b26; box-shadow: 0 12px 40px rgba(0,0,0,.25); pointer-events: auto; }
.list button { display: block; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: none; color: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.list button:hover { background: #f2eff7; }
.list p { margin: 10px 12px; font-size: 13px; color: #6b6878; }
.veil { position: fixed; inset: 0; background: transparent; pointer-events: auto; }
.ring { position: fixed; border: 3px solid #ff8fb8; border-radius: 10px; box-shadow: 0 0 0 4000px rgba(20,16,30,.28); transition: left .25s ease, top .25s ease, width .25s ease, height .25s ease; pointer-events: none; }
.badge { position: absolute; top: -14px; left: -14px; width: 26px; height: 26px; border-radius: 50%; background: #ff8fb8; color: #2a0716; font: 700 13px/26px system-ui, sans-serif; text-align: center; }
.caption { position: fixed; left: 50%; bottom: 24px; width: min(640px, calc(100vw - 32px)); transform: translateX(-50%); padding: 14px 16px 10px; border-radius: 14px; background: #1d1b26; color: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.3); pointer-events: auto; }
.count { margin-bottom: 4px; font-size: 12px; color: #c9c4d6; }
.text { margin: 0 0 10px; font-size: 16px; line-height: 1.4; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.controls button, .controls select { padding: 6px 10px; border: 0; border-radius: 8px; background: #2d2a38; color: #fff; font-size: 13px; cursor: pointer; }
.controls label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #c9c4d6; }
.controls input[type=range] { width: 80px; }
.cursor { position: fixed; width: 24px; height: 24px; margin: -4px 0 0 -4px; transition: left .6s ease, top .6s ease; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .ring, .cursor { transition: none; } }
`;

const CURSOR_SVG =
  '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 2l16 11-7 1.5L9.5 21z" fill="#fff" stroke="#1d1b26" stroke-width="1.5"/></svg>';

export interface StepView {
  n: number;
  total: number;
  text: string;
  lang: Lang;
  languages: Lang[];
  paused: boolean;
  muted: boolean;
  rate: number;
  volume: number;
}

export interface ControlHandlers {
  prev(): void;
  toggle(): void;
  next(): void;
  exit(): void;
  mute(): void;
  rate(value: number): void;
  volume(value: number): void;
  lang(value: Lang): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class Overlay {
  readonly host: HTMLElement;
  private readonly layer: HTMLDivElement;
  private button: HTMLButtonElement | null = null;
  private list: HTMLDivElement | null = null;
  private veilEl: HTMLDivElement | null = null;
  private ringEl: HTMLDivElement | null = null;
  private captionEl: HTMLDivElement | null = null;
  private cursorEl: HTMLDivElement | null = null;

  constructor(zIndex: number) {
    this.host = document.createElement("explicame-player");
    this.host.style.cssText = `position:fixed;inset:0;z-index:${zIndex};pointer-events:none;`;
    const root = this.host.attachShadow({ mode: "open" });
    root.append(el("style", undefined, CSS));
    this.layer = el("div");
    root.append(this.layer);
    document.body.append(this.host);
  }

  showButton(label: string, onClick: () => void): void {
    this.button = el("button", "button", label);
    this.button.type = "button";
    this.button.setAttribute("aria-haspopup", "menu");
    this.button.addEventListener("click", onClick);
    this.layer.append(this.button);
  }

  hideButton(hidden: boolean): void {
    if (this.button) this.button.hidden = hidden;
  }

  isListOpen(): boolean {
    return this.list !== null;
  }

  openList(items: { id: string; title: string }[], emptyText: string, onPick: (id: string) => void): void {
    this.closeList();
    this.list = el("div", "list");
    this.list.setAttribute("role", "menu");
    if (items.length === 0) this.list.append(el("p", undefined, emptyText));
    for (const item of items) {
      const option = el("button", undefined, item.title);
      option.type = "button";
      option.setAttribute("role", "menuitem");
      option.addEventListener("click", () => onPick(item.id));
      this.list.append(option);
    }
    this.layer.append(this.list);
  }

  closeList(): void {
    this.list?.remove();
    this.list = null;
  }

  veil(on: boolean): void {
    if (on && !this.veilEl) {
      this.veilEl = el("div", "veil");
      this.layer.prepend(this.veilEl);
    } else if (!on) {
      this.veilEl?.remove();
      this.veilEl = null;
    }
  }

  ring(rect: DOMRect | null, n: number): void {
    if (!rect) {
      this.ringEl?.remove();
      this.ringEl = null;
      return;
    }
    if (!this.ringEl) {
      this.ringEl = el("div", "ring");
      this.ringEl.append(el("span", "badge"));
      this.layer.append(this.ringEl);
    }
    const pad = 6;
    Object.assign(this.ringEl.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
    this.ringEl.firstElementChild!.textContent = String(n);
  }

  caption(view: StepView, on: ControlHandlers): void {
    this.captionEl?.remove();
    const box = el("div", "caption");
    box.setAttribute("role", "dialog");
    box.append(el("div", "count", ui(view.lang, "step", { n: view.n, total: view.total })));
    const text = el("p", "text", view.text);
    text.setAttribute("aria-live", "polite");
    box.append(text);
    const controls = el("div", "controls");
    const action = (label: string, handler: () => void) => {
      const b = el("button", undefined, label);
      b.type = "button";
      b.addEventListener("click", handler);
      controls.append(b);
    };
    action(ui(view.lang, "prev"), on.prev);
    action(ui(view.lang, view.paused ? "resume" : "pause"), on.toggle);
    action(ui(view.lang, "next"), on.next);
    action(ui(view.lang, view.muted ? "unmute" : "mute"), on.mute);
    const speed = el("select");
    speed.setAttribute("aria-label", ui(view.lang, "speed"));
    for (const value of [0.75, 1, 1.25, 1.5]) {
      const option = el("option", undefined, `${value}×`);
      option.value = String(value);
      option.selected = value === view.rate;
      speed.append(option);
    }
    speed.addEventListener("change", () => on.rate(Number(speed.value)));
    controls.append(speed);
    const volumeLabel = el("label", undefined, ui(view.lang, "volume"));
    const volume = el("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "1";
    volume.step = "0.1";
    volume.value = String(view.volume);
    volume.addEventListener("input", () => on.volume(Number(volume.value)));
    volumeLabel.append(volume);
    controls.append(volumeLabel);
    if (view.languages.length > 1) {
      const language = el("select");
      language.setAttribute("aria-label", ui(view.lang, "language"));
      for (const value of view.languages) {
        const option = el("option", undefined, value.toUpperCase());
        option.value = value;
        option.selected = value === view.lang;
        language.append(option);
      }
      language.addEventListener("change", () => on.lang(language.value as Lang));
      controls.append(language);
    }
    action(ui(view.lang, "exit"), on.exit);
    box.append(controls);
    this.captionEl = box;
    this.layer.append(box);
  }

  hideCaption(): void {
    this.captionEl?.remove();
    this.captionEl = null;
  }

  async moveCursor(x: number, y: number, reduced: boolean): Promise<void> {
    if (!this.cursorEl) {
      this.cursorEl = el("div", "cursor");
      this.cursorEl.innerHTML = CURSOR_SVG;
      Object.assign(this.cursorEl.style, { left: `${window.innerWidth / 2}px`, top: `${window.innerHeight - 80}px` });
      this.layer.append(this.cursorEl);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    Object.assign(this.cursorEl.style, { left: `${x}px`, top: `${y}px` });
    await new Promise((resolve) => setTimeout(resolve, reduced ? 0 : 650));
  }

  hideCursor(): void {
    this.cursorEl?.remove();
    this.cursorEl = null;
  }

  destroy(): void {
    this.host.remove();
  }
}
```

- [ ] **Step 5: Implementar la ejecución de la guía**

`packages/player/src/runner.ts`:
```ts
import type { Guide, Lang, Step } from "@explicame/core";
import type { AllowRule } from "@explicame/core/safety";
import { performStepAction } from "./actions.js";
import { installWriteGuard, type BlockedInfo } from "./guard.js";
import type { Narration, Narrator } from "./narrator.js";
import type { Overlay } from "./overlay.js";

export interface RunOptions {
  guide: Guide;
  base: string;
  lang: Lang;
  overlay: Overlay;
  narrator: Narrator;
  navigate?: (url: string) => void | Promise<void>;
  allow?: AllowRule[];
  onBlocked?: (info: BlockedInfo) => void;
  emit: (event: "step" | "end", payload: Record<string, unknown>) => void;
  record: boolean;
  typeDelay: number;
  resolveTimeoutMs: number;
  pauseAfterActionMs: number;
}

type RecordHook = (event: { type: "narration" | "end"; index?: number; lang?: Lang }) => void;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const frame = (cb: () => void): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number);
const cancelFrame = (id: number) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));

export class GuideRun {
  private index = 0;
  private jump: number | null = null;
  private stopped = false;
  private paused = false;
  private waiters: (() => void)[] = [];
  private narration: Narration | null = null;
  private readonly performed = new Set<number>();
  private opened = 0;
  private target: Element | null = null;
  private frameId = 0;
  private muted = false;
  private rate = 1;
  private volume = 1;
  private lang: Lang;
  private restoreGuard: (() => void) | null = null;
  private readonly reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);
  private readonly o: RunOptions;

  constructor(options: RunOptions) {
    this.o = options;
    this.lang = options.lang;
  }

  async start(): Promise<boolean> {
    this.restoreGuard = installWriteGuard({ allow: this.o.allow, onBlocked: this.o.onBlocked });
    this.o.overlay.veil(true);
    document.addEventListener("keydown", this.onKey, true);
    this.track();
    let completed = false;
    try {
      while (!this.stopped && this.index < this.o.guide.steps.length) {
        await this.playStep(this.index);
        if (this.stopped) break;
        if (this.jump !== null) {
          this.index = this.jump;
          this.jump = null;
          continue;
        }
        this.index += 1;
      }
      completed = !this.stopped;
    } finally {
      await this.finish(completed);
    }
    return completed;
  }

  next(): void {
    this.jump = this.index + 1;
    this.paused = false;
    this.narration?.stop();
    this.release();
  }

  prev(): void {
    this.jump = Math.max(0, this.index - 1);
    this.paused = false;
    this.narration?.stop();
    this.release();
  }

  toggle(): void {
    this.paused = !this.paused;
    if (this.paused) this.narration?.pause();
    else {
      this.narration?.resume();
      this.release();
    }
    this.render();
  }

  stop(): void {
    this.stopped = true;
    this.narration?.stop();
    this.release();
  }

  private async playStep(i: number): Promise<void> {
    const { guide, overlay } = this.o;
    const step = guide.steps[i]!;
    this.o.emit("step", { id: guide.id, index: i });
    this.target = step.target ? await this.waitForTarget(step) : null;
    if (this.stopped || this.jump !== null) return;
    if (this.target) {
      this.target.scrollIntoView?.({ block: "center", behavior: this.reduced ? "auto" : "smooth" });
      await sleep(this.reduced ? 0 : 300);
    }
    this.render();
    if (this.o.record && this.target) {
      const r = this.target.getBoundingClientRect();
      await overlay.moveCursor(r.left + r.width / 2, r.top + r.height / 2, this.reduced);
    }
    this.recordHook()?.({ type: "narration", index: i, lang: this.lang });
    const audio = step.audio?.[this.lang];
    this.narration = this.o.narrator(this.textOf(step), this.lang, audio ? `${this.o.base}/${guide.id}/${audio}` : undefined, {
      muted: this.muted,
      rate: this.rate,
      volume: this.volume,
    });
    await this.narration.done;
    this.narration = null;
    while (this.paused && !this.stopped && this.jump === null) await new Promise<void>((resolve) => this.waiters.push(resolve));
    if (this.stopped || this.jump !== null) return;
    if (step.action && !this.performed.has(i)) {
      await performStepAction(this.target, step.action, { navigate: this.o.navigate, typeDelay: this.reduced ? 0 : this.o.typeDelay });
      this.performed.add(i);
      if (step.opens) this.opened += 1;
      await sleep(this.o.pauseAfterActionMs);
    }
  }

  private textOf(step: Step): string {
    return step.narration[this.lang] ?? Object.values(step.narration)[0] ?? "";
  }

  private async waitForTarget(step: Step): Promise<Element | null> {
    const runtime = window.__explicame;
    if (!runtime || !step.target) return null;
    const deadline = Date.now() + this.o.resolveTimeoutMs;
    for (;;) {
      const found = runtime.resolve(step.target.strategies);
      if (found) return found;
      if (Date.now() >= deadline || this.stopped || this.jump !== null) return null;
      await sleep(150);
    }
  }

  private track(): void {
    const loop = () => {
      if (this.stopped) return;
      this.o.overlay.ring(this.target?.isConnected ? this.target.getBoundingClientRect() : null, this.index + 1);
      this.frameId = frame(loop);
    };
    this.frameId = frame(loop);
  }

  private render(): void {
    const step = this.o.guide.steps[this.index];
    if (!step || this.stopped) return;
    this.o.overlay.caption(
      {
        n: this.index + 1,
        total: this.o.guide.steps.length,
        text: this.textOf(step),
        lang: this.lang,
        languages: this.o.guide.languages,
        paused: this.paused,
        muted: this.muted,
        rate: this.rate,
        volume: this.volume,
      },
      {
        prev: () => this.prev(),
        toggle: () => this.toggle(),
        next: () => this.next(),
        exit: () => this.stop(),
        mute: () => {
          this.muted = !this.muted;
          this.applyAudio();
        },
        rate: (value) => {
          this.rate = value;
          this.applyAudio();
        },
        volume: (value) => {
          this.volume = value;
          this.narration?.update({ muted: this.muted, rate: this.rate, volume: this.volume });
        },
        lang: (value) => {
          this.lang = value;
          this.render();
        },
      },
    );
  }

  private applyAudio(): void {
    this.narration?.update({ muted: this.muted, rate: this.rate, volume: this.volume });
    this.render();
  }

  private handleKey(event: KeyboardEvent): void {
    const actions: Record<string, () => void> = { Escape: () => this.stop(), ArrowRight: () => this.next(), ArrowLeft: () => this.prev(), " ": () => this.toggle() };
    const act = actions[event.key];
    if (!act) return;
    event.preventDefault();
    event.stopPropagation();
    act();
  }

  private release(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  private recordHook(): RecordHook | undefined {
    return this.o.record ? (window as unknown as { __explicameRecordEvent?: RecordHook }).__explicameRecordEvent : undefined;
  }

  private async finish(completed: boolean): Promise<void> {
    this.stopped = true;
    cancelFrame(this.frameId);
    document.removeEventListener("keydown", this.onKey, true);
    this.narration?.stop();
    const { overlay, guide } = this.o;
    overlay.ring(null, 0);
    overlay.hideCaption();
    overlay.hideCursor();
    overlay.veil(false);
    if (this.opened > 0) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.querySelectorAll("dialog[open]").forEach((node) => {
        const dialog = node as HTMLDialogElement;
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      });
    }
    if (this.o.navigate && location.pathname !== guide.startUrl) await this.o.navigate(guide.startUrl);
    this.restoreGuard?.();
    this.recordHook()?.({ type: "end" });
    this.o.emit("end", { id: guide.id, completed });
  }
}
```

- [ ] **Step 6: Implementar la API pública**

`packages/player/src/index.ts`:
```ts
import type { Guide, Lang, LocalizedText } from "@explicame/core";
import { installDomRuntime } from "@explicame/core/runtime";
import type { AllowRule } from "@explicame/core/safety";
import type { BlockedInfo } from "./guard.js";
import { ui } from "./i18n.js";
import { defaultNarrator, type Narrator } from "./narrator.js";
import { Overlay } from "./overlay.js";
import { GuideRun } from "./runner.js";

export type { BlockedInfo } from "./guard.js";
export type { Narrator, Narration, NarratorOptions } from "./narrator.js";

export interface MountOptions {
  /** Where guides.json and the guide folders are served. Default "/explicame". */
  base?: string;
  lang?: Lang;
  /** Floating "How does it work?" button. Default true. */
  button?: boolean;
  /** The app's router, for navigate steps and to return to startUrl on exit. */
  navigate?: (url: string) => void | Promise<void>;
  allowRequests?: AllowRule[];
  onBlockedRequest?: (info: BlockedInfo) => void;
  zIndex?: number;
  /** Used by `explicame record`: animated cursor and timing events. */
  record?: boolean;
  narrator?: Narrator;
  typeDelay?: number;
  resolveTimeoutMs?: number;
}

export interface GuideSummary {
  id: string;
  title: LocalizedText;
  startUrl: string;
  languages: Lang[];
}

type EventName = "step" | "end" | "blocked";
type Listener = (payload: Record<string, unknown>) => void;

interface State {
  options: MountOptions & { base: string; lang: Lang; zIndex: number; typeDelay: number; resolveTimeoutMs: number };
  overlay: Overlay;
  run: GuideRun | null;
  listeners: Map<EventName, Set<Listener>>;
}

let state: State | null = null;

function emit(event: EventName, payload: Record<string, unknown>): void {
  state?.listeners.get(event)?.forEach((listener) => listener(payload));
}

function requireState(): State {
  if (!state) throw new Error("explicame: call mount() first");
  return state;
}

export function mount(options: MountOptions = {}): void {
  if (state) unmount();
  installDomRuntime();
  const lang: Lang = options.lang ?? (typeof navigator !== "undefined" && navigator.language?.startsWith("en") ? "en" : "es");
  const resolved = {
    ...options,
    base: (options.base ?? "/explicame").replace(/\/$/, ""),
    lang,
    zIndex: options.zIndex ?? 2147483000,
    typeDelay: options.typeDelay ?? 45,
    resolveTimeoutMs: options.resolveTimeoutMs ?? 5000,
  };
  const overlay = new Overlay(resolved.zIndex);
  state = { options: resolved, overlay, run: null, listeners: new Map() };
  if (options.button !== false) overlay.showButton(ui(lang, "howItWorks"), () => void toggleList());
}

async function toggleList(): Promise<void> {
  const current = requireState();
  if (current.overlay.isListOpen()) {
    current.overlay.closeList();
    return;
  }
  const lang = current.options.lang;
  const here = (await loadIndex()).filter((guide) => guide.startUrl === location.pathname);
  current.overlay.openList(
    here.map((guide) => ({ id: guide.id, title: guide.title[lang] ?? Object.values(guide.title)[0] ?? guide.id })),
    ui(lang, "noGuides"),
    (id) => {
      current.overlay.closeList();
      void play(id);
    },
  );
}

export async function loadIndex(): Promise<GuideSummary[]> {
  const response = await fetch(`${requireState().options.base}/guides.json`);
  return response.ok ? ((await response.json()) as GuideSummary[]) : [];
}

export async function play(id: string, o: { lang?: Lang } = {}): Promise<boolean> {
  const current = requireState();
  current.run?.stop();
  const response = await fetch(`${current.options.base}/${id}/guide.json`);
  if (!response.ok) throw new Error(`explicame: guide ${id} not found (${response.status})`);
  const guide = (await response.json()) as Guide;
  const wanted = o.lang ?? current.options.lang;
  const lang = guide.languages.includes(wanted) ? wanted : guide.languages[0]!;
  if (current.options.navigate && location.pathname !== guide.startUrl) await current.options.navigate(guide.startUrl);
  const run = new GuideRun({
    guide,
    base: current.options.base,
    lang,
    overlay: current.overlay,
    narrator: current.options.narrator ?? defaultNarrator,
    navigate: current.options.navigate,
    allow: current.options.allowRequests,
    onBlocked: (info) => {
      current.options.onBlockedRequest?.(info);
      emit("blocked", { ...info });
    },
    emit,
    record: current.options.record ?? false,
    typeDelay: current.options.typeDelay,
    resolveTimeoutMs: current.options.resolveTimeoutMs,
    pauseAfterActionMs: 600,
  });
  current.run = run;
  current.overlay.hideButton(true);
  try {
    return await run.start();
  } finally {
    if (current.run === run) current.run = null;
    current.overlay.hideButton(false);
  }
}

export function stop(): void {
  state?.run?.stop();
}

export function on(event: EventName, listener: Listener): () => void {
  const current = requireState();
  const set = current.listeners.get(event) ?? new Set<Listener>();
  set.add(listener);
  current.listeners.set(event, set);
  return () => set.delete(listener);
}

export function unmount(): void {
  state?.run?.stop();
  state?.overlay.destroy();
  state = null;
}
```

`packages/player/src/global.ts`:
```ts
import * as Explicame from "./index.js";

(window as unknown as { Explicame: typeof Explicame }).Explicame = Explicame;
```

- [ ] **Step 7: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/player && npm run typecheck`
Expected: PASS (las 4 de la Tarea 2 y las 7 nuevas).

- [ ] **Step 8: Commit**

```bash
git add packages/player
git commit -m "feat(player): reproductor con anillo, rótulo, voz, controles y modo demostración"
```

---

### Task 4: El reproductor en un navegador real y su tamaño

**Files:**
- Modify: `package.json` (raíz: `build` construye primero el reproductor)
- Test: `packages/player/test/browser.test.ts`

**Interfaces:**
- Consumes: el bundle `packages/player/dist/explicame-player.js` (Task 3), la app de ejemplo del plan 1, `startServer` (`packages/cli/test/helpers/server.ts`).
- Produces: la garantía de que el bundle IIFE funciona sobre la app real y pesa ≤ 25 KB gzip.

- [ ] **Step 1: Hacer que el build raíz construya el reproductor**

En `package.json` (raíz), reemplazar el script `build` por:
```json
    "build": "npm run build -w @explicame/player && npm run build -w explicame"
```

- [ ] **Step 2: Escribir la prueba**

`packages/player/test/browser.test.ts`:
```ts
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
```

- [ ] **Step 3: Ejecutar la prueba**

Run: `npx vitest run packages/player/test/browser.test.ts`
Expected: PASS (3 pruebas). Si el tamaño supera 25 KB, revisar que el bundle no esté arrastrando Zod (solo debe importar `@explicame/core/runtime` y `@explicame/core/safety`).

- [ ] **Step 4: Commit**

```bash
git add package.json packages/player/test/browser.test.ts
git commit -m "test(player): el bundle sobre la app real, bloqueo de escrituras y tamaño"
```

---

### Task 5: La CLI deja el reproductor junto a las guías

**Files:**
- Create: `packages/cli/src/player.ts`
- Modify: `packages/cli/package.json` (dependencia `@explicame/player`), `packages/core/src/i18n.ts` (clave `player.hint`), `packages/cli/src/build.ts`, `packages/cli/test/e2e.test.ts`

**Interfaces:**
- Consumes: el bundle del reproductor.
- Produces: `PLAYER_FILE = "explicame-player.js"`, `playerBundlePath(): string`, `copyPlayer(outputRoot: string): Promise<string>`.

- [ ] **Step 1: Escribir la prueba que falla**

En `packages/cli/test/e2e.test.ts`:
- añadir `import { execSync } from "node:child_process";`
- al principio de `beforeAll`, antes de `viteBuild`, construir el reproductor:
```ts
  execSync("npm run build -w @explicame/player", { cwd: fileURLToPath(new URL("../../../", import.meta.url)), stdio: "pipe" });
```
- al final de la prueba, antes del cierre del `it`:
```ts
    expect(existsSync(join(out, "explicame-player.js"))).toBe(true);
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/e2e.test.ts`
Expected: FAIL — `expected false to be true` (el archivo del reproductor no existe aún).

- [ ] **Step 3: Implementar**

`packages/cli/package.json` — añadir a `dependencies`:
```json
    "@explicame/player": "0.1.0",
```

`packages/cli/src/player.ts`:
```ts
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

export const PLAYER_FILE = "explicame-player.js";

export function playerBundlePath(): string {
  return createRequire(import.meta.url).resolve("@explicame/player/explicame-player.js");
}

/** Copies the player next to the guides, so the app serves both from the same folder. */
export async function copyPlayer(outputRoot: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  const target = join(outputRoot, PLAYER_FILE);
  await copyFile(playerBundlePath(), target);
  return target;
}
```

`packages/core/src/i18n.ts` — añadir la clave en `es`:
```ts
  "player.hint": "Para verla en tu app: <script src=\"/explicame/explicame-player.js\"></script><script>Explicame.mount()</script>",
```
y en `en`:
```ts
  "player.hint": "To see it in your app: <script src=\"/explicame/explicame-player.js\"></script><script>Explicame.mount()</script>",
```

`packages/cli/src/build.ts` — importar `import { copyPlayer } from "./player.js";` y, justo después de `await writeGuide(outputRoot, guide);`, añadir:
```ts
  await copyPlayer(outputRoot);
  log(t(lang, "player.hint"));
```

Run: `npm install`

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/cli/test/e2e.test.ts packages/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package-lock.json packages/cli packages/core
git commit -m "feat(cli): copiar el reproductor junto a las guías e indicar cómo integrarlo"
```

---

### Task 6: Grabación MP4 con subtítulos

**Files:**
- Create: `packages/cli/src/record.ts`
- Modify: `packages/cli/src/browser/session.ts` (viewport, video, argumentos, `beforePage`, `createdAt`, `route.fallback`), `packages/core/src/i18n.ts` (claves `record.*`), `packages/cli/src/cli.ts` (comando `record`, opción `build --video`, `RecordError`), `.github/workflows/ci.yml` (ffmpeg)
- Test: `packages/cli/test/record.test.ts`

**Interfaces:**
- Consumes: `openSession` (ampliado), `playerBundlePath` (Task 5), `build`, `createFakeDriver`, `createFakeVoiceProvider`.
- Produces: `class RecordError`, `interface StepTiming { index: number; startMs: number }`, `srtTime(ms: number): string`, `buildSrt(guide, lang, timings, endMs): string`, `ffmpegArgs(o: { video: string; audios: { file: string; offsetMs: number }[]; out: string }): string[]`, `findFfmpeg(lang: Lang, candidate?: string): Promise<string>`, `interface RecordOptions { guide; guidesRoot; appUrl; lang; outDir; allowRequests?; storageStatePath?; uiLang?; ffmpeg? }`, `recordGuide(o): Promise<{ video: string; subtitles: string; durationMs: number }>`; `SessionOptions` gana `viewport?`, `recordVideoDir?`, `launchArgs?`, `beforePage?: (context: BrowserContext) => Promise<void>`; `Session` gana `createdAt: number`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/cli/test/record.test.ts`:
```ts
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { build } from "../src/build.js";
import { ConfigError, ConfigSchema } from "../src/config.js";
import { createFakeDriver, loadFakeScript } from "../src/generate/fakeDriver.js";
import { buildSrt, ffmpegArgs, findFfmpeg, recordGuide, RecordError, srtTime } from "../src/record.js";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
import { startServer, type TestServer } from "./helpers/server.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEMO = join(ROOT, "examples/demo-app");
const guideOf = (steps: Guide["steps"]): Guide => ({
  schemaVersion: 1, id: "g", languages: ["es"], title: { es: "G" }, startUrl: "/", steps,
  source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
});

describe("subtitles and ffmpeg arguments", () => {
  it("formats SRT times and cues", () => {
    expect(srtTime(3_723_456)).toBe("01:02:03,456");
    const srt = buildSrt(guideOf([{ narration: { es: "Uno." } }, { narration: { es: "Dos." } }]), "es", [{ index: 0, startMs: 1000 }, { index: 1, startMs: 4000 }], 7000);
    expect(srt).toBe("1\n00:00:01,000 --> 00:00:03,900\nUno.\n\n2\n00:00:04,000 --> 00:00:06,900\nDos.\n");
  });

  it("places every narration at its offset and normalizes loudness", () => {
    const args = ffmpegArgs({ video: "v.webm", audios: [{ file: "a.mp3", offsetMs: 1500 }, { file: "b.mp3", offsetMs: 4200.4 }], out: "o.mp4" });
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("[1:a]adelay=1500:all=1[a0]");
    expect(graph).toContain("[2:a]adelay=4200:all=1[a1]");
    expect(graph).toContain("amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5,apad[aout]");
    expect(args).toEqual(expect.arrayContaining(["-map", "0:v", "[aout]", "libx264", "aac", "-shortest", "o.mp4"]));
  });

  it("explains how to install ffmpeg when it is missing", async () => {
    await expect(findFfmpeg("es", "ffmpeg-que-no-existe")).rejects.toBeInstanceOf(ConfigError);
    await expect(findFfmpeg("es", "ffmpeg-que-no-existe")).rejects.toThrow(/winget install Gyan\.FFmpeg/);
  });

  it("refuses to record a step without audio in that language", async () => {
    await expect(
      recordGuide({ guide: guideOf([{ narration: { es: "Sin audio." } }]), guidesRoot: ".", appUrl: "http://127.0.0.1:9", lang: "es", outDir: "." }),
    ).rejects.toThrow(RecordError);
  });
});

describe("recordGuide on the demo app", () => {
  let server: TestServer;
  beforeAll(async () => {
    execSync("npm run build -w @explicame/player", { cwd: ROOT, stdio: "pipe" });
    await viteBuild({ root: DEMO, logLevel: "silent" });
    server = await startServer(join(DEMO, "dist"));
  }, 180_000);
  afterAll(async () => {
    await server?.close();
  });

  it("produces an H.264 + AAC video and one subtitle per step", async () => {
    const out = await mkdtemp(join(tmpdir(), "explicame-rec-out-"));
    const home = await mkdtemp(join(tmpdir(), "explicame-rec-home-"));
    const config = ConfigSchema.parse({ appUrl: server.url, languages: ["es"], outputDir: out, voice: { provider: "fake" } });
    const script = await loadFakeScript(join(DEMO, "explicame.fake-script.json"));
    for (const turn of script.turns) for (const call of turn) {
      const narration = (call.input as { narration?: { es: string; en?: string } }).narration;
      if (narration) delete narration.en;
      const title = (call.input as { title?: { es: string; en?: string } }).title;
      if (title) delete title.en;
    }
    const { guide } = await build({ cwd: DEMO, config, credentials: {}, diffFile: "feature.patch", driver: createFakeDriver(script), voiceProviders: [createFakeVoiceProvider()], home });
    const result = await recordGuide({ guide, guidesRoot: out, appUrl: server.url, lang: "es", outDir: join(out, "videos") });

    expect(existsSync(result.video)).toBe(true);
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name:format=duration", "-of", "json", result.video], { encoding: "utf8" });
    const info = JSON.parse(probe) as { streams: { codec_name: string }[]; format: { duration: string } };
    expect(info.streams.map((s) => s.codec_name).sort()).toEqual(["aac", "h264"]);
    expect(Number(info.format.duration)).toBeGreaterThan(6);
    expect(readFileSync(result.subtitles, "utf8").match(/^\d+$/gm)).toEqual(["1", "2", "3", "4", "5", "6"]);
  }, 240_000);
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/record.test.ts`
Expected: FAIL — no se resuelve `../src/record.js`.

- [ ] **Step 3: Ampliar la sesión del navegador**

En `packages/cli/src/browser/session.ts`:
- importar `type BrowserContext` ya está; añadir a `SessionOptions`:
```ts
  viewport?: { width: number; height: number };
  /** Folder where Playwright writes the video of the page (recording). */
  recordVideoDir?: string;
  launchArgs?: string[];
  /** Runs on the context before any route or page exists (bindings, extra routes). */
  beforePage?: (context: BrowserContext) => Promise<void>;
```
- añadir a `Session`: `createdAt: number;` (instante en que se creó la página, que es cuando empieza el video).
- en `openSession`, reemplazar el lanzamiento y la creación del contexto por:
```ts
  const browser = await chromium.launch({ headless: o.headless ?? true, args: o.launchArgs });
  try {
    const storageState = o.storageStatePath && existsSync(o.storageStatePath) ? o.storageStatePath : undefined;
    const viewport = o.viewport ?? { width: 1280, height: 800 };
    const context = await browser.newContext({
      viewport,
      storageState,
      recordVideo: o.recordVideoDir ? { dir: o.recordVideoDir, size: viewport } : undefined,
    });
    await o.beforePage?.(context);
```
- en el manejador de rutas, cambiar `return route.continue();` por `return route.fallback();` (deja pasar la petición a las rutas registradas antes, como la que sirve las guías al grabar, y si no hay ninguna, a la red).
- justo después de `const page = await context.newPage();` añadir `const createdAt = Date.now();` e incluir `createdAt` en el objeto devuelto.

- [ ] **Step 4: Implementar la grabación**

`packages/core/src/i18n.ts` — añadir en `es`:
```ts
  "record.noFfmpeg": "Para grabar el MP4 hace falta ffmpeg. Instálalo: Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg · Linux: sudo apt install ffmpeg",
  "record.noAudio": "El paso {index} no tiene audio en {lang}: genera la voz antes de grabar (explicame voice).",
  "record.done": "Video listo: {path}",
```
y en `en`:
```ts
  "record.noFfmpeg": "Recording the MP4 needs ffmpeg. Install it: Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg · Linux: sudo apt install ffmpeg",
  "record.noAudio": "Step {index} has no audio in {lang}: generate the voice before recording (explicame voice).",
  "record.done": "Video ready: {path}",
```

`packages/cli/src/record.ts`:
```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { t, type AllowRule, type Guide, type Lang } from "@explicame/core";
import { openSession } from "./browser/session.js";
import { ConfigError } from "./config.js";
import { playerBundlePath } from "./player.js";

const run = promisify(execFile);
const TAIL_MS = 1200;

export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordError";
  }
}

export interface StepTiming {
  index: number;
  startMs: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function srtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(Math.floor(ms % 1000), 3)}`;
}

/** One cue per narration: it lasts until 100 ms before the next one (or the end). */
export function buildSrt(guide: Guide, lang: Lang, timings: StepTiming[], endMs: number): string {
  return timings
    .map((timing, i) => {
      const next = timings[i + 1]?.startMs ?? endMs;
      const end = Math.max(timing.startMs + 500, next - 100);
      return `${i + 1}\n${srtTime(timing.startMs)} --> ${srtTime(end)}\n${guide.steps[timing.index]?.narration[lang] ?? ""}\n`;
    })
    .join("\n");
}

export function ffmpegArgs(o: { video: string; audios: { file: string; offsetMs: number }[]; out: string }): string[] {
  const delays = o.audios.map((a, i) => `[${i + 1}:a]adelay=${Math.round(a.offsetMs)}:all=1[a${i}]`);
  const mix = `${o.audios.map((_, i) => `[a${i}]`).join("")}amix=inputs=${o.audios.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5,apad[aout]`;
  return [
    "-y", "-i", o.video, ...o.audios.flatMap((a) => ["-i", a.file]),
    "-filter_complex", [...delays, mix].join(";"),
    "-map", "0:v", "-map", "[aout]",
    "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", o.out,
  ];
}

export async function findFfmpeg(lang: Lang, candidate = "ffmpeg"): Promise<string> {
  try {
    await run(candidate, ["-version"]);
    return candidate;
  } catch {
    throw new ConfigError(t(lang, "record.noFfmpeg"));
  }
}

export interface RecordOptions {
  guide: Guide;
  /** Folder that contains <id>/guide.json and its audio (the build output root). */
  guidesRoot: string;
  appUrl: string;
  lang: Lang;
  outDir: string;
  allowRequests?: AllowRule[];
  storageStatePath?: string;
  uiLang?: Lang;
  ffmpeg?: string;
}

/** Plays the guide with the real player in record mode, films it and mixes each narration at its moment. */
export async function recordGuide(o: RecordOptions): Promise<{ video: string; subtitles: string; durationMs: number }> {
  const uiLang = o.uiLang ?? "es";
  const missing = o.guide.steps.findIndex((step) => !step.audio?.[o.lang]);
  if (missing >= 0) throw new RecordError(t(uiLang, "record.noAudio", { index: missing + 1, lang: o.lang }));
  const ffmpeg = await findFfmpeg(uiLang, o.ffmpeg);
  const videoDir = await mkdtemp(join(tmpdir(), "explicame-video-"));
  const events: { type: string; index?: number; at: number }[] = [];
  const session = await openSession({
    appUrl: o.appUrl,
    startUrl: o.guide.startUrl,
    allowRequests: o.allowRequests,
    storageStatePath: o.storageStatePath,
    lang: uiLang,
    viewport: { width: 1920, height: 1080 },
    recordVideoDir: videoDir,
    launchArgs: ["--autoplay-policy=no-user-gesture-required"],
    beforePage: async (context) => {
      await context.exposeBinding("__explicameRecordEvent", (_source, event: { type: string; index?: number }) => {
        events.push({ ...event, at: Date.now() });
      });
      await context.route("**/__explicame__/**", (route) => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/__explicame__\//, ""));
        return route.fulfill({ path: join(o.guidesRoot, relative) });
      });
    },
  });
  let closed = false;
  try {
    await session.page.addScriptTag({ path: playerBundlePath() });
    await session.page.evaluate(
      async ({ id, lang }) => {
        const api = (window as unknown as { Explicame: { mount(o: object): void; play(id: string, o: object): Promise<boolean> } }).Explicame;
        api.mount({ base: "/__explicame__", button: false, lang, record: true });
        return api.play(id, { lang });
      },
      { id: o.guide.id, lang: o.lang },
    );
    await session.page.waitForTimeout(TAIL_MS);
    const video = session.page.video();
    await session.close();
    closed = true;
    if (!video) throw new RecordError("Playwright did not record a video.");
    const raw = await video.path();
    const t0 = session.createdAt;
    const timings: StepTiming[] = events.filter((e) => e.type === "narration").map((e) => ({ index: e.index ?? 0, startMs: e.at - t0 }));
    const endMs = (events.find((e) => e.type === "end")?.at ?? Date.now()) - t0 + TAIL_MS;
    await mkdir(o.outDir, { recursive: true });
    const base = join(o.outDir, `${o.guide.id}.${o.lang}`);
    const audios = timings.map((timing) => ({
      file: join(o.guidesRoot, o.guide.id, o.guide.steps[timing.index]!.audio![o.lang]!),
      offsetMs: timing.startMs,
    }));
    await run(ffmpeg, ffmpegArgs({ video: raw, audios, out: `${base}.mp4` }), { maxBuffer: 64 * 1024 * 1024 });
    await writeFile(`${base}.srt`, buildSrt(o.guide, o.lang, timings, endMs));
    return { video: `${base}.mp4`, subtitles: `${base}.srt`, durationMs: endMs };
  } finally {
    if (!closed) await session.close().catch(() => {});
    await rm(videoDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Comando `record` y opción `build --video`**

En `packages/cli/src/cli.ts`:
- importar `import { recordGuide, RecordError } from "./record.js";`, `import { sessionPath } from "./build.js";` (junto al import de `build`) y `type Lang` desde `@explicame/core`, y `t`.
- en `exitCodeFor`, añadir `error instanceof RecordError` a la primera línea (código 1).
- añadir una función auxiliar antes de `createProgram`:
```ts
async function recordAll(ctx: RunContext, guidePath: string, langs: Lang[]): Promise<void> {
  const file = resolve(ctx.cwd, guidePath);
  const guide = await readGuide(file);
  for (const lang of langs.filter((l) => guide.languages.includes(l))) {
    const result = await recordGuide({
      guide, guidesRoot: dirname(dirname(file)), appUrl: ctx.config.appUrl, lang,
      outDir: resolve(ctx.cwd, ctx.config.videoDir), allowRequests: ctx.config.safety.allowRequests,
      storageStatePath: sessionPath(explicameHome(), ctx.cwd), uiLang: ctx.config.uiLanguage,
    });
    ctx.log(t(ctx.config.uiLanguage, "record.done", { path: result.video }));
  }
}
const langsOf = (value: string | undefined, config: Config): Lang[] =>
  !value || value === "all" ? config.languages : (value.split(",").map((s) => s.trim()) as Lang[]);
```
- en el comando `build`, añadir la opción `.option("--video", "grabar también el MP4 de cada idioma")`, añadir `video?: boolean` al tipo de `opts`, y después de `await build(...)` guardar el resultado y grabar:
```ts
        const result = await build({ /* mismos argumentos */ });
        if (opts.video) await recordAll({ cwd, config, credentials, log }, join(result.dir, "guide.json"), config.languages);
```
(importar `join` desde `node:path`).
- añadir el comando:
```ts
  program
    .command("record <guide>")
    .description("graba la guía como MP4 con subtítulos · records the guide as an MP4 with subtitles")
    .option("--lang <langs>", "es, en o all", "all")
    .action((guidePath: string, opts: { lang: string }) => run((ctx) => recordAll(ctx, guidePath, langsOf(opts.lang, ctx.config))));
```

En `.github/workflows/ci.yml`, antes de `npm ci`:
```yaml
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
```

- [ ] **Step 5b: Exportar AllowRule desde el núcleo**

`record.ts` importa `type AllowRule` desde `@explicame/core`: ya se reexporta desde `safety.ts` en el índice (plan 1, Task 2). No hay cambio.

- [ ] **Step 6: Ejecutar las pruebas**

Run: `npx vitest run packages/cli/test/record.test.ts && npm test && npm run typecheck && npm run build`
Expected: PASS en todo; la grabación de la app de ejemplo produce un MP4 con `h264` y `aac` de más de 6 s y 6 subtítulos.

- [ ] **Step 7: Commit y push**

```bash
git add packages/cli packages/core .github/workflows/ci.yml
git commit -m "feat(cli): grabar la guía como MP4 con subtítulos (record y build --video)"
git push
```

---

## Cobertura del spec en este plan

| Sección del spec | Tareas |
|---|---|
| §6.2 bloqueo de escrituras en el reproductor | 2, 3, 4 |
| §6.3 velo y cierre de lo abierto al salir | 3, 4 |
| §7 reproductor (integración, API, Shadow DOM, controles, teclado, voz, elementos ausentes, modo grabación, tamaño) | 1, 3, 4, 5 |
| §8a video del recorrido (1080p, cursor, audio en su momento, loudnorm, MP4, SRT, ffmpeg) | 6 |

