import { describe, expect, test } from "bun:test";
import {
  assertContractConfiguration,
  isRetryableContractRequest,
} from "./_client";

describe("contract client configuration policy", () => {
  test("required mode fails when the contract target is missing", () => {
    expect(() =>
      assertContractConfiguration({
        required: true,
        baseUrl: "",
      }),
    ).toThrow("CONTRACT_BASE_URL");
  });

  test("optional mode permits a missing contract target", () => {
    expect(() =>
      assertContractConfiguration({
        required: false,
        baseUrl: "",
      }),
    ).not.toThrow();
  });
});

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
