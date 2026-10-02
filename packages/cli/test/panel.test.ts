import { execFile } from "node:child_process";
import { request } from "node:http";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LlmDriver } from "../src/generate/driver.js";
import { startPanel, type Panel } from "../src/panel/server.js";
import { createFakeVoiceProvider } from "../src/voice/fake.js";
import { startServer, type TestServer } from "./helpers/server.js";

const run = promisify(execFile);
const git = (dir: string, ...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir });
const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));

let site: TestServer;
let cwd: string;
let home: string;
let panel: Panel;
interface Gate {
  started: Promise<void>;
  markStarted(): void;
  released: Promise<void>;
  release(): void;
}
function newGate(): Gate {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((done) => (markStarted = done));
  const released = new Promise<void>((done) => (release = done));
  return { started, markStarted, released, release };
}
let gate = newGate();
/** What the AI does once released: fail, or ask to observe (a step where a stop request is noticed). */
let afterRelease: "throw" | "observe" = "throw";
const fetchImpl = vi.fn(async () => Response.json({ voice_id: "cloned123", requires_verification: false }));

/** An AI that says when it was called and then waits until the test releases it, to see a job running. */
const waitingDriver = (): LlmDriver => ({
  id: "fake",
  async start() {
    gate.markStarted();
    await gate.released;
    if (afterRelease === "throw") throw new Error("released");
    return { calls: [{ id: "c1", name: "observe", input: {} }], text: "", stop: "tool_use" as const };
  },
  async reply() {
    throw new Error("unused");
  },
  usage: () => ({ inputTokens: 0, outputTokens: 0 }),
});

beforeAll(async () => {
  site = await startServer(SITE);
  cwd = await mkdtemp(join(tmpdir(), "explicame-panel-"));
  home = await mkdtemp(join(tmpdir(), "explicame-panel-home-"));
  await git(cwd, "init", "-b", "main");
  await writeFile(join(cwd, "explicame.config.json"), JSON.stringify({ appUrl: site.url, voice: { provider: "fake" } }));
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "base");
  await git(cwd, "checkout", "-b", "feature");
  await writeFile(join(cwd, "filter.ts"), "export const filter = true;\n");
  await git(cwd, "add", "filter.ts");
  await git(cwd, "commit", "-m", "feature");
  panel = await startPanel({
    cwd, home, port: 0, env: {}, driver: waitingDriver, voiceProviders: () => [createFakeVoiceProvider()],
    login: async () => join(home, "sessions", "app.json"), fetchImpl: fetchImpl as unknown as typeof fetch,
  });
});
afterAll(async () => {
  gate.release();
  await panel.close();
  await site.close();
});

