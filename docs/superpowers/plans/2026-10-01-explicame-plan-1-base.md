# explicame — Plan 1: la base (de diff a guía verificada con voz)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `explicame build` lleve un diff de git hasta una guía bilingüe verificada contra la app real, con audio por paso, usando Claude por API key (o una IA falsa en pruebas).

**Architecture:** Monorepo TypeScript con npm workspaces. `packages/core` es puro (formato del guion, seguridad, i18n, runtime DOM como string, herramientas del bucle y prompts). `packages/cli` hace el trabajo con navegador (Playwright), el bucle de exploración con un `LlmDriver` intercambiable (Anthropic o falso), la verificación con reparación, la voz con caché y la orquestación del comando. `examples/demo-app` es una app Vite con una funcionalidad nueva para la prueba de punta a punta.

**Tech Stack:** Node ≥ 20, TypeScript 5.9.3, npm workspaces, Zod 4, Playwright 1.63, @anthropic-ai/sdk 0.131, commander 15, tsup 8, Vitest 5 (+ jsdom 30), Vite 8.

**Spec:** `docs/superpowers/specs/2026-10-01-explicame-design.md`

Este es el plan 1 de 5. Los siguientes (cada uno deja software funcionando): 2) reproductor en la app y grabación MP4; 3) servidor MCP y plugin de Claude Code; 4) panel bilingüe y resto de voces (Deepgram, OpenAI, Piper, comando); 5) video explicativo, README final y release `v0.1.0`.

## Global Constraints

- Node `>=20`; ESM (`"type": "module"`); TypeScript `5.9.3` con `strict` y `noUncheckedIndexedAccess`.
- Imports relativos con extensión `.js` (resolución `NodeNext`); `@explicame/core` se resuelve a `packages/core/src/index.ts` (alias de Vitest y `paths` de TypeScript) y tsup lo empaqueta dentro de la CLI.
- Identificadores en inglés; textos para personas por `t(lang, key)` en ES y EN. Los mensajes que van a la IA (resultados de herramientas) siempre en inglés.
- Secretos solo desde variables de entorno o `~/.explicame/credentials.json` (o `$EXPLICAME_HOME/credentials.json`); la CLI rechaza claves dentro de `explicame.config.json`.
- Bloqueo de escrituras: se aborta toda petición cuyo método no sea `GET`, `HEAD` u `OPTIONS`, salvo las de `safety.allowRequests`.
- Palabras destructivas, literal: guardar, enviar, eliminar, borrar, pagar, confirmar, publicar, save, submit, send, delete, remove, pay, confirm, publish.
- Orden de estrategias de selector: `tour` → `testid` → `role` → `label` → `text` → `css`; máximo 6; solo las que resuelven a un único elemento.
- `maxSteps` por defecto 15, tope 40. Narración y título ≤ 300 caracteres y en todos los idiomas activos.
- Modelo por defecto `claude-opus-5-5`, esfuerzo `high`, `fallbacks: "default"` con la beta `server-side-fallback-2026-07-01`, caché automática de prompt (`cache_control` de nivel superior).
- Salidas: `public/explicame/guides.json`, `public/explicame/<id>/guide.json`, `public/explicame/<id>/audio/<lang>/<nn>.mp3`.
- Caché de voz: `<home>/cache/voice/<sha256(proveedor|modelo|voz|idioma|velocidad|texto)>.mp3`.
- Códigos de salida: 0 éxito; 1 verificación o bucle fallido; 2 configuración o credenciales; 3 app no accesible; 4 proveedor externo caído.
- Commits a nombre del autor, mensaje convencional en español, sin líneas de atribución de herramientas.

## Review Focus

1. **Apps que leen datos con POST** (GraphQL, búsquedas): sin excepción la app se rompe al bloquear escrituras; `safety.allowRequests` debe dejar pasar exactamente lo listado. Prueba en la Tarea 8.
2. **Elemento que la app vuelve a pintar entre `observe` y la acción**: la herramienta debe responder «el elemento ya no está, llama a observe», nunca caerse. Pruebas en las Tareas 8 y 9.
3. **Dos elementos visibles con el mismo nombre** (dos «Exportar»): el selector por rol no es único y debe caer a CSS. Pruebas en las Tareas 4 y 8.
4. **Diff vacío** (base y head iguales): error claro (código 2) antes de abrir navegador o gastar IA. Prueba en la Tarea 7.
5. **La IA termina sin `finish`, usa un id que no existe o escribe la narración en un solo idioma**: se le devuelve el error y, si insiste en no terminar, el bucle falla con un mensaje claro. Pruebas en las Tareas 5 y 9.

## Mapa de archivos

```
package.json · tsconfig.base.json · tsconfig.json · vitest.config.ts · .gitignore · .github/workflows/ci.yml
packages/core/
  package.json
  src/index.ts        reexporta todo
  src/guide.ts        formato del guion (Zod) y validateGuide
  src/safety.ts       palabras destructivas, clics seguros, peticiones permitidas
  src/i18n.ts         mensajes ES/EN y t()
  src/domRuntime.ts   runtime DOM (string) + tipos Observation / ExplicameRuntime
  src/tools.ts        definiciones de herramientas del bucle y parseToolCall / toAction
  src/prompts.ts      systemPrompt, initialMessage, repairMessage
  test/*.test.ts
packages/cli/
  package.json · tsup.config.ts
  src/config.ts       explicame.config.json (Zod) y ConfigError
  src/credentials.ts  claves desde entorno o archivo
  src/diff.ts         contexto del cambio (git o .patch)
  src/browser/session.ts  navegador, bloqueo de escrituras, AppUnreachableError
  src/browser/page.ts     observe, facts, selectores, resolución, acciones
  src/generate/driver.ts          contrato LlmDriver
  src/generate/fakeDriver.ts      IA falsa guionada (pruebas y e2e)
  src/generate/anthropicDriver.ts IA real por API key + estimado de costo
  src/generate/loop.ts            bucle de exploración y ejecución de herramientas
  src/verify.ts       verificación y reparación
  src/voice/provider.ts · voice/elevenlabs.ts · voice/fake.ts · voice/index.ts
  src/output.ts       guide.json + índice
  src/build.ts        orquestación
  src/login.ts        sesión de la app
  src/cli.ts · src/bin.ts  comandos
  test/helpers/server.ts · test/fixtures/site/*.html · test/*.test.ts
examples/demo-app/    app Vite «Reportes» + feature.patch + explicame.fake-script.json
```

---

### Task 1: Monorepo y formato del guion

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/src/guide.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/guide.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `LANGUAGES`, `type Lang = "es" | "en"`, `type LocalizedText = Partial<Record<Lang, string>>`, `MAX_NARRATION = 300`, `StrategySchema` / `type Strategy`, `ActionSchema` / `type Action`, `StepSchema` / `type Step`, `GuideSchema` / `type Guide`, `validateGuide(input: unknown): ValidationResult` con `ValidationResult = { ok: true; guide: Guide } | { ok: false; errors: string[] }`.

- [ ] **Step 1: Crear la base del monorepo**

`package.json`:
```json
{
  "name": "explicame-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "examples/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "npm run build -w explicame"
  },
  "devDependencies": {
    "@types/node": "^22.20.4",
    "jsdom": "^30.1.1",
    "typescript": "5.9.3",
    "vite": "^8.3.2",
    "vitest": "^5.0.3"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  }
}
```

`tsconfig.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "paths": { "@explicame/core": ["./packages/core/src/index.ts"] }
  },
  "include": ["packages/*/src", "packages/*/test", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@explicame/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
```

`.gitignore`:
```
node_modules/
dist/
.explicame/
examples/demo-app/dist/
examples/demo-app/public/explicame/
*.log
```

`packages/core/package.json`:
```json
{
  "name": "@explicame/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.6.5" }
}
```

Run: `npm install`
Expected: termina sin errores y crea `package-lock.json`.

- [ ] **Step 2: Escribir la prueba que falla**

`packages/core/test/guide.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateGuide } from "../src/guide.js";

const base = () => ({
  schemaVersion: 1,
  id: "filtro-por-fecha",
  languages: ["es", "en"],
  title: { es: "Nuevo filtro por fecha", en: "New date filter" },
  startUrl: "/reportes",
  steps: [
    {
      narration: { es: "Aquí abres el filtro.", en: "Here you open the filter." },
      target: { strategies: [{ by: "testid", value: "filtro-fecha" }] },
      action: { type: "click" },
      opens: "dialog",
    },
  ],
  source: { base: "main", head: "feature/filtro", commit: "abc1234", generatedBy: "api", createdAt: "2026-10-01T18:00:00.000Z" },
});

describe("validateGuide", () => {
  it("accepts a well-formed guide", () => {
    const result = validateGuide(base());
    expect(result.ok).toBe(true);
  });

  it("requires every active language in narrations and title", () => {
    const g = base();
    g.steps[0]!.narration = { es: "Solo en español." } as typeof g.steps[0]["narration"];
    const result = validateGuide(g);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("steps.0.narration.en");
  });

  it("rejects narrations longer than 300 characters", () => {
    const g = base();
    g.steps[0]!.narration.es = "a".repeat(301);
    expect(validateGuide(g).ok).toBe(false);
  });

  it("rejects an action without a target, except navigate", () => {
    const g = base();
    delete (g.steps[0] as { target?: unknown }).target;
    expect(validateGuide(g).ok).toBe(false);
    g.steps[0]!.action = { type: "navigate", url: "/ayuda" } as unknown as { type: "click" };
    expect(validateGuide(g).ok).toBe(true);
  });

  it("rejects ids that are not kebab-case and external navigation", () => {
    expect(validateGuide({ ...base(), id: "Filtro Fecha" }).ok).toBe(false);
    const g = base();
    g.steps[0]!.action = { type: "navigate", url: "https://otro.sitio" } as unknown as { type: "click" };
    expect(validateGuide(g).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/core/test/guide.test.ts`
Expected: FAIL — `Failed to resolve import "../src/guide.js"`.

- [ ] **Step 4: Implementar el formato**

`packages/core/src/guide.ts`:
```ts
import { z } from "zod";

export const LANGUAGES = ["es", "en"] as const;
export type Lang = (typeof LANGUAGES)[number];
export type LocalizedText = Partial<Record<Lang, string>>;
export const MAX_NARRATION = 300;

export const StrategySchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("tour"), value: z.string().min(1) }),
  z.object({ by: z.literal("testid"), value: z.string().min(1) }),
  z.object({ by: z.literal("role"), role: z.string().min(1), name: z.string().min(1) }),
  z.object({ by: z.literal("label"), value: z.string().min(1) }),
  z.object({ by: z.literal("text"), value: z.string().min(1) }),
  z.object({ by: z.literal("css"), value: z.string().min(1) }),
]);
export type Strategy = z.infer<typeof StrategySchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click") }),
  z.object({ type: z.literal("type"), value: z.string().min(1) }),
  z.object({ type: z.literal("select"), value: z.string().min(1) }),
  z.object({ type: z.literal("navigate"), url: z.string().startsWith("/") }),
]);
export type Action = z.infer<typeof ActionSchema>;

const Localized = z.partialRecord(z.enum(LANGUAGES), z.string().min(1));

export const StepSchema = z.object({
  narration: Localized,
  target: z.object({ strategies: z.array(StrategySchema).min(1).max(6) }).optional(),
  action: ActionSchema.optional(),
  opens: z.enum(["dialog", "menu", "mode"]).optional(),
  audio: Localized.optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const GuideSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    languages: z.array(z.enum(LANGUAGES)).min(1),
    title: Localized,
    startUrl: z.string().startsWith("/"),
    steps: z.array(StepSchema).min(1),
    source: z.object({
      base: z.string(),
      head: z.string(),
      commit: z.string(),
      generatedBy: z.enum(["api", "claude-code", "fake"]),
      model: z.string().optional(),
      createdAt: z.string(),
    }),
  })
  .superRefine((guide, ctx) => {
    const requireAll = (text: LocalizedText, path: (string | number)[]) => {
      for (const lang of guide.languages) {
        const value = text[lang];
        if (!value) ctx.addIssue({ code: "custom", path: [...path, lang], message: `missing ${lang}` });
        else if (value.length > MAX_NARRATION)
          ctx.addIssue({ code: "custom", path: [...path, lang], message: `longer than ${MAX_NARRATION} characters` });
      }
    };
    requireAll(guide.title, ["title"]);
    guide.steps.forEach((step, index) => {
      requireAll(step.narration, ["steps", index, "narration"]);
      if (step.action && step.action.type !== "navigate" && !step.target)
        ctx.addIssue({ code: "custom", path: ["steps", index, "action"], message: "this action needs a target" });
    });
  });
export type Guide = z.infer<typeof GuideSchema>;

export type ValidationResult = { ok: true; guide: Guide } | { ok: false; errors: string[] };

export function validateGuide(input: unknown): ValidationResult {
  const result = GuideSchema.safeParse(input);
  if (result.success) return { ok: true, guide: result.data };
  return { ok: false, errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
```

`packages/core/src/index.ts`:
```ts
export * from "./guide.js";
```

- [ ] **Step 5: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/core/test/guide.test.ts && npm run typecheck`
Expected: PASS (5 pruebas) y typecheck sin errores.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.json vitest.config.ts .gitignore packages/core
git commit -m "feat(core): monorepo y formato del guion con validación"
```

### Task 2: Reglas de seguridad

**Files:**
- Create: `packages/core/src/safety.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/safety.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `DESTRUCTIVE_WORDS`, `SAFE_METHODS`, `interface AllowRule { method: string; url: string }`, `isDestructiveName(name: string): boolean`, `interface ElementFacts { tag: string; type?: string; role: string; name: string; inForm: boolean }`, `type SafetyVerdict = { ok: true } | { ok: false; reason: "submit" | "destructive" }`, `checkClickSafety(el: ElementFacts): SafetyVerdict`, `isRequestAllowed(method: string, url: string, allow?: AllowRule[]): boolean`, `globMatch(pattern: string, value: string): boolean`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/core/test/safety.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkClickSafety, globMatch, isDestructiveName, isRequestAllowed } from "../src/safety.js";

describe("isDestructiveName", () => {
  it("detects destructive words in Spanish and English, with or without accents", () => {
    expect(isDestructiveName("Guardar cambios")).toBe(true);
    expect(isDestructiveName("ELIMINAR")).toBe(true);
    expect(isDestructiveName("Confirmar pedido")).toBe(true);
    expect(isDestructiveName("Save draft")).toBe(true);
    expect(isDestructiveName("Publish now")).toBe(true);
  });
  it("does not flag words that only contain a destructive word", () => {
    expect(isDestructiveName("Guardados")).toBe(false);
    expect(isDestructiveName("Enviados")).toBe(false);
    expect(isDestructiveName("Filtrar")).toBe(false);
  });
});

describe("checkClickSafety", () => {
  it("blocks submit buttons inside forms", () => {
    expect(checkClickSafety({ tag: "button", type: "submit", role: "button", name: "Aplicar", inForm: true })).toEqual({ ok: false, reason: "submit" });
    expect(checkClickSafety({ tag: "input", type: "submit", role: "button", name: "Ir", inForm: false })).toEqual({ ok: false, reason: "submit" });
  });
  it("blocks destructive names even on plain buttons", () => {
    expect(checkClickSafety({ tag: "button", type: "button", role: "button", name: "Guardar como predeterminado", inForm: true })).toEqual({ ok: false, reason: "destructive" });
  });
  it("allows ordinary buttons and links", () => {
    expect(checkClickSafety({ tag: "button", type: "button", role: "button", name: "Filtrar", inForm: true })).toEqual({ ok: true });
    expect(checkClickSafety({ tag: "a", role: "link", name: "Ayuda", inForm: false })).toEqual({ ok: true });
  });
});

describe("isRequestAllowed", () => {
  it("allows safe methods and blocks writes by default", () => {
    expect(isRequestAllowed("GET", "http://app.test/api/x")).toBe(true);
    expect(isRequestAllowed("options", "http://app.test/api/x")).toBe(true);
    expect(isRequestAllowed("POST", "http://app.test/api/x")).toBe(false);
    expect(isRequestAllowed("DELETE", "http://app.test/api/x")).toBe(false);
  });
  it("lets through exactly the allow-listed method and path", () => {
    const allow = [{ method: "POST", url: "/graphql*" }];
    expect(isRequestAllowed("POST", "http://app.test/graphql?op=q", allow)).toBe(true);
    expect(isRequestAllowed("PUT", "http://app.test/graphql", allow)).toBe(false);
    expect(isRequestAllowed("POST", "http://app.test/api/graphql", allow)).toBe(false);
  });
  it("matches full URLs when the rule starts with http", () => {
    expect(isRequestAllowed("POST", "https://api.other.test/search", [{ method: "POST", url: "https://api.other.test/*" }])).toBe(true);
  });
  it("globMatch escapes regex characters", () => {
    expect(globMatch("/a.b/*", "/a.b/c")).toBe(true);
    expect(globMatch("/a.b/*", "/aXb/c")).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/core/test/safety.test.ts`
Expected: FAIL — `Failed to resolve import "../src/safety.js"`.

- [ ] **Step 3: Implementar**

`packages/core/src/safety.ts`:
```ts
export const DESTRUCTIVE_WORDS = [
  "guardar", "enviar", "eliminar", "borrar", "pagar", "confirmar", "publicar",
  "save", "submit", "send", "delete", "remove", "pay", "confirm", "publish",
] as const;

export const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"] as const;

export interface AllowRule {
  method: string;
  /** Glob with `*`. Matched against the full URL when it starts with http, otherwise against path + query. */
  url: string;
}

export interface ElementFacts {
  tag: string;
  type?: string;
  role: string;
  name: string;
  inForm: boolean;
}

export type SafetyVerdict = { ok: true } | { ok: false; reason: "submit" | "destructive" };

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function isDestructiveName(name: string): boolean {
  const words = normalize(name).split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word) => (DESTRUCTIVE_WORDS as readonly string[]).includes(word));
}

export function checkClickSafety(el: ElementFacts): SafetyVerdict {
  const tag = el.tag.toLowerCase();
  const type = (el.type ?? "").toLowerCase();
  const submitButton = tag === "button" && el.inForm && (type === "" || type === "submit");
  const submitInput = tag === "input" && (type === "submit" || type === "image");
  if (submitButton || submitInput) return { ok: false, reason: "submit" };
  if (isDestructiveName(el.name)) return { ok: false, reason: "destructive" };
  return { ok: true };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function globMatch(pattern: string, value: string): boolean {
  const source = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${source}$`).test(value);
}

