import { describe, expect, it } from "vitest";
import { checkClickSafety, globMatch, isDestructiveName, isRequestAllowed } from "../src/safety.js";

describe("isDestructiveName", () => {
  it("detects destructive words in Spanish and English, with or without accents", () => {
    expect(isDestructiveName("Guardar cambios")).toBe(true);
    expect(isDestructiveName("ELIMINAR")).toBe(true);
    expect(isDestructiveName("Confirmar pedido")).toBe(true);
    expect(isDestructiveName("Save draft")).toBe(true);
    expect(isDestructiveName("Publish now")).toBe(true);
  });
  it("does not flag words that only contain a destructive word", () => {
    expect(isDestructiveName("Guardados")).toBe(false);
    expect(isDestructiveName("Enviados")).toBe(false);
    expect(isDestructiveName("Filtrar")).toBe(false);
  });
});

describe("checkClickSafety", () => {
  it("blocks submit buttons inside forms", () => {
    expect(checkClickSafety({ tag: "button", type: "submit", role: "button", name: "Aplicar", inForm: true })).toEqual({ ok: false, reason: "submit" });
    expect(checkClickSafety({ tag: "input", type: "submit", role: "button", name: "Ir", inForm: false })).toEqual({ ok: false, reason: "submit" });
  });
  it("blocks destructive names even on plain buttons", () => {
    expect(checkClickSafety({ tag: "button", type: "button", role: "button", name: "Guardar como predeterminado", inForm: true })).toEqual({ ok: false, reason: "destructive" });
  });
  it("allows ordinary buttons and links", () => {
    expect(checkClickSafety({ tag: "button", type: "button", role: "button", name: "Filtrar", inForm: true })).toEqual({ ok: true });
    expect(checkClickSafety({ tag: "a", role: "link", name: "Ayuda", inForm: false })).toEqual({ ok: true });
  });
});

describe("isRequestAllowed", () => {
  it("allows safe methods and blocks writes by default", () => {
    expect(isRequestAllowed("GET", "http://app.test/api/x")).toBe(true);
    expect(isRequestAllowed("options", "http://app.test/api/x")).toBe(true);
    expect(isRequestAllowed("POST", "http://app.test/api/x")).toBe(false);
    expect(isRequestAllowed("DELETE", "http://app.test/api/x")).toBe(false);
  });
  it("lets through exactly the allow-listed method and path", () => {
    const allow = [{ method: "POST", url: "/graphql*" }];
    expect(isRequestAllowed("POST", "http://app.test/graphql?op=q", allow)).toBe(true);
    expect(isRequestAllowed("PUT", "http://app.test/graphql", allow)).toBe(false);
    expect(isRequestAllowed("POST", "http://app.test/api/graphql", allow)).toBe(false);
  });
  it("matches full URLs when the rule starts with http", () => {
    expect(isRequestAllowed("POST", "https://api.other.test/search", [{ method: "POST", url: "https://api.other.test/*" }])).toBe(true);
  });
  it("globMatch escapes regex characters", () => {
    expect(globMatch("/a.b/*", "/a.b/c")).toBe(true);
    expect(globMatch("/a.b/*", "/aXb/c")).toBe(false);
  });
});
