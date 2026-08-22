import { describe, expect, test } from "bun:test";
import { estimateSandboxCost, SANDBOX_COST_SCALE } from "./compute-pricing";

describe("estimateSandboxCost", () => {
  test("matches Vercel's own worked example: 8 GB for 30 minutes = 4 GB-hours", () => {
    // memoryGbHours = (8192 / 1024) * (1_800_000 / 3_600_000) = 8 * 0.5 = 4
    // cost = 4 * $0.0212/GB-hour + $0.60 / 1_000_000 creations
    //      = $0.0848 + $0.0000006 = $0.0848006
    const result = estimateSandboxCost({
      memoryMb: 8192,
      wallClockMs: 30 * 60 * 1000,
    });

    expect(result.memoryGbHours).toBe("4.000000000");
    expect(result.estimatedCostUsd).toBe("0.084800600");
  });

  test("floors a span shorter than one minute to the 1-minute billing minimum", () => {
    // 1 second is billed as 60_000 ms (1 minute), same as exactly 60_000 ms.
    // memoryGbHours = (1024 / 1024) * (60_000 / 3_600_000) = 1/60 = 0.016666667 (rounded)
    // cost = 0.016666666... * 0.0212 + 0.0000006 = 0.000353933 (rounded)
    const oneSecond = estimateSandboxCost({
      memoryMb: 1024,
      wallClockMs: 1000,
    });
    const exactlyOneMinute = estimateSandboxCost({
      memoryMb: 1024,
      wallClockMs: 60_000,
    });

    expect(oneSecond.memoryGbHours).toBe("0.016666667");
    expect(oneSecond.estimatedCostUsd).toBe("0.000353933");
    expect(oneSecond).toEqual(exactlyOneMinute);
  });

  test("returns fixed-scale decimal strings, not floats", () => {
    const result = estimateSandboxCost({ memoryMb: 2048, wallClockMs: 90_000 });

    expect(typeof result.memoryGbHours).toBe("string");
    expect(typeof result.estimatedCostUsd).toBe("string");
    expect(result.memoryGbHours.split(".")[1]).toHaveLength(SANDBOX_COST_SCALE);
    expect(result.estimatedCostUsd.split(".")[1]).toHaveLength(
      SANDBOX_COST_SCALE,
    );
  });

  test("clamps a negative wallClockMs to the 1-minute minimum instead of going negative", () => {
    const negative = estimateSandboxCost({ memoryMb: 1024, wallClockMs: -100 });
    const oneMinute = estimateSandboxCost({
      memoryMb: 1024,
      wallClockMs: 60_000,
    });

    expect(negative).toEqual(oneMinute);
  });

  test("clamps a non-finite wallClockMs to the 1-minute minimum", () => {
    const nan = estimateSandboxCost({
      memoryMb: 1024,
      wallClockMs: Number.NaN,
    });
    const infinity = estimateSandboxCost({
      memoryMb: 1024,
      wallClockMs: Number.POSITIVE_INFINITY,
    });
    const oneMinute = estimateSandboxCost({
      memoryMb: 1024,
      wallClockMs: 60_000,
    });

    expect(nan).toEqual(oneMinute);
    expect(infinity).toEqual(oneMinute);
  });
});
