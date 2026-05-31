# POC 2b — Durable workflow / job queue

Load-bearing durability spike. Proves that an agent run can **survive a process
crash**, **replay completed steps instead of re-executing them**, **park on a
durable suspend point** (sleep timer or external event), and **retry failing
steps with backoff** — all reconstructed from a persisted log on disk, with no
in-memory state carried across the crash boundary.

This unblocks 1b (approval park), 2a (cron-triggered runs), 2c (event-driven
agents), and long-running agents generally.

---

## Goal

The repo's current agent loop lives in `apps/web/app/workflows/chat.ts` and uses
the **Vercel Workflow DevKit beta** (`workflow` `^4.2.0-beta.72`): the
`"use workflow"` / `"use step"` directives, `start()` from `workflow/api`, and
`getWritable()`/`getRun()` from `workflow`. On Vercel this is durable (Vercel
World), but the directive-based runtime does **not run outside a Vercel
deployment** in any provable way locally — the local backend (`world-local`)
executes steps synchronously in a `.workflow-data/` dir and is positioned for
dev iteration, not as a crash-durability proof.

For long-running, scheduled, and approval-parked agents we need a durability
model we **understand and can prove**: completed work is checkpointed, a crash
loses nothing, suspended runs cost no compute, and resume is deterministic.

This POC (a) researches the DevKit's durability model and one external-queue
alternative, and (b) builds a **locally-runnable durable engine** and proves
crash-resume-without-re-execution with a real simulated crash.

---

## Research findings (with versions)

### Vercel Workflow DevKit (`workflow`, repo uses `^4.2.0-beta.72`; docs are v5)

The DevKit makes durability a language-level concept via two directives:

- **`"use workflow"`** — marks a durable orchestration function. Its body is
  re-executed (replayed) on resume; completed steps return their checkpointed
  results rather than running again.
- **`"use step"`** — marks a unit of work whose **result is checkpointed**. On
  retry/resume only failed steps re-run; completed steps are skipped. (This is
  the exact property this POC reproduces.)

Durability primitives:

- **`sleep("30d")`** — suspends without consuming compute until a wall-clock
  deadline; survives deployments and crashes.
- **Human-in-the-loop** — `createWebhook()` returns a URL; `await webhook`
  suspends until the URL is POSTed (untyped JSON). `createHook<T>({ token })` /
  `defineHook<T>()` give a **token-addressable, typed** suspend point resolved
  by delivering a payload for that token. Idiomatic park-with-timeout:
  `Promise.race([approval, sleep("7d")])`.
- **Retries** — failed steps are retried; `withRetry(fn, { maxRetries, shouldRetry })`
  customizes count and predicate.
- **`DurableAgent`** (`@workflow/ai/agent`) — an AI-SDK-shaped agent whose tool
  calls can themselves `sleep`/await hooks at the workflow level, streaming via
  `getWritable<UIMessageChunk>()`. This is the natural evolution of the repo's
  current `chat.ts`.

**Persistence backend — the "World" abstraction** (the key portability finding):
execution, queuing, and persistence are pluggable per environment, same code
everywhere.

| World | Package | Persistence | Use |
|---|---|---|---|
| Local | `@workflow/world-local` | filesystem JSON in `.workflow-data/`, in-memory queue, synchronous steps | dev only |
| Vercel | `@workflow/world-vercel` | Vercel-managed storage + Queues, Redis-backed resumable streams | managed prod (zero config) |
| Postgres | `@workflow/world-postgres` | **PostgreSQL + graphile-worker** | **self-hosted prod** |
| Community | MySQL, Redis, Turso, Mongo, NATS, Cloudflare, Platformatic (K8s) | varies | other infra |

Streams persist too: Redis-backed on Vercel, filesystem locally — so a resumed
workflow can keep streaming to a reconnecting client.

**Implication for this repo:** the DevKit is *not* lock-in by construction. A
`@workflow/world-postgres` pointed at the existing Neon database would give
durable execution on the repo's own infrastructure. The current Vercel
limitation (workflow backend deployed only in `iad1`; other regions route there)
is a latency note, not a correctness one.

### External-queue alternative (for comparison)

- **Upstash Workflow** (on **QStash**): durable step functions with server-side
  checkpointing (only failed/incomplete steps re-run), **at-least-once
  delivery**, default **3 retries with exponential backoff** (+ DLQ + replay),
  `context.waitForEvent` / `notify()` for HITL with **idle waits consuming no
  compute**, `context.call` for slow external HTTP. HTTP-driven; cloud-hosted
  only.
- **QStash alone**: just reliable async HTTP delivery + retries; you wire state
  yourself. Too low-level for multi-step agent orchestration.
