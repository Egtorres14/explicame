import { z } from "zod";
import { MAX_NARRATION, type Action, type Lang, type LocalizedText } from "./guide.js";

export const TOOL_NAMES = ["observe", "act", "add_step", "finish"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const ACTION_KINDS = ["click", "type", "select", "navigate"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const OPENS_KINDS = ["dialog", "menu", "mode"] as const;
export type OpensKind = (typeof OPENS_KINDS)[number];

export interface ToolDef {
  name: ToolName;
  description: string;
  input_schema: Record<string, unknown>;
}

const nullableString = (description: string) => ({ type: ["string", "null"], description });

export function buildTools(languages: Lang[]): ToolDef[] {
  const localized = (description: string) => ({
    type: "object",
    description,
    properties: Object.fromEntries(languages.map((l) => [l, { type: "string", description: l === "es" ? "Spanish" : "English" }])),
    required: [...languages],
    additionalProperties: false,
  });
  return [
    {
      name: "observe",
      description: "Returns the current URL and the map of visible elements. Every element has an id such as e7; ids are valid until the screen changes.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "act",
      description: "Performs an action on the page without adding a step to the guide, to reach the screen where the feature lives. Returns the new map of elements.",
      input_schema: {
        type: "object",
        properties: {
          element_id: nullableString("Element id from the latest observation; null for navigate."),
          action: { type: "string", enum: [...ACTION_KINDS] },
          value: nullableString("Example text to type, or the label of the option to select; null otherwise."),
          url: nullableString("Same-origin path for navigate, such as /reports; null otherwise."),
        },
        required: ["element_id", "action", "value", "url"],
        additionalProperties: false,
      },
    },
    {
      name: "add_step",
      description: "Adds the next step of the guide: the narration, the element it points at (null for a narration-only step) and the action performed after the narration (null to only point at the element). Returns the new map of elements.",
      input_schema: {
        type: "object",
        properties: {
          narration: localized("What the narrator says in this step, written natively in each language."),
          element_id: nullableString("Element id from the latest observation, or null."),
          action: { type: ["string", "null"], enum: [...ACTION_KINDS, null] },
          value: nullableString("Example text to type, or the label of the option to select; null otherwise."),
          url: nullableString("Same-origin path for navigate; null otherwise."),
          opens: { type: ["string", "null"], enum: [...OPENS_KINDS, null], description: "What the action leaves open (so it can be closed when the learner exits), or null." },
        },
        required: ["narration", "element_id", "action", "value", "url", "opens"],
        additionalProperties: false,
      },
    },
    {
      name: "finish",
      description: "Ends the guide with a short title in every language.",
      input_schema: {
        type: "object",
        properties: { title: localized("Short title of the guide.") },
        required: ["title"],
        additionalProperties: false,
      },
    },
  ];
}

export type ParsedCall =
  | { name: "observe" }
  | { name: "act"; elementId: string | null; action: ActionKind; value: string | null; url: string | null }
  | {
      name: "add_step";
      narration: LocalizedText;
      elementId: string | null;
      action: ActionKind | null;
      value: string | null;
      url: string | null;
      opens: OpensKind | null;
    }
  | { name: "finish"; title: LocalizedText };

function localizedSchema(languages: Lang[]) {
  const shape: Record<string, z.ZodString> = {};
  for (const lang of languages) shape[lang] = z.string().min(1).max(MAX_NARRATION);
  return z.strictObject(shape);
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`).join("; ");
}

export function parseToolCall(
  name: string,
  input: unknown,
  languages: Lang[],
): { ok: true; call: ParsedCall } | { ok: false; error: string } {
  if (name === "observe") return { ok: true, call: { name: "observe" } };
  if (name === "act") {
    const r = z
      .object({ element_id: z.string().nullable(), action: z.enum(ACTION_KINDS), value: z.string().nullable(), url: z.string().nullable() })
      .safeParse(input);
    if (!r.success) return { ok: false, error: formatIssues(r.error) };
    return { ok: true, call: { name: "act", elementId: r.data.element_id, action: r.data.action, value: r.data.value, url: r.data.url } };
  }
  if (name === "add_step") {
    const r = z
      .object({
        narration: localizedSchema(languages),
        element_id: z.string().nullable(),
        action: z.enum(ACTION_KINDS).nullable(),
        value: z.string().nullable(),
        url: z.string().nullable(),
        opens: z.enum(OPENS_KINDS).nullable(),
      })
      .safeParse(input);
    if (!r.success) return { ok: false, error: formatIssues(r.error) };
    return {
      ok: true,
      call: {
        name: "add_step",
        narration: r.data.narration as LocalizedText,
        elementId: r.data.element_id,
        action: r.data.action,
        value: r.data.value,
        url: r.data.url,
        opens: r.data.opens,
      },
    };
  }
  if (name === "finish") {
    const r = z.object({ title: localizedSchema(languages) }).safeParse(input);
    if (!r.success) return { ok: false, error: formatIssues(r.error) };
    return { ok: true, call: { name: "finish", title: r.data.title as LocalizedText } };
  }
  return { ok: false, error: `unknown tool ${name}` };
}

export function toAction(kind: ActionKind, value: string | null, url: string | null): { ok: true; action: Action } | { ok: false; error: string } {
  if (kind === "click") return { ok: true, action: { type: "click" } };
  if (kind === "navigate") {
    return url && url.startsWith("/")
      ? { ok: true, action: { type: "navigate", url } }
      : { ok: false, error: "navigate needs a same-origin url that starts with /" };
  }
  if (!value) return { ok: false, error: `${kind} needs a value (an example)` };
  return { ok: true, action: { type: kind, value } };
}
