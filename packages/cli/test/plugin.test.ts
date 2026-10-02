import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "@explicame/core";
import { childEnv } from "./helpers/env.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LAUNCHER = join(ROOT, "plugin/scripts/mcp.mjs");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const json = <T>(path: string) => JSON.parse(read(path)) as T;

interface Marketplace {
  name: string;
  owner: { name: string };
  plugins: { name: string; source: string }[];
}
interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}

describe("Claude Code plugin", () => {
  it("is listed by the repo's marketplace and starts its server through the bundled launcher", () => {
    const marketplace = json<Marketplace>(".claude-plugin/marketplace.json");
    expect(marketplace.name).toBe("explicame");
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: "explicame", source: "./plugin" })]);
    const manifest = json<{ name: string; version: string }>("plugin/.claude-plugin/plugin.json");
    expect(manifest.name).toBe("explicame");
    expect(manifest.version).toBe(json<{ version: string }>("packages/cli/package.json").version);
    expect(json<McpConfig>("plugin/.mcp.json").mcpServers).toEqual({
      explicame: {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs"],
        env: { EXPLICAME_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}" },
      },
    });
    expect(existsSync(LAUNCHER)).toBe(true);
  });

  it("has a skill that pre-approves exactly the server's tools and ends with build --from-guide", () => {
    const skill = read("plugin/skills/explicame/SKILL.md");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(front).toMatch(/^name: explicame$/m);
    expect(front).toMatch(/^description: .{40,1024}$/m);
    const allowed = /^allowed-tools: (.*)$/m.exec(front)?.[1]?.split(",").map((tool) => tool.trim()) ?? [];
    for (const tool of TOOL_NAMES) expect(allowed).toContain(`mcp__plugin_explicame_explicame__${tool}`);
    expect(skill).toContain("explicame build --from-guide");
  });

  it("starts the MCP server through the launcher when EXPLICAME_CLI points at the binary", async () => {
    const project = await mkdtemp(join(tmpdir(), "explicame-launcher-"));
    await writeFile(join(project, "explicame.config.json"), JSON.stringify({ languages: ["es"] }));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [LAUNCHER], stderr: "ignore",
      env: childEnv({
        EXPLICAME_CLI: join(ROOT, "packages/cli/dist/bin.js"),
        EXPLICAME_PROJECT_DIR: project,
        EXPLICAME_HOME: await mkdtemp(join(tmpdir(), "explicame-launcher-home-")),
      }),
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
      const finish = tools.find((tool) => tool.name === "finish")!;
      expect((finish.inputSchema as { properties: Record<string, { required: string[] }> }).properties.title!.required).toEqual(["es"]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it("explains how to install the CLI when EXPLICAME_CLI points nowhere", () => {
    const result = spawnSync(process.execPath, [LAUNCHER], {
      env: childEnv({ EXPLICAME_CLI: join(tmpdir(), "no-existe", "bin.js") }),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EXPLICAME_CLI");
    expect(result.stdout).toBe("");
  });
});
