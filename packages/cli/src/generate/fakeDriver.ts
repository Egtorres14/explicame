import { readFile } from "node:fs/promises";
import type { Observation } from "@explicame/core";
import type { LlmDriver, LlmTurn, ToolResult } from "./driver.js";

export interface FakeCall {
  name: string;
  /** May carry `element: { name?, label?, role? }`, resolved to `element_id` against the latest observation. */
  input: Record<string, unknown>;
}

export interface FakeScript {
  turns: FakeCall[][];
}

function parseObservation(text: string): Observation | null {
  try {
    const value = JSON.parse(text) as { elements?: unknown; observation?: { elements?: unknown } };
    if (Array.isArray(value.elements)) return value as unknown as Observation;
    if (value.observation && Array.isArray(value.observation.elements)) return value.observation as unknown as Observation;
  } catch {
    return null;
  }
  return null;
}

function observationInNote(note: string): Observation | null {
  for (const line of note.split("\n")) {
    if (line.startsWith("{")) {
      const found = parseObservation(line);
      if (found) return found;
    }
  }
  return null;
}

function resolveElement(input: Record<string, unknown>, observation: Observation | null): Record<string, unknown> {
  const wanted = input.element as { name?: string; label?: string; role?: string } | undefined;
  if (!wanted || typeof wanted !== "object") return input;
  const match = observation?.elements.find(
    (e) =>
      (wanted.name === undefined || e.name === wanted.name) &&
      (wanted.label === undefined || e.label === wanted.label) &&
      (wanted.role === undefined || e.role === wanted.role),
  );
  const { element: _element, ...rest } = input;
  return { ...rest, element_id: match ? match.id : "missing" };
}

export function createFakeDriver(script: FakeScript): LlmDriver & { received: ToolResult[][]; notes: string[] } {
  const received: ToolResult[][] = [];
  const notes: string[] = [];
  let turn = 0;
  let counter = 0;
  let latest: Observation | null = null;

  const next = (): LlmTurn => {
    const calls = script.turns[turn++];
    if (!calls) return { calls: [], text: "", stop: "end_turn" };
    return {
      calls: calls.map((call) => ({ id: `fake_${++counter}`, name: call.name, input: resolveElement(call.input, latest) })),
      text: "",
      stop: "tool_use",
    };
  };

  return {
    id: "fake",
    model: "fake",
    received,
    notes,
    async start() {
      return next();
    },
    async reply(results, note) {
      received.push(results);
      for (const result of results) latest = parseObservation(result.content) ?? latest;
      if (note) {
        notes.push(note);
        latest = observationInNote(note) ?? latest;
      }
      return next();
    },
    usage: () => ({ inputTokens: 0, outputTokens: 0 }),
  };
}

export async function loadFakeScript(path: string): Promise<FakeScript> {
  return JSON.parse(await readFile(path, "utf8")) as FakeScript;
}
