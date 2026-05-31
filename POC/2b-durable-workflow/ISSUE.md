<!-- TITLE: feat: durable workflow runtime for agent runs (crash/teardown-survivable, resumable, retrying) — keystone for 2a/2c/1b -->

# Durable workflow runtime for agent runs (the reliability keystone)

> POC complete and eval-backed (19/19 assertions across a real `exit(137)` crash). This issue scopes the **production** build: adopt the Vercel Workflow DevKit backed by a self-hostable Postgres World on the existing Neon database, expose honest user-facing run status and resumable streams, and ship an operator Runs dashboard. **This is infrastructure: 2a (cron) and 2c (event-driven) depend on it and must not ship reliably without it.**

## Why this matters

Today the agent loop in `apps/web/app/workflows/chat.ts` already uses the Vercel Workflow DevKit (`"use workflow"` / `"use step"`), but durability is **World-dependent**: it is real on the Vercel-managed World, while the local World runs steps synchronously and is not a crash-durability proof, and the managed World is `iad1`-only today. The agent's runtime is a per-session microVM sandbox that *will* be torn down. The practical consequence is that the product cannot *honestly promise* a run survives teardown.

Concretely: a 50-step refactor that dies at step 40 restarts at step 0 today — re-running tool side effects and re-billing model calls. A run that must pause for human approval (1b) has no durable park. Every run that should fire while no human is watching (2a cron, 2c events) has nowhere safe to land. Operators have no durable record to reason about *why* a run stalled, and client reconnection is a best-effort `claimActiveStream` / `clearActiveStream` dance rather than a persisted, resumable stream. This build turns "best-effort runs inside one serverless lifetime" into "durable agent execution," and it is the single highest-leverage item on the roadmap because **one build unblocks 2a, 2c, and 1b at once**.

## User/operator path protected

- **User-perceived reliability path:** a session/chat run that is interrupted by a redeploy, sandbox recycle, or hard crash must resume from the last completed step — not restart, not silently die, not duplicate side effects — and its chat stream must reattach on reload instead of showing a dead or duplicated transcript.
- **Operator diagnosis path:** an operator investigating a stuck or failed run must be able to open a **Runs dashboard** and a per-run **step timeline** and see, from durable state, exactly which step is parked, why (sleep deadline / awaiting approval token / retry attempt N), and the run's timings — diagnosis in seconds, not log archaeology.
- **Developer path:** the `chat.ts` workflow body and its `"use step"` functions stay structurally the same; new durable affordances (`sleep()`, typed `createHook<T>({ token })`, `withRetry`) are available without a rewrite.

## Behavior contract

1. **Given** a multi-step agent run that has completed steps 1–N, **when** the serving process crashes or the deployment is recycled, **then** a fresh process resumes the run at step N+1 and the completed steps return their checkpointed results without re-executing their bodies (replay, not re-run).
2. **Given** a step that performs a non-idempotent side effect (e.g. a commit/PR), **when** the run is resumed after a crash that occurred *after* the step's checkpoint, **then** the side effect is observed to have happened **exactly once**.
3. **Given** a run parked on `sleep("…")`, **when** the process is torn down and a fresh process resumes *before* the wake deadline, **then** the run re-suspends with the **same** persisted `wakeAt` (the timer is not restarted) and consumes no compute while parked.
4. **Given** a run suspended on an approval/event hook token, **when** an HTTP endpoint delivers the payload for that token, **then** the run resumes past the gate carrying the delivered payload; **and when** no payload is delivered, the run stays parked at zero compute cost indefinitely.
5. **Given** a step that fails transiently, **when** it is retried, **then** the attempt count is persisted (crash-safe), retries follow exponential backoff up to the configured max, and a still-failing step lands the run in a terminal `failed` state rather than re-running completed steps.
6. **Given** any run, **when** an operator opens the Runs dashboard, **then** every run shows a status pill (Running / Suspended-sleep / Suspended-event / Retrying / Completed / Failed), the current/last step key, attempt count when >1, suspend reason, and start/finish timestamps sourced from the persisted run table.
7. **Given** a user reloads the page mid-run, **when** the page reattaches, **then** the chat stream resumes from the persisted stream position with no duplicated or truncated transcript, and the header status chip reflects the true run state.

