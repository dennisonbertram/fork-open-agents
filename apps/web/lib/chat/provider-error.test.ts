import { describe, expect, test } from "bun:test";
import {
  buildProviderRejectionMessage,
  describeProviderError,
  getProviderErrorDetails,
  isNonRetryableProviderError,
  isProviderRejectionMessage,
  PROVIDER_REJECTION_PREFIX,
} from "./provider-error";

function apiCallError(statusCode: number, responseBody?: string) {
  return Object.assign(new Error("Bad Request"), {
    name: "AI_APICallError",
    statusCode,
    responseBody,
    url: "https://api.example.com/v1/chat/completions",
    requestBodyValues: { messages: [{ role: "user", content: "secret" }] },
  });
}

// Mirrors `ai`'s NoOutputGeneratedError / any `new Error(msg, { cause })`
// wrapping: the real APICallError travels as `.cause` on a generic Error.
function causeWrappedApiCallError(statusCode: number, responseBody?: string) {
  return new Error("No output generated. Check the stream for errors.", {
    cause: apiCallError(statusCode, responseBody),
  });
}

// Mirrors `ai`'s retryWithExponentialBackoffRespectingRetryHeaders: once a
// request has been attempted more than once, a non-retryable failure is
// wrapped in a RetryError whose own message is generic ("Failed after N
// attempts..."), but the real APICallError survives on `.lastError`.
function retryWrappedApiCallError(statusCode: number, responseBody?: string) {
  const last = apiCallError(statusCode, responseBody);
  return Object.assign(
    new Error(
      `Failed after 2 attempts with non-retryable error: '${last.message}'`,
    ),
    {
      name: "AI_RetryError",
      reason: "errorNotRetryable",
      lastError: last,
      errors: [last],
    },
  );
}

describe("getProviderErrorDetails", () => {
  test("reads status and body off the AI SDK error shape", () => {
    expect(
      getProviderErrorDetails(apiCallError(400, '{"message":"nope"}')),
    ).toEqual({ statusCode: 400, responseBody: '{"message":"nope"}' });
  });

  test("returns nulls for a plain error", () => {
    expect(getProviderErrorDetails(new Error("boom"))).toEqual({
      statusCode: null,
      responseBody: null,
    });
  });

  test("treats a blank body as absent", () => {
    expect(
      getProviderErrorDetails(apiCallError(400, "   ")).responseBody,
    ).toBeNull();
  });

  test("walks a .cause chain to find the wrapped API error", () => {
    expect(
      getProviderErrorDetails(
        causeWrappedApiCallError(400, '{"message":"nope"}'),
      ),
    ).toEqual({ statusCode: 400, responseBody: '{"message":"nope"}' });
  });

  test("reads a RetryError's .lastError for the wrapped API error", () => {
    expect(
      getProviderErrorDetails(
        retryWrappedApiCallError(400, '{"message":"nope"}'),
      ),
    ).toEqual({ statusCode: 400, responseBody: '{"message":"nope"}' });
  });
});

describe("describeProviderError", () => {
  test("adds the status and the provider's own response", () => {
    const described = describeProviderError(
      apiCallError(400, '{"message":"unknown field reasoning_content"}'),
    );

    expect(described).toContain("Bad Request");
    expect(described).toContain("HTTP 400");
    expect(described).toContain("unknown field reasoning_content");
  });

  test("never leaks the request body, which carries the prompt", () => {
    expect(
      describeProviderError(apiCallError(400, '{"message":"nope"}')),
    ).not.toContain("secret");
  });

  test("falls back to the bare message when there is no API detail", () => {
    expect(describeProviderError(new Error("boom"))).toBe("boom");
  });
});

describe("isNonRetryableProviderError", () => {
  test.each([400, 404, 422])("%d is not worth retrying", (status) => {
    expect(isNonRetryableProviderError(apiCallError(status))).toBe(true);
  });

  test.each([401, 429, 500, 503])(
    "%d is left to the normal retry path",
    (status) => {
      expect(isNonRetryableProviderError(apiCallError(status))).toBe(false);
    },
  );

  test("a non-API error is left alone", () => {
    expect(isNonRetryableProviderError(new Error("boom"))).toBe(false);
  });

  test("a .cause-wrapped 400 is still non-retryable", () => {
    expect(isNonRetryableProviderError(causeWrappedApiCallError(400))).toBe(
      true,
    );
  });

  test("a .cause-wrapped 429 is still left to the normal retry path", () => {
    expect(isNonRetryableProviderError(causeWrappedApiCallError(429))).toBe(
      false,
    );
  });

  test("a RetryError-wrapped 400 is still non-retryable", () => {
    expect(isNonRetryableProviderError(retryWrappedApiCallError(400))).toBe(
      true,
    );
  });

  test("a RetryError-wrapped 500 is still left to the normal retry path", () => {
    expect(isNonRetryableProviderError(retryWrappedApiCallError(500))).toBe(
      false,
    );
  });
});

describe("buildProviderRejectionMessage", () => {
  test("offers both recoveries when the chat carries reasoning", () => {
    const message = buildProviderRejectionMessage({
      hasReasoningHistory: true,
      responseBody: '{"message":"unsupported field"}',
      statusCode: 400,
    });

    expect(message).toContain(PROVIDER_REJECTION_PREFIX);
    expect(message).toContain("HTTP 400");
    expect(message).toContain("unsupported field");
    expect(message).toContain("remove the earlier thinking");
    expect(message).toContain("switch back to the model that last worked");
    expect(isProviderRejectionMessage(message)).toBe(true);
  });

  test("only offers the model switch when there is no reasoning to remove", () => {
    const message = buildProviderRejectionMessage({
      hasReasoningHistory: false,
      responseBody: null,
      statusCode: 400,
    });

    expect(message).not.toContain("remove the earlier thinking");
    expect(message).toContain("switch back to the model that last worked");
  });

  test("stays readable when the provider said nothing useful", () => {
    const message = buildProviderRejectionMessage({
      hasReasoningHistory: false,
      responseBody: null,
      statusCode: null,
    });

    expect(message).toContain(PROVIDER_REJECTION_PREFIX);
    expect(message).not.toContain("HTTP");
    expect(message).not.toContain("Provider said");
  });

  test("truncates a runaway provider response", () => {
    const message = buildProviderRejectionMessage({
      hasReasoningHistory: false,
      responseBody: "x".repeat(5000),
      statusCode: 400,
    });

    expect(message.length).toBeLessThan(1000);
    expect(message).toContain("…");
  });
});
