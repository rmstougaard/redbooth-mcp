import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TokenProvider, saveTokens } from "./auth.js";
import { RedboothClient, RedboothApiError } from "./client.js";
import { humanizeTimes } from "./tools/helpers.js";
import { createServer } from "./index.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function tmpTokenFile() {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "rb-mcp-")), "tokens.json");
}

describe("RedboothClient", () => {
  it("sends the bearer token and parses JSON", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: 1 }));
    const client = new RedboothClient(new TokenProvider({ staticToken: "abc" }), { fetchImpl: fetchImpl as any });

    await expect(client.get("/me")).resolves.toEqual({ id: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(url).toBe("https://redbooth.com/api/3/me");
    expect(init.headers.Authorization).toBe("Bearer abc");
  });

  it("serializes query params and skips empty values", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, []));
    const client = new RedboothClient(new TokenProvider({ staticToken: "abc" }), { fetchImpl: fetchImpl as any });
    await client.get("/tasks", { project_id: 5, status: ["new", "open"], task_list_id: undefined });
    expect((fetchImpl.mock.calls[0] as any)[0]).toBe(
      "https://redbooth.com/api/3/tasks?project_id=5&status=new%2Copen",
    );
  });

  it("refreshes the token once on 401 and persists new tokens", async () => {
    const file = tmpTokenFile();
    await saveTokens(
      { access_token: "old", refresh_token: "r1", client_id: "cid", client_secret: "sec" },
      file,
    );
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      if (url.endsWith("/oauth2/token")) {
        expect(init.body).toContain("grant_type=refresh_token");
        expect(init.body).toContain("refresh_token=r1");
        return jsonResponse(200, { access_token: "new", refresh_token: "r2", expires_in: 7200 });
      }
      return init.headers.Authorization === "Bearer new" ? jsonResponse(200, { ok: true }) : jsonResponse(401, {});
    });
    const tokens = new TokenProvider({ file, fetchImpl: fetchImpl as any });
    const client = new RedboothClient(tokens, { fetchImpl: fetchImpl as any });

    await expect(client.get("/me")).resolves.toEqual({ ok: true });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.access_token).toBe("new");
    expect(saved.refresh_token).toBe("r2");
    expect(saved.client_id).toBe("cid");
  });

  it("refreshes proactively when the token is about to expire", async () => {
    const file = tmpTokenFile();
    await saveTokens(
      { access_token: "old", refresh_token: "r1", client_id: "c", client_secret: "s", expires_at: Date.now() - 1 },
      file,
    );
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/oauth2/token") ? jsonResponse(200, { access_token: "fresh", expires_in: 7200 }) : jsonResponse(200, {}),
    );
    const tp = new TokenProvider({ file, fetchImpl: fetchImpl as any });
    await expect(tp.getAccessToken()).resolves.toBe("fresh");
    // refresh token kept when provider doesn't rotate it
    expect(JSON.parse(readFileSync(file, "utf8")).refresh_token).toBe("r1");
  });

  it("throws a readable error for API failures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { message: "Not found" }));
    const client = new RedboothClient(new TokenProvider({ staticToken: "abc" }), { fetchImpl: fetchImpl as any });
    const err = await client.get("/tasks/1").catch((e) => e);
    expect(err).toBeInstanceOf(RedboothApiError);
    expect(err.message).toContain("404");
    expect(err.message).toContain("Not found");
  });

  it("retries on 429", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () =>
      ++calls === 1 ? jsonResponse(429, {}, { "retry-after": "0" }) : jsonResponse(200, { ok: 1 }),
    );
    const client = new RedboothClient(new TokenProvider({ staticToken: "abc" }), { fetchImpl: fetchImpl as any });
    await expect(client.get("/me")).resolves.toEqual({ ok: 1 });
    expect(calls).toBe(2);
  });

  it("paginates until a short page and respects the limit", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const perPage = Number(new URL(url).searchParams.get("per_page"));
      const count = page < 3 ? perPage : 1;
      return jsonResponse(200, Array.from({ length: count }, (_, i) => ({ id: page * 1000 + i })));
    });
    const client = new RedboothClient(new TokenProvider({ staticToken: "abc" }), { fetchImpl: fetchImpl as any });

    expect(await client.list("/tasks", {}, 250)).toHaveLength(201);
    expect(await client.list("/tasks", {}, 30)).toHaveLength(30);
  });
});

describe("helpers", () => {
  it("converts *_at epoch seconds to ISO strings", () => {
    expect(humanizeTimes({ created_at: 1700000000, due_on: "2024-01-01", n: 5 })).toEqual({
      created_at: "2023-11-14T22:13:20.000Z",
      due_on: "2024-01-01",
      n: 5,
    });
  });
});

describe("server", () => {
  const listTools = (readOnly: boolean) => {
    const client = new RedboothClient(new TokenProvider({ staticToken: "x" }));
    const server = createServer(client, readOnly) as any;
    return Object.keys(server._registeredTools ?? {});
  };

  it("registers read and write tools", () => {
    const tools = listTools(false);
    expect(tools).toEqual(expect.arrayContaining(["list_projects", "list_tasks", "create_task", "add_comment"]));
  });

  it("hides write tools in read-only mode", () => {
    const tools = listTools(true);
    expect(tools).toContain("list_tasks");
    expect(tools).not.toContain("create_task");
    expect(tools).not.toContain("update_task");
  });

  it("completes the MCP handshake over stdio and lists tools", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/cli.js"],
      stderr: "pipe",
    });
    const mcpClient = new Client({ name: "smoke-test", version: "0.0.1" });
    await mcpClient.connect(transport);
    try {
      const { tools } = await mcpClient.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toHaveLength(20);
      expect(names).toEqual(
        expect.arrayContaining([
          "login",
          "get_me",
          "list_projects",
          "list_task_lists",
          "list_tasks",
          "create_task",
          "complete_task",
          "list_subtasks",
          "list_comments",
          "redbooth_api_get",
        ]),
      );
    } finally {
      await mcpClient.close();
    }
  });
});
