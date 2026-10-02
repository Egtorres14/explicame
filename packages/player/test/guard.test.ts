// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWriteGuard } from "../src/guard.js";
import { ui } from "../src/i18n.js";

let restore: (() => void) | undefined;
const realFetch = vi.fn(async () => new Response("{}"));
beforeEach(() => {
  window.fetch = realFetch as unknown as typeof fetch;
  realFetch.mockClear();
});
afterEach(() => restore?.());

describe("installWriteGuard", () => {
  it("lets reads through and rejects writes, reporting them", async () => {
    const onBlocked = vi.fn();
    restore = installWriteGuard({ onBlocked });
    await window.fetch("/api/reports");
    expect(realFetch).toHaveBeenCalledTimes(1);
    await expect(window.fetch("/api/preferences", { method: "POST", body: "{}" })).rejects.toThrow(/blocked/);
    expect(realFetch).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({ method: "POST", url: `${location.origin}/api/preferences` });
  });

  it("respects the allow list and restores fetch afterwards", async () => {
    restore = installWriteGuard({ allow: [{ method: "POST", url: "/graphql" }] });
    await window.fetch("/graphql", { method: "POST" });
    expect(realFetch).toHaveBeenCalledTimes(1);
    restore();
    restore = undefined;
    expect(window.fetch).toBe(realFetch);
  });

  it("keeps blocking until the last guard is removed, in any order", async () => {
    const first = installWriteGuard({});
    const second = installWriteGuard({});
    first();
    await expect(window.fetch("/api/x", { method: "POST" })).rejects.toThrow(/blocked/);
    second();
    expect(window.fetch).toBe(realFetch);
  });

  it("leaves a wrapper the app added meanwhile in place, with the guard turned into a pass-through", async () => {
    const off = installWriteGuard({});
    const guarded = window.fetch;
    const appWrapper = ((input: RequestInfo | URL, init?: RequestInit) => guarded(input, init)) as typeof fetch;
    window.fetch = appWrapper;
    off();
    expect(window.fetch).toBe(appWrapper);
    await window.fetch("/api/x", { method: "POST" });
    expect(realFetch).toHaveBeenCalledTimes(1);
  });

  it("blocks XMLHttpRequest writes with an error event", async () => {
    const onBlocked = vi.fn();
    restore = installWriteGuard({ onBlocked });
    const xhr = new XMLHttpRequest();
    const failed = new Promise((resolve) => xhr.addEventListener("error", resolve));
    xhr.open("DELETE", "/api/item/1");
    xhr.send();
    await failed;
    expect(onBlocked).toHaveBeenCalledWith({ method: "DELETE", url: `${location.origin}/api/item/1` });
  });
});

describe("ui", () => {
  it("has the same texts in both languages and fills parameters", () => {
    expect(ui("es", "howItWorks")).toBe("¿Cómo funciona?");
    expect(ui("en", "howItWorks")).toBe("How does it work?");
    expect(ui("es", "step", { n: 2, total: 6 })).toBe("Paso 2 de 6");
  });
});