export function isRequestAllowed(method: string, url: string, allow: AllowRule[] = []): boolean {
  const upper = method.toUpperCase();
  if ((SAFE_METHODS as readonly string[]).includes(upper)) return true;
  const parsed = new URL(url);
  const pathAndQuery = parsed.pathname + parsed.search;
  return allow.some(
    (rule) =>
      rule.method.toUpperCase() === upper &&
      globMatch(rule.url, rule.url.startsWith("http") ? url : pathAndQuery),
  );
}
```

Añadir a `packages/core/src/index.ts`:
```ts
export * from "./safety.js";
```

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/core/test/safety.test.ts && npm run typecheck`
Expected: PASS (8 pruebas).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): reglas de seguridad para clics y peticiones"
```

---

### Task 3: Mensajes bilingües

**Files:**
- Create: `packages/core/src/i18n.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/i18n.test.ts`

**Interfaces:**
- Consumes: `type Lang` (Task 1).
- Produces: `MESSAGES`, `type MessageKey`, `t(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/core/test/i18n.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MESSAGES, t } from "../src/i18n.js";

describe("t", () => {
  it("fills parameters in each language", () => {
    expect(t("es", "app.unreachable", { url: "http://localhost:5173" })).toBe("No pude abrir http://localhost:5173: ¿está corriendo la app?");
    expect(t("en", "app.unreachable", { url: "http://localhost:5173" })).toBe("I couldn't open http://localhost:5173: is the app running?");
  });
  it("leaves unknown placeholders visible", () => {
    expect(t("en", "tool.stepLimit")).toContain("{max}");
  });
  it("has the same keys in both languages", () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.es).sort());
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/core/test/i18n.test.ts`
Expected: FAIL — `Failed to resolve import "../src/i18n.js"`.

- [ ] **Step 3: Implementar**

`packages/core/src/i18n.ts`:
```ts
import type { Lang } from "./guide.js";

const es = {
  "app.unreachable": "No pude abrir {url}: ¿está corriendo la app?",
  "diff.empty": "No hay cambios entre {base} y {head}: no hay nada que explicar.",
  "diff.truncated": "El diff era muy grande; quedaron fuera: {files}",
  "config.invalid": "explicame.config.json no es válido: {errors}",
  "config.secretInConfig": "explicame.config.json no puede contener claves ({key}). Usa variables de entorno o ~/.explicame/credentials.json.",
  "credentials.missing": "Falta la clave de {name}. Configúrala en el panel, en la variable de entorno {env} o en ~/.explicame/credentials.json.",
  "tool.unknownElement": "Element {id} is not on the current screen. Call observe to get the updated map.",
  "tool.unsafeSubmit": "Element {id} submits a form: it can only be pointed at, not clicked. Use add_step with action null.",
  "tool.unsafeDestructive": "Element {id} (\"{name}\") saves, sends or deletes data: it can only be pointed at, not clicked. Use add_step with action null.",
  "tool.noStableSelector": "There is no stable way to find {id} again. Pick another element.",
  "tool.actionFailed": "The {action} action on {id} failed: {error}",
  "tool.invalidInput": "Invalid input for {tool}: {errors}",
  "tool.stepLimit": "You reached the maximum of {max} steps: call finish.",
  "loop.noFinish": "La IA terminó sin llamar a finish.",
  "verify.failed": "El paso {index} no se pudo verificar: {error}",
  "voice.allFailed": "Ningún proveedor de voz respondió para el paso {index} ({lang}); ese paso usará la voz del navegador.",
  "voice.noProvider": "No hay proveedor de voz configurado: la guía usará la voz del navegador.",
  "estimate.cost": "Costo estimado: ~US${usd} ({model}, hasta {steps} pasos).",
  "login.instructions": "Inicia sesión en la ventana que se abrió y cierra la pestaña cuando termines.",
  "login.saved": "Sesión guardada en {path}",
  "build.done": "Listo: {count} pasos en {langs}. Guía en {path}",
} as const;

const en: Record<keyof typeof es, string> = {
  "app.unreachable": "I couldn't open {url}: is the app running?",
  "diff.empty": "There are no changes between {base} and {head}: nothing to explain.",
  "diff.truncated": "The diff was too large; these files were left out: {files}",
  "config.invalid": "explicame.config.json is not valid: {errors}",
  "config.secretInConfig": "explicame.config.json can't contain keys ({key}). Use environment variables or ~/.explicame/credentials.json.",
  "credentials.missing": "The {name} key is missing. Set it in the panel, in the {env} environment variable or in ~/.explicame/credentials.json.",
  "tool.unknownElement": "Element {id} is not on the current screen. Call observe to get the updated map.",
  "tool.unsafeSubmit": "Element {id} submits a form: it can only be pointed at, not clicked. Use add_step with action null.",
  "tool.unsafeDestructive": "Element {id} (\"{name}\") saves, sends or deletes data: it can only be pointed at, not clicked. Use add_step with action null.",
  "tool.noStableSelector": "There is no stable way to find {id} again. Pick another element.",
  "tool.actionFailed": "The {action} action on {id} failed: {error}",
  "tool.invalidInput": "Invalid input for {tool}: {errors}",
  "tool.stepLimit": "You reached the maximum of {max} steps: call finish.",
  "loop.noFinish": "The AI stopped without calling finish.",
  "verify.failed": "Step {index} could not be verified: {error}",
  "voice.allFailed": "No voice provider answered for step {index} ({lang}); that step will use the browser voice.",
  "voice.noProvider": "No voice provider is configured: the guide will use the browser voice.",
  "estimate.cost": "Estimated cost: ~US${usd} ({model}, up to {steps} steps).",
  "login.instructions": "Log in in the window that opened and close the tab when you're done.",
  "login.saved": "Session saved at {path}",
  "build.done": "Done: {count} steps in {langs}. Guide at {path}",
};

export const MESSAGES = { es, en } as const;
export type MessageKey = keyof typeof es;

export function t(lang: Lang, key: MessageKey, params: Record<string, string | number> = {}): string {
  const template: string = MESSAGES[lang][key] ?? MESSAGES.es[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
```

Las claves `tool.*` son iguales en los dos idiomas a propósito: son resultados de herramientas y siempre van a la IA en inglés.

Añadir a `packages/core/src/index.ts`:
```ts
export * from "./i18n.js";
```

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/core/test/i18n.test.ts && npm run typecheck`
Expected: PASS (3 pruebas).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): mensajes en español e inglés"
```

---

### Task 4: Runtime DOM (mapa de elementos y selectores)

Es JavaScript plano dentro de un string: la CLI lo inyecta en las páginas con Playwright y, en el plan 2, el reproductor lo evaluará igual. Así la generación, la verificación y la reproducción encuentran los elementos con **el mismo código**. No se escribe como módulo para que ningún transpilador le meta helpers que no existen en la página.

**Files:**
- Create: `packages/core/src/domRuntime.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/domRuntime.test.ts`

**Interfaces:**
- Consumes: `type Strategy` (Task 1), `interface ElementFacts` (Task 2).
- Produces: `DOM_RUNTIME: string` (instala `window.__explicame`), `interface ObservedElement { id; role; name; tag; type?; label?; placeholder?; text?; tour?; testid?; options?: string[]; disabled: boolean; inForm: boolean; box: { x; y; w; h } }`, `interface Observation { url: string; title: string; elements: ObservedElement[]; truncated: boolean }`, `interface ExplicameRuntime { observe(max?: number): Observation; byId(id: string): Element | null; uniqueStrategies(el: Element): Strategy[]; candidateStrategies(el: Element): Strategy[]; resolve(strategies: Strategy[]): Element | null; matchAll(s: Strategy): Element[]; describe(el: Element): ElementFacts; roleOf(el: Element): string; nameOf(el: Element): string; labelOf(el: Element): string; cssPath(el: Element): string }`, y la ampliación global `Window.__explicame` / `Window.__explicameNoLayout`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/core/test/domRuntime.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DOM_RUNTIME } from "../src/domRuntime.js";

function install(html: string) {
  document.body.innerHTML = html;
  window.__explicame = undefined;
  window.__explicameNoLayout = true; // jsdom has no layout: every rendered element counts as visible
  new Function(DOM_RUNTIME)();
  return window.__explicame!;
}
const q = (selector: string) => document.querySelector(selector)!;

describe("roles and names", () => {
  it("approximates ARIA roles and accessible names", () => {
    const rt = install(`
      <button>Filtrar</button>
      <a href="/x">Ayuda</a>
      <label for="d">Desde</label><input id="d" type="date">
      <input placeholder="Buscar" id="s">
      <button aria-label="Cerrar" id="c">×</button>
      <label>Agrupar por <select id="g"><option>Día</option><option>Semana</option></select></label>`);
    expect([rt.roleOf(q("button")), rt.nameOf(q("button"))]).toEqual(["button", "Filtrar"]);
    expect([rt.roleOf(q("a")), rt.nameOf(q("a"))]).toEqual(["link", "Ayuda"]);
    expect([rt.roleOf(q("#d")), rt.nameOf(q("#d")), rt.labelOf(q("#d"))]).toEqual(["textbox", "Desde", "Desde"]);
    expect(rt.nameOf(q("#s"))).toBe("Buscar");
    expect(rt.nameOf(q("#c"))).toBe("Cerrar");
    expect([rt.roleOf(q("#g")), rt.nameOf(q("#g")), rt.labelOf(q("#g"))]).toEqual(["combobox", "Agrupar por", "Agrupar por"]);
  });
});

describe("selectors", () => {
  it("prefers data-testid and keeps only unique strategies", () => {
    const rt = install(`
      <button data-testid="f">Filtrar</button>
      <section><button>Exportar</button></section>
      <section><button>Exportar</button></section>`);
    expect(rt.uniqueStrategies(q("[data-testid=f]"))[0]).toEqual({ by: "testid", value: "f" });

    const second = document.querySelectorAll("section button")[1]!;
    const strategies = rt.uniqueStrategies(second);
    expect(strategies.some((s) => s.by === "role" || s.by === "text")).toBe(false);
    expect(strategies.at(-1)).toEqual({ by: "css", value: "body > section:nth-of-type(2) > button" });
    expect(rt.resolve(strategies)).toBe(second);
  });

  it("returns null when nothing matches and survives invalid CSS", () => {
    const rt = install(`<button>Filtrar</button>`);
    expect(rt.resolve([{ by: "testid", value: "nope" }])).toBeNull();
    expect(rt.matchAll({ by: "css", value: ")(" })).toEqual([]);
  });
});

describe("observe", () => {
  it("marks visible elements in document order and skips hidden or closed content", () => {
    const rt = install(`
      <h1>Reportes</h1>
      <button>Filtrar</button>
      <div hidden><button>Oculto</button></div>
      <dialog><button>Dentro</button></dialog>`);
    const obs = rt.observe();
    expect(obs.elements.map((e) => e.name)).toEqual(["Reportes", "Filtrar"]);
    expect(q("button").getAttribute("data-explicame-id")).toBe("e2");
    expect(rt.byId("e2")).toBe(q("button"));
    expect(obs.truncated).toBe(false);
  });

  it("describes elements for the safety rules", () => {
    const rt = install(`<form><button>Guardar</button></form>`);
    expect(rt.describe(q("button"))).toEqual({ tag: "button", type: "submit", role: "button", name: "Guardar", inForm: true });
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/core/test/domRuntime.test.ts`
Expected: FAIL — `Failed to resolve import "../src/domRuntime.js"`.

- [ ] **Step 3: Implementar**

`packages/core/src/domRuntime.ts`:
```ts
import type { Strategy } from "./guide.js";
import type { ElementFacts } from "./safety.js";

export interface ObservedElement {
  id: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  tour?: string;
  testid?: string;
  options?: string[];
  disabled: boolean;
  inForm: boolean;
  box: { x: number; y: number; w: number; h: number };
}

export interface Observation {
  url: string;
  title: string;
  elements: ObservedElement[];
  truncated: boolean;
}

export interface ExplicameRuntime {
  observe(max?: number): Observation;
  byId(id: string): Element | null;
  uniqueStrategies(el: Element): Strategy[];
  candidateStrategies(el: Element): Strategy[];
  resolve(strategies: Strategy[]): Element | null;
  matchAll(strategy: Strategy): Element[];
  describe(el: Element): ElementFacts;
  roleOf(el: Element): string;
  nameOf(el: Element): string;
  labelOf(el: Element): string;
  cssPath(el: Element): string;
}

declare global {
  interface Window {
    __explicame?: ExplicameRuntime;
    __explicameNoLayout?: boolean;
  }
}

/**
 * Plain JavaScript installed in the page (Playwright addInitScript, or evaluated by the player).
 * Keep it dependency-free and ES5-style: it is a string, not a module.
 */
export const DOM_RUNTIME = String.raw`(function () {
  if (window.__explicame) return;
  var MARK = "data-explicame-id";
  var INTERACTIVE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [contenteditable=""], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="option"], [role="textbox"], [role="slider"]';
  var LANDMARKS = 'h1, h2, h3, [role="dialog"], dialog[open], [role="alert"], [role="status"]';
  var ROLES = ["button", "link", "textbox", "searchbox", "combobox", "listbox", "checkbox", "radio", "switch", "tab", "menuitem", "option", "slider", "heading", "dialog"];
  var esc = window.CSS && window.CSS.escape ? function (s) { return window.CSS.escape(s); } : function (s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) { return "\\" + c; }); };

  function clean(s, max) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return max && s.length > max ? s.slice(0, max) : s; }
  function quote(s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

  function roleOf(el) {
    var explicit = el.getAttribute("role");
    if (explicit) return explicit.split(" ")[0];
    var tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "select") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "dialog") return "dialog";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].indexOf(type) >= 0) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return tag;
  }

  function textWithoutControls(node) {
    var copy = node.cloneNode(true);
    Array.prototype.forEach.call(copy.querySelectorAll("input, select, textarea, button"), function (n) { n.parentNode.removeChild(n); });
    return clean(copy.textContent, 200);
  }

  function labelOf(el) {
    var by = el.getAttribute("aria-labelledby");
    if (by) return clean(by.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? n.textContent : ""; }).join(" "), 200);
    if (el.id) { var forLabel = document.querySelector('label[for="' + quote(el.id) + '"]'); if (forLabel) return textWithoutControls(forLabel); }
    var wrap = el.closest("label");
    return wrap ? textWithoutControls(wrap) : "";
  }

  function nameOf(el) {
    var aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clean(aria, 200);
    var label = labelOf(el);
    if (label) return label;
    var tag = el.tagName.toLowerCase();
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset"].indexOf(type) >= 0) return clean(el.value || (type === "submit" ? "Submit" : ""), 200);
      if (type === "image") return clean(el.getAttribute("alt"), 200);
      return clean(el.getAttribute("placeholder") || el.getAttribute("title"), 200);
    }
    if (tag === "textarea" || tag === "select") return clean(el.getAttribute("title") || el.getAttribute("placeholder"), 200);
    var text = clean(typeof el.innerText === "string" && el.innerText !== "" ? el.innerText : el.textContent, 200);
    if (text) return text;
    var img = el.querySelector("img[alt]");
    return img ? clean(img.getAttribute("alt"), 200) : clean(el.getAttribute("title"), 200);
  }

  function isVisible(el) {
    if (!el.isConnected || el.closest("[hidden]") || el.closest("dialog:not([open])")) return false;
    var style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (window.__explicameNoLayout) return true;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function stableId(node) {
    var id = node.id;
    return !!id && /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}/.test(id) && document.querySelectorAll("#" + esc(id)).length === 1;
  }

  function cssPath(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      if (stableId(node)) { parts.unshift("#" + esc(node.id)); break; }
      if (node === document.body) { parts.unshift("body"); break; }
      var parent = node.parentElement;
      var selector = node.tagName.toLowerCase();
      if (parent) {
        var current = node;
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === current.tagName; });
        if (same.length > 1) selector += ":nth-of-type(" + (same.indexOf(current) + 1) + ")";
      }
      parts.unshift(selector);
      node = parent;
    }
    return parts.join(" > ");
  }

  function ownText(el) { return clean(el.textContent, 200); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }

  function matchAll(s) {
    try {
      if (s.by === "tour") return all('[data-tour="' + quote(s.value) + '"]').filter(isVisible);
      if (s.by === "testid") return all('[data-testid="' + quote(s.value) + '"]').filter(isVisible);
      if (s.by === "css") return all(s.value).filter(isVisible);
      if (s.by === "role") return all("*").filter(function (el) { return roleOf(el) === s.role && nameOf(el) === s.name; }).filter(isVisible);
      if (s.by === "label") return all("input, select, textarea").filter(function (el) { return labelOf(el) === s.value; }).filter(isVisible);
      if (s.by === "text") return all("body *").filter(function (el) {
        return ownText(el) === s.value && !Array.prototype.some.call(el.children, function (c) { return ownText(c) === s.value; });
      }).filter(isVisible);
    } catch (e) { return []; }
    return [];
  }

  function candidateStrategies(el) {
    var out = [];
    var tour = el.getAttribute("data-tour"); if (tour) out.push({ by: "tour", value: tour });
    var testid = el.getAttribute("data-testid"); if (testid) out.push({ by: "testid", value: testid });
    var role = roleOf(el); var name = nameOf(el);
    if (ROLES.indexOf(role) >= 0 && name && name.length <= 80) out.push({ by: "role", role: role, name: name });
    var label = labelOf(el); if (label && label.length <= 80) out.push({ by: "label", value: label });
    var text = ownText(el);
    if (text && text.length <= 40 && ["input", "select", "textarea"].indexOf(el.tagName.toLowerCase()) < 0) out.push({ by: "text", value: text });
    out.push({ by: "css", value: cssPath(el) });
    return out;
  }

  function uniqueStrategies(el) {
    return candidateStrategies(el).filter(function (s) { var m = matchAll(s); return m.length === 1 && m[0] === el; }).slice(0, 6);
  }

  function resolve(strategies) {
    for (var i = 0; i < strategies.length; i++) { var m = matchAll(strategies[i]); if (m.length === 1) return m[0]; }
    return null;
  }

  function describe(el) {
    var facts = { tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el), inForm: !!el.closest("form") };
    if (el.type) facts.type = String(el.type).toLowerCase();
    return { tag: facts.tag, type: facts.type, role: facts.role, name: facts.name, inForm: facts.inForm };
  }

  function observe(max) {
    max = max || 150;
    all("[" + MARK + "]").forEach(function (n) { n.removeAttribute(MARK); });
    var visible = all(INTERACTIVE + ", " + LANDMARKS).filter(isVisible);
    var height = window.innerHeight || 800;
    var inView = []; var rest = [];
    visible.forEach(function (el) { var r = el.getBoundingClientRect(); (r.bottom >= 0 && r.top <= height ? inView : rest).push(el); });
    var picked = inView.concat(rest).slice(0, max);
    picked.sort(function (a, b) { return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
    var elements = picked.map(function (el, i) {
      var id = "e" + (i + 1);
      el.setAttribute(MARK, id);
      var r = el.getBoundingClientRect();
      var item = { id: id, role: roleOf(el), name: nameOf(el), tag: el.tagName.toLowerCase(), disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true", inForm: !!el.closest("form"), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
      if (el.type) item.type = String(el.type).toLowerCase();
      var label = labelOf(el); if (label) item.label = label;
      var placeholder = el.getAttribute("placeholder"); if (placeholder) item.placeholder = clean(placeholder, 80);
      var text = ownText(el); if (text && text !== item.name) item.text = clean(text, 80);
      var tour = el.getAttribute("data-tour"); if (tour) item.tour = tour;
      var testid = el.getAttribute("data-testid"); if (testid) item.testid = testid;
      if (el.tagName === "SELECT") item.options = Array.prototype.map.call(el.options, function (o) { return clean(o.label || o.text, 40); }).slice(0, 20);
      return item;
    });
    return { url: location.pathname + location.search, title: document.title, elements: elements, truncated: visible.length > picked.length };
  }

  function byId(id) { return document.querySelector("[" + MARK + '="' + quote(id) + '"]'); }

  window.__explicame = { observe: observe, byId: byId, uniqueStrategies: uniqueStrategies, candidateStrategies: candidateStrategies, resolve: resolve, matchAll: matchAll, describe: describe, roleOf: roleOf, nameOf: nameOf, labelOf: labelOf, cssPath: cssPath };
})();`;
```

`describe` devuelve `type: undefined` cuando el elemento no tiene tipo; `toEqual` lo trata igual que la ausencia de la propiedad.

Añadir a `packages/core/src/index.ts`:
```ts
export * from "./domRuntime.js";
```

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/core/test/domRuntime.test.ts && npm run typecheck`
Expected: PASS (5 pruebas).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): runtime DOM compartido para observar y resolver elementos"
```

---

### Task 5: Herramientas del bucle y prompts

**Files:**
- Create: `packages/core/src/tools.ts`, `packages/core/src/prompts.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/tools.test.ts`, `packages/core/test/prompts.test.ts`

**Interfaces:**
- Consumes: `Lang`, `LocalizedText`, `Action`, `MAX_NARRATION` (Task 1).
- Produces: `TOOL_NAMES`, `type ToolName = "observe" | "act" | "add_step" | "finish"`, `interface ToolDef { name: ToolName; description: string; input_schema: Record<string, unknown> }`, `ACTION_KINDS`, `type ActionKind = "click" | "type" | "select" | "navigate"`, `OPENS_KINDS`, `type OpensKind = "dialog" | "menu" | "mode"`, `buildTools(languages: Lang[]): ToolDef[]`, `type ParsedCall` (unión por `name`), `parseToolCall(name: string, input: unknown, languages: Lang[]): { ok: true; call: ParsedCall } | { ok: false; error: string }`, `toAction(kind: ActionKind, value: string | null, url: string | null): { ok: true; action: Action } | { ok: false; error: string }`, `interface PromptContext { languages; appUrl; startUrl; maxSteps; diff; files: { path: string; content: string }[]; description?: string; omittedFiles: string[] }`, `systemPrompt(languages: Lang[], maxSteps: number): string`, `initialMessage(ctx: PromptContext): string`, `repairMessage(index: number, error: string, observationJson: string): string`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`packages/core/test/tools.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildTools, parseToolCall, toAction } from "../src/tools.js";

const step = (narration: Record<string, string>) => ({
  narration, element_id: "e3", action: "click", value: null, url: null, opens: "dialog",
});

describe("buildTools", () => {
  it("defines the four loop tools with one narration field per language", () => {
    const tools = buildTools(["es", "en"]);
    expect(tools.map((t) => t.name)).toEqual(["observe", "act", "add_step", "finish"]);
    const addStep = tools.find((t) => t.name === "add_step")!;
    const narration = (addStep.input_schema.properties as Record<string, { required: string[] }>).narration;
    expect(narration.required).toEqual(["es", "en"]);
    const single = buildTools(["es"]).find((t) => t.name === "add_step")!;
    expect((single.input_schema.properties as Record<string, { required: string[] }>).narration.required).toEqual(["es"]);
  });
});

describe("parseToolCall", () => {
  it("parses add_step into camelCase", () => {
    const parsed = parseToolCall("add_step", step({ es: "Abre el filtro.", en: "Open the filter." }), ["es", "en"]);
    expect(parsed).toEqual({
      ok: true,
      call: { name: "add_step", narration: { es: "Abre el filtro.", en: "Open the filter." }, elementId: "e3", action: "click", value: null, url: null, opens: "dialog" },
    });
  });
  it("rejects a narration missing an active language", () => {
    const parsed = parseToolCall("add_step", step({ es: "Solo español." }), ["es", "en"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("narration.en");
  });
  it("rejects narrations longer than 300 characters and unknown tools", () => {
    expect(parseToolCall("add_step", step({ es: "a".repeat(301), en: "ok" }), ["es", "en"]).ok).toBe(false);
    expect(parseToolCall("delete_everything", {}, ["es"]).ok).toBe(false);
  });
  it("parses observe, act and finish", () => {
    expect(parseToolCall("observe", {}, ["es"])).toEqual({ ok: true, call: { name: "observe" } });
    expect(parseToolCall("act", { element_id: null, action: "navigate", value: null, url: "/ayuda" }, ["es"]).ok).toBe(true);
    expect(parseToolCall("finish", { title: { es: "Filtro" } }, ["es"])).toEqual({ ok: true, call: { name: "finish", title: { es: "Filtro" } } });
  });
});

describe("toAction", () => {
  it("builds guide actions and explains what is missing", () => {
    expect(toAction("click", null, null)).toEqual({ ok: true, action: { type: "click" } });
    expect(toAction("type", "2026-09-01", null)).toEqual({ ok: true, action: { type: "type", value: "2026-09-01" } });
    expect(toAction("select", null, null).ok).toBe(false);
    expect(toAction("navigate", null, "/ayuda")).toEqual({ ok: true, action: { type: "navigate", url: "/ayuda" } });
    expect(toAction("navigate", null, "https://otro.sitio").ok).toBe(false);
  });
});
```

`packages/core/test/prompts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { initialMessage, repairMessage, systemPrompt } from "../src/prompts.js";

describe("prompts", () => {
  it("system prompt names the languages and the step limit", () => {
    const text = systemPrompt(["es", "en"], 12);
    expect(text).toContain("Spanish (es) and English (en)");
    expect(text).toContain("between 3 and 12 steps");
  });
  it("initial message carries the diff, the description, extra files and omitted files", () => {
    const text = initialMessage({
      languages: ["es"], appUrl: "http://localhost:5173", startUrl: "/reportes", maxSteps: 15,
      diff: "diff --git a/src/filter.ts b/src/filter.ts\n+export {}\n",
      files: [{ path: "src/table.ts", content: "export const x = 1;" }],
      description: "Filtro por fecha en reportes",
      omittedFiles: ["docs/big.md"],
    });
    expect(text).toContain("<diff>\ndiff --git a/src/filter.ts");
    expect(text).toContain("Filtro por fecha en reportes");
    expect(text).toContain('<file path="src/table.ts">');
    expect(text).toContain("docs/big.md");
    expect(text).toContain("http://localhost:5173");
  });
  it("repair message points at the failing step with the current observation", () => {
    const text = repairMessage(1, "target not found", '{"url":"/","title":"x","elements":[],"truncated":false}');
    expect(text).toContain("step 2 failed: target not found");
    expect(text).toContain('\n{"url":"/"');
  });
});
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/core/test/tools.test.ts packages/core/test/prompts.test.ts`
Expected: FAIL — no se resuelven `../src/tools.js` ni `../src/prompts.js`.

- [ ] **Step 3: Implementar**

`packages/core/src/tools.ts`:
```ts
import { z } from "zod";
import { MAX_NARRATION, type Action, type Lang, type LocalizedText } from "./guide.js";

export const TOOL_NAMES = ["observe", "act", "add_step", "finish"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const ACTION_KINDS = ["click", "type", "select", "navigate"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const OPENS_KINDS = ["dialog", "menu", "mode"] as const;
export type OpensKind = (typeof OPENS_KINDS)[number];

export interface ToolDef {
  name: ToolName;
  description: string;
  input_schema: Record<string, unknown>;
}

const nullableString = (description: string) => ({ type: ["string", "null"], description });

export function buildTools(languages: Lang[]): ToolDef[] {
  const localized = (description: string) => ({
    type: "object",
    description,
    properties: Object.fromEntries(languages.map((l) => [l, { type: "string", description: l === "es" ? "Spanish" : "English" }])),
    required: [...languages],
    additionalProperties: false,
  });
  return [
    {
      name: "observe",
      description: "Returns the current URL and the map of visible elements. Every element has an id such as e7; ids are valid until the screen changes.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "act",
      description: "Performs an action on the page without adding a step to the guide, to reach the screen where the feature lives. Returns the new map of elements.",
      input_schema: {
        type: "object",
        properties: {
          element_id: nullableString("Element id from the latest observation; null for navigate."),
          action: { type: "string", enum: [...ACTION_KINDS] },
          value: nullableString("Example text to type, or the label of the option to select; null otherwise."),
          url: nullableString("Same-origin path for navigate, such as /reports; null otherwise."),
        },
        required: ["element_id", "action", "value", "url"],
        additionalProperties: false,
      },
    },
    {
      name: "add_step",
      description: "Adds the next step of the guide: the narration, the element it points at (null for a narration-only step) and the action performed after the narration (null to only point at the element). Returns the new map of elements.",
      input_schema: {
        type: "object",
        properties: {
          narration: localized("What the narrator says in this step, written natively in each language."),
          element_id: nullableString("Element id from the latest observation, or null."),
          action: { type: ["string", "null"], enum: [...ACTION_KINDS, null] },
          value: nullableString("Example text to type, or the label of the option to select; null otherwise."),
          url: nullableString("Same-origin path for navigate; null otherwise."),
          opens: { type: ["string", "null"], enum: [...OPENS_KINDS, null], description: "What the action leaves open (so it can be closed when the learner exits), or null." },
        },
        required: ["narration", "element_id", "action", "value", "url", "opens"],
        additionalProperties: false,
      },
    },
    {
      name: "finish",
      description: "Ends the guide with a short title in every language.",
      input_schema: {
        type: "object",
        properties: { title: localized("Short title of the guide.") },
        required: ["title"],
        additionalProperties: false,
      },
    },
  ];
}

export type ParsedCall =
  | { name: "observe" }
  | { name: "act"; elementId: string | null; action: ActionKind; value: string | null; url: string | null }
  | {
      name: "add_step";
      narration: LocalizedText;
      elementId: string | null;
      action: ActionKind | null;
      value: string | null;
      url: string | null;
      opens: OpensKind | null;
    }
  | { name: "finish"; title: LocalizedText };

function localizedSchema(languages: Lang[]) {
  const shape: Record<string, z.ZodString> = {};
  for (const lang of languages) shape[lang] = z.string().min(1).max(MAX_NARRATION);
  return z.strictObject(shape);
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ");
}

export function parseToolCall(
  name: string,
  input: unknown,
  languages: Lang[],
): { ok: true; call: ParsedCall } | { ok: false; error: string } {
  if (name === "observe") return { ok: true, call: { name: "observe" } };
  if (name === "act") {
    const r = z
      .object({ element_id: z.string().nullable(), action: z.enum(ACTION_KINDS), value: z.string().nullable(), url: z.string().nullable() })
      .safeParse(input);
    if (!r.success) return { ok: false, error: formatIssues(r.error) };
    return { ok: true, call: { name: "act", elementId: r.data.element_id, action: r.data.action, value: r.data.value, url: r.data.url } };
  }
  if (name === "add_step") {
    const r = z
      .object({
        narration: localizedSchema(languages),
        element_id: z.string().nullable(),
        action: z.enum(ACTION_KINDS).nullable(),
        value: z.string().nullable(),
        url: z.string().nullable(),
        opens: z.enum(OPENS_KINDS).nullable(),
      })
      .safeParse(input);
    if (!r.success) return { ok: false, error: formatIssues(r.error) };
    return {
      ok: true,
      call: {
        name: "add_step",
        narration: r.data.narration as LocalizedText,
        elementId: r.data.element_id,
        action: r.data.action,
        value: r.data.value,
        url: r.data.url,
        opens: r.data.opens,
      },
    };
  }
  if (name === "finish") {
    const r = z.object({ title: localizedSchema(languages) }).safeParse(input);
    if (!r.success) return { ok: false, error: formatIssues(r.error) };
    return { ok: true, call: { name: "finish", title: r.data.title as LocalizedText } };
  }
  return { ok: false, error: `unknown tool ${name}` };
}

export function toAction(kind: ActionKind, value: string | null, url: string | null): { ok: true; action: Action } | { ok: false; error: string } {
  if (kind === "click") return { ok: true, action: { type: "click" } };
  if (kind === "navigate") {
    return url && url.startsWith("/")
      ? { ok: true, action: { type: "navigate", url } }
      : { ok: false, error: "navigate needs a same-origin url that starts with /" };
  }
  if (!value) return { ok: false, error: `${kind} needs a value (an example)` };
  return { ok: true, action: { type: kind, value } };
}
```

`packages/core/src/prompts.ts`:
```ts
import type { Lang } from "./guide.js";

export interface PromptContext {
  languages: Lang[];
  appUrl: string;
  startUrl: string;
  maxSteps: number;
  diff: string;
  files: { path: string; content: string }[];
  description?: string;
  omittedFiles: string[];
}

const LANGUAGE_NAMES: Record<Lang, string> = { es: "Spanish (es)", en: "English (en)" };

export function systemPrompt(languages: Lang[], maxSteps: number): string {
  const names = languages.map((l) => LANGUAGE_NAMES[l]).join(" and ");
  return [
    "You write the onboarding guide for a new feature of a web application. You explore the running app through tools, and every step you add is replayed later on the real screen with a highlight ring and a narrated voice.",
    "",
    "How to work:",
    "- Start with observe. Element ids (e1, e2, ...) come from the latest observation only; after anything changes the screen, use the observation the tool returns or call observe again.",
    "- Use act to reach the screen where the feature lives without creating guide steps. Use add_step for what the learner should see and do.",
    `- Write each narration natively in ${names}: one or two short sentences (at most 300 characters), friendly, in the second person, saying what the element is for rather than only its name.`,
    "- Focus on what the diff adds or changes. Mention other parts of the app only when the learner needs them to reach the feature.",
    "- Values you type or select are realistic examples. Nothing you do is saved, because requests that write data are blocked.",
    "- Buttons that save, send, delete, pay, confirm or publish, and form submit buttons, are pointed at with action null and explained; they are never clicked.",
    `- Use between 3 and ${maxSteps} steps, then call finish with a short title in every language.`,
  ].join("\n");
}

export function initialMessage(ctx: PromptContext): string {
  const parts = [`The app is running at ${ctx.appUrl} and the guide starts at ${ctx.startUrl}.`];
  if (ctx.description) parts.push(`What the author says the feature does:\n${ctx.description}`);
  parts.push(`The change to explain (git diff):\n<diff>\n${ctx.diff}\n</diff>`);
  if (ctx.omittedFiles.length) parts.push(`These files were left out of the diff because of its size: ${ctx.omittedFiles.join(", ")}.`);
  for (const file of ctx.files) parts.push(`Extra context file:\n<file path="${file.path}">\n${file.content}\n</file>`);
  parts.push("Plan the guide from the diff, then begin with observe.");
  return parts.join("\n\n");
}

export function repairMessage(index: number, error: string, observationJson: string): string {
  return [
    `When the guide was replayed from the start, step ${index + 1} failed: ${error}.`,
    "The screen is now at the state right before that step:",
    observationJson,
    `Call add_step once with the replacement for step ${index + 1}, pointing at an element from this observation.`,
  ].join("\n");
}
```

Añadir a `packages/core/src/index.ts`:
```ts
export * from "./tools.js";
export * from "./prompts.js";
```

- [ ] **Step 4: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/core && npm run typecheck`
Expected: PASS (todas las de core).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): herramientas del bucle de exploración y prompts"
```

---

### Task 6: Paquete de la CLI, configuración y credenciales

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsup.config.ts`
- Create: `packages/cli/src/config.ts`, `packages/cli/src/credentials.ts`
- Test: `packages/cli/test/config.test.ts`

**Interfaces:**
- Consumes: `LANGUAGES`, `Lang`, `t` (core).
- Produces: `ConfigSchema`, `type Config`, `class ConfigError extends Error`, `loadConfig(cwd: string): Promise<Config>`, `findSecretKey(value: unknown, path?: string): string | null`; `interface Credentials { anthropic?: string; elevenlabs?: string; deepgram?: string; openai?: string }`, `CREDENTIAL_ENV`, `explicameHome(env?: NodeJS.ProcessEnv): string`, `loadCredentials(env?: NodeJS.ProcessEnv, home?: string): Promise<Credentials>`, `requireCredential(creds: Credentials, name: keyof Credentials, lang: Lang): string`, `maskKey(key: string): string`.

- [ ] **Step 1: Crear el paquete**

`packages/cli/package.json`:
```json
{
  "name": "explicame",
  "version": "0.1.0",
  "description": "Onboarding narrado para cada funcionalidad nueva · Narrated onboarding for every new feature",
  "license": "MIT",
  "type": "module",
  "bin": { "explicame": "dist/bin.js", "explain-me": "dist/bin.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": { "build": "tsup" },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.131.0",
    "commander": "^15.0.0",
    "playwright": "^1.63.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@explicame/core": "0.1.0",
    "tsup": "^8.5.1"
  }
}
```

`packages/cli/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  noExternal: ["@explicame/core"],
  banner: { js: "#!/usr/bin/env node" },
});
```

Run: `npm install`
Expected: instala las dependencias y enlaza `@explicame/core` en `node_modules`.

- [ ] **Step 2: Escribir la prueba que falla**

`packages/cli/test/config.test.ts`:
```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";
import { loadCredentials, maskKey, requireCredential } from "../src/credentials.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "explicame-cfg-"));
});

