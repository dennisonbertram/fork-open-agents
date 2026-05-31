<!-- TITLE: feat: cron-triggered standing agents — schedule a saved prompt to run against a repo on a recurring cadence -->

# Cron-triggered standing agents (scheduled prompt runs against a repo)

> POC complete and eval-backed (23/23 assertions against a real database with a controlled clock). This issue scopes the **production** build: a user-facing "Schedules" capability that fires a saved prompt against a repo on a cron cadence and lands the result as a chat message or a PR. **Hard dependency: POC 2b (durable workflow runtime) — a scheduled run is dispatched and then must survive function teardown; do not ship this reliably before 2b lands.**

## Why this matters

Every agent run in open-agents today is human-initiated (a person types into chat) or webhook-initiated (a GitHub event). There is no way to say "run this prompt against this repo every weekday at 9am" and walk away. The people who feel this most are the power users the product wants to retain: a maintainer who wants a nightly dependency-bump PR, an on-call engineer who wants a morning "summarize what changed and what's flaky" briefing, a docs owner who wants a weekly "find stale docs and open a PR" pass. Today they babysit the agent manually or wire up their own GitHub Action — losing the streaming chat UI, session history, and repo context that make open-agents worth using. Standing agents turn the product from reactive (a place you visit) into proactive (a platform that works for you continuously), which is a strong retention/habit-formation and monetization lever (cadence and job count map cleanly onto plan tiers).

## User/operator path protected

- **User schedule-management path:** a user can create, edit, enable/disable, and delete a recurring job (repo + branch + prompt + cron schedule + "result lands as" toggle) and trust it fires on cadence with the result landing where expected.
- **User result-audit path:** for each fired run, the user can open the materialized chat to read the agent's reasoning and follow the PR link, and review an accumulating, honest run history (status, duration, links, captured errors).
- **Reliability path (inherited from 2b):** a dispatched scheduled run must survive the cron function's teardown and reliably land its result — the `scheduled_job_runs` row left in `running` is the exact handoff point 2b's durable runtime resolves.

## Behavior contract

1. **Given** an enabled job whose cron expression is due at the current scan tick, **when** the cron endpoint runs, **then** the platform materializes a session + chat, claims an idempotent run row, dispatches the agent, records the run, and advances `lastRunAt`/`nextRunAt`.
2. **Given** a job whose cron expression is **not** due at this tick (e.g. `0 9 * * *` at 09:05), **when** the cron endpoint runs, **then** the job does not fire and its `nextRunAt` reflects the next valid time.
3. **Given** a disabled job that would otherwise be due, **when** the cron endpoint runs, **then** the job does not fire.
4. **Given** a duplicate or concurrent cron invocation in the same scheduled tick, **when** both attempt the same job, **then** exactly **one** `scheduled_job_runs` row is created (idempotency enforced by a unique `(jobId, scheduledFor)` index).
5. **Given** a cron request without a valid `CRON_SECRET` bearer, **when** it hits the endpoint, **then** it is rejected with 401 and dispatches nothing; a valid bearer returns 200.
6. **Given** a job with "result lands as → Chat message", **when** it fires successfully, **then** exactly one assistant `chat_messages` row is written in the materialized chat; **given** "→ Open a PR", **then** the run row records the opened `prUrl`.
7. **Given** a run that fails, **when** it finishes, **then** the run records `status=failed` with the captured error **and** the schedule still advances `nextRunAt` so one bad tick cannot wedge the job forever.

## Product and design spec

A "Schedules" capability: a user picks a repo, writes a prompt, sets a cron schedule (with friendly presets), optionally toggles "open a PR with the result", and saves. The platform fires the agent on cadence, materializes a session + chat per run, executes the prompt, and lands the output.

### UX — how users use it & how it's exposed

- A new **Schedules** entry in the left nav (peer of Sessions/Repositories).
- A **"Schedule this"** action on any existing chat — promote a trusted ad-hoc run into a recurring job.
- A per-repo **Schedules tab** scoped to that repo.
- A **"New schedule"** button opening a create form: repo picker, branch, prompt editor, schedule builder, and a "Result lands as" toggle (Chat message / Open a PR).
- A slash-command affordance in chat: `/schedule "0 9 * * 1-5"` to convert the current prompt.

### UX — how the feature demonstrates & explains its value to the user

