import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { AUTHORIZE_URL, requestToken, saveTokens, toStored, tokenPath } from "./auth.js";

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
  clientId: string;
  clientSecret: string;
  port?: number;
  /** Give up waiting for the browser callback after this many ms. */
  timeoutMs?: number;
}

export interface AuthFlowHandle {
  authUrl: string;
  /** Resolves once tokens are saved; rejects on error/timeout. */
  done: Promise<void>;
}

let active: AuthFlowHandle | null = null;

/**
 * Start the OAuth2 authorization-code flow: spins up a temporary local callback server
 * and returns the URL the user must open. Tokens are saved when the callback arrives.
 */
export async function startAuthFlow(opts: AuthFlowOptions): Promise<AuthFlowHandle> {
  if (active) return active;

  const port = opts.port ?? 8765;
  const redirectUri = `http://localhost:${port}/callback`;
  const state = randomBytes(16).toString("hex");
  const authUrl =
    `${AUTHORIZE_URL}?` +
    new URLSearchParams({
      client_id: opts.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    }).toString();

  let resolveDone!: () => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", redirectUri);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const page = (status: number, msg: string) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Redbooth MCP</title>` +
          `<body style="font-family:system-ui;padding:3rem;text-align:center">` +
          `<h1>${msg}</h1><p>You can close this window and return to your AI assistant.</p></body>`,
      );
    };
    try {
      const error = url.searchParams.get("error");
      if (error) throw new Error(`Authorization denied: ${error}`);
      if (url.searchParams.get("state") !== state) throw new Error("State mismatch – please retry.");
      const code = url.searchParams.get("code");
      if (!code) throw new Error("No authorization code received.");

      const tokenRes = await requestToken({
        grant_type: "authorization_code",
        code,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: redirectUri,
      });
      await saveTokens(toStored(tokenRes, opts.clientId, opts.clientSecret));
      page(200, "✅ Redbooth connected");
      cleanup();
      resolveDone();
    } catch (err) {
      page(400, "❌ Redbooth authorization failed");
      cleanup();
      rejectDone(err);
    }
  });

  const timer = setTimeout(() => {
    cleanup();
    rejectDone(new Error("Timed out waiting for Redbooth authorization."));
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

  // Avoid unhandled rejection warnings if nobody awaits `done`.
  done.catch(() => {});
  active = { authUrl, done };
  return active;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** `redbooth-mcp auth` – interactive terminal login. */
export async function runAuthFlow(): Promise<void> {
  const clientId = arg("client-id") ?? process.env.REDBOOTH_CLIENT_ID;
  const clientSecret = arg("client-secret") ?? process.env.REDBOOTH_CLIENT_SECRET;
  const port = Number(arg("port") ?? process.env.REDBOOTH_REDIRECT_PORT ?? 8765);

  if (!clientId || !clientSecret) {
    console.error(
      [
        "Missing Redbooth OAuth app credentials.",
        "",
        "1. Create an app at https://redbooth.com/oauth2/applications",
        `   Redirect URI: http://localhost:${port}/callback`,
        "2. Then run:",
        "   REDBOOTH_CLIENT_ID=xxx REDBOOTH_CLIENT_SECRET=yyy npx -y redbooth-mcp auth",
        "   (or pass --client-id xxx --client-secret yyy)",
      ].join("\n"),
    );
    process.exit(1);
  }

  const { authUrl, done } = await startAuthFlow({ clientId, clientSecret, port });
  console.error("Opening your browser to authorize Redbooth…");
  console.error(`If it doesn't open, visit:\n\n  ${authUrl}\n`);
  openBrowser(authUrl);
  await done;
  console.error(`\nSuccess! Tokens saved to ${tokenPath()}`);
  console.error("You can now add redbooth-mcp to Claude (see README).");
}
