# explicame — Plan 5: app de ejemplo, video explicativo y publicación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar la v0.1: la app de ejemplo trae el reproductor y una guía real (escrita por Claude Code con el plugin), el repo tiene su video explicativo en MP4 (ES y EN, 90–120 s), un README bilingüe completo, `CHANGELOG.md`, `CONTRIBUTING.md`, y la versión `v0.1.0` queda publicada en `main` con sus videos.

**Architecture:** La app de ejemplo carga el reproductor con la línea de integración del README; el bundle se vuelve idempotente para que cargarlo dos veces (la app y el grabador) deje una sola instancia. El video se hace con explicame mismo: la narración pasa por `explicame voice` sobre una guía de un solo uso, los clips son grabaciones de `explicame record` de la guía real, y `video/render.mjs` captura cuadro a cuadro (30 fps) una línea de tiempo GSAP en Chromium y mezcla audio con ffmpeg.

**Tech Stack:** las versiones de los planes 1–4; GSAP 3.15 (licencia «Standard no charge») solo para el video.

**Spec:** `docs/superpowers/specs/2026-10-01-explicame-design.md` (§8 video explicativo, §12 pruebas en vivo, §13 publicación, §14.6 integración en la app de ejemplo)

**Decisiones frente al spec (se registran como rulings al ejecutar):**
- La guía de la app de ejemplo la generó Claude Code real en modo plugin (el 2026-10-01, 7 pasos, verificada); se versiona con su audio como ejemplo de salida.
- El spec pide narración con ElevenLabs v4, pero las claves que dio el autor caducaron. `render.mjs` usa ElevenLabs v4 cuando hay `ELEVENLABS_API_KEY` y voces, y si no, Piper con las voces de licencia limpia. La v0.1.0 se publica con Piper y se vuelve a renderizar con ElevenLabs en cuanto haya clave: es un solo comando.
- El clip del video es un extracto de la grabación real: los pasos 1 a 4 de la guía, para no pasar de 120 s.

## Global Constraints

- Las de los planes 1–4 siguen vigentes (commits a nombre del autor, sin atribuciones; textos en ES/EN; nada escribe en la app).
- Ningún secreto en archivos: la clave de ElevenLabs para el video solo llega por variable de entorno.
- El video dura entre 90 y 120 s por idioma, 1920×1080, 30 fps, H.264 + AAC, con subtítulos quemados.
- Los MP4 se publican como adjuntos de la release `v0.1.0`, no dentro del repo; el README los enlaza con una imagen de portada versionada.

## Review Focus

1. **La app de ejemplo y el grabador cargan el reproductor dos veces**: debe quedar una sola instancia y un solo `<explicame-player>`. Prueba en la Tarea 1.
2. **Un clone limpio**: `npm install && npm run build` y la app de ejemplo arrancan sin pasos manuales extra (el bundle se copia solo). Prueba en la Tarea 1.
3. **README que promete lo que no hay**: cada comando del inicio rápido y de la tabla de comandos existe y funciona. Revisión en la Tarea 4.
4. **Render reproducible**: el video no depende de la hora ni de animaciones en tiempo real; dos renders del mismo cuadro dan la misma imagen. Revisión en la Tarea 3.

---

### Task 1: La app de ejemplo con el reproductor y la guía real

**Files:**
- Modify: `packages/player/src/global.ts`, `packages/player/test/browser.test.ts`
- Modify: `examples/demo-app/index.html`, `examples/demo-app/package.json`, `.gitignore`
- Create: `examples/demo-app/scripts/copy-player.mjs`, `examples/demo-app/explicame.config.json`
- Create (salida real del plugin): `examples/demo-app/public/explicame/guides.json`, `examples/demo-app/public/explicame/filtrar-reportes-por-fecha/guide.json` y su `audio/`

**Interfaces:**
- Consumes: el bundle IIFE del reproductor (plan 2); `explicame build --from-guide --video` (planes 3–4); Piper (plan 4).
- Produces: `window.Explicame` idempotente; la app de ejemplo con el botón «¿Cómo funciona?»; los clips `examples/demo-app/.explicame/videos/filtrar-reportes-por-fecha.{es,en}.mp4` y `.srt` (no versionados) para la Tarea 3.

- [ ] **Step 1: Escribir la prueba que falla**

En `packages/player/test/browser.test.ts`, dentro de `describe("player bundle in a real browser", ...)`:

```ts
  it("keeps a single player when the bundle loads twice (the app and the recorder)", async () => {
    const page = await openApp();
    const same = await page.evaluate(async () => {
      const first = (window as unknown as { Explicame: object }).Explicame;
      const script = document.createElement("script");
      script.src = "/explicame/explicame-player.js";
      await new Promise((done) => {
        script.onload = done;
        document.head.append(script);
      });
      const api = (window as unknown as { Explicame: { mount(o: object): void } }).Explicame;
      api.mount({ lang: "es" });
      api.mount({ lang: "en" });
      return first === api;
    });
    expect(same).toBe(true);
    expect(await page.locator("explicame-player").count()).toBe(1);
    await page.close();
  });
```

- [ ] **Step 2: Ejecutar la prueba para verla fallar**

Run: `npx vitest run packages/player/test/browser.test.ts`
Expected: FAIL — `expected false to be true` (la segunda carga reemplaza `window.Explicame`).

- [ ] **Step 3: Bundle idempotente**

`packages/player/src/global.ts`:
```ts
import * as Explicame from "./index.js";

// The app's own <script> tag and the recorder may both load the bundle: the first instance stays, so there is
// always a single player.
const host = window as unknown as { Explicame?: typeof Explicame };
host.Explicame ??= Explicame;
```

- [ ] **Step 4: Ejecutar la prueba para verla pasar**

Run: `npm run build -w @explicame/player && npx vitest run packages/player/test/browser.test.ts`
Expected: PASS (4).

- [ ] **Step 5: La app de ejemplo integra el reproductor**

`examples/demo-app/scripts/copy-player.mjs`:
```js
// Copies the built player next to the guides, as `explicame build` does, so the demo works right after a clone.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bundle = fileURLToPath(new URL("../../../packages/player/dist/explicame-player.js", import.meta.url));
const target = fileURLToPath(new URL("../public/explicame/", import.meta.url));
if (existsSync(bundle)) {
  mkdirSync(target, { recursive: true });
  copyFileSync(bundle, `${target}explicame-player.js`);
} else {
  console.warn("explicame: build the player first (npm run build at the repo root) to see the guide button.");
}
```

`examples/demo-app/package.json`:
```json
{
  "name": "demo-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "predev": "node scripts/copy-player.mjs",
    "dev": "vite",
    "prebuild": "node scripts/copy-player.mjs",
    "build": "vite build",
    "preview": "vite preview --port 5173"
  }
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
    <!-- The one line from the README: the player and its "How does it work?" button. -->
    <script src="/explicame/explicame-player.js"></script>
    <script>window.Explicame && window.Explicame.mount();</script>
  </body>
</html>
```

