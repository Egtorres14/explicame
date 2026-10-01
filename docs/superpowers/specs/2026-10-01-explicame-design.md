# explicame / explain-me — Diseño v1

**Fecha:** 2026-10-01 · **Estado:** aprobado por secciones en conversación; pendiente de revisión escrita.

## 1. Contexto y objetivo

Cada funcionalidad nueva de una app web obliga a alguien a explicarla: grabar un video, escribir un
manual, sentarse con cada usuario. En una plataforma de operaciones en producción construida por el autor existe una base de esto, la función
«¿Cómo funciona?»: guiones de pasos escritos a mano que recorren la pantalla real, señalan cada
elemento con un anillo, narran con voz pregenerada y simulan acciones sin guardar nada.

**explicame** convierte esa idea en una herramienta de código abierto, escrita desde cero (sin
código de esa plataforma), que **genera el guion sola a partir del cambio en el código**:

> diff de git → la IA explora la app real → guion bilingüe → voz → guía interactiva + video MP4

**Criterios de éxito de la v1**

1. Sobre la app de ejemplo, `explicame build` produce de punta a punta una guía verificada, su
   audio en ES y EN, y un MP4 por idioma, sin intervención manual.
2. Funciona en los dos modos: plugin de Claude Code (cuenta del usuario) y API key de Claude.
3. Cualquier app web puede integrar el reproductor con una línea, sin tocar su código de otra forma.
4. Nada de lo que hace la herramienta escribe datos en la app (generación, verificación,
   grabación ni reproducción).
5. Las pruebas corren sin claves ni red (IA y voz falsas) y pasan en CI.
6. Repo público con README bilingüe y el video explicativo en MP4.

**Fuera de alcance en la v1:** panel multiusuario o alojado, publicación en npm (se hará cuando el
autor lo decida), apps nativas móviles, proveedores de IA distintos de Claude (la interfaz queda
lista para agregarlos), automatización por PR (GitHub Action: fase siguiente).

## 2. Arquitectura

Monorepo TypeScript (Node ≥ 20), npm workspaces, licencia MIT. Identificadores de código en inglés;
textos de interfaz en ES/EN.

| Pieza | Responsabilidad | Depende de |
|---|---|---|
| `packages/core` | Formato del guion (Zod), mapa de elementos, estrategia de selectores, reglas de seguridad, definición de las herramientas del bucle, construcción de prompts, i18n. Puro, sin red ni navegador. | zod |
| `packages/cli` | Binarios `explicame` y `explain-me`. Navegador (Playwright), bucle de generación en modo API, verificación, voz, grabación, servidor MCP, servidor del panel, configuración y credenciales. | core, playwright, @anthropic-ai/sdk, @modelcontextprotocol/sdk, ffmpeg del sistema |
| `packages/player` | Reproductor embebible: anillo, rótulo, voz, controles, acciones simuladas, bloqueo de escrituras, modo grabación. Sin dependencias en tiempo de ejecución. | core (solo tipos) |
| `packages/panel` | Interfaz web local bilingüe (TS sin framework), servida por la CLI. | core (tipos) |
| `plugin/` | Plugin de Claude Code: manifiesto, comando `/explicame`, skill con las instrucciones del bucle, configuración del servidor MCP (`explicame mcp`). | cli |
| `examples/demo-app` | App de ejemplo (Vite, TS) con la funcionalidad nueva aplicada y su `feature.patch`. | — |
| `video/` | Fuente del video explicativo (HTML + GSAP con reloj exacto) y su renderizador a MP4. | playwright, ffmpeg |

Builds con tsup (ESM; el reproductor además en IIFE con el global `Explicame`). Pruebas con Vitest y
Playwright.

## 3. Flujo de generación

Comando principal: `explicame build`. Etapas (cada una es también un comando suelto):

