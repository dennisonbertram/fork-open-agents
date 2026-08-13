import type { z } from "zod";
import type { McpErrorKind } from "./context";

export type McpToolWireResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: true;
};

/**
 * Package a handler result for the wire.
 *
 * The spec obliges a server advertising an `outputSchema` to return conforming
 * `structuredContent`, and the installed SDK enforces that literally:
 * `validateToolOutput` (@modelcontextprotocol/server 2.0.0,
 * dist/mcp-DXXb3Vv3.mjs:1442) throws a JSON-RPC InvalidParams error whenever a
 * tool with an output schema returns a result carrying no `structuredContent`
 * that is not flagged `isError`.
 *
 * So there is no "drop the structured half, the text block still covers it"
 * fallback: omitting it turns ordinary schema drift — a column made nullable, a
 * new enum value — into a bare protocol error with no content at all, blamed on
 * something else entirely in the client's error message. A result we cannot
 * validate goes back through the error channel instead, which the SDK passes
 * through untouched and the calling model can read and act on.
 */
export function toToolResult(
  outputSchema: z.ZodTypeAny,
  result: unknown,
): McpToolWireResult {
  const parsed = outputSchema.safeParse(result);
  if (parsed.success) {
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: parsed.data,
    };
  }

  const errorKind: McpErrorKind = "internal_error";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          errorKind,
          message: "The tool result did not match its declared output schema.",
          // Field paths and validator messages only — never the values, which
          // would put session content into an error payload.
          details: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        }),
      },
    ],
  };
}
