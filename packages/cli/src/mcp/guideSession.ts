import { join, relative, resolve } from "node:path";
import { repairMessage, TOOL_NAMES, type Guide } from "@explicame/core";
import { observe } from "../browser/page.js";
import { openSession, type Session } from "../browser/session.js";
import { assembleGuide, sessionPath } from "../build.js";
import { loadConfig, type Config } from "../config.js";
import { headCommit } from "../diff.js";
import { executeCall, type ExplorationState } from "../generate/loop.js";
import { writeGuide } from "../output.js";
import { copyPlayer } from "../player.js";
import { openAtStep, verifyGuide } from "../verify.js";

export interface ToolReply {
  text: string;
  isError: boolean;
}

export interface GuideSessionOptions {
  /** Project folder: explicame.config.json, the outputs and the saved app session are relative to it. */
  cwd: string;
  /** explicame home (~/.explicame). */
  home: string;
  /** Loaded from cwd on the first call when absent, so a broken config becomes a tool error instead of a crash. */
  config?: Config;
  /** How long verification waits for each target, in ms (default 5000). */
  timeoutMs?: number;
  /** How the next-step hint calls the CLI (default "explicame"). */
  cliCommand?: string;
}

type Repairing = { kind: "repairing"; guide: Guide; index: number; attempted: Set<number>; state: ExplorationState };
type Phase = { kind: "idle" } | { kind: "exploring"; state: ExplorationState } | Repairing;

const ok = (text: string): ToolReply => ({ text, isError: false });
const fail = (text: string): ToolReply => ({ text, isError: true });
const toolNames: readonly string[] = TOOL_NAMES;

/**
 * The exploration loop of plugin mode. Claude Code calls the tools through the MCP server and this class
 * keeps the browser between calls. finish verifies the guide in a fresh browser and either saves it or opens
 * a repair at the failing step, which the next add_step resolves (one attempt per step, as in API mode).
 */
export class GuideSession {
  private phase: Phase = { kind: "idle" };
  private queue: Promise<unknown> = Promise.resolve();
  private config: Config | undefined;
  private calls = 0;

  constructor(private readonly o: GuideSessionOptions) {
    this.config = o.config;
  }

  /** Runs one tool call. Calls run one after another because they share one browser page. */
  call(name: string, input: unknown): Promise<ToolReply> {
    const next = this.queue.then(() => this.handle(name, input));
    this.queue = next.catch(() => {});
    return next;
  }

  /** Closes any browser still open. */
  async close(): Promise<void> {
    await this.queue;
    await this.closePhase();
  }

  private async handle(name: string, input: unknown): Promise<ToolReply> {
    try {
      if (!toolNames.includes(name)) return fail(`Unknown tool ${name}.`);
      const config = (this.config ??= await loadConfig(this.o.cwd));
      if (this.phase.kind === "repairing") return await this.repair(config, this.phase, name, input);
      let state: ExplorationState;
      if (this.phase.kind === "exploring") {
        state = this.phase.state;
      } else {
        if (name === "finish") return fail("There is no guide in progress: start with observe.");
        state = { session: await this.open(config), languages: config.languages, maxSteps: config.maxSteps, steps: [], title: null };
        this.phase = { kind: "exploring", state };
      }
      const result = await executeCall({ id: this.nextId(), name, input }, state);
      if (name !== "finish" || result.isError) return { text: result.content, isError: result.isError === true };
      return await this.finish(config, state);
    } catch (error) {
      return fail((error as Error).message);
    }
  }

  private async finish(config: Config, state: ExplorationState): Promise<ToolReply> {
    const title = state.title;
    state.title = null;
    if (!title || state.steps.length === 0) return fail("The guide has no steps yet: add them with add_step, then call finish.");
    const guide = assembleGuide({
      languages: config.languages, title, steps: state.steps, startUrl: config.startUrl,
      source: { base: config.base, head: "HEAD", commit: await headCommit(this.o.cwd), generatedBy: "claude-code" },
    });
    await this.closePhase();
    return this.verifyAndSave(config, guide, new Set());
  }

  private async repair(config: Config, phase: Repairing, name: string, input: unknown): Promise<ToolReply> {
    if (name === "finish") return fail(`First call add_step once with the replacement for step ${phase.index + 1}.`);
    const result = await executeCall({ id: this.nextId(), name, input }, phase.state);
    const replacement = phase.state.steps[0];
    if (!replacement) return { text: result.content, isError: result.isError === true };
    await this.closePhase();
    const guide = { ...phase.guide, steps: phase.guide.steps.map((step, index) => (index === phase.index ? replacement : step)) };
    return this.verifyAndSave(config, guide, phase.attempted);
  }

  private async verifyAndSave(config: Config, guide: Guide, attempted: Set<number>): Promise<ToolReply> {
    const timeoutMs = this.o.timeoutMs ?? 5000;
    const open = () => this.open(config);
    const reportDir = join(resolve(this.o.cwd), ".explicame", "reports", new Date().toISOString().replace(/[:.]/g, "-"));
    const failure = (await verifyGuide(guide, open, { timeoutMs, reportDir }))[0];
    if (!failure) {
      const outputRoot = resolve(this.o.cwd, config.outputDir);
      const dir = await writeGuide(outputRoot, guide);
      await copyPlayer(outputRoot);
      const path = relative(resolve(this.o.cwd), join(dir, "guide.json")).split("\\").join("/");
      const arg = /\s/.test(path) ? `"${path}"` : path;
      return ok(
        `The guide "${guide.id}" passed verification (${guide.steps.length} steps) and was saved to ${path}. ` +
          `To generate its voice, run: ${this.o.cliCommand ?? "explicame"} build --from-guide ${arg} (add --video for one MP4 per language).`,
      );
    }
    if (attempted.has(failure.index)) {
      const shot = failure.screenshot ? ` Screenshot: ${failure.screenshot}` : "";
      return fail(`Step ${failure.index + 1} failed again when the guide was replayed: ${failure.error}. The guide was not saved.${shot}`);
    }
    attempted.add(failure.index);
    const session = await openAtStep(guide, failure.index, open, timeoutMs);
    const state: ExplorationState = { session, languages: guide.languages, maxSteps: Number.MAX_SAFE_INTEGER, steps: [], title: null };
    this.phase = { kind: "repairing", guide, index: failure.index, attempted, state };
    return fail(repairMessage(failure.index, failure.error, JSON.stringify(await observe(session.page))));
  }

  private async closePhase(): Promise<void> {
    const phase = this.phase;
    this.phase = { kind: "idle" };
    if (phase.kind !== "idle") await phase.state.session.close().catch(() => {});
  }

  private open(config: Config): Promise<Session> {
    return openSession({
      appUrl: config.appUrl, startUrl: config.startUrl, allowRequests: config.safety.allowRequests,
      storageStatePath: sessionPath(this.o.home, this.o.cwd), lang: config.uiLanguage,
    });
  }

  private nextId(): string {
    this.calls += 1;
    return `call-${this.calls}`;
  }
}
