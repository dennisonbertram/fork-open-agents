import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { redactSessionEventPayload } = await import("./events");

describe("session event observability", () => {
  test("keeps database-backed event writes in Workflow step functions", async () => {
    const source = await Bun.file(new URL("events.ts", import.meta.url)).text();

    expect(source).toMatch(
      /export async function recordSessionEvent\([\s\S]*?\)[:\s\w<>]*\{\n\s+"use step";/,
    );
    expect(source).toMatch(
      /export async function emitSessionEvent\([\s\S]*?\)[:\s\w<>| null]*\{\n\s+"use step";/,
    );
  });

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
