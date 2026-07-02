/**
 * run-control-toast-message.test.ts (#767)
 *
 * Pure mapping from a run-control error response body to the toast message
 * shown to the user. The store's illegal_transition/retry-conflict message
 * ("... TOCTOU race — retry rejected") must be humanized here — the store's
 * own error text stays unchanged (other tests pin it).
 */

import { describe, expect, test } from "bun:test";
import { getRunControlToastMessage } from "./run-control-toast-message";

describe("getRunControlToastMessage", () => {
  test("humanizes an illegal_transition retry conflict, hiding TOCTOU", () => {
    const message = getRunControlToastMessage("retry", {
      errorKind: "illegal_transition",
      message:
        "Cannot retry run run_1: run status or step changed concurrently (TOCTOU race — retry rejected)",
    });
    expect(message).not.toContain("TOCTOU");
    expect(message.toLowerCase()).toMatch(/already retried|refresh/);
  });

  test("uses the dispatch_failed copy for dispatch_failed errorKind", () => {
    const message = getRunControlToastMessage("resume", {
      errorKind: "dispatch_failed",
      message: "internal dispatch details",
    });
    expect(message.toLowerCase()).toContain("dispatch");
  });

  test("falls back to the raw server message for other errorKinds", () => {
    const message = getRunControlToastMessage("pause", {
      errorKind: "not_found",
      message: "Loop run not found",
    });
    expect(message).toBe("Loop run not found");
  });

  test("falls back to a generic action-failed message when no server message", () => {
    const message = getRunControlToastMessage("cancel", {});
    expect(message).toBe("Failed to cancel run");
  });
});
