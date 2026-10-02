import {
  buildTools, checkClickSafety, initialMessage, parseToolCall, systemPrompt, t, toAction,
  type Action, type ActionKind, type Lang, type LocalizedText, type ParsedCall, type Step,
} from "@explicame/core";
import { elementFacts, handleById, observe, performAction, stableStrategies } from "../browser/page.js";
import type { Session } from "../browser/session.js";
import type { ChangeContext } from "../diff.js";
import { throwIfCancelled } from "../cancel.js";
import type { LlmDriver, ToolCall, ToolResult } from "./driver.js";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export class LoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopError";
  }
}

export interface LoopEvent {
  type: "observe" | "act" | "step" | "rejected" | "finish";
  message: string;
}

export interface ExplorationState {
  session: Session;
  languages: Lang[];
  maxSteps: number;
  steps: Step[];
  title: LocalizedText | null;
  onEvent?: (event: LoopEvent) => void;
  /** Runs after every step is added (the panel takes a screenshot here). */
  afterStep?: () => Promise<void>;
}

export interface ExplorationOptions {
  driver: LlmDriver;
  session: Session;
  languages: Lang[];
  maxSteps: number;
  context: ChangeContext;
  appUrl: string;
  startUrl: string;
  onEvent?: (event: LoopEvent) => void;
  /** Maximum input tokens for the whole conversation (default DEFAULT_TOKEN_BUDGET). */
  tokenBudget?: number;
  /** Language of the messages for the person running the CLI (tool results to the AI stay in English). */
  lang?: Lang;
  afterStep?: () => Promise<void>;
  /** Stops the exploration between turns. */
  signal?: AbortSignal;
}

export interface ExplorationResult {
  steps: Step[];
  title: LocalizedText;
  /** Results of the last turn (it ended with finish); not sent yet, so a repair can continue the conversation. */
  pendingResults: ToolResult[];
}

const NUDGE = "Continue with the tools. When the guide is complete, call finish.";
export const DEFAULT_TOKEN_BUDGET = 2_000_000;

function checkBudget(o: ExplorationOptions): void {
  const budget = o.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  if (o.driver.usage().inputTokens > budget) throw new LoopError(`The token budget of ${budget} input tokens was exceeded.`);
}

export async function runExploration(o: ExplorationOptions): Promise<ExplorationResult> {
  const state: ExplorationState = { session: o.session, languages: o.languages, maxSteps: o.maxSteps, steps: [], title: null, onEvent: o.onEvent, afterStep: o.afterStep };
  const user = initialMessage({
    languages: o.languages, appUrl: o.appUrl, startUrl: o.startUrl, maxSteps: o.maxSteps,
    diff: o.context.diff, files: o.context.files, description: o.context.description, omittedFiles: o.context.omittedFiles,
  });
  let turn = await o.driver.start(systemPrompt(o.languages, o.maxSteps), user, buildTools(o.languages));
  let pending: ToolResult[] = [];
  let nudged = false;
  for (let round = 0; round < o.maxSteps * 4 + 10; round++) {
    throwIfCancelled(o.signal, o.lang ?? "en");
    if (turn.stop === "refusal") throw new LoopError("The model declined to continue (refusal).");
    if (turn.calls.length === 0) {
      if (nudged) break;
      nudged = true;
      turn = await o.driver.reply([], NUDGE);
      checkBudget(o);
      continue;
    }
    nudged = false;
    const results: ToolResult[] = [];
    for (const call of turn.calls) results.push(await executeCall(call, state));
    if (state.title) {
      pending = results;
      break;
    }
    turn = await o.driver.reply(results);
    checkBudget(o);
  }
  if (!state.title) throw new LoopError(t(o.lang ?? "en", "loop.noFinish"));
  if (state.steps.length === 0) throw new LoopError("The guide has no steps.");
  return { steps: state.steps, title: state.title, pendingResults: pending };
}

