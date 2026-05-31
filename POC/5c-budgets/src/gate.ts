import type { Budget, Consumption, UsageMeter } from "./budget";
import { checkBudget, type Decision, type ScopeEvaluation } from "./enforce";
import { usageToUsd } from "./pricing";
import { totalTokenCount, type TokenUsage } from "./usage";

export type StopReason =
  | "completed"
  | "max_steps"
  | "budget_exceeded";

export interface StepDecisionLog {
  step: number;
  phase: "pre-step";
  decision: Decision;
  /** Projected cost used for the pre-step gate. */
  projected: Consumption;
  evaluations: ScopeEvaluation[];
  /** True when this decision halted the loop (BLOCK). */
  halted: boolean;
}

export interface StepActualLog {
  step: number;
  phase: "post-step";
  /** Real usage the step produced. */
  usage: TokenUsage;
  actual: Consumption;
  /** Difference between actual and the pre-step projection (reconciliation). */
  drift: Consumption;
}

export type TraceEntry = StepDecisionLog | StepActualLog;

export interface GateResult {
  stopReason: StopReason;
  stepsExecuted: number;
  /** Observable side-effect counter: how many times the "expensive work" ran. */
  workDone: number;
  warnings: ScopeEvaluation[];
  trace: TraceEntry[];
  /** The scope evaluation that caused a budget halt, if any. */
  haltedBy: ScopeEvaluation | null;
}

export interface StepOutcome {
  /** Real usage produced by executing the step. */
  usage: TokenUsage;
  /** Wall-clock ms the step took. */
  durationMs: number;
}

export interface RunStepLoopOptions {
  budgets: Budget[];
  meter: UsageMeter;
  modelId: string;
  maxSteps: number;
  /**
   * Pre-step projection of the NEXT step's cost. The gate consults this BEFORE
   * running the step. Mirrors `prepareStep` / the manual loop in chat.ts.
   */
  projectNext: (step: number) => { usage: TokenUsage; durationMs: number };
  /**
   * Execute one step and return its REAL usage + duration. Increments an
   * observable side-effect counter so the eval can prove a blocked step did
   * not run. Mirrors `runAgentStep` in chat.ts.
   */
  runStep: (step: number) => StepOutcome;
  /** Optional callback fired on WARN (soft threshold), used to annotate. */
  onWarn?: (evals: ScopeEvaluation[], step: number) => void;
}

function toConsumption(
  modelId: string,
  usage: TokenUsage,
  durationMs: number,
): Consumption {
  return {
    tokens: totalTokenCount(usage),
    usd: usageToUsd(modelId, usage),
    durationMs,
  };
}

function diff(actual: Consumption, projected: Consumption): Consumption {
  return {
    tokens: actual.tokens - projected.tokens,
    usd: Math.round((actual.usd - projected.usd) * 1_000_000) / 1_000_000,
    durationMs: actual.durationMs - projected.durationMs,
  };
}

/**
 * The budget-enforcing agent step loop.
 *
 * This is the POC analogue of the manual `for` loop in
 * `apps/web/app/workflows/chat.ts` (lines ~1218-1283). The seam:
 *
 *   for (let step = 0; step < maxSteps; step++) {
 *     // [BUDGET GATE — pre-step projection]
 *     //   project next step cost -> checkBudget(allScopes, projected)
 *     //   BLOCK -> set stopReason = "budget_exceeded"; break;  (step does NOT run)
 *     //   WARN  -> annotate + continue
 *     const result = await runAgentStep(...);   // expensive work
 *     // [METER — post-step actual accounting + reconciliation]
 *     //   meter.add(real usage); record estimate-vs-actual drift
 *   }
 *
 * On BLOCK the loop halts gracefully (it does not crash). In chat.ts this maps
 * to the same path as `exhaustedMaxSteps` / the abort monitor: a clean stop
 * with a budget-exceeded reason surfaced to the user.
 */
export function runStepLoop(options: RunStepLoopOptions): GateResult {
  const trace: TraceEntry[] = [];
  const warnings: ScopeEvaluation[] = [];
  let workDone = 0;
  let stepsExecuted = 0;
  let stopReason: StopReason = "completed";
  let haltedBy: ScopeEvaluation | null = null;

  for (let step = 0; step < options.maxSteps; step++) {
    // --- PRE-STEP: project the next step's cost and consult all budgets. ---
    const projection = options.projectNext(step);
    const projected = toConsumption(
      options.modelId,
      projection.usage,
      projection.durationMs,
    );
    const check = checkBudget(options.budgets, options.meter, projected);

    const preLog: StepDecisionLog = {
      step,
      phase: "pre-step",
      decision: check.decision,
      projected,
      evaluations: check.evaluations,
      halted: check.decision === "BLOCK",
    };
    trace.push(preLog);

    if (check.decision === "BLOCK") {
      // Halt BEFORE executing the over-budget step. No work counter increment.
      stopReason = "budget_exceeded";
      haltedBy = check.decidingScope;
      break;
    }

    if (check.decision === "WARN") {
      const warned = check.evaluations.filter((e) => e.decision === "WARN");
      warnings.push(...warned);
      options.onWarn?.(warned, step);
      // Soft threshold: annotate and continue.
    }

    // --- EXECUTE: this is the "expensive" step. ---
    const outcome = options.runStep(step);
    workDone += 1;
    stepsExecuted += 1;

    // --- POST-STEP: account REAL usage to every applicable budget. ---
    const actual = toConsumption(
      options.modelId,
      outcome.usage,
      outcome.durationMs,
    );
    for (const budget of options.budgets) {
      options.meter.add(budget, actual);
    }

    trace.push({
      step,
      phase: "post-step",
      usage: outcome.usage,
      actual,
      drift: diff(actual, projected),
    });

    if (step + 1 >= options.maxSteps) {
      stopReason = "max_steps";
    }
  }

  return {
    stopReason,
    stepsExecuted,
    workDone,
    warnings,
    trace,
    haltedBy,
  };
}