describe("loadConfig", () => {
  it("uses the defaults when there is no config file", async () => {
    const config = await loadConfig(dir);
    expect(config).toMatchObject({
      appUrl: "http://localhost:5173", startUrl: "/", base: "main", languages: ["es", "en"], uiLanguage: "es",
      mode: "api", model: "claude-opus-5-5", effort: "high", maxSteps: 15, outputDir: "public/explicame",
    });
    expect(config.voice).toEqual({ provider: "elevenlabs", voices: {}, speed: 1, fallback: [] });
    expect(config.safety.allowRequests).toEqual([]);
  });

  it("merges a partial file with the defaults", async () => {
    await writeFile(join(dir, "explicame.config.json"), JSON.stringify({ languages: ["es"], voice: { provider: "fake" } }));
    const config = await loadConfig(dir);
    expect(config.languages).toEqual(["es"]);
    expect(config.voice.provider).toBe("fake");
    expect(config.voice.speed).toBe(1);
  });

  it("refuses keys inside the config file", async () => {
    await writeFile(join(dir, "explicame.config.json"), JSON.stringify({ voice: { apiKey: "sk_123" } }));
    await expect(loadConfig(dir)).rejects.toThrow(/voice\.apiKey/);
    await expect(loadConfig(dir)).rejects.toBeInstanceOf(ConfigError);
  });

  it("explains invalid values", async () => {
    await writeFile(join(dir, "explicame.config.json"), JSON.stringify({ maxSteps: 99 }));
    await expect(loadConfig(dir)).rejects.toThrow(/maxSteps/);
  });
});

