const token = new URLSearchParams(location.search).get("t") ?? "";

/** Adds the session token to a URL that the browser loads by itself (audio, video, downloads, EventSource). */
export const withToken = (url: string): string => `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    method,
    headers: { "x-explicame-token": token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `HTTP ${response.status}`);
  }
  return response;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await call(method, path, body)).json()) as T;
}

export async function apiBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  return (await call(method, path, body)).blob();
}