1. **Contexto del cambio** (`core` + `cli`).
   - Por defecto `git diff <base>...<head>` con `base = main`, `head = HEAD`; o `--diff-file x.patch`.
   - Opcionales: `--files` (rutas extra para dar contexto) y `--describe "…"`.
   - Si el diff supera ~60 000 caracteres, se priorizan archivos de interfaz (`.tsx`, `.jsx`, `.vue`,
     `.svelte`, `.html`, rutas) y se avisa al usuario de qué quedó fuera.
2. **Plan.** La IA resume qué hace la funcionalidad y por qué pantallas pasa, en los idiomas activos.
3. **Bucle de exploración** (máximo configurable, por defecto 15 pasos):
   - `observe`: la CLI devuelve el **mapa de elementos** de la página actual (ver §5) y la URL.
   - La IA llama a `add_step` con la narración (todos los idiomas activos), el `elementId` del mapa
     (o ninguno, para pasos solo narrados) y la acción (`click`, `type`, `select`, `navigate`, o
     ninguna). Si la acción no es segura, se rechaza con el motivo (ver §6).
   - La CLI ejecuta la acción, espera a que la página se estabilice y vuelve a observar. Así aparecen
     ventanas, menús y pantallas que solo existen después de un clic.
   - La CLI —no la IA— calcula el selector multiestrategia del elemento elegido (§5).
   - `finish` cierra el bucle con el título del guion.
4. **Verificación** (`explicame verify`). Se reproduce el guion completo desde `startUrl` en un
   navegador limpio. Cada paso con objetivo debe resolver a exactamente un elemento visible y su
   acción debe completarse. Si un paso falla, la IA recibe el error y el mapa actual y tiene **un**
   intento de reparar ese paso; si vuelve a fallar, el build termina con código 1 y un reporte con la
   captura del paso.
5. **Voz** (`explicame voice`). Un audio por paso y por idioma, con caché (§9).
6. **Grabación** (`explicame record`). Un MP4 y un `.srt` por idioma (§8).

**Herramientas del bucle** (mismas definiciones en los dos modos, declaradas en `core`):
`observe()`, `act(elementId, action, value?)` (exploración libre sin crear paso),
`add_step(narration, elementId?, action?, value?)`, `finish(title)`.
En modo API la CLI las expone a Claude por *tool use*; en modo plugin el servidor MCP las expone a
Claude Code. El navegador vive en el proceso de la CLI o del servidor MCP durante toda la sesión.

**Salidas** (por defecto; configurables):
- `public/explicame/guides.json` — índice de guías (id, título, `startUrl`, idiomas).
- `public/explicame/<id>/guide.json` y `public/explicame/<id>/audio/<lang>/<nn>.mp3` — lo que el
  reproductor sirve junto a la app.
- `.explicame/videos/<id>.<lang>.mp4` y `.srt`, y `.explicame/reports/` (no se sirven; se sugieren
  en `.gitignore`).

