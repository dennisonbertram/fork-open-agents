import { z } from "zod";

/**
 * Thrown by the MCP store when a unique-constraint violation (pg code 23505)
 * is detected on the mcp_servers name index. Routes match instanceof to return
 * a friendly 409 without inspecting raw DB error messages.
 */
export class McpServerConflictError extends Error {
  constructor() {
    super("A server with that name already exists.");
    this.name = "McpServerConflictError";
  }
}

/**
 * Validates that a URL is either:
 * - https:// (any host, required for production MCP servers)
 * - http://localhost or http://127.0.0.1 (allowed for dev servers)
 */
function isAllowedMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
      return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    }
    return false;
  } catch {
    return false;
  }
}

export const createMcpServerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  url: z.string().url("Must be a valid URL").refine(isAllowedMcpUrl, {
    message:
      "URL must use https:// (or http://localhost / http://127.0.0.1 for local servers)",
  }),
  transport: z.enum(["http", "sse"]).default("http"),
  headers: z
    .record(z.string().max(100), z.string().max(2000))
    .refine((headers) => Object.keys(headers).length <= 10, {
      message: "At most 10 headers allowed",
    })
    .optional(),
});

export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;

// Build the update schema by hand so .partial() on the create schema does NOT
// carry over the .default("http") on transport. In Zod 4, .partial() preserves
// defaults, meaning updateMcpServerSchema.parse({ enabled: false }) would return
// { transport: "http", enabled: false } — silently resetting an SSE server to HTTP.
export const updateMcpServerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100).optional(),
    url: z
      .string()
      .url("Must be a valid URL")
      .refine(isAllowedMcpUrl, {
        message:
          "URL must use https:// (or http://localhost / http://127.0.0.1 for local servers)",
      })
      .optional(),
    /** No .default() here — omitting transport must not reset it to "http". */
    transport: z.enum(["http", "sse"]).optional(),
    enabled: z.boolean().optional(),
    /** Passing null clears all headers. */
    headers: z
      .record(z.string().max(100), z.string().max(2000))
      .refine((headers) => Object.keys(headers).length <= 10, {
        message: "At most 10 headers allowed",
      })
      .nullable()
      .optional(),
  })
  .strict();

export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;
