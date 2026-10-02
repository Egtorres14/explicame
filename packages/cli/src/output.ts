import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateGuide, type Guide, type Lang, type LocalizedText } from "@explicame/core";

export interface GuideIndexEntry {
  id: string;
  title: LocalizedText;
  startUrl: string;
  languages: Lang[];
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "guia";
}

export async function readGuide(path: string): Promise<Guide> {
  const result = validateGuide(JSON.parse(await readFile(path, "utf8")));
  if (!result.ok) throw new Error(`${path}: ${result.errors.join("; ")}`);
  return result.guide;
}

/** Writes <root>/<id>/guide.json and upserts <root>/guides.json (sorted by id). Returns the guide folder. */
export async function writeGuide(outputRoot: string, guide: Guide): Promise<string> {
  const dir = join(outputRoot, guide.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "guide.json"), `${JSON.stringify(guide, null, 2)}\n`);
  const indexPath = join(outputRoot, "guides.json");
  let index: GuideIndexEntry[] = [];
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as GuideIndexEntry[];
  } catch {
    index = [];
  }
  const entry: GuideIndexEntry = { id: guide.id, title: guide.title, startUrl: guide.startUrl, languages: guide.languages };
  index = [...index.filter((g) => g.id !== guide.id), entry].sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return dir;
}
