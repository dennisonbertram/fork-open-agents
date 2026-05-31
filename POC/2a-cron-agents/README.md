# POC 2a — Cron-triggered "standing agents"

A complete, working proof-of-concept (not a smoke test) for **standing
agents**: saved jobs that fire on a cron schedule, materialize a session +
chat, run a saved prompt against a repo, and land the result as a chat message
(or a PR).

```
Vercel Cron (*/5 * * * *)  ->  GET /api/cron/run  (CRON_SECRET bearer auth)
                                 -> query due + enabled scheduled_jobs
                                 -> for each due job:
                                      materialize session + chat
                                      claim idempotent run row
                                      runAgent(seam)  ==  start(runAgentWorkflow, [...])
                                      record scheduled_job_runs (status, chatId, prUrl)
                                      advance lastRunAt / nextRunAt
```

## Goal

The headline missing capability: there is no way to schedule an agent to run a
saved prompt against a repo on a recurring cadence. Today every agent run is
human-initiated (chat) or webhook-initiated (GitHub events). This POC proves
the cron-driven path is feasible and identifies the exact integration points.

## What was built

All code is self-contained under `POC/2a-cron-agents/` and touches no root
deps or app source.

| File | Purpose |
| --- | --- |
| `src/schema.ts` | Drizzle schema for `scheduled_jobs` + `scheduled_job_runs` (mirrors repo `pgTable` conventions), plus a minimal `sessions`/`chats`/`chat_messages` slice so the eval can prove the result lands. |
| `src/db.ts` | Self-contained `bun:sqlite` + Drizzle database with the POC tables. Stands in for the real Neon client (`apps/web/lib/db/client.ts`). |
| `src/cron.ts` | Real cron evaluation via `cron-parser`: `isDue`, `nextRunAfter`, `scheduledTickFor`. This is the durability upgrade over the repo's tick-only `scheduleMatchesNow`. |
| `src/agent-seam.ts` | The `runAgent` seam. Its input is a strict subset of the real `runAgentWorkflow(options)` shape so the integration is obvious. |
| `src/fake-agent.ts` | Deterministic fake agent for the eval. Writes an assistant `chat_messages` row (and optional PR url) exactly where the real workflow's `persistAssistantMessage` / auto-PR steps land output. |
| `src/runner.ts` | Materializes session + chat, claims an idempotent run row, invokes the seam, records the run, advances the schedule. |
| `src/cron-endpoint.ts` | `/api/cron/run` handler: timing-safe `CRON_SECRET` bearer auth, due-job query, dispatch. |
| `vercel.ts` | Cron registration (type-safe `@vercel/config/v1`), showing how to add the standing-agents cron next to the existing one. |
| `eval.ts` | The meaningful eval (real DB, controlled clock, 23 assertions). |

### Schema additions

`scheduled_jobs`: `id, ownerUserId, repoOwner, repoName, branch,
cronExpression, prompt, enabled, lastRunAt, nextRunAt, createdAt`.

`scheduled_job_runs`: `id, jobId, status (running|succeeded|failed|skipped),
scheduledFor, startedAt, finishedAt, resultChatId, prUrl, error`. A **unique
index on `(jobId, scheduledFor)`** is the idempotency / overlap guard.

## How it was tested + evidence

Run from `POC/2a-cron-agents/`:

```bash
bun install
bun run typecheck   # tsc --noEmit, clean
bun run eval        # bun run eval.ts
```

The eval seeds four jobs against a real `bun:sqlite` database and drives the
actual `handleCron` endpoint handler with a controlled `now = 2026-05-31
09:05:00 UTC`. **Result: 23 passed, 0 failed.** Evidence:

- `evidence/eval-transcript.txt` — full run transcript.
- `evidence/db-final-state.json` — final dump of all four tables.

Assertions proven:

1. **Due + enabled selection** — only `j-5min` and `j-pr` ran.
2. **Cron matching correctness** — `*/5 * * * *` is due at 09:05; `0 9 * * *`
   is **not** due at 09:05 (and its `nextRunAt` advances to the next day,
   `2026-06-01T09:00:00Z`).
3. **Run rows + schedule advance** — two `scheduled_job_runs` rows with
   `status=succeeded` and `finishedAt`; `j-5min.lastRunAt = now`,
   `nextRunAt = 09:10`.
4. **Disabled job skipped** — `j-disabled` never ran.
5. **Auth** — missing bearer -> 401; wrong secret -> 401; valid bearer -> 200.
6. **Result lands** — the fake agent wrote exactly one assistant
   `chat_messages` row, linked job -> session -> chat; the PR job recorded
   `prUrl = https://github.com/acme/ci-bot/pull/42` on its run row.
7. **Idempotency / overlap** — a second invocation in the same 09:05 tick
   dispatched nothing; a concurrent (`Promise.all`) double-invocation against
   a forced-due job created exactly **one** run row.

### Cron-matching evidence (controlled clock)

| Job | Expression | now = 09:05 UTC | Outcome |
| --- | --- | --- | --- |
| `j-5min` | `*/5 * * * *` | due | ran, nextRunAt -> 09:10 |
| `j-pr` | `*/5 * * * *` | due | ran (+PR), nextRunAt -> 09:10 |
| `j-9am` | `0 9 * * *` | **not** due | skipped, nextRunAt -> next-day 09:00 |
| `j-disabled` | `*/5 * * * *` | due but disabled | skipped |

## Integration plan

The real wiring re-uses existing repo machinery; nothing here is speculative.

