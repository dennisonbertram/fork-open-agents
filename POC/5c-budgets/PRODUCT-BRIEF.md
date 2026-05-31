# Product Brief: Cost/Quota + Budgets per User/Session (enforced)

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
Usage is tracked but never enforced — open-agents records `usage_events` *after* a run, but nothing stops a runaway loop while it's burning tokens and dollars. POC 5c makes budgets load-bearing: token / $ / wall-clock limits per user and per session, evaluated **before each agent step**, with soft warnings and hard stops, taking the **most-restrictive** decision across all applicable scopes. The eval is hard-evidence (14/14 assertions, 57 assertions): a hard stop halts step 3 *before* the expensive work runs (the side-effect counter proves it), reconciliation halts on the *real* cost not the optimistic estimate, period windows reset, and duration budgets fire. Verdict: **Medium, low-risk**. This becomes a hard requirement — not a nice-to-have — the moment scheduled (2a), long-running (4a), and desktop agents ship.

## The gap today
The product can measure spend but cannot **stop** it. `usage_events` are written after a run finishes; `usage-insights.ts` aggregates per user — but there is no live meter and no enforcement, so a runaway loop, a stuck retry cycle, or a pathological long-running agent can spend unbounded tokens, dollars, and wall-clock before anyone notices. Today a human watching a chat is the only safety mechanism. The people who feel this pain hardest are exactly the ones the roadmap is courting: anyone running a **scheduled agent** that wakes unattended, a **long-running loop**, or a **desktop agent** off in the background. For them, "tracked but not enforced" means "one bad night = an unbounded bill."

## What we'd build
Enforced budgets as a first-class control. Admins/users set limits — tokens, dollars, and/or duration — scoped to a **user** or a **session**, over a **period** (daily | monthly | per-session | lifetime), each with a soft-warning threshold and a hard-stop flag. Before every agent step, the gate projects the next step's cost, evaluates **every applicable budget across all three dimensions**, and takes the most-restrictive outcome: **BLOCK** (halt gracefully, the step never runs), **WARN** (annotate and continue), or **ALLOW**. After the step, it accounts the *real* usage and records estimate-vs-actual **drift**, so the meter stays exact and the next check sees the true total. The POC proves the load-bearing behavior end to end: the over-budget step is provably never executed (work-counter = 2 while 3 pre-step decisions were made), user-over and session-over both BLOCK independently, soft budgets WARN forever without blocking, UTC period windows reset, and a duration budget halts a too-slow loop. It consumes the exact AI SDK `LanguageModelUsage` shape the agent loop already produces and reuses the existing graceful-abort path.

## How users experience it
### Where it lives (exposure)
- **A budgets settings page** (per user, and — for teams — per workspace) to define limits: pick scope (user/session), dimensions (tokens / $ / duration), period, soft threshold %, and hard-stop on/off.
- **Per-session budget override** at session creation ("cap this session at $0.50") for one-off expensive tasks.
- **An in-chat budget meter** — a live gauge in the session header showing spend against the binding limit, turning amber at the soft threshold.
- **The budget-exceeded halt message** rendered inline in the chat when a hard stop fires, reusing the existing aborted-workflow surface.

### Sample UI
**Budget config (settings):** a form per budget — scope selector, three optional limit fields (tokens / USD / duration) each with "no cap" as the empty state, period dropdown, soft-threshold slider (default 80%), and a hard-stop toggle (off = warn-only). A summary line: "User: $20/day, hard stop at 100%, warn at 80%."

**Usage gauge (in-chat header):** a compact meter against the *binding* budget (the most-restrictive applicable one), labeled with scope and dimension — e.g. "Session • $0.021 / $0.025 (84%)". It shows which scope is closest to its limit.

**Budget-exceeded halt message (in-chat):** when a hard stop fires, the agent's run ends with a clear, non-error banner: "**Stopped: session budget exceeded** — USD at 126% of $0.025 limit. The next step was not run." with a "Raise this budget" / "Continue anyway (admin)" affordance where policy allows.

