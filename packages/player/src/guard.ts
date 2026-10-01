import { isRequestAllowed, type AllowRule } from "@explicame/core/safety";

export interface BlockedInfo {
  method: string;
  url: string;
}

type TrackedXhr = XMLHttpRequest & { __explicame?: BlockedInfo };

/** Demo mode: write requests fail while a guide plays. Returns the function that restores fetch and XHR. */
export function installWriteGuard(o: { allow?: AllowRule[]; onBlocked?: (info: BlockedInfo) => void }): () => void {
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const absolute = (url: string) => new URL(url, location.href).toString();

  window.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = absolute(input instanceof Request ? input.url : String(input));
    if (!isRequestAllowed(method, url, o.allow)) {
      o.onBlocked?.({ method, url });
      return Promise.reject(new TypeError(`explicame: ${method} ${url} blocked during the guide`));
    }
    return originalFetch.call(window, input, init);
  } as typeof window.fetch;

  XMLHttpRequest.prototype.open = function guardedOpen(this: TrackedXhr, method: string, url: string | URL, ...rest: unknown[]) {
    this.__explicame = { method: method.toUpperCase(), url: absolute(String(url)) };
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function guardedSend(this: TrackedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = this.__explicame;
    if (info && !isRequestAllowed(info.method, info.url, o.allow)) {
      o.onBlocked?.(info);
      setTimeout(() => this.dispatchEvent(new ProgressEvent("error")));
      return;
    }
    originalSend.call(this, body);
  };

  return () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  };
}
