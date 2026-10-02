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
