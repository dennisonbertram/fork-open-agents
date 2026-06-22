import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  normalizeAnthropicBaseUrl,
  normalizeOpenAICompatibleBaseUrl,
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

  test("normalizes Fireworks Anthropic-compatible URLs to the SDK base URL", () => {
    expect(
      normalizeAnthropicBaseUrl(
        "https://api.fireworks.ai/inference/v1/messages",
      ),
    ).toBe("https://api.fireworks.ai/inference/v1");
    expect(
      normalizeAnthropicBaseUrl("https://api.fireworks.ai/inference"),
    ).toBe("https://api.fireworks.ai/inference/v1");
    expect(normalizeAnthropicBaseUrl("https://api.fireworks.ai")).toBe(
      "https://api.fireworks.ai/inference/v1",
    );
  });

  test("normalizes OpenAI-compatible URLs to provider base URLs", () => {
    expect(normalizeOpenAICompatibleBaseUrl("https://api.example.com")).toBe(
      "https://api.example.com/v1",
    );
    expect(
      normalizeOpenAICompatibleBaseUrl(
        "https://api.sakana.ai/fugu/v1/chat/completions",
      ),
    ).toBe("https://api.sakana.ai/fugu/v1");
    expect(
      normalizeOpenAICompatibleBaseUrl("https://api.sakana.ai/fugu/v1"),
    ).toBe("https://api.sakana.ai/fugu/v1");
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
    expect(
      toInferenceProfileTestMessage(
        new Error("404 not found"),
        undefined,
        "OpenAI-compatible",
      ),
    ).toBe(
      "OpenAI-compatible endpoint was not found. Check that the base URL points to the provider's /v1 API endpoint.",
    );
  });
});
