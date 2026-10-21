import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const REDBOOTH_BASE = "https://redbooth.com";
export const AUTHORIZE_URL = `${REDBOOTH_BASE}/oauth2/authorize`;
export const TOKEN_URL = `${REDBOOTH_BASE}/oauth2/token`;

/**
 * Default stateless OAuth broker URL so end users never need to create a
 * Redbooth developer app or configure client_id / client_secret.
 */
export const DEFAULT_BROKER_URL = "https://redbooth-mcp-auth.rmstougaard.workers.dev";

/** Refresh this many ms before the token actually expires. */
const EXPIRY_SKEW_MS = 60_000;

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms when the access token expires (if known). */
  expires_at?: number;
  /** Stored when using a custom/self-hosted OAuth app. */
  client_id?: string;
  client_secret?: string;
  /** Stored when authenticated via the stateless OAuth broker. */
  broker_url?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export function tokenPath(): string {
  if (process.env.REDBOOTH_TOKEN_PATH) return expandHome(process.env.REDBOOTH_TOKEN_PATH);
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "redbooth-mcp", "tokens.json");
}

export async function loadTokens(file = tokenPath()): Promise<StoredTokens | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as StoredTokens;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw new Error(`Could not read Redbooth tokens from ${file}: ${err?.message ?? err}`);
  }
}

export async function saveTokens(tokens: StoredTokens, file = tokenPath()): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

export async function clearTokens(file = tokenPath()): Promise<void> {
  await fs.unlink(file).catch((err: any) => {
    if (err?.code !== "ENOENT") throw err;
  });
}

export function toStored(
  res: TokenResponse,
  opts: { clientId?: string; clientSecret?: string; brokerUrl?: string } = {},
  previous?: StoredTokens | null,
): StoredTokens {
  return {
    access_token: res.access_token,
    refresh_token: res.refresh_token ?? previous?.refresh_token,
    expires_at: res.expires_in ? Date.now() + res.expires_in * 1000 : undefined,
    client_id: opts.clientId ?? previous?.client_id,
    client_secret: opts.clientSecret ?? previous?.client_secret,
    broker_url: opts.brokerUrl ?? previous?.broker_url,
  };
}

export async function requestToken(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  endpointUrl: string = TOKEN_URL,
): Promise<TokenResponse> {
  const res = await fetchImpl(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Redbooth token request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text) as TokenResponse;
  if (!json.access_token) throw new Error("Redbooth token response did not contain an access_token");
  return json;
}

/**
 * Supplies valid access tokens to the API client, refreshing them when needed
 * and optionally triggering an interactive browser login on first use.
 */
export class TokenProvider {
  private tokens: StoredTokens | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly opts: {
      file?: string;
      staticToken?: string;
      clientId?: string;
      clientSecret?: string;
      brokerUrl?: string;
      fetchImpl?: typeof fetch;
      persist?: boolean;
      /**
       * Optional callback invoked when no tokens exist on disk yet.
       * Enables seamless 1-click UX: the first tool call pops open the browser,
       * waits for approval, and continues without failing.
       */
      onUnauthenticated?: () => Promise<StoredTokens | null>;
    } = {},
  ) {}

  static fromEnv(opts: { onUnauthenticated?: () => Promise<StoredTokens | null> } = {}): TokenProvider {
    const clientId = process.env.REDBOOTH_CLIENT_ID || undefined;
    const clientSecret = process.env.REDBOOTH_CLIENT_SECRET || undefined;
    const brokerUrl =
      process.env.REDBOOTH_AUTH_BROKER_URL ||
      (!clientId && !clientSecret ? DEFAULT_BROKER_URL : undefined);

    return new TokenProvider({
      staticToken: process.env.REDBOOTH_ACCESS_TOKEN || undefined,
      clientId,
      clientSecret,
      brokerUrl: brokerUrl ? brokerUrl.replace(/\/+$/, "") : undefined,
      onUnauthenticated: opts.onUnauthenticated,
    });
  }

  /** OAuth app or broker configuration from config/env. */
  get credentials(): { clientId?: string; clientSecret?: string; brokerUrl?: string } {
    return {
      clientId: this.opts.clientId,
      clientSecret: this.opts.clientSecret,
      brokerUrl: this.opts.brokerUrl,
    };
  }

  /** Drop cached tokens so they're re-read from disk (e.g. after login/logout). */
  reset(): void {
    this.tokens = null;
  }

  private async ensureLoaded(): Promise<StoredTokens> {
    if (this.tokens) return this.tokens;
    if (this.opts.staticToken) {
      this.tokens = { access_token: this.opts.staticToken };
      return this.tokens;
    }
    let loaded = await loadTokens(this.opts.file);
    if (!loaded && this.opts.onUnauthenticated) {
      loaded = await this.opts.onUnauthenticated();
    }
    if (!loaded) {
      throw new Error(
        "Not authenticated with Redbooth. Call the `login` tool to sign in via your browser, " +
          "or run `npx -y redbooth-mcp auth` in a terminal.",
      );
    }
    this.tokens = loaded;
    return loaded;
  }

  async getAccessToken(): Promise<string> {
    const t = await this.ensureLoaded();
    if (t.expires_at && t.expires_at - EXPIRY_SKEW_MS <= Date.now() && t.refresh_token) {
      return this.refresh();
    }
    return t.access_token;
  }

  /** Force a refresh (e.g. after a 401). Concurrent callers share one request. */
  async refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const t = await this.ensureLoaded();
        if (!t.refresh_token) {
          throw new Error(
            "Redbooth access token expired and no refresh token is available. Call `login` to sign in again.",
          );
        }

        const clientId = this.opts.clientId ?? t.client_id;
        const clientSecret = this.opts.clientSecret ?? t.client_secret;
        const brokerUrl = this.opts.brokerUrl ?? t.broker_url;

        let res: TokenResponse;
        if (clientId && clientSecret) {
          res = await requestToken(
            {
              grant_type: "refresh_token",
              refresh_token: t.refresh_token,
              client_id: clientId,
              client_secret: clientSecret,
            },
            this.opts.fetchImpl,
            TOKEN_URL,
          );
          this.tokens = toStored(res, { clientId, clientSecret }, t);
        } else if (brokerUrl) {
          res = await requestToken(
            {
              grant_type: "refresh_token",
              refresh_token: t.refresh_token,
            },
            this.opts.fetchImpl,
            `${brokerUrl}/token`,
          );
          this.tokens = toStored(res, { brokerUrl }, t);
        } else {
          throw new Error(
            "Redbooth access token expired and cannot be refreshed. Call `login` to sign in again.",
          );
        }

        if (this.opts.persist !== false && !this.opts.staticToken) {
          await saveTokens(this.tokens, this.opts.file);
        }
        return this.tokens.access_token;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
}
