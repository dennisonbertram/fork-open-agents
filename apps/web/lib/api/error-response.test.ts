import { describe, expect, test } from "bun:test";
import {
  type ApiErrorBody,
  type ApiErrorKind,
  apiError,
  apiErrorKindForStatus,
  isApiErrorBody,
} from "./error-response";

const EXPECTED_STATUS: Record<ApiErrorKind, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal_error: 500,
  gone: 410,
  not_implemented: 501,
};

describe("apiError", () => {
  for (const [kind, status] of Object.entries(EXPECTED_STATUS)) {
    test(`${kind} maps to ${status}`, async () => {
      const response = apiError(kind as ApiErrorKind, "boom");
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe("application/json");
      const body = (await response.json()) as ApiErrorBody;
      expect(body).toEqual({ error: "boom", errorKind: kind as ApiErrorKind });
    });
  }

  test("explicit status override wins", () => {
    expect(apiError("invalid_request", "nope", { status: 422 }).status).toBe(
      422,
    );
  });

  test("retryAfterSeconds sets body field and Retry-After header", async () => {
    const response = apiError("rate_limited", "slow down", {
      retryAfterSeconds: 30,
    });
    expect(response.headers.get("retry-after")).toBe("30");
    const body = (await response.json()) as ApiErrorBody;
    expect(body.retryAfterSeconds).toBe(30);
  });

  test("fields are included when given", async () => {
    const response = apiError("invalid_request", "bad", {
      fields: { name: "required" },
    });
    const body = (await response.json()) as ApiErrorBody;
    expect(body.fields).toEqual({ name: "required" });
  });
});

describe("isApiErrorBody", () => {
  test("accepts the envelope", () => {
    expect(isApiErrorBody({ error: "x", errorKind: "not_found" })).toBe(true);
  });

  test("rejects the legacy { message } shape", () => {
    expect(isApiErrorBody({ message: "x" })).toBe(false);
  });

  test("rejects an unknown errorKind", () => {
    expect(isApiErrorBody({ error: "x", errorKind: "wat" })).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(isApiErrorBody(null)).toBe(false);
    expect(isApiErrorBody("error")).toBe(false);
  });
});

describe("isApiErrorBody rejects values that only look valid", () => {
  // Raised in review of #1067: `in` walks the prototype chain.
  test("an inherited property name is not an error kind", () => {
    for (const kind of [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(isApiErrorBody({ error: "nope", errorKind: kind })).toBe(false);
    }
  });

  test("malformed optional members fail the guard rather than being narrowed", () => {
    expect(
      isApiErrorBody({ error: "x", errorKind: "not_found", fields: null }),
    ).toBe(false);
    expect(
      isApiErrorBody({ error: "x", errorKind: "not_found", fields: ["a"] }),
    ).toBe(false);
    expect(
      isApiErrorBody({ error: "x", errorKind: "not_found", fields: { a: 1 } }),
    ).toBe(false);
    expect(
      isApiErrorBody({
        error: "x",
        errorKind: "rate_limited",
        retryAfterSeconds: "soon",
      }),
    ).toBe(false);
    expect(
      isApiErrorBody({
        error: "x",
        errorKind: "rate_limited",
        retryAfterSeconds: Number.NaN,
      }),
    ).toBe(false);
  });

  test("well-formed optional members still pass", () => {
    expect(
      isApiErrorBody({
        error: "x",
        errorKind: "invalid_request",
        fields: { name: "required" },
        retryAfterSeconds: 30,
      }),
    ).toBe(true);
  });
});

describe("apiErrorKindForStatus", () => {
  test("maps upstream gateway statuses to upstream_unavailable", () => {
    expect(apiErrorKindForStatus(502)).toBe("upstream_unavailable");
    expect(apiErrorKindForStatus(503)).toBe("upstream_unavailable");
    expect(apiErrorKindForStatus(504)).toBe("upstream_unavailable");
  });

  test("falls back to internal_error for unmapped statuses", () => {
    expect(apiErrorKindForStatus(500)).toBe("internal_error");
    expect(apiErrorKindForStatus(418)).toBe("internal_error");
  });
});
