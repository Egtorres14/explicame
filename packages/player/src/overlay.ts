import type { Lang } from "@explicame/core";
import { ui } from "./i18n.js";

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.button { position: fixed; right: 20px; bottom: 20px; padding: 10px 16px; border: 0; border-radius: 999px; background: #1d1b26; color: #fff; font-size: 14px; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25); pointer-events: auto; }
.button:focus-visible, .controls button:focus-visible, .list button:focus-visible { outline: 2px solid #ff8fb8; outline-offset: 2px; }
.list { position: fixed; right: 20px; bottom: 70px; width: 280px; max-height: 50vh; overflow: auto; padding: 6px; border-radius: 12px; background: #fff; color: #1d1b26; box-shadow: 0 12px 40px rgba(0,0,0,.25); pointer-events: auto; }
.list button { display: block; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: none; color: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.list button:hover { background: #f2eff7; }
.list p { margin: 10px 12px; font-size: 13px; color: #6b6878; }
.veil { position: fixed; inset: 0; background: transparent; pointer-events: auto; }
.ring { position: fixed; border: 3px solid #ff8fb8; border-radius: 10px; box-shadow: 0 0 0 4000px rgba(20,16,30,.28); transition: left .25s ease, top .25s ease, width .25s ease, height .25s ease; pointer-events: none; }
.badge { position: absolute; top: -14px; left: -14px; width: 26px; height: 26px; border-radius: 50%; background: #ff8fb8; color: #2a0716; font: 700 13px/26px system-ui, sans-serif; text-align: center; }
.caption { position: fixed; left: 50%; bottom: 24px; width: min(640px, calc(100vw - 32px)); transform: translateX(-50%); padding: 14px 16px 10px; border-radius: 14px; background: #1d1b26; color: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.3); pointer-events: auto; }
.count { margin-bottom: 4px; font-size: 12px; color: #c9c4d6; }
.text { margin: 0 0 10px; font-size: 16px; line-height: 1.4; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.controls button, .controls select { padding: 6px 10px; border: 0; border-radius: 8px; background: #2d2a38; color: #fff; font-size: 13px; cursor: pointer; }
.controls label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #c9c4d6; }
.controls input[type=range] { width: 80px; }
.cursor { position: fixed; width: 24px; height: 24px; margin: -4px 0 0 -4px; transition: left .6s ease, top .6s ease; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .ring, .cursor { transition: none; } }
`;

const CURSOR_SVG =
  '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M4 2l16 11-7 1.5L9.5 21z" fill="#fff" stroke="#1d1b26" stroke-width="1.5"/></svg>';

export interface StepView {
  n: number;
  total: number;
  text: string;
  lang: Lang;
  languages: Lang[];
  paused: boolean;
  muted: boolean;
  rate: number;
  volume: number;
}

export interface ControlHandlers {
  prev(): void;
  toggle(): void;
  next(): void;
  exit(): void;
  mute(): void;
  rate(value: number): void;
  volume(value: number): void;
  lang(value: Lang): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class Overlay {
  readonly host: HTMLElement;
  private readonly layer: HTMLDivElement;
  private button: HTMLButtonElement | null = null;
  private list: HTMLDivElement | null = null;
  private veilEl: HTMLDivElement | null = null;
  private ringEl: HTMLDivElement | null = null;
  private captionEl: HTMLDivElement | null = null;
  private cursorEl: HTMLDivElement | null = null;

  constructor(zIndex: number) {
    this.host = document.createElement("explicame-player");
    this.host.style.cssText = `position:fixed;inset:0;z-index:${zIndex};pointer-events:none;`;
    const root = this.host.attachShadow({ mode: "open" });
    root.append(el("style", undefined, CSS));
    this.layer = el("div");
    root.append(this.layer);
    document.body.append(this.host);
  }

  showButton(label: string, onClick: () => void): void {
    this.button = el("button", "button", label);
    this.button.type = "button";
    this.button.setAttribute("aria-haspopup", "menu");
    this.button.addEventListener("click", onClick);
    this.layer.append(this.button);
  }

  hideButton(hidden: boolean): void {
    if (this.button) this.button.hidden = hidden;
  }

  isListOpen(): boolean {
    return this.list !== null;
  }

  openList(items: { id: string; title: string }[], emptyText: string, onPick: (id: string) => void): void {
    this.closeList();
    this.list = el("div", "list");
    this.list.setAttribute("role", "menu");
    if (items.length === 0) this.list.append(el("p", undefined, emptyText));
    for (const item of items) {
      const option = el("button", undefined, item.title);
      option.type = "button";
      option.setAttribute("role", "menuitem");
      option.addEventListener("click", () => onPick(item.id));
      this.list.append(option);
    }
    this.layer.append(this.list);
  }

  closeList(): void {
    this.list?.remove();
    this.list = null;
  }

  veil(on: boolean): void {
    if (on && !this.veilEl) {
      this.veilEl = el("div", "veil");
      this.layer.prepend(this.veilEl);
    } else if (!on) {
      this.veilEl?.remove();
      this.veilEl = null;
    }
  }

  ring(rect: DOMRect | null, n: number): void {
    if (!rect) {
      this.ringEl?.remove();
      this.ringEl = null;
      return;
    }
    if (!this.ringEl) {
      this.ringEl = el("div", "ring");
      this.ringEl.append(el("span", "badge"));
      this.layer.append(this.ringEl);
    }
    const pad = 6;
    Object.assign(this.ringEl.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
    this.ringEl.firstElementChild!.textContent = String(n);
  }

  caption(view: StepView, on: ControlHandlers): void {
    this.captionEl?.remove();
    const box = el("div", "caption");
    box.setAttribute("role", "dialog");
    box.append(el("div", "count", ui(view.lang, "step", { n: view.n, total: view.total })));
    const text = el("p", "text", view.text);
    text.setAttribute("aria-live", "polite");
    box.append(text);
    const controls = el("div", "controls");
    const action = (label: string, handler: () => void) => {
      const b = el("button", undefined, label);
      b.type = "button";
      b.addEventListener("click", handler);
      controls.append(b);
    };
    action(ui(view.lang, "prev"), on.prev);
    action(ui(view.lang, view.paused ? "resume" : "pause"), on.toggle);
    action(ui(view.lang, "next"), on.next);
    action(ui(view.lang, view.muted ? "unmute" : "mute"), on.mute);
    const speed = el("select");
    speed.setAttribute("aria-label", ui(view.lang, "speed"));
    for (const value of [0.75, 1, 1.25, 1.5]) {
      const option = el("option", undefined, `${value}×`);
      option.value = String(value);
      option.selected = value === view.rate;
      speed.append(option);
    }
    speed.addEventListener("change", () => on.rate(Number(speed.value)));
    controls.append(speed);
    const volumeLabel = el("label", undefined, ui(view.lang, "volume"));
    const volume = el("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "1";
    volume.step = "0.1";
    volume.value = String(view.volume);
    volume.addEventListener("input", () => on.volume(Number(volume.value)));
    volumeLabel.append(volume);
    controls.append(volumeLabel);
    if (view.languages.length > 1) {
      const language = el("select");
      language.setAttribute("aria-label", ui(view.lang, "language"));
      for (const value of view.languages) {
        const option = el("option", undefined, value.toUpperCase());
        option.value = value;
        option.selected = value === view.lang;
        language.append(option);
      }
      language.addEventListener("change", () => on.lang(language.value as Lang));
      controls.append(language);
    }
    action(ui(view.lang, "exit"), on.exit);
    box.append(controls);
    this.captionEl = box;
    this.layer.append(box);
  }

  hideCaption(): void {
    this.captionEl?.remove();
    this.captionEl = null;
  }

  async moveCursor(x: number, y: number, reduced: boolean): Promise<void> {
    if (!this.cursorEl) {
      this.cursorEl = el("div", "cursor");
      this.cursorEl.innerHTML = CURSOR_SVG;
      Object.assign(this.cursorEl.style, { left: `${window.innerWidth / 2}px`, top: `${window.innerHeight - 80}px` });
      this.layer.append(this.cursorEl);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    Object.assign(this.cursorEl.style, { left: `${x}px`, top: `${y}px` });
    await new Promise((resolve) => setTimeout(resolve, reduced ? 0 : 650));
  }

  hideCursor(): void {
    this.cursorEl?.remove();
    this.cursorEl = null;
  }

  destroy(): void {
    this.host.remove();
  }
}
