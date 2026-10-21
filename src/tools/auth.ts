import { z } from "zod";
import { clearTokens, tokenPath } from "../auth.js";
import { openBrowser, startAuthFlow } from "../login.js";
import { defineTool, type ToolContext } from "./helpers.js";

/**
 * In-chat login & logout tools so users never need a terminal or developer app.
 */
export function registerAuthTools(ctx: ToolContext) {
  defineTool(
    ctx,
    "login",
    {
      title: "Log in to Redbooth",
      description:
        "Sign in to your Redbooth account in the browser. Zero configuration required – " +
        "opens your browser to Redbooth's authorization screen and waits for you to click Allow.",
      inputSchema: {
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(120)
          .optional()
          .describe("How long to wait for browser approval (default 90)."),
      },
    },
    async ({ wait_seconds }) => {
      const { clientId, clientSecret, brokerUrl } = ctx.client.tokens.credentials;
      const port = Number(process.env.REDBOOTH_REDIRECT_PORT ?? 8765);
      const { authUrl, done } = await startAuthFlow({ clientId, clientSecret, brokerUrl, port });
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
          "Browser opened. Please click 'Allow' on Redbooth to finish signing in (or open the URL below), " +
          "then retry your request.",
        authorize_url: authUrl,
      };
    },
  );

  defineTool(
    ctx,
    "logout",
    {
      title: "Log out of Redbooth",
      description: "Disconnect the current Redbooth account and remove locally stored OAuth tokens.",
      inputSchema: {},
    },
    async () => {
      await clearTokens();
      ctx.client.tokens.reset();
      return { status: "logged_out" };
    },
  );
}
