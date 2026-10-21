import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TokenProvider } from "./auth.js";
import { RedboothClient } from "./client.js";
import { registerAccountTools, registerProjectTools } from "./tools/account.js";
import { registerRawTools, registerTaskTools } from "./tools/tasks.js";
import { registerAuthTools } from "./tools/auth.js";
import type { ToolContext } from "./tools/helpers.js";

export const VERSION = "0.1.0";

export function isReadOnly(env = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.REDBOOTH_READ_ONLY ?? "");
}

export function createServer(client: RedboothClient, readOnly = isReadOnly()): McpServer {
  const server = new McpServer(
    { name: "redbooth-mcp", version: VERSION },
    {
      instructions:
        "Tools for Redbooth project management. Typical flow: list_projects -> list_task_lists -> " +
        "list_tasks / create_task. Use list_users or get_me to find user IDs for assignment. " +
        "Task status values: new, open, hold, resolved (done), rejected. " +
        "If a tool reports the user is not authenticated, call the login tool.",
    },
  );
  const ctx: ToolContext = { server, client, readOnly };
  registerAuthTools(ctx);
  registerAccountTools(ctx);
  registerProjectTools(ctx);
  registerTaskTools(ctx);
  registerRawTools(ctx);
  return server;
}

export async function startStdioServer(): Promise<void> {
  const client = new RedboothClient(TokenProvider.fromEnv());
  const readOnly = isReadOnly();
  const server = createServer(client, readOnly);
  await server.connect(new StdioServerTransport());
  // stdout is reserved for the MCP protocol – log to stderr only.
  console.error(`redbooth-mcp ${VERSION} running on stdio${readOnly ? " (read-only)" : ""}`);
}
