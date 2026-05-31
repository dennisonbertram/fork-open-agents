import { z } from "zod";

/**
 * Config for a single MCP server an agent session can mount.
 *
 * This mirrors the shape of the standard `mcpServers` config object used by
 * Claude Desktop / Cursor / the MCP ecosystem, so configs are portable:
 *   - stdio: spawn a local process (command + args [+ env])
 *   - http:  Streamable HTTP transport (the current MCP HTTP transport)
 *   - sse:   legacy Server-Sent Events transport (kept for compatibility)
 *
 * In the real codebase this would be persisted per-session/per-repo, modeled
 * after `chats.composioSelection` in `apps/web/lib/db/schema.ts`.
 */
export const stdioServerConfigSchema = z.object({
  /** Stable, filesystem-safe id used for tool namespacing: mcp__<name>__<tool>. */
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9_-]+$/,
      "server name must be lowercase alphanumeric, dash or underscore",
    ),
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  /** Extra env for the spawned server (e.g. API keys / DB URLs). */
  env: z.record(z.string(), z.string()).optional(),
});

export const httpServerConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/),
  transport: z.enum(["http", "sse"]),
  url: z.string().url(),
  /** Static headers, e.g. { Authorization: "Bearer ..." }. */
  headers: z.record(z.string(), z.string()).optional(),
});

export const mcpServerConfigSchema = z.discriminatedUnion("transport", [
  stdioServerConfigSchema,
  httpServerConfigSchema,
]);

export type StdioServerConfig = z.infer<typeof stdioServerConfigSchema>;
export type HttpServerConfig = z.infer<typeof httpServerConfigSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

/**
 * Per-session selection of MCP servers to mount. This is the MCP analog of
 * `ChatComposioSelection` (apps/web/lib/composio/types.ts) and would live on
 * the `chats` row as a jsonb column.
 */
export const mcpSessionSelectionSchema = z.object({
  servers: z.array(mcpServerConfigSchema).default([]),
});

export type McpSessionSelection = z.infer<typeof mcpSessionSelectionSchema>;