describe("credentials", () => {
  it("prefers environment variables over the credentials file", async () => {
    await writeFile(join(dir, "credentials.json"), JSON.stringify({ anthropic: "from-file", elevenlabs: "el-file" }));
    const creds = await loadCredentials({ ANTHROPIC_API_KEY: "from-env" }, dir);
    expect(creds).toEqual({ anthropic: "from-env", elevenlabs: "el-file" });
  });

  it("names the environment variable when a key is missing", () => {
    expect(() => requireCredential({}, "anthropic", "es")).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("masks keys", () => {
    expect(maskKey("sk_abcd1234")).toBe("••••1234");
    expect(maskKey("abc")).toBe("••••");
  });
});
```

- [ ] **Step 3: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/config.test.ts`
Expected: FAIL — no se resuelve `../src/config.js`.

- [ ] **Step 4: Implementar**

`packages/cli/src/config.ts`:
```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { LANGUAGES, t, type Lang } from "@explicame/core";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const VOICE_PROVIDERS = ["elevenlabs", "deepgram", "openai", "piper", "command", "browser", "fake"] as const;

export const ConfigSchema = z.strictObject({
  appUrl: z.url().default("http://localhost:5173"),
  startUrl: z.string().startsWith("/").default("/"),
  base: z.string().min(1).default("main"),
  languages: z.array(z.enum(LANGUAGES)).min(1).default(["es", "en"]),
  uiLanguage: z.enum(LANGUAGES).default("es"),
  mode: z.enum(["api", "plugin"]).default("api"),
  model: z.string().min(1).default("claude-opus-5-5"),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  maxSteps: z.number().int().min(1).max(40).default(15),
  voice: z
    .strictObject({
      provider: z.enum(VOICE_PROVIDERS).default("elevenlabs"),
      voices: z.partialRecord(z.enum(LANGUAGES), z.string().min(1)).default({}),
      model: z.string().min(1).optional(),
      speed: z.number().min(0.5).max(2).default(1),
      fallback: z.array(z.enum(VOICE_PROVIDERS)).default([]),
    })
    .prefault({}),
  outputDir: z.string().min(1).default("public/explicame"),
  videoDir: z.string().min(1).default(".explicame/videos"),
  safety: z
    .strictObject({
      allowRequests: z.array(z.strictObject({ method: z.string().min(1), url: z.string().min(1) })).default([]),
    })
    .prefault({}),
});
export type Config = z.infer<typeof ConfigSchema>;

const SECRET_KEY = /(api[-_]?key|token|secret|password)/i;

export function findSecretKey(value: unknown, path = ""): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) return here;
    const nested = findSecretKey(inner, here);
    if (nested) return nested;
  }
  return null;
}

export async function loadConfig(cwd: string): Promise<Config> {
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(join(cwd, "explicame.config.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(t("es", "config.invalid", { errors: (error as Error).message }));
    }
  }
  const declared = (raw as { uiLanguage?: unknown }).uiLanguage;
  const lang: Lang = declared === "en" ? "en" : "es";
  const secret = findSecretKey(raw);
  if (secret) throw new ConfigError(t(lang, "config.secretInConfig", { key: secret }));
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(t(lang, "config.invalid", { errors }));
  }
  return result.data;
}
```

`packages/cli/src/credentials.ts`:
```ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { t, type Lang } from "@explicame/core";
import { ConfigError } from "./config.js";

export interface Credentials {
  anthropic?: string;
  elevenlabs?: string;
  deepgram?: string;
  openai?: string;
}

export const CREDENTIAL_ENV: Record<keyof Credentials, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  openai: "OPENAI_API_KEY",
};

const CREDENTIAL_LABEL: Record<keyof Credentials, string> = {
  anthropic: "Claude (Anthropic)",
  elevenlabs: "ElevenLabs",
  deepgram: "Deepgram",
  openai: "OpenAI",
};

export function explicameHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.EXPLICAME_HOME ?? join(homedir(), ".explicame");
}

export async function loadCredentials(env: NodeJS.ProcessEnv = process.env, home: string = explicameHome(env)): Promise<Credentials> {
  let file: Credentials = {};
  try {
    file = JSON.parse(await readFile(join(home, "credentials.json"), "utf8")) as Credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ConfigError(`credentials.json: ${(error as Error).message}`);
  }
  const out: Credentials = {};
  for (const name of Object.keys(CREDENTIAL_ENV) as (keyof Credentials)[]) {
    const value = env[CREDENTIAL_ENV[name]] ?? file[name];
    if (value) out[name] = value;
  }
  return out;
}

export function requireCredential(creds: Credentials, name: keyof Credentials, lang: Lang): string {
  const value = creds[name];
  if (!value) throw new ConfigError(t(lang, "credentials.missing", { name: CREDENTIAL_LABEL[name], env: CREDENTIAL_ENV[name] }));
  return value;
}

export function maskKey(key: string): string {
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}
```

- [ ] **Step 5: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/cli/test/config.test.ts && npm run typecheck`
Expected: PASS (7 pruebas).

- [ ] **Step 6: Commit**

```bash
git add package-lock.json packages/cli
git commit -m "feat(cli): paquete de la CLI, configuración y credenciales"
```

---

### Task 7: Contexto del cambio (git o .patch)

**Files:**
- Create: `packages/cli/src/diff.ts`
- Test: `packages/cli/test/diff.test.ts`

**Interfaces:**
- Consumes: `t`, `Lang` (core); `ConfigError` (Task 6).
- Produces: `interface ChangeContext { base: string; head: string; commit: string; diff: string; files: { path: string; content: string }[]; description?: string; omittedFiles: string[] }`, `interface ChangeOptions { cwd: string; base: string; head: string; diffFile?: string; files?: string[]; description?: string; maxChars?: number; lang: Lang }`, `getChangeContext(o: ChangeOptions): Promise<ChangeContext>`, `splitDiff(diff: string): { path: string; text: string }[]`, `fitDiff(diff: string, maxChars: number): { text: string; omitted: string[] }`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/cli/test/diff.test.ts`:
```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { ConfigError } from "../src/config.js";
import { fitDiff, getChangeContext } from "../src/diff.js";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd });

let repo: string;
beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "explicame-git-"));
  await git(repo, "init", "-b", "main");
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "README.md"), "# demo\n");
  await writeFile(join(repo, "src/server.ts"), "export const port = 3000;\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");
  await git(repo, "checkout", "-b", "feature");
  await writeFile(join(repo, "src/Filter.tsx"), "export function Filter() { return null; }\n");
  await writeFile(join(repo, "src/server.ts"), "export const port = 3001;\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "feature");
});

describe("getChangeContext", () => {
  it("returns the diff between base and head with the head commit", async () => {
    const ctx = await getChangeContext({ cwd: repo, base: "main", head: "feature", lang: "es", description: "Filtro nuevo" });
    expect(ctx.diff).toContain("src/Filter.tsx");
    expect(ctx.diff).toContain("src/server.ts");
    expect(ctx.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(ctx).toMatchObject({ base: "main", head: "feature", description: "Filtro nuevo", omittedFiles: [] });
  });

  it("fails before doing anything else when there is nothing to explain", async () => {
    const promise = getChangeContext({ cwd: repo, base: "main", head: "main", lang: "es" });
    await expect(promise).rejects.toBeInstanceOf(ConfigError);
    await expect(getChangeContext({ cwd: repo, base: "main", head: "main", lang: "es" })).rejects.toThrow(/No hay cambios/);
  });

  it("reads a patch file and extra context files", async () => {
    await writeFile(join(repo, "x.patch"), "diff --git a/a.ts b/a.ts\n+export {}\n");
    const ctx = await getChangeContext({ cwd: repo, base: "main", head: "HEAD", diffFile: "x.patch", files: ["README.md"], lang: "en" });
    expect(ctx.diff).toBe("diff --git a/a.ts b/a.ts\n+export {}\n");
    expect(ctx).toMatchObject({ base: "patch", head: "x.patch", commit: "patch" });
    expect(ctx.files).toEqual([{ path: "README.md", content: "# demo\n" }]);
  });
});

describe("fitDiff", () => {
  it("keeps UI files first when the diff is too large and reports what it left out", () => {
    const server = `diff --git a/src/server.ts b/src/server.ts\n${"+x\n".repeat(50)}`;
    const ui = `diff --git a/src/Filter.tsx b/src/Filter.tsx\n${"+y\n".repeat(50)}`;
    const { text, omitted } = fitDiff(server + ui, ui.length + 10);
    expect(text).toContain("src/Filter.tsx");
    expect(text).not.toContain("src/server.ts");
    expect(omitted).toEqual(["src/server.ts"]);
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/diff.test.ts`
Expected: FAIL — no se resuelve `../src/diff.js`.

- [ ] **Step 3: Implementar**

`packages/cli/src/diff.ts`:
```ts
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { t, type Lang } from "@explicame/core";
import { ConfigError } from "./config.js";

const run = promisify(execFile);
const UI_FILE = /\.(tsx|jsx|vue|svelte|html|astro)$|(^|\/)(routes?|pages|app|components)\//;

export interface ChangeContext {
  base: string;
  head: string;
  commit: string;
  diff: string;
  files: { path: string; content: string }[];
  description?: string;
  omittedFiles: string[];
}

export interface ChangeOptions {
  cwd: string;
  base: string;
  head: string;
  diffFile?: string;
  files?: string[];
  description?: string;
  maxChars?: number;
  lang: Lang;
}

export function splitDiff(diff: string): { path: string; text: string }[] {
  return diff
    .split(/^(?=diff --git )/m)
    .filter((part) => part.trim())
    .map((text) => ({ path: /^diff --git a\/(.+?) b\/(.+)$/m.exec(text)?.[2] ?? "unknown", text }));
}

export function fitDiff(diff: string, maxChars: number): { text: string; omitted: string[] } {
  if (diff.length <= maxChars) return { text: diff, omitted: [] };
  const parts = splitDiff(diff).sort((a, b) => Number(UI_FILE.test(b.path)) - Number(UI_FILE.test(a.path)));
  const kept: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const part of parts) {
    if (used + part.text.length <= maxChars) {
      kept.push(part.text);
      used += part.text.length;
    } else {
      omitted.push(part.path);
    }
  }
  return { text: kept.join(""), omitted };
}

export async function getChangeContext(o: ChangeOptions): Promise<ChangeContext> {
  let diff: string;
  let commit: string;
  let base = o.base;
  let head = o.head;
  if (o.diffFile) {
    diff = await readFile(resolve(o.cwd, o.diffFile), "utf8");
    commit = "patch";
    base = "patch";
    head = basename(o.diffFile);
  } else {
    diff = (await run("git", ["diff", "--no-color", `${o.base}...${o.head}`], { cwd: o.cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
    commit = (await run("git", ["rev-parse", "--short", o.head], { cwd: o.cwd })).stdout.trim();
  }
  if (!diff.trim()) throw new ConfigError(t(o.lang, "diff.empty", { base: o.base, head: o.head }));
  const { text, omitted } = fitDiff(diff, o.maxChars ?? 60_000);
  const files = await Promise.all(
    (o.files ?? []).map(async (path) => ({ path, content: await readFile(resolve(o.cwd, path), "utf8") })),
  );
  return { base, head, commit, diff: text, files, description: o.description, omittedFiles: omitted };
}
```

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/cli/test/diff.test.ts && npm run typecheck`
Expected: PASS (4 pruebas).

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): contexto del cambio desde git o un archivo .patch"
```

---

### Task 8: Navegador: sesión, bloqueo de escrituras, mapa y acciones

**Files:**
- Create: `packages/cli/src/browser/session.ts`, `packages/cli/src/browser/page.ts`
- Create: `packages/cli/test/helpers/server.ts`, `packages/cli/test/fixtures/site/index.html`, `packages/cli/test/fixtures/site/help.html`
- Test: `packages/cli/test/browser.test.ts`

**Interfaces:**
- Consumes: `DOM_RUNTIME`, `Observation`, `Strategy`, `Action`, `ElementFacts`, `AllowRule`, `isRequestAllowed`, `checkClickSafety`, `t`, `Lang` (core).
- Produces:
  - `session.ts`: `interface BlockedRequest { method: string; url: string }`, `interface SessionOptions { appUrl: string; startUrl: string; storageStatePath?: string; allowRequests?: AllowRule[]; headless?: boolean; lang?: Lang }`, `interface Session { page: Page; context: BrowserContext; blocked: BlockedRequest[]; goto(path: string): Promise<void>; close(): Promise<void> }`, `class AppUnreachableError extends Error`, `openSession(o: SessionOptions): Promise<Session>`, `settle(page: Page, timeoutMs?: number): Promise<void>`.
  - `page.ts`: `observe(page: Page, max?: number): Promise<Observation>`, `elementFacts(page: Page, id: string): Promise<ElementFacts | null>`, `stableStrategies(page: Page, id: string): Promise<Strategy[]>`, `handleById(page: Page, id: string): Promise<ElementHandle<Element> | null>`, `resolveHandle(page: Page, strategies: Strategy[], timeoutMs?: number): Promise<ElementHandle<Element> | null>`, `performAction(page: Page, element: ElementHandle<Element> | null, action: Action): Promise<void>`.
  - `test/helpers/server.ts`: `interface TestServer { url: string; hits: { method: string; path: string }[]; close(): Promise<void> }`, `startServer(root: string): Promise<TestServer>`.

- [ ] **Step 1: Instalar Chromium para Playwright (una vez por máquina)**

Run: `npx playwright install chromium`
Expected: descarga Chromium (o dice que ya está instalado).

- [ ] **Step 2: Crear el servidor de pruebas y el sitio de ejemplo**

`packages/cli/test/helpers/server.ts`:
```ts
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

export interface TestServer {
  url: string;
  hits: { method: string; path: string }[];
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

/** Static server for tests. Any non-GET request under /api/ answers 200 and is recorded in `hits`. */
export async function startServer(root: string): Promise<TestServer> {
  const hits: TestServer["hits"] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    hits.push({ method, path: url.pathname });
    if (url.pathname.startsWith("/api/") && method !== "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    const relative = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const file = join(root, normalize(relative).replace(/^[/\\]+/, ""));
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
```

`packages/cli/test/fixtures/site/index.html`:
```html
<!doctype html>
<html lang="es">
  <head><meta charset="utf-8" /><title>Reportes</title></head>
  <body>
    <h1>Reportes</h1>
    <section id="toolbar">
      <button type="button" data-testid="filtro-fecha" onclick="document.getElementById('dlg').showModal()">Filtrar</button>
      <a href="/help.html">Ayuda</a>
    </section>
    <section><h2>Ventas</h2><button type="button">Exportar</button></section>
    <section><h2>Compras</h2><button type="button">Exportar</button></section>
    <dialog id="dlg">
      <form method="post" action="/api/preferences">
        <label for="desde">Desde</label>
        <input id="desde" type="date" />
        <label>Agrupar por <select name="agrupar"><option>Día</option><option>Semana</option><option>Mes</option></select></label>
        <button type="button" onclick="document.getElementById('dlg').close(); document.getElementById('estado').textContent = 'Filtro aplicado'">Aplicar</button>
        <button>Guardar</button>
      </form>
    </dialog>
    <p id="estado"></p>
    <div id="lista">
      <button type="button" onclick="this.parentElement.innerHTML = '&lt;button type=&quot;button&quot;&gt;Recargar lista&lt;/button&gt;'">Recargar lista</button>
    </div>
    <script>
      fetch("/api/track", { method: "POST", body: "{}" }).catch(() => {});
      fetch("/api/search", { method: "POST", body: "{}" }).catch(() => {});
    </script>
  </body>
</html>
```

`packages/cli/test/fixtures/site/help.html`:
```html
<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><title>Ayuda</title></head><body><h1>Ayuda</h1></body></html>
```

- [ ] **Step 3: Escribir la prueba que falla**

`packages/cli/test/browser.test.ts`:
```ts
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
```

- [ ] **Step 4: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/browser.test.ts`
Expected: FAIL — no se resuelven `../src/browser/session.js` ni `../src/browser/page.js`.

- [ ] **Step 5: Implementar**

`packages/cli/src/browser/session.ts`:
```ts
import { existsSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { DOM_RUNTIME, isRequestAllowed, t, type AllowRule, type Lang } from "@explicame/core";

export interface BlockedRequest {
  method: string;
  url: string;
}

export interface SessionOptions {
  appUrl: string;
  startUrl: string;
  storageStatePath?: string;
  allowRequests?: AllowRule[];
  headless?: boolean;
  lang?: Lang;
}

export interface Session {
  page: Page;
  context: BrowserContext;
  blocked: BlockedRequest[];
  goto(path: string): Promise<void>;
  close(): Promise<void>;
}

export class AppUnreachableError extends Error {
  constructor(url: string, lang: Lang = "es") {
    super(t(lang, "app.unreachable", { url }));
    this.name = "AppUnreachableError";
  }
}

export async function settle(page: Page, timeoutMs = 3000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(150);
}

export async function openSession(o: SessionOptions): Promise<Session> {
  const browser = await chromium.launch({ headless: o.headless ?? true });
  try {
    const storageState = o.storageStatePath && existsSync(o.storageStatePath) ? o.storageStatePath : undefined;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState });
    const blocked: BlockedRequest[] = [];
    await context.route("**/*", (route) => {
      const request = route.request();
      if (isRequestAllowed(request.method(), request.url(), o.allowRequests)) return route.continue();
      blocked.push({ method: request.method(), url: request.url() });
      return route.abort("blockedbyclient");
    });
    await context.addInitScript(DOM_RUNTIME);
    const page = await context.newPage();
    const goto = async (path: string) => {
      const url = new URL(path, o.appUrl).toString();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      } catch {
        throw new AppUnreachableError(url, o.lang);
      }
      await settle(page);
    };
    await goto(o.startUrl);
    return {
      page,
      context,
      blocked,
      goto,
      close: async () => {
        await context.close();
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
```

`packages/cli/src/browser/page.ts`:
```ts
import type { ElementHandle, Page } from "playwright";
import type { Action, ElementFacts, Observation, Strategy } from "@explicame/core";
import { settle } from "./session.js";

export async function observe(page: Page, max = 150): Promise<Observation> {
  return page.evaluate((limit) => window.__explicame!.observe(limit), max);
}

export async function elementFacts(page: Page, id: string): Promise<ElementFacts | null> {
  return page.evaluate((elementId) => {
    const runtime = window.__explicame!;
    const element = runtime.byId(elementId);
    return element ? runtime.describe(element) : null;
  }, id);
}

export async function stableStrategies(page: Page, id: string): Promise<Strategy[]> {
  return page.evaluate((elementId) => {
    const runtime = window.__explicame!;
    const element = runtime.byId(elementId);
    return element ? runtime.uniqueStrategies(element) : [];
  }, id);
}

export async function handleById(page: Page, id: string): Promise<ElementHandle<Element> | null> {
  return (await page.$(`[data-explicame-id="${id.replace(/"/g, "")}"]`)) as ElementHandle<Element> | null;
}

export async function resolveHandle(page: Page, strategies: Strategy[], timeoutMs = 5000): Promise<ElementHandle<Element> | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const handle = await page.evaluateHandle((s) => window.__explicame!.resolve(s), strategies);
    const element = handle.asElement();
    if (element) return element as ElementHandle<Element>;
    await handle.dispose();
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(200);
  }
}

export async function performAction(page: Page, element: ElementHandle<Element> | null, action: Action): Promise<void> {
  if (action.type === "navigate") {
    await page.goto(new URL(action.url, page.url()).toString(), { waitUntil: "domcontentloaded" });
  } else {
    if (!element) throw new Error(`the ${action.type} action needs an element`);
    if (action.type === "click") await element.click({ timeout: 5000 });
    else if (action.type === "type") await element.fill(action.value, { timeout: 5000 });
    else await element.selectOption({ label: action.value }, { timeout: 5000 });
  }
  await settle(page);
}
```

- [ ] **Step 6: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/cli/test/browser.test.ts && npm run typecheck`
Expected: PASS (5 pruebas).

- [ ] **Step 7: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): navegador con bloqueo de escrituras, mapa de elementos y acciones"
```

---

### Task 9: Bucle de exploración con una IA falsa

**Files:**
- Create: `packages/cli/src/generate/driver.ts`, `packages/cli/src/generate/fakeDriver.ts`, `packages/cli/src/generate/loop.ts`
- Test: `packages/cli/test/loop.test.ts`

**Interfaces:**
- Consumes: `buildTools`, `parseToolCall`, `toAction`, `checkClickSafety`, `systemPrompt`, `initialMessage`, `t`, `ParsedCall`, `ActionKind`, `Action`, `Step`, `Lang`, `LocalizedText`, `Observation`, `ToolDef` (core); `Session` (Task 8); `observe`, `elementFacts`, `stableStrategies`, `handleById`, `performAction` (Task 8); `ChangeContext` (Task 7).
- Produces:
  - `driver.ts`: `interface ToolCall { id: string; name: string; input: unknown }`, `interface ToolResult { id: string; content: string; isError?: boolean }`, `type StopReason = "tool_use" | "end_turn" | "max_tokens" | "refusal" | "other"`, `interface LlmTurn { calls: ToolCall[]; text: string; stop: StopReason }`, `interface Usage { inputTokens: number; outputTokens: number }`, `interface LlmDriver { readonly id: "api" | "fake"; readonly model?: string; start(system: string, user: string, tools: ToolDef[]): Promise<LlmTurn>; reply(results: ToolResult[], note?: string): Promise<LlmTurn>; usage(): Usage }`.
  - `fakeDriver.ts`: `interface FakeCall { name: string; input: Record<string, unknown> }` (el `input` puede traer `element: { name?; label?; role? }` en lugar de `element_id`), `interface FakeScript { turns: FakeCall[][] }`, `createFakeDriver(script: FakeScript): LlmDriver & { received: ToolResult[][]; notes: string[] }`, `loadFakeScript(path: string): Promise<FakeScript>`.
  - `loop.ts`: `class ToolError`, `class LoopError`, `interface LoopEvent { type: "observe" | "act" | "step" | "rejected" | "finish"; message: string }`, `interface ExplorationState { session: Session; languages: Lang[]; maxSteps: number; steps: Step[]; title: LocalizedText | null; onEvent?: (e: LoopEvent) => void }`, `interface ExplorationOptions { driver; session; languages; maxSteps; context: ChangeContext; appUrl; startUrl; onEvent? }`, `interface ExplorationResult { steps: Step[]; title: LocalizedText; pendingResults: ToolResult[] }`, `runExploration(o: ExplorationOptions): Promise<ExplorationResult>`, `executeCall(call: ToolCall, state: ExplorationState): Promise<ToolResult>`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/cli/test/loop.test.ts`:
```ts
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
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/loop.test.ts`
Expected: FAIL — no se resuelven los módulos de `../src/generate/`.

- [ ] **Step 3: Implementar el contrato del driver**

`packages/cli/src/generate/driver.ts`:
```ts
import type { ToolDef } from "@explicame/core";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export type StopReason = "tool_use" | "end_turn" | "max_tokens" | "refusal" | "other";

export interface LlmTurn {
  calls: ToolCall[];
  text: string;
  stop: StopReason;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** One conversation with a model. `reply` sends the results of the previous turn's calls (and an optional note). */
export interface LlmDriver {
  readonly id: "api" | "fake";
  readonly model?: string;
  start(system: string, user: string, tools: ToolDef[]): Promise<LlmTurn>;
  reply(results: ToolResult[], note?: string): Promise<LlmTurn>;
  usage(): Usage;
}
```

- [ ] **Step 4: Implementar la IA falsa**

`packages/cli/src/generate/fakeDriver.ts`:
```ts
import { readFile } from "node:fs/promises";
import type { Observation } from "@explicame/core";
import type { LlmDriver, LlmTurn, ToolResult } from "./driver.js";

export interface FakeCall {
  name: string;
  /** May carry `element: { name?, label?, role? }`, resolved to `element_id` against the latest observation. */
  input: Record<string, unknown>;
}

export interface FakeScript {
  turns: FakeCall[][];
}

function parseObservation(text: string): Observation | null {
  try {
    const value = JSON.parse(text) as { elements?: unknown; observation?: { elements?: unknown } };
    if (Array.isArray(value.elements)) return value as unknown as Observation;
    if (value.observation && Array.isArray(value.observation.elements)) return value.observation as unknown as Observation;
  } catch {
    return null;
  }
  return null;
}

function observationInNote(note: string): Observation | null {
  for (const line of note.split("\n")) {
    if (line.startsWith("{")) {
      const found = parseObservation(line);
      if (found) return found;
    }
  }
  return null;
}

function resolveElement(input: Record<string, unknown>, observation: Observation | null): Record<string, unknown> {
  const wanted = input.element as { name?: string; label?: string; role?: string } | undefined;
  if (!wanted || typeof wanted !== "object") return input;
  const match = observation?.elements.find(
    (e) =>
      (wanted.name === undefined || e.name === wanted.name) &&
      (wanted.label === undefined || e.label === wanted.label) &&
      (wanted.role === undefined || e.role === wanted.role),
  );
  const { element: _element, ...rest } = input;
  return { ...rest, element_id: match ? match.id : "missing" };
}

export function createFakeDriver(script: FakeScript): LlmDriver & { received: ToolResult[][]; notes: string[] } {
  const received: ToolResult[][] = [];
  const notes: string[] = [];
  let turn = 0;
  let counter = 0;
  let latest: Observation | null = null;

  const next = (): LlmTurn => {
    const calls = script.turns[turn++];
    if (!calls) return { calls: [], text: "", stop: "end_turn" };
    return {
      calls: calls.map((call) => ({ id: `fake_${++counter}`, name: call.name, input: resolveElement(call.input, latest) })),
      text: "",
      stop: "tool_use",
    };
  };

  return {
    id: "fake",
    model: "fake",
    received,
    notes,
    async start() {
      return next();
    },
    async reply(results, note) {
      received.push(results);
      for (const result of results) latest = parseObservation(result.content) ?? latest;
      if (note) {
        notes.push(note);
        latest = observationInNote(note) ?? latest;
      }
      return next();
    },
    usage: () => ({ inputTokens: 0, outputTokens: 0 }),
  };
}

export async function loadFakeScript(path: string): Promise<FakeScript> {
  return JSON.parse(await readFile(path, "utf8")) as FakeScript;
}
```

- [ ] **Step 5: Implementar el bucle**

`packages/cli/src/generate/loop.ts`:
```ts
import {
  buildTools, checkClickSafety, initialMessage, parseToolCall, systemPrompt, t, toAction,
  type Action, type ActionKind, type Lang, type LocalizedText, type ParsedCall, type Step,
} from "@explicame/core";
import { elementFacts, handleById, observe, performAction, stableStrategies } from "../browser/page.js";
import type { Session } from "../browser/session.js";
import type { ChangeContext } from "../diff.js";
import type { LlmDriver, ToolCall, ToolResult } from "./driver.js";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export class LoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopError";
  }
}

export interface LoopEvent {
  type: "observe" | "act" | "step" | "rejected" | "finish";
  message: string;
}

export interface ExplorationState {
  session: Session;
  languages: Lang[];
  maxSteps: number;
  steps: Step[];
  title: LocalizedText | null;
  onEvent?: (event: LoopEvent) => void;
}

export interface ExplorationOptions {
  driver: LlmDriver;
  session: Session;
  languages: Lang[];
  maxSteps: number;
  context: ChangeContext;
  appUrl: string;
  startUrl: string;
  onEvent?: (event: LoopEvent) => void;
}

export interface ExplorationResult {
  steps: Step[];
  title: LocalizedText;
  /** Results of the last turn (it ended with finish); not sent yet, so a repair can continue the conversation. */
  pendingResults: ToolResult[];
}

const NUDGE = "Continue with the tools. When the guide is complete, call finish.";

export async function runExploration(o: ExplorationOptions): Promise<ExplorationResult> {
  const state: ExplorationState = { session: o.session, languages: o.languages, maxSteps: o.maxSteps, steps: [], title: null, onEvent: o.onEvent };
  const user = initialMessage({
    languages: o.languages, appUrl: o.appUrl, startUrl: o.startUrl, maxSteps: o.maxSteps,
    diff: o.context.diff, files: o.context.files, description: o.context.description, omittedFiles: o.context.omittedFiles,
  });
  let turn = await o.driver.start(systemPrompt(o.languages, o.maxSteps), user, buildTools(o.languages));
  let pending: ToolResult[] = [];
  let nudged = false;
  for (let round = 0; round < o.maxSteps * 4 + 10; round++) {
    if (turn.stop === "refusal") throw new LoopError("The model declined to continue (refusal).");
    if (turn.calls.length === 0) {
      if (nudged) break;
      nudged = true;
      turn = await o.driver.reply([], NUDGE);
      continue;
    }
    nudged = false;
    const results: ToolResult[] = [];
    for (const call of turn.calls) results.push(await executeCall(call, state));
    if (state.title) {
      pending = results;
      break;
    }
    turn = await o.driver.reply(results);
  }
  if (!state.title) throw new LoopError(t("en", "loop.noFinish"));
  if (state.steps.length === 0) throw new LoopError("The guide has no steps.");
  return { steps: state.steps, title: state.title, pendingResults: pending };
}

export async function executeCall(call: ToolCall, state: ExplorationState): Promise<ToolResult> {
  const parsed = parseToolCall(call.name, call.input, state.languages);
  if (!parsed.ok) return { id: call.id, content: t("en", "tool.invalidInput", { tool: call.name, errors: parsed.error }), isError: true };
  const page = state.session.page;
  const c = parsed.call;
  try {
    if (c.name === "observe") {
      state.onEvent?.({ type: "observe", message: "observe" });
      return { id: call.id, content: JSON.stringify(await observe(page)) };
    }
    if (c.name === "finish") {
      state.title = c.title;
      state.onEvent?.({ type: "finish", message: "finish" });
      return { id: call.id, content: "ok" };
    }
    if (c.name === "act") {
      await apply(state, c.elementId, c.action, c.value, c.url, false);
      state.onEvent?.({ type: "act", message: `${c.action} ${c.elementId ?? c.url ?? ""}`.trim() });
      return { id: call.id, content: JSON.stringify(await observe(page)) };
    }
    if (state.steps.length >= state.maxSteps) {
      return { id: call.id, content: t("en", "tool.stepLimit", { max: state.maxSteps }), isError: true };
    }
    state.steps.push(await buildStep(state, c));
    state.onEvent?.({ type: "step", message: `step ${state.steps.length}` });
    return { id: call.id, content: JSON.stringify({ added: state.steps.length, observation: await observe(page) }) };
  } catch (error) {
    if (error instanceof ToolError) {
      state.onEvent?.({ type: "rejected", message: error.message });
      return { id: call.id, content: error.message, isError: true };
    }
    throw error;
  }
}

async function buildStep(state: ExplorationState, c: Extract<ParsedCall, { name: "add_step" }>): Promise<Step> {
  const { target, action } = await apply(state, c.elementId, c.action, c.value, c.url, true);
  const step: Step = { narration: c.narration };
  if (target) step.target = target;
  if (action) step.action = action;
  if (c.opens) step.opens = c.opens;
  return step;
}

async function apply(
  state: ExplorationState,
  elementId: string | null,
  kind: ActionKind | null,
  value: string | null,
  url: string | null,
  wantTarget: boolean,
): Promise<{ target?: Step["target"]; action?: Action }> {
  const page = state.session.page;
  let action: Action | undefined;
  if (kind) {
    const built = toAction(kind, value, url);
    if (!built.ok) throw new ToolError(built.error);
    action = built.action;
  }
  if (!elementId) {
    if (action && action.type !== "navigate") throw new ToolError(`The ${action.type} action needs element_id.`);
    if (action) await perform(state, null, action, "-");
    return action ? { action } : {};
  }
  const facts = await elementFacts(page, elementId);
  if (!facts) throw new ToolError(t("en", "tool.unknownElement", { id: elementId }));
  if (action?.type === "click") {
    const verdict = checkClickSafety(facts);
    if (!verdict.ok) {
      throw new ToolError(
        verdict.reason === "submit"
          ? t("en", "tool.unsafeSubmit", { id: elementId })
          : t("en", "tool.unsafeDestructive", { id: elementId, name: facts.name }),
      );
    }
  }
  let target: Step["target"];
  if (wantTarget) {
    const strategies = await stableStrategies(page, elementId);
    if (strategies.length === 0) throw new ToolError(t("en", "tool.noStableSelector", { id: elementId }));
    target = { strategies };
  }
  if (action) await perform(state, action.type === "navigate" ? null : await handleById(page, elementId), action, elementId);
  return { ...(target ? { target } : {}), ...(action ? { action } : {}) };
}

async function perform(state: ExplorationState, handle: Awaited<ReturnType<typeof handleById>>, action: Action, id: string) {
  try {
    await performAction(state.session.page, handle, action);
  } catch (error) {
    const first = (error as Error).message.split("\n")[0] ?? "";
    throw new ToolError(t("en", "tool.actionFailed", { action: action.type, id, error: first }));
  }
}
```

- [ ] **Step 6: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/cli/test/loop.test.ts && npm run typecheck`
Expected: PASS (3 pruebas).

- [ ] **Step 7: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): bucle de exploración con herramientas e IA falsa para pruebas"
```

---

### Task 10: IA real por API key (Claude) y estimado de costo

Sigue la guía vigente del SDK: bucle manual con `client.beta.messages.create`, historial que solo crece (se agrega `response.content` completo, sin editar turnos anteriores), `tool_choice` automático (Opus 5.5 rechaza forzar herramientas), `output_config.effort`, caché automática y `fallbacks: "default"` con su beta.

**Files:**
- Create: `packages/cli/src/generate/anthropicDriver.ts`
- Test: `packages/cli/test/anthropicDriver.test.ts`

**Interfaces:**
- Consumes: `LlmDriver`, `LlmTurn`, `StopReason`, `ToolResult`, `Usage` (Task 9); `ToolDef` (core).
- Produces: `type Effort = "low" | "medium" | "high" | "xhigh" | "max"`, `interface AnthropicDriverOptions { apiKey: string; model: string; effort: Effort; client?: Anthropic }`, `createAnthropicDriver(o): LlmDriver`, `PRICES: Record<string, { input: number; output: number }>`, `estimateCostUsd(model: string, firstTurnInputTokens: number, maxSteps: number): number | null`, `countFirstTurnTokens(client: Anthropic, model: string, system: string, user: string, tools: ToolDef[]): Promise<number>`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/cli/test/anthropicDriver.test.ts`:
```ts
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildTools } from "@explicame/core";
import { countFirstTurnTokens, createAnthropicDriver, estimateCostUsd } from "../src/generate/anthropicDriver.js";

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
const message = (content: unknown[], stop_reason: string) => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage,
});

