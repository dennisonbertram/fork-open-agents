/**
 * Minimal tool abstraction for the POC.
 *
 * Mirrors the relevant surface of an AI SDK `tool({ inputSchema, execute })`
 * (packages/agent/tools/*.ts) without pulling in the full `ai` runtime:
 *   - `name`     : tool name (becomes the `tool-<name>` UI part type)
 *   - `execute`  : the side-effecting implementation
 * A real integration keeps the AI SDK `tool()` and only adds the gate around it.
 */
export type Tool<TInput = unknown, TOutput = unknown> = {
  name: string;
  description?: string;
  execute: (input: TInput) => Promise<TOutput> | TOutput;
};

export function defineTool<TInput, TOutput>(
  tool: Tool<TInput, TOutput>,
): Tool<TInput, TOutput> {
  return tool;
}
