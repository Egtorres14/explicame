import type { Guide, Lang, Step } from "@explicame/core";
import type { AllowRule } from "@explicame/core/safety";
import { performStepAction } from "./actions.js";
import { installWriteGuard, type BlockedInfo } from "./guard.js";
import type { Narration, Narrator } from "./narrator.js";
import type { Overlay } from "./overlay.js";

export interface RunOptions {
  guide: Guide;
  base: string;
  lang: Lang;
  overlay: Overlay;
  narrator: Narrator;
  navigate?: (url: string) => void | Promise<void>;
  allow?: AllowRule[];
  onBlocked?: (info: BlockedInfo) => void;
  emit: (event: "step" | "end" | "missing", payload: Record<string, unknown>) => void;
  record: boolean;
  typeDelay: number;
  resolveTimeoutMs: number;
  pauseAfterActionMs: number;
}

type RecordHook = (event: { type: "narration" | "end"; index?: number; lang?: Lang }) => void;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const frame = (cb: () => void): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number);
const cancelFrame = (id: number) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));

export class GuideRun {
  private index = 0;
  private jump: number | null = null;
  private stopped = false;
  private paused = false;
  private waiters: (() => void)[] = [];
  private narration: Narration | null = null;
  private readonly performed = new Set<number>();
  private opened = 0;
  private target: Element | null = null;
  private frameId = 0;
  private muted = false;
  private rate = 1;
  private volume = 1;
  private lang: Lang;
  private restoreGuard: (() => void) | null = null;
  private readonly reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);
  private readonly o: RunOptions;
  private readonly resolveDone: () => void;
  /** Resolves once the run has given back the veil, the write guard and the overlay. */
  readonly done: Promise<void>;

  constructor(options: RunOptions) {
    this.o = options;
    this.lang = options.lang;
    let resolve!: () => void;
    this.done = new Promise<void>((r) => (resolve = r));
    this.resolveDone = resolve;
  }

  async start(): Promise<boolean> {
    this.restoreGuard = installWriteGuard({ allow: this.o.allow, onBlocked: this.o.onBlocked });
    this.o.overlay.veil(true);
    document.addEventListener("keydown", this.onKey, true);
    this.track();
    let completed = false;
    try {
      while (!this.stopped && this.index < this.o.guide.steps.length) {
        await this.playStep(this.index);
        if (this.stopped) break;
        if (this.jump !== null) {
          this.index = this.jump;
          this.jump = null;
          continue;
        }
        this.index += 1;
      }
      completed = !this.stopped;
    } finally {
      await this.finish(completed);
    }
    return completed;
  }

  next(): void {
    this.jump = this.index + 1;
    this.paused = false;
    this.narration?.stop();
    this.release();
  }

  prev(): void {
    this.jump = Math.max(0, this.index - 1);
    this.paused = false;
    this.narration?.stop();
    this.release();
  }

  toggle(): void {
    this.paused = !this.paused;
    if (this.paused) this.narration?.pause();
    else {
      this.narration?.resume();
      this.release();
    }
    this.render();
  }

  stop(): void {
    this.stopped = true;
    this.narration?.stop();
    this.release();
  }

  private async playStep(i: number): Promise<void> {
    const { guide, overlay } = this.o;
    const step = guide.steps[i]!;
    this.o.emit("step", { id: guide.id, index: i });
    this.target = step.target ? await this.waitForTarget(step) : null;
    if (this.stopped || this.jump !== null) return;
    if (step.target && !this.target) {
      console.warn(`explicame: step ${i + 1} of "${guide.id}" has no element on the screen; it is narrated without the ring.`);
      this.o.emit("missing", { id: guide.id, index: i });
    }
    if (this.target) {
      this.target.scrollIntoView?.({ block: "center", behavior: this.reduced ? "auto" : "smooth" });
      await sleep(this.reduced ? 0 : 300);
    }
    // Stop or a jump may arrive while scrolling, before the narration exists: honor it here.
    if (this.stopped || this.jump !== null) return;
    this.render();
    if (this.o.record && this.target) {
      const r = this.target.getBoundingClientRect();
      await overlay.moveCursor(r.left + r.width / 2, r.top + r.height / 2, this.reduced);
    }
    this.recordHook()?.({ type: "narration", index: i, lang: this.lang });
    const audio = step.audio?.[this.lang];
    this.narration = this.o.narrator(this.textOf(step), this.lang, audio ? `${this.o.base}/${guide.id}/${audio}` : undefined, {
      muted: this.muted,
      rate: this.rate,
      volume: this.volume,
    });
    await this.narration.done;
    this.narration = null;
    while (this.paused && !this.stopped && this.jump === null) await new Promise<void>((resolve) => this.waiters.push(resolve));
    if (this.stopped || this.jump !== null) return;
    if (step.action && !this.performed.has(i)) {
      await performStepAction(this.target, step.action, { navigate: this.o.navigate, typeDelay: this.reduced ? 0 : this.o.typeDelay });
      this.performed.add(i);
      if (step.opens) this.opened += 1;
      await sleep(this.o.pauseAfterActionMs);
    }
  }

  private textOf(step: Step): string {
    return step.narration[this.lang] ?? Object.values(step.narration)[0] ?? "";
  }

  private async waitForTarget(step: Step): Promise<Element | null> {
    const runtime = window.__explicame;
    if (!runtime || !step.target) return null;
    const deadline = Date.now() + this.o.resolveTimeoutMs;
    for (;;) {
      const found = runtime.resolve(step.target.strategies);
      if (found) return found;
      if (Date.now() >= deadline || this.stopped || this.jump !== null) return null;
      await sleep(150);
    }
  }

  private track(): void {
    const loop = () => {
      if (this.stopped) return;
      this.o.overlay.ring(this.target?.isConnected ? this.target.getBoundingClientRect() : null, this.index + 1);
      this.frameId = frame(loop);
    };
    this.frameId = frame(loop);
  }

  private render(): void {
    const step = this.o.guide.steps[this.index];
    if (!step || this.stopped) return;
    this.o.overlay.caption(
      {
        n: this.index + 1,
        total: this.o.guide.steps.length,
        text: this.textOf(step),
        lang: this.lang,
        languages: this.o.guide.languages,
        paused: this.paused,
        muted: this.muted,
        rate: this.rate,
        volume: this.volume,
      },
      {
        prev: () => this.prev(),
        toggle: () => this.toggle(),
        next: () => this.next(),
        exit: () => this.stop(),
        mute: () => {
          this.muted = !this.muted;
          this.applyAudio();
        },
        rate: (value) => {
          this.rate = value;
          this.applyAudio();
        },
        volume: (value) => {
          this.volume = value;
          this.narration?.update({ muted: this.muted, rate: this.rate, volume: this.volume });
        },
        lang: (value) => {
          this.lang = value;
          this.render();
        },
      },
    );
  }

  private applyAudio(): void {
    this.narration?.update({ muted: this.muted, rate: this.rate, volume: this.volume });
    this.render();
  }

  private handleKey(event: KeyboardEvent): void {
    const actions: Record<string, () => void> = { Escape: () => this.stop(), ArrowRight: () => this.next(), ArrowLeft: () => this.prev(), " ": () => this.toggle() };
    const act = actions[event.key];
    if (!act) return;
    event.preventDefault();
    event.stopPropagation();
    act();
  }

  private release(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  private recordHook(): RecordHook | undefined {
    return this.o.record ? (window as unknown as { __explicameRecordEvent?: RecordHook }).__explicameRecordEvent : undefined;
  }

  private async finish(completed: boolean): Promise<void> {
    this.stopped = true;
    cancelFrame(this.frameId);
    document.removeEventListener("keydown", this.onKey, true);
    this.narration?.stop();
    const { overlay, guide } = this.o;
    overlay.ring(null, 0);
    overlay.hideCaption();
    overlay.hideCursor();
    overlay.veil(false);
    try {
      if (this.opened > 0) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.querySelectorAll("dialog[open]").forEach((node) => {
          const dialog = node as HTMLDialogElement;
          if (typeof dialog.close === "function") dialog.close();
          else dialog.removeAttribute("open");
        });
      }
      if (this.o.navigate && location.pathname !== guide.startUrl) await this.o.navigate(guide.startUrl);
    } catch {
      // The app's router may refuse to go back; the guide still ends and gives back the guard.
    } finally {
      this.restoreGuard?.();
      this.restoreGuard = null;
      this.resolveDone();
      this.recordHook()?.({ type: "end" });
      this.o.emit("end", { id: guide.id, completed });
    }
  }
}