## 4. Formato del guion (`guide.json`, schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "id": "filtro-por-fecha",
  "languages": ["es", "en"],
  "title": { "es": "Nuevo filtro por fecha", "en": "New date filter" },
  "startUrl": "/reportes",
  "steps": [
    {
      "narration": { "es": "Aquí eliges el rango…", "en": "Here you pick the range…" },
      "target": { "strategies": [
        { "by": "testid", "value": "filtro-fecha" },
        { "by": "role", "role": "button", "name": "Filtrar" },
        { "by": "css", "value": "#filters > button:nth-of-type(2)" }
      ] },
      "action": { "type": "click" },
      "opens": "dialog",
      "audio": { "es": "audio/es/01.mp3", "en": "audio/en/01.mp3" }
    }
  ],
  "source": { "base": "main", "head": "feature/filtro", "commit": "abc123",
              "generatedBy": "api", "model": "claude-sonnet-5-5", "createdAt": "2026-10-01T18:00:00Z" }
}
```

Reglas (validadas con Zod en `core`):
- `id`: kebab-case, único en el índice. `languages`: subconjunto no vacío de `["es","en"]`.
- Toda `narration` y `title` trae **todos** los idiomas de `languages`; narración ≤ 300 caracteres.
- `target` opcional; si existe, 1 a 6 estrategias en orden de preferencia.
- `action.type ∈ {click, type, select, navigate}`; `type`/`select` requieren `value` (siempre un
  ejemplo); `navigate` requiere `url` del mismo origen.
- `opens ∈ {dialog, menu, mode}` opcional: lo que el paso deja abierto, para cerrarlo al salir.
- `audio` lo rellena la etapa de voz; `source` lo rellena la CLI.

## 5. Mapa de elementos y selectores

**Mapa** (`observe`): elementos interactivos visibles (`button`, `a[href]`, `input`, `select`,
`textarea`, `[role=button|link|tab|menuitem|checkbox|switch|combobox]`, `[contenteditable]`) más
encabezados y regiones con nombre accesible. Por elemento: `id` corto (`e1`, `e2`…), rol, nombre
accesible, etiqueta, placeholder, texto (≤ 80 caracteres), `data-tour`, `data-testid`, si está
deshabilitado, y su caja. Máximo 150 elementos, priorizando los visibles en pantalla.

**Selector multiestrategia** (calculado por la CLI para el elemento elegido), en orden:
`data-tour` → `data-testid` → rol + nombre accesible → etiqueta → texto exacto → CSS mínimo
estable. Solo se guardan estrategias que en ese momento resuelven a **un único** elemento.

**Resolución** (reproductor y verificación): se prueban las estrategias en orden, esperando hasta
5 s a que aparezca el elemento (apps de una sola página). La primera que da un único elemento visible
gana.

## 6. Seguridad: nada se escribe en la app

Tres capas, activas en generación, verificación, grabación y reproducción:

1. **Reglas del guion** (`core`): no se permite `click` sobre botones de envío
   (`type=submit` dentro de un formulario) ni sobre elementos cuyo nombre coincida con la lista de
   acciones destructivas (ES/EN: guardar, enviar, eliminar, borrar, pagar, confirmar, publicar,
   save, submit, send, delete, remove, pay, confirm, publish). Esos elementos solo se **señalan**.
2. **Bloqueo de escrituras en red.** En la CLI, Playwright intercepta y aborta toda petición cuyo
   método no sea GET, HEAD u OPTIONS. En el reproductor, mientras suena una guía, se envuelven
   `fetch` y `XMLHttpRequest` con la misma regla. Excepciones configurables
   (`safety.allowRequests`, p. ej. un `POST /graphql` de solo lectura) y gancho `onBlockedRequest`.
3. **Velo** que impide que el usuario toque la app durante la guía. Al salir: se cierran los pasos
   con `opens` pendientes (Escape y, si no basta, se vuelve a `startUrl`) y se retira el bloqueo.

## 7. El reproductor (`packages/player`)

- Integración: `<script src="/explicame/explicame-player.js"></script>` + `Explicame.mount({ base:
  "/explicame", lang: "es" })`, o `import { mount } from "@explicame/player"`. Opciones:
  `button` (botón flotante «¿Cómo funciona? / How does it work?», por defecto activo), `navigate`
  (función del router de la app para `navigate`), `onBlockedRequest`, `allowRequests`, `zIndex`.
- `Explicame.play(id)`, `Explicame.stop()`, eventos `step`, `end`, `blocked`.
- UI en Shadow DOM: anillo numerado, rótulo, controles (pausa, anterior, siguiente, salir, volumen,
  velocidad, silencio, ES/EN). Teclado: Esc sale, flechas navegan. `aria-live` en el rótulo y
  respeto a `prefers-reduced-motion`.
- Voz: MP3 del paso; si falta, `speechSynthesis` del navegador.
- Elemento ausente: el paso se narra sin anillo y se emite un aviso; nunca lanza errores a la app.
- Modo grabación (`record: true`, lo usa la CLI): cursor animado hacia cada objetivo, espera la
  duración exacta de cada audio y reporta el instante de inicio de cada paso a la CLI.
- Presupuesto: ≤ 25 KB gzip.

## 8. Videos

**Video del recorrido** (`explicame record <id>`), por idioma:
1. Chromium sin ventana a 1920×1080, sesión de la app si hay (§10), bloqueo de escrituras activo.
2. La CLI inyecta el reproductor en modo grabación y graba la pantalla (video de Playwright).
3. Con los instantes de inicio de cada paso, ffmpeg coloca cada audio en su momento, normaliza a
   −16 LUFS y exporta MP4 (H.264 + AAC, 30 fps) y `.srt`.
4. Requiere ffmpeg en el sistema; si falta, error con la instrucción de instalación por SO.

**Video explicativo de explicame** (`video/`, ES y EN, 90–120 s): HTML + GSAP con una línea de
tiempo maestra que se puede posicionar en cualquier instante. `video/render.mjs` captura cuadro a
cuadro (30 fps) con Playwright, mezcla la narración y exporta MP4. Guion:
(1) el problema, (2) el flujo diff → exploración → guion → voz → guía + video, (3) los dos modos,
(4) clips reales grabados por explicame sobre la app de ejemplo, (5) cierre con el enlace al repo.
Narración con ElevenLabs v4.

## 9. Voz

Interfaz `VoiceProvider { id, listVoices(lang), synthesize(text, voice, lang): Promise<Buffer /*mp3*/> }`.

| Proveedor | Costo | Notas |
|---|---|---|
| `elevenlabs` | Pago (nivel gratuito) | Modelo configurable (por defecto `eleven_v4`). Voz clonada de quien capacita solo tras una casilla de consentimiento explícito en el panel. |
| `deepgram` | Pago (créditos iniciales) | Voces Aura. |
| `openai` | Pago | Modelo y voz configurables. |
| `piper` | Gratis, local | La CLI descarga motor y voz (ES/EN) en `~/.explicame/piper/` la primera vez. Voces por defecto: una `es_*` y una `en_US` del catálogo oficial, elegidas en implementación verificando su licencia. |
| `command` | Gratis, local | Plantilla de comando que recibe el texto y escribe un WAV/MP3 (Kokoro, Coqui…). |
| `browser` | Gratis | Solo en el reproductor (no sirve para el MP4). |

- Caché: `~/.explicame/cache/voice/<sha256(proveedor|modelo|voz|idioma|velocidad|texto)>.mp3`.
- Reintentos con espera creciente (3); si falla, se pasa al siguiente proveedor de
  `voice.fallback`. Si ninguno sirve, la guía usa la voz del navegador y `record` falla con un
  mensaje claro.

## 10. Modos de IA, configuración y panel

**Modo plugin (cuenta de Claude):** el repo publica un *marketplace* de Claude Code. El plugin trae
el comando `/explicame`, una skill con las instrucciones del bucle y la configuración del servidor
MCP (`explicame mcp`, stdio). Claude Code del propio usuario lee el diff y llama a las herramientas
del bucle. En este modo, `finish` escribe el `guide.json` y ejecuta la verificación dentro del servidor
MCP: si un paso falla, devuelve el error y el mapa actual a Claude Code, que lo repara con las mismas
herramientas (un intento por paso, igual que en modo API). Después Claude Code ejecuta
`explicame build --from-guide <ruta>`, que hace la voz y la grabación sin usar IA. La estructura exacta del plugin se valida contra
la documentación oficial de Claude Code durante la implementación. No se ofrece «iniciar sesión con
Claude» dentro de la herramienta: Anthropic no lo permite a terceros sin aprobación.

**Modo API key:** `@anthropic-ai/sdk` con *tool use*. Modelo configurable; por defecto
`claude-sonnet-5-5`, con `claude-opus-5-5` como opción. La IA queda tras una interfaz
`LlmDriver` para agregar otros proveedores después. Antes de empezar se muestra un estimado de
tokens y costo.

**Configuración del proyecto** (`explicame.config.json`, sin secretos, versionable):
`appUrl`, `base`, `languages`, `uiLanguage`, `mode`, `model`, `maxSteps`, `voice.provider`,
`voice.voices.{es,en}`, `voice.speed`, `voice.fallback`, `outputDir`, `videoDir`,
`safety.allowRequests`.

**Secretos:** variables de entorno (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`,
`OPENAI_API_KEY`) o `~/.explicame/credentials.json` (solo lectura para el usuario). Nunca dentro del
proyecto; la CLI se niega a leer claves desde `explicame.config.json`.