- **Inngest**: full platform — durable `step.run`, `step.waitForEvent`,
  event routing, fan-out, concurrency control, one-click replay, local dev
  server. Cloud-only (engine not self-hostable; SDK is OSS).

### DevKit vs external queue — comparison

| Dimension | Vercel Workflow DevKit | Upstash Workflow (QStash) | Inngest |
|---|---|---|---|
| Programming model | language-level (`"use workflow"`/`"use step"`), code reads linearly | explicit `context.run`/step wrappers | explicit `step.run` wrappers |
| Step replay (not re-run) | yes (checkpointed results) | yes (server-side checkpoint) | yes (server-side checkpoint) |
| Durable sleep | `sleep()`, suspends w/o compute | step sleep, no idle compute | `step.sleep`, no idle compute |
| Human-in-the-loop | `createWebhook` / typed `createHook(token)` | `waitForEvent` + `notify()` | `step.waitForEvent` |
| Retry + backoff | failed-step retry, `withRetry` | default 3 + exp backoff, DLQ | configurable per step, replay |
| Delivery guarantee | durable runtime (World-dependent) | at-least-once + dedupe | at-least-once (event-based) |
| Local runnability | Local World (dev; not a crash proof) | needs cloud QStash (or emulator) | local dev server |
| Self-host / lock-in | **low** — pluggable Worlds inc. Postgres on own DB | **high** — Upstash cloud only | **high** — engine cloud only |
| Fit with current repo | **native** — repo already on `workflow` + AI SDK | rewrite to HTTP-step model | rewrite + new vendor |

---

## What was built

A self-contained durable engine (no external services; real on-disk store) under
`src/`:

- **`store.ts`** — `WorkflowStore`, a **real SQLite database** (`bun:sqlite`,
  WAL + `synchronous=FULL`) holding four tables: `runs`, `steps`, `sleeps`,
  `event_waiters`. This is the local analogue of a DevKit "World"; swapping it
  for a Postgres/Drizzle store backed by Neon is the only change needed for prod.
- **`engine.ts`** — `WorkflowEngine`. Provides a `ctx` with:
  - `ctx.step(key, fn, retry?)` — runs `fn`, **checkpoints its JSON result**.
    On a resumed run a completed step **returns the logged result without
    calling `fn`** (replay, not re-run). Failed attempts persist their count, so
    retries are themselves crash-safe.
  - `ctx.sleep(key, ms)` — persists an absolute `wakeAt`; throws a `Suspend`
    sentinel until the deadline. The timer is on disk, not a `setTimeout`.
  - `ctx.waitForEvent(key, token)` — persists an undelivered waiter and throws
    `Suspend`; resumes with the delivered payload. `store.deliverEvent(token,
    payload)` is the seam an HTTP approval/webhook/cron endpoint calls.
  - Retry policy with exponential backoff (`maxAttempts`, `baseDelayMs`,
    `factor`, `maxDelayMs`; default 3 attempts).
  - Suspension = throwing a `Suspend` out of the workflow fn; the driver records
    the suspended state and returns. Re-running the same fn against the same
    store replays the log to the frontier, then resumes or re-suspends.
- **`workflow.ts`** — the workflow under test: Step A (observable
  non-idempotent side effect → real file on disk), Step B (`waitForEvent`
  approval gate), Step C (fails twice, succeeds on the third → retry/backoff).
- **`crash-phase1.ts` / `crash-phase2.ts`** — the two halves of the crash test,
  run as **separate OS processes** joined only by the SQLite file.
- **`eval.ts`** — orchestrates the crash test and asserts the durability
  properties; writes evidence.
- **`sleep-eval.ts`** — isolates the durable-sleep deadline-persistence property.

---

## How it was tested + crash-resume evidence

### Commands

```bash
cd POC/2b-durable-workflow
bun install
bun run typecheck      # clean
bun run eval           # crash-resume: step replay + event suspend + retry/backoff
bun run eval:sleep     # durable sleep deadline survives teardown
```

### The real crash

`eval.ts` spawns **`crash-phase1.ts` as its own `bun` process**. That process
runs the workflow until Step A's side effect is committed and the run is
durably suspended at the Step B approval gate, then calls **`process.exit(137)`**
(128 + SIGKILL) — a real, hard process death. Every byte of in-memory state (the
engine, the module-level execution counters, the call stack) is gone. Only the
SQLite file survives. `eval.ts` then spawns **`crash-phase2.ts` as a brand-new
process** which opens the same file and resumes.

### Proven results (19/19 assertions PASS — `evidence/summary.json`)

Phase 1 (before crash), from `evidence/phase1-output.txt`:

