# Background Agents & Loops Audit Scratchpad

## Files Read (in order)

1. `docs/agents/lessons-learned.md` — 166 lines of known issues. Key domain-relevant:
   - LL-148: Static workflow imports required for DevKit compilation; dynamic-only silently skips
   - LL-150: FK constraints invisible to mock-based tests; store mocks should enforce FK shape
2. `app/api/background-agents/webhook/[publicId]/route.ts` — Webhook endpoint w/ HMAC sig
3. `app/api/background-agents/cron/route.ts` — Cron endpoint w/ Bearer + custom header auth
4. `lib/background-agents/dispatcher.ts` — Dispatch for trigger events, webhook errors, manual test, scheduled
5. `lib/background-agents/signature.ts` — verifyBackgroundWebhookSignature (HMAC-SHA256, timingSafeEqual)
6. `lib/background-agents/schedule.ts` — scheduleMatchesNow (5-field cron, @hourly/@daily/@weekly macros, UTC-based)
7. `lib/background-agents/store.ts` — CRUD for bg agents, triggers, runs, events, outputs, tool grants; FK shapes
8. `lib/background-agents/config.ts` — Feature flags, allowlist, cron/webhook secrets
9. `lib/background-agents/executor.ts` — executeBackgroundAgentRun ("use step"), sandbox lifecycle, learnings runner, reconstructEventFromRun
10. `lib/background-agents/types.ts` — Zod schemas, normalized event types, idempotency key builder
11. `app/workflows/background-agent.ts` — runBackgroundAgentWorkflow ("use workflow"), delegates to executor
12. `app/workflows/agent-loop-step.ts` — runAgentLoopStepWorkflow ("use workflow"), delegates to chain.ts
13. `lib/background-agents/schedule-builder.ts` — composeCron, parseCron (new/untracked)
14. `lib/agent-loops/store.ts` — CRUD for loops, runs, step runs, events, watchdog runs; pause/cancel/resume/retry/advance/conditionallyTransitionRunStatus
15. `lib/agent-loops/dispatcher-bridge.ts` — dispatchLoopRunForTrigger, dispatchManualAgentLoopStart, buildIdempotencyKey
16. `lib/agent-loops/run-controls.ts` — Route-side pause/cancel/resume/retry calling store functions + workflow dispatch
17. `app/api/agent-loops/[loopId]/route.ts` — GET/PATCH/DELETE for single loop, ownership-scoped
18. `app/api/agent-loops/[loopId]/runs/route.ts` — GET/POST for loop runs, ownership-scoped
19. `app/api/background-agent-runs/[runId]/route.ts` — GET run detail, ownership-scoped
20. `app/api/background-agent-runs/route.ts` — GET runs list, ownership-scoped
21. `lib/background-agents/schedule-presets.ts` — Presets, validateSchedule, computeNextRuns
22. `lib/background-agents/matching.ts` — triggerMatchesEvent (conditions evaluation)
23. `lib/background-agents/github-events.ts` — normalizeGitHubBackgroundEvent (4 event types)
24. `lib/agent-loops/condition.ts` — evaluateCondition (loop step context conditions)
25. `app/api/agent-loop-runs/[runId]/route.ts` — GET run detail, manual ownership check (not store-scoped)
26. `app/api/agent-loop-runs/[runId]/cancel|pause|retry/route.ts` — Run control routes, ownership via store
27. `app/api/agent-loops/sweep/route.ts` — Cron-auth sweep endpoint
28. `lib/agent-loops/sweep.ts` — sweepStalledLoopRuns with conditional transition
29. `app/api/github/webhook/route.ts` — GitHub App webhook (HMAC, PR closed/reopened, installation lifecycle)
30. `lib/agent-loops/chain.ts` — runAgentLoopStep ("use step"), advanceLoopRun, watchdog integration
31. `lib/agent-loops/watchdog.ts` — invokeWatchdog, invokeWatchdogForStall, decision parsing + application

## Assumptions & Corrections

1. **Assumed** `startRun` leaves failed workflow starts as stuck "queued" → **Correction**: `recordWorkflowStartFailure` sets status to "failed" with errorKind "workflow_failed". Runs do NOT get stuck as queued on agent-bound triggers.

2. **Assumed** `dispatchStepWorkflow` dynamic import in store.ts violates LL-148 → **Correction**: `runAgentLoopStepWorkflow` is statically imported in dispatcher-bridge.ts (line 16) and run-controls.ts (line 27), so the workflow IS compiled by the DevKit. The dynamic import in store.ts is supplementary for circular-dependency avoidance.

