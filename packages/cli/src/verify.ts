import { repairMessage, t, type Guide, type Step } from "@explicame/core";
import { observe, performAction, resolveHandle } from "./browser/page.js";
import type { Session } from "./browser/session.js";
import type { LlmDriver, ToolResult } from "./generate/driver.js";
import { executeCall, type ExplorationState } from "./generate/loop.js";

export interface VerifyFailure {
  index: number;
  error: string;
}

export class VerifyError extends Error {
  readonly failure: VerifyFailure;
  constructor(failure: VerifyFailure) {
    super(t("en", "verify.failed", { index: failure.index + 1, error: failure.error }));
    this.name = "VerifyError";
    this.failure = failure;
  }
}

export interface VerifyOptions {
  timeoutMs?: number;
}

async function replayStep(session: Session, step: Step, timeoutMs: number): Promise<string | null> {
  let handle = null;
  if (step.target) {
    handle = await resolveHandle(session.page, step.target.strategies, timeoutMs);
    if (!handle) return "target not found on the screen";
  }
  if (step.action) {
    try {
      await performAction(session.page, handle, step.action);
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
      if (error) return [{ index, error }];
    }
    return [];
  } finally {
    await session.close();
  }
}

export interface RepairOptions {
  guide: Guide;
  driver: LlmDriver;
  /** Unsent results of the conversation's last turn. */
  pendingResults: ToolResult[];
  open: () => Promise<Session>;
  timeoutMs?: number;
  log?: (message: string) => void;
}

/** Verifies; for each failing step the model gets one chance to replace it, then everything is verified again. */
export async function verifyAndRepair(o: RepairOptions): Promise<Guide> {
  const timeoutMs = o.timeoutMs ?? 5000;
  let guide = o.guide;
  let pending = o.pendingResults;
  const attempted = new Set<number>();
  for (;;) {
    const failure = (await verifyGuide(guide, o.open, { timeoutMs }))[0];
    if (!failure) return guide;
    if (attempted.has(failure.index)) throw new VerifyError(failure);
    attempted.add(failure.index);
    o.log?.(t("en", "verify.failed", { index: failure.index + 1, error: failure.error }));

    const session = await o.open();
    try {
      for (const step of guide.steps.slice(0, failure.index)) {
        const error = await replayStep(session, step, timeoutMs);
        if (error) throw new VerifyError({ index: failure.index, error });
      }
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
      if (!replacement) throw new VerifyError(failure);
      const fixed = replacement;
      guide = { ...guide, steps: guide.steps.map((step, index) => (index === failure.index ? fixed : step)) };
    } finally {
      await session.close();
    }
  }
}
