# UX Stories: Stalled Runs and the Sweep

**Feature area:** Agent Loops — stalled run state, recovery, and the operator-level sweep mechanism
**Discovery source:** `docs/ux-paths/discovery.md` — pain point 5, recommended topic 6

---

## STORY-001: The Run That Stopped Without Saying Why
**Type**: short
**Persona**: Priya, a solo developer who set up a loop two weeks ago to auto-triage GitHub issues. She checks in on it occasionally.
**Goal**: Understand why her loop run has not progressed in 45 minutes
**Preconditions**: A loop run was triggered by a GitHub webhook at 9:14 AM. The sandbox hit an internal timeout and stopped emitting events. The cron sweep ran at 9:30 AM and marked the run `stalled`. Priya opens the loop detail page at 10:02 AM.

### Steps
1. Priya navigates to `/loops` and sees her "issue-triage" loop in the list. The most recent run row shows a neutral grey pill labeled **stalled**. She frowns — she expected **completed**. → `loop-detail.tsx:94` renders `StatusPill` with `status="stalled"` which falls into the final `else` branch: grey `border-border bg-muted/40 text-muted-foreground`.
2. She clicks the run row to open `/loops/[loopId]/runs/[runId]`. The run-detail header shows the **stalled** pill alongside the run ID. The page does not show any loading spinner or "Refreshing every 2s" annotation. → Polling has stopped: `use-loop-run-polling.ts:11-12` — `ACTIVE_STATUSES` is `{queued, running, paused}`; `stalled` is not in it, so `computeLoopRunRefreshInterval` returns `0`.
3. She reads the proof strip. Status is `stalled`, Duration shows elapsed real time (e.g. `16m 3s`), Current Node still says `check-ci` — the node that was executing when the run died. Nothing else in the strip explains what happened. → `run-detail.tsx:247-278`: proof strip renders `run.status`, `run.currentNodeId`, and computed duration. No "stalled reason" field exists in the strip.
4. She scrolls to the error banner. It shows `errorKind: stall_sweep` and the message `Run stalled: no event for 16 minutes`. → `run-detail.tsx:284-295` renders the error banner only when `run.errorKind` is truthy. `sweep.ts:57-59` sets `errorKind: "stall_sweep"` and the human-readable message during the conditional transition.
5. She sees a single **Retry** button in Run Actions. No explanation of what Retry does is shown on screen. → `run-actions.tsx:169-184`: `isTerminal` is true for `stalled`; Retry is the only rendered control. No tooltip or inline copy explains that Retry restarts only the last step, not the whole run.

### Variations
- **No error banner (pre-fix)**: Before commit `ef4f39f6`, the sweep query threw `TypeError` at the postgres Bind step because a raw `Date` was passed as a parameter instead of `.toISOString()`. Every sweep invocation would 500, so `errorKind` and `errorMessage` were never written — the run's error banner would be empty and the status would never transition from `running` to `stalled`. Users would see a run stuck on `running` indefinitely, with the page polling every 2s forever.
- **Recent event, not yet stalled**: If Priya checks in at the 10-minute mark (before the 15-minute threshold), the run still shows `running` with the amber pill and the page refreshes every 2s. Nothing tells her whether the run is healthy or frozen.

### Edge Cases
- **Sweep not configured**: If `CRON_SECRET` / `BACKGROUND_AGENTS_CRON_SECRET` is absent, `route.ts:29-34` returns 500 and no sweep ever runs. Runs pile up in `running` indefinitely with no transition and no user-visible indication.
- **Race during sweep**: If the run completes between `findStalledLoopRunCandidates` and the `conditionallyTransitionRunStatus` call, the conditional update returns `null` (0 rows) and the sweep skips event emission (`sweep.ts:61-64`). The run correctly shows `completed`, not `stalled`.

