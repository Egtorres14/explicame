import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeReport(dir: string, data: unknown): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, "report.json");
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

/** Synchronous variant for the SIGINT handler, where awaiting is not possible. */
export function writeReportSync(dir: string, data: unknown): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "report.json");
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}
