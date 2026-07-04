/**
 * Tests for the honest connect-flow state machine (#801, epic #796 T5).
 *
 * This repo's test setup has no DOM/testing-library and no DOM environment
 * registered for bun:test (see repo-selector-compact.test.tsx docstring), so
 * the interactive popup-open / poll-to-ACTIVE / timeout contract described in
 * issue #801 is verified here as pure state-derivation functions — the same
 * pattern used by composio-connection-state.ts and
 * composio-toolkit-picker-helpers.ts. `use-composio-connect.ts`'s React hook
 * is a thin wrapper around these pure functions plus window.open/SWR, mirroring
 * use-background-run-polling.ts's split between a tested pure function
 * (computeBackgroundRunRefreshInterval) and an untested SWR-driven hook shell.
 *
 * BT-801-001: window.open returning null (popup blocked) derives the
 *             "blocked" outcome — never "connecting".
 * BT-801-002: window.open returning a real Window derives the "connecting"
 *             outcome — never an optimistic "confirmed" (C1: no optimistic
 *             success).
 * BT-801-003: a closed popup window (window.open returned a Window, but
 *             .closed is already true) also derives "blocked" — the browser
 *             can close the popup immediately depending on blocker config.
 * BT-801-004: while connecting, connected-accounts reporting the target slug
 *             as ACTIVE derives "confirmed" — poll stops.
 * BT-801-005: while connecting, connected-accounts reporting the target slug
 *             as EXPIRED/absent (not yet ACTIVE) derives "pending" — poll
 *             continues.
 * BT-801-006: once elapsedMs reaches/exceeds the timeout without ACTIVE,
 *             derives "timed_out" — never "error", never "confirmed" (honest
 *             timeout copy, not a false success or a hard error).
 * BT-801-007: connected-accounts unavailable:true (route couldn't check)
 *             while connecting is still "pending", not "confirmed" and not
 *             "timed_out" before the timeout elapses — an unavailable read
 *             must never be misread as a false negative reaching timeout early
 *             or a false positive.
 */
import { describe, expect, test } from "bun:test";
import {
  deriveConnectPollOutcome,
  derivePopupOutcome,
} from "./composio-connect-state";

describe("derivePopupOutcome", () => {
  test("BT-801-001: window.open returning null derives 'blocked'", () => {
    expect(derivePopupOutcome(null)).toBe("blocked");
  });

  test("BT-801-002: a real, open window derives 'connecting'", () => {
    const fakeWindow = { closed: false } as Window;
    expect(derivePopupOutcome(fakeWindow)).toBe("connecting");
  });

  test("BT-801-003: a window that is already closed derives 'blocked'", () => {
    const fakeWindow = { closed: true } as Window;
    expect(derivePopupOutcome(fakeWindow)).toBe("blocked");
  });
});

describe("deriveConnectPollOutcome", () => {
  const statusMapWithActive = new Map([["slack", "ACTIVE"]]);
  const statusMapWithExpired = new Map([["slack", "EXPIRED"]]);
  const emptyStatusMap = new Map<string, string>();

  test("BT-801-004: target slug ACTIVE derives 'confirmed'", () => {
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap: statusMapWithActive,
      unavailable: false,
      elapsedMs: 1000,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("confirmed");
  });

  test("BT-801-005: target slug not yet ACTIVE (EXPIRED) derives 'pending' before timeout", () => {
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap: statusMapWithExpired,
      unavailable: false,
      elapsedMs: 1000,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("pending");
  });

  test("BT-801-005b: target slug absent entirely derives 'pending' before timeout", () => {
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap: emptyStatusMap,
      unavailable: false,
      elapsedMs: 1000,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("pending");
  });

  test("BT-801-006: elapsed >= timeout without ACTIVE derives 'timed_out', not 'error' or 'confirmed'", () => {
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap: emptyStatusMap,
      unavailable: false,
      elapsedMs: 30_000,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("timed_out");
    expect(outcome).not.toBe("error");
    expect(outcome).not.toBe("confirmed");
  });

  test("BT-801-006b: elapsed just under timeout without ACTIVE still derives 'pending'", () => {
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap: emptyStatusMap,
      unavailable: false,
      elapsedMs: 29_999,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("pending");
  });

  test("BT-801-007: unavailable:true before timeout derives 'pending', not 'confirmed' or 'timed_out'", () => {
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap: emptyStatusMap,
      unavailable: true,
      elapsedMs: 1000,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("pending");
  });

  test("ACTIVE takes priority over timeout even at/after the timeout boundary", () => {
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap: statusMapWithActive,
      unavailable: false,
      elapsedMs: 40_000,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("confirmed");
  });
});
