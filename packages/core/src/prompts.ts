import type { Lang } from "./guide.js";

export interface PromptContext {
  languages: Lang[];
  appUrl: string;
  startUrl: string;
  maxSteps: number;
  diff: string;
  files: { path: string; content: string }[];
  description?: string;
  omittedFiles: string[];
}

const LANGUAGE_NAMES: Record<Lang, string> = { es: "Spanish (es)", en: "English (en)" };

export function systemPrompt(languages: Lang[], maxSteps: number): string {
  const names = languages.map((l) => LANGUAGE_NAMES[l]).join(" and ");
  return [
    "You write the onboarding guide for a new feature of a web application. You explore the running app through tools, and every step you add is replayed later on the real screen with a highlight ring and a narrated voice.",
    "",
    "How to work:",
    "- Start with observe. Element ids (e1, e2, ...) come from the latest observation only; after anything changes the screen, use the observation the tool returns or call observe again.",
    "- Use act to reach the screen where the feature lives without creating guide steps. Use add_step for what the learner should see and do.",
    `- Write each narration natively in ${names}: one or two short sentences (at most 300 characters), friendly, in the second person, saying what the element is for rather than only its name.`,
    "- Focus on what the diff adds or changes. Mention other parts of the app only when the learner needs them to reach the feature.",
    "- Values you type or select are realistic examples. Nothing you do is saved, because requests that write data are blocked.",
    "- Buttons that save, send, delete, pay, confirm or publish, and form submit buttons, are pointed at with action null and explained; they are never clicked.",
    `- Use between 3 and ${maxSteps} steps, then call finish with a short title in every language.`,
  ].join("\n");
}

export function initialMessage(ctx: PromptContext): string {
  const parts = [`The app is running at ${ctx.appUrl} and the guide starts at ${ctx.startUrl}.`];
  if (ctx.description) parts.push(`What the author says the feature does:\n${ctx.description}`);
  parts.push(`The change to explain (git diff):\n<diff>\n${ctx.diff}\n</diff>`);
  if (ctx.omittedFiles.length) parts.push(`These files were left out of the diff because of its size: ${ctx.omittedFiles.join(", ")}.`);
  for (const file of ctx.files) parts.push(`Extra context file:\n<file path="${file.path}">\n${file.content}\n</file>`);
  parts.push("Plan the guide from the diff, then begin with observe.");
  return parts.join("\n\n");
}

export function repairMessage(index: number, error: string, observationJson: string): string {
  return [
    `When the guide was replayed from the start, step ${index + 1} failed: ${error}.`,
    "The screen is now at the state right before that step:",
    observationJson,
    `Call add_step once with the replacement for step ${index + 1}, pointing at an element from this observation.`,
  ].join("\n");
}

/** System prompt for plugin mode: the same rules, plus how finish verifies the guide and how a step is repaired. */
export function pluginPrompt(languages: Lang[], maxSteps: number): string {
  return [
    systemPrompt(languages, maxSteps),
    "",
    "In this mode you read the diff yourself (for example with git diff) before you start exploring.",
    "finish replays the whole guide in a fresh browser. If a step fails, finish returns the error and the screen right before that step: call add_step once with the replacement for that step (you may observe or act first). The guide is then verified again automatically, and it is saved only when every step passes.",
  ].join("\n");
}