`examples/demo-app/explicame.config.json`:
```json
{
  "appUrl": "http://localhost:5173",
  "base": "main",
  "languages": ["es", "en"],
  "mode": "plugin",
  "voice": { "provider": "piper" }
}
```

En `.gitignore`, reemplazar la línea `examples/demo-app/public/explicame/` por `examples/demo-app/public/explicame/explicame-player.js` (la guía de ejemplo y su audio se versionan; el bundle se copia en cada build).

- [ ] **Step 6: La guía real, con voz y video**

La guía la generó Claude Code con el plugin (ver ledger del plan 4). Restaurarla en `examples/demo-app/public/explicame/` desde la copia de la sesión si hiciera falta, servir la app (`npm run build -w demo-app` y un servidor estático en `:5173`) y, en `examples/demo-app`:

Run: `node ../../packages/cli/dist/bin.js build --from-guide public/explicame/filtrar-reportes-por-fecha/guide.json --video`
Expected: audio en `public/explicame/filtrar-reportes-por-fecha/audio/{es,en}/01..07.mp3` (Piper), y `.explicame/videos/filtrar-reportes-por-fecha.es.mp4`, `.en.mp4` con sus `.srt`.

- [ ] **Step 7: Suite, tipos y build**

Run: `npm test && npm run typecheck && npm run build`
Expected: todo en verde (las pruebas que sirven la app de ejemplo siguen pasando con el reproductor integrado).

- [ ] **Step 8: Commit**

```bash
git add packages/player/src/global.ts packages/player/test/browser.test.ts examples/demo-app .gitignore
git commit -m "feat(demo): la app de ejemplo integra el reproductor y trae la guía que escribió Claude Code"
```

---

### Task 2: El video explicativo

**Files:**
- Create: `video/package.json`, `video/script.json`, `video/index.html`, `video/video.css`, `video/video.js`, `video/render.mjs`, `video/shots.mjs`, `video/README.md`
- Modify: `package.json` (workspace `video` y script `video`), `.gitignore`

**Interfaces:**
- Consumes: `explicame voice` (narración), los clips de la Tarea 1, el panel (`explicame panel`) para su captura.
- Produces: `video/out/explicame.es.mp4`, `video/out/explicame.en.mp4`, `video/out/poster.es.png`, `video/out/poster.en.png` (no versionados) y `npm run video -- [--lang es|en|all] [--voice piper|elevenlabs]`.

- [ ] **Step 1: El paquete del video**

`video/package.json`:
```json
{
  "name": "explicame-video",
  "private": true,
  "type": "module",
  "scripts": {
    "shots": "node shots.mjs",
    "render": "node render.mjs"
  },
  "devDependencies": {
    "gsap": "^3.15.0"
  }
}
```

En el `package.json` raíz: agregar `"video"` a `workspaces` y el script `"video": "npm run shots -w explicame-video && npm run render -w explicame-video --"`. En `.gitignore`: `video/out/` y `video/assets/`.

Run: `npm install`
Expected: `node_modules/gsap/dist/gsap.min.js` existe.

- [ ] **Step 2: El guion**

`video/script.json`:
```json
{
  "clip": { "guide": "filtrar-reportes-por-fecha", "untilStep": 5 },
  "scenes": [
    {
      "id": "intro",
      "chunks": [
        { "es": "Cada funcionalidad nueva obliga a alguien a explicarla: grabar un video, escribir un manual o sentarse con cada persona.", "en": "Every new feature forces someone to explain it: record a video, write a manual, or sit down with each person." },
        { "es": "Casi siempre llega tarde. ¿Y si la explicación se generara sola, a partir del código?", "en": "It almost always comes late. What if the explanation wrote itself, straight from the code?" }
      ]
    },
    {
      "id": "flow",
      "chunks": [
        { "es": "Eso hace explicame. Lee el cambio en tu código y abre tu app en un navegador real, para recorrerla como lo haría una persona.", "en": "That is what explicame does. It reads the change in your code and opens your app in a real browser, to walk through it the way a person would." },
        { "es": "Con lo que ve, escribe el guion en español y en inglés, lo verifica paso a paso en la pantalla real y le pone voz.", "en": "From what it sees, it writes the script in Spanish and English, verifies every step on the real screen, and gives it a voice." },
        { "es": "El resultado es una guía interactiva dentro de tu app y un video listo para compartir.", "en": "The result is an interactive guide inside your app and a video ready to share." }
      ]
    },
    {
      "id": "safety",
      "chunks": [
        { "es": "Y nada se guarda: los botones de guardar o borrar solo se señalan, y toda petición que escriba datos se bloquea.", "en": "And nothing gets saved: save or delete buttons are only pointed at, and every request that writes data is blocked." }
      ]
    },
    {
      "id": "modes",
      "chunks": [
        { "es": "Funciona de dos maneras: con tu propia cuenta, como plugin de Claude Code, o con una API key de Claude.", "en": "It works two ways: with your own account, as a Claude Code plugin, or with a Claude API key." },
        { "es": "Todo se configura desde un panel local, con voces de ElevenLabs, Deepgram u OpenAI, o gratis con Piper.", "en": "Everything is set up from a local panel, with voices from ElevenLabs, Deepgram or OpenAI, or free with Piper." }
      ]
    },
    {
      "id": "demo",
      "chunks": [
        { "es": "Así se ve en la app de ejemplo. Esta guía la escribió Claude Code con explicame, y explicame la grabó.", "en": "Here it is on the demo app. Claude Code wrote this guide with explicame, and explicame recorded it." }
      ]
    },
    {
      "id": "outro",
      "chunks": [
        { "es": "explicame es de código abierto, con licencia MIT. Lo encuentras en GitHub, en Egtorres14 barra explicame.", "en": "explicame is open source and MIT licensed. Find it on GitHub at Egtorres14 slash explicame." }
      ]
    }
  ]
}
```

- [ ] **Step 3: La escena**

