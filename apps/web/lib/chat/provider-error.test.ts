import { APICallError, RetryError } from "ai";
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

// Mirrors a response-parse failure: the provider's body says exactly what
// went wrong ("invalid api key", "quota exceeded"), but nothing ever set a
// numeric statusCode on the error object.
function bodyOnlyError(responseBody: string) {
  return Object.assign(new Error("Bad Request"), {
    name: "AI_APICallError",
    responseBody,
    url: "https://api.example.com/v1/chat/completions",
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

  test("returns the response body when there is no numeric statusCode", () => {
    // Regression: a response-parse failure where the body is the only place
    // that says what went wrong (e.g. invalid API key) must not be discarded
    // just because no numeric statusCode was ever set.
    expect(
      getProviderErrorDetails(bodyOnlyError('{"message":"invalid api key"}')),
    ).toEqual({
      statusCode: null,
      responseBody: '{"message":"invalid api key"}',
    });
  });

  test("returns the statusCode when there is no response body", () => {
    expect(getProviderErrorDetails(apiCallError(400))).toEqual({
      statusCode: 400,
      responseBody: null,
    });
  });

  test("walks a .cause chain to find a body-only wrapped error", () => {
    const wrapped = new Error(
      "No output generated. Check the stream for errors.",
      { cause: bodyOnlyError('{"message":"invalid api key"}') },
    );

    expect(getProviderErrorDetails(wrapped)).toEqual({
      statusCode: null,
      responseBody: '{"message":"invalid api key"}',
    });
  });
});

// TASK-1249: the hand-rolled shapes above mirror the AI SDK's error classes
// by hand. That can silently drift from the real thing. These tests build
// error instances from the actually-installed `ai` package (ai@6.0.168) —
// the same classes that construct the errors on the real request path — to
// prove or disprove the wrapped-400 hypothesis in issue #1249 without relying
// on a hand-copied shape.
function realApiCallError(statusCode: number, responseBody?: string) {
  return new APICallError({
    message: "Bad Request",
    url: "https://api.example.com/v1/chat/completions",
    requestBodyValues: { messages: [{ role: "user", content: "secret" }] },
    statusCode,
    responseBody,
  });
}

describe("getProviderErrorDetails (real ai@6.0.168 error instances)", () => {
  test("a bare real APICallError with statusCode 400", () => {
    expect(
      getProviderErrorDetails(
        realApiCallError(400, '{"message":"unsupported field"}'),
      ),
    ).toEqual({
      statusCode: 400,
      responseBody: '{"message":"unsupported field"}',
    });
  });

  test("the same 400 wrapped in a real RetryError as .lastError", () => {
    const last = realApiCallError(400, '{"message":"unsupported field"}');
    const wrapped = new RetryError({
      message: `Failed after 1 attempts with non-retryable error: '${last.message}'`,
      reason: "errorNotRetryable",
      errors: [last],
    });

    expect(getProviderErrorDetails(wrapped)).toEqual({
      statusCode: 400,
      responseBody: '{"message":"unsupported field"}',
    });
  });

  test("a real RetryError whose attempts were all 429", () => {
    const attempts = [
      realApiCallError(429, '{"message":"rate limited"}'),
      realApiCallError(429, '{"message":"rate limited"}'),
      realApiCallError(429, '{"message":"rate limited"}'),
    ];
    const wrapped = new RetryError({
      message: "Failed after 3 attempts. Last error: Too Many Requests",
      reason: "maxRetriesExceeded",
      errors: attempts,
    });

    expect(getProviderErrorDetails(wrapped)).toEqual({
      statusCode: 429,
      responseBody: '{"message":"rate limited"}',
    });
  });
});

describe("isNonRetryableProviderError (real ai@6.0.168 error instances)", () => {
  test("a bare real APICallError with statusCode 400 is non-retryable", () => {
    expect(isNonRetryableProviderError(realApiCallError(400))).toBe(true);
  });

  test("the same 400 wrapped in a real RetryError is still non-retryable", () => {
    const last = realApiCallError(400);
    const wrapped = new RetryError({
      message: `Failed after 1 attempts with non-retryable error: '${last.message}'`,
      reason: "errorNotRetryable",
      errors: [last],
    });

    expect(isNonRetryableProviderError(wrapped)).toBe(true);
  });

  test("a real RetryError whose attempts were all 429 stays retryable (not fast-failed)", () => {
    const wrapped = new RetryError({
      message: "Failed after 3 attempts. Last error: Too Many Requests",
      reason: "maxRetriesExceeded",
      errors: [
        realApiCallError(429),
        realApiCallError(429),
        realApiCallError(429),
      ],
    });

    expect(isNonRetryableProviderError(wrapped)).toBe(false);
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

  test("surfaces the provider response when there is no numeric status", () => {
    const described = describeProviderError(
      bodyOnlyError('{"message":"invalid api key"}'),
    );

    expect(described).toContain("invalid api key");
    expect(described).not.toContain("HTTP");
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