function mockClient(responses: unknown[]) {
  const create = vi.fn(async (_params: Record<string, unknown>) => responses.shift());
  const countTokens = vi.fn(async (_params: Record<string, unknown>) => ({ input_tokens: 4321 }));
  const client = { beta: { messages: { create } }, messages: { countTokens } } as unknown as Anthropic;
  return { client, create, countTokens };
}

describe("createAnthropicDriver", () => {
  it("starts with the configured model, effort, fallbacks, caching and tools", async () => {
    const { client, create } = mockClient([message([{ type: "tool_use", id: "tu_1", name: "observe", input: {} }], "tool_use")]);
    const driver = createAnthropicDriver({ apiKey: "k", model: "claude-opus-5-5", effort: "high", client });
    const turn = await driver.start("system text", "user text", buildTools(["es"]));
    expect(turn).toEqual({ calls: [{ id: "tu_1", name: "observe", input: {} }], text: "", stop: "tool_use" });
    const params = create.mock.calls[0]![0];
    expect(params).toMatchObject({
      model: "claude-opus-5-5", max_tokens: 16000, system: "system text",
      cache_control: { type: "ephemeral" }, output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      messages: [{ role: "user", content: "user text" }],
    });
    expect((params.tools as { name: string }[]).map((t) => t.name)).toEqual(["observe", "act", "add_step", "finish"]);
    expect(params).not.toHaveProperty("tool_choice");
  });

  it("replies with tool results, keeps the history append-only and sums usage", async () => {
    const first = message([{ type: "text", text: "Mirando." }, { type: "tool_use", id: "tu_1", name: "observe", input: {} }], "tool_use");
    const { client, create } = mockClient([first, message([{ type: "text", text: "Listo." }], "end_turn")]);
    const driver = createAnthropicDriver({ apiKey: "k", model: "claude-opus-5-5", effort: "high", client });
    await driver.start("s", "u", buildTools(["es"]));
    const turn = await driver.reply([{ id: "tu_1", content: "boom", isError: true }], "note");
    expect(turn).toEqual({ calls: [], text: "Listo.", stop: "end_turn" });
    const messages = create.mock.calls[1]![0].messages as { role: string; content: unknown }[];
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: "assistant", content: first.content });
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: "boom", is_error: true }, { type: "text", text: "note" }],
    });
    expect(driver.usage()).toEqual({ inputTokens: 300, outputTokens: 40 });
  });

  it("maps refusals and unknown stop reasons", async () => {
    const { client } = mockClient([message([], "refusal"), message([], "pause_turn")]);
    const driver = createAnthropicDriver({ apiKey: "k", model: "claude-opus-5-5", effort: "high", client });
    expect((await driver.start("s", "u", [])).stop).toBe("refusal");
    expect((await driver.reply([])).stop).toBe("other");
  });
});

