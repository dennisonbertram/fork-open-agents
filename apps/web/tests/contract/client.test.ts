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

// Review finding on #1318: the tests above call the exported helper directly.
// Deleting the module-level `assertContractConfiguration(...)` invocation in
// `_client.ts`, or disconnecting it from `contractRequired`, would leave them
// green while a real CONTRACT_REQUIRED=1 run silently skipped again — a guard
// that passes its own tests and does nothing, which is the failure this repo
// has shipped before (see docs/process/guard-integrity.md).
//
// Asserting on the source is the only way to see this: importing the module
// under CONTRACT_REQUIRED=1 with no base URL would throw at import time and
// take the whole test file with it, and a mock of the helper proves nothing
// about whether the real module calls it.
describe("the guard is wired into the module entry point", () => {
  test("_client.ts invokes assertContractConfiguration at module level", async () => {
    const source = await Bun.file(
      new URL("_client.ts", import.meta.url).pathname,
    ).text();

    // Strip the function declaration so only call sites remain.
    const withoutDeclaration = source.replace(
      /export function assertContractConfiguration\([\s\S]*?\n\}/,
      "",
    );

    expect(withoutDeclaration).toContain("assertContractConfiguration({");
    // And it must be fed the real strict-mode flag, not a literal.
    expect(withoutDeclaration).toMatch(/required:\s*contractRequired/);
  });

  test("contractRequired is derived from CONTRACT_REQUIRED", async () => {
    const source = await Bun.file(
      new URL("_client.ts", import.meta.url).pathname,
    ).text();
    expect(source).toMatch(
      /contractRequired\s*=\s*process\.env\.CONTRACT_REQUIRED\s*===\s*"1"/,
    );
  });
});
