import { describe, expect, test } from "bun:test";
import { createProgressBudget } from "./progress-budget";

describe("createProgressBudget (#914)", () => {
  test("a changing fingerprint every call never accrues staleness", () => {
    const budget = createProgressBudget({ maxStaleTurns: 5 });

    for (let i = 0; i < 30; i += 1) {
      const result = budget.observeTurn({ gitFingerprint: `fingerprint-${i}` });
      expect(result.staleTurns).toBe(0);
      expect(result.changed).toBe(true);
      expect(result.verdict).toBe("continue");
    }
  });

  test("a frozen fingerprint stalls at exactly maxStaleTurns", () => {
    const budget = createProgressBudget({
      maxStaleTurns: 5,
      initialFingerprint: "seed",
    });

    for (let i = 1; i <= 5; i += 1) {
      const result = budget.observeTurn({ gitFingerprint: "seed" });
      expect(result.staleTurns).toBe(i);
      expect(result.changed).toBe(false);
      expect(result.verdict).toBe(i >= 5 ? "stop" : "continue");
    }
  });

  test("a fingerprint change resets stale turns back to 0", () => {
    const budget = createProgressBudget({
      maxStaleTurns: 5,
      initialFingerprint: "seed",
    });

    budget.observeTurn({ gitFingerprint: "seed" });
    budget.observeTurn({ gitFingerprint: "seed" });
    const frozen = budget.observeTurn({ gitFingerprint: "seed" });
    expect(frozen.staleTurns).toBe(3);

    const reset = budget.observeTurn({ gitFingerprint: "different" });
    expect(reset.staleTurns).toBe(0);
    expect(reset.changed).toBe(true);
    expect(reset.verdict).toBe("continue");
  });

  test("a null fingerprint (probe failure) does not increment staleness", () => {
    const budget = createProgressBudget({
      maxStaleTurns: 2,
      initialFingerprint: "seed",
    });

    budget.observeTurn({ gitFingerprint: "seed" });
    const degraded = budget.observeTurn({ gitFingerprint: null });
    expect(degraded.staleTurns).toBe(1);
    expect(degraded.changed).toBe(false);
    expect(degraded.verdict).toBe("continue");

    const stillDegraded = budget.observeTurn({ gitFingerprint: null });
    expect(stillDegraded.staleTurns).toBe(1);
    expect(stillDegraded.verdict).toBe("continue");
  });
});