describe("cost estimate", () => {
  it("counts the first turn with the token counting endpoint", async () => {
    const { client, countTokens } = mockClient([]);
    expect(await countFirstTurnTokens(client, "claude-opus-5-5", "s", "u", buildTools(["es"]))).toBe(4321);
    expect(countTokens.mock.calls[0]![0]).toMatchObject({ model: "claude-opus-5-5", system: "s", messages: [{ role: "user", content: "u" }] });
  });

  it("estimates from the price table and returns null for unknown models", () => {
    const opus = estimateCostUsd("claude-opus-5-5", 4000, 15)!;
    const sonnet = estimateCostUsd("claude-sonnet-5-5", 4000, 15)!;
    expect(opus).toBeGreaterThan(0);
    expect(opus).toBeCloseTo(sonnet * 2, 6);
    expect(estimateCostUsd("some-other-model", 4000, 15)).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/anthropicDriver.test.ts`
Expected: FAIL — no se resuelve `../src/generate/anthropicDriver.js`.

- [ ] **Step 3: Implementar**

`packages/cli/src/generate/anthropicDriver.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "@explicame/core";
import type { LlmDriver, LlmTurn, StopReason, ToolResult, Usage } from "./driver.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicDriverOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  client?: Anthropic;
}

/** USD per million tokens (first-party API rates). */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

function mapStop(reason: string | null): StopReason {
  return reason === "tool_use" || reason === "end_turn" || reason === "max_tokens" || reason === "refusal" ? reason : "other";
}

function toApiTools(defs: ToolDef[]): Anthropic.Beta.BetaTool[] {
  return defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema as Anthropic.Beta.BetaTool.InputSchema }));
}

export function createAnthropicDriver(o: AnthropicDriverOptions): LlmDriver {
  const client = o.client ?? new Anthropic({ apiKey: o.apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  let system = "";
  let tools: Anthropic.Beta.BetaTool[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  async function send(): Promise<LlmTurn> {
    const response = await client.beta.messages.create({
      model: o.model,
      max_tokens: 16000,
      system,
      tools,
      messages: [...messages],
      cache_control: { type: "ephemeral" },
      output_config: { effort: o.effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    usage.inputTokens +=
      response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += response.usage.output_tokens;
    messages.push({ role: "assistant", content: response.content });
    const calls = response.content.flatMap((block) => (block.type === "tool_use" ? [{ id: block.id, name: block.name, input: block.input }] : []));
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    return { calls, text, stop: mapStop(response.stop_reason) };
  }

  return {
    id: "api",
    model: o.model,
    async start(systemText, user, defs) {
      system = systemText;
      tools = toApiTools(defs);
      messages.push({ role: "user", content: user });
      return send();
    },
    async reply(results: ToolResult[], note?: string) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      }));
      if (note) content.push({ type: "text", text: note });
      messages.push({ role: "user", content });
      return send();
    },
    usage: () => ({ ...usage }),
  };
}

export async function countFirstTurnTokens(client: Anthropic, model: string, system: string, user: string, defs: ToolDef[]): Promise<number> {
  const result = await client.messages.countTokens({
    model,
    system,
    tools: defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema as Anthropic.Tool.InputSchema })),
    messages: [{ role: "user", content: user }],
  });
  return result.input_tokens;
}

/**
 * Rough estimate, shown before generating: about two model rounds per step, each adding ~1.5k tokens of
 * observation and ~600 output tokens, with the cached history billed at ~10% of the input price.
 */
export function estimateCostUsd(model: string, firstTurnInputTokens: number, maxSteps: number): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const rounds = maxSteps * 2;
  const newInputPerRound = 1500;
  const outputPerRound = 600;
  const averagePrefix = firstTurnInputTokens + (rounds * newInputPerRound) / 2;
  const inputTokens = rounds * (newInputPerRound + 0.1 * averagePrefix);
  const outputTokens = rounds * outputPerRound;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
```

Si `tsc` marca el literal `fallbacks: "default"` o `output_config.effort` como no tipados, la versión instalada del SDK es anterior a la API vigente: actualizar con `npm install @anthropic-ai/sdk@latest -w explicame` antes de tocar el código.

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/cli/test/anthropicDriver.test.ts && npm run typecheck`
Expected: PASS (5 pruebas).

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): driver de Claude por API key con fallback y estimado de costo"
```

---

### Task 11: Verificación y reparación

**Files:**
- Create: `packages/cli/src/verify.ts`
- Test: `packages/cli/test/verify.test.ts`

**Interfaces:**
- Consumes: `Guide`, `Step`, `repairMessage`, `t` (core); `Session` (Task 8); `observe`, `performAction`, `resolveHandle` (Task 8); `LlmDriver`, `ToolResult` (Task 9); `executeCall`, `ExplorationState` (Task 9).
- Produces: `interface VerifyFailure { index: number; error: string }`, `class VerifyError extends Error { failure: VerifyFailure }`, `interface VerifyOptions { timeoutMs?: number }`, `verifyGuide(guide: Guide, open: () => Promise<Session>, o?: VerifyOptions): Promise<VerifyFailure[]>`, `interface RepairOptions { guide: Guide; driver: LlmDriver; pendingResults: ToolResult[]; open: () => Promise<Session>; timeoutMs?: number; log?: (message: string) => void }`, `verifyAndRepair(o: RepairOptions): Promise<Guide>`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/cli/test/verify.test.ts`:
```ts
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
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/verify.test.ts`
Expected: FAIL — no se resuelve `../src/verify.js`.

- [ ] **Step 3: Implementar**

`packages/cli/src/verify.ts`:
```ts
import { repairMessage, t, type Guide, type Step } from "@explicame/core";
import { observe, performAction, resolveHandle } from "./browser/page.js";
import type { Session } from "./browser/session.js";
import type { LlmDriver, ToolResult } from "./generate/driver.js";
import { executeCall, type ExplorationState } from "./generate/loop.js";

export interface VerifyFailure {
  index: number;
  error: string;
}

export class VerifyError extends Error {
  readonly failure: VerifyFailure;
  constructor(failure: VerifyFailure) {
    super(t("en", "verify.failed", { index: failure.index + 1, error: failure.error }));
    this.name = "VerifyError";
    this.failure = failure;
  }
}

export interface VerifyOptions {
  timeoutMs?: number;
}

async function replayStep(session: Session, step: Step, timeoutMs: number): Promise<string | null> {
  let handle = null;
  if (step.target) {
    handle = await resolveHandle(session.page, step.target.strategies, timeoutMs);
    if (!handle) return "target not found on the screen";
  }
  if (step.action) {
    try {
      await performAction(session.page, handle, step.action);
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
      if (error) return [{ index, error }];
    }
    return [];
  } finally {
    await session.close();
  }
}

export interface RepairOptions {
  guide: Guide;
  driver: LlmDriver;
  /** Unsent results of the conversation's last turn. */
  pendingResults: ToolResult[];
  open: () => Promise<Session>;
  timeoutMs?: number;
  log?: (message: string) => void;
}

/** Verifies; for each failing step the model gets one chance to replace it, then everything is verified again. */
export async function verifyAndRepair(o: RepairOptions): Promise<Guide> {
  const timeoutMs = o.timeoutMs ?? 5000;
  let guide = o.guide;
  let pending = o.pendingResults;
  const attempted = new Set<number>();
  for (;;) {
    const failure = (await verifyGuide(guide, o.open, { timeoutMs }))[0];
    if (!failure) return guide;
    if (attempted.has(failure.index)) throw new VerifyError(failure);
    attempted.add(failure.index);
    o.log?.(t("en", "verify.failed", { index: failure.index + 1, error: failure.error }));

    const session = await o.open();
    try {
      for (const step of guide.steps.slice(0, failure.index)) {
        const error = await replayStep(session, step, timeoutMs);
        if (error) throw new VerifyError({ index: failure.index, error });
      }
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
      if (!replacement) throw new VerifyError(failure);
      const fixed = replacement;
      guide = { ...guide, steps: guide.steps.map((step, index) => (index === failure.index ? fixed : step)) };
    } finally {
      await session.close();
    }
  }
}
```

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/cli/test/verify.test.ts && npm run typecheck`
Expected: PASS (4 pruebas).

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): verificación de la guía con un intento de reparación por paso"
```

---

### Task 12: Voz con caché, respaldo, ElevenLabs y voz falsa

**Files:**
- Create: `packages/cli/src/voice/provider.ts`, `packages/cli/src/voice/fake.ts`, `packages/cli/src/voice/elevenlabs.ts`, `packages/cli/src/voice/index.ts`
- Test: `packages/cli/test/voice.test.ts`

**Interfaces:**
- Consumes: `Guide`, `Step`, `Lang`, `LocalizedText`, `t` (core); `Config` (Task 6); `Credentials` (Task 6).
- Produces:
  - `provider.ts`: `interface VoiceRequest { text: string; lang: Lang; voice?: string; speed: number }`, `interface VoiceProvider { readonly id: string; readonly model: string; synthesize(r: VoiceRequest): Promise<Buffer> }`, `class VoiceError extends Error`, `cacheKey(p: VoiceProvider, r: VoiceRequest): string`, `synthesizeWithCache(providers: VoiceProvider[], r: VoiceRequest, cacheDir: string, retries?: number, sleep?: (ms: number) => Promise<void>): Promise<{ audio: Buffer; provider: string }>`, `interface VoiceGuideOptions { providers: VoiceProvider[]; guideDir: string; cacheDir: string; voices: LocalizedText; speed: number; retries?: number; sleep?: (ms: number) => Promise<void>; onWarn?: (message: string) => void }`, `voiceGuide(guide: Guide, o: VoiceGuideOptions): Promise<Guide>`.
  - `fake.ts`: `silentMp3(seconds: number): Buffer`, `createFakeVoiceProvider(): VoiceProvider`.
  - `elevenlabs.ts`: `createElevenLabsProvider(o: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): VoiceProvider`.
  - `index.ts`: `buildVoiceProviders(config: Config, creds: Credentials): VoiceProvider[]`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/cli/test/voice.test.ts`:
```ts
import { existsSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Guide } from "@explicame/core";
import { createElevenLabsProvider } from "../src/voice/elevenlabs.js";
import { createFakeVoiceProvider, silentMp3 } from "../src/voice/fake.js";
import { cacheKey, synthesizeWithCache, VoiceError, voiceGuide, type VoiceProvider } from "../src/voice/provider.js";

const noSleep = async () => {};
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "explicame-voice-"));
});

const failing = (): VoiceProvider & { calls: number } => {
  const p = { id: "down", model: "m", calls: 0, async synthesize() { p.calls++; throw new VoiceError("down"); } };
  return p;
};

