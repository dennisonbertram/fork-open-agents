/**
 * Unit tests for resolveSandboxInactivityTimeoutMs.
 *
 * The sandbox inactivity (hibernation) window is operator-tunable via the
 * SANDBOX_INACTIVITY_TIMEOUT_MS env var so a deployment can trade idle billing
 * for faster resumes without a code change. Invalid input must fall back to the
 * safe 30-minute default rather than disabling or extremely shortening it.
 */

import { describe, expect, test } from "bun:test";
import { resolveSandboxInactivityTimeoutMs } from "./config";

const DEFAULT_MS = 30 * 60 * 1000;
const FLOOR_MS = 60 * 1000;

describe("resolveSandboxInactivityTimeoutMs", () => {
  test("returns the 30-minute default when unset", () => {
    expect(resolveSandboxInactivityTimeoutMs(undefined)).toBe(DEFAULT_MS);
  });

  test("parses a valid millisecond value", () => {
    expect(resolveSandboxInactivityTimeoutMs("7200000")).toBe(7_200_000);
  });

  test("falls back to default for non-numeric input", () => {
    expect(resolveSandboxInactivityTimeoutMs("abc")).toBe(DEFAULT_MS);
  });

  test("falls back to default for empty string", () => {
    expect(resolveSandboxInactivityTimeoutMs("")).toBe(DEFAULT_MS);
  });

  test("falls back to default for zero or negative values", () => {
    expect(resolveSandboxInactivityTimeoutMs("0")).toBe(DEFAULT_MS);
    expect(resolveSandboxInactivityTimeoutMs("-5")).toBe(DEFAULT_MS);
  });

  test("clamps values below the 60s floor up to the floor", () => {
    expect(resolveSandboxInactivityTimeoutMs("1000")).toBe(FLOOR_MS);
  });

  test("accepts a value exactly at the floor", () => {
    expect(resolveSandboxInactivityTimeoutMs("60000")).toBe(FLOOR_MS);
  });
});
