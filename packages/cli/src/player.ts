import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

export const PLAYER_FILE = "explicame-player.js";

export function playerBundlePath(): string {
  return createRequire(import.meta.url).resolve("@explicame/player/explicame-player.js");
}

/** Copies the player next to the guides, so the app serves both from the same folder. */
export async function copyPlayer(outputRoot: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  const target = join(outputRoot, PLAYER_FILE);
  await copyFile(playerBundlePath(), target);
  return target;
}
