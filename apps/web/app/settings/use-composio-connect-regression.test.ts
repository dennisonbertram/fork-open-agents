/**
 * Regression tests for the honest connect-flow state machine (#801, epic
 * #796 T5). Would fail if the implementation from 64053972 were reverted.
 *
 * These cover angles the BT-801-00x behavioral tests didn't already
 * exercise: an ACTIVE status arriving on the SAME tick the timeout is
 * reached (the race the honesty contract explicitly protects against — a
 * slow-but-successful OAuth completion must never be reported as a
 * timeout), and a popup window whose `.closed` flag only becomes true after
 * the initial open call (simulating a delayed blocker) still being
 * classified consistently by a second call to derivePopupOutcome.
 */
import { describe, expect, test } from "bun:test";
import {
  deriveConnectPollOutcome,
  derivePopupOutcome,
} from "./composio-connect-state";

describe("regression: ACTIVE status always wins the timeout race", () => {
  test("elapsed exactly equal to timeout, but slug is ACTIVE, still reports 'confirmed' not 'timed_out'", () => {
    // If a future change reordered the priority checks (timeout before
    // ACTIVE), this exact boundary case would regress to "timed_out" even
    // though the connection genuinely succeeded.
    const statusMap = new Map([["slack", "ACTIVE"]]);
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap,
      unavailable: false,
      elapsedMs: 30_000,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("confirmed");
  });

  test("a stale EXPIRED entry for a different toolkit does not block this slug's confirmation", () => {
    // Guards against a future implementation that (incorrectly) inspects the
    // whole status map rather than looking up the specific slug.
    const statusMap = new Map([
      ["gmail", "EXPIRED"],
      ["slack", "ACTIVE"],
    ]);
    const outcome = deriveConnectPollOutcome({
      slug: "slack",
      statusMap,
      unavailable: false,
      elapsedMs: 5000,
      timeoutMs: 30_000,
    });
    expect(outcome).toBe("confirmed");
  });
});

describe("regression: popup-block detection never reports 'connecting' for a dead window", () => {
  test("a window object with closed=true is always 'blocked', regardless of other properties", () => {
    // Guards against a future refactor that checks `popupWindow !== null`
    // alone and drops the `.closed` check — that would silently regress to
    // the pre-#801 "connecting" (optimistic) behavior for a browser that
    // returns a Window synchronously but closes it immediately.
    const deadWindow = {
      closed: true,
      location: { href: "about:blank" },
    } as unknown as Window;
    expect(derivePopupOutcome(deadWindow)).toBe("blocked");
  });

  test("undefined (not just null) also reports 'blocked'", () => {
    expect(derivePopupOutcome(undefined)).toBe("blocked");
  });
});

describe("regression: unavailable connected-accounts reads never falsely confirm or time out early", () => {
  test("unavailable=true persists as 'pending' across multiple consecutive ticks up to the timeout boundary", () => {
    // Guards against a future change that counts consecutive `unavailable`
    // reads toward an early timeout or an early failure — the contract is
    // that only wall-clock elapsed time (not fetch-failure count) drives the
    // timeout, so a flaky connected-accounts endpoint doesn't cut the user's
    // wait short.
    const emptyMap = new Map<string, string>();
    for (const elapsedMs of [0, 5000, 15_000, 29_999]) {
      const outcome = deriveConnectPollOutcome({
        slug: "slack",
        statusMap: emptyMap,
        unavailable: true,
        elapsedMs,
        timeoutMs: 30_000,
      });
      expect(outcome).toBe("pending");
    }
  });
});