`video/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>explicame · video</title>
    <link rel="stylesheet" href="video.css" />
    <script src="../node_modules/gsap/dist/gsap.min.js"></script>
  </head>
  <body>
    <div id="stage">
      <div class="glow"></div>
      <div class="grid"></div>
      <div id="logo" class="logo"><span class="dot"></span>explicame <span class="slash">/ explain-me</span></div>

      <section id="s-intro" class="scene">
        <div class="hero">
          <h1 class="title">explicame <span class="slash">/ explain-me</span></h1>
          <p class="subtitle" data-t="subtitle"></p>
        </div>
        <div class="cards">
          <div class="card"><i data-icon="camera"></i><span data-t="video"></span></div>
          <div class="card"><i data-icon="doc"></i><span data-t="manual"></span></div>
          <div class="card"><i data-icon="people"></i><span data-t="oneOnOne"></span></div>
        </div>
        <div class="late">
          <svg class="clock" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" /><line class="hand" x1="60" y1="60" x2="60" y2="20" /><line x1="60" y1="60" x2="86" y2="60" /></svg>
          <span data-t="late"></span>
        </div>
        <p class="question" data-t="question"></p>
      </section>

      <section id="s-flow" class="scene">
        <div class="details">
          <div class="detail" id="d-diff">
            <pre class="code"><span class="file">src/reportes/filtro.ts</span>
<span class="add">+ export function FiltroPorFecha() {</span>
<span class="add">+   return &lt;button data-testid="filtro-fecha"&gt;</span>
<span class="add">+     Filtrar por fecha</span>
<span class="add">+   &lt;/button&gt;;</span>
<span class="ctx">  }</span></pre>
          </div>
          <div class="detail" id="d-browser">
            <div class="window">
              <div class="bar"><b></b><b></b><b></b><span>localhost:5173</span></div>
              <div class="page">
                <h3 data-t="reports"></h3>
                <div class="toolbar"><span class="btn" data-t="filterBtn"></span><span class="ring"></span></div>
                <div class="rows"><i></i><i></i><i></i></div>
              </div>
            </div>
          </div>
          <div class="detail" id="d-script">
            <ol class="checks">
              <li><span data-t="s1"></span><i data-icon="check"></i></li>
              <li><span data-t="s2"></span><i data-icon="check"></i></li>
              <li><span data-t="s3"></span><i data-icon="check"></i></li>
            </ol>
          </div>
          <div class="detail" id="d-voice"><div class="wave"></div><span class="langs">ES · EN</span></div>
          <div class="detail" id="d-output">
            <div class="tile"><i data-icon="ring"></i><span data-t="inApp"></span></div>
            <div class="tile"><i data-icon="play"></i><span data-t="mp4"></span></div>
          </div>
        </div>
        <svg class="links" viewBox="0 0 1920 1080">
          <path d="M363 670 H549" /><path d="M699 670 H885" /><path d="M1035 670 H1221" /><path d="M1371 670 H1557" />
        </svg>
        <div class="nodes">
          <div class="node"><i data-icon="code"></i><span data-t="diff"></span></div>
          <div class="node"><i data-icon="browser"></i><span data-t="explore"></span></div>
          <div class="node"><i data-icon="check"></i><span data-t="script"></span></div>
          <div class="node"><i data-icon="wave"></i><span data-t="voice"></span></div>
          <div class="node"><i data-icon="play"></i><span data-t="output"></span></div>
        </div>
      </section>

      <section id="s-safety" class="scene">
        <h2 class="headline" data-t="safety"></h2>
        <div class="shield"><i data-icon="shield"></i></div>
        <div class="safety-items">
          <div class="item"><span class="fake-btn" data-t="save"></span><span class="ring"></span><span class="note" data-t="pointed"></span></div>
          <div class="item request"><code>POST /api/preferencias</code><span class="strike"></span><span class="badge" data-t="blocked"></span></div>
        </div>
      </section>

      <section id="s-modes" class="scene">
        <div class="modes">
          <div class="mode">
            <i data-icon="plug"></i>
            <h3 data-t="plugin"></h3>
            <p data-t="pluginSub"></p>
            <code>&gt; /explicame:explicame</code>
          </div>
          <div class="mode">
            <i data-icon="key"></i>
            <h3 data-t="api"></h3>
            <p data-t="apiSub"></p>
            <code>$ explicame build --video</code>
          </div>
        </div>
        <img class="panel-shot" alt="" />
        <div class="chips">
          <span>ElevenLabs</span><span>Deepgram</span><span>OpenAI</span><span class="free">Piper · <b data-t="free"></b></span><span class="free"><b data-t="own"></b></span>
        </div>
      </section>

      <section id="s-demo" class="scene">
        <div class="demo-head">
          <h2 data-t="demoTitle"></h2>
          <p data-t="demoSub"></p>
        </div>
        <div class="window big">
          <div class="bar"><b></b><b></b><b></b><span>localhost:5173</span></div>
          <video class="clip" muted preload="auto"></video>
        </div>
      </section>

      <section id="s-outro" class="scene">
        <h1 class="title">explicame <span class="slash">/ explain-me</span></h1>
        <p class="tagline" data-t="open"></p>
        <p class="url">github.com/Egtorres14/explicame</p>
        <div class="chips"><span>ES · EN</span><span>Claude Code</span><span>MCP</span><span>Playwright</span></div>
      </section>

      <div id="caption" class="caption"></div>
    </div>
    <script src="video.js"></script>
  </body>
</html>
```

