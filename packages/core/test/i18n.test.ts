import { describe, expect, it } from "vitest";
import { MESSAGES, t } from "../src/i18n.js";

describe("t", () => {
  it("fills parameters in each language", () => {
    expect(t("es", "app.unreachable", { url: "http://localhost:5173" })).toBe("No pude abrir http://localhost:5173: ¿está corriendo la app?");
    expect(t("en", "app.unreachable", { url: "http://localhost:5173" })).toBe("I couldn't open http://localhost:5173: is the app running?");
  });
  it("leaves unknown placeholders visible", () => {
    expect(t("en", "tool.stepLimit")).toContain("{max}");
  });
  it("has the same keys in both languages", () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.es).sort());
  });
});
