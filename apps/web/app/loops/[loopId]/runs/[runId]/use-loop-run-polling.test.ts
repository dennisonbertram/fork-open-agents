/**
 * useLoopRunPolling hook tests (M1-09)
 *
 * Behavior contract:
 *   BT-LOOPS-014: Hook returns refreshInterval of 2000 when run is queued
 *   BT-LOOPS-015: Hook returns refreshInterval of 2000 when run is running
 *   BT-LOOPS-016: Hook returns refreshInterval of 0 (stop polling) for terminal statuses
 *   BT-LOOPS-017: Terminal statuses: completed, failed, cancelled, stalled
 */

import { describe, expect, test } from "bun:test";

// ── Import the polling interval logic (pure function, not a hook) ──────────────

// The hook computes a refreshInterval based on run status.
// We test the pure interval calculator function directly.

const pollingModulePromise = import("./use-loop-run-polling");

const ACTIVE_STATUSES = ["queued", "running", "paused"] as const;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "stalled"] as const;

describe("computeLoopRunRefreshInterval", () => {
  // BT-LOOPS-014: queued → 2000ms
  test("BT-LOOPS-014: returns 2000 when run status is queued", async () => {
    const { computeLoopRunRefreshInterval } = await pollingModulePromise;
    expect(computeLoopRunRefreshInterval("queued")).toBe(2000);
  });

  // BT-LOOPS-015: running → 2000ms
  test("BT-LOOPS-015: returns 2000 when run status is running", async () => {
    const { computeLoopRunRefreshInterval } = await pollingModulePromise;
    expect(computeLoopRunRefreshInterval("running")).toBe(2000);
  });

  // BT-LOOPS-016/017: terminal statuses → 0
  for (const status of TERMINAL_STATUSES) {
    test(`BT-LOOPS-016: returns 0 (stop polling) for terminal status "${status}"`, async () => {
      const { computeLoopRunRefreshInterval } = await pollingModulePromise;
      expect(computeLoopRunRefreshInterval(status)).toBe(0);
    });
  }

  // paused → 2000 (paused runs can be resumed, still live)
  test("BT-LOOPS-017: returns 2000 when run status is paused (can be resumed)", async () => {
    const { computeLoopRunRefreshInterval } = await pollingModulePromise;
    expect(computeLoopRunRefreshInterval("paused")).toBe(2000);
  });

  // undefined/null → 0
  test("returns 0 when run status is undefined", async () => {
    const { computeLoopRunRefreshInterval } = await pollingModulePromise;
    expect(computeLoopRunRefreshInterval(undefined)).toBe(0);
  });
});
