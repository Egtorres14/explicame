import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { LANGUAGES, t, type Lang } from "@explicame/core";
import { build } from "../build.js";
import { ConfigError, ConfigSchema, loadConfig, saveConfig, type Config } from "../config.js";
import { CREDENTIAL_ENV, describeCredentials, loadCredentials, saveCredential, type Credentials } from "../credentials.js";
import type { LlmDriver } from "../generate/driver.js";
import { login } from "../login.js";
import { readGuide, type GuideIndexEntry } from "../output.js";
import { recordLanguages } from "../record.js";
import { VERSION } from "../version.js";
import { cloneElevenLabsVoice } from "../voice/elevenlabs.js";
import { buildVoiceProviders } from "../voice/index.js";
import { synthesizeWithCache, VoiceError, type VoiceProvider } from "../voice/provider.js";

export interface PanelOptions {
  cwd: string;
  home: string;
  /** 4747 by default; 0 picks a free port. */
  port?: number;
  token?: string;
  /** Test seams: a scripted AI, silent voices, a login without a window and a fake ElevenLabs. */
  driver?: () => LlmDriver;
  voiceProviders?: () => VoiceProvider[];
  login?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  /** Where environment keys come from (process.env by default). */
  env?: NodeJS.ProcessEnv;
}

export interface Panel {
  url: string;
  token: string;
  close(): Promise<void>;
}

type JobEvent =
  | { type: "log"; message: string }
  | { type: "shot"; data: string }
  | { type: "done"; guide: string; videos: string[] }
  | { type: "error"; message: string };