`video/video.css`:
```css
:root {
  --bg1: #090b16;
  --bg2: #141833;
  --text: #eef0f8;
  --muted: #9aa1b9;
  --accent: #8b85ff;
  --teal: #2dd4bf;
  --amber: #fbbf24;
  --red: #f87171;
  --card: rgba(255, 255, 255, 0.06);
  --line: rgba(255, 255, 255, 0.14);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg1); }
body { font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif; color: var(--text); }
#stage { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: linear-gradient(160deg, var(--bg1), var(--bg2)); }
.glow { position: absolute; inset: -200px; background: radial-gradient(900px 600px at 25% 20%, rgba(139, 133, 255, 0.28), transparent 60%), radial-gradient(800px 600px at 85% 85%, rgba(45, 212, 191, 0.18), transparent 60%); }
.grid { position: absolute; inset: 0; background-image: radial-gradient(rgba(255, 255, 255, 0.07) 1.5px, transparent 1.5px); background-size: 48px 48px; }
.scene { position: absolute; inset: 0; opacity: 0; }
i[data-icon] { display: inline-flex; }
i[data-icon] svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.logo { position: absolute; top: 44px; left: 64px; font-size: 34px; font-weight: 700; letter-spacing: -0.5px; opacity: 0; z-index: 5; }
.logo .slash, .title .slash { color: var(--muted); font-weight: 300; }
.dot { display: inline-block; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); margin-right: 14px; box-shadow: 0 0 28px var(--accent); vertical-align: 4px; }

.caption { position: absolute; left: 50%; bottom: 48px; transform: translateX(-50%); width: max-content; max-width: 1500px; padding: 14px 30px; border-radius: 16px; background: rgba(4, 6, 14, 0.7); font-size: 36px; line-height: 1.35; text-align: center; opacity: 0; z-index: 10; }

/* intro */
.hero { position: absolute; top: 330px; left: 0; right: 0; text-align: center; }
.title { font-size: 150px; font-weight: 800; letter-spacing: -5px; line-height: 1; }
.title .slash { font-size: 76px; letter-spacing: -1px; }
.subtitle { margin-top: 28px; font-size: 46px; color: var(--muted); }
.cards { position: absolute; top: 360px; left: 0; right: 0; display: flex; justify-content: center; gap: 48px; }
.card { width: 430px; height: 290px; border-radius: 30px; background: var(--card); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; font-size: 38px; opacity: 0; }
.card i { width: 104px; height: 104px; color: var(--accent); }
.late { position: absolute; top: 300px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 24px; font-size: 64px; font-weight: 700; color: var(--amber); opacity: 0; }
.clock { width: 170px; height: 170px; fill: none; stroke: var(--amber); stroke-width: 6; stroke-linecap: round; }
.question { position: absolute; top: 690px; left: 0; right: 0; text-align: center; font-size: 72px; font-weight: 800; letter-spacing: -1px; color: var(--accent); opacity: 0; }

/* flow */
.details { position: absolute; top: 130px; left: 0; right: 0; height: 400px; }
.detail { position: absolute; left: 50%; top: 0; width: 1000px; height: 400px; margin-left: -500px; display: flex; align-items: center; justify-content: center; gap: 40px; opacity: 0; }
.code { width: 900px; padding: 34px 40px; border-radius: 22px; background: rgba(0, 0, 0, 0.45); border: 1px solid var(--line); font: 30px/1.55 "Cascadia Code", Consolas, monospace; white-space: pre; }
.code .file { color: var(--muted); }
.code .add { color: #86efac; }
.code .ctx { color: var(--muted); }
.window { width: 900px; border-radius: 18px; overflow: hidden; border: 1px solid var(--line); background: #f8f9fc; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45); }
.window .bar { height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 18px; background: #e7e9f2; color: #5c6378; font-size: 20px; }
.window .bar b { width: 14px; height: 14px; border-radius: 50%; background: #c7cad6; }
.window .bar span { margin-left: 16px; padding: 4px 16px; border-radius: 10px; background: #fff; }
.page { position: relative; padding: 26px 34px 30px; color: #1c2033; }
.page h3 { font-size: 34px; margin-bottom: 16px; }
.toolbar { position: relative; display: inline-block; margin-bottom: 18px; }
.toolbar .btn { display: inline-block; padding: 10px 22px; border-radius: 10px; background: #4f46e5; color: #fff; font-size: 24px; }
.ring { position: absolute; inset: -12px; border: 5px solid var(--amber); border-radius: 18px; box-shadow: 0 0 24px rgba(251, 191, 36, 0.6); opacity: 0; }
.rows i { display: block; height: 30px; margin-top: 12px; border-radius: 8px; background: #e7e9f2; }
.checks { list-style: none; display: grid; gap: 22px; font-size: 40px; }
.checks li { display: flex; align-items: center; gap: 22px; padding: 18px 32px; border-radius: 18px; background: var(--card); border: 1px solid var(--line); opacity: 0; }
.checks li i { width: 44px; height: 44px; color: var(--teal); }
.wave { display: flex; align-items: center; gap: 12px; height: 220px; }
.wave i { width: 16px; height: 200px; border-radius: 8px; background: linear-gradient(var(--accent), var(--teal)); transform-origin: 50% 50%; }
.langs { font-size: 54px; font-weight: 800; color: var(--teal); }
.tile { width: 420px; height: 300px; border-radius: 28px; background: var(--card); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; font-size: 40px; }
.tile i { width: 110px; height: 110px; color: var(--teal); }
.links { position: absolute; inset: 0; width: 1920px; height: 1080px; }
.links path { stroke: var(--line); stroke-width: 6; stroke-linecap: round; fill: none; stroke-dasharray: 186; stroke-dashoffset: 186; }
.nodes { position: absolute; top: 600px; left: 120px; width: 1680px; display: grid; grid-template-columns: repeat(5, 336px); }
.node { display: flex; flex-direction: column; align-items: center; gap: 22px; font-size: 34px; color: var(--muted); opacity: 0; }
.node i { width: 140px; height: 140px; padding: 34px; border-radius: 50%; background: var(--card); border: 2px solid var(--line); color: var(--muted); }
.node.on { color: var(--text); }

/* safety */
.headline { position: absolute; top: 150px; left: 0; right: 0; text-align: center; font-size: 70px; font-weight: 800; letter-spacing: -1px; opacity: 0; }
.shield { position: absolute; top: 330px; left: 300px; width: 330px; height: 330px; color: var(--teal); opacity: 0; }
.shield i { width: 100%; height: 100%; }
.safety-items { position: absolute; top: 340px; left: 780px; display: grid; gap: 70px; }
.item { position: relative; display: flex; align-items: center; gap: 34px; font-size: 38px; opacity: 0; }
.fake-btn { position: relative; padding: 18px 40px; border-radius: 14px; background: #4f46e5; font-size: 40px; }
.item .ring { left: -12px; top: -12px; width: 198px; height: 104px; inset: auto; opacity: 0; }
.note { color: var(--amber); }
.request code { padding: 16px 28px; border-radius: 14px; background: rgba(0, 0, 0, 0.45); border: 1px solid var(--line); font: 34px "Cascadia Code", Consolas, monospace; }
.strike { position: absolute; left: -8px; top: 50%; width: 0; height: 6px; background: var(--red); border-radius: 3px; }
.badge { padding: 10px 24px; border-radius: 999px; background: rgba(248, 113, 113, 0.16); color: var(--red); font-weight: 700; }

/* modes */
.modes { position: absolute; top: 210px; left: 0; right: 0; display: flex; justify-content: center; gap: 60px; }
.mode { width: 700px; height: 400px; border-radius: 32px; background: var(--card); border: 1px solid var(--line); padding: 44px; display: flex; flex-direction: column; gap: 14px; opacity: 0; }
.mode i { width: 84px; height: 84px; color: var(--accent); }
.mode h3 { font-size: 48px; }
.mode p { font-size: 32px; color: var(--muted); }
.mode code { margin-top: auto; padding: 16px 22px; border-radius: 14px; background: rgba(0, 0, 0, 0.45); font: 30px "Cascadia Code", Consolas, monospace; color: var(--teal); }
.panel-shot { position: absolute; top: 96px; left: 50%; width: 1100px; margin-left: -550px; border-radius: 22px; border: 1px solid var(--line); box-shadow: 0 40px 100px rgba(0, 0, 0, 0.55); opacity: 0; }
.chips { position: absolute; top: 818px; left: 0; right: 0; display: flex; justify-content: center; gap: 20px; }
.chips span { padding: 12px 28px; border-radius: 999px; background: var(--card); border: 1px solid var(--line); font-size: 30px; opacity: 0; }
.chips .free { color: var(--teal); }

/* demo */
.demo-head { position: absolute; top: 330px; left: 0; right: 0; text-align: center; }
.demo-head h2 { font-size: 86px; font-weight: 800; letter-spacing: -2px; }
.demo-head p { margin-top: 20px; font-size: 38px; color: var(--muted); }
.window.big { position: absolute; top: 34px; left: 240px; width: 1440px; background: #000; opacity: 0; }
.window.big .clip { display: block; width: 1440px; height: 810px; background: #000; }

/* outro */
#s-outro .title { position: absolute; top: 300px; left: 0; right: 0; text-align: center; }
.tagline { position: absolute; top: 500px; left: 0; right: 0; text-align: center; font-size: 50px; color: var(--muted); opacity: 0; }
.url { position: absolute; top: 590px; left: 0; right: 0; text-align: center; font-size: 62px; font-weight: 700; color: var(--accent); opacity: 0; }
#s-outro .chips { top: 720px; }
```

