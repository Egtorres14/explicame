import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildTools, pluginPrompt } from "@explicame/core";
import { ConfigSchema, loadConfig, type Config } from "../config.js";
import { GuideSession } from "./guideSession.js";

export interface McpServerOptions {
  cwd: string;
  home: string;
  version: string;
  cliCommand?: string;
}

type InputSchema = { type: "object"; properties?: Record<string, object>; required?: string[] };

/**
 * The loop tools as an MCP server, with the same definitions as API mode. The low-level Server is used on
 * purpose: it publishes core's JSON Schemas as they are, where McpServer would ask for Zod shapes.
 */
export function createMcpServer(session: GuideSession, config: Config, version: string): Server {
  const server = new Server(
    { name: "explicame", version },
    { capabilities: { tools: {} }, instructions: pluginPrompt(config.languages, config.maxSteps) },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildTools(config.languages).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input_schema as InputSchema,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const reply = await session.call(request.params.name, request.params.arguments ?? {});
    return { content: [{ type: "text" as const, text: reply.text }], isError: reply.isError };
  });
  return server;
}

/**
 * Serves the tools over stdio until Claude Code closes the pipe, then closes the browser and exits.
 * A broken config only falls back to the defaults for the tool list; each call reports it.
 */
export async function runMcpServer(o: McpServerOptions): Promise<void> {
  const config = await loadConfig(o.cwd).catch(() => ConfigSchema.parse({}));
  const session = new GuideSession({ cwd: o.cwd, home: o.home, cliCommand: o.cliCommand });
  const server = createMcpServer(session, config, o.version);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await session.close().catch(() => {});
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await server.connect(new StdioServerTransport());
}
