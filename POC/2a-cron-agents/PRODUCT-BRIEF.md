# Product Brief: Cron-Triggered Standing Agents

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
Standing agents let a user save a prompt + repo + schedule once, then have an agent run it on a recurring cadence with the result landing as a chat message or a PR — no human in the loop per run. The POC proved the full cron path end-to-end against a real database (23/23 assertions: due-job selection, cron correctness, idempotency under concurrency, `CRON_SECRET` auth, and result landing) and showed it reuses machinery the repo already ships. The single open dependency is durability: the cron handler dispatches the run, but the run must survive function teardown, which is exactly what POC 2b establishes. Recommendation: greenlight, but sequence it after 2b lands.

## The gap today
Every agent run in open-agents is human-initiated (a person types into chat) or webhook-initiated (a GitHub event fires). There is no way to say "run this prompt against this repo every weekday at 9am" and walk away. The people who feel this most are the exact power users the product wants to retain: a maintainer who wants a nightly dependency-bump PR, an on-call engineer who wants a morning "summarize what changed and what's flaky" briefing, a docs owner who wants a weekly "find stale docs and open a PR" pass. Today they either babysit the agent manually or wire up their own GitHub Action and lose the streaming chat UI, the session history, and the repo context that make open-agents worth using. The product is reactive; standing agents make it proactive.

## What we'd build
A "Schedules" capability: a user picks a repo, writes a prompt, sets a cron schedule (with friendly presets like "every weekday 9am"), optionally toggles "open a PR with the result," and saves it. From then on the platform fires the agent on cadence, materializes a session + chat for each run, executes the saved prompt, and lands the output as an assistant message in a new chat (and a PR when toggled). The POC proved the proven mechanism: Vercel Cron hits a `CRON_SECRET`-authed `/api/cron/run`, which queries due + enabled jobs (`next_run_at`-driven, via `cron-parser`), claims an idempotent run row guarded by a unique `(jobId, scheduledFor)` index, invokes the existing `runAgentWorkflow` dispatch through a one-line `start(...)` seam, records the run, and advances the schedule — even on failure, so one bad tick can't wedge a job forever.

## How users experience it
### Where it lives (exposure)
- A new **Schedules** entry in the left nav (peer of Sessions/Repositories).
- A **"Schedule this"** action on any existing chat — "turn this conversation's prompt into a recurring job" — so a user can promote an ad-hoc run they already trust.
- A per-repo **Schedules tab** showing jobs scoped to that repo.
- A **"New schedule"** button opening a create form: repo picker, branch, prompt editor, schedule builder, and a "Result lands as" toggle (Chat message / Open a PR).
- A slash-command affordance in chat: `/schedule "0 9 * * 1-5"` to convert the current prompt.

### Sample UI
The **Schedules list** renders a table of jobs: name, repo/branch, human-readable schedule ("Weekdays at 9:00 AM"), next run (relative: "in 4h"), last run status badge (Succeeded / Failed / Skipped / Running), and an enable/disable switch. Each row expands into a **run history** panel: a reverse-chronological list of `scheduled_job_runs` — timestamp, status, duration, a link to the resulting chat, and a PR link when present. A failed run shows its captured error inline. The **create/edit form** has a schedule builder with preset chips (Hourly / Daily / Weekdays / Weekly / Custom cron) and a live "next 3 runs" preview computed from the cron expression so the user sees exactly when it'll fire before saving. States to design for: enabled-healthy, disabled, last-run-failed (amber), currently-running (spinner + "started 2m ago"), and never-run-yet.

### UX walkthrough
1. User opens **Schedules**, clicks **New schedule**.
2. Picks repo `acme/ci-bot`, branch `main`.
3. Writes the prompt: "Check for outdated npm dependencies and open a PR bumping safe minor/patch versions."
4. Picks the **Weekdays at 9:00 AM** preset; the form shows "Next runs: Mon Jun 1 09:00, Tue Jun 2 09:00, Wed Jun 3 09:00."
5. Toggles **Result lands as → Open a PR**, saves.
6. The job appears in the list as enabled, "Next run in 14h."
7. Monday 9:00, the platform fires it; the row flips to **Running**, then **Succeeded**, with a link to the new chat and the opened PR.
8. User clicks through to read the agent's reasoning in the materialized chat, reviews the PR, merges. Over the week, run history accumulates a reliable audit trail.

## Value to the user
**Job-to-be-done:** "Keep my repo healthy / informed without me remembering to run the agent." Scenarios:
- **Nightly dependency hygiene** — a maintainer schedules a dependency-bump-and-PR job; wakes up to a reviewable PR instead of a chore.
- **Morning engineering briefing** — an on-call dev schedules a weekday-9am "summarize merged PRs, flag flaky tests, list open Dependabot alerts" job that lands as a chat they skim with coffee.
- **Recurring docs/lint sweep** — a docs owner schedules a weekly "find stale or broken docs and open a PR" pass, turning a task that never gets prioritized into one that just happens.

