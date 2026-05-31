# POC 5c — Cost/Quota + Budgets per User/Session (enforced)

## Goal

Today usage is **tracked but not enforced**. The repo records `usage_events`
(tokens per user/model) after a run finishes, but nothing stops a run while it is
burning cost. With scheduled agents (POC 2a), long-running loops, and desktop
agents, a runaway loop can spend unbounded tokens / dollars / wall-clock before
anyone notices. POC 5c makes budgets **load-bearing**: token / $ / duration
limits per **user** and per **session**, with **soft warnings** and **hard
stops** evaluated *before each agent step* so the over-budget step never runs.

## What was built

Self-contained under `POC/5c-budgets/` (no root deps touched). Consumes the
real AI SDK `LanguageModelUsage` shape so it drops onto live step usage.

| File | Responsibility |
|------|----------------|
| `src/usage.ts` | `TokenUsage` (mirrors AI SDK `LanguageModelUsage`: input/output/total/cached), `addUsage` (mirrors repo `addLanguageModelUsage`), `totalTokenCount`. |
| `src/pricing.ts` | Per-model price table (`PRICE_TABLE`) + `usageToUsd()` token→$ conversion with cached-input discount and fail-expensive fallback. |
| `src/budget.ts` | Budget model (`scope` user\|session, `scopeId`, `limitTokens?`, `limitUsd?`, `limitDurationMs?`, `period` daily\|monthly\|per_session\|lifetime, `softThresholdPct`, `hardStop`) + `UsageMeter` that accumulates per scope/period **with automatic period-window reset**. |
| `src/enforce.ts` | `checkBudget(budgets, meter, projected)` → `ALLOW` / `WARN` / `BLOCK`. Evaluates **every** applicable scope across all three dimensions and returns the **most-restrictive** decision. |
| `src/gate.ts` | `runStepLoop()` — the agent-loop seam. Pre-step projection → `checkBudget` → on `BLOCK` halt gracefully with `stopReason="budget_exceeded"` (step does NOT run); on `WARN` annotate + continue. Post-step accounts **real** usage and records estimate-vs-actual **drift**. |
| `eval.test.ts` | 14 assertions across all required scenarios. |
| `trace.ts` | Writes per-step ALLOW/WARN/BLOCK traces + meter snapshots to `evidence/`. |

### Decision logic (most-restrictive-scope wins)

`checkBudget` evaluates each budget independently per dimension:

- `BLOCK` if `hardStop` and `current + projected > limit` (the projected step
  would push the scope strictly over a hard limit).
- `WARN` if projected utilization `>= softThresholdPct` (and not blocked).
- `ALLOW` otherwise. A `null` limit is "no cap on that dimension".

Across scopes it takes `max(severity)`: a run must satisfy **both** the user
budget AND the session budget. Session under its own budget but user over → BLOCK,
and vice versa.

## How it was tested + evidence

```bash
cd POC/5c-budgets
bun install
bun run eval        # bun test eval.test.ts  -> 14 pass / 0 fail
bun run eval:trace  # writes evidence/*.json + evidence/trace.txt
```

`bun test` result: **14 pass, 0 fail, 57 expect() calls.**

### Proof: hard stop halts BEFORE the over-budget step (`evidence/hard-stop.json`)

```
session limit=$0.025  soft=80%  per-step≈$0.0105
  step 0 PRE  decision=ALLOW projected=$0.0105 util=42%
  step 0 POST actual=$0.0105 drift=$0.0000
  step 1 PRE  decision=WARN  projected=$0.0105 util=84%
  step 1 POST actual=$0.0105 drift=$0.0000
  step 2 PRE  decision=BLOCK projected=$0.0105 util=126% <<< HALT (step not run)
  => stopReason=budget_exceeded  stepsRun=2  haltedBy=session/usd
  => observable work counter (expensive step ran N times) = 2
```

The **`workDone` side-effect counter = 2** while the loop saw 3 pre-step
decisions: the 3rd (BLOCK) halted before `runStep` incremented the counter —
proving the expensive over-budget step never executed.

### Proof: both scopes, most-restrictive wins (`evidence/both-scopes.json`)

```
2a user@$0.018/limit$0.02, session limit$100 -> BLOCK via user
2b user limit$100, session@$0.018/limit$0.02 -> BLOCK via session
2c both limit$100                              -> ALLOW
```

### Proof: soft threshold WARNs but continues

`(b)` in the suite: a $0.05 session budget at 80% soft threshold emits WARNs on
later steps yet runs all 4 steps to `max_steps`. With `hardStop=false`, a budget
WARNs indefinitely and never blocks.

### Proof: duration + period reset (`evidence/duration.json`, `evidence/period-reset.json`)

```
duration:  limitDurationMs=1000, step=400ms -> step2 projected 1200ms > 1000 -> BLOCK (dimension=durationMs)
reset:     May31 23:00Z spent=$0.90/$1 + $0.20 step -> BLOCK
           Jun01 01:00Z window reset -> spent=$0.00 + $0.20 step -> ALLOW
```

### Proof: reconciliation, estimate vs actual (`evidence/reconcile.json`)

Projection under-claims (`step(500,200)`), real actual is 3× (`step(1500,600)`).
Every post-step records `drift=$0.0090`, the meter accumulates the **real**
$0.108 total, and the loop halts on the real number — not the optimistic
estimate.

### Proof: long-running agent halted mid-run

