export const DESTRUCTIVE_WORDS = [
  "guardar", "enviar", "eliminar", "borrar", "pagar", "confirmar", "publicar",
  "save", "submit", "send", "delete", "remove", "pay", "confirm", "publish",
] as const;

export const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"] as const;

export interface AllowRule {
  method: string;
  /** Glob with `*`. Matched against the full URL when it starts with http, otherwise against path + query. */
  url: string;
}

export interface ElementFacts {
  tag: string;
  type?: string;
  role: string;
  name: string;
  inForm: boolean;
}

export type SafetyVerdict = { ok: true } | { ok: false; reason: "submit" | "destructive" };

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function isDestructiveName(name: string): boolean {
  const words = normalize(name).split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word) => (DESTRUCTIVE_WORDS as readonly string[]).includes(word));
}

export function checkClickSafety(el: ElementFacts): SafetyVerdict {
  const tag = el.tag.toLowerCase();
  const type = (el.type ?? "").toLowerCase();
  const submitButton = tag === "button" && el.inForm && (type === "" || type === "submit");
  const submitInput = tag === "input" && (type === "submit" || type === "image");
  if (submitButton || submitInput) return { ok: false, reason: "submit" };
  if (isDestructiveName(el.name)) return { ok: false, reason: "destructive" };
  return { ok: true };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function globMatch(pattern: string, value: string): boolean {
  const source = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${source}$`).test(value);
}

export function isRequestAllowed(method: string, url: string, allow: AllowRule[] = []): boolean {
  const upper = method.toUpperCase();
  if ((SAFE_METHODS as readonly string[]).includes(upper)) return true;
  const parsed = new URL(url);
  const pathAndQuery = parsed.pathname + parsed.search;
  return allow.some(
    (rule) =>
      rule.method.toUpperCase() === upper &&
      globMatch(rule.url, rule.url.startsWith("http") ? url : pathAndQuery),
  );
}