```
{"phase":1,"event":"step-A-completed","inProcessStepAExecutions":1}
{"phase":1,"outcome":{"status":"suspended_event","stepKey":"wait-for-approval",...}}
{"phase":1,"event":"SIMULATED_CRASH","code":137}
```

Phase 2 (fresh process, from `evidence/phase2-output.txt`):

```
{"phase":2,"event":"first-resume-from-disk","outcome":{"status":"suspended_event",...},
 "inProcessStepAExecutions":0,"sideEffectLinesBefore":1}
{"phase":2,"event":"event-delivered","notifiedRuns":["run-crash-demo"]}
{"phase":2,"event":"final-resume","outcome":{"status":"completed",
 "result":{"counter":1,"approval":{"approved":true,...},"finalizeAttempts":3,"done":true}},
 "inProcessStepAExecutions":0,"sideEffectLinesAfter":1}
```

The whole point, made provable rather than asserted:

- **Replay, not re-run.** Step A's body ran **once** in process #1
  (`inProcessStepAExecutions: 1`) and **zero** times in the fresh process #2
  (`inProcessStepAExecutions: 0`), yet its result was available. The observable
  on-disk side-effect file (`evidence/side-effect.log`) has **exactly one line**
  before the crash, after the first resume, and after full completion. Final
  `counter === 1`. If the engine had re-executed the completed step, the file
  would have a second line and the counter would read 2.
- **Durable suspend across the crash.** The persisted run row
  (`evidence/step-log-at-crash.json`) shows `status: "suspended_event"` with an
  **undelivered waiter** for the approval token and **no record of Step C** —
  captured by opening the DB file *after* the engine process died.
- **Resume on external event.** `store.deliverEvent(token, payload)` (the
  approval/webhook/cron seam) flips the waiter to delivered; the next resume
  proceeds past the gate.
- **Retry with backoff.** Step C fails its first two attempts and succeeds on
  the third; `evidence/step-log-final.json` records `attempts: 3` for
  `flaky-finalize`, and the final result carries `finalizeAttempts: 3`.

`eval:sleep` separately proves the **durable sleep** timer: a workflow suspends
on `sleep`, the store is closed (teardown), a fresh engine resuming *before* the
deadline **re-suspends with the same `wakeAt`** (timer not restarted), and only
after the original wall-clock deadline does it wake and complete — with the
setup step replayed, not re-run (`evidence/sleep-step-log.json`).

### Evidence files (committed)

- `summary.json` — machine-readable result (19/19, all 4 durability properties true).
- `step-log-at-crash.json` — persisted log snapshot **at the crash boundary**.
- `step-log-final.json` — persisted log after completion (shows retry attempts=3).
- `side-effect.log` — the observable side effect; **one line** proves no re-run.
- `sleep-step-log.json` — sleep deadline stable across teardown.
- `phase1-output.txt` / `phase2-output.txt` — raw cross-process logs.

---

## Recommendation

**Adopt the Vercel Workflow DevKit as the durable runtime, backed by a
self-hostable World (Postgres on the existing Neon DB) rather than relying on
the Vercel-managed World alone.** Do **not** introduce an external queue vendor
(Upstash/Inngest).

Why:

1. **The repo is already on it.** `chat.ts` uses `"use workflow"`/`"use step"`,
   `start`, `getWritable`, `getRun` today. Switching to Upstash/Inngest means
   rewriting the agent loop into an HTTP-step model **and** taking a new vendor
   dependency — pure cost for capabilities the DevKit already has.
2. **Lock-in is the differentiator, and the DevKit wins it.** The World
   abstraction means the same agent code runs on the Local World (dev), the
   Vercel World (managed prod), or `@workflow/world-postgres` against Neon
   (self-hosted, no vendor coupling). Upstash and Inngest are cloud-only.
3. **The durability model is exactly what this POC validated.** Checkpointed
   step results with replay-not-rerun, durable sleep, token/webhook HITL, and
   failed-step retry are all first-class — this POC reproduced each property
   from first principles, so we now understand the contract we're depending on.
4. **`DurableAgent` is the migration target** for the agent loop, keeping the
   AI-SDK streaming surface (`getWritable<UIMessageChunk>()`) the UI already
   consumes.

This POC's engine is the **conceptual reference / fallback**, not the production
artifact: if the DevKit beta proves unstable, the `store.ts` + `engine.ts` model
(swap SQLite for Drizzle/Neon) is a known-good, ~600-line (heavily commented)
durable executor we control outright.

---

## Integration plan (real file paths)

1. **Pin the persistence World.** Add `@workflow/world-postgres` and point it at
   the existing Neon connection (`POSTGRES_URL`) so durability lives on the
   repo's own DB, independent of the Vercel-managed World. Verify locally with
   the Local World first.
