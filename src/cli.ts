#!/usr/bin/env node
import { startStdioServer, VERSION } from "./index.js";
import { runAuthFlow } from "./login.js";
import { loadTokens, tokenPath } from "./auth.js";

const HELP = `redbooth-mcp ${VERSION} – MCP server for Redbooth

Usage:
  redbooth-mcp            Start the MCP server on stdio (what Claude runs)
  redbooth-mcp auth       One-time browser login; stores tokens locally
       --client-id <id> --client-secret <secret> [--port 8765]
  redbooth-mcp status     Show whether you're logged in
  redbooth-mcp --help     Show this help

Environment:
  REDBOOTH_CLIENT_ID / REDBOOTH_CLIENT_SECRET   OAuth app credentials (for auth)
  REDBOOTH_ACCESS_TOKEN                         Use a static token instead of stored tokens
  REDBOOTH_READ_ONLY=true                       Disable all write tools
  REDBOOTH_TOKEN_PATH                           Token file (default ~/.config/redbooth-mcp/tokens.json)
`;

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case undefined:
    case "serve":
      return startStdioServer();
    case "auth":
    case "login":
      return runAuthFlow();
    case "status": {
      const t = await loadTokens();
      if (!t) {
        console.error(`Not logged in (no tokens at ${tokenPath()}). Run: redbooth-mcp auth`);
        process.exit(1);
      }
      const exp = t.expires_at ? new Date(t.expires_at).toISOString() : "unknown";
      console.error(`Logged in. Tokens: ${tokenPath()}`);
      console.error(`Access token expires: ${exp}; refresh token: ${t.refresh_token ? "yes" : "no"}`);
      return;
    }
    case "-h":
    case "--help":
    case "help":
      console.error(HELP);
      return;
    case "-v":
    case "--version":
      console.error(VERSION);
      return;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
