import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { redactSessionEventPayload } = await import("./events");

describe("session event observability", () => {
  test("redacts sensitive payload values before persistence", () => {
    expect(
      redactSessionEventPayload({
        authorization: "Bearer secret-token",
        nested: {
          GITHUB_TOKEN: "ghp_123456789012345678901234",
          message: "OPENAI_API_KEY=sk-test1234567890",
        },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: {
        GITHUB_TOKEN: "[REDACTED]",
        message: "OPENAI_API_KEY=[REDACTED]",
      },
    });
  });

  test("wraps primitive payloads in an object", () => {
    expect(redactSessionEventPayload("ok")).toEqual({ value: "ok" });
  });
});
