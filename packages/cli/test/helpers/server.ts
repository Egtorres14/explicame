import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

export interface TestServer {
  url: string;
  hits: { method: string; path: string }[];
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

/** Static server for tests. Any non-GET request under /api/ answers 200 and is recorded in `hits`. */
export async function startServer(root: string): Promise<TestServer> {
  const hits: TestServer["hits"] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    hits.push({ method, path: url.pathname });
    if (url.pathname.startsWith("/api/") && method !== "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    const relative = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
    const file = join(root, normalize(relative).replace(/^[/\\]+/, ""));
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
