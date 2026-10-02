import { api, apiBlob, withToken } from "./api.js";
import { t, type Key, type UiLang } from "./i18n.js";

type Lang = "es" | "en";
type CredentialName = "anthropic" | "elevenlabs" | "deepgram" | "openai";
interface Config {
  appUrl: string;
  startUrl: string;
  base: string;
  languages: Lang[];
  uiLanguage: Lang;
  mode: "api" | "plugin";
  model: string;
  effort: string;
  maxSteps: number;
  voice: { provider: string; voices: Partial<Record<Lang, string>>; model?: string; speed: number; fallback: string[]; command?: string };
}
interface KeyStatus {
  set: boolean;
  masked: string;
  source: "env" | "file" | null;
}
interface GuideInfo {
  id: string;
  title: Partial<Record<Lang, string>>;
  languages: Lang[];
  steps: { narration: Partial<Record<Lang, string>>; audio?: Partial<Record<Lang, string>> }[];
  videos: string[];
}
interface State {
  version: string;
  cwd: string;
  config: Config;
  configError: string | null;
  credentials: Record<CredentialName, KeyStatus>;
  guides: GuideInfo[];
}
type JobEvent = { type: "log"; message: string } | { type: "shot"; data: string } | { type: "done"; guide: string; videos: string[] } | { type: "error"; message: string };

const LANGS: Lang[] = ["es", "en"];
const PROVIDERS = ["elevenlabs", "deepgram", "openai", "piper", "command", "browser"] as const;
const KEY_OF: Partial<Record<string, CredentialName>> = { elevenlabs: "elevenlabs", deepgram: "deepgram", openai: "openai" };

let lang: UiLang = "es";
let state: State;

type Child = Node | string | null | false | undefined;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(name, value);
  for (const child of children) if (child !== null && child !== false && child !== undefined) node.append(child);
  return node;
}

const tr = (key: Key, params?: Record<string, string | number>) => t(lang, key, params);

function toast(text: string, error = false): void {
  const node = document.getElementById("toast")!;
  node.textContent = text;
  node.className = error ? "show error" : "show";
  window.setTimeout(() => (node.className = ""), 4000);
}

const failMessage = (error: unknown) => tr("error", { error: (error as Error).message });

function button(label: string, onClick: () => unknown, kind = ""): HTMLButtonElement {
  const node = el("button", { type: "button", class: kind || undefined }, label);
  node.addEventListener("click", () => void onClick());
  return node;
}

let fieldIds = 0;
/** A label tied to its control by for/id, so the control's accessible name is exactly the label. */
function field(label: string, control: HTMLElement): HTMLElement {
  control.id ||= `field-${++fieldIds}`;
  return el("div", { class: "field" }, el("label", { for: control.id }, label), control);
}

function textInput(value: string, type = "text"): HTMLInputElement {
  const node = el("input", { type });
  node.value = value;
  return node;
}

function choice(options: [string, string][], value: string): HTMLSelectElement {
  const node = el("select");
  for (const [optionValue, label] of options) node.append(el("option", { value: optionValue }, label));
  node.value = value;
  return node;
}

function check(label: string, checked: boolean): [HTMLLabelElement, HTMLInputElement] {
  const box = el("input", { type: "checkbox" });
  box.checked = checked;
  return [el("label", { class: "check" }, box, el("span", {}, label)), box];
}

function section(id: string, title: Key, ...body: Child[]): HTMLElement {
  return el("section", { id, class: "card" }, el("h2", {}, tr(title)), ...body);
}

async function save(patch: Record<string, unknown>): Promise<void> {
  try {
    state.config = (await api<{ config: Config }>("PUT", "/api/config", patch)).config;
    if (patch.uiLanguage) lang = state.config.uiLanguage;
    render();
    toast(tr("saved"));
  } catch (error) {
    toast(failMessage(error), true);
  }
}

