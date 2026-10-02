import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { join, posix, resolve, win32 } from "node:path";
import {
  buildTools, initialMessage, systemPrompt, t, validateGuide,
  type Guide, type Lang, type LocalizedText, type Step,
} from "@explicame/core";
import { openSession } from "./browser/session.js";
import { ConfigError, type Config } from "./config.js";
import { explicameHome, requireCredential, type Credentials } from "./credentials.js";
import { getChangeContext } from "./diff.js";
import { countFirstTurnTokens, createAnthropicDriver, estimateCostUsd } from "./generate/anthropicDriver.js";
import type { LlmDriver, Usage } from "./generate/driver.js";
import { LoopError, runExploration, type ExplorationResult } from "./generate/loop.js";
import { readGuide, slugify, writeGuide } from "./output.js";
import { copyPlayer } from "./player.js";
import { writeReport, writeReportSync } from "./report.js";
import { verifyAndRepair } from "./verify.js";
import { buildVoiceProviders } from "./voice/index.js";
import { voiceGuide, type VoiceProvider } from "./voice/provider.js";

export interface BuildOptions {
  cwd: string;
  config: Config;
  credentials: Credentials;
  base?: string;
  head?: string;
  diffFile?: string;
  files?: string[];
  describe?: string;
  id?: string;
  voice?: boolean;
  /** A guide already generated and verified (plugin mode): only its voice and publishing, no AI. */
  fromGuide?: string;
  driver?: LlmDriver;
  voiceProviders?: VoiceProvider[];
  home?: string;
  log?: (message: string) => void;
}

export interface BuildResult {
  guide: Guide;
  dir: string;
  usage: Usage;
}

/** Where a guide came from; assembleGuide adds the timestamp. */
export type GuideSource = Omit<Guide["source"], "createdAt">;

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

export function sessionPath(home: string, cwd: string, platform: NodeJS.Platform = process.platform): string {
  const path = platform === "win32" ? win32 : posix;
  const absolute = path.resolve(cwd);
  // Windows paths ignore case: Claude Code's "c:/x" and a shell's "C:\x" are the same project and the same session.
  const key = platform === "win32" ? absolute.toLowerCase() : absolute;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return join(home, "sessions", `${path.basename(key)}-${hash}.json`);
}

export function assembleGuide(x: {
  id?: string;
  languages: Lang[];
  title: LocalizedText;
  steps: Step[];
  startUrl: string;
  source: GuideSource;
}): Guide {
  const firstTitle = x.title[x.languages[0]!] ?? "guia";
  const candidate = {
    schemaVersion: 1,
    id: x.id ?? slugify(firstTitle),
    languages: x.languages,
    title: x.title,
    startUrl: x.startUrl,
    steps: x.steps,
    source: { ...x.source, createdAt: new Date().toISOString() },
  };
  const result = validateGuide(candidate);
  if (!result.ok) throw new LoopError(`The generated guide is not valid: ${result.errors.join("; ")}`);
  return result.guide;
}

export async function build(o: BuildOptions): Promise<BuildResult> {
  const reportDir = join(resolve(o.cwd), ".explicame", "reports", new Date().toISOString().replace(/[:.]/g, "-"));
  const events: string[] = [];
  const log = (message: string) => {
    events.push(message);
    (o.log ?? (() => {}))(message);
  };
  // Playwright closes its browsers on Ctrl+C by itself (handleSIGINT); this only leaves a partial report behind.
  const onInterrupt = () => {
    writeReportSync(reportDir, { interrupted: true, events });
    process.exit(130);
  };
  process.once("SIGINT", onInterrupt);
  try {
    return await (o.fromGuide !== undefined ? runFromGuide(o, o.fromGuide, log) : runBuild(o, log, reportDir));
  } catch (error) {
    await writeReport(reportDir, { error: (error as Error).message, events });
    (o.log ?? (() => {}))(t(o.config.uiLanguage, "report.saved", { path: reportDir }));
    if (error instanceof Error) Object.assign(error, { reportDir });
    throw error;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
  }
}

