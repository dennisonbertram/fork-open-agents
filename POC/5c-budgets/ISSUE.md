<!-- TITLE: feat: Cost & budget enforcement per user/session (token/$/time soft + hard limits) -->

## Why this matters

Usage is tracked but never enforced. open-agents writes `usage_events` *after* a
run finishes (`apps/web/lib/db/usage.ts::recordUsage`) and `usage-insights.ts`
aggregates per user — but there is no live meter and nothing stops a run while it
is burning cost. A runaway loop, a stuck retry cycle, or a pathological
long-running agent can spend unbounded tokens, dollars, and wall-clock before
anyone notices. Today the only safety mechanism is a human watching the chat. The
people who feel this hardest are exactly the ones the roadmap is courting:
scheduled agents that wake unattended (POC 2a), long-running loops (4a), and
desktop agents — for them, "tracked but not enforced" means "one bad night = an
unbounded bill."

POC 5c (PR #93, `poc/5c-budgets`) proved enforced budgets: token / $ / duration
limits per **user** and per **session**, evaluated **before each agent step**,
with soft warnings and hard stops, taking the **most-restrictive** decision
across all applicable scopes. The eval is hard-evidence (14/14 assertions, 57
`expect()` calls): a hard stop halts step 3 *before* the expensive work runs (the
`workDone` side-effect counter stays at 2 while 3 pre-step decisions were made),
reconciliation halts on the *real* reconciled cost not the optimistic estimate,
UTC period windows reset, and a duration budget fires. Verdict: **Medium,
low-risk** — the enforcement logic is pure and the agent loop already has a clean
per-step boundary and a graceful abort path. This issue scopes the production
build: two tables, the per-step gate wired into `chat.ts`, a maintained price
table, the halt mapped onto the existing aborted surface, and the budget UI.

## User/operator path protected

The agent step loop in `apps/web/app/workflows/chat.ts` (~L1221–L1283). Today
that loop runs steps until `maxSteps` with no spend ceiling: it accumulates
per-step usage via `addLanguageModelUsage(totalUsage, result.stepUsage)`
(~L1263–L1267) and halts cleanly only on `exhaustedMaxSteps` or an
`AbortController`. After this work, **the over-budget step never runs**: a
pre-step gate projects the next step's cost, evaluates every applicable budget,
and on a hard-limit breach halts gracefully (maps onto the existing
`aborted`/`skipped` surface, not the `failed` path) before `runAgentStep` is
called. The protected guarantee is that no step executes that would push a
hard-stop scope strictly over its limit, and that the **most-restrictive scope
wins**. This is an enforcement boundary and must be locked by a regression test.

## Behavior contract

- **Given** a session budget of $0.025 (hard stop on, soft 80%) and per-step cost
  ≈$0.0105, **when** step 0 projects 42% utilization, **then** the gate returns
  `ALLOW` and the step runs (gauge green).
- **Given** step 1 projects 84% utilization, **when** the gate evaluates it,
  **then** it returns `WARN` (gauge amber, an "approaching budget" annotation),
  and the step still runs.
- **Given** step 2 projects 126% of the limit, **when** the gate evaluates it,
  **then** it returns `BLOCK`, the step **never runs** (the work-side-effect
  counter does not increment), and the run halts gracefully with
  `stopReason="budget_exceeded"`.
- **Given** a user budget at $0.018/$0.02 and a session budget at $100, **when**
  the next step is projected, **then** the most-restrictive scope wins and the
  run is BLOCKed via the **user** scope; symmetrically, user $100 + session
  $0.018/$0.02 BLOCKs via the **session** scope.
- **Given** a budget with `hardStop=false`, **when** projected utilization
  exceeds the soft threshold, **then** it WARNs indefinitely and never BLOCKs.
- **Given** a duration budget `limitDurationMs=1000` and ~400ms steps, **when** a
  step would project >1000ms cumulative, **then** the gate BLOCKs on the
  `durationMs` dimension.
- **Given** a daily budget at $0.90/$1.00 at 23:00Z, **when** the UTC window rolls
  to 01:00Z, **then** the meter resets to $0.00 and the next step is ALLOWed.
- **Given** a projection that under-claims (actual is 3× the estimate), **when**
  the step finishes, **then** the meter accounts the **real** usage, records the
  estimate-vs-actual drift, and the next check decides on the true total.

## Product and design spec

### UX — how users use it & how it's exposed

- **A budgets settings page** (per user, and — for teams — per workspace) to
  define limits: pick scope (user/session), dimensions (tokens / $ / duration,
  each with "no cap" as the empty state), period (daily | monthly | per_session |
  lifetime), a soft-threshold slider (default 80%), and a hard-stop toggle (off =
  warn-only). A summary line: "User: $20/day, hard stop at 100%, warn at 80%."
- **Per-session budget override** at session creation ("cap this session at
  $0.50") for one-off expensive tasks.
- **An in-chat usage meter** — a compact live gauge in the session header showing
  spend against the *binding* (most-restrictive applicable) budget, labeled with
  scope + dimension, e.g. "Session • $0.021 / $0.025 (84%)".
- **The budget-exceeded halt message** rendered inline in the chat when a hard
  stop fires, reusing the existing aborted-workflow surface, with a "Raise this
  budget" / "Continue anyway (admin)" affordance where policy allows.

### UX — how the feature demonstrates & explains its value to the user

The value is the absence of a surprise bill plus a heads-up before the cliff. The
user sees their spend in real time and never gets cut off without warning: the
gauge turns amber at the soft threshold and an "approaching budget" annotation
appears *before* the hard stop. When the hard stop fires, the halt is a clear,
non-error banner that explicitly says the next step was **not** run — the user
sees the system actively protecting them, not failing on them. For a long-running
scheduled agent, the same gate caps a 50-step run at the 4 steps a $0.05 daily
budget affords and halts with `budget_exceeded` instead of running all night —
visible proof that unattended agents are financially safe.

### UX — how it's clear what the feature is doing (states & feedback)

Every state is designed and reachable:
- **Healthy** — gauge green, no annotations.
- **Soft-warned** — gauge amber, an inline "Approaching session budget (84%)"
  annotation on the assistant message; the run continues.
- **Hard-stopped** — gauge red, the halt banner: "**Stopped: session budget
  exceeded** — USD at 126% of $0.025 limit. The next step was not run." The run
  ends *gracefully* (skipped, not failed); the unrun step is explicitly called
  out.
- **Which-scope-bound** — when user and session budgets differ, the gauge and
  halt message name the *deciding* scope + dimension (e.g. "halted by user/usd,"
  "halted by session/durationMs").
- **Period-reset** — gauge resets to zero at window rollover with a "resets daily
  at 00:00 UTC" subtitle.
- **Warn-only budget** — a hard-stop-off budget shows persistent amber warnings
  and never halts (made explicit so users know it's advisory).
- **Drift surfaced (operator view)** — estimate-vs-actual drift visible in a
  usage/debug view so a step that overshoots its projection is explainable.

### UX — how to test the UX, including regressions

Use the [Authenticated Local UI Smoke](../../docs/process/development-workflow.md#authenticated-local-ui-smoke):
confirm DB env, apply migrations, `bun run web`, sign in.

- **Drive:** Set a session budget ($0.025, hard stop, soft 80%) on the budgets
  settings page; assert the summary line. Start a session and run steps; assert
  the gauge goes green → amber (annotation at 84%) → red (halt banner) and that
  the banner names the deciding scope/dimension and says "next step was not run."
  Set a warn-only budget; assert persistent amber and no halt. Set a daily budget
  near its cap; assert the period-reset subtitle. Configure both user and session
  budgets with different limits; assert the gauge/banner name the binding scope.
- **Assertions:** the halt renders on the aborted/skipped surface (not failed);
  the gauge reflects the binding budget; the annotation appears at the soft
  threshold.
- **UX regressions to lock (fail-before/pass-after):** (1) a hard-stop budget
  must produce a halt banner *before* the over-limit step's effects appear (fail
  before the gate; pass after); (2) a warn-only budget must never halt; (3) the
  deciding-scope label must match the most-restrictive scope. Capture screenshots
  of healthy / soft-warned / hard-stopped / period-reset states and the
  budget-exceeded halt message; check `agent-browser errors`/`console` and the
  dev-server log.

## Integration spec

- **Data model:** add two tables to `apps/web/lib/db/schema.ts`, translating 1:1
  from `POC/5c-budgets/src/budget.ts`:
  - `budgets`: `id`, `scope` (`user`|`session`), `scopeId`, `limitTokens?`,
    `limitUsd?`, `limitDurationMs?`, `period` (`daily|monthly|per_session|
    lifetime`), `softThresholdPct`, `hardStop`.
  - `usage_meter`: per scope/period accumulation (tokens / usd / durationMs) with
    automatic UTC period-window reset — the live rollup of the same numbers
    `usage_events` (`schema.ts` ~L1448: `inputTokens`, `cachedInputTokens`,
    `outputTokens`, `provider`, `modelId`, `userId`) already records.
- **Per-step enforcement seam:** the manual agent loop in
  `apps/web/app/workflows/chat.ts` (~L1221–L1283). Insert the gate at two points,
  exactly as `POC/5c-budgets/src/gate.ts::runStepLoop` models:
  - **Before `runAgentStep`** (~L1226): project the next step's cost and call
    `checkBudget(resolvedBudgets, meter, projected)`. On `BLOCK`, set a
    `budget_exceeded` stop reason and `break` (mirror the `exhaustedMaxSteps`
    path / `abortController.abort()`); on `WARN`, attach an annotation to the
    assistant-message metadata and continue.
  - **After usage accumulation** (~L1263–L1267, right after
    `addLanguageModelUsage(totalUsage, result.stepUsage)`): call
    `meter.add(budget, actual)` with the **real** usage to keep the meter exact
    and reconcile drift.
- **Enforcement logic:** port `enforce.ts::checkBudget` (`ALLOW`/`WARN`/`BLOCK`,
  most-restrictive across scopes and across all three dimensions) and `budget.ts`
  `UsageMeter` (period-window reset) — both pure.
- **Price table:** `POC/5c-budgets/src/pricing.ts::PRICE_TABLE` keyed by the same
  model id stored on `usage_events.model_id`, with `usageToUsd()` (cached-input
  discount, fail-expensive fallback). Production sources it from a maintained
  config / gateway price feed rather than hard-coding.
- **Concurrency:** the live meter increment must be a transactional
  read-modify-write (`UPDATE ... RETURNING` or `SELECT ... FOR UPDATE`) so the
  user-scope check is serialized across concurrent sessions; otherwise enforce a
  small safety margin below the hard limit.
- **Surfacing the halt:** a `budget_exceeded` stop maps onto the existing
  `workflowStatus === "aborted"` path in `chat.ts` (event `workflow.aborted`,
  status `skipped`), with the summary "Stopped: <scope> budget exceeded
  (<dimension> at N% of limit)" from `BudgetCheckResult.decidingScope.reason`.
- **Events/observability:** a named `budget-enforcement` service emits structured
  pre-step / warn / block / reconcile / reset events (see Observability).

## In scope

- `budgets` + `usage_meter` tables + migration over the existing `usage_events`.
- The pure `checkBudget` enforcement logic (most-restrictive across scopes and
  the token/$/duration dimensions) and the period-resetting `UsageMeter`.
- The per-step gate wired at the two points in the `chat.ts` loop (pre-step
  projection → `checkBudget`; post-step real-usage accounting + drift).
- A **transactional read/increment** for the meter (the one piece of net-new
  infra to get right for concurrency).
- A maintained price table sourced from config/gateway feed, fail-expensive
  fallback, unknown-model alerting.
- The halt mapped onto the existing aborted/skipped surface with stop-reason
  copy.
- The budget settings page, per-session override, in-chat usage gauge, and
  halt UI.
- Structured observability and the enforcement (over-budget-step-never-runs)
  regression test.

## Out of scope

- Token + duration enforcement ships first (exact); **$** enforcement is gated
  behind the maintained price feed + atomic meter landing (ship behind the same
  flag, enable $ second).
- Non-token costs beyond wall-clock (sandbox compute minutes, desktop/VM
  runtime) — a runtime-fed meter dimension depends on POC 4a/4c signals and is a
  fast-follow into the same `checkBudget`.
- Mid-tool-call interruption — the gate halts *between* steps; a multi-step tool
  sequence in flight is not interrupted mid-write (bounded overshoot, reconciled
  + surfaced as drift).
- A full overage-billing / metered-plan system (budgets are the guardrail; plans
  consume them later).
- Any dependency on 5a (memory) or 5b (multi-repo).

## Research and context sources

- POC PR: #93 (`poc/5c-budgets`).
- POC folder: `POC/5c-budgets/` — `README.md`, `PRODUCT-BRIEF.md`,
  `src/usage.ts`, `src/pricing.ts`, `src/budget.ts`, `src/enforce.ts`,
  `src/gate.ts`, `eval.test.ts`, `trace.ts`.
- Eval evidence: `POC/5c-budgets/evidence/` — `hard-stop.json` (step never runs),
  `both-scopes.json` (most-restrictive wins), `duration.json`,
  `period-reset.json`, `reconcile.json`, `trace.txt`.
- Repo seams: `apps/web/lib/db/usage.ts` (`recordUsage`),
  `apps/web/lib/db/schema.ts` (`usageEvents` ~L1448),
  `apps/web/app/workflows/chat.ts` (step loop ~L1221–L1283;
  `addLanguageModelUsage` accumulation ~L1263–L1267; aborted/skipped surface),
  `apps/web/app/workflows/usage-utils.ts` (`addLanguageModelUsage`),
  `apps/web/lib/usage/` (`usage-insights`).
- Project docs: [Behavior-First TDD](../../docs/process/behavior-tdd.md),
  [Observability Discipline](../../docs/process/observability-discipline.md),
  [Feature Ticket Format](../../docs/process/feature-ticket-format.md).
- Context7/vendor: AI SDK `LanguageModelUsage` shape; `prepareStep`/
  `onStepFinish` (the SDK-native equivalents of the manual-loop hook points).

## Agent todo checklist

- [ ] Read `POC/5c-budgets/README.md`, `PRODUCT-BRIEF.md`, and `src/` to map the
      gate/meter/enforce shapes onto the current `chat.ts` loop.
- [ ] Add a **failing** enforcement test: an over-budget step must not run (a
      work side-effect counter stays below the step count when a hard limit is
      breached). Confirm red.
- [ ] Add a **failing** most-restrictive-scope test (user-over and session-over
      each BLOCK independently). Confirm red.
- [ ] Add failing tests for soft-WARN-continues, duration BLOCK, period reset,
      and reconciliation-on-real-cost. Confirm red.
- [ ] Commit the failing test-only state on the work branch.
- [ ] Add `budgets` + `usage_meter` to `schema.ts`; run
      `bun run --cwd apps/web db:generate`; commit the `.sql`.
- [ ] Port `checkBudget` + `UsageMeter` (pure logic) into the web app.
- [ ] Implement the **transactional** meter read/increment for concurrency.
- [ ] Wire the pre-step gate before `runAgentStep` (~L1226) and the post-step
      `meter.add` after usage accumulation (~L1263–L1267).
- [ ] Map `budget_exceeded` onto the existing aborted/skipped surface with the
      stop-reason copy.
- [ ] Add the maintained price table + `usageToUsd` with fail-expensive fallback
      and unknown-model alerting.
- [ ] Build the budget settings page, per-session override, in-chat gauge, and
      halt UI.
- [ ] Add `budget-enforcement` structured events + redaction.
- [ ] Run targeted tests; run the authenticated local UI smoke; capture
      screenshots.
- [ ] Run the adjacent workflow suite, `git diff --check`, and
      `bun --bun run ci`.
- [ ] Update process/agent docs with verification notes.

## Tests to add first

1. **Enforcement (the over-budget step never runs)** — drive a step loop against
   a hard-stop budget where step N would exceed the limit; assert a
   side-effect/work counter records N-1 executions while N pre-step decisions
   were made, and `stopReason="budget_exceeded"`. **Must fail before the
   pre-step gate exists.**
2. **Most-restrictive scope** — user-over/session-under BLOCKs via user;
   session-over/user-under BLOCKs via session; both-under ALLOWs. Names the
   deciding scope/dimension.
3. **Soft WARN continues** — a `hardStop=false` budget WARNs past the soft
   threshold and runs to `maxSteps` without blocking.
4. **Duration dimension** — a `limitDurationMs` budget BLOCKs when a step would
   project cumulative wall-clock over the limit.
5. **Period reset** — a daily/monthly window rollover zeroes the meter and a
   previously-blocked projection ALLOWs after reset.
6. **Reconciliation** — when actual >> projection, the meter accounts the real
   usage, records drift, and the next check decides on the true total.

## Observability and user feedback

- **User-visible status:** the in-chat usage gauge (binding scope/dimension), the
  soft-warn annotation, and the budget-exceeded halt banner (deciding scope +
  dimension + "next step not run"); the operator drift view.
- **Named service:** `budget-enforcement` emits structured events.
  - `budget-check` at info: `{ userId, sessionId, chatId, step, decision:
    "ALLOW"|"WARN"|"BLOCK", decidingScope, decidingDimension, projectedUsd,
    projectedTokens, utilizationPct }`.
  - `budget-block` at warn: `{ userId, sessionId, chatId, budgetId, scope,
    dimension, limit, projected, utilizationPct }`.
  - `budget-warn` at info: `{ userId, sessionId, chatId, budgetId, scope,
    dimension, utilizationPct }`.
  - `meter-reconciled` at debug: `{ userId, sessionId, chatId, step,
    projectedUsd, actualUsd, driftUsd }`.
  - `meter-period-reset` at info: `{ scope, scopeId, period, window }`.
  - `price-unknown-model` at warn: `{ modelId }` (drives a fail-expensive
    fallback + an operator alert).
- **Typed error kinds:** `errorKind` ∈ `budget_exceeded | meter_race_detected |
  price_unknown_model | meter_increment_failed`.
- **Correlation IDs:** `userId`, `sessionId`, `chatId`, `budgetId`, `step`.
- **Redaction:** never log prompt/session content or provider tokens — log only
  numeric usage, costs, utilization, model ids, and scope ids. Budget config
  values (limits) are operational, not secret.
- **Debug recipes:**
  `grep '"service":"budget-enforcement"' logs | grep '"chatId":"<id>"'`;
  to find hard stops: `grep '"budget-block"' logs | grep '"userId":"<id>"'`;
  to audit drift: `grep '"meter-reconciled"' logs | grep '"driftUsd"'`.
- **Evidence expectation:** screenshots of healthy / soft-warned / hard-stopped /
  period-reset states + the halt banner, plus a log excerpt showing the
  `budget-check` ALLOW→WARN→BLOCK sequence for one run and a `meter-reconciled`
  drift entry.

## Regression harness plan

- **Existing coverage:** usage *tracking* tests exist (`recordUsage` /
  `usage-insights`); there is **no** enforcement coverage. The `chat.ts`
  step-loop tests are the integration anchor.
- **New durable signals:**
  - An **enforcement regression test** proving the over-budget step never runs
    (work counter < step count on a hard-limit breach) — the smallest durable
    signal that enforcement regressed; this is the security/safety boundary.
  - A most-restrictive-scope test (user-over and session-over both BLOCK).
  - Soft-WARN-continues, duration-BLOCK, period-reset, and reconciliation tests
    ported from the POC eval as in-repo unit tests.
  - A workflow test proving the gate is wired at both points in the real loop.
  - An authenticated UI smoke for the gauge/annotation/halt states.
- **Fixtures:** the POC's fixed per-step usage shapes and price table; UTC clock
  injection for period-reset.
- **Fail-before/pass-after:** the enforcement test fails before the pre-step gate;
  the reconciliation test fails if the meter records projections instead of
  actuals; the scope test fails with single-scope evaluation.
- **Limits not caught by the harness:** the meter-race under real concurrency
  (needs a DB-level transactional test and/or a safety margin), price-table drift
  vs. live provider prices, between-step overshoot when actual >> projection, and
  non-token (sandbox/desktop) costs that aren't yet metered. These are documented
  as risks and mitigated by the transactional increment, fail-expensive fallback,
  drift reconciliation, and a deferred runtime-fed dimension.

## TDD audit trail

- **Red commit 1:** enforcement test (over-budget step never runs) — observed
  failing.
- **Red commit 2:** most-restrictive-scope + soft-WARN + duration + period-reset
  + reconciliation tests — failing.
- **Green commit 1:** `budgets`/`usage_meter` schema + ported `checkBudget`/
  `UsageMeter` → scope/WARN/duration/reset/reconcile green.
- **Green commit 2:** pre-step gate + post-step `meter.add` wired into the
  `chat.ts` loop with transactional increment → enforcement test green.
- **Green commit 3:** halt mapped onto aborted/skipped + price table.
- **Green commit 4:** budget settings page / gauge / halt UI + observability.
- Any deviation recorded as an explicit exception in the PR.

## Regression risks and concerns

- **Meter-race concurrency** — two sessions for one user check-then-increment the
  shared user meter; both can pass before either increments, briefly overshooting.
  Mitigation: atomic `UPDATE ... RETURNING` / `SELECT FOR UPDATE`, or a safety
  margin below the hard limit. Central correctness risk.
- **Price-table drift** — the table can lag provider price changes or miss a new
  model id; the fallback is deliberately expensive (can over-block). Mitigation:
  source from a maintained feed, fail-expensive fallback, alert on unknown model
  ids. Token/duration budgets stay exact.
- **Between-step overshoot** — a step whose actual cost massively overshoots its
  projection can exceed the limit by one step's worth before the next gate fires
  (bounded, reconciled, surfaced as drift); hard stops are between-step, not
  mid-tool-call.
- **Non-token costs** — sandbox compute minutes and desktop/VM runtime aren't
  tokens; `durationMs` covers wall-clock but true sandbox/desktop billing needs a
  runtime-fed dimension (4a/4c) wired into the same `checkBudget`.
- **Wrong-block UX** — an over-aggressive or mis-priced budget halting a
  legitimate run is a sharp negative; the raise-budget / admin-override escape
  hatch and soft-warn-first defaults are required, and override policy (who can
  override?) must be deliberate.

## Deploy or migration impact

- **Migration:** new Drizzle migration adding `budgets` and `usage_meter` over the
  existing `usage_events`. Migrations apply automatically on `bun run build` per
  deploy; Neon preview branching isolates preview data.
- **Config:** the maintained **price table** must be configured/sourced (config
  or gateway price feed) with a fail-expensive fallback and an unknown-model
  alert; document its update procedure.
- **Feature flag:** ship behind a budget-enforcement flag. Enable
  **token + duration** enforcement first (exact); enable **$** enforcement only
  after the maintained price feed and the atomic meter increment are in place.
- **Operational:** verify the transactional meter increment under the production
  DB (row lock / `RETURNING`); no user data backfill required (the meter rolls up
  from new usage).

## Definition of done

- [ ] Protected path named: the `chat.ts` step loop — the over-budget step never
      runs.
- [ ] Behavior proof written as a **red** enforcement test first and observed
      failing.
- [ ] Red-test commit recorded on the work branch (or an explicit exception).
- [ ] Green implementation commit(s) follow the red commit.
- [ ] **Security/safety enforcement regression test** (over-budget step never
      runs; most-restrictive scope wins) present and green.
- [ ] Targeted tests pass (enforcement, scope, soft-WARN, duration, period-reset,
      reconciliation, workflow wiring).
- [ ] Adjacent workflow suite passes.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (enforcement + scope + dimensions + reset +
      reconcile + workflow + UI smoke).
- [ ] Observability evidence captured (state screenshots + halt banner + a
      check ALLOW→WARN→BLOCK and a drift-reconcile log excerpt).
- [ ] Deploy notes included (`budgets`/`usage_meter` migration + price-table
      config + feature flag; token/duration first, $ second).
- [ ] Docs updated (architecture/lessons-learned + verification notes).
