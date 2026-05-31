/**
 * Budget model + in-memory meter.
 *
 * In the real system these would be Drizzle tables alongside `usage_events`
 * (apps/web/lib/db/schema.ts). The shapes here are written so they translate
 * 1:1 to pgTable definitions; see README integration plan.
 */

export type BudgetScope = "user" | "session";

export type BudgetPeriod = "daily" | "monthly" | "per_session" | "lifetime";

/**
 * A budget row. Limits are optional and independent: a budget may cap tokens,
 * USD, wall-clock duration, or any combination. A null limit means "no cap on
 * that dimension".
 *
 *   budgets(
 *     id, scope, scopeId,
 *     limitTokens?, limitUsd?, limitDurationMs?,
 *     period, softThresholdPct, hardStop
 *   )
 */
export interface Budget {
  id: string;
  scope: BudgetScope;
  /** userId for scope=user, sessionId for scope=session. */
  scopeId: string;
  limitTokens: number | null;
  limitUsd: number | null;
  limitDurationMs: number | null;
  period: BudgetPeriod;
  /** 0..1 — fraction of the limit at which a soft WARN is emitted. */
  softThresholdPct: number;
  /** When true, the gate BLOCKs a step that would exceed a limit. */
  hardStop: boolean;
}

/** Accumulated consumption for one (scope, scopeId, period-window). */
export interface MeterEntry {
  tokens: number;
  usd: number;
  durationMs: number;
  /** Start of the current period window (epoch ms). Used for resets. */
  periodStart: number;
}

export interface Consumption {
  tokens: number;
  usd: number;
  durationMs: number;
}

/** Compute the start of the current period window for a given clock time. */
export function periodWindowStart(period: BudgetPeriod, now: number): number {
  const d = new Date(now);
  switch (period) {
    case "daily": {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    case "monthly": {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    }
    case "per_session":
    case "lifetime": {
      // No time-based reset; one window for the whole life of the scope.
      return 0;
    }
    default: {
      return 0;
    }
  }
}

/**
 * In-memory usage meter keyed by `${scope}:${scopeId}:${period}`. In production
 * this is a row in a `usage_meter` table (or derived by aggregating
 * `usage_events`), read/written transactionally so concurrent runs cannot race.
 */
export class UsageMeter {
  private readonly entries = new Map<string, MeterEntry>();
  private clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  private key(scope: BudgetScope, scopeId: string, period: BudgetPeriod) {
    return `${scope}:${scopeId}:${period}`;
  }

  /** Read consumption for a budget, applying a period reset if the window rolled over. */
  read(budget: Budget): Consumption {
    const now = this.clock();
    const k = this.key(budget.scope, budget.scopeId, budget.period);
    const expectedStart = periodWindowStart(budget.period, now);
    let entry = this.entries.get(k);
    if (!entry || entry.periodStart !== expectedStart) {
      // New window (or first read) -> reset accumulation for this period.
      entry = { tokens: 0, usd: 0, durationMs: 0, periodStart: expectedStart };
      this.entries.set(k, entry);
    }
    return { tokens: entry.tokens, usd: entry.usd, durationMs: entry.durationMs };
  }

  /** Add real consumption to a budget's window (post-step actual accounting). */
  add(budget: Budget, delta: Consumption): void {
    const now = this.clock();
    const k = this.key(budget.scope, budget.scopeId, budget.period);
    const expectedStart = periodWindowStart(budget.period, now);
    let entry = this.entries.get(k);
    if (!entry || entry.periodStart !== expectedStart) {
      entry = { tokens: 0, usd: 0, durationMs: 0, periodStart: expectedStart };
    }
    entry.tokens += delta.tokens;
    entry.usd += delta.usd;
    entry.durationMs += delta.durationMs;
    this.entries.set(k, entry);
  }

  snapshot(): Record<string, MeterEntry> {
    return Object.fromEntries(
      [...this.entries.entries()].map(([k, v]) => [k, { ...v }]),
    );
  }
}