interface Job {
  id: string;
  events: JobEvent[];
  listeners: Set<(event: JobEvent) => void>;
  finished: boolean;
  controller: AbortController;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const CREDENTIAL_NAMES = Object.keys(CREDENTIAL_ENV) as (keyof Credentials)[];
const MAX_BODY = 25 * 1024 * 1024; // voice samples for cloning travel as base64
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const VoiceTestSchema = z.strictObject({
  lang: z.enum(LANGUAGES),
  provider: z.enum(["elevenlabs", "deepgram", "openai", "piper", "command", "fake"]),
  voice: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(300),
});
const CloneSchema = z.strictObject({
  name: z.string().min(1).max(100),
  consent: z.literal(true),
  files: z.array(z.strictObject({ name: z.string().min(1).max(200), data: z.string().min(1) })).min(1).max(10),
});
const JobSchema = z.strictObject({
  kind: z.enum(["build", "from-guide"]),
  describe: z.string().max(2000).optional(),
  files: z.array(z.string().min(1)).max(20).optional(),
  guide: z.string().regex(ID).optional(),
  video: z.boolean().optional(),
});
type JobRequest = z.infer<typeof JobSchema>;

/** Where the built panel lives (the @explicame/panel package). */
export function panelDist(): string {
  return join(dirname(createRequire(import.meta.url).resolve("@explicame/panel/package.json")), "dist");
}

/** A file inside root, or null when the requested path would leave it. */
export function containedPath(root: string, relative: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const file = resolve(base, decoded.replace(/^[/\\]+/, ""));
  return file.startsWith(base + sep) ? file : null;
}

function sameSecret(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, "Not found");
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  // <video> seeks with Range requests.
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end) throw new HttpError(416, "Range not satisfiable");
    res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${info.size}`, "accept-ranges": "bytes", "cache-control": "no-store" });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": info.size, "accept-ranges": "bytes", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}

/**
 * The local panel: only on 127.0.0.1, only under its own host name, and only with the session token in the URL
 * or in every request. Keys go in and never come back out whole.
 */
export async function startPanel(o: PanelOptions): Promise<Panel> {
  const token = o.token ?? randomBytes(24).toString("base64url");
  const env = o.env ?? process.env;
  const dist = panelDist();
  let port = 0;
  let job: Job | null = null;

  const config = () => loadConfig(o.cwd);
  const lenientConfig = () => config().catch(() => ConfigSchema.parse({}));

  async function guides(current: Config) {
    const outputRoot = resolve(o.cwd, current.outputDir);
    const videoDir = resolve(o.cwd, current.videoDir);
    let index: GuideIndexEntry[];
    try {
      index = JSON.parse(await readFile(join(outputRoot, "guides.json"), "utf8")) as GuideIndexEntry[];
    } catch {
      return [];
    }
    const videos = existsSync(videoDir) ? await readdir(videoDir) : [];
    const out = [];
    for (const entry of index) {
      try {
        const guide = await readGuide(join(outputRoot, entry.id, "guide.json"));
        out.push({
          id: guide.id,
          title: guide.title,
          languages: guide.languages,
          steps: guide.steps.map((step) => ({ narration: step.narration, audio: step.audio })),
          videos: videos.filter((file) => file.startsWith(`${guide.id}.`) && file.endsWith(".mp4")),
        });
      } catch {
        // a guide that no longer validates is left out of the list
      }
    }
    return out;
  }

  async function state() {
    let current: Config;
    let configError: string | null = null;
    try {
      current = await config();
    } catch (error) {
      current = ConfigSchema.parse({});
      configError = (error as Error).message;
    }
    return {
      version: VERSION,
      cwd: o.cwd,
      config: current,
      configError,
      credentials: await describeCredentials(env, o.home),
      guides: await guides(current),
      job: job ? { id: job.id, running: !job.finished } : null,
    };
  }

  async function runJob(request: JobRequest, emit: (event: JobEvent) => void, signal: AbortSignal): Promise<{ guide: string; videos: string[] }> {
    const current = await config();
    const log = (message: string) => emit({ type: "log", message });
    const fromGuide = request.kind === "from-guide" ? join(resolve(o.cwd, current.outputDir), request.guide!, "guide.json") : undefined;
    const result = await build({
      cwd: o.cwd,
      config: current,
      credentials: await loadCredentials(env, o.home),
      home: o.home,
      log,
      onShot: (jpeg) => emit({ type: "shot", data: jpeg.toString("base64") }),
      describe: request.describe,
      files: request.files,
      fromGuide,
      driver: o.driver?.(),
      voiceProviders: o.voiceProviders?.(),
      signal,
    });
    const videos = request.video
      ? await recordLanguages({ guidePath: join(result.dir, "guide.json"), config: current, cwd: o.cwd, home: o.home, log, signal })
      : [];
    return { guide: result.guide.id, videos: videos.map((file) => basename(file)) };
  }

  function startJob(request: JobRequest): Job {
    const current: Job = { id: randomBytes(6).toString("hex"), events: [], listeners: new Set(), finished: false, controller: new AbortController() };
    const emit = (event: JobEvent) => {
      current.events.push(event);
      for (const listener of current.listeners) listener(event);
    };
    job = current;
    void runJob(request, emit, current.controller.signal).then(
      (result) => {
        current.finished = true;
        emit({ type: "done", ...result });
      },
      (error: unknown) => {
        current.finished = true;
        emit({ type: "error", message: (error as Error).message });
      },
    );
    return current;
  }

  function streamJob(req: IncomingMessage, res: ServerResponse, current: Job): void {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    // Every event carries its index as id, so a page that reconnects can skip what it already showed.
    const write = (event: JobEvent, index: number) => res.write(`id: ${index}\ndata: ${JSON.stringify(event)}\n\n`);
    current.events.forEach(write);
    if (current.finished) {
      res.end();
      return;
    }
    const listener = (event: JobEvent) => {
      write(event, current.events.length - 1);
      if (event.type === "done" || event.type === "error") res.end();
    };
    current.listeners.add(listener);
    req.on("close", () => current.listeners.delete(listener));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? "";
    // A page on another site can resolve its own name to 127.0.0.1 (DNS rebinding); it still carries its own Host.
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, "Forbidden host");
    const url = new URL(req.url ?? "/", `http://${host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    const queryToken = url.searchParams.get("t");

    if (method === "GET" && (path === "/" || path === "/index.html")) {
      if (!sameSecret(queryToken, token)) throw new HttpError(401, t((await lenientConfig()).uiLanguage, "panel.badToken"));
      return sendFile(req, res, join(dist, "index.html"));
    }
    if (method === "GET" && path.startsWith("/assets/")) {
      const file = containedPath(join(dist, "assets"), path.slice("/assets/".length));
      if (!file) throw new HttpError(404, "Not found");
      return sendFile(req, res, file);
    }
    if (method === "GET" && path.startsWith("/files/")) {
      if (!sameSecret(queryToken, token)) throw new HttpError(401, "Unauthorized");
      const current = await lenientConfig();
      const [kind, ...rest] = path.slice("/files/".length).split("/");
      const root = kind === "output" ? resolve(o.cwd, current.outputDir) : kind === "videos" ? resolve(o.cwd, current.videoDir) : null;
      const file = root ? containedPath(root, rest.join("/")) : null;
      if (!file) throw new HttpError(404, "Not found");
      return sendFile(req, res, file);
    }
    if (!path.startsWith("/api/")) throw new HttpError(404, "Not found");
    // EventSource cannot send headers, so the token may also come in the query string.
    const header = req.headers["x-explicame-token"];
    if (!sameSecret(typeof header === "string" ? header : queryToken, token)) throw new HttpError(401, "Unauthorized");

    if (method === "GET" && path === "/api/state") return sendJson(res, 200, await state());

    if (method === "PUT" && path === "/api/config") {
      const body = await readBody(req);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Expected an object");
      return sendJson(res, 200, { config: await saveConfig(o.cwd, body as Record<string, unknown>) });
    }

    const credential = /^\/api\/credentials\/([a-z]+)$/.exec(path);
    if (credential && (method === "PUT" || method === "DELETE")) {
      const name = credential[1] as keyof Credentials;
      if (!CREDENTIAL_NAMES.includes(name)) throw new HttpError(404, "Unknown key");
      let value: string | null = null;
      if (method === "PUT") {
        const given = ((await readBody(req)) as { value?: unknown }).value;
        if (typeof given !== "string" || !given.trim()) throw new HttpError(400, "Empty key");
        value = given;
      }
      await saveCredential(o.home, name, value);
      return sendJson(res, 200, { credentials: await describeCredentials(env, o.home) });
    }

    if (method === "POST" && path === "/api/voice/test") {
      const body = VoiceTestSchema.parse(await readBody(req));
      const current = await lenientConfig();
      const voices = body.voice ? { ...current.voice.voices, [body.lang]: body.voice } : current.voice.voices;
      const providers =
        o.voiceProviders?.() ??
        buildVoiceProviders({ ...current, voice: { ...current.voice, provider: body.provider, fallback: [], voices } }, await loadCredentials(env, o.home), { home: o.home });
      if (providers.length === 0) throw new HttpError(400, t(current.uiLanguage, "panel.noVoice", { provider: body.provider }));
      const { audio } = await synthesizeWithCache(providers.slice(0, 1), { text: body.text, lang: body.lang as Lang, speed: current.voice.speed }, join(o.home, "cache", "voice"), 1);
      res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
      res.end(audio);
      return;
    }

    if (method === "POST" && path === "/api/voice/clone") {
      const body = CloneSchema.parse(await readBody(req));
      const creds = await loadCredentials(env, o.home);
      if (!creds.elevenlabs) throw new HttpError(400, t((await lenientConfig()).uiLanguage, "panel.noVoice", { provider: "elevenlabs" }));
      const voiceId = await cloneElevenLabsVoice({
        apiKey: creds.elevenlabs,
        name: body.name,
        consent: body.consent,
        files: body.files.map((file) => ({ name: file.name, data: Buffer.from(file.data, "base64") })),
        fetchImpl: o.fetchImpl,
      });
      return sendJson(res, 200, { voiceId });
    }

    if (method === "POST" && path === "/api/login") {
      const file = o.login ? await o.login() : await login({ cwd: o.cwd, config: await config(), home: o.home, log: () => {} });
      return sendJson(res, 200, { path: file });
    }

    if (method === "POST" && path === "/api/jobs") {
      const body = JobSchema.parse(await readBody(req));
      if (job && !job.finished) throw new HttpError(409, t((await lenientConfig()).uiLanguage, "panel.busy"));
      if (body.kind === "from-guide" && !body.guide) throw new HttpError(400, "guide is required");
      return sendJson(res, 202, { id: startJob(body).id });
    }

    const stop = /^\/api\/jobs\/([a-f0-9]+)$/.exec(path);
    if (method === "DELETE" && stop) {
      if (!job || job.id !== stop[1]) throw new HttpError(404, "No such job");
      job.controller.abort();
      return sendJson(res, 202, { stopping: !job.finished });
    }

    const events = /^\/api\/jobs\/([a-f0-9]+)\/events$/.exec(path);
    if (method === "GET" && events) {
      if (!job || job.id !== events[1]) throw new HttpError(404, "No such job");
      return streamJob(req, res, job);
    }
    throw new HttpError(404, "Not found");
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      const status =
        error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof ConfigError || error instanceof VoiceError ? 400 : 500;
      const message = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; ") : (error as Error).message;
      if (res.headersSent) res.end();
      else sendJson(res, status, { error: message });
    });
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(o.port ?? 4747, "127.0.0.1", () => done());
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/?t=${token}`,
    token,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