`video/video.js`:
```js
/* global gsap */
// The whole video is one paused GSAP timeline: render.mjs seeks it frame by frame, so nothing depends on real time.
const lang = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "es";

const TEXT = {
  es: {
    subtitle: "Onboarding narrado para cada funcionalidad nueva",
    video: "Grabar un video", manual: "Escribir un manual", oneOnOne: "Explicar uno por uno",
    late: "Siempre llega tarde", question: "¿Y si la explicación se generara sola?",
    diff: "diff de git", explore: "explora tu app", script: "guion verificado", voice: "voz ES · EN", output: "guía + video",
    s1: "Abre el filtro", s2: "Elige el rango de fechas", s3: "Agrupa por semana",
    reports: "Reportes", filterBtn: "Filtrar por fecha", inApp: "Guía en tu app", mp4: "Video MP4",
    safety: "Nada se guarda en tu app", save: "Guardar", pointed: "Se señala, no se pulsa", blocked: "bloqueada",
    plugin: "Plugin de Claude Code", pluginSub: "Con tu propia cuenta de Claude", api: "API key de Claude", apiSub: "Con tu clave de Anthropic",
    free: "gratis", own: "Comando propio",
    demoTitle: "La app de ejemplo", demoSub: "Guía escrita por Claude Code con explicame · grabada por explicame",
    open: "Código abierto · MIT",
  },
  en: {
    subtitle: "Narrated onboarding for every new feature",
    video: "Record a video", manual: "Write a manual", oneOnOne: "Explain it one by one",
    late: "Always too late", question: "What if the explanation wrote itself?",
    diff: "git diff", explore: "explores your app", script: "verified script", voice: "voice ES · EN", output: "guide + video",
    s1: "Open the filter", s2: "Pick the date range", s3: "Group by week",
    reports: "Reports", filterBtn: "Filter by date", inApp: "Guide in your app", mp4: "MP4 video",
    safety: "Nothing is saved to your app", save: "Save", pointed: "Pointed at, never clicked", blocked: "blocked",
    plugin: "Claude Code plugin", pluginSub: "With your own Claude account", api: "Claude API key", apiSub: "With your Anthropic key",
    free: "free", own: "Your own command",
    demoTitle: "The demo app", demoSub: "Guide written by Claude Code with explicame · recorded by explicame",
    open: "Open source · MIT",
  },
}[lang];

const ICONS = {
  camera: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5M9 13h8M9 17h6"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3.5 3-6 6-6s6 2.5 6 6M14 20c0-2.5 1.5-4.5 4-4.5s4 2 4 4.5"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/></svg>',
  browser: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/><circle cx="12" cy="15" r="2.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3L17 9"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z"/></svg>',
  ring: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="12" height="7" rx="2"/><rect x="1" y="5" width="16" height="11" rx="4" stroke-dasharray="3 2"/><path d="M15 15l5 5M17 20h3v-3"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 01-12 0zM12 17v5"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></svg>',
};

for (const node of document.querySelectorAll("[data-t]")) node.textContent = TEXT[node.dataset.t];
for (const node of document.querySelectorAll("[data-icon]")) node.innerHTML = ICONS[node.dataset.icon];
const wave = document.querySelector(".wave");
for (let i = 0; i < 24; i++) wave.append(document.createElement("i"));

const tl = gsap.timeline({ paused: true });
let captions = [];
let clip = null;

const show = (target, at, from = { opacity: 0, y: 40 }, duration = 0.7) =>
  tl.fromTo(target, from, { opacity: 1, x: 0, y: 0, scale: 1, duration, ease: "power3.out" }, at);
const hide = (target, at, duration = 0.45) => tl.to(target, { opacity: 0, duration, ease: "power2.in" }, at);
const span = (chunk) => chunk.end - chunk.start;

const builders = {
  intro(s) {
    const [c1, c2] = s.chunks;
    tl.set("#s-intro", { opacity: 1 }, s.start);
    show("#s-intro .title", s.start + 0.05, { opacity: 0, y: 70, scale: 0.94 }, 0.9);
    show("#s-intro .subtitle", s.start + 0.45);
    tl.to("#s-intro .hero", { y: -240, scale: 0.62, duration: 0.8, ease: "power3.inOut" }, c1.start + 1.2);
    show("#logo", c1.start + 1.6, { opacity: 0, x: -24 }, 0.6);
    tl.to("#s-intro .hero", { opacity: 0, duration: 0.5 }, c1.start + 1.7);
    tl.fromTo("#s-intro .card", { opacity: 0, y: 70 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.2, ease: "back.out(1.4)" }, c1.start + 1.9);
    tl.to("#s-intro .card", { opacity: 0, y: -40, duration: 0.5, stagger: 0.08, ease: "power2.in" }, c2.start - 0.1);
    show("#s-intro .late", c2.start + 0.35, { opacity: 0, scale: 0.85 });
    tl.fromTo("#s-intro .hand", { rotation: 0 }, { rotation: 720, svgOrigin: "60 60", duration: 2.4, ease: "power1.inOut" }, c2.start + 0.35);
    show("#s-intro .question", c2.start + Math.min(2.3, span(c2) * 0.42), { opacity: 0, y: 30 }, 0.8);
    hide("#s-intro", s.end - 0.45);
  },

  flow(s) {
    const [c3, c4, c5] = s.chunks;
    tl.set("#s-flow", { opacity: 1 }, s.start);
    tl.fromTo("#s-flow .node", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.12, ease: "power3.out" }, s.start + 0.1);
    const moments = [c3.start, c3.start + span(c3) * 0.45, c4.start, c4.start + span(c4) * 0.62, c5.start];
    const details = ["#d-diff", "#d-browser", "#d-script", "#d-voice", "#d-output"];
    moments.forEach((at, i) => {
      const node = `#s-flow .node:nth-child(${i + 1})`;
      tl.to(`${node} i`, { borderColor: "#8b85ff", color: "#eef0f8", backgroundColor: "rgba(139,133,255,0.22)", scale: 1.08, duration: 0.4, ease: "back.out(2)" }, at);
      tl.to(node, { color: "#eef0f8", duration: 0.3 }, at);
      if (i > 0) tl.to(`#s-flow .links path:nth-child(${i})`, { strokeDashoffset: 0, stroke: "#8b85ff", duration: 0.5, ease: "power2.out" }, at - 0.3);
      if (i > 0) hide(details[i - 1], at - 0.05, 0.3);
      show(details[i], at + 0.15, { opacity: 0, y: 30, scale: 0.97 }, 0.55);
    });
    tl.fromTo("#d-browser .ring", { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, moments[1] + 0.9);
    tl.fromTo("#d-script li", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.45, stagger: 0.45, ease: "power3.out" }, moments[2] + 0.4);
    tl.fromTo(".wave i", { scaleY: 0.2 }, { scaleY: 1, duration: 0.32, ease: "sine.inOut", repeat: 9, yoyo: true, stagger: { each: 0.05, from: "center" } }, moments[3] + 0.2);
    tl.fromTo("#d-output .tile", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.25, ease: "back.out(1.6)" }, moments[4] + 0.25);
    hide("#s-flow", s.end - 0.45);
  },

  safety(s) {
    const [c6] = s.chunks;
    tl.set("#s-safety", { opacity: 1 }, s.start);
    show("#s-safety .headline", s.start + 0.05);
    show("#s-safety .shield", s.start + 0.3, { opacity: 0, scale: 0.6 }, 0.8);
    show("#s-safety .item:nth-child(1)", c6.start + span(c6) * 0.2, { opacity: 0, x: 60 });
    tl.fromTo("#s-safety .item:nth-child(1) .ring", { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, c6.start + span(c6) * 0.28);
    show("#s-safety .item:nth-child(2)", c6.start + span(c6) * 0.55, { opacity: 0, x: 60 });
    tl.to("#s-safety .strike", { width: "calc(100% - 210px)", duration: 0.45, ease: "power2.out" }, c6.start + span(c6) * 0.66);
    hide("#s-safety", s.end - 0.45);
  },

  modes(s) {
    const [c7, c8] = s.chunks;
    tl.set("#s-modes", { opacity: 1 }, s.start);
    tl.fromTo("#s-modes .mode", { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.35, ease: "power3.out" }, c7.start + 0.2);
    tl.to("#s-modes .mode", { opacity: 0, y: -60, scale: 0.9, duration: 0.5, ease: "power2.in" }, c8.start - 0.1);
    show("#s-modes .panel-shot", c8.start + 0.25, { opacity: 0, y: 80, scale: 0.94 }, 0.9);
    tl.fromTo("#s-modes .chips span", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.18, ease: "back.out(1.8)" }, c8.start + span(c8) * 0.45);
    hide("#s-modes", s.end - 0.45);
  },

  demo(s) {
    tl.set("#s-demo", { opacity: 1 }, s.start);
    show("#s-demo .demo-head", s.start + 0.1);
    tl.to("#s-demo .demo-head", { opacity: 0, y: -40, duration: 0.45 }, s.clip.start - 0.7);
    show("#s-demo .window.big", s.clip.start - 0.5, { opacity: 0, scale: 0.92 }, 0.6);
    hide("#s-demo", s.end - 0.45);
  },

  outro(s) {
    tl.set("#s-outro", { opacity: 1 }, s.start);
    tl.to("#logo", { opacity: 0, duration: 0.4 }, s.start);
    show("#s-outro .title", s.start + 0.1, { opacity: 0, y: 60, scale: 0.94 }, 0.9);
    show("#s-outro .tagline", s.start + 0.7);
    show("#s-outro .url", s.start + 1.1, { opacity: 0, scale: 0.9 });
    tl.fromTo("#s-outro .chips span", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.15, ease: "back.out(1.8)" }, s.start + 1.6);
    tl.to("#stage", { opacity: 0, duration: 0.6 }, s.end - 0.6);
  },
};