`(e)` in the suite: a 50-step agent against a $0.05 daily user budget runs 4
steps then halts with `budget_exceeded` — it does not run to step 50.

## Integration plan

The repo already has the tracking half; 5c adds the enforcement half.

1. **Existing tracking to build on.**
   `apps/web/lib/db/usage.ts::recordUsage` writes `usage_events`
   (`apps/web/lib/db/schema.ts` line ~1448: `inputTokens`, `cachedInputTokens`,
   `outputTokens`, `provider`, `modelId`, `userId`). `usage-insights.ts` already
   aggregates per user. 5c's `UsageMeter` is the live, per-period rollup of those
   same numbers; in production it becomes a `usage_meter` table (or a cached
   aggregate over `usage_events`) plus a `budgets` table — both translate 1:1
   from `src/budget.ts`.

2. **The per-step enforcement seam** is the manual agent loop in
   `apps/web/app/workflows/chat.ts` (lines ~1218–1283). The loop already:
   - tracks `maxSteps` and breaks on `exhaustedMaxSteps` (line ~1279),
   - accumulates per-step usage via `addLanguageModelUsage(totalUsage,
     result.stepUsage)` (lines ~1263–1267, `usage-utils.ts`),
   - halts cleanly via an `AbortController` + `startStopMonitor` (line ~1723).

   The budget gate inserts at two points inside that loop, exactly as
   `src/gate.ts::runStepLoop` models:
   - **Before `runAgentStep`** (line ~1226): project the next step's cost and
     call `checkBudget(resolvedBudgets, meter, projected)`. On `BLOCK`, set a
     `budget_exceeded` stop reason and `break` (mirror the `exhaustedMaxSteps`
     path / trigger `abortController.abort()`); on `WARN`, attach an annotation
     to the assistant message metadata and continue.
   - **After the `result.stepUsage` accumulation** (line ~1267): call
     `meter.add(budget, actual)` with the real usage to keep the meter exact and
     reconcile drift. (The SDK-native equivalent is `prepareStep` for the
     pre-step check and `onStepFinish` for post-step accounting — see AI SDK
     docs; this repo uses the manual loop, so we hook the loop directly.)

3. **Price table.** `src/pricing.ts::PRICE_TABLE` keyed by the same model id
   stored on `usage_events.model_id`. Production should source it from a
   maintained config / the gateway price feed rather than hard-coding.

4. **Surfacing the halt to the user.** A `budget_exceeded` stop maps onto the
   existing `workflowStatus === "aborted"` path in `chat.ts` (lines ~1646–1660):
   event `workflow.aborted`, status `skipped`, summary "Agent workflow was
   stopped." The summary/stop-reason becomes "Stopped: <scope> budget exceeded
   (<dimension> at N% of limit)" using `BudgetCheckResult.decidingScope.reason`,
   shown the same way aborts already render.

## Feasibility verdict

**Feasible and low-risk to integrate.** The enforcement logic is pure and
side-effect-free, the agent loop already has a clean per-step boundary and a
graceful abort path, and the meter consumes the exact usage shape the loop
already produces. The only net-new infra is two tables (`budgets`,
`usage_meter`) and a transactional read/increment around the meter.

## Blind spots eliminated

- **Pre-step projection vs post-step actuals.** Both modeled distinctly: the
  gate decides on a *projection* before running, then accounts the *real* usage
  after. Reconciliation drift is recorded and the next check sees the true total
  (proven in `evidence/reconcile.json`: meter reaches real $0.108, not the
  optimistic estimate).
- **Multi-scope evaluation.** `checkBudget` evaluates every applicable budget and
  returns the most-restrictive decision; user-over and session-over both BLOCK
  (`evidence/both-scopes.json`).
- **Graceful halt vs crash.** BLOCK sets a `stopReason` and `break`s; no throw.
  Maps to the existing abort/`skipped` path, not the `failed` path.
- **Period resets.** `UsageMeter.read/add` detect a rolled-over UTC window and
  zero the accumulation; daily and monthly windows verified.
- **Non-token dimensions.** Wall-clock `durationMs` budget enforced alongside
  tokens and $ (the duration dimension drove the halt in `evidence/duration.json`).
- **Soft-only budgets.** `hardStop=false` warns forever and never blocks.

## Remaining risks

- **Concurrent runs racing the meter.** Two sessions for the same user check
  then increment the shared user meter; both could pass a check before either
  increments. The in-memory `UsageMeter` here is single-threaded. Production
  needs an atomic read-modify-write (e.g. `UPDATE ... RETURNING` or a row lock /
  `SELECT FOR UPDATE`) so the user-scope check is serialized; otherwise enforce
  a small safety margin below the hard limit.
- **$ price accuracy / model drift.** The price table can lag provider price
  changes or miss a new model id (the fallback is deliberately expensive). $
  budgets are only as accurate as the table; token/duration budgets are exact.
- **Hard-stop mid-tool-call safety.** The gate halts *between* steps, so a
  multi-step tool sequence already in flight isn't interrupted mid-write. A step
  whose actual cost massively overshoots its projection can still exceed the
  limit by one step's worth (bounded, reconciled afterward, surfaced as drift).
- **Non-token costs.** Sandbox compute minutes and desktop/VM runtime aren't
  tokens. The `durationMs` dimension covers wall-clock, but real sandbox/desktop
  billing would need its own meter dimension fed from the runtime's usage
  signals (POC 4a/4c), wired into the same `checkBudget` evaluation.
```
