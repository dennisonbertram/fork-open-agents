import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  normalizeAnthropicBaseUrl,
  normalizeInferenceProfileBaseUrl,
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

  test("appends /v1 to path-bearing base URLs missing a version segment", () => {
    expect(normalizeAnthropicBaseUrl("https://api.z.ai/api/anthropic")).toBe(
      "https://api.z.ai/api/anthropic/v1",
    );
  });

  test("leaves an existing version segment untouched", () => {
    expect(normalizeAnthropicBaseUrl("https://api.z.ai/api/anthropic/v1")).toBe(
      "https://api.z.ai/api/anthropic/v1",
    );
    expect(
      normalizeAnthropicBaseUrl("https://api.z.ai/api/anthropic/v1/"),
    ).toBe("https://api.z.ai/api/anthropic/v1");
    expect(normalizeAnthropicBaseUrl("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com/v1",
    );
  });

  test("normalizes OpenAI-compatible URLs to a versioned API root", () => {
    expect(normalizeOpenAICompatibleBaseUrl("https://llm.example.com")).toBe(
      "https://llm.example.com/v1",
    );
    expect(
      normalizeOpenAICompatibleBaseUrl("https://llm.example.com/api/v1/"),
    ).toBe("https://llm.example.com/api/v1");
    expect(() => normalizeOpenAICompatibleBaseUrl(null)).toThrow(
      "OpenAI-compatible profiles require a base URL.",
    );
  });

  test("normalizes base URLs by provider", () => {
    expect(normalizeInferenceProfileBaseUrl("anthropic", null)).toBeNull();
    expect(
      normalizeInferenceProfileBaseUrl("openai-compatible", "https://oai.test"),
    ).toBe("https://oai.test/v1");
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
    expect(
      toInferenceProfileTestMessage(
        new Error("401 unauthorized"),
        undefined,
        "openai-compatible",
      ),
    ).toBe(
      "OpenAI-compatible credentials were rejected. Check the API key and try again.",
    );
  });

  test("detects a base URL missing /v1 from a non-JSON 404 response body", () => {
    const error = Object.assign(new Error("Invalid JSON response"), {
      responseBody: '{"code":500,"msg":"404 NOT_FOUND","success":false}',
    });

    expect(toInferenceProfileTestMessage(error)).toBe(
      "Anthropic-compatible endpoint was not found. Check that the base URL points to a /v1 API endpoint.",
    );
  });

  test("maps provider balance/subscription failures to an actionable message", () => {
    const insufficientBalance = Object.assign(
      new Error(
        "[1113][Insufficient balance or no resource package. Please recharge.]",
      ),
      {
        responseBody:
          '{"type":"error","error":{"type":"rate_limit_error","code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}',
      },
    );
    const expiredPlan = Object.assign(
      new Error(
        "[1309][Your GLM Coding Plan package has expired and is temporarily unavailable. You can resume using it after renewing the subscription on the official website.]",
      ),
      {
        responseBody:
          '{"type":"error","error":{"type":"rate_limit_error","code":"1309"}}',
      },
    );

    const expected =
      "The provider account has no balance or an inactive plan. Add balance or renew the provider subscription, then try again.";
    expect(toInferenceProfileTestMessage(insufficientBalance)).toBe(expected);
    expect(toInferenceProfileTestMessage(expiredPlan)).toBe(expected);
  });
});
