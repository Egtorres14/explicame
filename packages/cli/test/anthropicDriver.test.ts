import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { buildTools } from "@explicame/core";
import { countFirstTurnTokens, createAnthropicDriver, estimateCostUsd } from "../src/generate/anthropicDriver.js";

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 };
const message = (content: unknown[], stop_reason: string) => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage,
});

function mockClient(responses: unknown[]) {
  const create = vi.fn(async (_params: Record<string, unknown>) => responses.shift());
  const countTokens = vi.fn(async (_params: Record<string, unknown>) => ({ input_tokens: 4321 }));
  const client = { beta: { messages: { create } }, messages: { countTokens } } as unknown as Anthropic;
  return { client, create, countTokens };
}

describe("createAnthropicDriver", () => {
  it("starts with the configured model, effort, fallbacks, caching and tools", async () => {
    const { client, create } = mockClient([message([{ type: "tool_use", id: "tu_1", name: "observe", input: {} }], "tool_use")]);
    const driver = createAnthropicDriver({ apiKey: "k", model: "claude-opus-5-5", effort: "high", client });
    const turn = await driver.start("system text", "user text", buildTools(["es"]));
    expect(turn).toEqual({ calls: [{ id: "tu_1", name: "observe", input: {} }], text: "", stop: "tool_use" });
    const params = create.mock.calls[0]![0];
    expect(params).toMatchObject({
      model: "claude-opus-5-5", max_tokens: 16000, system: "system text",
      cache_control: { type: "ephemeral" }, output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      messages: [{ role: "user", content: "user text" }],
    });
    expect((params.tools as { name: string }[]).map((t) => t.name)).toEqual(["observe", "act", "add_step", "finish"]);
    expect(params).not.toHaveProperty("tool_choice");
  });

  it("replies with tool results, keeps the history append-only and sums usage", async () => {
    const first = message([{ type: "text", text: "Mirando." }, { type: "tool_use", id: "tu_1", name: "observe", input: {} }], "tool_use");
    const { client, create } = mockClient([first, message([{ type: "text", text: "Listo." }], "end_turn")]);
    const driver = createAnthropicDriver({ apiKey: "k", model: "claude-opus-5-5", effort: "high", client });
    await driver.start("s", "u", buildTools(["es"]));
    const turn = await driver.reply([{ id: "tu_1", content: "boom", isError: true }], "note");
    expect(turn).toEqual({ calls: [], text: "Listo.", stop: "end_turn" });
    const messages = create.mock.calls[1]![0].messages as { role: string; content: unknown }[];
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: "assistant", content: first.content });
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: "boom", is_error: true }, { type: "text", text: "note" }],
    });
    expect(driver.usage()).toEqual({ inputTokens: 300, outputTokens: 40 });
  });

  it("maps refusals and unknown stop reasons", async () => {
    const { client } = mockClient([message([], "refusal"), message([], "pause_turn")]);
    const driver = createAnthropicDriver({ apiKey: "k", model: "claude-opus-5-5", effort: "high", client });
    expect((await driver.start("s", "u", [])).stop).toBe("refusal");
    expect((await driver.reply([])).stop).toBe("other");
  });
});

describe("cost estimate", () => {
  it("counts the first turn with the token counting endpoint", async () => {
    const { client, countTokens } = mockClient([]);
    expect(await countFirstTurnTokens(client, "claude-opus-5-5", "s", "u", buildTools(["es"]))).toBe(4321);
    expect(countTokens.mock.calls[0]![0]).toMatchObject({ model: "claude-opus-5-5", system: "s", messages: [{ role: "user", content: "u" }] });
  });

  it("estimates from the price table and returns null for unknown models", () => {
    const opus = estimateCostUsd("claude-opus-5-5", 4000, 15)!;
    const sonnet = estimateCostUsd("claude-sonnet-5-5", 4000, 15)!;
    expect(opus).toBeGreaterThan(0);
    expect(opus).toBeCloseTo(sonnet * 2, 6);
    expect(estimateCostUsd("some-other-model", 4000, 15)).toBeNull();
  });
});
