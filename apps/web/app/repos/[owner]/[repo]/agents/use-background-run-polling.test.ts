/**
 * Unit tests for computeBackgroundRunRefreshInterval.
 * Written FIRST (TDD) — these verify the pure interval function before the hook is implemented.
 */
import { describe, expect, test } from "bun:test";
import { computeBackgroundRunRefreshInterval } from "./use-background-run-polling";

describe("computeBackgroundRunRefreshInterval", () => {
  test("returns 2000 for queued status (active)", () => {
    expect(computeBackgroundRunRefreshInterval("queued")).toBe(2000);
  });

  test("returns 2000 for running status (active)", () => {
    expect(computeBackgroundRunRefreshInterval("running")).toBe(2000);
  });

  test("returns 0 for succeeded status (terminal)", () => {
    expect(computeBackgroundRunRefreshInterval("succeeded")).toBe(0);
  });

  test("returns 0 for failed status (terminal)", () => {
    expect(computeBackgroundRunRefreshInterval("failed")).toBe(0);
  });

  test("returns 0 for skipped status (terminal)", () => {
    expect(computeBackgroundRunRefreshInterval("skipped")).toBe(0);
  });

  test("returns 0 for cancelled status (terminal)", () => {
    expect(computeBackgroundRunRefreshInterval("cancelled")).toBe(0);
  });

  test("returns 0 for undefined status (not yet loaded)", () => {
    expect(computeBackgroundRunRefreshInterval(undefined)).toBe(0);
  });
});
