/**
 * Stateless Redbooth OAuth2 Broker for redbooth-mcp (Cloudflare Worker).
 *
 * Holds the single official Redbooth OAuth app credentials (REDBOOTH_CLIENT_ID
 * and REDBOOTH_CLIENT_SECRET) as Worker secrets so end users can install
 * redbooth-mcp in 1 click without registering their own Redbooth developer app.
 *
 * Privacy guarantee:
 * - Zero storage (no KV, no D1, no logs of tokens).
 * - Only proxies the OAuth redirect (/authorize -> /callback) and token exchange (/token).
 * - All Redbooth API requests go directly from the user's computer to redbooth.com.
 */

export interface Env {
  REDBOOTH_CLIENT_ID: string;
  REDBOOTH_CLIENT_SECRET: string;
}

const REDBOOTH_AUTHORIZE_URL = "https://redbooth.com/oauth2/authorize";
const REDBOOTH_TOKEN_URL = "https://redbooth.com/oauth2/token";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function htmlError(status: number, message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Redbooth MCP</title>` +
      `<body style="font-family:system-ui,-apple-system,sans-serif;padding:3rem;text-align:center;color:#1f2937">` +
      `<h1 style="color:#dc2626">Authorization Error</h1><p>${message}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const callbackUrl = `${url.origin}/callback`;

    if (!env.REDBOOTH_CLIENT_ID || !env.REDBOOTH_CLIENT_SECRET) {
      return json(500, {
        error: "broker_misconfigured",
        error_description: "REDBOOTH_CLIENT_ID and REDBOOTH_CLIENT_SECRET must be set as Worker secrets.",
      });
    }

    // 1. Start browser login: GET /authorize?port=8765&state=<random>
    if (request.method === "GET" && url.pathname === "/authorize") {
      const port = Number(url.searchParams.get("port") ?? "8765");
      const clientState = url.searchParams.get("state") ?? "";
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return htmlError(400, "Invalid local callback port.");
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientState)) {
        return htmlError(400, "Invalid or missing state parameter.");
      }

      // Encode port + clientState into the OAuth state parameter
      const combinedState = `${port}.${clientState}`;
      const target =
        `${REDBOOTH_AUTHORIZE_URL}?` +
        new URLSearchParams({
          client_id: env.REDBOOTH_CLIENT_ID,
          response_type: "code",
          redirect_uri: callbackUrl,
          state: combinedState,
        }).toString();

      return Response.redirect(target, 302);
    }

    // 2. Redbooth OAuth callback: GET /callback?code=...&state=<port>.<clientState>
    if (request.method === "GET" && url.pathname === "/callback") {
      const combinedState = url.searchParams.get("state") ?? "";
      const dot = combinedState.indexOf(".");
      if (dot <= 0) {
        return htmlError(400, "Malformed OAuth state parameter.");
      }
      const port = Number(combinedState.slice(0, dot));
      const clientState = combinedState.slice(dot + 1);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return htmlError(400, "Invalid callback port in state.");
      }

      const localParams = new URLSearchParams();
      localParams.set("state", clientState);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (code) localParams.set("code", code);
      if (error) localParams.set("error", error);

      return Response.redirect(`http://127.0.0.1:${port}/callback?${localParams.toString()}`, 302);
    }

    // 3. Exchange authorization code or refresh token: POST /token
    if (request.method === "POST" && url.pathname === "/token") {
      const form = await request.formData().catch(() => null);
      const bodyParams = form
        ? Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]))
        : Object.fromEntries(new URLSearchParams(await request.text()));

      const grantType = bodyParams.grant_type;
      if (grantType !== "authorization_code" && grantType !== "refresh_token") {
        return json(400, { error: "unsupported_grant_type" });
      }

      const upstreamParams = new URLSearchParams({
        grant_type: grantType,
        client_id: env.REDBOOTH_CLIENT_ID,
        client_secret: env.REDBOOTH_CLIENT_SECRET,
      });

      if (grantType === "authorization_code") {
        if (!bodyParams.code) return json(400, { error: "missing_code" });
        upstreamParams.set("code", bodyParams.code);
        upstreamParams.set("redirect_uri", callbackUrl);
      } else {
        if (!bodyParams.refresh_token) return json(400, { error: "missing_refresh_token" });
        upstreamParams.set("refresh_token", bodyParams.refresh_token);
      }

      const upstream = await fetch(REDBOOTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: upstreamParams.toString(),
      });

      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // Health / info endpoint
    if (request.method === "GET" && url.pathname === "/") {
      return json(200, {
        service: "redbooth-mcp-oauth-broker",
        stateless: true,
        repository: "https://github.com/rmstougaard/redbooth-mcp",
      });
    }

    return json(404, { error: "not_found" });
  },
};