## Value to the product
Standing agents convert open-agents from a session-based tool you *visit* into a platform that *works for you continuously* — the difference between a chat app and an automation product. Strategically it's a strong **retention and habit-formation** lever: a user with three live schedules has standing reasons to return and a growing run-history they don't want to lose, which raises switching cost. It's an **expansion** driver too — scheduled runs are recurring compute the user opts into, a natural metering surface for paid tiers (free = N daily jobs, paid = minute-level cadence and more jobs, mapping cleanly onto Vercel's own Hobby-vs-Pro cron limits). And it differentiates: most AI-coding tools are strictly interactive; "agents on a schedule against your repo, with PRs" is a category-defining capability.

## The case FOR (strong)
1. **Proven, not speculative.** The POC ran the real endpoint handler against a real database with a controlled clock and passed 23/23 — including the genuinely hard parts (cron correctness, concurrent double-fire creating exactly one run row, auth rejection). This isn't a sketch; the integration points are identified to the file.
2. **It reuses what already exists.** The repo already ships a working `CRON_SECRET` cron route, a `vercel.json` crons entry, a durable `runAgentWorkflow` dispatch, and even a `schedule.cron` trigger enum on `backgroundAgentTriggers`. The only net-new surface is two tables and a due-job query.
3. **It's the cheapest path to "proactive product."** Activation jumps from "remember to open the app" to "the app delivers value while you sleep" — a qualitatively different and stickier value proposition for very little build.
4. **Clean monetization seam.** Cadence and job count map directly onto plan tiers, and the POC already documents how to decouple job cadence from the platform tick so the limits are enforceable and coherent.
5. **Safe failure semantics are already designed.** Schedule advances even on failure, idempotency is enforced by a unique index, and missed-tick catch-up is a deliberate (documented) semantic — the foot-guns are accounted for, not discovered in prod.

## The case AGAINST (strong)
1. **It is structurally blocked on 2b.** The POC is explicit: `start(runAgentWorkflow, ...)` returns immediately and the run must outlive the cron invocation. Without durable execution (2b), a scheduled run can dispatch and then silently fail to land after the function returns. Shipping 2a before 2b risks a feature that looks reliable in a demo and quietly drops runs in production.
2. **Unattended agents that open PRs are a trust and safety surface.** A nightly agent with write access, running with no human watching, can open noisy/wrong PRs, burn model spend, or act on a prompt that made sense weeks ago but no longer does. This needs guardrails (spend caps, PR review-only mode, easy global pause) that are product work beyond the POC.
3. **It may be a thin wrapper over GitHub Actions for the obvious cases.** A sophisticated user can already cron a workflow. If we don't make the *repo-context + chat history + PR + observability* bundle clearly better, we've built something the target users can already approximate for free.
4. **Operational cost of unbounded recurring compute.** Every schedule is recurring spend we incur. Mispriced or unbounded, a fleet of chatty schedules is a margin problem, and "scan cost at scale" plus inline for-loop dispatch (flagged in the POC) needs work before large fleets.
5. **"Stale prompt" drift.** A prompt that was right in May can be wrong in August as the repo evolves; an unattended agent has no one to notice. The value can quietly invert into noise the user learns to ignore.

## Effort, dependencies & risk
**Feasibility verdict (from POC): feasible and low-risk** for the scheduling/dispatch/idempotency layer — every dependency already exists in the repo. **Build size:** small-to-medium — two `pgTable`s (`scheduled_jobs`, `scheduled_job_runs` with the unique `(jobId, scheduledFor)` index), a due-job query, a second crons entry, a route handler ported from the existing one, plus the net-new product UI (Schedules list, create form, schedule builder, run history). **Cross-POC dependency:** hard dependency on **POC 2b** for durable execution — the `scheduled_job_runs` row left in `running` is the exact handoff point a durable runtime resolves. Alternatively the feature can layer onto the existing `background_agents` model rather than new tables; dispatch and auth are identical either way. **Top risks + mitigations:** (a) durability gap → ship after 2b, route dispatch through the durable workflow; (b) cross-instance races → rely on the Postgres unique index (present in the migration), not application logic; (c) unattended-agent trust → add spend caps, a PR-only mode, and a one-click global pause; (d) scan cost at scale → move from inline for-loop to batched/work-queue dispatch once fleets are large; (e) missed-tick semantics → expose catch-up-vs-skip as a documented product choice.

## The decision
**The crisp question:** Do we productize unattended, scheduled agent runs against a user's repo — and are we willing to gate it on durable execution? **Recommended trigger to greenlight:** POC 2b's durable runtime is adopted and the `runAgentWorkflow` dispatch is proven to survive teardown; at that point 2a is a fast follow. **Success metrics:** % of activated users with ≥1 live schedule after 30 days; scheduled-run success-land rate (target ≥99% once on 2b); schedule retention (jobs still enabled at 30/60 days); PRs opened by schedules that get merged. **Suggested default: BUILD — but LATER (sequenced after 2b).** Rationale: the capability is proven, cheap, and strategically transformative (proactive product), but shipping it on a non-durable runtime would manufacture a reliability problem in the most visible possible way. Build it the moment 2b is real; pair it with spend caps and an easy global pause from day one.