### UX Friction Observed
- `run-detail.tsx:284-295` — The error banner is the only place `stall_sweep` is surfaced, but users must scroll past the proof strip and Run Actions to find it. "Stalled" should be explained at the status pill level, not buried.
- `run-actions.tsx:169-184` — "Retry" is shown for all terminal statuses including `stalled` with no copy distinguishing "retry the last step" from "restart the run." Users attempting recovery may be surprised when only the last node re-executes.
- `use-loop-run-polling.ts:11-12` — Polling stops immediately on `stalled`. If a user had the page open when the sweep fired, the status changes from `running` (amber, polling) to `stalled` (grey, stopped) without any in-page notification. The page simply freezes.

---

## STORY-002: Deciding Whether to Retry or Investigate
**Type**: medium
**Persona**: Marcus, an engineering lead who operates five loops across different repos. He's on call and just received a Slack alert (from an external monitor, not from the app) that a deploy-gate loop run finished with an unexpected status.
**Goal**: Determine whether the stalled run was a one-off infrastructure blip or a symptom of a broken loop step, and decide whether to retry or fix the definition first.
**Preconditions**: A loop named "deploy-gate" has run 23 times successfully this week. Run #24, triggered by a schedule at 2:47 AM, is now `stalled`. The last step attempted was `run-agent-step` at node `lint-check`, which had been running for 17 minutes before the sweep fired.

### Steps
1. Marcus opens `/loops/[loopId]` and scans the run list. He sees run #24 in grey (`stalled`) and the five runs before it in green (`completed`). The pattern looks like a one-off. The "Source" column shows the raw string `schedule` with no formatting. → `loop-detail.tsx:95` renders `run.source` directly as text — no badge or label mapping.
2. He clicks run #24 to open the run-detail page. The proof strip shows Status: `stalled`, Source: `schedule`, Iterations: `1 / 10`, Steps: `3 / 50`, Duration: `17m 22s`. The error banner reads: `stall_sweep — Run stalled: no event for 17 minutes`. → `run-detail.tsx:247-278` and `284-295`. Duration is computed from `run.startedAt` to `run.finishedAt` (the timestamp written when the sweep transitioned the run). Steps and Iterations show real values against guardrail ceilings.
3. Marcus scrolls to the Step timeline. Three steps are shown. The first two have status `succeeded`; the third (`lint-check`) has status `running` with no `finishedAt` and a sandbox name `vxsb-a3f2c1`. → `run-detail.tsx:298-321` — `StepRow` renders `step.status` and `step.sandboxName`. The step is in `running` because the sweep only transitions the *run* status, not the individual step run status. This creates a visible inconsistency: the run is `stalled` but the step still shows `running`.
4. He expands the Event log. He sees events in order: `agent-loop.run.started`, two `agent-loop.step.succeeded` events, `agent-loop.step.started` (for `lint-check`), then `agent-loop.run.stalled` (warn level) at 3:04 AM — 17 minutes after the last progress event. The sweep's `agent-loop.sweep.completed` event also appears in the log because it was written against the same run ID (`sweep.ts:108-123`). → `run-detail.tsx:324-338` renders up to 200 events. The sweep.completed event is attached to the first stalled run's ID, not a global log.
5. Marcus notes that the sandbox `vxsb-a3f2c1` had no events for 17 minutes. The lint-check node historically takes 2-3 minutes. He concludes this was a sandbox-level hang, not a broken loop step. He clicks **Retry**. → `run-actions.tsx:169-184`. He expects to restart the whole run. In fact, `retryCurrentStep` in `run-controls.ts:136-186` creates attempt n+1 of the `lint-check` node only and dispatches a new workflow step. The iteration count and step count carry over.
6. The page does not immediately refresh after Retry (he is on a terminal-status page, polling is off). He has to manually reload to see the run status change from `stalled` to `running`. → `use-loop-run-polling.ts:47-51` — `refreshInterval` is computed from the current data's `run.status`. After Retry the server transitions the run to `running`, but the client's SWR cache still holds `stalled` because polling stopped. The `onActionComplete` callback calls `mutate` only if wired through (`run-actions.tsx:76`), but `run-detail.tsx:281` does not pass `onActionComplete`.

