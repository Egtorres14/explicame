# Contribuir · Contributing

**ES** · ¡Gracias por ayudar! Puedes escribir issues y PR en español o en inglés.

**EN** · Thanks for helping! Issues and pull requests are welcome in Spanish or English.

## Preparación · Setup

```bash
git clone https://github.com/Egtorres14/explicame && cd explicame
npm install
npx playwright install chromium
npm run build
```

Necesitas Node.js 20+, Git y ffmpeg (para el MP4, Piper y el comando propio).
You need Node.js 20+, Git and ffmpeg (for the MP4, Piper and the command voice).

## Estructura · Layout

| Carpeta · Folder | Qué hay · What lives there |
|---|---|
| `packages/core` | Formato del guion (Zod), reglas de seguridad, herramientas del bucle, prompts, i18n, runtime DOM. |
| `packages/cli` | Los binarios `explicame`/`explain-me`: navegador, generación, verificación, voces, grabación, servidor MCP y panel. |
| `packages/player` | El reproductor embebible (IIFE `window.Explicame` y ESM). |
| `packages/panel` | La interfaz del panel (TypeScript sin framework, Vite). |
| `plugin/` | El plugin de Claude Code; `.claude-plugin/marketplace.json` en la raíz lo publica. |
| `examples/demo-app` | La app de ejemplo con su guía. |
| `video/` | El video explicativo (`npm run video`). |
| `docs/superpowers/` | El diseño (spec) y los planes de implementación. |

## Pruebas · Tests

```bash
npm test            # Vitest + Playwright, sin claves ni red · no keys, no network
npm run typecheck
npm run build
```

La preparación global de Vitest construye una vez el reproductor, el panel, la CLI y la app de ejemplo. Las
pruebas usan una IA y una voz falsas (`FakeLlmDriver`, `FakeVoiceProvider`), así que CI no necesita secretos.

Vitest's global setup builds the player, the panel, the CLI and the demo app once. Tests use a scripted AI and
silent voices, so CI needs no secrets.

### Pruebas en vivo opcionales · Optional live checks

- **Piper real** (descarga ~120 MB la primera vez · downloads ~120 MB the first time):
  `EXPLICAME_LIVE_PIPER=1 npx vitest run packages/cli/test/piper.live.test.ts`
  (usa `EXPLICAME_HOME=<carpeta temporal>` para no tocar `~/.explicame`).
- **Modo API** sobre la app de ejemplo (`npm run dev -w demo-app` en otra terminal), con `ANTHROPIC_API_KEY`:
  en `examples/demo-app`, `explicame build --diff-file feature.patch` (con `"mode": "api"` en su config).
- **Plugin de Claude Code**, con la app de ejemplo corriendo y la CLI enlazada (o `EXPLICAME_CLI`):
  `claude -p "Usa la skill explicame…" --plugin-dir ../../plugin` desde `examples/demo-app`, o instálalo con
  `/plugin marketplace add <ruta al repo>`. Valida los manifiestos con `claude plugin validate ./plugin`.

## Estilo · Style

- TypeScript estricto, ESM con imports `.js`, sin dependencias nuevas sin motivo.
- Identificadores en inglés; textos para personas en ES y EN por `t()` (CLI) o `ui()`/`t()` (reproductor y panel).
- Cada cambio de comportamiento trae su prueba, escrita antes del código (TDD).
- Commits en español con prefijo: `feat(ámbito): …`, `fix(ámbito): …`, `docs: …`, `test: …`.
- Nada de secretos en archivos del repo: las claves van en variables de entorno o en `~/.explicame/credentials.json`.

## Seguridad · Security

Si encuentras un fallo de seguridad (por ejemplo, una forma de que explicame escriba datos en la app o de que el
panel filtre una clave), abre un issue sin detalles de explotación y pide un canal privado.

If you find a security issue (for example, a way for explicame to write data to the app or for the panel to leak
a key), open an issue without exploit details and ask for a private channel.