const origin = () => new URL(panel.url).origin;
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${origin()}${path}`, { ...init, headers: { "x-explicame-token": panel.token, "content-type": "application/json", ...init.headers } });

function rawGet(path: string, host: string): Promise<number> {
  const url = new URL(panel.url);
  return new Promise((done, fail) => {
    const req = request({ host: url.hostname, port: url.port, path, headers: { host, "x-explicame-token": panel.token } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on("error", fail);
    req.end();
  });
}

describe("panel server", () => {
  it("listens on 127.0.0.1 and asks for the session token on the page and the API", async () => {
    expect(new URL(panel.url).hostname).toBe("127.0.0.1");
    expect(panel.token.length).toBeGreaterThanOrEqual(32);
    expect((await fetch(`${origin()}/?t=wrong`)).status).toBe(401);
    expect((await fetch(panel.url)).status).toBe(200);
    expect((await fetch(`${origin()}/api/state`)).status).toBe(401);
    const state = (await (await api("/api/state")).json()) as { config: { appUrl: string }; version: string };
    expect(state.config.appUrl).toBe(site.url);
    expect(state.version).toBe("0.1.0");
  });

  it("rejects requests that arrive under another host name", async () => {
    expect(await rawGet("/api/state", "evil.example")).toBe(403);
    expect(await rawGet("/api/state", `localhost:${new URL(panel.url).port}`)).toBe(200);
  });

  it("stores a key in the user's folder and never sends it back whole", async () => {
    const saved = await api("/api/credentials/openai", { method: "PUT", body: JSON.stringify({ value: "sk-openai-secret-9876" }) });
    const body = await saved.text();
    expect(body).not.toContain("sk-openai-secret");
    expect(JSON.parse(body).credentials.openai).toEqual({ set: true, masked: "••••9876", source: "file" });
    expect(await (await api("/api/state")).text()).not.toContain("sk-openai-secret");
    const file = join(home, "credentials.json");
    expect(JSON.parse(await readFile(file, "utf8")).openai).toBe("sk-openai-secret-9876");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    await api("/api/credentials/openai", { method: "DELETE" });
    expect(JSON.parse(await readFile(file, "utf8")).openai).toBeUndefined();
  });

  it("merges config changes into explicame.config.json and refuses secrets or invalid values", async () => {
    const ok = await api("/api/config", { method: "PUT", body: JSON.stringify({ maxSteps: 12, voice: { speed: 1.25 } }) });
    expect(ok.status).toBe(200);
    expect(JSON.parse(await readFile(join(cwd, "explicame.config.json"), "utf8"))).toEqual({ appUrl: site.url, maxSteps: 12, voice: { provider: "fake", speed: 1.25 } });
    expect((await api("/api/config", { method: "PUT", body: JSON.stringify({ apiKey: "x" }) })).status).toBe(400);
    expect((await api("/api/config", { method: "PUT", body: JSON.stringify({ maxSteps: 99 }) })).status).toBe(400);
    expect(JSON.parse(await readFile(join(cwd, "explicame.config.json"), "utf8")).maxSteps).toBe(12);
  });

  it("plays a voice sample as MP3", async () => {
    const sample = await api("/api/voice/test", { method: "POST", body: JSON.stringify({ lang: "es", provider: "fake", text: "Hola" }) });
    expect(sample.headers.get("content-type")).toBe("audio/mpeg");
    const bytes = new Uint8Array(await sample.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfb]);
  });

  it("clones a voice only with consent", async () => {
    await api("/api/credentials/elevenlabs", { method: "PUT", body: JSON.stringify({ value: "el-key-0000" }) });
    const files = [{ name: "muestra.mp3", data: Buffer.from([1, 2, 3]).toString("base64") }];
    expect((await api("/api/voice/clone", { method: "POST", body: JSON.stringify({ name: "Gabriel", consent: false, files }) })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
    const cloned = await api("/api/voice/clone", { method: "POST", body: JSON.stringify({ name: "Gabriel", consent: true, files }) });
    expect(await cloned.json()).toEqual({ voiceId: "cloned123" });
  });

  it("serves files inside the output and video folders only", async () => {
    await mkdir(join(cwd, "public", "explicame"), { recursive: true });
    await writeFile(join(cwd, "public", "explicame", "guides.json"), "[]");
    expect((await fetch(`${origin()}/files/output/guides.json?t=${panel.token}`)).status).toBe(200);
    expect((await fetch(`${origin()}/files/output/guides.json`)).status).toBe(401);
    expect((await fetch(`${origin()}/files/output/..%2f..%2fexplicame.config.json?t=${panel.token}`)).status).toBe(404);
    expect((await fetch(`${origin()}/files/output/..%5c..%5cexplicame.config.json?t=${panel.token}`)).status).toBe(404);
  });

  it("logs in through the app and runs one job at a time, streaming its events", async () => {
    expect(await (await api("/api/login", { method: "POST" })).json()).toEqual({ path: join(home, "sessions", "app.json") });
    const first = await api("/api/jobs", { method: "POST", body: JSON.stringify({ kind: "build", describe: "Filtro" }) });
    expect(first.status).toBe(202);
    const { id } = (await first.json()) as { id: string };
    expect((await api("/api/jobs", { method: "POST", body: JSON.stringify({ kind: "build" }) })).status).toBe(409);
    await gate.started;
    gate.release();
    const stream = await fetch(`${origin()}/api/jobs/${id}/events?t=${panel.token}`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const text = await stream.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("released");
    expect(existsSync(join(cwd, ".explicame", "reports"))).toBe(true);
    expect(text).toMatch(/^id: 0$/m);
  });

  it("stops a running job when asked", async () => {
    gate = newGate();
    afterRelease = "observe";
    const job = await api("/api/jobs", { method: "POST", body: JSON.stringify({ kind: "build" }) });
    expect(job.status).toBe(202);
    const { id } = (await job.json()) as { id: string };
    await gate.started;
    expect((await api(`/api/jobs/${id}`, { method: "DELETE" })).status).toBe(202);
    gate.release();
    const text = await (await fetch(`${origin()}/api/jobs/${id}/events?t=${panel.token}`)).text();
    expect(text).toContain("Generación detenida.");
    expect((await api("/api/jobs/ffffffffffff", { method: "DELETE" })).status).toBe(404);
  });
});
