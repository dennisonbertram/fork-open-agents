import { describe, expect, test } from "bun:test";
import {
  type ApiErrorBody,
  type ApiErrorKind,
  apiError,
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