The create form makes value obvious **before saving**: a schedule builder with preset chips (Hourly / Daily / Weekdays / Weekly / Custom cron) and a live **"next 3 runs" preview** computed from the cron expression, so the user sees exactly when it'll fire (e.g. "Next runs: Mon Jun 1 09:00, Tue Jun 2 09:00, Wed Jun 3 09:00"). The **empty/first-run state** of the Schedules list explains the model ("Schedule a prompt to run against a repo on a recurring cadence — results land as a chat or a PR while you're away") with a single primary CTA. The first time a job fires, the row visibly flips Running → Succeeded with links to the new chat and the opened PR, proving the "works while you sleep" promise. Run history accumulates a reliable audit trail that raises the cost of leaving.

### UX — how it's clear what the feature is doing (states & feedback)

The **Schedules list** is a table: name, repo/branch, human-readable schedule ("Weekdays at 9:00 AM"), next run (relative: "in 4h"), a last-run **status chip**, and an enable/disable switch. Status chips and states to design for:

- **Enabled-healthy** — green, "Next run in 4h".
- **Disabled** — muted, switch off, no next-run.
- **Currently-running** — spinner + "started 2m ago".
- **Last-run-failed** — amber chip; the expandable run-history panel shows the captured error inline.
- **Succeeded** — green chip with a link to the resulting chat and a PR link when present.
- **Never-run-yet** — neutral chip, "First run <time>".

