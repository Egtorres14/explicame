import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { t, type Lang } from "@explicame/core";
import { ConfigError } from "./config.js";

const run = promisify(execFile);
const UI_FILE = /\.(tsx|jsx|vue|svelte|html|astro)$|(^|\/)(routes?|pages|app|components)\//;

export interface ChangeContext {
  base: string;
  head: string;
  commit: string;
  diff: string;
  files: { path: string; content: string }[];
  description?: string;
  omittedFiles: string[];
}

export interface ChangeOptions {
  cwd: string;
  base: string;
  head: string;
  diffFile?: string;
  files?: string[];
  description?: string;
  maxChars?: number;
  lang: Lang;
}

export function splitDiff(diff: string): { path: string; text: string }[] {
  return diff
    .split(/^(?=diff --git )/m)
    .filter((part) => part.trim())
    .map((text) => ({ path: /^diff --git a\/(.+?) b\/(.+)$/m.exec(text)?.[2] ?? "unknown", text }));
}

export function fitDiff(diff: string, maxChars: number): { text: string; omitted: string[] } {
  if (diff.length <= maxChars) return { text: diff, omitted: [] };
  const parts = splitDiff(diff).sort((a, b) => Number(UI_FILE.test(b.path)) - Number(UI_FILE.test(a.path)));
  const kept: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const part of parts) {
    if (used + part.text.length <= maxChars) {
      kept.push(part.text);
      used += part.text.length;
    } else {
      omitted.push(part.path);
    }
  }
  return { text: kept.join(""), omitted };
}

export async function getChangeContext(o: ChangeOptions): Promise<ChangeContext> {
  let diff: string;
  let commit: string;
  let base = o.base;
  let head = o.head;
  if (o.diffFile) {
    diff = await readFile(resolve(o.cwd, o.diffFile), "utf8");
    commit = "patch";
    base = "patch";
    head = basename(o.diffFile);
  } else {
    diff = (await run("git", ["diff", "--no-color", `${o.base}...${o.head}`], { cwd: o.cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
    commit = (await run("git", ["rev-parse", "--short", o.head], { cwd: o.cwd })).stdout.trim();
  }
  if (!diff.trim()) throw new ConfigError(t(o.lang, "diff.empty", { base: o.base, head: o.head }));
  const { text, omitted } = fitDiff(diff, o.maxChars ?? 60_000);
  const files = await Promise.all(
    (o.files ?? []).map(async (path) => ({ path, content: await readFile(resolve(o.cwd, path), "utf8") })),
  );
  return { base, head, commit, diff: text, files, description: o.description, omittedFiles: omitted };
}