2. **Keep `apps/web/app/workflows/chat.ts` as the workflow** (`"use workflow"`)
   and its `"use step"` functions (`runAgentStep`, `convertMessages`, etc.) —
   they already match the DevKit step contract this POC validated. No structural
   rewrite.
3. **Replace the approval pause with a durable hook (unblocks 1b).** Today
   `shouldPauseForToolInteraction` breaks the step loop and relies on the client
   resuming. Swap to a typed `createHook<{approved:boolean}>({ token:
   approvalTokenFor(toolCallId) })` awaited at the workflow level; the existing
   `withApproval` wrapper from POC 1b parks the tool, and an approval endpoint
   delivers the payload (the `store.deliverEvent` seam here →
   `getRun(runId)`/hook resolution there). The park now survives function
   teardown — exactly the gap POC 1b flagged as "depends on 2b".
4. **Add a scheduled trigger (unblocks 2a).** A cron endpoint calls
   `start(runAgentWorkflow, [...])`; for delayed/recurring resume, model the
   wait with `sleep()` at the workflow level (validated here as durable across
   teardown). The `workflowRuns` table already records run status/timings.
5. **Add event resume (unblocks 2c).** The GitHub webhook
   (`apps/web/app/api/github/webhook/route.ts`) and any future external event
   resolves a `createHook`/`createWebhook` token — the same
   `waitForEvent`/`deliverEvent` pattern proven here, generalized beyond GitHub.
6. **Persisted streams for reconnect.** The Redis-backed resumable streams the
   DevKit provides on Vercel replace the current best-effort
   `claimActiveStream`/`clearActiveStream` dance for client reconnection.

### How it unblocks the dependents

- **1b (approval park):** durable, token-addressed suspend that survives
  serverless restart — the missing durability layer 1b explicitly deferred.
- **2a (cron runs):** durable `sleep`/scheduled resume; runs parked for
  hours/days cost no compute and wake at the right wall-clock time.
- **2c (event-driven agents):** generalized `waitForEvent(token)` +
  `deliverEvent` seam for arbitrary external events, not just GitHub.
- **Long-running agents:** step-replay means a 50-step agent that dies at step
  40 resumes at step 40, not step 0 — no duplicated tool side effects, no
  re-billed model calls.

---

## Blind spots eliminated

- **"Does the current `workflow` package give us crash durability we can rely
  on locally?"** Clarified: durability is real but **World-dependent**; the
  Local World is for dev, not a crash proof, and the managed World is `iad1`-only
  today. The durable, self-hosted path is `@workflow/world-postgres` on Neon.
- **"Is step replay actually replay, or does resume re-run completed work?"**
  Proven replay: a non-idempotent side effect fired exactly once across a real
  `exit(137)` crash and two processes.
- **"Can a run survive a hard crash with zero in-memory carry-over?"** Proven:
  phase 2 shares nothing with phase 1 but a SQLite file and reconstructs the
  exact suspended state.
- **"Do durable sleep and external-event suspend hold across teardown?"** Both
  proven (stable `wakeAt`; persisted undelivered waiter resolved post-crash).
- **"Are retries crash-safe?"** Attempt counts persist per step; backoff
  schedule is deterministic; Step C reached attempt 3 and is recorded as such.
- **"Is the DevKit a lock-in trap?"** No — the World abstraction makes the same
  code portable; an external queue would be *more* lock-in, not less.

## Remaining risks

- **DevKit is beta** (repo pins `^4.2.0-beta.72`; docs are v5). Directive
  semantics and `world-postgres` maturity should be validated against the actual
  Neon setup before committing the agent loop. Mitigation: this POC's
  `engine.ts`/`store.ts` is a controlled fallback executor.
- **Step determinism contract.** Replay requires steps to be requested in a
  stable order and to return serializable results; non-deterministic control
  flow around steps can desync replay. The engine here keys steps explicitly and
  tracks ordinals; production code must keep step boundaries pure (no
  un-stepped side effects in the `"use workflow"` body).
- **At-least-once execution.** A crash *between* a side effect and its
  checkpoint write can re-run that step on resume. Durable runtimes (and this
  POC) guarantee at-least-once, not exactly-once — steps with external side
  effects (commits, PRs, payments) must be idempotent or guarded by an
  idempotency key.
- **This engine is a prototype**, not the production store: single-node SQLite,
  no concurrent-worker locking, no leasing/visibility-timeout. The DevKit's
  World (or a Postgres-backed rewrite of `store.ts`) supplies those for prod.
- **Stream resumption** under the DevKit needs its own verification against the
  current reconnect UX; not exercised by this POC.