1. **Cron registration** — add a second entry to the existing crons config.
   The repo today has `apps/web/vercel.json` with
   `{ path: "/api/background-agents/cron", schedule: "*/5 * * * *" }`. Add
   `{ path: "/api/cron/run", schedule: "*/5 * * * *" }` (or migrate to the
   type-safe `vercel.ts` shown here). See `vercel.ts`.

2. **Route-handler auth** — copy the convention already used by
   `apps/web/app/api/background-agents/cron/route.ts`: accept
   `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends) with an
   `x-cron-secret` fallback, compared timing-safely (the same
   `timingSafeEqual` style as the HMAC check in
   `apps/web/app/api/github/webhook/route.ts`). `src/cron-endpoint.ts` is a
   faithful port. Cron invocations are **GET**; the handler accepts GET + POST.

3. **Job runner -> agent** — bind the `runAgent` seam
   (`src/agent-seam.ts`) to the durable workflow dispatch the chat API
   already uses:
   ```ts
   const run = await start(runAgentWorkflow, [{
     messages: [{ role: "user", parts: [{ type: "text", text: job.prompt }] }],
     chatId, sessionId, userId: job.ownerUserId,
     requestUrl, requestId, authSession: null, maxSteps: 500,
   }]);
   ```
   (`runAgentWorkflow` -> `openAgent` in `apps/web/app/workflows/chat.ts`).
   The runner first materializes session + chat via
   `createSessionWithInitialChat` (`apps/web/lib/db/sessions.ts`). The
   workflow's existing `persistAssistantMessage` step lands the result as a
   `chat_messages` row, and its auto-commit/auto-create-PR steps cover the
   "result lands as a PR" path — the fake agent models both.

4. **Schema** — add the two tables to `apps/web/lib/db/schema.ts` as
   `pgTable`s (text ids, `timestamp` columns, `boolean("enabled")`, status via
   `text({ enum })`, indexes), then `bun run --cwd apps/web db:generate` and
   commit the migration. Note the repo **already** ships a `schedule.cron`
   trigger kind and a `schedule` column on `backgroundAgentTriggers`
   (`apps/web/lib/db/schema.ts`), so standing agents can alternatively be
   layered onto the existing `background_agents` model instead of a new
   `scheduled_jobs` table — the dispatch and auth path are identical.

## Feasibility verdict

**Feasible and low-risk.** Every dependency already exists in the repo: a
working cron route + `vercel.json` crons entry, the `CRON_SECRET` bearer auth
convention, a durable `runAgentWorkflow` dispatch, and even a `schedule.cron`
trigger enum. The only genuinely new pieces are the `scheduled_jobs` /
`scheduled_job_runs` tables and the due-job query — both demonstrated here
against a real database. The agent invocation is a one-line `start(...)` call
behind a seam whose shape already matches production.

## Blind spots eliminated

- **Vercel cron frequency limits.** Cron *granularity* is bounded by the
  plan: **Hobby** projects allow only a small number of cron jobs that run at
  most **once per day**; **Pro/Enterprise** allow minute-level schedules and
  many crons. The platform tick is therefore the upper bound on scan
  frequency. We handle this by decoupling the job's own cadence from the tick:
  due-ness is computed from `next_run_at` (via `cron-parser`), so on a Pro
  `*/5` scan a job with `0 9 * * *` fires once at the first scan past 09:00,
  and a job finer than the tick simply can't fire faster than the tick.
- **"Due" without overlapping ticks.** Each run is keyed to a **scheduled
  tick** (`scheduledTickFor`) and guarded by a unique
  `(jobId, scheduledFor)` index, so a jittered/retried/duplicate cron
  invocation in the same window dispatches the logical run exactly once. Proven
  by the sequential and concurrent idempotency tests.
- **Schedule advances even on failure** — a failing run still advances
  `nextRunAt` so one bad tick cannot wedge a job forever (proven by the runner
  recording `status=failed` then advancing).
- **Auth is the real Vercel convention** — bearer `CRON_SECRET`, timing-safe,
  GET. Not a guess; copied from the existing cron route.

## Remaining risks

- **DURABILITY GAP -> depends on POC 2b.** The cron handler dispatches the
  agent run, but the run itself outlives the cron function invocation. In this
  POC the fake agent completes synchronously; in production
  `start(runAgentWorkflow, ...)` returns immediately and the *workflow* must
  survive function teardown. If the standing-agent run is not executed on a
  durable runtime, results will not reliably land after the cron function
  returns. **This POC proves scheduling + dispatch + idempotency; it does not
  prove the run survives teardown — that is exactly what POC 2b (durable
  execution) must establish.** The `scheduled_job_runs` row left in `running`
  is the handoff point a durable runtime would resolve.
- **Cross-instance idempotency** relies on the DB unique constraint. The
  eval's concurrency test runs on Bun's single event loop (cooperative
  scheduling), so it proves the application-level critical section and the
  pre-check; true multi-instance races (two Vercel functions firing at once)
  are enforced by Postgres's unique index, not provable in an in-process
  sqlite eval. The constraint is in the schema and must be present in the
  generated migration.
- **Scan cost at scale** — the due-job query is a single indexed scan
  (`enabled` + `next_run_at`), fine for thousands of jobs; very large fleets
  would want batching / a work queue rather than inline `for`-loop dispatch.
- **Backfill / missed ticks** — if the platform skips a tick (outage), jobs
  with past `next_run_at` fire once on the next scan (catch-up, not
  replay-each-missed). That is the intended semantics but should be a product
  decision.
```
