import { z } from "zod";
import { tokenPath } from "../auth.js";
import { openBrowser, startAuthFlow } from "../login.js";
import { defineTool, type ToolContext } from "./helpers.js";

/**
 * In-chat login so users of the Claude Desktop extension never need a terminal.
 */
export function registerAuthTools(ctx: ToolContext) {
  defineTool(
    ctx,
    "login",
    {
      title: "Log in to Redbooth",
      description:
        "Connect this server to a Redbooth account. Call this when other tools report 'Not authenticated' " +
        "or an expired token. Opens the browser for authorization and waits for the user to approve " +
        "(up to ~2 minutes). Requires REDBOOTH_CLIENT_ID and REDBOOTH_CLIENT_SECRET to be configured.",
      inputSchema: {
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(120)
          .optional()
          .describe("How long to wait for the user to approve in the browser (default 90)."),
      },
    },
    async ({ wait_seconds }) => {
      const { clientId, clientSecret } = ctx.client.tokens.credentials;
      if (!clientId || !clientSecret) {
        throw new Error(
          "REDBOOTH_CLIENT_ID / REDBOOTH_CLIENT_SECRET are not configured for this server. " +
            "Create an app at https://redbooth.com/oauth2/applications (redirect URI " +
            "http://localhost:8765/callback) and add the credentials to the server config, " +
            "or run `npx -y redbooth-mcp auth` in a terminal.",
        );
      }
      const port = Number(process.env.REDBOOTH_REDIRECT_PORT ?? 8765);
      const { authUrl, done } = await startAuthFlow({ clientId, clientSecret, port });
      openBrowser(authUrl);

      const waitMs = (wait_seconds ?? 90) * 1000;
      const result = await Promise.race([
        done.then(() => "ok" as const),
        new Promise<"pending">((r) => setTimeout(() => r("pending"), waitMs).unref?.()),
      ]);

      if (result === "ok") {
        ctx.client.tokens.reset();
        return { status: "connected", token_file: tokenPath() };
      }
      return {
        status: "pending",
        message:
          "Waiting for authorization. Ask the user to open this URL, approve access, then call login again " +
          "or retry the original request.",
        authorize_url: authUrl,
      };
    },
  );
}
