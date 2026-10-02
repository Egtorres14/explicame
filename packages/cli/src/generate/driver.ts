import type { ToolDef } from "@explicame/core";

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export type StopReason = "tool_use" | "end_turn" | "max_tokens" | "refusal" | "other";

export interface LlmTurn {
  calls: ToolCall[];
  text: string;
  stop: StopReason;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** One conversation with a model. `reply` sends the results of the previous turn's calls (and an optional note). */
export interface LlmDriver {
  readonly id: "api" | "fake";
  readonly model?: string;
  start(system: string, user: string, tools: ToolDef[]): Promise<LlmTurn>;
  reply(results: ToolResult[], note?: string): Promise<LlmTurn>;
  usage(): Usage;
}