States to design:
- **Healthy** — gauge green, no annotations.
- **Soft-warned** — gauge amber, an inline "Approaching session budget (84%)" annotation on the assistant message; the run continues.
- **Hard-stopped** — gauge red, the halt banner; the run ended *gracefully* (skipped, not failed), the unrun step explicitly called out.
- **Which-scope-bound** — when user and session budgets differ, the gauge and halt message name the *deciding* scope and dimension (e.g. "halted by user/usd," "halted by session/durationMs").
- **Period-reset** — gauge resets to zero at the window rollover, with a "resets daily at 00:00 UTC" subtitle.
- **Warn-only budget** — a budget with hard-stop off shows persistent amber warnings and never halts (made explicit so users understand it's advisory).
- **Drift surfaced (operator view)** — estimate-vs-actual drift visible in a usage/debug view so a step that overshoots its projection is explainable.

### UX walkthrough
1. A user sets a session budget of $0.025, hard-stop on, soft 80%.
2. Step 0 runs (projected $0.0105, 42% util) — gauge green.
3. Step 1's projection pushes util to 84% — gauge amber, an "approaching budget" annotation appears, the step runs.
4. Before step 2, the projection is 126% of the limit — the gate returns **BLOCK**. The step never runs; the work-side-effect counter stays at 2.
5. The chat shows the halt banner: "Stopped: session budget exceeded — USD at 126%." The run ends gracefully (skipped, not failed).
6. The user clicks "Raise this budget" (or waits for the daily user-budget window to reset), and re-runs.
7. For a long-running scheduled agent, the same gate caps a 50-step run at the 4 steps the $0.05 daily user budget affords — it halts with `budget_exceeded` instead of running to step 50 unattended.

## Value to the user
**Job to be done:** "Let me run agents — including unattended ones — without risking an unbounded bill, and warn me before I'm about to blow the budget."
- **Scenario — scheduled agent safety.** A nightly standing agent hits a degenerate loop; the daily user budget halts it after a few steps instead of burning all night.
- **Scenario — cost-capped exploration.** A user caps a speculative refactor session at $0.50 to time-box the spend, and gets a clean halt with a "raise and continue" option instead of a surprise invoice.
- **Scenario — team guardrails.** A workspace admin sets per-user daily limits so no single member can run away with the org's spend, with soft warnings giving people a heads-up before they're cut off.

## Value to the product
- **It makes the rest of the roadmap financially safe to ship.** Scheduled (2a), long-running (4a), and desktop agents are unsafe to offer without enforced budgets — an unattended agent with no spend cap is a liability. 5c is the safety belt those features require to launch.
- **It enables aggressive plans and quotas.** Hard enforcement lets us offer free tiers, included quotas, and metered overages with confidence that a runaway can't blow past the plan — directly enabling monetization and packaging.
- **Trust and enterprise readiness.** "We will never let an agent spend past your limit" is a concrete trust and procurement story; budgets-as-guardrails is table stakes for org adoption.
- **Cost control on our own infra.** Enforced ceilings protect *our* margins, not just the user's bill — a runaway loop on a generous plan is our cost too.

## The case FOR (strong)
1. **It's the safety prerequisite for the most valuable roadmap items.** Standing, long-running, and desktop agents are exactly the features that can spend unbounded while unattended. 5c is what makes them safe to ship — it's load-bearing, not optional, the moment those land.
2. **The enforcement is proven to actually stop spend before it happens.** The eval doesn't just check a decision — the work-side-effect counter proves the over-budget step *never executed* (counter = 2 across 3 pre-step decisions). And it halts on the *real* reconciled cost, not the optimistic estimate, so it can't be fooled by under-projection.
3. **Low-risk, clean integration.** The enforcement logic is pure and side-effect-free; the agent loop in `chat.ts` already has a per-step boundary, already accumulates per-step usage in the exact `LanguageModelUsage` shape, and already has a graceful `AbortController` path. BLOCK maps onto the existing `aborted`/`skipped` surface — no new failure mode.
4. **Multi-dimensional and multi-scope, correctly.** Tokens *and* dollars *and* wall-clock, evaluated across both user and session scopes with most-restrictive-wins — the eval proves user-over and session-over both block independently. This matches how real limits work (a session under budget shouldn't run if the user is over).
5. **It builds on infra we already have.** The tracking half (`usage_events`, `recordUsage`, `usage-insights`) exists; 5c adds the enforcement half as two tables (`budgets`, `usage_meter`) plus a transactional increment. We're completing a half-built capability, not starting from zero.

## The case AGAINST (strong)
1. **Concurrent runs can race the shared meter.** Two sessions for the same user check-then-increment the user meter; both can pass the check before either increments, briefly overshooting the limit. The POC's meter is single-threaded — production needs an atomic read-modify-write (`UPDATE ... RETURNING` / `SELECT FOR UPDATE`) or a safety margin. This is the central correctness risk and it's not solved in the POC.
2. **Dollar budgets are only as accurate as a price table that will drift.** `PRICE_TABLE` can lag provider price changes or miss a new model id (the fallback is deliberately expensive, which can over-block). Token and duration budgets are exact; **$** budgets carry ongoing maintenance and a real risk of being subtly wrong. Sourcing from a maintained feed is required, not optional.
3. **Hard stops are between-step, not mid-tool-call.** A step whose actual cost massively overshoots its projection can exceed the limit by one step's worth before the next gate fires — bounded and reconciled, but not a hard ceiling to the dollar. A multi-step tool sequence already in flight isn't interrupted mid-write. "Hard stop" has an honest fuzz band.
4. **Non-token costs aren't covered yet.** Sandbox compute minutes and desktop/VM runtime aren't tokens. The `durationMs` dimension covers wall-clock, but true sandbox/desktop billing needs its own meter dimension fed from runtime signals (4a/4c) — so "budget" is incomplete until those land, exactly when budgets matter most.
5. **A wrong block is worse than a missed warning.** An over-aggressive or mis-priced budget that halts a legitimate, important run mid-task is a sharp negative experience — and the failure mode of an *enforcement* feature is cutting off work the user wanted. The "continue anyway" / raise-budget escape hatch is essential, and getting its policy right (who can override?) is non-trivial.

## Effort, dependencies & risk
- **Feasibility verdict (from POC): Medium, low-risk.** Pure enforcement logic; the loop already has the per-step boundary, the usage shape, and a graceful abort path.
- **Build size:** two tables (`budgets`, `usage_meter`, both translating 1:1 from `src/budget.ts`) over the existing `usage_events`; the per-step gate wired at two points in the `chat.ts` loop (pre-step projection → `checkBudget`; post-step real-usage accounting + drift); a maintained price table sourced from config/gateway feed; the halt mapped onto the existing `workflowStatus === "aborted"` surface; plus the net-new **budget settings page, in-chat gauge, and halt UI**. The one piece of net-new infra to get right is the **transactional read/increment** for concurrency.
- **Dependencies:** builds on existing usage tracking. Becomes **load-bearing once 2a (scheduled), 4a (long-running), and desktop agents ship** — sequence it to land *before or with* the first unattended-agent feature. Non-token (compute/runtime) budgets depend on 4a/4c usage signals.
- **Top risks + mitigations:** meter race → atomic `UPDATE ... RETURNING` / row lock, or a safety margin below the hard limit; price drift → source the table from a maintained feed, fail-expensive fallback, alert on unknown model ids; between-step overshoot → bound + reconcile + surface as drift, optionally tighten projection; non-token costs → add a runtime-fed meter dimension into the same `checkBudget` once 4a/4c land; wrong-block UX → soft-warn-first defaults, raise-budget / admin-override escape hatch.

## The decision
**The crisp question:** Do we make budgets enforced (hard stops, not just warnings) now — accepting we must solve the meter-concurrency race and stand up a maintained price feed — or keep "tracked but not enforced" until an unattended-agent feature forces it?

**Recommended trigger to greenlight:** Greenlight **before the first unattended-agent feature ships** (2a scheduled / 4a long-running / desktop). If any of those is on the near roadmap, build 5c now — it's their safety prerequisite. Ship token + duration enforcement first (exact), then $ enforcement once the maintained price feed and atomic meter are in place.

**Success metrics:** zero unbounded-spend incidents on unattended agents (must be zero); % of runaway loops halted by budget vs. by human/timeout; meter accuracy (post-reconciliation drift within tolerance); overshoot beyond hard limit kept within one step's worth; false-block rate (legitimate runs halted) kept low with the override hatch; adoption of per-user/workspace budgets.

**Suggested default: BUILD — sequenced to land with the first unattended-agent feature.** It's Medium-effort, low-risk, and completes a half-built capability. It isn't urgent while every run is human-watched, but it is a *hard* prerequisite for scheduled/long-running/desktop agents being financially safe. Build token+duration enforcement first (exact, no price-table risk), add $ enforcement behind a maintained price feed and an atomic meter, and ship it *before* the first agent that runs unattended.
