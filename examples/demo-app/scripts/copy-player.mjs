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
