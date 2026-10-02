import Anthropic from "@anthropic-ai/sdk";
import type { ToolDef } from "@explicame/core";
import type { LlmDriver, LlmTurn, StopReason, ToolResult, Usage } from "./driver.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicDriverOptions {
  apiKey: string;
  model: string;
  effort: Effort;
  client?: Anthropic;
}

/** USD per million tokens (first-party API rates). */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

function mapStop(reason: string | null): StopReason {
  return reason === "tool_use" || reason === "end_turn" || reason === "max_tokens" || reason === "refusal" ? reason : "other";
}

function toApiTools(defs: ToolDef[]): Anthropic.Beta.BetaTool[] {
  return defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema as Anthropic.Beta.BetaTool.InputSchema }));
}

export function createAnthropicDriver(o: AnthropicDriverOptions): LlmDriver {
  const client = o.client ?? new Anthropic({ apiKey: o.apiKey });
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  let system = "";
  let tools: Anthropic.Beta.BetaTool[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  async function send(): Promise<LlmTurn> {
    const response = await client.beta.messages.create({
      model: o.model,
      max_tokens: 16000,
      system,
      tools,
      messages: [...messages],
      cache_control: { type: "ephemeral" },
      output_config: { effort: o.effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    usage.inputTokens +=
      response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
    usage.outputTokens += response.usage.output_tokens;
    messages.push({ role: "assistant", content: response.content });
    const calls = response.content.flatMap((block) => (block.type === "tool_use" ? [{ id: block.id, name: block.name, input: block.input }] : []));
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    return { calls, text, stop: mapStop(response.stop_reason) };
  }

  return {
    id: "api",
    model: o.model,
    async start(systemText, user, defs) {
      system = systemText;
      tools = toApiTools(defs);
      messages.push({ role: "user", content: user });
      return send();
    },
    async reply(results: ToolResult[], note?: string) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      }));
      if (note) content.push({ type: "text", text: note });
      messages.push({ role: "user", content });
      return send();
    },
    usage: () => ({ ...usage }),
  };
}

export async function countFirstTurnTokens(client: Anthropic, model: string, system: string, user: string, defs: ToolDef[]): Promise<number> {
  const result = await client.messages.countTokens({
    model,
    system,
    tools: defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.input_schema as Anthropic.Tool.InputSchema })),
    messages: [{ role: "user", content: user }],
  });
  return result.input_tokens;
}

/**
 * Rough estimate, shown before generating: about two model rounds per step, each adding ~1.5k tokens of
 * observation and ~600 output tokens, with the cached history billed at ~10% of the input price.
 */
export function estimateCostUsd(model: string, firstTurnInputTokens: number, maxSteps: number): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const rounds = maxSteps * 2;
  const newInputPerRound = 1500;
  const outputPerRound = 600;
  const averagePrefix = firstTurnInputTokens + (rounds * newInputPerRound) / 2;
  const inputTokens = rounds * (newInputPerRound + 0.1 * averagePrefix);
  const outputTokens = rounds * outputPerRound;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