/** Builds the timeline from render.mjs's timing and loads the clip; resolves with the total duration. */
window.__setup = async (timing) => {
  document.querySelector(".panel-shot").src = timing.panel;
  for (const scene of timing.scenes) {
    builders[scene.id](scene);
    captions.push(...scene.chunks.map((chunk) => ({ start: chunk.start, end: chunk.end + 0.25, text: chunk.text })));
    if (scene.clip) {
      const el = document.querySelector(".clip");
      el.src = scene.clip.src;
      await new Promise((resolve, reject) => {
        el.addEventListener("loadeddata", resolve, { once: true });
        el.addEventListener("error", () => reject(new Error(`cannot load ${scene.clip.src}`)), { once: true });
      });
      clip = { el, start: scene.clip.start, duration: scene.clip.duration };
      captions.push(...scene.clip.cues);
    }
  }
  tl.set({}, {}, timing.duration);
  await document.fonts.ready;
  return tl.duration();
};

/** Shows exactly time t: timeline, clip frame and caption. */
window.__seek = async (t) => {
  tl.seek(t, false);
  const caption = captions.find((c) => t >= c.start && t < c.end);
  const box = document.getElementById("caption");
  box.textContent = caption ? caption.text : "";
  box.style.opacity = caption ? "1" : "0";
  if (clip) {
    const local = Math.min(Math.max(t - clip.start, 0), clip.duration - 0.04);
    if (Math.abs(clip.el.currentTime - local) > 0.001) {
      await new Promise((resolve) => {
        clip.el.addEventListener("seeked", resolve, { once: true });
        clip.el.currentTime = local;
      });
    }
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
```

- [ ] **Step 4: Las capturas para el video y el README**

`video/shots.mjs`:
```js
// Real screenshots for the video and the README: the panel and the demo app with its guide button.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = fileURLToPath(new URL("./assets/", import.meta.url));
const images = `${root}docs/images/`;
mkdirSync(assets, { recursive: true });
mkdirSync(images, { recursive: true });

function startPanel() {
  const child = spawn(process.execPath, [`${root}packages/cli/dist/bin.js`, "panel", "--no-open", "--port", "0"], {
    cwd: `${root}examples/demo-app`,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
      const match = /(http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/.exec(text);
      if (match) resolve({ url: match[1], stop: () => child.kill() });
    });
    child.on("exit", () => reject(new Error(`the panel exited: ${text}`)));
  });
}

const panel = await startPanel();
const browser = await chromium.launch();
try {
  for (const lang of ["es", "en"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", deviceScaleFactor: 1.5 });
    await page.goto(panel.url);
    await page.getByRole("button", { name: lang.toUpperCase(), exact: true }).click();
    await page.screenshot({ path: `${assets}panel.${lang}.png` });
    await page.close();
  }
  const light = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await light.goto(panel.url);
  await light.screenshot({ path: `${images}panel.png` });
  await light.close();
} finally {
  await browser.close();
  panel.stop();
}
console.log("shots ready: video/assets/panel.{es,en}.png, docs/images/panel.png");
```

- [ ] **Step 5: El renderizador**

`video/render.mjs`:
```js
// Renders video/out/explicame.<lang>.mp4: narration through explicame's own voice pipeline, the clip recorded by
// explicame on the demo app, frames captured one by one from the GSAP timeline, and the mix with ffmpeg.
//   npm run video -- [--lang es|en|all] [--voice piper|elevenlabs]
// ElevenLabs v4 needs ELEVENLABS_API_KEY, EXPLICAME_VIDEO_VOICE_ES and EXPLICAME_VIDEO_VOICE_EN; otherwise Piper.
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { chromium } from "playwright";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cli = join(root, "packages", "cli", "dist", "bin.js");
const { values } = parseArgs({
  options: {
    lang: { type: "string", default: "all" },
    voice: { type: "string" },
    fps: { type: "string", default: "30" },
    demo: { type: "string", default: join(root, "examples", "demo-app") },
  },
});
const langs = values.lang === "all" ? ["es", "en"] : [values.lang];
const fps = Number(values.fps);
const out = join(here, "out");
const script = JSON.parse(await readFile(join(here, "script.json"), "utf8"));
const elevenReady = Boolean(process.env.ELEVENLABS_API_KEY && process.env.EXPLICAME_VIDEO_VOICE_ES && process.env.EXPLICAME_VIDEO_VOICE_EN);
const voiceProvider = values.voice ?? (elevenReady ? "elevenlabs" : "piper");
if (voiceProvider === "elevenlabs" && !elevenReady) {
  throw new Error("ElevenLabs needs ELEVENLABS_API_KEY, EXPLICAME_VIDEO_VOICE_ES and EXPLICAME_VIDEO_VOICE_EN.");
}

const LEAD = 0.35;
const GAP = 0.45;
const PAD = 0.7;
const MIN = { intro: 9, flow: 14, safety: 6, modes: 9, demo: 2, outro: 6.5 };

async function seconds(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
}

/** Every chunk of the script becomes a narration-only step of a throwaway guide, voiced by `explicame voice`. */
async function narrate() {
  const project = await mkdtemp(join(tmpdir(), "explicame-video-"));
  const chunks = script.scenes.flatMap((scene) => scene.chunks);
  const voice =
    voiceProvider === "elevenlabs"
      ? { provider: "elevenlabs", model: "eleven_v4", voices: { es: process.env.EXPLICAME_VIDEO_VOICE_ES, en: process.env.EXPLICAME_VIDEO_VOICE_EN } }
      : { provider: "piper" };
  await writeFile(join(project, "explicame.config.json"), JSON.stringify({ languages: ["es", "en"], voice }));
  const dir = join(project, "public", "explicame", "video");
  await mkdir(dir, { recursive: true });
  const guide = {
    schemaVersion: 1, id: "video", languages: ["es", "en"], title: { es: "Video", en: "Video" }, startUrl: "/",
    steps: chunks.map((chunk) => ({ narration: { es: chunk.es, en: chunk.en } })),
    source: { base: "video", head: "video", commit: "video", generatedBy: "fake", createdAt: new Date().toISOString() },
  };
  await writeFile(join(dir, "guide.json"), JSON.stringify(guide));
  await run(process.execPath, [cli, "voice", "public/explicame/video/guide.json"], { cwd: project, maxBuffer: 16 * 1024 * 1024 });
  const voiced = JSON.parse(await readFile(join(dir, "guide.json"), "utf8"));
  for (const [i, step] of voiced.steps.entries()) {
    for (const lang of langs) if (!step.audio?.[lang]) throw new Error(`No ${lang} audio for chunk ${i + 1}: check the ${voiceProvider} voice.`);
  }
  return { dir, steps: voiced.steps };
}

function parseSrt(text) {
  const time = (value) => {
    const [h, m, rest] = value.split(":");
    const [s, ms] = rest.split(",");
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  return text
    .replace(/\r/g, "")
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const [index, range, ...lines] = block.split("\n");
      const [from, to] = range.split(" --> ");
      return { index: Number(index), start: time(from), end: time(to), text: lines.join(" ") };
    });
}

/** The demo clip recorded by explicame, cut before step `untilStep`: a VP8 copy for Chromium and its audio. */
async function prepareClip(lang) {
  const base = join(values.demo, ".explicame", "videos", `${script.clip.guide}.${lang}`);
  if (!existsSync(`${base}.mp4`)) throw new Error(`Missing ${base}.mp4: record the demo guide first (video/README.md).`);
  const cues = parseSrt(await readFile(`${base}.srt`, "utf8"));
  const until = cues.find((cue) => cue.index === script.clip.untilStep)?.start ?? (await seconds(`${base}.mp4`));
  const duration = Math.max(1, until - 0.25);
  await mkdir(join(here, "assets"), { recursive: true });
  const webm = join(here, "assets", `clip.${lang}.webm`);
  const wav = join(here, "assets", `clip.${lang}.wav`);
  await run("ffmpeg", ["-y", "-v", "error", "-i", `${base}.mp4`, "-t", String(duration), "-an", "-c:v", "libvpx", "-b:v", "6M", "-deadline", "realtime", "-cpu-used", "8", webm]);
  await run("ffmpeg", ["-y", "-v", "error", "-i", `${base}.mp4`, "-t", String(duration), "-vn", "-ac", "2", "-ar", "48000", wav]);
  return {
    src: `assets/clip.${lang}.webm`,
    wav,
    duration,
    cues: cues.filter((cue) => cue.start < duration).map((cue) => ({ start: cue.start, end: Math.min(cue.end, duration), text: cue.text })),
  };
}

async function timing(lang, narration, clip) {
  let t = 0;
  let k = 0;
  const scenes = [];
  for (const scene of script.scenes) {
    const start = t;
    let cursor = start + LEAD;
    const chunks = [];
    for (const chunk of scene.chunks) {
      const file = join(narration.dir, narration.steps[k].audio[lang]);
      const duration = await seconds(file);
      chunks.push({ start: cursor, end: cursor + duration, text: chunk[lang], file });
      cursor += duration + GAP;
      k += 1;
    }
    let end = Math.max(cursor - GAP + PAD, start + MIN[scene.id]);
    let sceneClip = null;
    if (scene.id === "demo") {
      const clipStart = end + 0.2;
      sceneClip = {
        src: clip.src,
        start: clipStart,
        duration: clip.duration,
        cues: clip.cues.map((cue) => ({ start: cue.start + clipStart, end: cue.end + clipStart, text: cue.text })),
      };
      end = clipStart + clip.duration + 0.9;
    }
    scenes.push({ id: scene.id, start, end, chunks, clip: sceneClip });
    t = end;
  }
  const flow = scenes.find((scene) => scene.id === "flow");
  return { lang, duration: t, scenes, panel: `assets/panel.${lang}.png`, poster: flow.chunks[2].start + 1.4 };
}

async function frames(plan, file) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${pathToFileURL(join(here, "index.html")).href}?lang=${plan.lang}`);
    const duration = await page.evaluate((p) => window.__setup(p), plan);
    const ffmpeg = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", file], { stdio: ["pipe", "inherit", "inherit"] });
    const closed = new Promise((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
    const total = Math.ceil(duration * fps);
    for (let i = 0; i < total; i++) {
      await page.evaluate((t) => window.__seek(t), i / fps);
      const jpeg = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
      if (i % (fps * 10) === 0) console.log(`${plan.lang}: ${Math.round((i / total) * 100)}%`);
    }
    ffmpeg.stdin.end();
    await closed;
    await page.evaluate((t) => window.__seek(t), plan.poster);
    await page.screenshot({ path: join(out, `poster.${plan.lang}.png`) });
  } finally {
    await browser.close();
  }
}

async function mix(plan, video, clipWav, file) {
  const inputs = [];
  const delays = [];
  for (const scene of plan.scenes) {
    for (const chunk of scene.chunks) {
      inputs.push(chunk.file);
      delays.push(chunk.start);
    }
    if (scene.clip) {
      inputs.push(clipWav);
      delays.push(scene.clip.start);
    }
  }
  const parts = inputs.map((_, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(delays[i] * 1000)}:all=1[a${i}]`);
  const graph = `${parts.join(";")};${inputs.map((_, i) => `[a${i}]`).join("")}amix=inputs=${inputs.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5,apad[aout]`;
  const args = ["-y", "-v", "error", "-i", video];
  for (const input of inputs) args.push("-i", input);
  args.push("-filter_complex", graph, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", file);
  await run("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
}

await mkdir(out, { recursive: true });
console.log(`narration: ${voiceProvider}`);
const narration = await narrate();
for (const lang of langs) {
  const clip = await prepareClip(lang);
  const plan = await timing(lang, narration, clip);
  const silent = join(out, `.frames.${lang}.mp4`);
  await frames(plan, silent);
  const file = join(out, `explicame.${lang}.mp4`);
  await mix(plan, silent, clip.wav, file);
  await rm(silent, { force: true });
  console.log(`ready: ${file} (${(await seconds(file)).toFixed(1)} s)`);
}
```

`video/README.md`:
```markdown
# Video explicativo · Explainer video

**ES** · El video de explicame lo hace explicame: la narración pasa por `explicame voice`, el clip es una
grabación de `explicame record` y `render.mjs` captura cuadro a cuadro (30 fps) la línea de tiempo GSAP de
`index.html`.

1. `npm run build` en la raíz.
2. Graba la guía de la app de ejemplo (servida en http://localhost:5173), en `examples/demo-app`:
   `node ../../packages/cli/dist/bin.js build --from-guide public/explicame/filtrar-reportes-por-fecha/guide.json --video`
3. `npm run video` (o `npm run video -- --lang es`). Los MP4 quedan en `video/out/`.

Narración con ElevenLabs v4: define `ELEVENLABS_API_KEY`, `EXPLICAME_VIDEO_VOICE_ES` y `EXPLICAME_VIDEO_VOICE_EN`
antes del paso 3. Sin ellas se usa Piper, gratis y local.

**EN** · explicame makes its own video: the narration goes through `explicame voice`, the clip is an
`explicame record` recording, and `render.mjs` captures the GSAP timeline in `index.html` frame by frame (30 fps).
Steps as above; set `ELEVENLABS_API_KEY`, `EXPLICAME_VIDEO_VOICE_ES` and `EXPLICAME_VIDEO_VOICE_EN` for
ElevenLabs v4 narration, otherwise Piper is used.
```

- [ ] **Step 6: Renderizar y revisar**

Con la app de ejemplo servida en `:5173` y los clips de la Tarea 1:

Run: `npm run video`
Expected: `video/out/explicame.es.mp4` y `explicame.en.mp4` de 90 a 120 s (ffprobe), H.264 + AAC, 1920×1080, y sus pósters. Revisar a ojo 8 cuadros por idioma (uno por escena y el clip) leyéndolos como imagen; cualquier texto cortado, solapado o fuera de cuadro se corrige en `video.css`/`video.js` y se vuelve a renderizar. Renderizar dos veces el mismo cuadro y comparar los bytes del JPEG (Review Focus 4).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore video docs/images
git commit -m "feat(video): video explicativo ES/EN hecho con explicame, GSAP y ffmpeg"
```

---

### Task 3: README, CHANGELOG y CONTRIBUTING

**Files:**
- Modify: `README.md`, `plugin/README.md`
- Create: `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/images/video.es.png`, `docs/images/video.en.png` (pósters del video)

**Interfaces:**
- Consumes: todo lo anterior; las URL de los adjuntos de la release (`https://github.com/Egtorres14/explicame/releases/download/v0.1.0/explicame.<lang>.mp4`).
- Produces: la documentación pública de la v0.1.0.

- [ ] **Step 1: Copiar los pósters**

Run: `cp video/out/poster.es.png docs/images/video.es.png && cp video/out/poster.en.png docs/images/video.en.png`

- [ ] **Step 2: Escribir los documentos**

`README.md`, `CHANGELOG.md` y `CONTRIBUTING.md`: el texto completo va en los archivos de esta tarea (ver Step 3). Requisitos que cada uno cumple:
- README bilingüe (ES primero, EN después): póster que enlaza al MP4 de la release en cada idioma; qué hace; inicio rápido en 3 comandos; los dos modos (plugin y API key) con enlace a `plugin/README.md`; el panel con su captura; tabla de voces (costo, clave, notas: voces por defecto de Piper y sus licencias, macOS sin Piper); integrar el reproductor (la línea y las opciones `navigate`, `button`, `allowRequests`, `onBlockedRequest`, `zIndex`); comandos (`build`, `verify`, `voice`, `record`, `login`, `panel`, `mcp`) con sus opciones principales; configuración (`explicame.config.json` de ejemplo); seguridad (qué se bloquea; qué no: WebSocket, `sendBeacon`, `<form>` nativo; dónde viven las claves; el token del panel); requisitos (Node ≥ 20, Chromium de Playwright, ffmpeg, runtime de Visual C++ para Piper en Windows); preguntas frecuentes; licencia.
- CHANGELOG con la entrada `0.1.0 — 2026-10-01`.
- CONTRIBUTING: preparación, pruebas (`npm test`, `npm run typecheck`, `npm run build`), pruebas en vivo opcionales (Piper con `EXPLICAME_LIVE_PIPER=1`, modo API con `ANTHROPIC_API_KEY` sobre la app de ejemplo, plugin con `claude -p --plugin-dir ./plugin`), y estilo de commits.

- [ ] **Step 3: Verificar lo que promete el README**

Run: para cada comando del README, `node packages/cli/dist/bin.js <comando> --help`; y el inicio rápido completo en un clon limpio en una carpeta temporal (`git clone . <tmp>`, `npm install`, `npm run build`, `npx playwright install chromium`).
Expected: todos los comandos existen con las opciones que nombra el README; el clon limpio construye sin pasos extra.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md CONTRIBUTING.md plugin/README.md docs/images
git commit -m "docs: README bilingüe completo, CHANGELOG y guía para contribuir"
```

---

### Task 4: Publicación de la v0.1.0

**Files:** ninguno nuevo (merge, etiqueta y release).

- [ ] **Step 1: Todo en verde en la rama**

Run: `npm test && npm run typecheck && npm run build` y `gh run list --branch feat/v0.1 --limit 1`
Expected: verde local y CI en verde.

- [ ] **Step 2: Merge a main**

```bash
git checkout main
git pull --ff-only
git merge --no-ff feat/v0.1 -m "explicame v0.1.0"
git push origin main
```

Expected: CI en verde sobre `main` (`gh run list --branch main --limit 1`).

- [ ] **Step 3: Etiqueta y release con los videos**

```bash
git tag -a v0.1.0 -m "explicame v0.1.0"
git push origin v0.1.0
gh release create v0.1.0 video/out/explicame.es.mp4 video/out/explicame.en.mp4 --title "explicame v0.1.0" --notes-file <notas de la 0.1.0 tomadas del CHANGELOG>
```

Expected: la release existe con los dos MP4 y las URL del README responden 200 (`curl -sIL`).

- [ ] **Step 4: Comprobar el README publicado**

Run: `gh repo view Egtorres14/explicame --web` no hace falta; basta con `curl -sL https://raw.githubusercontent.com/Egtorres14/explicame/main/README.md | head` y un `curl -sIL` a cada imagen y video que enlaza.
Expected: todo responde 200.
