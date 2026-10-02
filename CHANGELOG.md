# Changelog

Todos los cambios notables de explicame se anotan aquí. · All notable changes to explicame are listed here.

## 0.1.0 — 2026-10-01

Primera versión pública. · First public release.

### Generación · Generation
- `explicame build`: diff de git (o `--diff-file`) → la IA explora la app real en Chromium con las herramientas
  `observe`, `act`, `add_step` y `finish` → guion bilingüe (ES/EN) → verificación paso a paso con un intento de
  reparación por paso → voz → guía publicada junto al reproductor.
- Selectores multiestrategia calculados por la CLI (`data-tour`, `data-testid`, rol + nombre, etiqueta, texto,
  CSS estable) y verificados contra la pantalla real.
- Modo API key con `@anthropic-ai/sdk` (por defecto `claude-opus-5-5`, esfuerzo `high`, respaldo automático
  de modelo) y estimado de costo antes de empezar.
- Modo plugin de Claude Code: `explicame mcp` (stdio) expone las mismas herramientas; `finish` verifica y guarda
  la guía, y una caída de la app durante la verificación no la descarta. Marketplace, skill y lanzador en
  `plugin/`. `explicame build --from-guide` pone voz y graba sin IA.
- Seguridad: nunca se pulsan botones de envío ni destructivos; las peticiones que escriben datos se bloquean en
  generación, verificación, grabación y reproducción.

### Reproductor · Player
- `<explicame-player>` en Shadow DOM, sin dependencias (9 KB gzip): anillo, rótulo, voz, controles, teclado,
  velo, bloqueo de `fetch`/XHR, acciones simuladas con la secuencia real de puntero, espera de elementos que
  tardan, aviso cuando falta un elemento, una sola guía a la vez y una sola instancia aunque se cargue dos veces.

### Video · Video
- `explicame record` / `build --video`: MP4 1920×1080 (H.264 + AAC, −16 LUFS) y `.srt` por idioma, también en
  apps con CSP estricta.

### Voz · Voice
- ElevenLabs (`eleven_v4`, clonación con consentimiento), Deepgram Aura-2, OpenAI `gpt-4o-mini-tts`, Piper
  gratis y local (descargas verificadas por SHA-256, voces de licencia limpia), comando propio sin shell y voz
  del navegador. Caché por proveedor, reintentos solo cuando tienen sentido y respaldos con sus propias voces.

### Panel · Panel
- `explicame panel`: panel local bilingüe (127.0.0.1, token por sesión), claves enmascaradas, prueba de voces,
  generación con avance en vivo, capturas, botón Parar, vista previa y descarga.

### Proyecto · Project
- App de ejemplo con el reproductor integrado y una guía real escrita por Claude Code con el plugin.
- Video explicativo ES/EN hecho con explicame (narración, clip grabado y render con GSAP + ffmpeg).
- CI en GitHub Actions (Linux): tipos, pruebas sin claves ni red y build.
