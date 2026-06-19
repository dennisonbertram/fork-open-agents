import { describe, expect, test } from "bun:test";
import { isRetryableContractRequest } from "./_client";

describe("contract client retry policy", () => {
  test("retries transient failures for GET requests only", () => {
    expect(isRetryableContractRequest(undefined, 502)).toBe(true);
    expect(isRetryableContractRequest("GET", 503)).toBe(true);
    expect(isRetryableContractRequest("POST", 503)).toBe(false);
    expect(isRetryableContractRequest("PATCH", 503)).toBe(false);
  });

  test("does not retry successful or client-error GET responses", () => {
    expect(isRetryableContractRequest("GET", 200)).toBe(false);
    expect(isRetryableContractRequest("GET", 401)).toBe(false);
    expect(isRetryableContractRequest("GET", 404)).toBe(false);
  });
});