## Product and design spec

This is infrastructure; its "exposure" is the **reliability users perceive** plus an **operator/observability surface**. Developers see new in-workflow affordances. No net-new end-user create-form; the surfaces are honest status, resumable streams, and an operator dashboard.

### UX — how users use it & how it's exposed

- **Users** never visit a "durability" screen. They experience it as a trustworthy **run status chip** on every session/chat header — "Running (step 12 of ~)", "Paused — your approval needed", "Sleeping — resumes Mon 9:00 AM", "Reconnected — resuming" — and a chat stream that survives reload/redeploy and reconnects where it left off.
- **Operators** get a new **Runs** admin view (operator-gated route, peer of other admin surfaces) backed by the persisted `workflowRuns` table: every run listed with status, current step, attempt counts, suspend reason, and timings, each drillable into a step timeline.
- **Developers** keep `chat.ts` as the `"use workflow"` body; the new affordances are `sleep()`, typed `createHook<{approved:boolean}>({ token })`, and `withRetry(fn, { maxRetries, shouldRetry })` available inside the workflow.

### UX — how the feature demonstrates & explains its value to the user

The value is made obvious **at the exact moment reliability would previously have failed**. When a redeploy or sandbox recycle happens mid-run, the chip transitions to "Reconnected — resuming" and streaming continues from the last completed step instead of the transcript dying or restarting — the user *sees* the run survive. A parked run shows "Paused — your approval needed" or "Sleeping — resumes Mon 9:00 AM" with a concrete wake time, so the user understands the agent is intentionally waiting, not stuck or dead. For operators, the **empty/first-run state** of the Runs dashboard explains the model ("Runs appear here as agents execute; each row is a durable workflow you can inspect step-by-step"), and the first populated run demonstrates value by showing a live step timeline advancing. The header chip copy is the in-the-moment proof: "Reconnected — resuming" is a claim the old runtime could not honestly make.

### UX — how it's clear what the feature is doing (states & feedback)

Every run state has concrete feedback:

- **Actively streaming** — chip "Running (step N…)", live streamed chat parts via the persisted stream.
- **Suspended on sleep** — chip "Sleeping — resumes <wake time>"; dashboard pill "Suspended-sleep" with the `wakeAt` shown.
- **Suspended on approval/event** — chip "Paused — your approval needed"; dashboard pill "Suspended-event" with the awaited token / suspend reason.
- **Retrying after failure** — chip "Retrying (attempt N/M)"; dashboard pill "Retrying" with backoff and attempt count.
- **Resumed after crash/teardown** — transient chip "Reconnected — resuming", then back to "Running".
- **Terminal** — chip and pill "Completed" or "Failed" (failed shows the captured error / failing step key).
- **Step timeline** (per-run drill-in) — each step row shows checkpoint status: completed / replayed / failed-attempt-N / suspended-here, making the durable log visible.

### UX — how to test the UX, including regressions

Per the repo's [Authenticated Local UI Smoke](../../docs/process/development-workflow.md#authenticated-local-ui-smoke) discipline (DB-backed, `POSTGRES_URL` + `BETTER_AUTH_SECRET` present, migrations applied):

