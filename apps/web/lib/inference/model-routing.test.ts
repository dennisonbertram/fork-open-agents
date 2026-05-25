import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  normalizeAnthropicBaseUrl,
  redactInferenceSecret,
  toInferenceProfileTestMessage,
} = await import("./model-routing");

describe("inference model routing", () => {
  test("normalizes bare Anthropic-compatible URLs to /v1", () => {
    expect(
      normalizeAnthropicBaseUrl("https://platformproxy.gamutagents.com"),
    ).toBe("https://platformproxy.gamutagents.com/v1");
    expect(
      normalizeAnthropicBaseUrl("https://platformproxy.gamutagents.com/v1/"),
    ).toBe("https://platformproxy.gamutagents.com/v1");
  });

  test("redacts provider keys from error text", () => {
    const secret = "provider-secret-1234567890abcdef";

    expect(redactInferenceSecret(`bad key ${secret}`, secret)).toBe(
      "bad key [redacted]",
    );
    expect(redactInferenceSecret("bad key sk-1234567890")).toBe(
      "bad key [redacted]",
    );
  });

  test("turns provider errors into actionable setup messages", () => {
    expect(
      toInferenceProfileTestMessage(new Error("401 invalid api key")),
    ).toBe(
      "Anthropic credentials were rejected. Check the API key and try again.",
    );
    expect(toInferenceProfileTestMessage(new Error("404 not found"))).toBe(
      "Anthropic-compatible endpoint was not found. Check that the base URL points to a /v1 API endpoint.",
    );
  });
});
