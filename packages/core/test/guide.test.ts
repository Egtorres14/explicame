import { describe, expect, it } from "vitest";
import { validateGuide } from "../src/guide.js";

const base = () => ({
  schemaVersion: 1,
  id: "filtro-por-fecha",
  languages: ["es", "en"],
  title: { es: "Nuevo filtro por fecha", en: "New date filter" },
  startUrl: "/reportes",
  steps: [
    {
      narration: { es: "Aquí abres el filtro.", en: "Here you open the filter." },
      target: { strategies: [{ by: "testid", value: "filtro-fecha" }] },
      action: { type: "click" },
      opens: "dialog",
    },
  ],
  source: { base: "main", head: "feature/filtro", commit: "abc1234", generatedBy: "api", createdAt: "2026-10-01T18:00:00.000Z" },
});

describe("validateGuide", () => {
  it("accepts a well-formed guide", () => {
    const result = validateGuide(base());
    expect(result.ok).toBe(true);
  });

  it("requires every active language in narrations and title", () => {
    const g = base();
    g.steps[0]!.narration = { es: "Solo en español." } as typeof g.steps[0]["narration"];
    const result = validateGuide(g);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("steps.0.narration.en");
  });

  it("rejects narrations longer than 300 characters", () => {
    const g = base();
    g.steps[0]!.narration.es = "a".repeat(301);
    expect(validateGuide(g).ok).toBe(false);
  });

  it("rejects an action without a target, except navigate", () => {
    const g = base();
    delete (g.steps[0] as { target?: unknown }).target;
    expect(validateGuide(g).ok).toBe(false);
    g.steps[0]!.action = { type: "navigate", url: "/ayuda" } as unknown as { type: "click" };
    expect(validateGuide(g).ok).toBe(true);
  });

  it("rejects ids that are not kebab-case and external navigation", () => {
    expect(validateGuide({ ...base(), id: "Filtro Fecha" }).ok).toBe(false);
    const g = base();
    g.steps[0]!.action = { type: "navigate", url: "https://otro.sitio" } as unknown as { type: "click" };
    expect(validateGuide(g).ok).toBe(false);
  });
});
