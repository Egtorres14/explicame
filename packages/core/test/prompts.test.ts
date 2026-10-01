import { describe, expect, it } from "vitest";
import { initialMessage, repairMessage, systemPrompt } from "../src/prompts.js";

describe("prompts", () => {
  it("system prompt names the languages and the step limit", () => {
    const text = systemPrompt(["es", "en"], 12);
    expect(text).toContain("Spanish (es) and English (en)");
    expect(text).toContain("between 3 and 12 steps");
  });
  it("initial message carries the diff, the description, extra files and omitted files", () => {
    const text = initialMessage({
      languages: ["es"], appUrl: "http://localhost:5173", startUrl: "/reportes", maxSteps: 15,
      diff: "diff --git a/src/filter.ts b/src/filter.ts\n+export {}\n",
      files: [{ path: "src/table.ts", content: "export const x = 1;" }],
      description: "Filtro por fecha en reportes",
      omittedFiles: ["docs/big.md"],
    });
    expect(text).toContain("<diff>\ndiff --git a/src/filter.ts");
    expect(text).toContain("Filtro por fecha en reportes");
    expect(text).toContain('<file path="src/table.ts">');
    expect(text).toContain("docs/big.md");
    expect(text).toContain("http://localhost:5173");
  });
  it("repair message points at the failing step with the current observation", () => {
    const text = repairMessage(1, "target not found", '{"url":"/","title":"x","elements":[],"truncated":false}');
    expect(text).toContain("step 2 failed: target not found");
    expect(text).toContain('\n{"url":"/"');
  });
});
