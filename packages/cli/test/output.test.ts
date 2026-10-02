import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Guide } from "@explicame/core";
import { readGuide, slugify, writeGuide } from "../src/output.js";

const guide = (id: string): Guide => ({
  schemaVersion: 1, id, languages: ["es"], title: { es: `Guía ${id}` }, startUrl: "/",
  steps: [{ narration: { es: "Paso." } }],
  source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
});

describe("writeGuide", () => {
  it("writes guide.json and keeps the index sorted without duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "explicame-out-"));
    await writeGuide(root, guide("zeta"));
    await writeGuide(root, guide("alfa"));
    const dir = await writeGuide(root, { ...guide("zeta"), title: { es: "Zeta nueva" } });
    expect(dir).toBe(join(root, "zeta"));
    const index = JSON.parse(await readFile(join(root, "guides.json"), "utf8")) as { id: string; title: { es: string } }[];
    expect(index.map((g) => g.id)).toEqual(["alfa", "zeta"]);
    expect(index[1]!.title.es).toBe("Zeta nueva");
    expect((await readGuide(join(root, "zeta", "guide.json"))).title.es).toBe("Zeta nueva");
  });

  it("slugifies titles with accents", () => {
    expect(slugify("Nuevo filtro por fecha")).toBe("nuevo-filtro-por-fecha");
    expect(slugify("¡Exportación rápida!")).toBe("exportacion-rapida");
    expect(slugify("???")).toBe("guia");
  });
});
