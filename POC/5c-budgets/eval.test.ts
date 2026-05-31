import { describe, expect, test } from "bun:test";
import type { Budget } from "./src/budget";
import { periodWindowStart, UsageMeter } from "./src/budget";
import { checkBudget } from "./src/enforce";
import { runStepLoop } from "./src/gate";
import { usageToUsd } from "./src/pricing";
import type { TokenUsage } from "./src/usage";

const MODEL = "anthropic/claude-sonnet-4";

/** A realistic per-step usage object (AI SDK LanguageModelUsage shape). */
function step(input: number, output: number, cached = 0): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    totalTokens: input + output,
  };
}

function userBudget(over: Partial<Budget> = {}): Budget {
  return {
    id: "b-user",
    scope: "user",
    scopeId: "user-1",
    limitTokens: null,
    limitUsd: null,
    limitDurationMs: null,
    period: "daily",
    softThresholdPct: 0.8,
    hardStop: true,
    ...over,
  };
}

function sessionBudget(over: Partial<Budget> = {}): Budget {
  return {
    id: "b-session",
    scope: "session",
    scopeId: "session-1",
    limitTokens: null,
    limitUsd: null,
    limitDurationMs: null,
    period: "per_session",
    softThresholdPct: 0.8,
    hardStop: true,
    ...over,
  };
}

describe("price table conversion", () => {
  test("converts usage to USD with cached discount", () => {
    // sonnet-4: input $3/M, cached $0.3/M, output $15/M
    // 1000 input (200 cached) + 500 output
    // = 800*3/1e6 + 200*0.3/1e6 + 500*15/1e6
    const usd = usageToUsd(MODEL, step(1000, 500, 200));
    expect(usd).toBeCloseTo(
      (800 * 3 + 200 * 0.3 + 500 * 15) / 1_000_000,
      9,
    );
  });
});

