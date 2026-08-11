import type { z } from "zod";
import { McpToolError, requireScope } from "./context";
import type { McpScope, McpToolContext } from "./context";
import { sessionReadTools } from "./tools/sessions-read";

export type McpToolDefinition<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = unknown,
> = {
  name: string;
  description: string;
  scope: McpScope;
  inputSchema: TSchema;
  // Method-shorthand (not an arrow-typed property) so TypeScript checks
  // `handler` bivariantly: a tool with a concrete TSchema/TOutput must be
  // assignable to `AnyMcpToolDefinition`'s erased `(ctx, input: unknown) =>
  // Promise<unknown>` shape, which strict arrow-property variance rejects.
  handler(ctx: McpToolContext, input: z.infer<TSchema>): Promise<TOutput>;
};

export type AnyMcpToolDefinition = McpToolDefinition<z.ZodTypeAny, unknown>;

export function defineMcpTool<TSchema extends z.ZodTypeAny, TOutput>(
  definition: McpToolDefinition<TSchema, TOutput>,
): McpToolDefinition<TSchema, TOutput> {
  return definition;
}

export const mcpToolRegistry: readonly AnyMcpToolDefinition[] = [
  ...sessionReadTools,
];

export function getMcpTool(name: string): AnyMcpToolDefinition | undefined {
  return mcpToolRegistry.find((def) => def.name === name);
}

export function listMcpTools(scopes: McpScope[]): AnyMcpToolDefinition[] {
  return mcpToolRegistry.filter((def) => scopes.includes(def.scope));
}

// The registry always constructs a real `McpToolContext` (via
// createToolContext), but callers may hold a plain `scopes: string[]`
// before it is narrowed — exactly what `McpToolContext` structurally widens
// to, since `McpScope[]` is assignable to `string[]`. Accept that wider
// shape here so both call sites typecheck without weakening
// `McpToolContext` itself.
type RunToolCallerContext = {
  userId: string;
  scopes: string[];
  requestId: string;
};

export async function runMcpTool(
  name: string,
  ctx: RunToolCallerContext,
  rawInput: unknown,
): Promise<unknown> {
  const def = getMcpTool(name);
  if (!def) {
    throw new McpToolError("not_found", `Unknown tool "${name}".`);
  }

  // Cast is safe: real callers only ever pass an already-normalized
  // McpToolContext; the wider param type exists solely to accept tests that
  // construct ctx without going through createToolContext/normalizeScopes.
  requireScope(ctx as McpToolContext, def.scope);

  const parsed = def.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new McpToolError("invalid_request", "The tool input was invalid.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  try {
    return await def.handler(ctx as McpToolContext, parsed.data);
  } catch (error) {
    if (error instanceof McpToolError) {
      throw error;
    }
    console.error("[mcp-server] tool failed unexpectedly", {
      requestId: ctx.requestId,
      tool: name,
      error,
    });
    throw new McpToolError("internal_error", "The tool failed unexpectedly.");
  }
}