- **Drive:** start an authenticated session, kick off a multi-step run; while streaming, simulate a teardown (kill/recycle the worker or trigger the local-World resume path), reload the page.
- **Assert:** the chat stream reattaches from the persisted position (no duplicated/truncated transcript); the header chip shows "Reconnected — resuming" then "Running"; the run completes with side effects done once. Open the operator Runs dashboard: the run appears with the correct status pill, step key, and timings; the step timeline shows completed-vs-replayed steps.
- **Suspend interactions:** drive an approval-gated run → chip "Paused — your approval needed", dashboard pill "Suspended-event"; deliver the token via the approval endpoint → run resumes. Drive a `sleep`-parked run → chip "Sleeping — resumes <time>", dashboard pill "Suspended-sleep" with stable `wakeAt`.
- **UX regressions to lock (fail-before/pass-after):** (1) a reload mid-run must NOT show a dead/duplicated transcript (fails today against best-effort reconnect); (2) a resumed run must NOT show a second copy of an already-streamed assistant message; (3) the status chip must NOT show "Running" for a run that is actually parked or failed.

## Integration spec

Generalize the runtime in place; do not rewrite the agent loop.

- **Persistence World (the core change):** add `@workflow/world-postgres` and point it at the existing Neon connection (`POSTGRES_URL`) so durability lives on the repo's own database, independent of the Vercel-managed World. Verify locally on the Local World first, then on `world-postgres`-against-Neon. (Vercel DevKit + `@workflow/world-postgres`; see Research.)
- **Workflow stays put:** keep `apps/web/app/workflows/chat.ts` as the `"use workflow"` body and its `"use step"` functions (`runAgentStep`, `convertMessages`, etc.). They already match the validated DevKit step contract — no structural rewrite. `runAgentWorkflow` (`apps/web/app/workflows/chat.ts:1005`) remains the dispatch entry; `runBackgroundAgentWorkflow` (`apps/web/app/workflows/background-agent.ts`) remains the trigger-mode entry. Both inherit durability from the World.
- **Run record / data model:** the persisted run table (`workflowRuns`, in `apps/web/lib/db/schema.ts`) backs the operator dashboard — extend it as needed with current step key, attempt count, suspend reason, and `wakeAt`. Add migration via `bun run --cwd apps/web db:generate` and commit the `.sql`. Add a `workflow_run_steps` (or equivalent) projection table only if step-timeline reads cannot be served from the World's own step log.
- **Durable approval hook (unblocks 1b):** replace the `shouldPauseForToolInteraction` client-resume pause with a typed `createHook<{approved:boolean}>({ token: approvalTokenFor(toolCallId) })` awaited at the workflow level; an approval endpoint delivers the payload (the POC's `store.deliverEvent` seam → `getRun(runId)` / hook resolution in production).
- **Durable sleep / scheduled resume (unblocks 2a):** expose `sleep()` at the workflow level for delayed/recurring resume; the cron endpoint (2a) calls `start(runAgentWorkflow, [...])`. Validated as durable across teardown by the POC.
- **Event resume (unblocks 2c):** the webhook route (`apps/web/app/api/github/webhook/route.ts`) and future external events resolve a `createHook` / `createWebhook` token — the generalized `waitForEvent` / `deliverEvent` pattern proven in the POC.
- **Resumable streams:** replace the best-effort `claimActiveStream` / `clearActiveStream` reconnect dance with the DevKit's persisted resumable streams (Redis-backed on Vercel, filesystem locally) so a reloaded client reattaches via `getWritable<UIMessageChunk>()`.
- **New tables/migrations:** any `workflowRuns` extensions and an optional step-projection table, each with a committed Drizzle migration.

## In scope

- Pin and configure `@workflow/world-postgres` against Neon; verify locally on the Local World first.
- Extend the persisted run record so status, current step, attempt count, suspend reason, and wake time are queryable.
- Swap the approval pause for a typed durable `createHook` and wire an approval-delivery endpoint (the seam 1b consumes).
- Expose `sleep()` and event-resume (`createHook`/`waitForEvent` + delivery) seams for 2a and 2c to call.
- Replace best-effort stream reconnect with persisted resumable streams.
- Operator **Runs dashboard** (list + status pills) and per-run **step timeline**.
- Honest user-facing **run status chip** with the full suspend/retry/resume state set.
- Make side-effecting steps (commits, PRs) idempotent / idempotency-keyed to honor at-least-once semantics.

## Out of scope

- **2a (cron-triggered standing agents)** and **2c (event-driven agents)** themselves — they *depend on this issue* for durability and are deferred to their own slices; this issue only exposes the `sleep()` / event-resume seams they consume.
- **1b approval UX** beyond the durable hook seam — the approval *interaction surface* is 1b's slice; here we only provide the durable park + delivery endpoint.
- Migrating away from the DevKit to an external queue (Upstash/Inngest) — explicitly rejected (cloud-only, HTTP-step rewrite, more lock-in).
- Multi-region active execution / leaving `iad1` — a latency note, not a correctness blocker; out of scope here.
- Replacing the production World with the POC's SQLite `engine.ts`/`store.ts` — that remains only the controlled fallback if the DevKit beta disappoints.

## Research and context sources

- **POC PR:** [#84 — POC 2b: Durable workflow runtime](https://github.com/dennisonbertram/fork-open-agents/pull/84).
- **POC folder:** `POC/2b-durable-workflow/` — `README.md` (research findings, integration plan, blind spots), `PRODUCT-BRIEF.md` (the productization argument).
- **Eval evidence:** `POC/2b-durable-workflow/evidence/` — `summary.json` (19/19), `step-log-at-crash.json` (durable suspend at the crash boundary), `step-log-final.json` (retry attempts=3), `side-effect.log` (one line = no re-run), `sleep-step-log.json` (stable `wakeAt`), `phase1-output.txt` / `phase2-output.txt` (cross-process logs).
- **External research (from README):** Vercel Workflow DevKit (`workflow` `^4.2.0-beta.72`; docs v5) — `"use workflow"`/`"use step"`, `sleep()`, `createWebhook`/`createHook<T>`, `withRetry`, `DurableAgent`, and the **World abstraction** (`@workflow/world-local`, `@workflow/world-vercel`, **`@workflow/world-postgres` + graphile-worker**). Compared against Upstash Workflow (QStash) and Inngest (both cloud-only) — rejected.
- **Repo code:** `apps/web/app/workflows/chat.ts`, `apps/web/app/workflows/background-agent.ts`, `apps/web/lib/db/schema.ts`, `apps/web/app/api/github/webhook/route.ts`.

## Agent todo checklist

1. Read POC 2b `README.md` + `PRODUCT-BRIEF.md` and the eval evidence; confirm the durability contract (replay-not-rerun, durable sleep, event-suspend, retry/backoff).
2. Write the failing run-survival test first (see Tests to add first); observe red.
3. Add `@workflow/world-postgres`; configure against `POSTGRES_URL`; verify on Local World, then on Postgres-against-Neon.
4. Extend `workflowRuns` schema (status, current step, attempt count, suspend reason, `wakeAt`); generate + commit migration.
5. Make commit/PR side-effecting steps idempotent / idempotency-keyed.
6. Swap the approval pause for a typed `createHook`; add the approval-delivery endpoint.
7. Expose `sleep()` and event-resume seams for 2a/2c.
8. Replace best-effort reconnect with persisted resumable streams.
9. Build the operator Runs dashboard + step timeline; wire the honest user status chip.
10. Add structured observability events (see Observability) with correlation IDs and redaction.
11. Run the authenticated-local-UI smoke; capture screenshots/evidence for crash-resume, suspend, retry, and reconnect.
12. Run targeted tests, adjacent suite, `git diff --check`, and `bun --bun run ci`.

## Tests to add first

1. **Run-survival (replay-not-rerun) integration test** — drive a workflow with a non-idempotent side-effect step, an event-suspend gate, and a flaky retry step on the Postgres World; kill the worker process hard after the side effect checkpoints; resume in a fresh process. Assert: side effect observed exactly once, suspended state reconstructed from the DB, retry reaches attempt 3, final result correct. (This is the production analogue of the POC `eval.ts`.)
2. **Durable-sleep test** — suspend on `sleep`, tear down, resume before the deadline → re-suspends with the same `wakeAt`; resume after the deadline → wakes and completes with the setup step replayed (not re-run). (Analogue of POC `sleep-eval.ts`.)
3. **Resumable-stream test** — start a streaming run, drop the client, reattach; assert the stream resumes from the persisted position with no duplicated/truncated parts.
4. **Operator dashboard query test** — seed runs in each state; assert the dashboard query returns correct status pill, step key, attempt count, suspend reason, and timings.
5. **At-least-once idempotency test** — simulate a crash between a side effect and its checkpoint; assert the side-effecting step is guarded so the external effect is not duplicated.

## Observability and user feedback

- **User-visible status:** the run status chip states enumerated above (Running step N / Paused-approval / Sleeping-until / Retrying N-of-M / Reconnected-resuming / Completed / Failed), plus the operator Runs dashboard pills and per-run step timeline.
- **Named service emitting structured events:** a `workflow-runtime` observability service emits structured JSON events, e.g. `workflow.run.started`, `workflow.step.checkpointed`, `workflow.step.replayed`, `workflow.run.suspended.sleep`, `workflow.run.suspended.event`, `workflow.run.resumed`, `workflow.step.retry`, `workflow.run.completed`, `workflow.run.failed`, `workflow.stream.reattached`. Each event carries `level` (`info` for lifecycle, `warn` for retry/suspend-timeout-approaching, `error` for terminal failure), and fields: `action`, `stepKey`, `attempt`, `suspendReason`, `wakeAt`, `worldKind`.
- **Typed error kinds:** `WorkflowError` with `kind ∈ { step_failed, retry_exhausted, replay_desync, suspend_timeout, world_unavailable, stream_reattach_failed }` so failures are classifiable, not free-text.
- **Correlation IDs on every event:** `userId`, `sessionId`, `chatId`, `requestId`, `workflowRunId`, `sandboxName` (and `scheduledJobId` / `triggerId` when the run originated from 2a/2c).
- **Redaction:** never log prompt bodies, tool arguments, repo file contents, or secrets; log step keys, status, attempt counts, and IDs only. Approval/event payloads are referenced by token, never logged verbatim.
- **Grep-able debug recipes:** "why is run X parked?" → `grep workflowRunId=<id> | grep workflow.run.suspended` shows the suspend reason and `wakeAt`/token; "did a resume re-run a step?" → `grep workflowRunId=<id> | grep -E 'workflow.step.(replayed|checkpointed)'` and confirm replayed steps did not re-emit side effects.
- **Evidence expectation:** screenshots of the Runs dashboard + step timeline for a crash-resumed run, a suspended-on-sleep run, and a retrying run; the crash-resume integration test transcript; a captured structured-event log slice for one full run lifecycle.

## Regression harness plan

- **Existing coverage:** `apps/web/app/workflows/*` tests, `apps/web/lib/background-agents/dispatcher.test.ts`, and the GitHub webhook route tests exercise dispatch but not crash-durability.
- **New coverage:** the run-survival, durable-sleep, resumable-stream, dashboard-query, and at-least-once tests above run in CI against the Postgres World. Add the authenticated-local-UI smoke (crash/reload mid-run) as a documented manual gate with screenshot evidence.
- **Fixtures/setup:** a test World pointed at an ephemeral Postgres (Neon branch or local PG); a controllable side-effect probe (file/row written once); a clock control for the sleep test; a worker-kill harness (separate process, hard exit) for the crash test.
- **Fail-before/pass-after:** before adoption, the run-survival test restarts from step 0 / duplicates the side effect (red); after, it resumes at the frontier with the side effect once (green). Before, a reload duplicates the transcript (red); after, it reattaches cleanly (green).
- **Limits:** the harness cannot fully reproduce multi-region or multi-worker leasing/visibility-timeout races (the POC's SQLite prototype was single-node) — those rely on the production World's guarantees; a soak test under concurrent workers is needed before claiming exactly-the-frontier resume at scale. It also does not by itself verify Vercel-managed-World stream resumption parity — that needs its own check against the live reconnect UX.

## TDD audit trail

- **Red commit:** add the run-survival integration test (#1 above) that hard-kills the worker after a non-idempotent side effect checkpoints and resumes in a fresh process. Command: `bun test apps/web/app/workflows/durable-run-survival.test.ts`. Expected failing output before the World swap: the side-effect probe shows **2** occurrences (step re-ran on resume) and/or the run restarts from step 0 — assertion `expect(sideEffectCount).toBe(1)` fails with `received: 2`.
- **Green commit:** after pinning `@workflow/world-postgres`, extending the run record, and making side-effecting steps idempotent, the same test passes — side effect once, suspended state reconstructed from the DB, retry reaches attempt 3, final result correct.

## Regression risks and concerns

- **Beta runtime:** DevKit pinned at `^4.2.0-beta.72` (docs v5); `world-postgres` maturity unverified against real Neon. Mitigation: validate `world-postgres` on Neon before committing the agent loop; keep the POC's `engine.ts`/`store.ts` as a controlled fallback executor.
- **At-least-once, not exactly-once:** a crash between a side effect and its checkpoint can re-run that step — every side-effecting step (commits, PRs) must be idempotent / idempotency-keyed. A discipline tax across the codebase.
- **Determinism contract:** replay requires steps requested in a stable order returning serializable results; any un-stepped side effect or non-deterministic control flow in the workflow body desyncs replay. Constrains all future agent code.
- **Prototype gaps:** the POC's SQLite engine has no concurrent-worker locking, leasing, or visibility timeouts — the real World must supply those; do not lean on the prototype for prod concurrency.
- **Stream resumption** under the DevKit was not exercised by the POC and needs its own verification against the current reconnect UX before claiming it.

## Deploy or migration impact

- **New dependency:** `@workflow/world-postgres` (+ graphile-worker) configured against `POSTGRES_URL`. Verify on Local World, then a Neon branch, before production.
- **Migrations:** `workflowRuns` extensions (and any step-projection table) generated via `bun run --cwd apps/web db:generate` and committed; migrations apply automatically during `bun run build` on every Vercel deploy (preview branches get isolated Neon branches; production uses main).
- **Config/env:** confirm `POSTGRES_URL` reachable by the workflow worker; document the World selection per environment (local/managed/postgres). Note the Vercel-managed-World `iad1` region behavior as a latency note.
- **Backfill:** in-flight runs at deploy time are best-effort; document expected behavior for runs straddling the cutover.

## Definition of done

- [ ] Failing run-survival test written and observed red **first** (behavior proof red captured: side-effect count = 2 / restart-from-zero).
- [ ] Red-test commit landed (or explicit exception documented).
- [ ] Green commit after red: `@workflow/world-postgres` pinned and configured; side-effecting steps made idempotent; same test passes (side effect once, frontier resume).
- [ ] Durable-sleep, resumable-stream, dashboard-query, and at-least-once tests pass.
- [ ] Operator Runs dashboard + step timeline and honest user status chip implemented.
- [ ] Targeted tests pass; adjacent suite (`apps/web/app/workflows/*`, background-agents, webhook route) passes.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (crash/sleep/stream/dashboard tests in CI + documented authenticated-local-UI smoke).
- [ ] Docs updated (runtime/World selection, durability contract, observability recipes; link back to this issue and PR #84).
- [ ] Observability evidence captured (structured-event log slice; dashboard/timeline screenshots for crash-resume, suspend, retry, reconnect).
- [ ] Deploy/migration notes included (dependency, migrations, env, region/backfill behavior).
