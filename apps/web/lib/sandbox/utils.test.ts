import { describe, expect, test } from "bun:test";
import { isRecreatableSandboxError, isSandboxNotFoundError } from "./utils";

describe("isSandboxNotFoundError (strict)", () => {
  test("matches status code 404 and the sandbox-specific not-found phrase", () => {
    expect(isSandboxNotFoundError("Request failed with status code 404")).toBe(
      true,
    );
    expect(isSandboxNotFoundError("Sandbox not found")).toBe(true);
  });

  test("does NOT match a bare not-found (avoids misclassifying other resources)", () => {
    expect(isSandboxNotFoundError("Not Found")).toBe(false);
    expect(isSandboxNotFoundError("repository not found")).toBe(false);
  });
});

describe("isRecreatableSandboxError (lenient, for warm-reconnect recreate)", () => {
  test("matches status code 404 and the sandbox-specific phrase", () => {
    expect(isRecreatableSandboxError("failed with status code 404")).toBe(true);
    expect(isRecreatableSandboxError("Sandbox not found")).toBe(true);
  });

  test("also matches a bare not-found, case-insensitively", () => {
    // The Vercel SDK can report an evicted sandbox with a generic message; in
    // the warm-reconnect context the failing resource is the named sandbox, so
    // a bare not-found should still trigger a recreate rather than block.
    expect(isRecreatableSandboxError("Not Found")).toBe(true);
    expect(isRecreatableSandboxError("the resource was not found")).toBe(true);
  });

  test("does not match unrelated errors", () => {
    expect(isRecreatableSandboxError("connection reset by peer")).toBe(false);
    expect(isRecreatableSandboxError("permission denied")).toBe(false);
  });
});