function keyControl(name: CredentialName): HTMLElement {
  const info = state.credentials[name];
  const statusText = info.set ? `${tr("keySet", { masked: info.masked })}${info.source === "env" ? ` ${tr("keyFromEnv")}` : ""}` : tr("keyMissing");
  const value = textInput("", "password");
  value.autocomplete = "off";
  const update = async (method: "PUT" | "DELETE") => {
    try {
      state.credentials = (await api<{ credentials: State["credentials"] }>(method, `/api/credentials/${name}`, method === "PUT" ? { value: value.value } : undefined)).credentials;
      render();
      toast(tr("saved"));
    } catch (error) {
      toast(failMessage(error), true);
    }
  };
  return el(
    "div",
    { class: "key" },
    field(tr("apiKey"), value),
    el("p", { class: "hint" }, statusText),
    el("div", { class: "actions" }, button(tr("saveKey"), () => update("PUT")), info.source === "file" ? button(tr("remove"), () => update("DELETE"), "secondary") : null),
  );
}

function projectSection(): HTMLElement {
  const c = state.config;
  const appUrl = textInput(c.appUrl, "url");
  const startUrl = textInput(c.startUrl);
  const base = textInput(c.base);
  const login = async () => {
    toast(tr("loginHint"));
    try {
      await api("POST", "/api/login");
      toast(tr("loginDone"));
    } catch (error) {
      toast(failMessage(error), true);
    }
  };
  return section(
    "project",
    "project",
    field(tr("appUrl"), appUrl),
    field(tr("startUrl"), startUrl),
    field(tr("base"), base),
    el("div", { class: "actions" }, button(tr("save"), () => save({ appUrl: appUrl.value, startUrl: startUrl.value, base: base.value })), button(tr("login"), login, "secondary")),
  );
}

function languagesSection(): HTMLElement {
  const c = state.config;
  const ui = choice(LANGS.map((l): [string, string] => [l, tr(`lang.${l}`)]), c.uiLanguage);
  const boxes = LANGS.map((l) => check(tr(`lang.${l}`), c.languages.includes(l)));
  return section(
    "languages",
    "languages",
    field(tr("uiLanguage"), ui),
    el("fieldset", {}, el("legend", {}, tr("narration")), ...boxes.map(([label]) => label)),
    el("div", { class: "actions" }, button(tr("save"), () => save({ uiLanguage: ui.value, languages: LANGS.filter((_, i) => boxes[i]![1].checked) }))),
  );
}

