// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Guide } from "@explicame/core";
import * as Explicame from "../src/index.js";
import { defaultNarrator, estimateMs, type Narrator } from "../src/narrator.js";

const instant: Narrator = () => ({ done: Promise.resolve(), stop() {}, pause() {}, resume() {}, update() {} });
/** A narration that only ends when stopped, to drive the controls by hand. */
const held: Narrator = () => {
  let end!: () => void;
  const done = new Promise<void>((resolve) => (end = resolve));
  return { done, stop: () => end(), pause() {}, resume() {}, update() {} };
};

const GUIDE: Guide = {
  schemaVersion: 1, id: "demo", languages: ["es", "en"], title: { es: "Demo", en: "Demo" }, startUrl: "/",
  steps: [
    { narration: { es: "Abre el panel.", en: "Open the panel." }, target: { strategies: [{ by: "testid", value: "abrir" }] }, action: { type: "click" }, opens: "dialog" },
    { narration: { es: "Escribe el nombre.", en: "Type the name." }, target: { strategies: [{ by: "label", value: "Nombre" }] }, action: { type: "type", value: "Ana" } },
    { narration: { es: "Elige el grupo.", en: "Pick the group." }, target: { strategies: [{ by: "label", value: "Grupo" }] }, action: { type: "select", value: "Semana" } },
    { narration: { es: "Listo.", en: "Done." } },
  ],
  source: { base: "a", head: "b", commit: "c", generatedBy: "fake", createdAt: "2026-10-01T00:00:00.000Z" },
};

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.__explicame = undefined;
  window.__explicameNoLayout = true;
  document.body.innerHTML = `
    <button data-testid="abrir">Abrir</button>
    <dialog id="d"><label for="n">Nombre</label><input id="n"><label for="g">Grupo</label><select id="g"><option>Día</option><option>Semana</option></select></dialog>`;
  document.querySelector("[data-testid=abrir]")!.addEventListener("click", () => document.getElementById("d")!.setAttribute("open", ""));
  fetchMock = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith("guides.json") ? json([{ id: "demo", title: GUIDE.title, startUrl: "/", languages: GUIDE.languages }]) : json(GUIDE)));
  window.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => Explicame.unmount());

const shadow = () => document.querySelector("explicame-player")!.shadowRoot!;

describe("mount", () => {
  it("shows the button in the chosen language and lists the guides of this screen", async () => {
    Explicame.mount({ lang: "es" });
    const button = shadow().querySelector<HTMLButtonElement>(".button")!;
    expect(button.textContent).toBe("¿Cómo funciona?");
    button.click();
    await vi.waitFor(() => expect(shadow().querySelector(".list")?.textContent).toContain("Demo"));
  });
});

describe("play", () => {
  it("runs every step: click, typing with input events, selecting, and cleans up", async () => {
    Explicame.mount({ lang: "es", button: false, narrator: instant, typeDelay: 0 });
    const steps: unknown[] = [];
    Explicame.on("step", (e) => steps.push(e.index));
    const inputs: string[] = [];
    document.getElementById("n")!.addEventListener("input", (e) => inputs.push((e.target as HTMLInputElement).value));

    expect(await Explicame.play("demo")).toBe(true);
    expect(steps).toEqual([0, 1, 2, 3]);
    expect((document.getElementById("n") as HTMLInputElement).value).toBe("Ana");
    expect(inputs).toEqual(["Ana"]);
    expect((document.getElementById("g") as HTMLSelectElement).value).toBe("Semana");
    expect(document.getElementById("d")!.hasAttribute("open")).toBe(false);
    expect(shadow().querySelector(".veil")).toBeNull();
    expect(shadow().querySelector(".caption")).toBeNull();
  });

  it("waits for a target that appears later", async () => {
    document.querySelector("[data-testid=abrir]")!.remove();
    setTimeout(() => {
      const late = document.createElement("button");
      late.dataset.testid = "abrir";
      late.textContent = "Abrir";
      late.addEventListener("click", () => document.getElementById("d")!.setAttribute("open", ""));
      document.body.prepend(late);
    }, 300);
    Explicame.mount({ lang: "es", button: false, narrator: instant, typeDelay: 0 });
    expect(await Explicame.play("demo")).toBe(true);
    expect((document.getElementById("g") as HTMLSelectElement).value).toBe("Semana");
  });

  it("narrates without a ring when a target never appears", async () => {
    document.body.innerHTML = "";
    Explicame.mount({ lang: "en", button: false, narrator: instant, resolveTimeoutMs: 100 });
    expect(await Explicame.play("demo")).toBe(true);
  });

  it("Escape stops, ArrowRight skips, and fetch is restored", async () => {
    Explicame.mount({ lang: "es", button: false, narrator: held, typeDelay: 0 });
    const steps: unknown[] = [];
    Explicame.on("step", (e) => steps.push(e.index));
    const playing = Explicame.play("demo");
    await vi.waitFor(() => expect(shadow().querySelector(".caption")).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await vi.waitFor(() => expect(steps).toEqual([0, 1]));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await playing).toBe(false);
    expect(window.fetch).toBe(fetchMock);
  });

  it("blocks write requests while a guide plays", async () => {
    const onBlockedRequest = vi.fn();
    Explicame.mount({ lang: "es", button: false, narrator: held, onBlockedRequest });
    const playing = Explicame.play("demo");
    await vi.waitFor(() => expect(shadow().querySelector(".veil")).not.toBeNull());
    await expect(window.fetch("/api/preferences", { method: "POST" })).rejects.toThrow(/blocked/);
    expect(onBlockedRequest).toHaveBeenCalledWith(expect.objectContaining({ method: "POST" }));
    Explicame.stop();
    expect(await playing).toBe(false);
  });
});

describe("defaultNarrator", () => {
  it("falls back to a timer when the audio cannot play", async () => {
    vi.useFakeTimers();
    try {
      let ended = false;
      const narration = defaultNarrator("Hola mundo", "es", "/no-existe.mp3", { muted: false, rate: 1, volume: 1 });
      void narration.done.then(() => (ended = true));
      await vi.advanceTimersByTimeAsync(estimateMs("Hola mundo") + 10);
      expect(ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
