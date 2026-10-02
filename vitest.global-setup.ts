import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Builds the player, the panel, the CLI binary and the demo app once, before the test files run in parallel:
 * several of them need those dist/ folders, and every build empties its own.
 */
export default function setup(): void {
  const cwd = fileURLToPath(new URL("./", import.meta.url));
  execSync("npm run build", { cwd, stdio: "pipe" });
  execSync("npm run build -w demo-app", { cwd, stdio: "pipe" });
}
