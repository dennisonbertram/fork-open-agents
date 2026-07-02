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

// Codex finding on PR #775: illegal_transition covers non-race cases too
// (e.g. "not in a retryable status ... got: completed"); those must keep
// their specific server message instead of the misleading race copy.
test("#767: non-race illegal_transition retry errors keep the server message", () => {
  const message =
    "Cannot retry run r1: not in a retryable status (failed/stalled), got: completed";
  expect(
    getRunControlToastMessage("retry", {
      errorKind: "illegal_transition",
      message,
    }),
  ).toBe(message);
});

test("#767: the race copy still applies to the TOCTOU-race message", () => {
  expect(
    getRunControlToastMessage("retry", {
      errorKind: "illegal_transition",
      message:
        "Cannot retry run r1: run status or step changed concurrently (TOCTOU race — retry rejected)",
    }),
  ).toBe(
    "Someone else already retried this run — refresh to see the latest attempt.",
  );
});
