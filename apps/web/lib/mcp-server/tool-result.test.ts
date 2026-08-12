import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { toToolResult } from "./tool-result";

/**
 * How a tool result is packaged for the wire.
 *
 * The spec says a server advertising an `outputSchema` MUST return conforming
 * `structuredContent`, and the installed SDK enforces it literally:
 * `validateToolOutput` (@modelcontextprotocol/server 2.0.0,
 * dist/mcp-DXXb3Vv3.mjs:1442) throws a JSON-RPC InvalidParams error whenever a
 * tool with an output schema returns a result that has no `structuredContent`
 * and is not flagged `isError`.
 *
 * So "drop the structured half and let the text block carry the payload" is not
 * an available fallback — it turns a schema drift (a column made nullable, a
 * new enum value) into a bare protocol error with no content at all, while the
 * server log blames something else entirely.
 */
const schema = z.object({ id: z.string(), count: z.number() });

describe("toToolResult", () => {
  test("attaches structuredContent when the result conforms", () => {
    const result = toToolResult(schema, { id: "s1", count: 2 });

    expect(result.structuredContent).toEqual({ id: "s1", count: 2 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ id: "s1", count: 2 }),
    });
  });

  test("a non-conforming result is returned through the error channel, never as a bare result", () => {
    const result = toToolResult(schema, { id: "s1", count: "two" });

    // isError is what makes the SDK skip output validation, so the payload
    // still reaches the caller instead of being replaced by a -32602.
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toHaveLength(1);
  });

  test("the error payload names the tool result as the problem and stays machine-readable", () => {
    const result = toToolResult(schema, { id: "s1", count: "two" });

    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      errorKind?: string;
      message?: string;
    };
    expect(payload.errorKind).toBe("internal_error");
    expect(typeof payload.message).toBe("string");
  });
});