describe("(a) under budget -> ALLOW, loop runs to completion", () => {
  test("all steps execute when well under both budgets", () => {
    const meter = new UsageMeter();
    const result = runStepLoop({
      budgets: [userBudget({ limitUsd: 100 }), sessionBudget({ limitUsd: 100 })],
      meter,
      modelId: MODEL,
      maxSteps: 5,
      projectNext: () => ({ usage: step(1000, 500), durationMs: 100 }),
      runStep: () => ({ usage: step(1000, 500), durationMs: 100 }),
    });
    expect(result.stopReason).toBe("max_steps");
    expect(result.stepsExecuted).toBe(5);
    expect(result.workDone).toBe(5);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("(b) soft threshold -> WARN emitted, loop continues", () => {
  test("crossing softThresholdPct emits a WARN but does not halt", () => {
    const meter = new UsageMeter();
    const warns: number[] = [];
    // Each step ~ $0.0105. Limit $0.05, soft 0.8 -> warn once projected total >= $0.04.
    const result = runStepLoop({
      budgets: [sessionBudget({ limitUsd: 0.05 })],
      meter,
      modelId: MODEL,
      maxSteps: 4,
      projectNext: () => ({ usage: step(1000, 500), durationMs: 10 }),
      runStep: () => ({ usage: step(1000, 500), durationMs: 10 }),
      onWarn: (_e, s) => warns.push(s),
    });
    // Per-step ~$0.0105 -> step4 projected total $0.042 >= soft $0.04 => WARN,
    // but $0.042 <= hard $0.05 so it still runs. 4 steps fit under $0.05.
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.workDone).toBe(4);
    expect(result.stopReason).toBe("max_steps");
    expect(warns.length).toBeGreaterThan(0);
  });
});

describe("(c) hard limit -> NEXT step BLOCKED before it runs", () => {
  test("the over-budget step never executes (side-effect counter proves it)", () => {
    const meter = new UsageMeter();
    // Each step ~$0.0105. Limit $0.025 -> step0 ok ($0.0105), step1 ok ($0.021),
    // step2 projected $0.0315 > $0.025 => BLOCK before running step2.
    const result = runStepLoop({
      budgets: [sessionBudget({ limitUsd: 0.025, softThresholdPct: 0.8 })],
      meter,
      modelId: MODEL,
      maxSteps: 10,
      projectNext: () => ({ usage: step(1000, 500), durationMs: 10 }),
      runStep: () => ({ usage: step(1000, 500), durationMs: 10 }),
    });
    expect(result.stopReason).toBe("budget_exceeded");
    // Only 2 steps actually ran; the expensive 3rd step was blocked.
    expect(result.workDone).toBe(2);
    expect(result.stepsExecuted).toBe(2);
    expect(result.haltedBy?.scope).toBe("session");
    // Final pre-step decision in the trace is the BLOCK that halted the loop.
    const last = result.trace.at(-1);
    expect(last?.phase).toBe("pre-step");
    if (last?.phase === "pre-step") {
      expect(last.decision).toBe("BLOCK");
      expect(last.halted).toBe(true);
    }
  });
});

describe("(d) per-user vs per-session: most-restrictive-scope wins", () => {
  test("session under its own budget but USER over -> BLOCK", () => {
    const meter = new UsageMeter();
    // Pre-load the USER meter so the user is already near its limit.
    const u = userBudget({ limitUsd: 0.02 });
    const s = sessionBudget({ limitUsd: 100 }); // session has tons of room
    meter.add(u, { tokens: 0, usd: 0.018, durationMs: 0 });
    // Projected step ~$0.0105 -> user total $0.0285 > $0.02 => BLOCK via user.
    const check = checkBudget([u, s], meter, {
      tokens: 1500,
      usd: usageToUsd(MODEL, step(1000, 500)),
      durationMs: 10,
    });
    expect(check.decision).toBe("BLOCK");
    expect(check.decidingScope?.scope).toBe("user");
  });

  test("user under its own budget but SESSION over -> BLOCK (vice versa)", () => {
    const meter = new UsageMeter();
    const u = userBudget({ limitUsd: 100 });
    const s = sessionBudget({ limitUsd: 0.02 });
    meter.add(s, { tokens: 0, usd: 0.018, durationMs: 0 });
    const check = checkBudget([u, s], meter, {
      tokens: 1500,
      usd: usageToUsd(MODEL, step(1000, 500)),
      durationMs: 10,
    });
    expect(check.decision).toBe("BLOCK");
    expect(check.decidingScope?.scope).toBe("session");
  });

  test("both under budget -> ALLOW", () => {
    const meter = new UsageMeter();
    const u = userBudget({ limitUsd: 100 });
    const s = sessionBudget({ limitUsd: 100 });
    const check = checkBudget([u, s], meter, {
      tokens: 1500,
      usd: 0.0105,
      durationMs: 10,
    });
    expect(check.decision).toBe("ALLOW");
  });
});

describe("(e) long-running / scheduled agent halted mid-run", () => {
  test("a 50-step agent halts when the user daily budget exhausts", () => {
    const meter = new UsageMeter();
    const u = userBudget({ limitUsd: 0.05, period: "daily" });
    const result = runStepLoop({
      budgets: [u],
      meter,
      modelId: MODEL,
      maxSteps: 50, // would run forever in cost terms
      projectNext: () => ({ usage: step(1000, 500), durationMs: 100 }),
      runStep: () => ({ usage: step(1000, 500), durationMs: 100 }),
    });
    expect(result.stopReason).toBe("budget_exceeded");
    expect(result.stepsExecuted).toBeLessThan(50);
    // ~$0.0105/step, $0.05 limit -> ~4 steps then block on the 5th projection.
    expect(result.workDone).toBe(4);
  });
});

describe("duration (wall-clock) budgets", () => {
  test("a step that would exceed the duration limit is blocked", () => {
    const meter = new UsageMeter();
    const s = sessionBudget({ limitDurationMs: 1000, limitUsd: null });
    const result = runStepLoop({
      budgets: [s],
      meter,
      modelId: MODEL,
      maxSteps: 10,
      projectNext: () => ({ usage: step(10, 10), durationMs: 400 }),
      runStep: () => ({ usage: step(10, 10), durationMs: 400 }),
    });
    // 400+400=800 ok; projected 1200 > 1000 => block before 3rd step.
    expect(result.stopReason).toBe("budget_exceeded");
    expect(result.workDone).toBe(2);
    expect(result.haltedBy?.drivingDimension).toBe("durationMs");
  });
});

describe("daily period reset boundary", () => {
  test("consumption resets when the day rolls over", () => {
    let now = Date.UTC(2026, 4, 31, 23, 0, 0); // May 31 23:00 UTC
    const meter = new UsageMeter(() => now);
    const u = userBudget({ limitUsd: 1, period: "daily" });

    meter.add(u, { tokens: 0, usd: 0.9, durationMs: 0 });
    expect(meter.read(u).usd).toBeCloseTo(0.9, 9);
    // A $0.2 step would exceed $1 today => BLOCK.
    let check = checkBudget([u], meter, { tokens: 0, usd: 0.2, durationMs: 0 });
    expect(check.decision).toBe("BLOCK");

    // Roll the clock to the next UTC day.
    now = Date.UTC(2026, 5, 1, 1, 0, 0); // Jun 1 01:00 UTC
    // Meter window reset -> consumption back to 0.
    expect(meter.read(u).usd).toBe(0);
    check = checkBudget([u], meter, { tokens: 0, usd: 0.2, durationMs: 0 });
    expect(check.decision).toBe("ALLOW");
  });

  test("periodWindowStart computes distinct windows per day/month", () => {
    const d1 = periodWindowStart("daily", Date.UTC(2026, 4, 31, 10));
    const d2 = periodWindowStart("daily", Date.UTC(2026, 5, 1, 10));
    expect(d1).not.toBe(d2);
    const m1 = periodWindowStart("monthly", Date.UTC(2026, 4, 15));
    const m2 = periodWindowStart("monthly", Date.UTC(2026, 4, 28));
    expect(m1).toBe(m2); // same month
  });
});

describe("reconciliation: estimate vs actual drift", () => {
  test("a step costing MORE than projected still updates the meter correctly", () => {
    const meter = new UsageMeter();
    const s = sessionBudget({ limitUsd: 0.1 });
    let stepIndex = 0;
    const result = runStepLoop({
      budgets: [s],
      meter,
      modelId: MODEL,
      maxSteps: 10,
      // Under-project every step (claim it's cheap)...
      projectNext: () => ({ usage: step(500, 200), durationMs: 10 }),
      // ...but actuals are 3x more expensive.
      runStep: () => {
        stepIndex += 1;
        return { usage: step(1500, 600), durationMs: 10 };
      },
    });

    // Post-step trace must record the real (larger) usage and positive drift.
    const postLogs = result.trace.filter((t) => t.phase === "post-step");
    expect(postLogs.length).toBeGreaterThan(0);
    for (const log of postLogs) {
      if (log.phase === "post-step") {
        // actual > projected -> positive USD drift recorded.
        expect(log.drift.usd).toBeGreaterThan(0);
        expect(log.actual.tokens).toBe(2100);
      }
    }

    // Because actuals are accounted (not the estimate), the meter reaches the
    // hard limit sooner than the optimistic projection implied, and we halt.
    expect(result.stopReason).toBe("budget_exceeded");
    // Real per-step ~ $0.0135 (1500 in*3 + 600 out*15)/1e6 = 0.0135.
    // After N actuals the next projection (added to real total) crosses $0.1.
    expect(stepIndex).toBe(result.workDone);
  });

  test("the next check sees the REAL accumulated total, not the estimate", () => {
    const meter = new UsageMeter();
    const s = sessionBudget({ limitUsd: 0.1 });
    runStepLoop({
      budgets: [s],
      meter,
      modelId: MODEL,
      maxSteps: 3,
      projectNext: () => ({ usage: step(100, 100), durationMs: 1 }),
      runStep: () => ({ usage: step(2000, 1000), durationMs: 1 }),
    });
    // Real usage per step = (2000*3 + 1000*15)/1e6 = 0.021. After 3 steps -> 0.063.
    expect(meter.read(s).usd).toBeCloseTo(0.063, 6);
    expect(meter.read(s).tokens).toBe(9000);
  });
});

describe("hardStop=false soft-only budgets never BLOCK", () => {
  test("warns indefinitely but keeps running when hardStop is disabled", () => {
    const meter = new UsageMeter();
    const s = sessionBudget({ limitUsd: 0.01, hardStop: false });
    const result = runStepLoop({
      budgets: [s],
      meter,
      modelId: MODEL,
      maxSteps: 3,
      projectNext: () => ({ usage: step(1000, 500), durationMs: 10 }),
      runStep: () => ({ usage: step(1000, 500), durationMs: 10 }),
    });
    expect(result.stopReason).toBe("max_steps");
    expect(result.workDone).toBe(3);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