Each row expands into a **run-history panel**: reverse-chronological `scheduled_job_runs` — timestamp, status, duration, chat link, PR link when present, error inline on failure. (The honest live "Running → Succeeded/Failed" transition and the resumable result landing depend on 2b's durable run status.)

### UX — how to test the UX, including regressions

Per the repo's [Authenticated Local UI Smoke](../../docs/process/development-workflow.md#authenticated-local-ui-smoke) discipline (DB-backed, `POSTGRES_URL` + `BETTER_AUTH_SECRET`, migrations applied):

- **Drive:** sign in, open **Schedules → New schedule**, pick a repo + branch, write a prompt, choose the **Weekdays at 9:00 AM** preset, toggle **Open a PR**, save.
- **Assert:** the "next 3 runs" preview renders correct times; the job appears in the list as enabled with a correct relative next-run; the run-history panel is empty with the right empty copy. Trigger the cron endpoint (with a valid `CRON_SECRET`) against a due job; assert the row flips to Running then to a terminal status, the materialized chat exists with one assistant message (or the PR link is present), and the run-history panel shows the new row with duration and links.
- **UX regressions to lock (fail-before/pass-after):** (1) a disabled job must NOT appear as "Next run …" and must NOT fire; (2) the status chip must NOT show "Succeeded" for a run whose `scheduled_job_runs` row is still `running`/`failed`; (3) a failed run must surface its captured error in the run-history panel rather than rendering blank; (4) saving an invalid cron expression must show inline validation, not a silent no-op.

## Integration spec

The real wiring reuses existing repo machinery; nothing here is speculative.

- **Schema** (`apps/web/lib/db/schema.ts`): add `scheduled_jobs` `{ id, ownerUserId, repoOwner, repoName, branch, cronExpression, prompt, enabled, lastRunAt, nextRunAt, createdAt }` and `scheduled_job_runs` `{ id, jobId, status (running|succeeded|failed|skipped), scheduledFor, startedAt, finishedAt, resultChatId, prUrl, error }` as `pgTable`s with a **unique index on `(jobId, scheduledFor)`** as the idempotency/overlap guard. Run `bun run --cwd apps/web db:generate` and commit the `.sql`. (Alternatively layer onto the existing `background_agents` model — the repo already ships a `schedule.cron` trigger kind and a `schedule` column on `backgroundAgentTriggers` in `apps/web/lib/db/schema.ts`; dispatch and auth are identical either way.)
- **Cron registration:** add a second entry to the existing crons config in `apps/web/vercel.json` (today `{ path: "/api/background-agents/cron", schedule: "*/5 * * * *" }`); add `{ path: "/api/cron/run", schedule: "*/5 * * * *" }` (or migrate to a type-safe `vercel.ts` per the POC).
- **Route-handler auth:** port the convention already used by `apps/web/app/api/background-agents/cron/route.ts` — accept `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) with an `x-cron-secret` fallback, compared timing-safely (same `timingSafeEqual` style as the HMAC check in `apps/web/app/api/github/webhook/route.ts`). Cron invocations are GET; accept GET + POST.
- **Due-job query:** a single indexed scan over `enabled` + `next_run_at`; due-ness computed from `next_run_at` via `cron-parser` (decouples job cadence from the platform tick).
- **Job runner → agent (depends on 2b):** materialize session + chat via `createSessionWithInitialChat` (`apps/web/lib/db/sessions.ts`), claim the idempotent run row, then dispatch through the durable workflow the chat API already uses:
  ```ts
  const run = await start(runAgentWorkflow, [{
    messages: [{ role: "user", parts: [{ type: "text", text: job.prompt }] }],
    chatId, sessionId, userId: job.ownerUserId,
    requestUrl, requestId, authSession: null, maxSteps: 500,
  }]);
  ```
  `runAgentWorkflow` (`apps/web/app/workflows/chat.ts:1005`) → `openAgent`. Its existing `persistAssistantMessage` step lands the chat result; its auto-commit / auto-create-PR steps cover the "result lands as a PR" path.
- **New tables/migrations:** `scheduled_jobs`, `scheduled_job_runs` (+ the unique index), each with a committed Drizzle migration.

## In scope

- `scheduled_jobs` + `scheduled_job_runs` tables with the unique `(jobId, scheduledFor)` index and committed migrations.
- The due-job query, the second crons entry, and the `CRON_SECRET`-authed `/api/cron/run` route handler ported from the existing cron route.
- Job runner: materialize session + chat, claim run row, dispatch via the **durable** `runAgentWorkflow` (2b), record run, advance schedule (even on failure).
- Schedules UI: list, create/edit form with schedule builder + "next 3 runs" preview + "result lands as" toggle, enable/disable switch, run-history panel.
- "Schedule this" promotion from a chat and the `/schedule` slash-command affordance.
- Friendly cron presets (Hourly / Daily / Weekdays / Weekly / Custom).

## Out of scope

- **Durable execution itself — provided by POC 2b.** This slice depends on 2b; until 2b lands, a dispatched run can fail to land after the cron function returns. **Defer reliable shipping until 2b is real**; the `scheduled_job_runs` row left in `running` is the handoff point 2b resolves.
- Unattended-agent guardrails beyond a basic global pause — spend caps, PR-review-only mode, and per-job budgets are follow-up product work (flagged as required day-one companions but not built here).
- Batched / work-queue dispatch for very large fleets — the inline indexed-scan + per-job dispatch is fine for thousands of jobs; large-fleet batching is deferred.
- Replay-each-missed-tick backfill — the intended semantics is single catch-up on the next scan; richer backfill is out of scope.

## Research and context sources

- **POC PR:** [#83 — POC 2a: Cron-triggered standing agents](https://github.com/dennisonbertram/fork-open-agents/pull/83).
- **POC folder:** `POC/2a-cron-agents/` — `README.md` (architecture, schema, integration plan, blind spots), `PRODUCT-BRIEF.md` (productization argument).
- **Eval evidence:** `POC/2a-cron-agents/evidence/eval-transcript.txt` (23/23 PASS, controlled clock `now = 2026-05-31 09:05:00 UTC`) and `evidence/db-final-state.json` (final dump of all four tables proving due-selection, cron correctness, idempotency, auth, and result-landing).
- **Keystone dependency:** [POC PR #84 — durable workflow runtime](https://github.com/dennisonbertram/fork-open-agents/pull/84) and `POC/2b-durable-workflow/`.
- **External research (from README):** Vercel Cron frequency limits (Hobby = once-per-day, few crons; Pro/Enterprise = minute-level) — the platform tick bounds scan frequency, so due-ness is `next_run_at`-driven via `cron-parser`. `CRON_SECRET` bearer auth is the real Vercel convention.
- **Repo code:** `apps/web/app/api/background-agents/cron/route.ts`, `apps/web/app/api/github/webhook/route.ts`, `apps/web/app/workflows/chat.ts`, `apps/web/lib/db/sessions.ts`, `apps/web/lib/db/schema.ts`, `apps/web/vercel.json`.

## Agent todo checklist

1. Confirm POC 2b durable runtime is adopted (this slice's hard prerequisite); read POC 2a `README.md` + `PRODUCT-BRIEF.md` and eval evidence.
2. Write the failing due-selection + idempotency test first (see Tests to add first); observe red.
3. Add `scheduled_jobs` / `scheduled_job_runs` schema with the unique `(jobId, scheduledFor)` index; generate + commit migration.
4. Implement the due-job query (`enabled` + `next_run_at`, `cron-parser`).
5. Implement `/api/cron/run` with timing-safe `CRON_SECRET` bearer auth (GET + POST); add the crons entry.
6. Implement the runner: materialize session/chat, claim run row, dispatch via durable `runAgentWorkflow`, record run, advance schedule (even on failure).
7. Build the Schedules UI (list, create/edit form, schedule builder + "next 3 runs" preview, run-history panel, enable/disable); add "Schedule this" + `/schedule`.
8. Add structured observability events (see Observability) with correlation IDs and redaction.
9. Run the authenticated-local-UI smoke; capture screenshots/evidence.
10. Run targeted tests, adjacent suite, `git diff --check`, and `bun --bun run ci`.

## Tests to add first

1. **Due-selection + cron-correctness test** — seed jobs (`*/5 * * * *` due, `0 9 * * *` not due at 09:05, one disabled); drive the endpoint handler with a controlled `now`; assert only the due+enabled jobs fire, `nextRunAt` advances correctly, and the disabled/not-due jobs are skipped. (Production analogue of the POC eval.)
2. **Idempotency / overlap test** — invoke the handler twice in the same tick and once concurrently (`Promise.all`) against a forced-due job; assert exactly one `scheduled_job_runs` row (unique-index-backed across instances).
3. **Auth test** — missing bearer → 401, wrong secret → 401, valid bearer → 200; no dispatch on rejection.
4. **Result-lands test** — a "Chat message" job writes exactly one assistant `chat_messages` row linked job→session→chat; an "Open a PR" job records `prUrl` on its run row.
5. **Failure-advances-schedule test** — a failing run records `status=failed` with the error and still advances `nextRunAt`.

## Observability and user feedback

- **User-visible status:** per-job last-run status chip (Succeeded / Failed / Skipped / Running / Never-run), next-run countdown, and the run-history panel with duration, chat/PR links, and inline error on failure.
- **Named service emitting structured events:** a `scheduled-agents` service emits structured JSON events: `scheduled.cron.scan.started`, `scheduled.job.due`, `scheduled.job.dispatched`, `scheduled.job.skipped` (with reason: `disabled` | `not_due` | `duplicate`), `scheduled.run.recorded`, `scheduled.schedule.advanced`, `scheduled.cron.auth.rejected`. Each carries `level` (`info` lifecycle, `warn` skip/auth-reject, `error` dispatch/run failure) and fields: `action`, `cronExpression`, `scheduledFor`, `status`, `resultKind` (chat | pr).
- **Typed error kinds:** `ScheduledRunError` with `kind ∈ { auth_rejected, dispatch_failed, materialize_failed, run_failed, invalid_cron }`.
- **Correlation IDs:** `userId`, `scheduledJobId`, `scheduledFor`, `requestId`, and once dispatched, `sessionId`, `chatId`, `workflowRunId`, `sandboxName`.
- **Redaction:** never log the prompt body, repo file contents, or `CRON_SECRET`; log job IDs, cron expressions, status, and result kind only.
- **Grep-able debug recipes:** "did job X fire this tick and why/why not?" → `grep scheduledJobId=<id> | grep -E 'scheduled.job.(due|dispatched|skipped)'`; "did a tick double-dispatch?" → `grep scheduledFor=<ts> | grep scheduled.job.dispatched | wc -l` (must be 1).
- **Evidence expectation:** screenshots of the Schedules list (healthy/disabled/failed/running states), the create form with the "next 3 runs" preview, and a run-history panel after a successful and a failed run; the due-selection + idempotency test transcript; a structured-event log slice for one scan.

## Regression harness plan

- **Existing coverage:** `apps/web/app/api/background-agents/cron/route.test.ts` covers the existing cron route auth/shape; the GitHub webhook route tests cover timing-safe auth. No coverage for `scheduled_jobs` due-selection or idempotency yet.
- **New coverage:** the due-selection, idempotency, auth, result-lands, and failure-advances tests above run in CI with a controlled clock and a real (ephemeral Postgres / Neon-branch) database to exercise the unique index. Add the authenticated-local-UI smoke as a documented manual gate with screenshots.
- **Fixtures/setup:** seeded jobs with known cron expressions; a controllable `now`; a fake/durable-stubbed `runAgentWorkflow` so the test asserts dispatch + run-recording without a full agent run; the unique `(jobId, scheduledFor)` index present in the test schema.
- **Fail-before/pass-after:** before the unique index/idempotency logic, the concurrent test creates 2 run rows (red); after, exactly 1 (green). Before due-ness is `next_run_at`-driven, `0 9 * * *` fires at 09:05 (red); after, it does not (green).
- **Limits:** an in-process test on a single event loop proves the application critical section + pre-check but not a true multi-instance race — cross-instance correctness relies on the Postgres unique index (must be present in the committed migration). It also does not prove the dispatched run survives function teardown — that is **2b's** durability proof, not this harness.

## TDD audit trail

- **Red commit:** add the due-selection + idempotency test (#1/#2 above). Command: `bun test apps/web/app/api/cron/run.test.ts`. Expected failing output before implementation: not-due job `0 9 * * *` fires at 09:05 (`expect(firedJobIds).not.toContain("j-9am")` fails) and the concurrent double-invoke creates 2 run rows (`expect(runRows.length).toBe(1)` fails with `received: 2`).
- **Green commit:** after adding the schema + unique index, the `next_run_at`-driven due query, and the runner, the same test passes — only due+enabled jobs fire and exactly one run row is created per scheduled tick.

## Regression risks and concerns

- **Durability gap → depends on 2b.** `start(runAgentWorkflow, ...)` returns immediately and the run must outlive the cron function. Without 2b, results can silently fail to land after the function returns. Mitigation: ship after 2b; route dispatch through the durable workflow.
- **Cross-instance races** rely on the Postgres unique index, not application logic — the index **must** be present in the generated migration.
- **Unattended agents that open PRs** are a trust/safety surface (noisy/wrong PRs, model spend, stale prompts). Mitigation: pair with spend caps, a PR-review-only mode, and a one-click global pause from day one (companion work).
- **Scan cost at scale** — inline for-loop dispatch is fine for thousands of jobs; very large fleets need batching/a work queue.
- **Missed-tick semantics** — catch-up (fire once on next scan), not replay-each-missed; expose as a documented product choice.

## Deploy or migration impact

- **Migrations:** `scheduled_jobs` + `scheduled_job_runs` with the unique `(jobId, scheduledFor)` index, generated via `bun run --cwd apps/web db:generate`; applied automatically during `bun run build` on every deploy (preview branches get isolated Neon branches).
- **Config/env:** requires `CRON_SECRET` set in the environment; add the new crons entry to `apps/web/vercel.json`. On Hobby the cron granularity is once-per-day (job cadence is decoupled from the tick); Pro/Enterprise allow minute-level scans.
- **Cron callback:** the cron path must be reachable and authenticated; document the bearer convention and the GET method.
- **Dependency:** this feature must not be enabled in production before **2b**'s durable runtime is adopted.

## Definition of done

- [ ] Failing due-selection + idempotency test written and observed red **first** (behavior proof red: not-due job fires / 2 run rows on concurrent invoke).
- [ ] Red-test commit landed (or explicit exception documented).
- [ ] Green commit after red: schema + unique index + `next_run_at`-driven query + runner; same test passes.
- [ ] Auth, result-lands, and failure-advances tests pass.
- [ ] Schedules UI (list, create/edit form with "next 3 runs" preview, run-history, enable/disable) and "Schedule this" / `/schedule` implemented.
- [ ] Dispatch routed through the **durable** `runAgentWorkflow` (2b prerequisite confirmed).
- [ ] Targeted tests pass; adjacent suite (cron route, webhook route, sessions) passes.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (due-selection/idempotency/auth/result-lands tests in CI + documented authenticated-local-UI smoke).
- [ ] Docs updated (Schedules capability, cron auth/limits, observability recipes; link back to this issue and PR #83).
- [ ] Observability evidence captured (Schedules list/state screenshots, run-history after success+failure, structured-event log slice).
- [ ] Deploy/migration notes included (migrations, `CRON_SECRET`, crons entry, 2b dependency).
