import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Builds the player bundle and the CLI binary once, before the test files run in parallel:
 * several of them need dist/, and tsup empties it on every build.
 */
export default function setup(): void {
  execSync("npm run build", { cwd: fileURLToPath(new URL("./", import.meta.url)), stdio: "pipe" });
}
