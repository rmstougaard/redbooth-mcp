import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { RedboothClient } from "../client.js";

export interface ToolContext {
  server: McpServer;
  client: RedboothClient;
  readOnly: boolean;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Keep only the listed keys (drops undefined) – keeps agent context small. */
export function pick<T extends Record<string, any>>(obj: T, keys: readonly string[]): Partial<T> {
  if (!obj || typeof obj !== "object") return obj;
  const out: Record<string, any> = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out as Partial<T>;
}

export function pickAll<T extends Record<string, any>>(items: T[], keys: readonly string[]) {
  return Array.isArray(items) ? items.map((i) => pick(i, keys)) : items;
}

/** Remove undefined values so we don't send `null`s to the API. */
export function clean<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Convert Redbooth epoch-second timestamps into ISO strings for readability. */
export function humanizeTimes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(humanizeTimes) as T;
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      out[k] =
        typeof v === "number" && /_at$/.test(k) && v > 1e9 && v < 1e11
          ? new Date(v * 1000).toISOString()
          : humanizeTimes(v);
    }
    return out as T;
  }
  return value;
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(humanizeTimes(data), null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(500)
  .optional()
  .describe("Maximum number of items to return (default 50).");

export const idSchema = (what: string) => z.number().int().positive().describe(`The ${what} ID.`);

/**
 * Register a tool with consistent error handling and read-only gating.
 */
export function defineTool<S extends ZodRawShape>(
  ctx: ToolContext,
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: S;
    write?: boolean;
    destructive?: boolean;
  },
  handler: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>,
): void {
  if (config.write && ctx.readOnly) return;
  ctx.server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      annotations: {
        title: config.title,
        readOnlyHint: !config.write,
        destructiveHint: !!config.destructive,
        openWorldHint: true,
      },
    },
    (async (args: any) => {
      try {
        return ok(await handler(args));
      } catch (err) {
        return fail(err);
      }
    }) as any,
  );
}
