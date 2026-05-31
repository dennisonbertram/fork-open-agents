/**
 * Generates human-readable evidence for POC 5c into ./evidence/.
 *
 * Scenarios captured:
 *   1. hard-stop.json   — session $ budget halts the loop before the over-budget step
 *   2. both-scopes.json — user-over vs session-over: most-restrictive-scope wins
 *   3. duration.json    — wall-clock duration budget halts a slow agent
 *   4. period-reset.json— daily window resets at the UTC day boundary
 *   5. reconcile.json   — under-projected steps still account real (larger) actuals
 *   6. trace.txt        — pretty per-step ALLOW/WARN/BLOCK decision log
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Budget } from "./src/budget";
import { UsageMeter } from "./src/budget";
import { checkBudget } from "./src/enforce";
import { runStepLoop } from "./src/gate";
import { usageToUsd } from "./src/pricing";
import type { TokenUsage } from "./src/usage";

const MODEL = "anthropic/claude-sonnet-4";
const OUT = join(import.meta.dir, "evidence");
mkdirSync(OUT, { recursive: true });

function step(input: number, output: number, cached = 0): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    totalTokens: input + output,
  };
}

function budget(over: Partial<Budget>): Budget {
  return {
    id: "b",
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

const lines: string[] = [];
function log(s = "") {
  lines.push(s);
}

// ---- Scenario 1: hard stop on session $ budget --------------------------
log("=== Scenario 1: hard $ budget halts loop BEFORE over-budget step ===");
log("model=anthropic/claude-sonnet-4  per-step≈$0.0105  session limit=$0.025  soft=80%");
{
  const meter = new UsageMeter();
  const b = budget({ limitUsd: 0.025 });
  const result = runStepLoop({
    budgets: [b],
    meter,
    modelId: MODEL,
    maxSteps: 10,
    projectNext: () => ({ usage: step(1000, 500), durationMs: 10 }),
    runStep: () => ({ usage: step(1000, 500), durationMs: 10 }),
  });
  for (const t of result.trace) {
    if (t.phase === "pre-step") {
      const e = t.evaluations[0];
      log(
        `  step ${t.step} PRE  decision=${t.decision.padEnd(5)} ` +
          `projected=$${t.projected.usd.toFixed(4)} util=${Math.round(e.utilization * 100)}% ` +
          `${t.halted ? "<<< HALT (step not run)" : ""}`,
      );
    } else {
      log(
        `  step ${t.step} POST actual=$${t.actual.usd.toFixed(4)} ` +
          `drift=$${t.drift.usd.toFixed(4)}`,
      );
    }
  }
  log(
    `  => stopReason=${result.stopReason}  stepsRun=${result.workDone}  ` +
      `haltedBy=${result.haltedBy?.scope}/${result.haltedBy?.drivingDimension}`,
  );
  log(`  => observable work counter (expensive step ran N times) = ${result.workDone}`);
  writeFileSync(
    join(OUT, "hard-stop.json"),
    JSON.stringify(
      { scenario: "hard-stop", result, meter: meter.snapshot() },
      null,
      2,
    ),
  );
}
log();

// ---- Scenario 2: both scopes, most-restrictive wins ---------------------
log("=== Scenario 2: most-restrictive-scope wins (user vs session) ===");
{
  const projected = {
    tokens: 1500,
    usd: usageToUsd(MODEL, step(1000, 500)),
    durationMs: 10,
  };

  // 2a: session fine, user nearly exhausted -> BLOCK via user
  const m1 = new UsageMeter();
  const u1 = budget({ id: "u", scope: "user", scopeId: "user-1", limitUsd: 0.02, period: "daily" });
  const s1 = budget({ id: "s", scope: "session", scopeId: "session-1", limitUsd: 100 });
  m1.add(u1, { tokens: 0, usd: 0.018, durationMs: 0 });
  const c1 = checkBudget([u1, s1], m1, projected);
  log(
    `  2a user@$0.018/limit$0.02, session limit$100 -> ${c1.decision} via ${c1.decidingScope?.scope}`,
  );

  // 2b: user fine, session nearly exhausted -> BLOCK via session
  const m2 = new UsageMeter();
  const u2 = budget({ id: "u", scope: "user", scopeId: "user-1", limitUsd: 100, period: "daily" });
  const s2 = budget({ id: "s", scope: "session", scopeId: "session-1", limitUsd: 0.02 });
  m2.add(s2, { tokens: 0, usd: 0.018, durationMs: 0 });
  const c2 = checkBudget([u2, s2], m2, projected);
  log(
    `  2b user limit$100, session@$0.018/limit$0.02 -> ${c2.decision} via ${c2.decidingScope?.scope}`,
  );

  // 2c: both fine -> ALLOW
  const m3 = new UsageMeter();
  const u3 = budget({ id: "u", scope: "user", scopeId: "user-1", limitUsd: 100, period: "daily" });
  const s3 = budget({ id: "s", scope: "session", scopeId: "session-1", limitUsd: 100 });
  const c3 = checkBudget([u3, s3], m3, projected);
  log(`  2c both limit$100 -> ${c3.decision}`);

  writeFileSync(
    join(OUT, "both-scopes.json"),
    JSON.stringify(
      { userOver: c1, sessionOver: c2, bothUnder: c3 },
      null,
      2,
    ),
  );
}
log();

// ---- Scenario 3: duration (wall-clock) budget ---------------------------
log("=== Scenario 3: wall-clock duration budget halts a slow agent ===");
log("session limitDurationMs=1000, per-step=400ms");
{
  const meter = new UsageMeter();
  const b = budget({ limitDurationMs: 1000, limitUsd: null });
  const result = runStepLoop({
    budgets: [b],
    meter,
    modelId: MODEL,
    maxSteps: 10,
    projectNext: () => ({ usage: step(10, 10), durationMs: 400 }),
    runStep: () => ({ usage: step(10, 10), durationMs: 400 }),
  });
  for (const t of result.trace) {
    if (t.phase === "pre-step") {
      log(
        `  step ${t.step} PRE  decision=${t.decision.padEnd(5)} ` +
          `projectedDur=${t.projected.durationMs}ms ${t.halted ? "<<< HALT" : ""}`,
      );
    }
  }
  log(
    `  => stopReason=${result.stopReason} stepsRun=${result.workDone} ` +
      `haltedBy dimension=${result.haltedBy?.drivingDimension}`,
  );
  writeFileSync(
    join(OUT, "duration.json"),
    JSON.stringify({ result, meter: meter.snapshot() }, null, 2),
  );
}
log();

// ---- Scenario 4: daily period reset boundary ----------------------------
log("=== Scenario 4: daily period reset at UTC day boundary ===");
{
  let now = Date.UTC(2026, 4, 31, 23, 0, 0);
  const meter = new UsageMeter(() => now);
  const u = budget({ scope: "user", scopeId: "user-1", limitUsd: 1, period: "daily" });
  meter.add(u, { tokens: 0, usd: 0.9, durationMs: 0 });
  const before = checkBudget([u], meter, { tokens: 0, usd: 0.2, durationMs: 0 });
  log(`  May31 23:00Z spent=$0.90/limit$1 + $0.20 step -> ${before.decision}`);
  now = Date.UTC(2026, 5, 1, 1, 0, 0);
  const afterRead = meter.read(u);
  const after = checkBudget([u], meter, { tokens: 0, usd: 0.2, durationMs: 0 });
  log(`  Jun01 01:00Z window reset -> spent=$${afterRead.usd.toFixed(2)} + $0.20 step -> ${after.decision}`);
  writeFileSync(
    join(OUT, "period-reset.json"),
    JSON.stringify({ before, afterReset: after, meterAfter: meter.snapshot() }, null, 2),
  );
}
log();

// ---- Scenario 5: reconciliation (under-projected actuals) ---------------
log("=== Scenario 5: reconciliation — under-projected steps account real actuals ===");
log("projection claims step(500,200); real actual is 3x: step(1500,600)");
{
  const meter = new UsageMeter();
  const b = budget({ limitUsd: 0.1 });
  const result = runStepLoop({
    budgets: [b],
    meter,
    modelId: MODEL,
    maxSteps: 20,
    projectNext: () => ({ usage: step(500, 200), durationMs: 10 }),
    runStep: () => ({ usage: step(1500, 600), durationMs: 10 }),
  });
  for (const t of result.trace) {
    if (t.phase === "post-step") {
      log(
        `  step ${t.step} actual=$${t.actual.usd.toFixed(4)} ` +
          `drift=$${t.drift.usd.toFixed(4)} (real cost exceeded estimate)`,
      );
    } else if (t.halted) {
      log(`  step ${t.step} PRE decision=BLOCK <<< HALT (real total crossed limit)`);
    }
  }
  log(
    `  => meter sees REAL total=$${meter.snapshot()["session:session-1:per_session"].usd.toFixed(4)} ` +
      `stopReason=${result.stopReason} stepsRun=${result.workDone}`,
  );
  writeFileSync(
    join(OUT, "reconcile.json"),
    JSON.stringify({ result, meter: meter.snapshot() }, null, 2),
  );
}

writeFileSync(join(OUT, "trace.txt"), lines.join("\n") + "\n");
process.stdout.write(lines.join("\n") + "\n");