async function runBuild(o: BuildOptions, log: (message: string) => void, reportDir: string): Promise<BuildResult> {
  const lang = o.config.uiLanguage;
  if (o.id !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(o.id)) throw new ConfigError(t(lang, "config.invalidId", { id: o.id }));
  // In plugin mode Claude Code writes the guide through `explicame mcp`; only a scripted driver may generate here.
  if (o.config.mode === "plugin" && !o.driver) throw new ConfigError(t(lang, "build.pluginMode"));
  const home = o.home ?? explicameHome();
  const context = await getChangeContext({
    cwd: o.cwd, base: o.base ?? o.config.base, head: o.head ?? "HEAD",
    diffFile: o.diffFile, files: o.files, description: o.describe, lang,
  });
  if (context.omittedFiles.length) log(t(lang, "diff.truncated", { files: context.omittedFiles.join(", ") }));

  let driver = o.driver;
  if (!driver) {
    const apiKey = requireCredential(o.credentials, "anthropic", lang);
    const client = new Anthropic({ apiKey });
    const user = initialMessage({
      languages: o.config.languages, appUrl: o.config.appUrl, startUrl: o.config.startUrl, maxSteps: o.config.maxSteps,
      diff: context.diff, files: context.files, description: context.description, omittedFiles: context.omittedFiles,
    });
    const first = await countFirstTurnTokens(client, o.config.model, systemPrompt(o.config.languages, o.config.maxSteps), user, buildTools(o.config.languages));
    const usd = estimateCostUsd(o.config.model, first, o.config.maxSteps);
    if (usd !== null) log(t(lang, "estimate.cost", { usd: usd.toFixed(2), model: o.config.model, steps: o.config.maxSteps }));
    driver = createAnthropicDriver({ apiKey, model: o.config.model, effort: o.config.effort, client });
  }

  const open = () =>
    openSession({
      appUrl: o.config.appUrl, startUrl: o.config.startUrl, allowRequests: o.config.safety.allowRequests,
      storageStatePath: sessionPath(home, o.cwd), lang,
    });
  const session = await open();
  let exploration: ExplorationResult;
  try {
    exploration = await runExploration({
      driver, session, languages: o.config.languages, maxSteps: o.config.maxSteps, context,
      appUrl: o.config.appUrl, startUrl: o.config.startUrl, onEvent: (event) => log(event.message), lang,
    });
  } finally {
    await session.close();
  }

  let guide = assembleGuide({
    id: o.id, languages: o.config.languages, title: exploration.title, steps: exploration.steps, startUrl: o.config.startUrl,
    source: { base: context.base, head: context.head, commit: context.commit, generatedBy: driver.id, model: driver.model },
  });
  guide = await verifyAndRepair({ guide, driver, pendingResults: exploration.pendingResults, open, log, reportDir, lang });
  return publish(o, guide, home, log, driver.usage());
}

async function runFromGuide(o: BuildOptions, path: string, log: (message: string) => void): Promise<BuildResult> {
  const file = resolve(o.cwd, path);
  let guide: Guide;
  try {
    guide = await readGuide(file);
  } catch (error) {
    throw new ConfigError(t(o.config.uiLanguage, "guide.unreadable", { path: file, error: (error as Error).message }));
  }
  return publish(o, guide, o.home ?? explicameHome(), log, NO_USAGE);
}

/** Voice (unless --no-voice), guide.json and the index, and the player next to them. */
async function publish(o: BuildOptions, verified: Guide, home: string, log: (message: string) => void, usage: Usage): Promise<BuildResult> {
  const lang = o.config.uiLanguage;
  const outputRoot = resolve(o.cwd, o.config.outputDir);
  const dir = join(outputRoot, verified.id);
  let guide = verified;
  if (o.voice !== false) {
    const providers = o.voiceProviders ?? buildVoiceProviders(o.config, o.credentials);
    if (providers.length === 0) log(t(lang, "voice.noProvider"));
    guide = await voiceGuide(guide, {
      providers, guideDir: dir, cacheDir: join(home, "cache", "voice"),
      speed: o.config.voice.speed, onWarn: log, lang,
    });
  }
  await writeGuide(outputRoot, guide);
  await copyPlayer(outputRoot);
  log(t(lang, "player.hint"));
  log(t(lang, "build.done", { count: guide.steps.length, langs: guide.languages.join(" + "), path: dir }));
  return { guide, dir, usage };
}
