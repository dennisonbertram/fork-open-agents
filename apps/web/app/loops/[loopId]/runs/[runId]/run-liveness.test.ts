/**
 * Pure unit tests for getLoopRunLiveness (#880).
 *
 * Not active (terminal run) → { kind: "terminal" }.
 * Active + delta <= staleAfterMs → { kind: "live" }.
 * Active + delta > staleAfterMs (strictly) → { kind: "stalled" }.
 * secondsSinceUpdate is floor(delta / 1000).
 */

import { describe, expect, test } from "bun:test";
import { getLoopRunLiveness, STALE_AFTER_MS } from "./run-liveness";

describe("getLoopRunLiveness", () => {
  test("isActive=false returns terminal regardless of timing", () => {
    expect(
      getLoopRunLiveness({
        isActive: false,
        lastSuccessAtMs: 0,
        nowMs: 1_000_000,
      }),
    ).toEqual({ kind: "terminal" });
  });

  test("active + delta 0 returns live with secondsSinceUpdate 0", () => {
    expect(
      getLoopRunLiveness({
        isActive: true,
        lastSuccessAtMs: 5000,
        nowMs: 5000,
      }),
    ).toEqual({ kind: "live", secondsSinceUpdate: 0 });
  });

  test("active + delta exactly staleAfterMs is still live (strictly greater required)", () => {
    const lastSuccessAtMs = 0;
    const nowMs = STALE_AFTER_MS;
    expect(
      getLoopRunLiveness({ isActive: true, lastSuccessAtMs, nowMs }),
    ).toEqual({
      kind: "live",
      secondsSinceUpdate: Math.floor(STALE_AFTER_MS / 1000),
    });
  });

  test("active + delta staleAfterMs + 1 is stalled", () => {
    const lastSuccessAtMs = 0;
    const nowMs = STALE_AFTER_MS + 1;
    const result = getLoopRunLiveness({
      isActive: true,
      lastSuccessAtMs,
      nowMs,
    });
    expect(result.kind).toBe("stalled");
  });

  test("secondsSinceUpdate floors partial seconds", () => {
    const result = getLoopRunLiveness({
      isActive: true,
      lastSuccessAtMs: 0,
      nowMs: 4_999,
    });
    expect(result).toEqual({ kind: "live", secondsSinceUpdate: 4 });
  });

  test("default staleAfterMs is 15_000", () => {
    expect(STALE_AFTER_MS).toBe(15_000);
  });

  test("custom staleAfterMs overrides the default", () => {
    const result = getLoopRunLiveness({
      isActive: true,
      lastSuccessAtMs: 0,
      nowMs: 200,
      staleAfterMs: 100,
    });
    expect(result.kind).toBe("stalled");
  });
});