3. **Assumed** `reconstructEventFromRun` is correct (per comment at lines 589-591 of executor.ts) → **Correction**: The comment asserts "trigger had mergedOnly:true" but this is NOT validated. Triggers without `mergedOnly` can still match PR close events, and the `merged` flag from the original event is lost (not persisted in the run row).

4. **Assumed** `advanceToFailureEdge` guards against paused runs → **Correction**: It uses an unconditional status update to "running" with only `eq(runId)` in the WHERE clause. No guard against paused/cancelled status.

5. **Assumed** all API routes have ownership scoping → **Confirmed**: All run/loop routes check userId. Webhook uses HMAC, cron uses secret.

## Candidate Defects

### ACCEPTED: Finding 1 — `advanceToFailureEdge` unconditional status update races with pause
- **Files**: `lib/agent-loops/store.ts:1611-1622`, `lib/agent-loops/watchdog.ts:453-457`, `lib/agent-loops/chain.ts:517-542`
- **Observed**: `advanceToFailureEdge` does an unconditional `UPDATE SET status='running' WHERE id = $runId` without checking current status. The watchdog's skip decision path calls this function.
- **Trigger**: A step fails with no static failure edge, watchdog is enabled, user pauses the run during the watchdog's LLM call (5-30s window), watchdog decides "skip", `advanceToFailureEdge` overwrites the paused status to running.
- **Impact**: Run silently resumes after user-initiated pause, dispatching a new step.
- **Severity**: Low — narrow race window, requires watchdog enabled + skip decision.

### ACCEPTED: Finding 2 — `reconstructEventFromRun` hardcodes `merged: true` for all PR runs
- **Files**: `lib/background-agents/executor.ts:612-613`
- **Observed**: `merged: run.triggerKind === "github.pull_request" ? true : undefined` always sets `merged: true` for PR-triggered runs, even when the original event had `merged: false` (PR closed without merging).
- **Trigger**: A PR is closed without merging (action: "closed", merged: false), the trigger doesn't have `mergedOnly: true`, a run is created, learnings extraction fires. The runner's gate at `runner.ts:107` (`event.merged !== true`) is bypassed because of the reconstruction bug.
- **Impact**: Learnings extraction attempts to process unmerged PRs. The actual GitHub API data is still correct (the runner fetches the PR directly), but the gate that should short-circuit for non-merged PRs is defeated. May produce lower-quality learnings from rejected/cancelled PRs.
- **Severity**: Medium — data integrity issue on the reconstruction path, but scope is limited to learnings extraction.

### REJECTED: Webhook publicId spoofing
- HMAC signature verification on every webhook request. Without the shared secret, an attacker cannot produce a valid signature. The publicId is opaque (nanoid(16)). No ownership leak.

### REJECTED: Missing FK validation on event inserts
- `recordBackgroundAgentEvent` inserts without validating FK. PG enforces FK at the DB level (constraint violation throws). The LL-150 fix (store mocks enforce FK shape) is for tests, not production. Production FK enforcement is correct.

### REJECTED: Cron timezone confusion
- `scheduleMatchesNow` uses UTC exclusively. `schedule-builder.ts` produces UTC cron strings. Schedule presets like "Daily (morning)" = `"0 9 * * *"` run at 9 AM UTC. This is documented behavior, not a bug.

### REJECTED: Missing top-level workflow import for agent-loop-step
- `runAgentLoopStepWorkflow` is statically imported in both `dispatcher-bridge.ts` (line 16) and `run-controls.ts` (line 27). The dynamic import in `store.ts:1631-1634` is supplementary. DevKit compiles the workflow via the static imports.

### REJECTED: `startRun` failure leaves stuck queued run
- `recordWorkflowStartFailure` transitions to "failed" with errorKind. No stuck state.

### REJECTED: Events/outputs lack ownership scoping at the row level
- Route handlers check ownership on the parent run before listing events/outputs. The parent run IS ownership-scoped.

## Coverage Gaps

1. **Workflow heartbeat/resilience**: Did not trace how the DevKit handles workflow step timeouts or retries for the background-agent and agent-loop-step workflows. The `executeBackgroundAgentRun` function has no explicit timeout mechanism beyond the agent's `DEFAULT_AGENT_TIMEOUT_MS`.

2. **Cron duplicate suppression testing**: The minute-bucket idempotency key (`getScheduleExternalId`) means two cron invocations within the same UTC minute suppress the second one. Did not verify this is tested end-to-end.

3. **Watchdog budget race**: Two concurrent step failures for the same node could race on the budget counter. The `countWatchdogRetryDecisions` query is not performed in a transaction with the subsequent decision application. Did not deep-dive into whether this matters.

4. **Transaction boundaries on run creation + event recording**: `createRunForTrigger` and subsequent event recording are in separate function calls without a shared transaction. A crash between run creation and event recording would leave an event-less run.