describe("synthesizeWithCache", () => {
  it("retries, falls back to the next provider and serves repeats from the cache", async () => {
    const down = failing();
    const fake = createFakeVoiceProvider();
    const spy = vi.spyOn(fake, "synthesize");
    const request = { text: "Hola", lang: "es" as const, speed: 1 };
    const first = await synthesizeWithCache([down, fake], request, dir, 3, noSleep);
    expect(first.provider).toBe("fake");
    expect(down.calls).toBe(3);
    const again = await synthesizeWithCache([down, fake], request, dir, 3, noSleep);
    expect(again.audio.equals(first.audio)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(down.calls).toBe(3); // the cached fallback answered without retrying the dead primary
    expect(await readdir(dir)).toEqual([`${cacheKey(fake, request)}.mp3`]);
  });

  it("throws VoiceError when every provider fails", async () => {
    await expect(synthesizeWithCache([failing()], { text: "x", lang: "es", speed: 1 }, dir, 2, noSleep)).rejects.toBeInstanceOf(VoiceError);
  });

  it("changes the cache key when the text or voice changes", () => {
    const fake = createFakeVoiceProvider();
    const a = cacheKey(fake, { text: "Hola", lang: "es", speed: 1 });
    expect(cacheKey(fake, { text: "Hola.", lang: "es", speed: 1 })).not.toBe(a);
    expect(cacheKey(fake, { text: "Hola", lang: "es", speed: 1, voice: "v2" })).not.toBe(a);
  });
});

describe("voiceGuide", () => {
  const guide = (): Guide => ({
    schemaVersion: 1, id: "g", languages: ["es", "en"], title: { es: "G", en: "G" }, startUrl: "/",
    steps: [{ narration: { es: "Uno.", en: "One." } }, { narration: { es: "Dos.", en: "Two." } }],
    source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
  });

  it("writes one file per step and language and records the paths", async () => {
    const out = join(dir, "guide");
    const voiced = await voiceGuide(guide(), { providers: [createFakeVoiceProvider()], guideDir: out, cacheDir: join(dir, "cache"), voices: {}, speed: 1 });
    expect(voiced.steps[1]!.audio).toEqual({ es: "audio/es/02.mp3", en: "audio/en/02.mp3" });
    expect(existsSync(join(out, "audio/en/01.mp3"))).toBe(true);
  });

  it("warns and leaves the step for the browser voice when nothing answers", async () => {
    const onWarn = vi.fn();
    const voiced = await voiceGuide(guide(), { providers: [failing()], guideDir: dir, cacheDir: join(dir, "cache"), voices: {}, speed: 1, retries: 1, sleep: noSleep, onWarn });
    expect(voiced.steps[0]!.audio).toBeUndefined();
    expect(onWarn).toHaveBeenCalledTimes(4);
  });
});

describe("providers", () => {
  it("fake audio is a sequence of valid silent MP3 frames", () => {
    const audio = silentMp3(1);
    expect(audio.length % 417).toBe(0);
    expect([audio[0], audio[1]]).toEqual([0xff, 0xfb]);
  });

  it("calls ElevenLabs with the model, language and voice", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const provider = createElevenLabsProvider({ apiKey: "el_key", fetchImpl: fetchImpl as unknown as typeof fetch });
    const audio = await provider.synthesize({ text: "Hola", lang: "es", voice: "voice123", speed: 1 });
    expect([...audio]).toEqual([1, 2, 3]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("el_key");
    expect(JSON.parse(init.body as string)).toMatchObject({ text: "Hola", model_id: "eleven_v4", language_code: "es" });
  });

  it("ElevenLabs needs a voice and reports HTTP errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad key", { status: 401 }));
    const provider = createElevenLabsProvider({ apiKey: "x", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.synthesize({ text: "Hola", lang: "es", speed: 1 })).rejects.toBeInstanceOf(VoiceError);
    await expect(provider.synthesize({ text: "Hola", lang: "es", voice: "v", speed: 1 })).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/voice.test.ts`
Expected: FAIL — no se resuelven los módulos de `../src/voice/`.

- [ ] **Step 3: Implementar**

`packages/cli/src/voice/provider.ts`:
```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { t, type Guide, type Lang, type LocalizedText, type Step } from "@explicame/core";

export interface VoiceRequest {
  text: string;
  lang: Lang;
  voice?: string;
  speed: number;
}

export interface VoiceProvider {
  readonly id: string;
  readonly model: string;
  synthesize(request: VoiceRequest): Promise<Buffer>;
}

export class VoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function cacheKey(provider: VoiceProvider, r: VoiceRequest): string {
  return createHash("sha256").update([provider.id, provider.model, r.voice ?? "", r.lang, String(r.speed), r.text].join("|")).digest("hex");
}

export async function synthesizeWithCache(
  providers: VoiceProvider[],
  request: VoiceRequest,
  cacheDir: string,
  retries = 3,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<{ audio: Buffer; provider: string }> {
  // Any provider's cached audio wins before a single network call, so a cached fallback never waits on a dead primary.
  for (const provider of providers) {
    try {
      return { audio: await readFile(join(cacheDir, `${cacheKey(provider, request)}.mp3`)), provider: provider.id };
    } catch {
      // not cached for this provider
    }
  }
  const errors: string[] = [];
  for (const provider of providers) {
    const file = join(cacheDir, `${cacheKey(provider, request)}.mp3`);
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const audio = await provider.synthesize(request);
        await mkdir(cacheDir, { recursive: true });
        await writeFile(file, audio);
        return { audio, provider: provider.id };
      } catch (error) {
        errors.push(`${provider.id}: ${(error as Error).message}`);
        if (attempt < retries - 1) await sleep(500 * 2 ** attempt);
      }
    }
  }
  throw new VoiceError(errors.length ? errors.join(" | ") : "no voice provider configured");
}

export interface VoiceGuideOptions {
  providers: VoiceProvider[];
  guideDir: string;
  cacheDir: string;
  voices: LocalizedText;
  speed: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  onWarn?: (message: string) => void;
}

export async function voiceGuide(guide: Guide, o: VoiceGuideOptions): Promise<Guide> {
  const steps: Step[] = [];
  for (const [index, step] of guide.steps.entries()) {
    const audio: LocalizedText = {};
    for (const lang of guide.languages) {
      const text = step.narration[lang];
      if (!text) continue;
      try {
        const result = await synthesizeWithCache(o.providers, { text, lang, voice: o.voices[lang], speed: o.speed }, o.cacheDir, o.retries ?? 3, o.sleep);
        const relative = `audio/${lang}/${String(index + 1).padStart(2, "0")}.mp3`;
        const file = join(o.guideDir, relative);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, result.audio);
        audio[lang] = relative;
      } catch (error) {
        if (!(error instanceof VoiceError)) throw error;
        o.onWarn?.(t("en", "voice.allFailed", { index: index + 1, lang }));
      }
    }
    steps.push(Object.keys(audio).length ? { ...step, audio } : step);
  }
  return { ...guide, steps };
}
```

`packages/cli/src/voice/fake.ts`:
```ts
import type { VoiceProvider } from "./provider.js";

// One silent MPEG-1 Layer III frame: 128 kbps, 44.1 kHz, mono, no padding (417 bytes, 1152 samples).
const FRAME_SECONDS = 1152 / 44100;
const FRAME = (() => {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0xc0;
  return frame;
})();

export function silentMp3(seconds: number): Buffer {
  const frames = Math.max(1, Math.ceil(seconds / FRAME_SECONDS));
  return Buffer.concat(Array.from({ length: frames }, () => FRAME));
}

/** Silence whose length grows with the text (~15 characters per second); for tests and CI. */
export function createFakeVoiceProvider(): VoiceProvider {
  return {
    id: "fake",
    model: "silence",
    async synthesize(request) {
      return silentMp3(Math.max(1, request.text.length / 15));
    },
  };
}
```

`packages/cli/src/voice/elevenlabs.ts`:
```ts
import { VoiceError, type VoiceProvider } from "./provider.js";

export function createElevenLabsProvider(o: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): VoiceProvider {
  const model = o.model ?? "eleven_v4";
  const doFetch = o.fetchImpl ?? fetch;
  return {
    id: "elevenlabs",
    model,
    async synthesize(request) {
      if (!request.voice) throw new VoiceError(`ElevenLabs needs a voice id for ${request.lang} (voice.voices.${request.lang})`);
      const response = await doFetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voice)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": o.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text: request.text,
            model_id: model,
            language_code: request.lang,
            voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: request.speed },
          }),
        },
      );
      if (!response.ok) throw new VoiceError(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
```

`packages/cli/src/voice/index.ts`:
```ts
import type { Config } from "../config.js";
import type { Credentials } from "../credentials.js";
import { createElevenLabsProvider } from "./elevenlabs.js";
import { createFakeVoiceProvider } from "./fake.js";
import type { VoiceProvider } from "./provider.js";

/** Main provider first, then the fallbacks. Deepgram, OpenAI, Piper and command arrive in plan 4. */
export function buildVoiceProviders(config: Config, creds: Credentials): VoiceProvider[] {
  const ids = [config.voice.provider, ...config.voice.fallback.filter((id) => id !== config.voice.provider)];
  const providers: VoiceProvider[] = [];
  for (const id of ids) {
    if (id === "fake") providers.push(createFakeVoiceProvider());
    if (id === "elevenlabs" && creds.elevenlabs) providers.push(createElevenLabsProvider({ apiKey: creds.elevenlabs, model: config.voice.model }));
  }
  return providers;
}
```

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npx vitest run packages/cli/test/voice.test.ts && npm run typecheck`
Expected: PASS (9 pruebas).

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): voz con caché, reintentos, respaldo, ElevenLabs y voz falsa"
```

---

### Task 13: Salidas, orquestación y comandos

**Files:**
- Create: `packages/cli/src/output.ts`, `packages/cli/src/build.ts`, `packages/cli/src/login.ts`, `packages/cli/src/cli.ts`, `packages/cli/src/bin.ts`
- Test: `packages/cli/test/output.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces:
  - `output.ts`: `interface GuideIndexEntry { id: string; title: LocalizedText; startUrl: string; languages: Lang[] }`, `writeGuide(outputRoot: string, guide: Guide): Promise<string>` (devuelve la carpeta de la guía), `slugify(text: string): string`, `readGuide(path: string): Promise<Guide>`.
  - `build.ts`: `interface BuildOptions { cwd; config: Config; credentials: Credentials; base?; head?; diffFile?; files?: string[]; describe?; id?; voice?: boolean; driver?: LlmDriver; voiceProviders?: VoiceProvider[]; home?: string; log?: (m: string) => void }`, `interface BuildResult { guide: Guide; dir: string; usage: Usage }`, `build(o: BuildOptions): Promise<BuildResult>`, `assembleGuide(...)`, `sessionPath(home: string, cwd: string): string`.
  - `login.ts`: `login(o: { cwd: string; config: Config; home?: string; log: (m: string) => void }): Promise<string>`.
  - `cli.ts`: `exitCodeFor(error: unknown): number`, `createProgram(): Command`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`packages/cli/test/output.test.ts`:
```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { readGuide, slugify, writeGuide } from "../src/output.js";

const guide = (id: string): Guide => ({
  schemaVersion: 1, id, languages: ["es"], title: { es: `Guía ${id}` }, startUrl: "/",
  steps: [{ narration: { es: "Paso." } }],
  source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
});

describe("writeGuide", () => {
  it("writes guide.json and keeps the index sorted without duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "explicame-out-"));
    await writeGuide(root, guide("zeta"));
    await writeGuide(root, guide("alfa"));
    const dir = await writeGuide(root, { ...guide("zeta"), title: { es: "Zeta nueva" } });
    expect(dir).toBe(join(root, "zeta"));
    const index = JSON.parse(await readFile(join(root, "guides.json"), "utf8")) as { id: string; title: { es: string } }[];
    expect(index.map((g) => g.id)).toEqual(["alfa", "zeta"]);
    expect(index[1]!.title.es).toBe("Zeta nueva");
    expect((await readGuide(join(root, "zeta", "guide.json"))).title.es).toBe("Zeta nueva");
  });

  it("slugifies titles with accents", () => {
    expect(slugify("Nuevo filtro por fecha")).toBe("nuevo-filtro-por-fecha");
    expect(slugify("¡Exportación rápida!")).toBe("exportacion-rapida");
    expect(slugify("???")).toBe("guia");
  });
});
```

`packages/cli/test/cli.test.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AppUnreachableError } from "../src/browser/session.js";
import { exitCodeFor } from "../src/cli.js";
import { ConfigError } from "../src/config.js";
import { LoopError } from "../src/generate/loop.js";
import { VerifyError } from "../src/verify.js";
import { VoiceError } from "../src/voice/provider.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("exitCodeFor", () => {
  it("maps each failure to its documented exit code", () => {
    expect(exitCodeFor(new VerifyError({ index: 0, error: "x" }))).toBe(1);
    expect(exitCodeFor(new LoopError("x"))).toBe(1);
    expect(exitCodeFor(new ConfigError("x"))).toBe(2);
    expect(exitCodeFor(new AppUnreachableError("http://localhost:5173"))).toBe(3);
    expect(exitCodeFor(new VoiceError("x"))).toBe(4);
    expect(exitCodeFor(new Anthropic.APIConnectionError({ message: "offline" }))).toBe(4);
    expect(exitCodeFor(new Error("x"))).toBe(1);
  });
});

describe("binary", () => {
  it("builds and answers --help under both names", () => {
    execSync("npm run build -w explicame", { cwd: ROOT, stdio: "pipe" });
    const help = execFileSync(process.execPath, [`${ROOT}packages/cli/dist/bin.js`, "--help"], { encoding: "utf8" });
    expect(help).toContain("build");
    expect(help).toContain("verify");
    expect(help).toContain("voice");
    expect(help).toContain("login");
    const pkg = JSON.parse(readFileSync(`${ROOT}packages/cli/package.json`, "utf8")) as { bin: Record<string, string> };
    expect(pkg.bin).toEqual({ explicame: "dist/bin.js", "explain-me": "dist/bin.js" });
  }, 120_000);
});
```

- [ ] **Step 2: Ejecutar las pruebas para verlas fallar**

Run: `npx vitest run packages/cli/test/output.test.ts packages/cli/test/cli.test.ts`
Expected: FAIL — no se resuelven `../src/output.js` ni `../src/cli.js`.

- [ ] **Step 3: Implementar las salidas**

`packages/cli/src/output.ts`:
```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateGuide, type Guide, type Lang, type LocalizedText } from "@explicame/core";

export interface GuideIndexEntry {
  id: string;
  title: LocalizedText;
  startUrl: string;
  languages: Lang[];
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "guia";
}

export async function readGuide(path: string): Promise<Guide> {
  const result = validateGuide(JSON.parse(await readFile(path, "utf8")));
  if (!result.ok) throw new Error(`${path}: ${result.errors.join("; ")}`);
  return result.guide;
}

/** Writes <root>/<id>/guide.json and upserts <root>/guides.json (sorted by id). Returns the guide folder. */
export async function writeGuide(outputRoot: string, guide: Guide): Promise<string> {
  const dir = join(outputRoot, guide.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "guide.json"), `${JSON.stringify(guide, null, 2)}\n`);
  const indexPath = join(outputRoot, "guides.json");
  let index: GuideIndexEntry[] = [];
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as GuideIndexEntry[];
  } catch {
    index = [];
  }
  const entry: GuideIndexEntry = { id: guide.id, title: guide.title, startUrl: guide.startUrl, languages: guide.languages };
  index = [...index.filter((g) => g.id !== guide.id), entry].sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return dir;
}
```

- [ ] **Step 4: Implementar la orquestación**

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
import type { Config } from "./config.js";
import { explicameHome, requireCredential, type Credentials } from "./credentials.js";
import { getChangeContext, type ChangeContext } from "./diff.js";
import { countFirstTurnTokens, createAnthropicDriver, estimateCostUsd } from "./generate/anthropicDriver.js";
import type { LlmDriver, Usage } from "./generate/driver.js";
import { LoopError, runExploration, type ExplorationResult } from "./generate/loop.js";
import { slugify, writeGuide } from "./output.js";
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
  context: ChangeContext;
  driver: LlmDriver;
}): Guide {
  const firstTitle = x.title[x.languages[0]!] ?? "guia";
  const candidate = {
    schemaVersion: 1,
    id: x.id ?? slugify(firstTitle),
    languages: x.languages,
    title: x.title,
    startUrl: x.startUrl,
    steps: x.steps,
    source: {
      base: x.context.base,
      head: x.context.head,
      commit: x.context.commit,
      generatedBy: x.driver.id,
      model: x.driver.model,
      createdAt: new Date().toISOString(),
    },
  };
  const result = validateGuide(candidate);
  if (!result.ok) throw new LoopError(`The generated guide is not valid: ${result.errors.join("; ")}`);
  return result.guide;
}

export async function build(o: BuildOptions): Promise<BuildResult> {
  const lang = o.config.uiLanguage;
  const log = o.log ?? (() => {});
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
      appUrl: o.config.appUrl, startUrl: o.config.startUrl, onEvent: (event) => log(event.message),
    });
  } finally {
    await session.close();
  }

  let guide = assembleGuide({
    id: o.id, languages: o.config.languages, title: exploration.title, steps: exploration.steps,
    startUrl: o.config.startUrl, context, driver,
  });
  guide = await verifyAndRepair({ guide, driver, pendingResults: exploration.pendingResults, open, log });

  const outputRoot = resolve(o.cwd, o.config.outputDir);
  const dir = join(outputRoot, guide.id);
  if (o.voice !== false) {
    const providers = o.voiceProviders ?? buildVoiceProviders(o.config, o.credentials);
    if (providers.length === 0) log(t(lang, "voice.noProvider"));
    guide = await voiceGuide(guide, {
      providers, guideDir: dir, cacheDir: join(home, "cache", "voice"),
      voices: o.config.voice.voices, speed: o.config.voice.speed, onWarn: log,
    });
  }
  await writeGuide(outputRoot, guide);
  log(t(lang, "build.done", { count: guide.steps.length, langs: guide.languages.join(" + "), path: dir }));
  return { guide, dir, usage: driver.usage() };
}
```

`packages/cli/src/login.ts`:
```ts
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { t } from "@explicame/core";
import { sessionPath } from "./build.js";
import type { Config } from "./config.js";
import { explicameHome } from "./credentials.js";

