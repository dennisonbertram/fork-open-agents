/**
 * Regression tests for MCP server Zod schemas.
 *
 * Bug 1: updateMcpServerSchema was derived via createMcpServerSchema.partial(),
 *        which in Zod 4 preserves .default("http") on the transport field.
 *        Parsing { enabled: false } would inject { transport: "http" }, silently
 *        resetting an SSE server to HTTP when toggling the enabled switch.
 *
 * Bug 2: updateMcpServer store function applies any input.transport that is
 *        defined, so the injected default would be written to the database.
 */
import { describe, expect, it } from "bun:test";
import { updateMcpServerSchema } from "./types";

describe("updateMcpServerSchema", () => {
  it("omits transport when not provided — does not inject default 'http'", () => {
    const result = updateMcpServerSchema.parse({ enabled: false });
    // transport must NOT be present — its absence means the store leaves the
    // stored value unchanged. Previously this returned { transport: "http", ... }.
    expect(result).not.toHaveProperty("transport");
    expect(result.enabled).toBe(false);
  });

  it("omits transport when only name is provided", () => {
    const result = updateMcpServerSchema.parse({ name: "renamed" });
    expect(result).not.toHaveProperty("transport");
    expect(result.name).toBe("renamed");
  });

  it("preserves an explicit transport value when provided", () => {
    const result = updateMcpServerSchema.parse({
      transport: "sse",
      enabled: true,
    });
    expect(result.transport).toBe("sse");
    expect(result.enabled).toBe(true);
  });

  it("accepts null headers to clear all stored headers", () => {
    const result = updateMcpServerSchema.parse({ headers: null });
    expect(result.headers).toBeNull();
  });

  it("accepts a headers record to replace stored headers", () => {
    const result = updateMcpServerSchema.parse({
      headers: { Authorization: "Bearer tok" },
    });
    expect(result.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("rejects unknown fields (strict)", () => {
    const parsed = updateMcpServerSchema.safeParse({
      enabled: true,
      bogusField: "x",
    });
    expect(parsed.success).toBe(false);
  });
});
