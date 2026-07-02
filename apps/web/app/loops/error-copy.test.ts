import { describe, expect, it } from "bun:test";
import {
  ALL_KNOWN_LOOP_ERROR_KINDS,
  getLoopErrorCopy,
  sanitizeErrorDetail,
} from "./error-copy";

describe("getLoopErrorCopy", () => {
  it("returns whatHappened + whatToDo copy for every known errorKind", () => {
    for (const kind of ALL_KNOWN_LOOP_ERROR_KINDS) {
      const copy = getLoopErrorCopy(kind);
      expect(copy.whatHappened).toBeTruthy();
      expect(copy.whatToDo).toBeTruthy();
      expect(copy.isKnown).toBe(true);
    }
  });

  it("falls back to an honest generic message for an unknown kind", () => {
    const copy = getLoopErrorCopy("some_future_kind_nobody_mapped_yet");
    expect(copy.isKnown).toBe(false);
    expect(copy.whatHappened).toBeTruthy();
    expect(copy.whatToDo).toBeTruthy();
    // The raw kind must still be surfaced for operators, just not in the headline.
    expect(copy.rawKind).toBe("some_future_kind_nobody_mapped_yet");
  });

  it("maps installation_missing to a GitHub-connect action with an href", () => {
    const copy = getLoopErrorCopy("installation_missing");
    expect(copy.whatToDo.toLowerCase()).toContain("github");
    expect(copy.actionHref).toBeTruthy();
  });

  it("maps permission_missing to a repo-access action", () => {
    const copy = getLoopErrorCopy("permission_missing");
    expect(copy.whatToDo.toLowerCase()).toMatch(/access|permission/);
  });

  it("maps dispatch_failed to a retry action, not a GitHub-settings action", () => {
    const copy = getLoopErrorCopy("dispatch_failed");
    expect(copy.whatToDo.toLowerCase()).toContain("retry");
  });

  it("maps repo_not_allowed to an operator/allowlist action", () => {
    const copy = getLoopErrorCopy("repo_not_allowed");
    expect(copy.whatHappened.toLowerCase()).toContain("enabled");
  });

  it("maps workflow_failed to a timeout/exhaustion-flavored message", () => {
    const copy = getLoopErrorCopy("workflow_failed");
    expect(copy.whatHappened).toBeTruthy();
  });

  it("maps step_output_invalid to a schema/output-shape message", () => {
    const copy = getLoopErrorCopy("step_output_invalid");
    expect(copy.whatHappened.toLowerCase()).toMatch(/output|shape|expected/);
  });

  it("maps guardrail_exceeded to a limits message", () => {
    const copy = getLoopErrorCopy("guardrail_exceeded");
    expect(copy.whatHappened.toLowerCase()).toMatch(/limit|guardrail/);
  });

  it("never echoes raw errorMessage content into headline copy", () => {
    const copy = getLoopErrorCopy("sandbox_unavailable", {
      errorMessage:
        "Failed to connect sandbox: ECONNREFUSED at internal-host:9999 token=SECRET123",
    });
    expect(copy.whatHappened).not.toContain("SECRET123");
    expect(copy.whatHappened).not.toContain("internal-host");
    expect(copy.whatToDo).not.toContain("SECRET123");
  });

  it("sanitizes and truncates errorMessage for the details disclosure only", () => {
    const long = `x`.repeat(1000);
    const sanitized = sanitizeErrorDetail(long);
    expect(sanitized.length).toBeLessThan(600);
  });

  it("sanitizeErrorDetail redacts common secret-shaped tokens", () => {
    const sanitized = sanitizeErrorDetail(
      "token=ghp_abcdef1234567890abcdef1234567890abcd Bearer sk-abcdefghijklmnopqrstuvwx",
    );
    expect(sanitized).not.toContain("ghp_abcdef1234567890abcdef1234567890abcd");
    expect(sanitized).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });

  it("handles a conflict/TOCTOU-style retry rejection with humanized copy", () => {
    const copy = getLoopErrorCopy("retry_conflict");
    expect(copy.whatHappened.toLowerCase()).not.toContain("toctou");
    expect(copy.whatHappened.toLowerCase()).toMatch(/already retried|refresh/);
  });
});
