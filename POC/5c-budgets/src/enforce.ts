import type { Budget, Consumption, UsageMeter } from "./budget";

export type Decision = "ALLOW" | "WARN" | "BLOCK";

export type LimitDimension = "tokens" | "usd" | "durationMs";

export interface ScopeEvaluation {
  budgetId: string;
  scope: Budget["scope"];
  scopeId: string;
  period: Budget["period"];
  decision: Decision;
  /** The dimension that drove the decision (highest pressure), if any. */
  drivingDimension: LimitDimension | null;
  /** Fraction of the limit the projected total represents (0..>1). */
  utilization: number;
  reason: string;
}

export interface BudgetCheckResult {
  /** Most-restrictive decision across all evaluated scopes. */
  decision: Decision;
  /** First scope that produced the most-restrictive decision (for the stop reason). */
  decidingScope: ScopeEvaluation | null;
  evaluations: ScopeEvaluation[];
}

const SEVERITY: Record<Decision, number> = { ALLOW: 0, WARN: 1, BLOCK: 2 };

interface DimensionCheck {
  dimension: LimitDimension;
  limit: number | null;
  current: number;
  projected: number;
}

function evaluateDimension(
  c: DimensionCheck,
  softThresholdPct: number,
  hardStop: boolean,
): { decision: Decision; utilization: number } {
  if (c.limit == null || c.limit <= 0) {
    return { decision: "ALLOW", utilization: 0 };
  }
  const projectedTotal = c.current + c.projected;
  const utilization = projectedTotal / c.limit;

  // BLOCK if the projected step would push us strictly over the hard limit and
  // hardStop is enabled. The over-budget step must not run.
  if (hardStop && projectedTotal > c.limit) {
    return { decision: "BLOCK", utilization };
  }
  // WARN once the soft threshold of the limit is crossed (projected).
  if (utilization >= softThresholdPct) {
    return { decision: "WARN", utilization };
  }
  return { decision: "ALLOW", utilization };
}

/**
 * Evaluate one budget against current consumption + a projected next-step cost.
 */
function evaluateBudget(
  budget: Budget,
  current: Consumption,
  projected: Consumption,
): ScopeEvaluation {
  const dims: DimensionCheck[] = [
    {
      dimension: "tokens",
      limit: budget.limitTokens,
      current: current.tokens,
      projected: projected.tokens,
    },
    {
      dimension: "usd",
      limit: budget.limitUsd,
      current: current.usd,
      projected: projected.usd,
    },
    {
      dimension: "durationMs",
      limit: budget.limitDurationMs,
      current: current.durationMs,
      projected: projected.durationMs,
    },
  ];

  let decision: Decision = "ALLOW";
  let drivingDimension: LimitDimension | null = null;
  let utilization = 0;

  for (const dim of dims) {
    const r = evaluateDimension(dim, budget.softThresholdPct, budget.hardStop);
    if (SEVERITY[r.decision] > SEVERITY[decision]) {
      decision = r.decision;
      drivingDimension = dim.limit == null ? null : dim.dimension;
      utilization = r.utilization;
    } else if (
      SEVERITY[r.decision] === SEVERITY[decision] &&
      dim.limit != null &&
      r.utilization > utilization
    ) {
      // Same severity: keep the highest-pressure dimension for the reason.
      drivingDimension = dim.dimension;
      utilization = r.utilization;
    }
  }

  const pct = Math.round(utilization * 100);
  const reason =
    decision === "ALLOW"
      ? `within ${budget.scope} budget (${pct}% projected)`
      : decision === "WARN"
        ? `${budget.scope} budget soft threshold crossed: ${drivingDimension} at ${pct}% of limit`
        : `${budget.scope} budget hard limit would be exceeded: ${drivingDimension} at ${pct}% of limit`;

  return {
    budgetId: budget.id,
    scope: budget.scope,
    scopeId: budget.scopeId,
    period: budget.period,
    decision,
    drivingDimension,
    utilization,
    reason,
  };
}

/**
 * Core enforcement entrypoint.
 *
 * Evaluates EVERY applicable budget (e.g. the user budget AND the session
 * budget) and returns the MOST-RESTRICTIVE decision. A run must satisfy all
 * scopes: if the session is under its own budget but the user is over the user
 * budget, the result is BLOCK (and vice versa).
 *
 * @param budgets   all budgets that apply to this run (already resolved by scopeId)
 * @param meter     the usage meter (reads current consumption, applies resets)
 * @param projected projected cost of the NEXT step (pre-step projection)
 */
export function checkBudget(
  budgets: Budget[],
  meter: UsageMeter,
  projected: Consumption,
): BudgetCheckResult {
  const evaluations = budgets.map((b) =>
    evaluateBudget(b, meter.read(b), projected),
  );

  let decision: Decision = "ALLOW";
  let decidingScope: ScopeEvaluation | null = null;
  for (const e of evaluations) {
    if (SEVERITY[e.decision] > SEVERITY[decision]) {
      decision = e.decision;
      decidingScope = e;
    }
  }
  if (decidingScope === null && evaluations.length > 0) {
    decidingScope = evaluations[0];
  }

  return { decision, decidingScope, evaluations };
}
