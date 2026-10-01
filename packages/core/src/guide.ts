import { z } from "zod";

export const LANGUAGES = ["es", "en"] as const;
export type Lang = (typeof LANGUAGES)[number];
export type LocalizedText = Partial<Record<Lang, string>>;
export const MAX_NARRATION = 300;
/** Same-origin path: starts with one slash, never two ("//host" would leave the app). */
export const SAME_ORIGIN_PATH = /^\/(?!\/)/;

export const StrategySchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("tour"), value: z.string().min(1) }),
  z.object({ by: z.literal("testid"), value: z.string().min(1) }),
  z.object({ by: z.literal("role"), role: z.string().min(1), name: z.string().min(1) }),
  z.object({ by: z.literal("label"), value: z.string().min(1) }),
  z.object({ by: z.literal("text"), value: z.string().min(1) }),
  z.object({ by: z.literal("css"), value: z.string().min(1) }),
]);
export type Strategy = z.infer<typeof StrategySchema>;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click") }),
  z.object({ type: z.literal("type"), value: z.string().min(1) }),
  z.object({ type: z.literal("select"), value: z.string().min(1) }),
  z.object({ type: z.literal("navigate"), url: z.string().regex(SAME_ORIGIN_PATH) }),
]);
export type Action = z.infer<typeof ActionSchema>;

const Localized = z.partialRecord(z.enum(LANGUAGES), z.string().min(1));

export const StepSchema = z.object({
  narration: Localized,
  target: z.object({ strategies: z.array(StrategySchema).min(1).max(6) }).optional(),
  action: ActionSchema.optional(),
  opens: z.enum(["dialog", "menu", "mode"]).optional(),
  audio: Localized.optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const GuideSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    languages: z.array(z.enum(LANGUAGES)).min(1),
    title: Localized,
    startUrl: z.string().regex(SAME_ORIGIN_PATH),
    steps: z.array(StepSchema).min(1),
    source: z.object({
      base: z.string(),
      head: z.string(),
      commit: z.string(),
      generatedBy: z.enum(["api", "claude-code", "fake"]),
      model: z.string().optional(),
      createdAt: z.string(),
    }),
  })
  .superRefine((guide, ctx) => {
    const requireAll = (text: LocalizedText, path: (string | number)[]) => {
      for (const lang of guide.languages) {
        const value = text[lang];
        if (!value) ctx.addIssue({ code: "custom", path: [...path, lang], message: `missing ${lang}` });
        else if (value.length > MAX_NARRATION)
          ctx.addIssue({ code: "custom", path: [...path, lang], message: `longer than ${MAX_NARRATION} characters` });
      }
    };
    requireAll(guide.title, ["title"]);
    guide.steps.forEach((step, index) => {
      requireAll(step.narration, ["steps", index, "narration"]);
      if (step.action && step.action.type !== "navigate" && !step.target)
        ctx.addIssue({ code: "custom", path: ["steps", index, "action"], message: "this action needs a target" });
    });
  });
export type Guide = z.infer<typeof GuideSchema>;

export type ValidationResult = { ok: true; guide: Guide } | { ok: false; errors: string[] };

export function validateGuide(input: unknown): ValidationResult {
  const result = GuideSchema.safeParse(input);
  if (result.success) return { ok: true, guide: result.data };
  return { ok: false, errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
