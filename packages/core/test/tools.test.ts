import { describe, expect, it } from "vitest";
import { buildTools, parseToolCall, toAction } from "../src/tools.js";

const step = (narration: Record<string, string>) => ({
  narration, element_id: "e3", action: "click", value: null, url: null, opens: "dialog",
});

describe("buildTools", () => {
  it("defines the four loop tools with one narration field per language", () => {
    const tools = buildTools(["es", "en"]);
    expect(tools.map((t) => t.name)).toEqual(["observe", "act", "add_step", "finish"]);
    const addStep = tools.find((t) => t.name === "add_step")!;
    const narration = (addStep.input_schema.properties as Record<string, { required: string[] }>).narration!;
    expect(narration.required).toEqual(["es", "en"]);
    const single = buildTools(["es"]).find((t) => t.name === "add_step")!;
    expect((single.input_schema.properties as Record<string, { required: string[] }>).narration!.required).toEqual(["es"]);
  });
});

describe("parseToolCall", () => {
  it("parses add_step into camelCase", () => {
    const parsed = parseToolCall("add_step", step({ es: "Abre el filtro.", en: "Open the filter." }), ["es", "en"]);
    expect(parsed).toEqual({
      ok: true,
      call: { name: "add_step", narration: { es: "Abre el filtro.", en: "Open the filter." }, elementId: "e3", action: "click", value: null, url: null, opens: "dialog" },
    });
  });
  it("rejects a narration missing an active language", () => {
    const parsed = parseToolCall("add_step", step({ es: "Solo español." }), ["es", "en"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("narration.en");
  });
  it("rejects narrations longer than 300 characters and unknown tools", () => {
    expect(parseToolCall("add_step", step({ es: "a".repeat(301), en: "ok" }), ["es", "en"]).ok).toBe(false);
    expect(parseToolCall("delete_everything", {}, ["es"]).ok).toBe(false);
  });
  it("parses observe, act and finish", () => {
    expect(parseToolCall("observe", {}, ["es"])).toEqual({ ok: true, call: { name: "observe" } });
    expect(parseToolCall("act", { element_id: null, action: "navigate", value: null, url: "/ayuda" }, ["es"]).ok).toBe(true);
    expect(parseToolCall("finish", { title: { es: "Filtro" } }, ["es"])).toEqual({ ok: true, call: { name: "finish", title: { es: "Filtro" } } });
  });
});

describe("toAction", () => {
  it("builds guide actions and explains what is missing", () => {
    expect(toAction("click", null, null)).toEqual({ ok: true, action: { type: "click" } });
    expect(toAction("type", "2026-09-01", null)).toEqual({ ok: true, action: { type: "type", value: "2026-09-01" } });
    expect(toAction("select", null, null).ok).toBe(false);
    expect(toAction("navigate", null, "/ayuda")).toEqual({ ok: true, action: { type: "navigate", url: "/ayuda" } });
    expect(toAction("navigate", null, "https://otro.sitio").ok).toBe(false);
    expect(toAction("navigate", null, "//evil.example/x").ok).toBe(false);
  });
});