**Sesión de la app:** `explicame login` abre un navegador visible; el usuario entra una vez y se
guarda el `storageState` en `~/.explicame/sessions/<proyecto>.json`.

**Panel** (`explicame panel`, por defecto puerto 4747): solo escucha en `127.0.0.1`, exige un token
aleatorio por sesión en la URL y en cada petición, y nunca devuelve una clave completa (solo
«configurada ✓» y los últimos 4 caracteres). Secciones: Proyecto (URL, rama base, iniciar sesión en
la app), Idiomas (interfaz y narración), IA (modo, clave, modelo), Voz (proveedor, voz por idioma con
«Probar», clave, velocidad, respaldo), Generar (descripción y archivos opcionales, avance en vivo con
capturas, vista previa de la guía y del video, descarga). La CLI muestra los mismos mensajes en el
idioma de `uiLanguage`.

## 11. Errores y límites

- Mensajes bilingües que dicen qué hacer (p. ej. «No pude abrir http://localhost:5173: ¿está
  corriendo la app?»).
- Límites: `maxSteps` (15 por defecto, tope 40), presupuesto de tokens por sesión, botón y señal
  de parar (Ctrl+C cierra el navegador y deja un reporte parcial).
- Códigos de salida: 0 éxito; 1 verificación fallida; 2 configuración o credenciales; 3 app no
  accesible; 4 proveedor externo caído.

