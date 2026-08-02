import { describe, expect, test } from "bun:test";
import { readApiError } from "./read-api-error";

describe("readApiError", () => {
  test("legacy { error } body keeps the message and reports unknown kind", () => {
    expect(readApiError({ error: "Failed to save server" })).toEqual({
      message: "Failed to save server",
      kind: "unknown",
      fields: undefined,
      retryAfterSeconds: undefined,
    });
  });

  test("legacy { errorKind, message } body reads message and kind", () => {
    expect(
      readApiError({ errorKind: "not_found", message: "Agent not found" }),
    ).toEqual({
      message: "Agent not found",
      kind: "not_found",
      fields: undefined,
      retryAfterSeconds: undefined,
    });
  });

  test("new envelope reads error, kind, fields, and retryAfterSeconds", () => {
    expect(
      readApiError({
        error: "Invalid request",
        errorKind: "validation_failed",
        fields: { name: "Required", skip: 3 },
        retryAfterSeconds: 30,
      }),
    ).toEqual({
      message: "Invalid request",
      kind: "validation_failed",
      fields: { name: "Required" },
      retryAfterSeconds: 30,
    });
  });

  test("error wins over message when both are present", () => {
    expect(readApiError({ error: "a", message: "b" }).message).toBe("a");
  });

  test("empty body falls back", () => {
    expect(readApiError({})).toEqual({
      message: "Something went wrong",
      kind: "unknown",
      fields: undefined,
      retryAfterSeconds: undefined,
    });
  });

  test("non-JSON string body is used as the message", () => {
    expect(readApiError("Bad Gateway")).toEqual({
      message: "Bad Gateway",
      kind: "unknown",
    });
    expect(readApiError("   ", "Fallback")).toEqual({
      message: "Fallback",
      kind: "unknown",
    });
  });

  test("null and other malformed bodies fall back without throwing", () => {
    for (const body of [null, undefined, 42, [{ error: "nope" }]]) {
      expect(readApiError(body, "Fallback")).toEqual({
        message: "Fallback",
        kind: "unknown",
      });
    }
  });
});
