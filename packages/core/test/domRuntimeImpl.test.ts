// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { installDomRuntime } from "@explicame/core/runtime";
import { DOM_RUNTIME } from "../src/domRuntime.js";

describe("installDomRuntime", () => {
  it("installs the runtime without eval", () => {
    document.body.innerHTML = `<button>Filtrar</button>`;
    window.__explicame = undefined;
    window.__explicameNoLayout = true;
    installDomRuntime();
    expect(window.__explicame!.observe().elements.map((e) => e.name)).toEqual(["Filtrar"]);
  });

  it("DOM_RUNTIME is the same function, self-contained and free of bundler helpers", () => {
    expect(DOM_RUNTIME.startsWith("(function installDomRuntime(")).toBe(true);
    expect(DOM_RUNTIME.endsWith(")();")).toBe(true);
    expect(DOM_RUNTIME).not.toContain("__name");
    expect(DOM_RUNTIME).not.toMatch(/\brequire\(|\bimport\b/);
  });
});