export async function executeCall(call: ToolCall, state: ExplorationState): Promise<ToolResult> {
  const parsed = parseToolCall(call.name, call.input, state.languages);
  if (!parsed.ok) return { id: call.id, content: t("en", "tool.invalidInput", { tool: call.name, errors: parsed.error }), isError: true };
  const page = state.session.page;
  const c = parsed.call;
  try {
    if (c.name === "observe") {
      await ensureInApp(state);
      state.onEvent?.({ type: "observe", message: "observe" });
      return { id: call.id, content: JSON.stringify(await observe(page)) };
    }
    if (c.name === "finish") {
      state.title = c.title;
      state.onEvent?.({ type: "finish", message: "finish" });
      return { id: call.id, content: "ok" };
    }
    if (c.name === "act") {
      await apply(state, c.elementId, c.action, c.value, c.url, false);
      state.onEvent?.({ type: "act", message: `${c.action} ${c.elementId ?? c.url ?? ""}`.trim() });
      return { id: call.id, content: JSON.stringify(await observe(page)) };
    }
    if (state.steps.length >= state.maxSteps) {
      return { id: call.id, content: t("en", "tool.stepLimit", { max: state.maxSteps }), isError: true };
    }
    state.steps.push(await buildStep(state, c));
    await state.afterStep?.();
    state.onEvent?.({ type: "step", message: `step ${state.steps.length}` });
    return { id: call.id, content: JSON.stringify({ added: state.steps.length, observation: await observe(page) }) };
  } catch (error) {
    if (error instanceof ToolError) {
      state.onEvent?.({ type: "rejected", message: error.message });
      return { id: call.id, content: error.message, isError: true };
    }
    throw error;
  }
}

async function buildStep(state: ExplorationState, c: Extract<ParsedCall, { name: "add_step" }>): Promise<Step> {
  const { target, action } = await apply(state, c.elementId, c.action, c.value, c.url, true);
  const step: Step = { narration: c.narration };
  if (target) step.target = target;
  if (action) step.action = action;
  if (c.opens) step.opens = c.opens;
  return step;
}

async function apply(
  state: ExplorationState,
  elementId: string | null,
  kind: ActionKind | null,
  value: string | null,
  url: string | null,
  wantTarget: boolean,
): Promise<{ target?: Step["target"]; action?: Action }> {
  const page = state.session.page;
  let action: Action | undefined;
  if (kind) {
    const built = toAction(kind, value, url);
    if (!built.ok) throw new ToolError(built.error);
    action = built.action;
  }
  if (!elementId) {
    if (action && action.type !== "navigate") throw new ToolError(`The ${action.type} action needs element_id.`);
    if (action) await perform(state, null, action, "-");
    return action ? { action } : {};
  }
  const facts = await elementFacts(page, elementId);
  if (!facts) throw new ToolError(t("en", "tool.unknownElement", { id: elementId }));
  if (action?.type === "click") {
    const verdict = checkClickSafety(facts);
    if (!verdict.ok) {
      throw new ToolError(
        verdict.reason === "submit"
          ? t("en", "tool.unsafeSubmit", { id: elementId })
          : t("en", "tool.unsafeDestructive", { id: elementId, name: facts.name }),
      );
    }
  }
  let target: Step["target"];
  if (wantTarget) {
    const strategies = await stableStrategies(page, elementId);
    if (strategies.length === 0) throw new ToolError(t("en", "tool.noStableSelector", { id: elementId }));
    target = { strategies };
  }
  if (action) await perform(state, action.type === "navigate" ? null : await handleById(page, elementId), action, elementId);
  return { ...(target ? { target } : {}), ...(action ? { action } : {}) };
}

async function perform(state: ExplorationState, handle: Awaited<ReturnType<typeof handleById>>, action: Action, id: string) {
  try {
    await performAction(state.session.page, handle, action, state.session.appUrl);
  } catch (error) {
    const first = (error as Error).message.split("\n")[0] ?? "";
    throw new ToolError(t("en", "tool.actionFailed", { action: action.type, id, error: first }));
  }
  await ensureInApp(state);
}

/** If the page left the app (external link, blocked form submit), take it back to the start and tell the AI. */
async function ensureInApp(state: ExplorationState): Promise<void> {
  if (state.session.inApp()) return;
  const where = state.session.page.url();
  await state.session.goto(state.session.startUrl);
  throw new ToolError(t("en", "tool.leftApp", { url: where }));
}
