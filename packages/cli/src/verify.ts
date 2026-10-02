import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { repairMessage, t, type Guide, type Lang, type Step } from "@explicame/core";
import { observe, performAction, resolveHandle } from "./browser/page.js";
import type { Session } from "./browser/session.js";
import { throwIfCancelled } from "./cancel.js";
import type { LlmDriver, ToolResult } from "./generate/driver.js";
import { executeCall, type ExplorationState } from "./generate/loop.js";

export interface VerifyFailure {
  index: number;
  error: string;
  screenshot?: string;
}

export class VerifyError extends Error {
  readonly failure: VerifyFailure;
  constructor(failure: VerifyFailure, lang: Lang = "en") {
    super(t(lang, "verify.failed", { index: failure.index + 1, error: failure.error }));
    this.name = "VerifyError";
    this.failure = failure;
  }
}

export interface VerifyOptions {
  timeoutMs?: number;
  /** When set, a screenshot of the failing step is saved here. */
  reportDir?: string;
}

async function replayStep(session: Session, step: Step, timeoutMs: number): Promise<string | null> {
  let handle = null;
  if (step.target) {
    handle = await resolveHandle(session.page, step.target.strategies, timeoutMs);
    if (!handle) return "target not found on the screen";
  }
  if (step.action) {
    try {
      await performAction(session.page, handle, step.action, session.appUrl);
    } catch (error) {
      return (error as Error).message.split("\n")[0] ?? "the action failed";
    }
  }
  return null;
}

/** Replays the guide in a fresh browser and returns the first failing step, if any. */
export async function verifyGuide(guide: Guide, open: () => Promise<Session>, o: VerifyOptions = {}): Promise<VerifyFailure[]> {
  const session = await open();
  try {
    for (const [index, step] of guide.steps.entries()) {
      const error = await replayStep(session, step, o.timeoutMs ?? 5000);
      if (!error) continue;
      const failure: VerifyFailure = { index, error };
      if (o.reportDir) {
        await mkdir(o.reportDir, { recursive: true });
        failure.screenshot = join(o.reportDir, `step-${String(index + 1).padStart(2, "0")}.png`);
        await session.page.screenshot({ path: failure.screenshot });
      }
      return [failure];
    }
    return [];
  } finally {
    await session.close();
  }
}

/** Opens a fresh session and replays the steps before `index`, so the screen is where that step starts. */
export async function openAtStep(guide: Guide, index: number, open: () => Promise<Session>, timeoutMs: number, lang: Lang = "en"): Promise<Session> {
  const session = await open();
  try {
    for (const step of guide.steps.slice(0, index)) {
      const error = await replayStep(session, step, timeoutMs);
      if (error) throw new VerifyError({ index, error }, lang);
    }
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

export interface RepairOptions {
  guide: Guide;
  driver: LlmDriver;
  /** Unsent results of the conversation's last turn. */
  pendingResults: ToolResult[];
  open: () => Promise<Session>;
  timeoutMs?: number;
  reportDir?: string;
  log?: (message: string) => void;
  /** Language of the messages for the person running the CLI. */
  lang?: Lang;
  signal?: AbortSignal;
}

/** Verifies; for each failing step the model gets one chance to replace it, then everything is verified again. */
export async function verifyAndRepair(o: RepairOptions): Promise<Guide> {
  const timeoutMs = o.timeoutMs ?? 5000;
  const lang = o.lang ?? "en";
  let guide = o.guide;
  let pending = o.pendingResults;
  const attempted = new Set<number>();
  for (;;) {
    throwIfCancelled(o.signal, lang);
    const failure = (await verifyGuide(guide, o.open, { timeoutMs, reportDir: o.reportDir }))[0];
    if (!failure) return guide;
    if (attempted.has(failure.index)) throw new VerifyError(failure, lang);
    attempted.add(failure.index);
    o.log?.(t(lang, "verify.failed", { index: failure.index + 1, error: failure.error }));

    const session = await openAtStep(guide, failure.index, o.open, timeoutMs, lang);
    try {
      const state: ExplorationState = { session, languages: guide.languages, maxSteps: Number.MAX_SAFE_INTEGER, steps: [], title: null };
      let turn = await o.driver.reply(pending, repairMessage(failure.index, failure.error, JSON.stringify(await observe(session.page))));
      pending = [];
      let replacement: Step | undefined;
      for (let round = 0; round < 6 && turn.calls.length > 0; round++) {
        const results: ToolResult[] = [];
        for (const call of turn.calls) results.push(await executeCall(call, state));
        replacement = state.steps[0];
        if (replacement) {
          pending = results;
          break;
        }
        turn = await o.driver.reply(results);
      }
      if (!replacement) throw new VerifyError(failure, lang);
      const fixed = replacement;
      guide = { ...guide, steps: guide.steps.map((step, index) => (index === failure.index ? fixed : step)) };
    } finally {
      await session.close();
    }
  }
}