function aiSection(): HTMLElement {
  const c = state.config;
  const mode = choice([["api", tr("mode.api")], ["plugin", tr("mode.plugin")]], c.mode);
  const models: [string, string][] = [["claude-opus-5-5", tr("model.opus")], ["claude-sonnet-5-5", tr("model.sonnet")]];
  if (!models.some(([id]) => id === c.model)) models.push([c.model, c.model]);
  const model = choice(models, c.model);
  const effort = choice(["low", "medium", "high", "xhigh", "max"].map((e): [string, string] => [e, e]), c.effort);
  const maxSteps = textInput(String(c.maxSteps), "number");
  maxSteps.min = "1";
  maxSteps.max = "40";
  const body: Child[] =
    c.mode === "plugin"
      ? [el("p", { class: "hint" }, tr("pluginHelp"))]
      : [keyControl("anthropic"), field(tr("model"), model), field(tr("effort"), effort), field(tr("maxSteps"), maxSteps)];
  return section(
    "ai",
    "ai",
    field(tr("mode"), mode),
    ...body,
    el("div", { class: "actions" }, button(tr("save"), () => save(c.mode === "plugin" || mode.value === "plugin" ? { mode: mode.value } : { mode: mode.value, model: model.value, effort: effort.value, maxSteps: Number(maxSteps.value) }))),
  );
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function voiceSection(): HTMLElement {
  const v = state.config.voice;
  const provider = choice(PROVIDERS.map((p): [string, string] => [p, tr(`provider.${p}`)]), v.provider);
  provider.addEventListener("change", () => void save({ voice: { provider: provider.value } }));
  const voices = Object.fromEntries(LANGS.map((l) => [l, textInput(v.voices[l] ?? "")])) as Record<Lang, HTMLInputElement>;
  const tryVoice = async (l: Lang) => {
    try {
      const blob = await apiBlob("POST", "/api/voice/test", { lang: l, provider: provider.value, voice: voices[l].value || undefined, text: t(l, "testText") });
      await new Audio(URL.createObjectURL(blob)).play();
    } catch (error) {
      toast(failMessage(error), true);
    }
  };
  const speed = textInput(String(v.speed), "range");
  Object.assign(speed, { min: "0.5", max: "2", step: "0.05" });
  // ElevenLabs needs configured voice ids, so it never works as a fallback; the browser voice makes no audio.
  const fallbacks = PROVIDERS.filter((p) => p !== "browser" && p !== "elevenlabs").map((p) => [p, check(tr(`provider.${p}`), v.fallback.includes(p))] as const);
  const command = textInput(v.command ?? "");
  const key = KEY_OF[v.provider];
  const isBrowser = v.provider === "browser";
  const saveVoice = () =>
    save({
      voice: {
        provider: provider.value,
        voices: Object.fromEntries(LANGS.map((l) => [l, voices[l].value.trim() || null])),
        speed: Number(speed.value),
        fallback: fallbacks.filter(([, [, box]]) => box.checked).map(([p]) => p),
        command: command.value.trim() || null,
      },
    });
  return section(
    "voice",
    "voice",
    field(tr("provider"), provider),
    isBrowser ? el("p", { class: "hint" }, tr("browserHelp")) : null,
    key ? keyControl(key) : null,
    ...(isBrowser ? [] : LANGS.map((l) => el("div", { class: "row" }, field(tr("voiceFor", { lang: tr(`lang.${l}`) }), voices[l]), button(tr("test"), () => tryVoice(l), "secondary")))),
    v.provider === "command" ? field(tr("command"), command) : null,
    v.provider === "command" ? el("p", { class: "hint" }, tr("commandHelp")) : null,
    field(`${tr("speed")} (${v.speed}×)`, speed),
    el("fieldset", {}, el("legend", {}, tr("fallback")), ...fallbacks.map(([, [label]]) => label)),
    el("div", { class: "actions" }, button(tr("save"), saveVoice)),
    v.provider === "elevenlabs" ? cloneBox(voices) : null,
  );
}

function cloneBox(voices: Record<Lang, HTMLInputElement>): HTMLElement {
  const name = textInput("explicame");
  const files = el("input", { type: "file", multiple: "", accept: "audio/*" });
  const [consentLabel, consent] = check(tr("cloneConsent"), false);
  const clone = async () => {
    if (!consent.checked) return toast(tr("cloneNeedsConsent"), true);
    try {
      const payload = await Promise.all(Array.from(files.files ?? []).map(async (file) => ({ name: file.name, data: await toBase64(file) })));
      const { voiceId } = await api<{ voiceId: string }>("POST", "/api/voice/clone", { name: name.value || "explicame", consent: true, files: payload });
      for (const l of LANGS) voices[l].value = voiceId;
      toast(tr("cloned", { id: voiceId }));
    } catch (error) {
      toast(failMessage(error), true);
    }
  };
  return el("details", { class: "clone" }, el("summary", {}, tr("clone")), field(tr("cloneName"), name), field(tr("cloneFiles"), files), consentLabel, el("div", { class: "actions" }, button(tr("cloneButton"), clone)));
}

function titleOf(guide: GuideInfo): string {
  return guide.title[lang] ?? Object.values(guide.title)[0] ?? guide.id;
}

function generateSection(): HTMLElement {
  const c = state.config;
  const status = el("p", { class: "status", role: "status" });
  const log = el("ol", { class: "log" });
  const shots = el("div", { class: "shots" });
  const [videoLabel, video] = check(tr("video"), false);
  const start = async (request: Record<string, unknown>) => {
    log.replaceChildren();
    shots.replaceChildren();
    status.textContent = tr("running");
    try {
      const { id } = await api<{ id: string }>("POST", "/api/jobs", request);
      const source = new EventSource(withToken(`/api/jobs/${id}/events`));
      source.onmessage = (message) => {
        const event = JSON.parse(message.data as string) as JobEvent;
        if (event.type === "log") log.append(el("li", {}, event.message));
        if (event.type === "shot") shots.append(el("img", { src: `data:image/jpeg;base64,${event.data}`, alt: "" }));
        if (event.type === "done" || event.type === "error") {
          source.close();
          status.textContent = event.type === "done" ? tr("done") : tr("failed", { error: event.message });
          void refreshResults();
        }
      };
    } catch (error) {
      status.textContent = failMessage(error);
    }
  };
  let body: Child[];
  if (c.mode === "api") {
    const describe = el("textarea", { rows: "3" });
    const files = el("textarea", { rows: "2" });
    body = [
      field(tr("describe"), describe),
      field(tr("files"), files),
      videoLabel,
      el("div", { class: "actions" }, button(tr("start"), () => start({ kind: "build", describe: describe.value.trim() || undefined, files: files.value.split("\n").map((s) => s.trim()).filter(Boolean), video: video.checked }))),
    ];
  } else {
    const guide = choice(state.guides.map((g): [string, string] => [g.id, titleOf(g)]), state.guides[0]?.id ?? "");
    body = [
      el("p", { class: "hint" }, tr("pluginHelp")),
      field(tr("pickGuide"), guide),
      videoLabel,
      el("div", { class: "actions" }, button(tr("voiceOnly"), () => (guide.value ? start({ kind: "from-guide", guide: guide.value, video: video.checked }) : undefined))),
    ];
  }
  return section("generate", "generate", ...body, status, log, shots);
}

function guideCard(guide: GuideInfo): HTMLElement {
  const steps = el(
    "ol",
    { class: "steps" },
    ...guide.steps.map((step) =>
      el(
        "li",
        {},
        ...guide.languages.map((l) => {
          const audio = step.audio?.[l];
          return el("div", { class: "step" }, el("p", {}, step.narration[l] ?? ""), audio ? el("audio", { controls: "", preload: "none", src: withToken(`/files/output/${guide.id}/${audio}`) }) : null);
        }),
      ),
    ),
  );
  const videos = guide.videos.map((file) =>
    el(
      "figure",
      {},
      el("video", { controls: "", preload: "metadata", src: withToken(`/files/videos/${file}`) }),
      el("figcaption", {}, el("a", { href: withToken(`/files/videos/${file}`), download: file }, `${tr("download")} ${file}`)),
    ),
  );
  return el(
    "details",
    { class: "guide" },
    el("summary", {}, `${titleOf(guide)} · ${tr("steps", { n: guide.steps.length })}`),
    steps,
    ...videos,
    el("p", {}, el("a", { href: withToken(`/files/output/${guide.id}/guide.json`), download: `${guide.id}.json` }, `${tr("download")} guide.json`)),
  );
}

function resultsSection(): HTMLElement {
  return section("results", "results", ...(state.guides.length ? state.guides.map(guideCard) : [el("p", { class: "hint" }, tr("noGuides"))]));
}

async function refreshResults(): Promise<void> {
  state = await api<State>("GET", "/api/state");
  document.getElementById("results")?.replaceWith(resultsSection());
}

function render(): void {
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((node) => (node.textContent = tr(node.dataset.t as Key)));
  document.querySelectorAll<HTMLButtonElement>("[data-ui-lang]").forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.uiLang === lang)));
  document.getElementById("app")!.replaceChildren(
    state.configError ? el("p", { class: "status error" }, state.configError) : "",
    projectSection(),
    languagesSection(),
    aiSection(),
    voiceSection(),
    generateSection(),
    resultsSection(),
  );
}

async function main(): Promise<void> {
  document.querySelectorAll<HTMLButtonElement>("[data-ui-lang]").forEach((node) =>
    node.addEventListener("click", () => {
      lang = node.dataset.uiLang as UiLang;
      render();
    }),
  );
  try {
    state = await api<State>("GET", "/api/state");
    lang = state.config.uiLanguage;
    render();
  } catch (error) {
    document.getElementById("app")!.replaceChildren(el("p", { class: "status error" }, failMessage(error)));
  }
}

void main();