## 12. Pruebas

- **Unitarias (Vitest):** esquema del guion, reglas de seguridad, orden y unicidad de selectores,
  construcción de prompts, caché de voz, configuración y credenciales; reproductor en jsdom
  (resolución de elementos, bloqueo de escrituras, controles, limpieza al salir).
- **De punta a punta (Playwright):** sobre `examples/demo-app` con `FakeLlmDriver` (respuestas
  guionadas) y `FakeVoiceProvider` (silencio de duración proporcional al texto): `build` completo,
  verificación con un paso roto y su reparación, bloqueo real de un POST, grabación con duración y
  subtítulos esperados.
- **CI (GitHub Actions):** lint, typecheck, pruebas y build en cada push, sin claves.
- **Prueba en vivo opcional** con claves reales, manual, documentada en `CONTRIBUTING.md`.

## 13. Publicación

- Repo público `explicame` en la cuenta de GitHub del autor, licencia MIT, commits a su nombre.
- README bilingüe (ES primero, EN después): video, inicio rápido en 3 comandos, los dos modos, tabla
  de voces, modelo de seguridad, preguntas frecuentes. `CONTRIBUTING.md`, `CHANGELOG.md`, release
  `v0.1.0`.
- npm (`npx explicame`) queda para cuando el autor lo decida; mientras tanto se usa clonando el repo.

## 14. Orden de construcción

1. `core`: esquema, reglas de seguridad, herramientas del bucle, i18n.
2. `cli`: navegador, mapa de elementos, selectores, bloqueo de escrituras, ejecutor de acciones.
3. Bucle de generación en modo API con `FakeLlmDriver`, luego con Claude real.
4. Verificación y reparación.
5. Voz: interfaz, caché, Piper y ElevenLabs primero; Deepgram, OpenAI, `command` después.
6. `player` y su integración en la app de ejemplo.
7. Grabación del MP4 y `.srt`.
8. Servidor MCP y plugin de Claude Code.
9. Panel.
10. App de ejemplo completa y pruebas de punta a punta; CI.
11. Video explicativo ES/EN.
12. README, licencia, release y publicación en GitHub.
