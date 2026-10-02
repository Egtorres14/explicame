import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { GuideSession } from "../src/mcp/guideSession.js";
import { createMcpServer } from "../src/mcp/server.js";
import { childEnv } from "./helpers/env.js";
import { startServer, type TestServer } from "./helpers/server.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BIN = join(ROOT, "packages/cli/dist/bin.js");
const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
let site: TestServer;
let project: string;
let home: string;

type Schema = { properties?: Record<string, { required?: string[] }> };
/** callTool returns a union (the old toolResult shape included), so the text is read through the index signature. */
const textOf = (result: Record<string, unknown>) => (result.content as { type: string; text: string }[])[0]!.text;

beforeAll(async () => {
  site = await startServer(SITE);
  project = await mkdtemp(join(tmpdir(), "explicame-mcp-"));
  home = await mkdtemp(join(tmpdir(), "explicame-mcp-home-"));
  await writeFile(join(project, "explicame.config.json"), JSON.stringify({ appUrl: site.url, languages: ["es", "en"] }));
});
afterAll(async () => {
  await site.close();
});

describe("explicame mcp", () => {
  it("lists the loop tools with the project's languages and runs them", async () => {
    const config = ConfigSchema.parse({ appUrl: site.url, languages: ["es", "en"] });
    const session = new GuideSession({ cwd: project, home, config });
    const server = createMcpServer(session, config, "0.1.0");
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    try {
      expect(client.getInstructions()).toContain("finish replays the whole guide in a fresh browser");
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["observe", "act", "add_step", "finish"]);
      expect((tools.find((tool) => tool.name === "add_step")!.inputSchema as Schema).properties!.narration!.required).toEqual(["es", "en"]);
      const observed = await client.callTool({ name: "observe", arguments: {} });
      expect(observed.isError).toBe(false);
      expect((JSON.parse(textOf(observed)) as { elements: { name: string }[] }).elements.some((e) => e.name === "Filtrar")).toBe(true);
      const missing = await client.callTool({ name: "nope", arguments: {} });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toBe("Unknown tool nope.");
    } finally {
      await client.close();
      await session.close();
    }
  }, 60_000);

  it("serves over stdio from the built binary for the project in EXPLICAME_PROJECT_DIR", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BIN, "mcp"], stderr: "ignore",
      env: childEnv({ EXPLICAME_PROJECT_DIR: project, EXPLICAME_HOME: home }),
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(4);
      const observed = await client.callTool({ name: "observe", arguments: {} });
      expect(observed.isError).toBe(false);
      expect(textOf(observed)).toContain("Filtrar");
    } finally {
      await client.close();
    }
  }, 60_000);

  it("uses its working directory when Claude Code did not expand the project dir", async () => {
    const english = await mkdtemp(join(tmpdir(), "explicame-mcp-en-"));
    await writeFile(join(english, "explicame.config.json"), JSON.stringify({ languages: ["en"] }));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BIN, "mcp"], cwd: english, stderr: "ignore",
      env: childEnv({ EXPLICAME_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}", EXPLICAME_HOME: home }),
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const finish = (await client.listTools()).tools.find((tool) => tool.name === "finish")!;
      expect((finish.inputSchema as Schema).properties!.title!.required).toEqual(["en"]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it("prints nothing on stdout and exits with 0 when the pipe closes", async () => {
    const child = spawn(process.execPath, [BIN, "mcp"], {
      env: childEnv({ EXPLICAME_PROJECT_DIR: project, EXPLICAME_HOME: home }),
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const exited = new Promise<number | null>((done) => child.once("exit", (code) => done(code)));
    child.stdin.end();
    expect(await exited).toBe(0);
    expect(stdout).toBe("");
  }, 60_000);
});
