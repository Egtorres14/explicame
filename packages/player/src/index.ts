import type { Guide, Lang, LocalizedText } from "@explicame/core";
import { installDomRuntime } from "@explicame/core/runtime";
import type { AllowRule } from "@explicame/core/safety";
import type { BlockedInfo } from "./guard.js";
import { ui } from "./i18n.js";
import { defaultNarrator, type Narrator } from "./narrator.js";
import { Overlay } from "./overlay.js";
import { GuideRun } from "./runner.js";

export type { BlockedInfo } from "./guard.js";
export type { Narrator, Narration, NarratorOptions } from "./narrator.js";

export interface MountOptions {
  /** Where guides.json and the guide folders are served. Default "/explicame". */
  base?: string;
  lang?: Lang;
  /** Floating "How does it work?" button. Default true. */
  button?: boolean;
  /** The app's router, for navigate steps and to return to startUrl on exit. */
  navigate?: (url: string) => void | Promise<void>;
  allowRequests?: AllowRule[];
  onBlockedRequest?: (info: BlockedInfo) => void;
  zIndex?: number;
  /** Used by `explicame record`: animated cursor and timing events. */
  record?: boolean;
  narrator?: Narrator;
  typeDelay?: number;
  resolveTimeoutMs?: number;
}

export interface GuideSummary {
  id: string;
  title: LocalizedText;
  startUrl: string;
  languages: Lang[];
}

type EventName = "step" | "end" | "blocked" | "missing";
type Listener = (payload: Record<string, unknown>) => void;

interface State {
  options: MountOptions & { base: string; lang: Lang; zIndex: number; typeDelay: number; resolveTimeoutMs: number };
  overlay: Overlay;
  run: GuideRun | null;
  listeners: Map<EventName, Set<Listener>>;
  /** Bumped by every play() and by unmount(): a play() that is no longer the latest gives up. */
  ticket: number;
}

let state: State | null = null;

function emit(event: EventName, payload: Record<string, unknown>): void {
  state?.listeners.get(event)?.forEach((listener) => listener(payload));
}

function requireState(): State {
  if (!state) throw new Error("explicame: call mount() first");
  return state;
}

export function mount(options: MountOptions = {}): void {
  if (state) unmount();
  installDomRuntime();
  const lang: Lang = options.lang ?? (typeof navigator !== "undefined" && navigator.language?.startsWith("en") ? "en" : "es");
  const resolved = {
    ...options,
    base: (options.base ?? "/explicame").replace(/\/$/, ""),
    lang,
    zIndex: options.zIndex ?? 2147483000,
    typeDelay: options.typeDelay ?? 45,
    resolveTimeoutMs: options.resolveTimeoutMs ?? 5000,
  };
  const overlay = new Overlay(resolved.zIndex);
  state = { options: resolved, overlay, run: null, listeners: new Map(), ticket: 0 };
  if (options.button !== false) overlay.showButton(ui(lang, "howItWorks"), () => void toggleList());
}

async function toggleList(): Promise<void> {
  const current = requireState();
  if (current.overlay.isListOpen()) {
    current.overlay.closeList();
    return;
  }
  const lang = current.options.lang;
  const here = (await loadIndex()).filter((guide) => guide.startUrl === location.pathname);
  current.overlay.openList(
    here.map((guide) => ({ id: guide.id, title: guide.title[lang] ?? Object.values(guide.title)[0] ?? guide.id })),
    ui(lang, "noGuides"),
    (id) => {
      current.overlay.closeList();
      void play(id);
    },
  );
}

export async function loadIndex(): Promise<GuideSummary[]> {
  const response = await fetch(`${requireState().options.base}/guides.json`);
  return response.ok ? ((await response.json()) as GuideSummary[]) : [];
}

export async function play(id: string, o: { lang?: Lang } = {}): Promise<boolean> {
  const current = requireState();
  const ticket = ++current.ticket;
  // One run at a time: the previous run gives back the veil and the write guard before the next one takes them.
  const previous = current.run;
  if (previous) {
    previous.stop();
    await previous.done;
  }
  const response = await fetch(`${current.options.base}/${id}/guide.json`);
  if (!response.ok) throw new Error(`explicame: guide ${id} not found (${response.status})`);
  const guide = (await response.json()) as Guide;
  const wanted = o.lang ?? current.options.lang;
  const lang = guide.languages.includes(wanted) ? wanted : guide.languages[0]!;
  if (current.options.navigate && location.pathname !== guide.startUrl) await current.options.navigate(guide.startUrl);
  if (ticket !== current.ticket || state !== current) return false;
  const run = new GuideRun({
    guide,
    base: current.options.base,
    lang,
    overlay: current.overlay,
    narrator: current.options.narrator ?? defaultNarrator,
    navigate: current.options.navigate,
    allow: current.options.allowRequests,
    onBlocked: (info) => {
      current.options.onBlockedRequest?.(info);
      emit("blocked", { ...info });
    },
    emit,
    record: current.options.record ?? false,
    typeDelay: current.options.typeDelay,
    resolveTimeoutMs: current.options.resolveTimeoutMs,
    pauseAfterActionMs: 600,
  });
  current.run = run;
  current.overlay.hideButton(true);
  try {
    return await run.start();
  } finally {
    if (current.run === run) current.run = null;
    current.overlay.hideButton(false);
  }
}

export function stop(): void {
  state?.run?.stop();
}

export function on(event: EventName, listener: Listener): () => void {
  const current = requireState();
  const set = current.listeners.get(event) ?? new Set<Listener>();
  set.add(listener);
  current.listeners.set(event, set);
  return () => set.delete(listener);
}

export function unmount(): void {
  if (!state) return;
  state.ticket += 1;
  state.run?.stop();
  state.overlay.destroy();
  state = null;
}