/** Opens a visible browser at the app; when the user closes the tab, the session is saved outside the project. */
export async function login(o: { cwd: string; config: Config; home?: string; log: (message: string) => void }): Promise<string> {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(new URL(o.config.startUrl, o.config.appUrl).toString());
    o.log(t(o.config.uiLanguage, "login.instructions"));
    await page.waitForEvent("close", { timeout: 0 });
    const file = sessionPath(o.home ?? explicameHome(), o.cwd);
    await mkdir(dirname(file), { recursive: true });
    await context.storageState({ path: file });
    o.log(t(o.config.uiLanguage, "login.saved", { path: file }));
    return file;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Implementar los comandos**

`packages/cli/src/cli.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { Command } from "commander";
import { dirname, resolve } from "node:path";
import { AppUnreachableError, openSession } from "./browser/session.js";
import { build } from "./build.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { explicameHome, loadCredentials, type Credentials } from "./credentials.js";
import { createFakeDriver, loadFakeScript } from "./generate/fakeDriver.js";
import { LoopError } from "./generate/loop.js";
import { login } from "./login.js";
import { readGuide, writeGuide } from "./output.js";
import { VerifyError, verifyGuide } from "./verify.js";
import { createFakeVoiceProvider } from "./voice/fake.js";
import { buildVoiceProviders } from "./voice/index.js";
import { VoiceError, voiceGuide } from "./voice/provider.js";

export function exitCodeFor(error: unknown): number {
  if (error instanceof VerifyError || error instanceof LoopError) return 1;
  if (error instanceof ConfigError || error instanceof Anthropic.AuthenticationError) return 2;
  if (error instanceof AppUnreachableError) return 3;
  if (error instanceof VoiceError || error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.RateLimitError) return 4;
  if (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 500) return 4;
  return 1;
}

interface RunContext {
  cwd: string;
  config: Config;
  credentials: Credentials;
  log: (message: string) => void;
}

async function run(task: (ctx: RunContext) => Promise<unknown>): Promise<void> {
  try {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const credentials = await loadCredentials();
    await task({ cwd, config, credentials, log: (message) => console.log(message) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = exitCodeFor(error);
  }
}

const list = (value: string | undefined) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

export function createProgram(): Command {
  const program = new Command();
  program
    .name("explicame")
    .description("Onboarding narrado para cada funcionalidad nueva · Narrated onboarding for every new feature")
    .version("0.1.0");

  program
    .command("build")
    .description("diff → exploración → guion verificado → voz · diff → exploration → verified script → voice")
    .option("--base <ref>", "rama base (por defecto la de explicame.config.json)")
    .option("--head <ref>", "rama o commit con la funcionalidad", "HEAD")
    .option("--diff-file <path>", "usar un archivo .patch en lugar de git")
    .option("--files <paths>", "archivos extra de contexto, separados por comas")
    .option("--describe <text>", "qué hace la funcionalidad, en una frase")
    .option("--id <id>", "id de la guía (kebab-case)")
    .option("--no-voice", "no generar audio")
    .action((opts: { base?: string; head: string; diffFile?: string; files?: string; describe?: string; id?: string; voice: boolean }) =>
      run(async ({ cwd, config, credentials, log }) => {
        // Testing hooks: a scripted fake AI and silent voices, so CI never needs keys.
        const fakeScript = process.env.EXPLICAME_FAKE_SCRIPT;
        await build({
          cwd, config, credentials, log,
          base: opts.base, head: opts.head, diffFile: opts.diffFile, files: list(opts.files),
          describe: opts.describe, id: opts.id, voice: opts.voice,
          driver: fakeScript ? createFakeDriver(await loadFakeScript(resolve(cwd, fakeScript))) : undefined,
          voiceProviders: process.env.EXPLICAME_FAKE_VOICE ? [createFakeVoiceProvider()] : undefined,
        });
      }),
    );

  program
    .command("verify <guide>")
    .description("reproduce una guía y comprueba cada paso · replays a guide and checks every step")
    .action((guidePath: string) =>
      run(async ({ cwd, config, log }) => {
        const guide = await readGuide(resolve(cwd, guidePath));
        const failure = (await verifyGuide(guide, () => openSession({ appUrl: config.appUrl, startUrl: guide.startUrl, allowRequests: config.safety.allowRequests, lang: config.uiLanguage })))[0];
        if (failure) throw new VerifyError(failure);
        log("OK");
      }),
    );

  program
    .command("voice <guide>")
    .description("genera o regenera el audio de una guía · (re)generates a guide's audio")
    .action((guidePath: string) =>
      run(async ({ cwd, config, credentials, log }) => {
        const file = resolve(cwd, guidePath);
        const guideDir = dirname(file);
        const voiced = await voiceGuide(await readGuide(file), {
          providers: process.env.EXPLICAME_FAKE_VOICE ? [createFakeVoiceProvider()] : buildVoiceProviders(config, credentials),
          guideDir, cacheDir: resolve(explicameHome(), "cache", "voice"),
          voices: config.voice.voices, speed: config.voice.speed, onWarn: log,
        });
        await writeGuide(dirname(guideDir), voiced);
        log("OK");
      }),
    );

  program
    .command("login")
    .description("inicia sesión en tu app una vez y guarda la sesión · log in to your app once and keep the session")
    .action(() => run(({ cwd, config, log }) => login({ cwd, config, log })));

  return program;
}
```

`packages/cli/src/bin.ts`:
```ts
import { createProgram } from "./cli.js";

await createProgram().parseAsync(process.argv);
```

- [ ] **Step 6: Ejecutar las pruebas para verlas pasar**

Run: `npx vitest run packages/cli/test/output.test.ts packages/cli/test/cli.test.ts && npm run typecheck`
Expected: PASS (4 pruebas); `packages/cli/dist/bin.js` existe y empieza con `#!/usr/bin/env node`.

- [ ] **Step 7: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): comandos build, verify, voice y login con códigos de salida"
```

---

### Task 14: App de ejemplo, prueba de punta a punta y CI

**Files:**
- Create: `examples/demo-app/package.json`, `examples/demo-app/index.html`, `examples/demo-app/public/api/reports.json`, `examples/demo-app/src/main.ts`, `examples/demo-app/src/table.ts`, `examples/demo-app/src/style.css`
- Create (segundo commit, la funcionalidad nueva): `examples/demo-app/src/filter.ts`; Modify: `examples/demo-app/src/main.ts`
- Create: `examples/demo-app/feature.patch` (generado con git), `examples/demo-app/explicame.fake-script.json`, `.github/workflows/ci.yml`
- Test: `packages/cli/test/e2e.test.ts`

**Interfaces:**
- Consumes: `build`, `ConfigSchema`, `createFakeDriver`, `loadFakeScript`, `createFakeVoiceProvider`, `startServer`, `validateGuide`.
- Produces: la app de ejemplo y su guion falso, usados también por el plan 2 (reproductor) y el plan 5 (video).

- [ ] **Step 1: Crear la app base (sin la funcionalidad nueva)**

`examples/demo-app/package.json`:
```json
{
  "name": "demo-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview --port 5173" }
}
```

`examples/demo-app/index.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reportes · demo de explicame</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`examples/demo-app/public/api/reports.json`:
```json
[
  { "fecha": "2026-08-28", "cliente": "Café del Río", "total": 1250000 },
  { "fecha": "2026-09-03", "cliente": "Ferretería Andina", "total": 830000 },
  { "fecha": "2026-09-12", "cliente": "Librería Central", "total": 455000 },
  { "fecha": "2026-09-21", "cliente": "Panadería La Espiga", "total": 312000 },
  { "fecha": "2026-10-02", "cliente": "Óptica Visión", "total": 980000 }
]
```

`examples/demo-app/src/table.ts`:
```ts
export interface Report {
  fecha: string;
  cliente: string;
  total: number;
}

export function renderTable(tbody: HTMLTableSectionElement, rows: Report[]): void {
  tbody.innerHTML = rows
    .map((r) => `<tr><td>${r.fecha}</td><td>${r.cliente}</td><td>${r.total.toLocaleString("es-CO")}</td></tr>`)
    .join("");
}
```

`examples/demo-app/src/main.ts`:
```ts
import "./style.css";
import { renderTable, type Report } from "./table";

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = `
    <header><h1>Reportes</h1></header>
    <section class="toolbar" aria-label="Herramientas"></section>
    <table aria-label="Reportes de ventas">
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Total</th></tr></thead>
      <tbody></tbody>
    </table>`;
  const reports = (await (await fetch("/api/reports.json")).json()) as Report[];
  renderTable(app.querySelector("tbody")!, reports);
}

void main();
```

`examples/demo-app/src/style.css`:
```css
body { font-family: system-ui, sans-serif; margin: 2rem; color: #1d1b26; }
.toolbar { display: flex; gap: 0.5rem; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; max-width: 720px; }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e2ec; }
dialog form { display: grid; gap: 0.5rem; min-width: 280px; }
```

Run: `npm install && git add examples/demo-app && git commit -m "chore(demo): app de ejemplo Reportes"`
Expected: commit creado.

- [ ] **Step 2: Agregar la funcionalidad nueva en un commit aparte**

`examples/demo-app/src/filter.ts`:
```ts
import { renderTable, type Report } from "./table";

export function mountDateFilter(toolbar: HTMLElement, tbody: HTMLTableSectionElement, all: Report[]): void {
  toolbar.innerHTML = `
    <button type="button" data-testid="filtro-fecha">Filtrar por fecha</button>
    <dialog aria-label="Filtro por fecha">
      <form method="dialog">
        <label for="desde">Desde</label> <input id="desde" type="date" />
        <label for="hasta">Hasta</label> <input id="hasta" type="date" />
        <label for="agrupar">Agrupar por</label>
        <select id="agrupar"><option>Día</option><option>Semana</option><option>Mes</option></select>
        <button type="button" data-action="aplicar">Aplicar</button>
        <button type="button" data-action="guardar">Guardar como predeterminado</button>
      </form>
    </dialog>`;
  const dialog = toolbar.querySelector("dialog")!;
  toolbar.querySelector<HTMLButtonElement>('[data-testid="filtro-fecha"]')!.onclick = () => dialog.showModal();
  toolbar.querySelector<HTMLButtonElement>('[data-action="aplicar"]')!.onclick = () => {
    const desde = toolbar.querySelector<HTMLInputElement>("#desde")!.value;
    const hasta = toolbar.querySelector<HTMLInputElement>("#hasta")!.value;
    renderTable(tbody, all.filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)));
    dialog.close();
  };
  toolbar.querySelector<HTMLButtonElement>('[data-action="guardar"]')!.onclick = async () => {
    await fetch("/api/preferences", { method: "POST", body: JSON.stringify({ filtro: "fecha" }) });
  };
}
```

En `examples/demo-app/src/main.ts`, importar y montar el filtro: añadir `import { mountDateFilter } from "./filter";` debajo del import de `./table`, y al final de `main()`:
```ts
  mountDateFilter(app.querySelector<HTMLElement>(".toolbar")!, app.querySelector("tbody")!, reports);
```

Run:
```bash
git add examples/demo-app/src
git commit -m "feat(demo): filtro por fecha en Reportes"
git diff HEAD~1 HEAD -- examples/demo-app/src > examples/demo-app/feature.patch
```
Expected: `feature.patch` contiene `src/filter.ts` (archivo nuevo) y el cambio en `src/main.ts`.

- [ ] **Step 3: Escribir el guion de la IA falsa**

`examples/demo-app/explicame.fake-script.json`:
```json
{
  "turns": [
    [{ "name": "observe", "input": {} }],
    [{ "name": "add_step", "input": { "narration": { "es": "Lo nuevo está aquí: el botón Filtrar por fecha abre el filtro de reportes.", "en": "Here is what's new: the Filter by date button opens the report filter." }, "element": { "name": "Filtrar por fecha" }, "action": "click", "value": null, "url": null, "opens": "dialog" } }],
    [{ "name": "add_step", "input": { "narration": { "es": "Elige desde qué fecha quieres ver los reportes.", "en": "Pick the first date you want to see." }, "element": { "label": "Desde" }, "action": "type", "value": "2026-09-01", "url": null, "opens": null } }],
    [{ "name": "add_step", "input": { "narration": { "es": "Y hasta qué fecha.", "en": "And the last one." }, "element": { "label": "Hasta" }, "action": "type", "value": "2026-09-30", "url": null, "opens": null } }],
    [{ "name": "add_step", "input": { "narration": { "es": "Aquí decides cómo agruparlos: por día, semana o mes.", "en": "Here you choose how to group them: by day, week or month." }, "element": { "label": "Agrupar por" }, "action": "select", "value": "Semana", "url": null, "opens": null } }],
    [{ "name": "add_step", "input": { "narration": { "es": "Este botón guarda el filtro para la próxima vez; en esta guía solo te lo señalo.", "en": "This button saves the filter for next time; in this guide I only point at it." }, "element": { "name": "Guardar como predeterminado" }, "action": null, "value": null, "url": null, "opens": null } }],
    [{ "name": "add_step", "input": { "narration": { "es": "Aplicar filtra la tabla con tu rango de fechas.", "en": "Apply filters the table with your date range." }, "element": { "name": "Aplicar" }, "action": "click", "value": null, "url": null, "opens": null } }],
    [{ "name": "finish", "input": { "title": { "es": "Nuevo filtro por fecha", "en": "New date filter" } } }]
  ]
}
```

- [ ] **Step 4: Escribir la prueba de punta a punta que falla**

`packages/cli/test/e2e.test.ts`:
```ts
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
```

- [ ] **Step 5: Ejecutar la prueba**

Run: `npx vitest run packages/cli/test/e2e.test.ts`
Expected: PASS. Si falla, el mensaje dice qué paso o qué elemento no se encontró: corregir la causa en el código correspondiente (no en la prueba) y volver a ejecutar.

- [ ] **Step 6: Añadir CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 7: Ejecutar toda la suite y el typecheck**

Run: `npm run typecheck && npm test && npm run build`
Expected: todas las pruebas PASS, sin errores de tipos, `packages/cli/dist/bin.js` generado.

- [ ] **Step 8: Probar el comando real con la IA falsa**

Run (desde `examples/demo-app`, con `npm run preview` corriendo en otra terminal y un `explicame.config.json` con `{"appUrl": "http://localhost:5173", "voice": {"provider": "fake"}}`):
```bash
EXPLICAME_FAKE_SCRIPT=explicame.fake-script.json EXPLICAME_FAKE_VOICE=1 node ../../packages/cli/dist/bin.js build --diff-file feature.patch
```
Expected: mensajes de cada paso y `Listo: 6 pasos en es + en. Guía en …/public/explicame/nuevo-filtro-por-fecha`; código de salida 0.

- [ ] **Step 9: Commit y push**

```bash
git add examples/demo-app packages/cli/test/e2e.test.ts .github/workflows/ci.yml
git commit -m "test: prueba de punta a punta sobre la app de ejemplo y CI"
git push
```

---

### Task 15: Reporte de fallos, presupuesto de tokens y parada con Ctrl+C

**Files:**
- Create: `packages/cli/src/report.ts`
- Modify: `packages/cli/src/verify.ts`, `packages/cli/src/generate/loop.ts`, `packages/cli/src/build.ts`
- Test: `packages/cli/test/report.test.ts`

**Interfaces:**
- Consumes: Tasks 9, 11 y 13.
- Produces: `writeReport(dir: string, data: unknown): Promise<string>` y `writeReportSync(dir: string, data: unknown): string` (devuelven la ruta de `report.json`); `VerifyOptions.reportDir?: string` y `VerifyFailure.screenshot?: string`; `RepairOptions.reportDir?: string`; `ExplorationOptions.tokenBudget?: number` (por defecto `DEFAULT_TOKEN_BUDGET = 2_000_000` tokens de entrada).

- [ ] **Step 1: Escribir la prueba que falla**

`packages/cli/test/report.test.ts`:
```ts
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { openSession } from "../src/browser/session.js";
import { createFakeDriver } from "../src/generate/fakeDriver.js";
import { LoopError, runExploration } from "../src/generate/loop.js";
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
    expect(LoopError).toBeDefined();
  });
});
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/cli/test/report.test.ts`
Expected: FAIL — no se resuelve `../src/report.js`.

- [ ] **Step 3: Implementar**

`packages/cli/src/report.ts`:
```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeReport(dir: string, data: unknown): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, "report.json");
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

/** Synchronous variant for the SIGINT handler, where awaiting is not possible. */
export function writeReportSync(dir: string, data: unknown): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "report.json");
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}
```

En `packages/cli/src/verify.ts`:
- Añadir `screenshot?: string` a `VerifyFailure` y `reportDir?: string` a `VerifyOptions` y a `RepairOptions`.
- Añadir los imports `import { mkdir } from "node:fs/promises";` y `import { join } from "node:path";`.
- Reemplazar el cuerpo del `for` de `verifyGuide` por:
```ts
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
```
- En `verifyAndRepair`, pasar el directorio: `await verifyGuide(guide, o.open, { timeoutMs, reportDir: o.reportDir })`.

En `packages/cli/src/generate/loop.ts`:
- Exportar `export const DEFAULT_TOKEN_BUDGET = 2_000_000;` y añadir `tokenBudget?: number` a `ExplorationOptions`.
- Justo después de cada `turn = await o.driver.reply(...)` (las dos llamadas dentro del `for`), comprobar el presupuesto:
```ts
    if (o.driver.usage().inputTokens > (o.tokenBudget ?? DEFAULT_TOKEN_BUDGET)) {
      throw new LoopError(`The token budget of ${o.tokenBudget ?? DEFAULT_TOKEN_BUDGET} input tokens was exceeded.`);
    }
```

En `packages/cli/src/build.ts`:
- Importar `writeReport` y `writeReportSync` desde `./report.js`.
- Al inicio de `build()`, crear la carpeta del reporte y un registro de eventos, y registrar el manejador de Ctrl+C:
```ts
  const reportDir = join(resolve(o.cwd), ".explicame", "reports", new Date().toISOString().replace(/[:.]/g, "-"));
  const events: string[] = [];
  const record = (message: string) => {
    events.push(message);
    log(message);
  };
  const onInterrupt = () => {
    writeReportSync(reportDir, { interrupted: true, events });
    process.exit(130);
  };
  process.once("SIGINT", onInterrupt);
```
- Usar `record` en lugar de `log` para `onEvent` del bucle y para `verifyAndRepair`; pasar `reportDir` a `verifyAndRepair`.
- Envolver desde `getChangeContext` hasta `writeGuide` en `try { … } catch (error) { await writeReport(reportDir, { error: (error as Error).message, events }); throw error; } finally { process.removeListener("SIGINT", onInterrupt); }`.

Playwright cierra solo los navegadores que abrió cuando el proceso recibe Ctrl+C (`handleSIGINT` viene activado), así que el manejador solo tiene que dejar el reporte parcial.

- [ ] **Step 4: Ejecutar todas las pruebas**

Run: `npx vitest run packages/cli && npm run typecheck`
Expected: PASS, incluidas las 3 nuevas y las de las Tareas 11, 13 y 14 sin cambios.

- [ ] **Step 5: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): reporte con captura del paso que falla, presupuesto de tokens y parada con Ctrl+C"
```

---

## Cobertura del spec en este plan

| Sección del spec | Tareas |
|---|---|
| §3 Flujo de generación (contexto, plan, bucle, verificación, voz) | 7, 5, 9, 11, 12, 13 |
| §4 Formato del guion | 1 |
| §5 Mapa de elementos y selectores | 4, 8 |
| §6 Seguridad (reglas, bloqueo de red, nada se guarda) | 2, 8, 9, 14 |
| §9 Voz (interfaz, caché, reintentos, respaldo, ElevenLabs) | 12 |
| §10 Modo API key, configuración, secretos, sesión de la app | 6, 10, 13 |
| §11 Errores, límites, reporte con captura, Ctrl+C y códigos de salida | 3, 9, 13, 15 |
| §12 Pruebas sin claves y CI | 9, 10, 12, 14 |

Quedan para los planes siguientes: el reproductor y su velo (§6.3, §7) y la grabación MP4 (§8) en el plan 2; el servidor MCP y el plugin (§10, modo cuenta de Claude) en el plan 3; el panel (§10) y las voces Deepgram, OpenAI, Piper y `command` (§9) en el plan 4; el video explicativo, el README final y el release (§8, §13) en el plan 5.

