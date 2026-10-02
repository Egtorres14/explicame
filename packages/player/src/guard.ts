import { isRequestAllowed, type AllowRule } from "@explicame/core/safety";

export interface BlockedInfo {
  method: string;
  url: string;
}

interface GuardOptions {
  allow?: AllowRule[];
  onBlocked?: (info: BlockedInfo) => void;
}

type TrackedXhr = XMLHttpRequest & { __explicame?: BlockedInfo };

interface Patch {
  fetch: typeof window.fetch;
  open: typeof XMLHttpRequest.prototype.open;
  send: typeof XMLHttpRequest.prototype.send;
  originalFetch: typeof window.fetch;
  originalOpen: typeof XMLHttpRequest.prototype.open;
  originalSend: typeof XMLHttpRequest.prototype.send;
}

/** Installed guards, newest last. The patched functions read the newest one and let everything through when there is none. */
const active: GuardOptions[] = [];
let patch: Patch | null = null;

function absolute(url: string): string {
  try {
    return new URL(url, location.href).toString();
  } catch {
    return url;
  }
}

function blocking(method: string, url: string): GuardOptions | null {
  const guard = active[active.length - 1];
  return guard && !isRequestAllowed(method, url, guard.allow) ? guard : null;
}

function install(): void {
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  const guardedFetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = absolute(input instanceof Request ? input.url : String(input));
    const guard = blocking(method, url);
    if (guard) {
      guard.onBlocked?.({ method, url });
      return Promise.reject(new TypeError(`explicame: ${method} ${url} blocked during the guide`));
    }
    return originalFetch.call(window, input, init);
  } as typeof window.fetch;

  const guardedOpen = function guardedOpen(this: TrackedXhr, method: string, url: string | URL, ...rest: unknown[]) {
    this.__explicame = { method: method.toUpperCase(), url: absolute(String(url)) };
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  const guardedSend = function guardedSend(this: TrackedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = this.__explicame;
    const guard = info ? blocking(info.method, info.url) : null;
    if (info && guard) {
      guard.onBlocked?.(info);
      setTimeout(() => this.dispatchEvent(new ProgressEvent("error")));
      return;
    }
    originalSend.call(this, body);
  };

  window.fetch = guardedFetch;
  XMLHttpRequest.prototype.open = guardedOpen;
  XMLHttpRequest.prototype.send = guardedSend;
  patch = { fetch: guardedFetch, open: guardedOpen, send: guardedSend, originalFetch, originalOpen, originalSend };
}

function uninstall(): void {
  if (!patch) return;
  // Only what is still ours goes back: if the app wrapped fetch meanwhile, the guard stays inside its wrapper as a pass-through.
  if (window.fetch === patch.fetch) window.fetch = patch.originalFetch;
  if (XMLHttpRequest.prototype.open === patch.open) XMLHttpRequest.prototype.open = patch.originalOpen;
  if (XMLHttpRequest.prototype.send === patch.send) XMLHttpRequest.prototype.send = patch.originalSend;
  patch = null;
}

/**
 * Demo mode: write requests fail while a guide plays. Returns the function that removes this guard;
 * removing the last one, in any order, restores fetch and XHR.
 */
export function installWriteGuard(o: GuardOptions): () => void {
  const guard: GuardOptions = { allow: o.allow, onBlocked: o.onBlocked };
  active.push(guard);
  if (!patch) install();
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    active.splice(active.indexOf(guard), 1);
    if (active.length === 0) uninstall();
  };
}
