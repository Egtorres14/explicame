// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DOM_RUNTIME } from "../src/domRuntime.js";

function install(html: string) {
  document.body.innerHTML = html;
  window.__explicame = undefined;
  window.__explicameNoLayout = true; // jsdom has no layout: every rendered element counts as visible
  new Function(DOM_RUNTIME)();
  return window.__explicame!;
}
const q = (selector: string) => document.querySelector(selector)!;

describe("roles and names", () => {
  it("approximates ARIA roles and accessible names", () => {
    const rt = install(`
      <button>Filtrar</button>
      <a href="/x">Ayuda</a>
      <label for="d">Desde</label><input id="d" type="date">
      <input placeholder="Buscar" id="s">
      <button aria-label="Cerrar" id="c">×</button>
      <label>Agrupar por <select id="g"><option>Día</option><option>Semana</option></select></label>`);
    expect([rt.roleOf(q("button")), rt.nameOf(q("button"))]).toEqual(["button", "Filtrar"]);
    expect([rt.roleOf(q("a")), rt.nameOf(q("a"))]).toEqual(["link", "Ayuda"]);
    expect([rt.roleOf(q("#d")), rt.nameOf(q("#d")), rt.labelOf(q("#d"))]).toEqual(["textbox", "Desde", "Desde"]);
    expect(rt.nameOf(q("#s"))).toBe("Buscar");
    expect(rt.nameOf(q("#c"))).toBe("Cerrar");
    expect([rt.roleOf(q("#g")), rt.nameOf(q("#g")), rt.labelOf(q("#g"))]).toEqual(["combobox", "Agrupar por", "Agrupar por"]);
  });
});

describe("selectors", () => {
  it("prefers data-testid and keeps only unique strategies", () => {
    const rt = install(`
      <button data-testid="f">Filtrar</button>
      <section><button>Exportar</button></section>
      <section><button>Exportar</button></section>`);
    expect(rt.uniqueStrategies(q("[data-testid=f]"))[0]).toEqual({ by: "testid", value: "f" });

    const second = document.querySelectorAll("section button")[1]!;
    const strategies = rt.uniqueStrategies(second);
    expect(strategies.some((s) => s.by === "role" || s.by === "text")).toBe(false);
    expect(strategies.at(-1)).toEqual({ by: "css", value: "body > section:nth-of-type(2) > button" });
    expect(rt.resolve(strategies)).toBe(second);
  });

  it("returns null when nothing matches and survives invalid CSS", () => {
    const rt = install(`<button>Filtrar</button>`);
    expect(rt.resolve([{ by: "testid", value: "nope" }])).toBeNull();
    expect(rt.matchAll({ by: "css", value: ")(" })).toEqual([]);
  });
});

describe("observe", () => {
  it("marks visible elements in document order and skips hidden or closed content", () => {
    const rt = install(`
      <h1>Reportes</h1>
      <button>Filtrar</button>
      <div hidden><button>Oculto</button></div>
      <dialog><button>Dentro</button></dialog>`);
    const obs = rt.observe();
    expect(obs.elements.map((e) => e.name)).toEqual(["Reportes", "Filtrar"]);
    expect(q("button").getAttribute("data-explicame-id")).toBe("e2");
    expect(rt.byId("e2")).toBe(q("button"));
    expect(obs.truncated).toBe(false);
  });

  it("describes elements for the safety rules", () => {
    const rt = install(`<form><button>Guardar</button></form>`);
    expect(rt.describe(q("button"))).toEqual({ tag: "button", type: "submit", role: "button", name: "Guardar", inForm: true });
  });
});
