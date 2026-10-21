import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  AUTHORIZE_URL,
  DEFAULT_BROKER_URL,
  TOKEN_URL,
  loadTokens,
  requestToken,
  saveTokens,
  toStored,
  tokenPath,
  type StoredTokens,
} from "./auth.js";

export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* user can open the printed URL manually */
  }
}

export interface AuthFlowOptions {
  /** Custom OAuth app client ID (optional; if omitted, uses the stateless OAuth broker). */
  clientId?: string;
  /** Custom OAuth app client secret (optional; if omitted, uses the stateless OAuth broker). */
  clientSecret?: string;
  /** Stateless OAuth broker URL (defaults to DEFAULT_BROKER_URL when no custom app is set). */
  brokerUrl?: string;
  port?: number;
  /** Give up waiting for the browser callback after this many ms. */
  timeoutMs?: number;
}

export interface AuthFlowHandle {
  authUrl: string;
  /** Resolves once tokens are saved; rejects on error/timeout. */
  done: Promise<StoredTokens>;
}

let active: AuthFlowHandle | null = null;

function renderHtmlPage(ok: boolean, title: string, subtitle: string): string {
  const accent = ok ? "#16a34a" : "#dc2626";
  const badge = ok ? "✓" : "✕";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} – Redbooth MCP</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0f172a;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 2.5rem 2rem;
      max-width: 420px;
      width: 90%;
      text-align: center;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08);
      border: 1px solid #e2e8f0;
    }
    .icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${accent}15;
      color: ${accent};
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 1rem;
    }
    h1 { font-size: 1.35rem; margin: 0 0 0.5rem; }
    p { color: #475569; font-size: 0.95rem; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${badge}</div>
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div>
  ${ok ? `<script>setTimeout(() => { try { window.close(); } catch {} }, 1500);</script>` : ""}
</body>
</html>`;
}

/**
 * Start the OAuth2 authorization-code flow: spins up a temporary local callback server
 * and returns the URL the user must open. Supports both the zero-config stateless broker
 * and custom Redbooth OAuth apps.
 */
export async function startAuthFlow(opts: AuthFlowOptions = {}): Promise<AuthFlowHandle> {
  if (active) return active;

  const port = opts.port ?? Number(process.env.REDBOOTH_REDIRECT_PORT ?? 8765);
  const useCustomApp = Boolean(opts.clientId && opts.clientSecret);
  const brokerUrl = (
    opts.brokerUrl ??
    process.env.REDBOOTH_AUTH_BROKER_URL ??
    DEFAULT_BROKER_URL
  ).replace(/\/+$/, "");

  const redirectUri = `http://localhost:${port}/callback`;
  const state = randomBytes(16).toString("hex");

  const authUrl = useCustomApp
    ? `${AUTHORIZE_URL}?` +
      new URLSearchParams({
        client_id: opts.clientId!,
        response_type: "code",
        redirect_uri: redirectUri,
        state,
      }).toString()
    : `${brokerUrl}/authorize?` +
      new URLSearchParams({
        port: String(port),
        state,
      }).toString();

  let resolveDone!: (tokens: StoredTokens) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<StoredTokens>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", redirectUri);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const respond = (status: number, ok: boolean, title: string, subtitle: string) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHtmlPage(ok, title, subtitle));
    };
    try {
      const error = url.searchParams.get("error");
      if (error) throw new Error(`Authorization denied: ${error}`);
      if (url.searchParams.get("state") !== state) throw new Error("State mismatch – please retry.");
      const code = url.searchParams.get("code");
      if (!code) throw new Error("No authorization code received.");

      const tokenRes = useCustomApp
        ? await requestToken(
            {
              grant_type: "authorization_code",
              code,
              client_id: opts.clientId!,
              client_secret: opts.clientSecret!,
              redirect_uri: redirectUri,
            },
            fetch,
            TOKEN_URL,
          )
        : await requestToken(
            {
              grant_type: "authorization_code",
              code,
            },
            fetch,
            `${brokerUrl}/token`,
          );

      const stored = toStored(
        tokenRes,
        useCustomApp
          ? { clientId: opts.clientId, clientSecret: opts.clientSecret }
          : { brokerUrl },
      );
      await saveTokens(stored);
      respond(200, true, "Redbooth Connected", "You're signed in. You can close this tab and return to Claude.");
      cleanup();
      resolveDone(stored);
    } catch (err: any) {
      respond(
        400,
        false,
        "Redbooth Sign-In Failed",
        err?.message ?? "Could not complete authorization. Please return to your assistant and try again.",
      );
      cleanup();
      rejectDone(err);
    }
  });

  const timer = setTimeout(() => {
    cleanup();
    rejectDone(new Error("Timed out waiting for Redbooth authorization in the browser."));
  }, opts.timeoutMs ?? 5 * 60_000);
  timer.unref?.();

  function cleanup() {
    clearTimeout(timer);
    server.close();
    active = null;
  }

  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(port, "127.0.0.1", () => res());
  });

  done.catch(() => {});
  active = { authUrl, done };
  return active;
}

/**
 * Triggered automatically on the first tool call when the user hasn't signed in yet.
 * Opens the browser and waits up to 90s for approval so the user's very first prompt succeeds.
 */
export async function autoLoginInteractive(timeoutMs = 90_000): Promise<StoredTokens | null> {
  const clientId = process.env.REDBOOTH_CLIENT_ID || undefined;
  const clientSecret = process.env.REDBOOTH_CLIENT_SECRET || undefined;
  const brokerUrl = process.env.REDBOOTH_AUTH_BROKER_URL || DEFAULT_BROKER_URL;

  const { authUrl, done } = await startAuthFlow({
    clientId,
    clientSecret,
    brokerUrl,
  });
  openBrowser(authUrl);

  const result = await Promise.race([
    done,
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs).unref?.()),
  ]);
  return result ?? (await loadTokens());
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** `redbooth-mcp auth` – interactive terminal login (works zero-config via broker or with --client-id). */
export async function runAuthFlow(): Promise<void> {
  const clientId = arg("client-id") ?? process.env.REDBOOTH_CLIENT_ID;
  const clientSecret = arg("client-secret") ?? process.env.REDBOOTH_CLIENT_SECRET;
  const brokerUrl = arg("broker-url") ?? process.env.REDBOOTH_AUTH_BROKER_URL ?? DEFAULT_BROKER_URL;
  const port = Number(arg("port") ?? process.env.REDBOOTH_REDIRECT_PORT ?? 8765);

  const { authUrl, done } = await startAuthFlow({ clientId, clientSecret, brokerUrl, port });
  console.error("Opening your browser to sign in to Redbooth…");
  console.error(`If it doesn't open automatically, visit:\n\n  ${authUrl}\n`);
  openBrowser(authUrl);
  await done;
  console.error(`\n✅ Connected! Tokens saved to ${tokenPath()}`);
}