### Variations
- **Repeated stall on same node**: If Marcus retries and the run stalls again on `lint-check`, he will see the same `stall_sweep` error banner. There is no escalation path, retry counter, or "this step has stalled N times" signal in the UI.
- **Run stalled while paused**: Paused runs are excluded from sweep candidates by the store query (`store.ts:1247`). If Marcus had paused the run manually before the sweep fired, it would remain `paused` indefinitely — no timeout applies. This is correct behavior but not communicated anywhere in the UI.
- **Stall during queued state**: If the sandbox was never allocated and the run sat `queued` for 15+ minutes without emitting any events, the sweep would still catch it. The error banner would read `Run stalled: no event for 15 minutes` with `lastEventName: null` (the run's `createdAt` was used as the age reference, per `store.ts:1196-1199`).

### Edge Cases
- **`onActionComplete` not wired**: `run-detail.tsx:281` calls `<RunActions runId={run.id} loopId={loop.id} status={run.status} />` without `onActionComplete`. After Retry, the toast succeeds but the page is static. The user must reload manually or wait for an external navigation.
- **Step still showing `running` after run is `stalled`**: The sweep transitions `agent_loop_runs.status` only. The in-flight `agent_loop_step_runs` row for `lint-check` remains in `running` with no `finishedAt`. A developer reading the step timeline sees contradictory data.

### UX Friction Observed
- `run-actions.tsx:169-184` — No disambiguation copy on the Retry button. A user who expects "restart from the beginning" is surprised when only the last node re-executes.
- `run-detail.tsx:281` — Missing `onActionComplete` means the UI does not self-update after a Retry action. This is a silent usability hole on the most common stall-recovery path.
- `loop-detail.tsx:95` — `run.source` is rendered raw. `schedule` looks like a technical artifact; no human label like "Scheduled" is shown.
- `run-detail.tsx:109` (StepRow) — A step with `status: "running"` inside a `stalled` run is visually misleading. No clarifying annotation distinguishes "was running when stalled" from "is currently running."

---

## STORY-003: The Operator Configuring the Sweep (Never Seen by Users)
**Type**: medium
**Persona**: Dana, a platform engineer deploying open-agents for her team. She is setting up the sweep so that stalled runs are detected and recovered automatically.
**Goal**: Wire up the stall sweep so that it fires on a schedule and marks stalled runs within the configured window
**Preconditions**: The app is deployed to Vercel. `AGENT_LOOPS_ENABLED=true` is set. `CRON_SECRET` is not yet configured for the loops sweep.

### Steps
1. Dana reads the sweep route comment (`route.ts:1-12`) and learns the endpoint accepts `GET` or `POST`, authenticated via `Authorization: Bearer <CRON_SECRET>` or the `x-background-agents-cron-secret` header. She notices the secret is shared with the background-agents cron system: both read from `BACKGROUND_AGENTS_CRON_SECRET` or `CRON_SECRET` via `background-agents/config.ts:43-44`.
2. Dana checks `vercel.json` and finds only one cron entry: `/api/background-agents/cron` on `*/5 * * * *`. There is no cron entry for `/api/agent-loops/sweep`. She realizes the sweep endpoint must be called from an external cron (e.g., GitHub Actions, an external cron service, or a Vercel cron she adds manually). → `apps/web/vercel.json:3-7`.
3. Dana adds `CRON_SECRET=<secret>` to Vercel environment variables. She adds a second cron entry to `vercel.json` pointing to `/api/agent-loops/sweep` on `*/5 * * * *` (every 5 minutes — matching the background-agents cron cadence). She also considers setting `AGENT_LOOPS_STALL_MINUTES=15` (the default) explicitly for clarity.
4. Dana deploys and manually calls `GET /api/agent-loops/sweep` with `Authorization: Bearer <secret>`. She gets `{"stalledCount":0,"checkedCount":0}`. → `route.ts:43` returns the result of `sweepStalledLoopRuns()`. `sweep.ts:127` always returns `{stalledCount, checkedCount}` even when there are no candidates.
5. Dana triggers a test run and kills the sandbox externally to induce a stall. After 15 minutes she calls the sweep manually again. She gets `{"stalledCount":1,"checkedCount":1}`. She verifies the run is now `stalled` in the UI and the error banner shows `stall_sweep`. → Sweep result JSON is the only user-facing evidence the sweep ran. There is no per-deployment sweep history, no UI dashboard, and no alert on non-zero `stalledCount`.
6. Dana wants to tighten the threshold for her team's fast-running loops. She sets `AGENT_LOOPS_STALL_MINUTES=5`. The sweep now marks runs as stalled after 5 minutes of silence. She notes there is no per-loop override — the threshold is global. → `config.ts:44-53`.

### Variations
- **Missing secret**: If `CRON_SECRET` is absent, the sweep returns 500 (`route.ts:29-34`). Vercel's cron dashboard will show the invocation as failed but no alarm is fired in the app. Users continue to see runs stuck in `running` indefinitely.
- **Wrong threshold direction**: If `AGENT_LOOPS_STALL_MINUTES` is set very low (e.g., `2`), long-running legitimate agent steps will be swept as stalled. The sweep has no concept of a step-level timeout separate from the run-level threshold.
- **Two sweep invocations race**: If two cron ticks overlap (unlikely but possible), the conditional transition (`store.ts:conditionallyTransitionRunStatus`) ensures only one sweep wins per run — the second gets 0 rows updated and skips event emission. → `sweep.ts:61-64`, `sweep.regression.test.ts:REG-SW-02`.

### Edge Cases
- **No events table entry for the sweep**: The `agent-loop.sweep.completed` event is written against the first stalled run's ID only (`sweep.ts:108-123`). If no runs were stalled, the sweep completion is only logged to `console.info` and is invisible to any DB query. Operators who want an audit trail of sweep invocations cannot query it reliably.
- **`lastEventName: null` for brand-new runs**: A run that was queued but never emitted any event uses `run.createdAt` as its age reference (`store.ts:1196-1199`). After 15 minutes of silence from creation, it is swept — even if the sandbox was never allocated. The `agent-loop.run.stalled` event payload will have `lastEventName: null`.

### UX Friction Observed
- `apps/web/vercel.json:3-7` — No cron entry for the loops sweep. Operators must add it themselves or use an external scheduler. This is a deployment footgun — the feature is silently non-functional until wired up.
- `sweep.ts:96-104` — The `agent-loop.sweep.completed` event is only written to the DB when `stalledCount > 0`. Zero-stall sweeps are invisible at the DB level. Operators cannot distinguish "sweep ran and found nothing" from "sweep never ran."
- `config.ts:44-53` — `AGENT_LOOPS_STALL_MINUTES` is a single global value. Teams with mixed workloads (fast and slow loops) cannot tune per-loop. A loop running a 20-minute AI step would be falsely swept at 15 minutes.

---

## STORY-004: A New User Seeing "Stalled" for the First Time
**Type**: short
**Persona**: Kenji, a product manager who configured his first loop via a colleague's instructions. He does not know what "stalled" means in this context.
**Goal**: Understand what went wrong and what to do next
**Preconditions**: Kenji triggered his loop manually at 3 PM for the first time. The workflow engine failed to allocate a sandbox. The run sat `queued` for 16 minutes, emitting no events. The sweep ran at 3:15 PM and marked it `stalled`. Kenji returns at 3:25 PM.

### Steps
1. Kenji opens `/loops` and sees a row with a grey `stalled` pill. He does not recognize the status. He expected either `completed` or `failed`. → The run list `StatusPill` at `loop-detail.tsx:64-81` renders `stalled` in neutral grey — visually indistinct from `paused` or `cancelled`, no icon, no hover tooltip.
2. He clicks the run. The proof strip shows Status: `stalled`, Source: `manual`, Steps: `0 / —`, Duration: `16m 02s`. There is no step timeline content — "No steps recorded yet." The error banner shows `stall_sweep — Run stalled: no event for 16 minutes`. → `run-detail.tsx:307` shows the empty-steps message; `284-295` shows the error banner. "stall_sweep" is an internal error kind code, not a human label.
3. Kenji reads the error message. He is unsure what "no event" means. He looks for a "Why did this happen?" link or tooltip — there is none. He looks for a "Contact support" path — none exists in the run-detail page. His only choice is **Retry**. → `run-actions.tsx:169-184`: only Retry is shown for terminal status.
4. He clicks Retry. The toast says "Retry successful." The page does not refresh automatically. He reloads manually and now sees the run status as `running` with `Steps: 0`. → After `retryCurrentStep`, the run is back in `running` state (`run-controls.ts:136-186`). The sandbox allocation attempt begins again. If the same infra problem persists, the run will stall again in 15 minutes.

### Variations
- **Retry stalls again**: Kenji retries three times, each time seeing the same stall pattern. There is no retry counter or "this has failed N times" callout in the UI. He cannot tell from the UI that his loop is experiencing a persistent infrastructure problem.

### Edge Cases
- **User tries "Run now" on the loop while stalled run exists**: `stalled` is a terminal status, so a new run can be started immediately — there is no `active_run` 409 conflict. Kenji might create a second run without realizing the first stalled run is still visible in the list.

### UX Friction Observed
- `run-detail.tsx:284-295` — `errorKind: "stall_sweep"` is rendered as-is. A first-time user reads a code string, not an explanation.
- `run-actions.tsx:169-184` — No explanatory copy at the Retry button for the `stalled` case. No distinction between "retry the step" and "restart the run."
- `loop-detail.tsx:64-81` — The `stalled` status pill has no icon, no color coding distinct from `paused`, and no hover state. It blends into the UI without communicating urgency.

---

## STORY-005: The Invisible Recovery — Sweep Fires While User Watches
**Type**: long
**Persona**: Ariel, a developer who set up a loop to run automated code reviews on PRs. She is watching a run in real time because it is the first time she has run this loop in production.
**Goal**: Watch the run complete successfully — or understand what happened if it does not
**Preconditions**: Loop "pr-review" is active. A PR was opened at 11:00 AM, triggering a run automatically. Ariel opens the run-detail page at 11:02 AM while the run is in `running` status, watching the step timeline update. At 11:09 AM the sandbox silently hangs — no more events are emitted. The sweep fires at 11:15 AM.

### Steps
1. Ariel opens the run-detail page at 11:02 AM. The status pill shows amber **running** and the header shows "Refreshing every 2s." The step timeline has two steps: `fetch-pr-diff` (succeeded) and `analyze-diff` (running, highlighted amber). → `run-detail.tsx:202-205` sets `isActive=true` for `running`; the "Refreshing every 2s" annotation appears at `238-241`; `StepRow` at `109` applies amber background for the active step.
2. Between 11:02 and 11:09 AM she watches events appear in the event log in near-real time as the SWR hook refetches every 2 seconds. The last event she sees is `agent-loop.step.started` for `analyze-diff` at 11:08:52 AM.
3. At 11:09 AM the sandbox hangs. No new events appear in the event log. The page continues to refresh every 2s and shows the same state — status `running`, step `analyze-diff` still amber. From Ariel's perspective the run looks active. She cannot distinguish a healthy long-running step from a frozen sandbox.
4. At 11:15:07 AM the Vercel cron (or external scheduler) calls `GET /api/agent-loops/sweep`. The sweep queries for `queued/running` runs with no event activity since `(now - 15 minutes)` using an ISO-string-bound cutoff (`store.ts:1255`). The `analyze-diff` run's last event was 6 minutes and 7 seconds ago — wait, actually it was at 11:08:52, meaning as of 11:15 it has been only ~6 minutes. The sweep threshold is 15 minutes. The run is NOT stalled yet. → The sweep correctly skips it. Ariel's page continues showing `running`.
5. At 11:24 AM the sweep fires again. Now the run's last event is 15 minutes and 8 seconds old. `findStalledLoopRunCandidates` returns this run. The sweep issues `conditionallyTransitionRunStatus` with `toStatus: "stalled"`, writes the `agent-loop.run.stalled` warn event, and writes the `agent-loop.sweep.completed` info event. The API response returns `{"stalledCount":1,"checkedCount":1}` to the cron caller. → `sweep.ts:39-126`. No webhook, push notification, or UI alert is sent to Ariel.
6. On Ariel's browser, the SWR hook's next 2-second fetch (at 11:24:XX AM) returns the now-stalled run detail. The client calls `computeLoopRunRefreshInterval("stalled")` which returns `0`. The SWR interval is set to `0` — polling stops. The page transitions from amber `running` (live) to grey `stalled` (static). The "Refreshing every 2s" annotation disappears. From Ariel's perspective the page simply went cold. There is no transition animation, no toast, no alert.
7. Ariel reads the error banner: `stall_sweep — Run stalled: no event for 15 minutes`. She scrolls to the event log and sees the `agent-loop.run.stalled` event with level `warn` and the payload showing `lastEventAgeMs: 915000` (15 minutes 15 seconds), `thresholdMinutes: 15`, `lastEventName: "agent-loop.step.started"`. This is the most detailed diagnostic available.
8. She clicks Retry. A toast confirms success. The page does not self-refresh (no `onActionComplete` wired, `run-detail.tsx:281`). She reloads manually and sees the run is back in `running` with `Steps: 3` — the new attempt for `analyze-diff` was created and dispatched.

### Variations
- **Sweep fires once before the threshold**: If a separate cron tick fires at 11:20 AM, 11 minutes after the last event, the run is not yet stalled. `findStalledLoopRunCandidates` excludes it. The sweep response shows `{"stalledCount":0,"checkedCount":0}`. Ariel's page continues polling with no change.
- **Ariel navigates away and returns**: If she navigates to `/loops` and back during the stall window, the page re-renders from server-side initial data. On her return visit after the sweep, the run already shows `stalled` and polling never starts (initial status is terminal).
- **Multiple stalled runs in one sweep**: If two other loops also have runs that crossed the threshold simultaneously, the sweep marks all of them in the same invocation. The sweep.completed event is written against only the first stalled run's ID (`sweep.ts:109`). The other stalled runs only get `agent-loop.run.stalled` events. There is no global sweep log.

### Edge Cases
- **Cron cadence vs. threshold**: The sweep fires every N minutes (operator-configured). If the cron fires every 5 minutes and the threshold is 15 minutes, a run that stalls will be caught within 5 minutes after crossing the 15-minute mark (i.e., between 15 and 20 minutes of silence). The maximum undetected stall time equals `threshold + cron_interval`.
- **Browser tab is suspended**: If Ariel's laptop sleeps during the stall window, the SWR hook pauses. When she opens the lid, SWR resumes fetching and immediately gets the `stalled` response. The page snaps to `stalled` with no transition.
- **Sweep endpoint misconfigured (500)**: If `CRON_SECRET` rotated and the sweep starts returning 401, no runs are ever marked `stalled`. Ariel's page polls every 2s indefinitely, showing `running` forever. The user-visible sign of this operator-level failure is a perpetually-active run that never completes.

### UX Friction Observed
- `use-loop-run-polling.ts:47-51` — When polling stops because status becomes `stalled`, there is no in-page notification. Users watching live are silently dropped from a live view to a static snapshot. A toast or status banner when the run transitions to terminal would close this gap.
- `run-detail.tsx:238-241` — The "Refreshing every 2s" annotation appears only when `isActive`. Its disappearance when the run stalls is the only indirect signal to the user that live updates stopped.
- `run-detail.tsx:281` — `onActionComplete` is not passed to `RunActions`. After Retry, the user must manually reload.
- `sweep.ts:96-104` — Sweep completion on zero-stall sweeps is only logged to `console.info`. There is no observable record that the sweep is running at all from the user's perspective, even for operators inspecting the events table.

---

## STORY-006: The Operator Diagnosing a Stall-Sweep Outage
**Type**: medium
**Persona**: Jordan, a platform engineer who observes that several loop runs have been sitting in `running` status for hours. Users are filing support tickets.
**Goal**: Diagnose and fix the stall sweep so that old stalled runs are recovered and future stalls are detected within the threshold window
**Preconditions**: The `CRON_SECRET` env var was accidentally cleared in a Vercel environment variable update three days ago. All loop runs that entered a bad state in those three days are stuck in `running`. There are 14 such runs across 6 loops.

### Steps
1. Jordan opens several run-detail pages. Each shows amber `running` status, "Refreshing every 2s," and an event log that ends 3+ days ago. The step timelines show one step in `running` with no `finishedAt`. This is the first visual signal that something is wrong at the system level, not the loop level.
2. Jordan calls `GET /api/agent-loops/sweep` with the expected Bearer token from his terminal. He receives `{"error":"Unauthorized"}` with HTTP 401. → `route.ts:37-39`: `isAuthorized` returns false when the secret is empty (the env var was cleared). Actually, `route.ts:28-34` would first check `getBackgroundAgentsCronSecret()` — if the secret is empty/null, it returns HTTP 500 with the "CRON_SECRET or BACKGROUND_AGENTS_CRON_SECRET is not configured" error.
3. Jordan diagnoses the missing env var, restores `CRON_SECRET` in Vercel, and redeploys. He then calls the sweep endpoint manually. He receives `{"stalledCount":14,"checkedCount":14}` immediately.
4. Jordan refreshes several run-detail pages. All 14 runs now show grey `stalled` with the error banner `stall_sweep — Run stalled: no event for [X] minutes` where X ranges from 4300 to 5800 minutes (3-4 days). → The `lastEventAgeMs` in the event payload reflects actual elapsed time at sweep execution.
5. Jordan checks whether normal Vercel cron invocations had been failing. He looks in Vercel's cron logs. The logs show the sweep cron (if it was configured in `vercel.json`) had been returning 500 on every tick for three days. Alternatively, if the sweep was not in `vercel.json`, the background-agents cron at `/api/background-agents/cron` would not have triggered the loop sweep at all — because the two systems are separate.
6. Jordan runs a database query to verify all 14 runs show `stalled` and no `running` runs remain. He then notifies affected users to retry or inspect their loops manually.

### Variations
- **Partial recovery**: If some runs had been cancelled manually by users during the three-day outage, the sweep's conditional transition skips them (0 rows updated). They remain in their final `cancelled` state — which is correct.

### Edge Cases
- **Sweep called while no runs exist**: The endpoint correctly returns `{"stalledCount":0,"checkedCount":0}` without error. Useful for health-checking that the sweep is wired up correctly.
- **14 runs swept in one call**: The sweep processes candidates sequentially in a loop (`sweep.ts:48-81`). For 14 candidates this is fast, but at scale (hundreds of stalled runs) the sequential processing could cause the endpoint to time out on serverless.

### UX Friction Observed
- `sweep.ts:96-104` — Sweep invocations on zero-stall sweeps write only to `console.info`. With no persistent sweep audit log, Jordan cannot easily determine when the sweep last ran successfully or how many sweeps occurred between `CRON_SECRET` being cleared and restored.
- `apps/web/vercel.json:3-7` — The sweep endpoint is not in `vercel.json`. If Jordan inherits this deployment from another engineer, the absence of a sweep cron is not self-evident. The feature appears fully functional but silently lacks its recovery mechanism.
- `route.ts:28-34` — The 500 "CRON_SECRET not configured" error is returned to the cron caller, but there is no in-app user-visible signal that the sweep is broken. Users only notice it through stale `running` runs accumulating over time.

---

## STORY-007: The Multi-Run Sweep and Reading the Event Log
**Type**: short
**Persona**: Sam, a developer debugging a flaky loop. She wants to understand the sweep's event log entries and correlate them with run history.
**Goal**: Understand which events in the event log came from the sweep vs. normal run execution
**Preconditions**: Sam is on a run-detail page for a stalled run. The event log shows 12 events. She is trying to find the sweep-related events.

### Steps
1. Sam scrolls through the event log on the run-detail page. Each row shows the event summary (or `eventName` if no summary), `level` (info/warn/error), timestamp, and correlation IDs. She sees most events have level `info`. Two events stand out: one with level `warn` and summary "Run stalled: no event for 18 minutes" and one with level `info` and summary "Sweep completed: 1 stalled, 1 checked." → `run-detail.tsx:161-189` renders each `EventRow`. The level is rendered as a small text label (`event.level`). Events are sorted by `createdAt` ascending (server returns them in insertion order).
2. Sam clicks on the `agent-loop.run.stalled` row's details (there are no click-through details — the event log is read-only). She reads the `eventName` field in small font beneath the summary. She notes the event is tied to the run's `loopRunId` and the payload (not rendered in the UI — she would need API access) contains `lastEventAgeMs` and `lastEventName`.
3. Sam notices the `agent-loop.sweep.completed` event also appears in her run's event log. She is confused — why does a system-wide sweep event appear in her specific run's log? → `sweep.ts:108-123`: the sweep.completed event is written against the first stalled run's ID (the FK constraint requires a valid `loopRunId`). This is a schema constraint workaround, not a meaningful attachment to her run. There is no indication in the UI that this event is system-level, not run-specific.
4. Sam wants to know if the sweep has run multiple times against this run. She counts one `agent-loop.run.stalled` event and one `agent-loop.sweep.completed` event — and concludes the sweep ran once. This is correct (re-sweeping a stalled run is idempotent — it's already terminal so `findStalledLoopRunCandidates` excludes it in subsequent sweeps, `sweep.regression.test.ts:REG-SW-01`).

### Variations
- **Run that was swept multiple times before fix**: Before the conditional transition guard was added, a bug could emit multiple `stalled` events for the same run. The regression test `REG-SW-02` prevents this from recurring.

### Edge Cases
- **`agent-loop.sweep.completed` missing from a stalled run's log**: If the stalled run was not the first candidate (i.e., another run was processed first and won the sweep.completed attachment), Sam's run will have `agent-loop.run.stalled` but no `agent-loop.sweep.completed`. This is inconsistent across stalled runs and can confuse operators trying to correlate sweep invocations with individual runs.

### UX Friction Observed
- `run-detail.tsx:161-189` — Event payload is not rendered. Users can see the summary and level but not the raw data (e.g., `lastEventAgeMs`, `thresholdMinutes`). Diagnosing a stall requires either API access or knowledge that the payload exists.
- `sweep.ts:108-123` — The `sweep.completed` event is attached to a run's event log as a schema workaround. From the UI this looks like a run-level event when it is actually a system-level event. No visual distinction is made.
- `run-detail.tsx:325-338` — The event log is a flat ordered list with no grouping, filtering, or search. For runs with many events (up to 200), finding the `agent-loop.run.stalled` event requires manual scrolling.
