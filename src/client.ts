import { TokenProvider } from "./auth.js";

export const API_BASE = "https://redbooth.com/api/3";

export type Query = Record<string, string | number | boolean | undefined | null | Array<string | number>>;

export class RedboothApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string,
  ) {
    super(`Redbooth API ${method} ${path} failed with ${status}: ${summarize(body)}`);
    this.name = "RedboothApiError";
  }
}

function summarize(body: string): string {
  try {
    const j = JSON.parse(body);
    return j.message ?? j.error_description ?? j.error ?? JSON.stringify(j).slice(0, 300);
  } catch {
    return body.slice(0, 300) || "(empty body)";
  }
}

function buildQuery(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

/** Thin, typed-enough wrapper around the Redbooth REST API v3. */
export class RedboothClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(
    public readonly tokens: TokenProvider,
    opts: ClientOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async request<T = unknown>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = `${this.baseUrl}${path}${buildQuery(opts.query)}`;
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.getAccessToken();
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.tokens.refresh();
        continue;
      }

      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }

      const text = await res.text();
      if (!res.ok) throw new RedboothApiError(res.status, text, method, path);
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }
  }

  get<T = unknown>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body });
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body });
  }
  delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
  }

  /**
   * Fetch up to `limit` items across pages using Redbooth's page/per_page params.
   */
  async list<T = unknown>(path: string, query: Query = {}, limit = 50): Promise<T[]> {
    const perPage = Math.min(Math.max(limit, 1), 100);
    const out: T[] = [];
    for (let page = 1; out.length < limit; page++) {
      const batch = await this.get<T[]>(path, { ...query, page, per_page: perPage });
      if (!Array.isArray(batch) || batch.length === 0) break;
      out.push(...batch);
      if (batch.length < perPage) break;
    }
    return out.slice(0, limit);
  }
}
