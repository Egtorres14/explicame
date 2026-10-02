import { t, type Lang } from "@explicame/core";

/** A generation stopped on request (the panel's Stop button). */
export class CancelledError extends Error {
  constructor(lang: Lang) {
    super(t(lang, "build.cancelled"));
    this.name = "CancelledError";
  }
}

/** Ends the work in progress between two steps once a stop was requested. */
export function throwIfCancelled(signal: AbortSignal | undefined, lang: Lang): void {
  if (signal?.aborted) throw new CancelledError(lang);
}
