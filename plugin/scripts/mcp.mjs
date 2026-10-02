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
