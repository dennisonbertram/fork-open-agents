# UX Stories: Manual vs. Trigger-Driven Runs

**Topic**: How a loop run actually starts — "Run now" vs. automatic trigger dispatch.
**Source**: [`docs/ux-paths/discovery.md`](../discovery.md)
**Code surfaces**: `loop-detail.tsx`, `runs/route.ts`, `dispatcher-bridge.ts`, `store.ts`, `schema.ts`, `background-agents/dispatcher.ts`

---

## STORY-001: First Manual Run on a Freshly Activated Loop

**Type**: short
**Persona**: Priya, a platform engineer who just finished writing a PR-review loop definition and wants to see it execute once before wiring up any triggers.
**Goal**: Fire a single manual run to confirm the loop starts and reaches the first agent step.
**Preconditions**: Loop `pr-review-bot` exists, `status = active`, repo `acme/api` is in the allowlist, no prior runs.

### Steps

1. Priya navigates to `/loops` → sees `pr-review-bot` with a green `active` pill → clicks the card → arrives at `/loops/[loopId]`. → **Expected**: Detail page loads with loop name, `acme/api` mono subtitle, empty "Run history" section reading "No runs yet. Click 'Run now' to start the first run."

2. She clicks the **Run now** button (top-right, `Play` icon, enabled because `loop.status === "active"`). The button label changes to **Starting…** while `runningNow = true`. → **Expected**: `POST /api/agent-loops/[loopId]/runs` fires; server calls `dispatchManualAgentLoopStart`; ownership check passes; loop is active; no existing active run; `createAgentLoopRun` writes a row with `source = "manual"` and `triggerId = null` (FK-safe override); `createAgentLoopStepRun` creates the start-node step; `start(runAgentLoopStepWorkflow, ...)` enqueues the first workflow step; API returns HTTP 202 `{ runId, created: true }`.

3. Client receives 202, shows `toast.success("Run started")`, and immediately navigates to `/loops/[loopId]/runs/[runId]`. → **Expected**: Run detail page shows status pill `queued` (amber), Source proof-strip card reads `manual`, "Refreshing every 2s" label visible in header.

4. Within 2–5 seconds the first poll from `useLoopRunPolling` returns status `running`. → **Expected**: Status pill turns amber `running`; step timeline shows the start-node step row highlighted.

### Variations

- **Multiple clicks before redirect**: If Priya double-clicks "Run now", the second request arrives while the first is still being processed. The server's `hasActiveRunForLoop` call will find the already-created `queued` run and return `{ skipped: true, reason: "active_run" }` → client renders the amber 409 notice banner instead of navigating a second time.
- **Loop just became active in another tab**: Detail page SWR (`/api/agent-loops/[loopId]`, no `refreshInterval`) does not auto-refresh loop status, so "Run now" remains disabled until the user manually refreshes the page.

### Edge Cases

- **Dispatch failure after run creation**: If `start(runAgentLoopStepWorkflow)` throws, the run row exists with `status = queued` but no workflow is enqueued. The stall-sweep cron will mark it `stalled` after `AGENT_LOOPS_STALL_MINUTES` (default 15 min). Priya sees no in-page error — the 202 still lands and she navigates to the run detail, which shows `queued` for up to 15 minutes before flipping to `stalled`.
- **Repo not in allowlist**: `dispatchManualAgentLoopStart` returns `{ skipped: true, reason: "repo_not_allowed" }` → API returns 403 → client shows `toast.error("This repository is not in the AGENT_LOOPS_ALLOWED_REPOS allowlist.")`. No redirect occurs.

### UX Friction Observed

- The "Source" proof-strip card on the run detail shows the raw value `manual` with no label or human-readable copy (`run-detail.tsx:249`). Users who haven't seen the schema don't know this is an internal enum or what alternatives exist.
- There is no loading skeleton on the run detail page between navigation and the first poll; status shows the server-rendered `queued` but the step timeline says "No steps recorded yet" for up to 2 seconds (`run-detail.tsx:307`, `use-loop-run-polling.ts:11`).

---

## STORY-002: "Run Now" Blocked on a Draft Loop

**Type**: short
**Persona**: Marcus, a new user who just created his first loop via `/loops/new`. He's excited to run it immediately.
**Goal**: Click "Run now" right after creation.
**Preconditions**: Loop `daily-lint-check` exists with `status = draft` (the default on creation per `schema.ts:936`). Marcus has been redirected to `/loops/[loopId]` after form submission.

### Steps

1. Marcus lands on the loop detail page. He sees his loop name and a gray `draft` status pill. He scans for a "Run now" button. → **Expected**: "Run now" button is visible in the header but visually disabled (`disabled` prop set because `loop.status !== "active"`, `loop-detail.tsx:242`).

2. Below the header he notices a muted gray notice box: `Loop must be in active status to run manually.` (`loop-detail.tsx:266-271`). He is confused — he just created the loop, why isn't it active?

3. Marcus locates the "Loop status" sidebar card with a `<Select>` currently showing `Draft`. He opens it and sees options: `Draft`, `Active`, `Paused`, `Archived`. He selects **Active**. → **Expected**: `PATCH /api/agent-loops/[loopId]` fires with `{ status: "active" }`. On success, SWR state mutates optimistically, status pill updates to green `active`, `toast.success("Loop status updated to active")` fires. Notice box disappears. "Run now" becomes enabled.

4. Marcus clicks **Run now**. → Same as STORY-001 Steps 2–4.

### Variations

- **User tries to POST the API directly**: The route handler calls `dispatchManualAgentLoopStart`, which checks `loop.status !== "active"` and returns `{ skipped: true, reason: "loop_inactive" }` → HTTP 409 `{ errorKind: "loop_inactive", message: "Loop must be in 'active' status to start a run. Update the loop status to 'active' first." }`. The client toast fires from the generic 409 branch (`loop-detail.tsx:162`).

### Edge Cases

- **Status update fails mid-flight**: If the PATCH returns a non-OK response, `toast.error` fires and the Select reverts to the previous value via the SWR `mutateLoopData` re-validation path (`loop-detail.tsx:192-209`).
- **User sets status to `paused` instead of `active`**: The "Run now" button stays disabled and the gray notice persists since `paused !== "active"`.

### UX Friction Observed

- Nothing in the loop creation flow (form, success toast, or redirect) warns Marcus that the loop will be created as a `draft` and cannot run yet (`loop-create-form.tsx`, `discovery.md:107`). The `status` field is absent from the create form entirely.
- The gray notice box says `active` in a `<span className="font-mono">` which is correct but the surrounding text ("Loop must be in active status to run manually") doesn't explain _why_ draft exists or what it's for (`loop-detail.tsx:267-270`).

---

## STORY-003: The 409 Active-Run Banner

**Type**: medium
**Persona**: Jordan, a developer who left a long-running loop going on Friday and forgot. On Monday, they want to kick off a fresh manual run for the same loop.
**Goal**: Start a new manual run while one is already in `running` status.
**Preconditions**: Loop `integration-suite` is `active`. Run `run_abc123` has `status = running` (started Friday, still executing). Jordan navigates to `/loops/[loopId]`.

### Steps

1. Jordan opens the loop detail page. The "Run history" section shows `run_abc123` with amber `running` pill (renders every 5s via SWR `refreshInterval: 5000`, `loop-detail.tsx:126`). Duration column shows "Running". Jordan doesn't notice the still-active run. → **Expected**: "Run now" button is enabled (loop is active; it does not disable based on active runs — only the API enforces that).

2. Jordan clicks **Run now**. The button shows "Starting…". → **Expected**: `POST /api/agent-loops/[loopId]/runs` fires. Server: `dispatchManualAgentLoopStart` → `hasActiveRunForLoop` finds `run_abc123` in `queued|running|paused` → returns `{ skipped: true, reason: "active_run", activeRunId: "run_abc123" }`. API returns HTTP 409 `{ errorKind: "active_run", message: "...", activeRunId: "run_abc123" }`.

3. Client receives 409. Branch: `body.errorKind === "active_run"` → `setActiveRunNotice("run_abc123")`. No toast error is shown — the UI opts for a persistent notice instead (`loop-detail.tsx:146-161`).

4. An amber notice renders below the header: `This loop already has an active or paused run: run_abc123. Wait for it to complete, resume, or cancel it before starting a new run.` The run ID is a clickable monospace link. → **Expected**: Clicking the link navigates to `/loops/[loopId]/runs/run_abc123`.

5. Jordan follows the link to the run detail page. They see "Loop run" header with amber `running` pill and the step timeline showing the current node highlighted. Run Actions shows **Pause** and **Cancel run** buttons.

6. Jordan decides to cancel. Clicks **Cancel run**. A dialog opens: `"Cancel run? The current step will finish or be abandoned at its boundary. This action cannot be undone."` Jordan clicks **Cancel run** in the dialog. → **Expected**: `POST /api/agent-loop-runs/run_abc123/cancel` fires. On success: `toast.success("Cancel successful")`. Run status transitions to `cancelled`.

7. Jordan navigates back to the loop detail via the back-link `← integration-suite`. The active-run notice is gone (it was local state, cleared on page navigation). "Run now" is enabled. Jordan clicks it again — this time the 409 does not fire and a new run is created.

### Variations

- **Active run is paused, not running**: `hasActiveRunForLoop` includes `paused` status (`store.ts:293-295`). The 409 still fires. The banner says "active or paused run". Jordan must resume or cancel the paused run before starting a new one.
- **Active run ID unavailable from API**: Client falls back to scanning the local SWR runs list (`runs.find(r => r.status === "running" || r.status === "queued" || r.status === "paused")`) and renders that ID in the notice, or `"unknown"` if no match found (`loop-detail.tsx:152-159`).
- **activeRunNotice persists across subsequent successful runs**: `setActiveRunNotice` is only reset at the top of `handleRunNow`. If Jordan successfully starts a run on attempt 2 (no 409), the notice is cleared because `setActiveRunNotice(null)` runs before the fetch (`loop-detail.tsx:134`).

### Edge Cases

- **Race window**: Between `hasActiveRunForLoop` returning null and `createAgentLoopRun` writing the new row, two concurrent "Run now" clicks could both pass the active-run gate. The idempotency key constraint (`agent_loop_runs_idempotency_idx`, unique, `schema.ts:1323`) will cause the second insert to fail at the DB layer. This is a silent gap — no 409 is returned for the second request, but no second run is created either.
- **Status flip between list load and Run now click**: If `run_abc123` completes between the 5s poll and Jordan's click, the API will start a fresh run normally (no 409). The prior amber run in the list will show `completed` on the next poll.

### UX Friction Observed

- "Run now" is enabled even when an active run exists — there is no pre-emptive visual cue (disabled state, badge, or inline count) on the button itself indicating "a run is already live" (`loop-detail.tsx:242`). The 409 only surfaces after a click.
- The active-run notice is local component state (`useState`) and disappears on navigation. If Jordan opened the notice, went back to `/loops`, and returned, the notice is gone and "Run now" appears clickable again — they could trigger another 409.
- The amber notice text says "active or paused run" but the UX doesn't distinguish between those two cases or indicate what the appropriate action is for each (cancel vs. resume).

---

## STORY-004: Understanding Source in the Run History Table

**Type**: short
**Persona**: Aisha, a DevOps engineer who set up both a manual run and a cron trigger for the same loop. She's reviewing the run history to understand which runs were triggered automatically vs. by hand.
**Goal**: Distinguish manual runs from cron-triggered runs in the run history list.
**Preconditions**: Loop `nightly-dependency-check` has `status = active`. Run history contains: `run_001` (source = `manual`), `run_002` (source = `schedule`), `run_003` (source = `github`).

### Steps

1. Aisha opens `/loops/[loopId]`. The "Run history" section shows three run rows, each with a truncated monospace run ID, a status pill, a date, and a duration. She notices a plain text column between the status pill and the date. → **Expected**: The third column renders `run.source` verbatim: `manual`, `schedule`, `github` (`loop-detail.tsx:95`). No label, no icon, no formatting.

2. Aisha looks at `run_002` — it says `schedule`. She wants to know which cron trigger fired it and when. She clicks the row to navigate to `/loops/[loopId]/runs/run_002`. → **Expected**: Run detail proof strip shows `Source: schedule`. No trigger name or schedule string is displayed. Correlation IDs section shows `Trigger ID: -` (null, because `triggerId` is stored but not surfaced directly in the proof strip — `run-detail.tsx:348-362` lists Loop Run ID, Loop ID, Workflow Run ID, Request ID, Idempotency Key; `triggerId` is absent).

3. Aisha scans the event log for context. The first event reads: `Received schedule.cron trigger` (from `recordAgentLoopEvent` call in `dispatcher-bridge.ts:197`). The payload field is not expanded by default. → **Expected**: The event summary is visible; payload (loopId, triggerId, triggerKind, source, externalId) requires clicking through `<details>` if the event row renders expandable output, but the current `EventRow` component has no expand affordance for the payload (`run-detail.tsx:162-189`).

4. Aisha gives up on finding the trigger name from the run detail. She navigates to `/settings/background-agents` to look at the trigger list. → **Expected**: She must manually cross-reference trigger rows there against the loop she was viewing, with no deep-link from the run back to the specific trigger.

### Edge Cases

- **Manual run has idempotency key shaped as `[loopId]:manual:[requestId]`**: This is visible in the Correlation IDs section as "Idempotency Key: `abc123:manual:d8f3a...`". Aisha can infer it was manual from this, but has to know the key structure to read it (`dispatcher-bridge.ts:398`).

### UX Friction Observed

- `run.source` is rendered as the raw enum value (`github|schedule|webhook|manual`) without a human label or icon (`loop-detail.tsx:95`, `discovery.md` pain point 6).
- The `triggerId` FK is stored on the run row (`schema.ts:1305`) but is not surfaced anywhere in the run detail UI. Users cannot click from a run to the trigger that fired it.
- Trigger event payloads (loopId, triggerId, triggerKind) are buried in event log entries with no expandable UI in `EventRow` (`run-detail.tsx:162-189`).

---

## STORY-005: Discovering and Verifying a Wired Cron Trigger

**Type**: medium
**Persona**: Sam, a tech lead who configured a `schedule.cron` trigger in Background agents settings last week and wants to confirm it's actually wired to the right loop and will fire automatically.
**Goal**: Verify from the loop detail that a cron trigger is attached, active, and understand what schedule it runs on.
**Preconditions**: A `backgroundAgentTriggers` row exists with `kind = schedule.cron`, `schedule = "0 2 * * *"`, `status = enabled`, `loopId = [loopId]`. Loop is `active`.

### Steps

1. Sam navigates to `/loops/[loopId]`. In the right sidebar, the "Triggers" section lists one trigger: `schedule.cron` with a green `enabled` status pill and below it the schedule string `0 2 * * *` in 10px mono font. → **Expected**: The trigger card renders `trigger.kind` as plain text (`schedule.cron`) and `trigger.schedule` as mono text (`loop-detail.tsx:354-366`).

2. Sam wants to understand when `0 2 * * *` fires. There is no human-readable description ("every day at 2 AM") — just the raw cron expression. Sam has to interpret it manually or open a separate cron explainer tool. → **Friction**: No cron-to-English translation anywhere in the UI.

3. Sam wants to confirm that when the cron fires, the run will actually start. He clicks the trigger row hoping to navigate to details. → **Expected**: There is no click handler on trigger rows — they are static `<div>` elements (`loop-detail.tsx:354`). Sam cannot navigate to the trigger's settings page from here.

4. Sam clicks the "Background agents settings" link in the Triggers section (visible when triggers _are_ present? — actually the link only appears in the empty-triggers state, `loop-detail.tsx:343-349`). In the non-empty state, no offsite link is rendered. Sam must navigate to `/settings/background-agents` manually. → **Expected**: Sam finds the trigger in the background-agents settings list, confirms it is enabled and pointing to the loop.

5. On the next day Sam opens the loop detail at 2:05 AM. A new run appears in "Run history" with `source = schedule` and a `queued` or `running` status. This confirms the trigger fired. → **Expected**: The source column shows `schedule` (raw value). The triggered run's entry in the event log contains `"Received schedule.cron trigger"` in the summary.

### Variations

- **Trigger is disabled**: The "Triggers" sidebar card shows `disabled` status pill (gray). If the cron fires, `dispatchLoopRunForTrigger` still runs but `loop.status === "active"` passes — the trigger's own `status` field is evaluated by the background-agents matcher upstream, not by the dispatcher bridge itself. A disabled trigger is excluded by `listMatchingTriggersForEvent` before the dispatcher is called.
- **Loop is paused when cron fires**: `dispatchLoopRunForTrigger` reaches Gate 3 (`loop.status !== "active"`) and returns `{ skipped: true, reason: "loop_inactive" }`. No run is created. The trigger's `lastSkipReason` column is updated by the dispatcher. Sam sees no new run in the history.

### Edge Cases

- **Multiple triggers on the same loop**: The sidebar renders all of them as a stacked list. If two triggers fire simultaneously (unlikely but possible with multiple event kinds), the second dispatch attempt will hit the `hasActiveRunForLoop` gate and be skipped, logging a `agent-loop.trigger.skipped_active_run` event against the first run (`dispatcher-bridge.ts:140-157`).

### UX Friction Observed

- Cron expressions are shown verbatim with no human-readable description (`loop-detail.tsx:360`). A `0 2 * * *` looks the same as `*/5 * * * *` to non-experts.
- The "Manage triggers in Background agents settings" link is shown only in the empty-triggers state. Once a trigger is wired, this offsite escape hatch disappears — Sam must know the URL `/settings/background-agents` to navigate there (`loop-detail.tsx:342-349`).
- Trigger rows are not clickable and have no "Edit" affordance. There is no way to edit or remove a trigger from the loop detail page.

---

## STORY-006: Confusion When a Trigger Fires But No New Run Appears

**Type**: long
**Persona**: Tomas, a backend engineer who configured a `github.pull_request` trigger on his `code-quality-gate` loop and has opened a PR on `acme/api`. He expects a run to appear in the loop history. It doesn't.
**Goal**: Understand why no run was created after the GitHub PR event.
**Preconditions**: `code-quality-gate` loop has `status = active`. A `backgroundAgentTriggers` row exists with `kind = github.pull_request`, `loopId = [loopId]`, `status = enabled`. A previous run `run_prev` has `status = running` (a lingering run from an earlier PR that hasn't finished). The GitHub webhook fires a `pull_request.opened` event for a new PR.

### Steps

1. Tomas opens a new PR on GitHub. He navigates to `/loops/[loopId]` expecting a new run to appear. → **Expected from Tomas's mental model**: A `github`-sourced run should appear in the history within seconds.

2. The run history shows only the old `run_prev` with `running` status (refreshed every 5s). No new run appears. Tomas waits 30 seconds. Still nothing. → **Actual**: The background-agents dispatcher received the webhook, called `dispatchLoopRunForTrigger`, reached the `hasActiveRunForLoop` gate, found `run_prev`, and returned `{ skipped: true, reason: "active_run" }`. An event `agent-loop.trigger.skipped_active_run` was written against `run_prev`'s event log (`dispatcher-bridge.ts:140-157`). No new run was created.

3. Tomas clicks on `run_prev` to inspect it. He's looking for clues. → **Expected**: Run detail shows `status = running`. Step timeline shows a step that has been running for 47 minutes. In the event log he sees: `Trigger skipped: loop [loopId] already has an active run` with `eventName = agent-loop.trigger.skipped_active_run`. But the event log's `EventRow` component shows only `event.summary ?? event.eventName` as the primary label and does not expand the payload — Tomas can see the summary text but not the full skip payload.

4. Tomas now understands the loop has a zombie run blocking new triggers. He clicks **Cancel run** on `run_prev`. Dialog: "The current step will finish or be abandoned at its boundary." → He confirms. `POST /api/agent-loop-runs/run_prev/cancel` fires. Status transitions to `cancelled`. → **Expected**: `toast.success("Cancel successful")`. Run detail status pill updates to gray `cancelled` on next poll.

5. Tomas navigates back to the loop detail. He opens a new PR to retrigger the webhook (or waits for the GitHub App to replay — it won't, webhooks are not replayed automatically). → **Actual friction**: The blocked webhook event was not queued. Tomas must manually trigger the workflow or push a new PR event. If he wants immediate execution, he can use "Run now" (manual) instead.

6. Tomas clicks **Run now** to manually start the run that the trigger couldn't. A manual run is created (`source = "manual"`, `triggerId = null`). → The run proceeds. Source in run history shows `manual`, not `github`.

### Variations

- **Run is stalled (not running)**: The `queued`/`running` run that blocked the trigger is actually stalled — the stall sweep just hasn't run yet. The skip fires against a zombie run. Until the sweep marks it `stalled` (terminal), no new trigger-dispatched runs can start. Tomas has to wait for the sweep cycle (up to 15 minutes default) or manually cancel the stalled-looking run.
- **User pauses the loop**: Setting loop `status = paused` blocks new runs at Gate 3 in `dispatchLoopRunForTrigger`. In-progress runs continue. Tomas correctly sees "No new run" but the cause is different (loop inactive vs. active-run conflict).

### Edge Cases

- **Webhook replay**: GitHub may retry a failed webhook delivery. If the retry arrives after `run_prev` is cancelled, the dispatcher will create a new run from the retried event. Tomas might see a `github`-sourced run appear minutes later without an obvious cause.
- **Concurrent same-loop triggers**: If two PR events fire within the same second, both pass `hasActiveRunForLoop` before either `createAgentLoopRun` writes. The unique idempotency key constraint (`agent_loop_runs_idempotency_idx`) will cause one insert to fail silently at the DB. Only one run is created.

### UX Friction Observed

- The event log entry `agent-loop.trigger.skipped_active_run` appears against the existing run — not on any new run (since none was created). Tomas must know to look inside the old run's event log to find the skip reason. There is no notification on the loop detail page itself that a trigger was suppressed (`loop-detail.tsx` has no skip-event surface).
- Event payload expansion is not implemented in `EventRow` (`run-detail.tsx:161-189`). The skip payload (loopId, triggerId, source, externalId) is invisible without direct DB access.
- The single-active-run rule is not explained anywhere in the UI. Documentation of this constraint is confined to code comments (`dispatcher-bridge.ts:134`).

---

## STORY-007: Idempotency — What Happens if "Run Now" Is Clicked Twice in Quick Succession

**Type**: short
**Persona**: Kezia, a developer who clicks "Run now" and, seeing a brief loading state, clicks it again because she's not sure the first click registered.
**Goal**: Understand the system's behavior under double-click / retry conditions.
**Preconditions**: Loop `data-sync` is `active`, no active runs. Network is slightly slow (1.5s response time).

### Steps

1. Kezia clicks **Run now**. Button becomes "Starting…" (`runningNow = true`). She waits 800ms, worries it didn't work, and clicks again. → **Expected**: The second click fires while `runningNow` is still `true`. However, `runningNow` does not disable the button — only `loop.status !== "active"` does (`loop-detail.tsx:242`). So the second click sends a second `POST /api/agent-loops/[loopId]/runs`.

2. First request lands at the server. `dispatchManualAgentLoopStart` checks `hasActiveRunForLoop` — null. Generates `manualKey = "[loopId]:manual:[requestId1]"`. `createAgentLoopRun` succeeds (new row, `idempotencyKey = manualKey`, `created: true`). Dispatches step. Returns 202 `{ runId: "run_new" }`.

3. Second request lands. `dispatchManualAgentLoopStart` checks `hasActiveRunForLoop` — finds `run_new` in `queued` status. Returns `{ skipped: true, reason: "active_run", activeRunId: "run_new" }`. API returns HTTP 409.

4. First response arrives first (202): `toast.success("Run started")`, navigate to `/loops/[loopId]/runs/run_new`.

5. Second response arrives (409): client is now on the run detail page. The 409 handler in `handleRunNow` (`loop-detail.tsx:140-164`) would set `activeRunNotice`, but Kezia has already navigated away — the state update is a no-op on the unmounted component.

   → **Net result**: One run, one toast, correct navigation. The double-click was harmless.

### Variations

- **Both requests arrive before either `createAgentLoopRun` commits**: Extremely rare race. Both `hasActiveRunForLoop` calls return null. Both attempts call `createAgentLoopRun`. Each generates a unique `requestId` → unique `manualKey`. Both inserts succeed with different idempotency keys → two runs are created. (`dispatcher-bridge.ts:398` — manual idempotency key uses `requestId`, not a stable per-user-per-loop key.) The user sees two runs in the history.
- **Same `requestId` across requests (retry-safe path)**: The API route generates `requestId = crypto.randomUUID()` fresh per request (`runs/route.ts:33`), so idempotency keys differ between the two requests. This is by design (`dispatcher-bridge.ts:396`: "does not deduplicate across separate user clicks — intentional for manual start").

### Edge Cases

- **`runningNow = true` does not disable the button**: This is a subtle gap. The button is only disabled for `loop.status !== "active"`, not for "currently submitting" (`loop-detail.tsx:242`). A slow network makes the window wide.

### UX Friction Observed

- "Run now" button is not disabled during the in-flight request (`runningNow` does not appear in the `disabled` prop, `loop-detail.tsx:242`). Only the label changes to "Starting…". Under a slow network, users can fire multiple requests (`loop-detail.tsx:241-243`).

---

## STORY-008: A Loop Paused at the Loop Level — Trigger Fires, Nothing Happens

**Type**: medium
**Persona**: Dana, a team lead who set her loop `status = paused` on a Friday afternoon to prevent any automated runs over the weekend. A cron trigger fires Saturday night anyway. She checks Sunday morning.
**Goal**: Understand why no run appeared in history over the weekend despite a cron trigger being wired.
**Preconditions**: Loop `weekend-freeze` has `status = paused`. `backgroundAgentTriggers` row with `kind = schedule.cron`, `schedule = "0 22 * * 6"` (every Saturday at 10 PM), `status = enabled`, `loopId = [loopId]`. No active runs.

### Steps

1. Saturday at 10 PM: the cron fires. Background-agents dispatcher calls `dispatchLoopRunForTrigger`. Gate 3: `loop.status !== "active"` is true (status is `paused`) → `return { skipped: true, reason: "loop_inactive" }`. No run created.

2. Sunday morning Dana opens `/loops/[loopId]`. → **Expected**: Run history shows no new runs since Friday. Loop status sidebar shows `paused`.

3. Dana looks in the Triggers sidebar — the cron trigger shows `enabled` status pill and `0 22 * * 6` schedule. She expects to see some indicator that the trigger fired but was suppressed. → **Actual**: Nothing in the loop detail indicates a suppressed trigger. The trigger's `lastSkipReason` field in `backgroundAgentTriggers` was updated by the upstream dispatcher caller, but this field is not surfaced in the Triggers sidebar (`loop-detail.tsx:354-366`).

4. Dana checks the "Run history" — no entries from Saturday night. She incorrectly concludes the cron didn't fire, rather than understanding it fired and was gated. → **Friction**: No skip-event was written against any loop run (no loop run was created to write against). The skip is invisible in the loop's UI.

5. Dana sets the loop status back to `active` via the sidebar Select. Next Saturday the cron will fire and create a run normally.

### Variations

- **Loop-level `paused` vs. run-level `paused`**: A loop with `status = paused` blocks new runs entirely. An individual run with `status = paused` is an in-progress run that has been suspended mid-execution — triggers check the loop-level status, not run-level. These two "paused" concepts share the same word but mean different things.
- **"Run now" while loop is paused**: The button is disabled (same as draft). The gray notice reads "Loop must be in active status to run manually." Dana can still manually re-activate via the status Select.

### Edge Cases

- **Trigger `status = disabled` vs. loop `status = paused`**: Two separate layers of suppression. A disabled trigger is excluded before the dispatcher call; a paused loop is gated inside the dispatcher. Both result in no run, but for different reasons.
- **User sets loop to `archived`**: Status transitions to `archived` → triggers still exist in DB but the loop gate (`loop.status !== "active"`) blocks all dispatch. Archived loops cannot be re-activated via the UI Select (the option is present in the dropdown — `loop-detail.tsx:329` — so re-activation is technically possible but not blocked).

### UX Friction Observed

- No "last trigger fired / skipped" timestamp or indicator in the Triggers sidebar. Dana cannot see that the Saturday cron fired at all (`loop-detail.tsx:354-366` renders only `kind`, `status`, and `schedule`).
- The word "paused" on the loop-status Select means "block new runs" but on a run-status pill it means "execution suspended mid-run." No UI copy disambiguates these (`loop-detail.tsx:316-332`).
- The discovery doc (`discovery.md:75`) notes "Loop-level `paused` blocks new runs; does NOT pause an in-progress run" — this distinction is not explained in the UI.

---

## STORY-009: Navigating from a Trigger-Fired Run Back to the Trigger

**Type**: long
**Persona**: Riya, a DevOps lead investigating an incident where a PR-triggered run failed. She wants to trace back from the run to the exact trigger that fired it, check its conditions, and understand why the trigger matched.
**Goal**: Navigate from run detail → triggering trigger → trigger conditions.
**Preconditions**: Run `run_gh_42` has `status = failed`, `source = github`, `triggerId = trig_99` (a `github.pull_request` trigger). The run's event log contains `agent-loop.trigger.received` with payload `{ triggerId: "trig_99", triggerKind: "github.pull_request", source: "github", externalId: "pr-event-7821" }`.

### Steps

1. Riya navigates to `/loops/[loopId]/runs/run_gh_42`. The proof strip shows: `Status: failed`, `Source: github`. She wants to find trigger details. → **Expected**: No "Trigger" proof-strip card exists. `triggerId` is stored on the run (`schema.ts:1305`) but not surfaced in the proof strip (`run-detail.tsx:247-278`).

2. Riya scrolls to the "Correlation IDs" section. It lists: Loop Run ID, Loop ID, Workflow Run ID, Request ID, Idempotency Key. `triggerId` is absent (`run-detail.tsx:348-362`).

3. Riya scrolls to the event log. She finds an entry with summary `Received github.pull_request trigger` and `eventName = agent-loop.trigger.received`. She wants to expand the payload to see `triggerId` and `externalId`. → **Actual**: `EventRow` renders the summary and metadata (level, timestamp, workflowRunId, requestId, redactionStatus) but has no expandable payload section (`run-detail.tsx:161-189`). The trigger ID is not surfaced.

4. Riya navigates to `/settings/background-agents`. She finds the trigger list and locates the `github.pull_request` trigger by kind, but cannot match it to `trig_99` without seeing the trigger ID on either the run or the trigger list row.

5. Riya resigns to filing a support request or querying the database directly. There is no UI path from a specific run to the specific trigger that fired it.

### Variations

- **Manual run**: `triggerId = null` (`dispatcher-bridge.ts:427`). Correlation IDs section shows `Trigger ID: -`. Riya knows immediately it was manually started (if `source = manual` is readable in the proof strip).
- **Idempotency key as breadcrumb**: For trigger-fired runs, the idempotency key is shaped as `[loopId]:[triggerId]:[source]:[kind]:[externalId]` (`dispatcher-bridge.ts:91-97`). Riya could parse `trig_99` from the idempotency key if she knows the key structure. This is not documented in the UI.

### Edge Cases

- **Trigger was deleted after the run**: Because `agent_loop_runs.trigger_id` has `onDelete: "set null"` (`schema.ts:1306`), the `triggerId` on the run becomes `null` if the trigger is deleted. Riya would see no trigger ID even though one existed at run time.
- **Event redaction**: If the trigger event payload was redacted (`redactionStatus` field in `agent_loop_events`), the `triggerId` and `externalId` in the payload are gone. The event row still shows `redaction [status]` in fine print (`run-detail.tsx:185`), but Riya has no way to retrieve the original values.

### UX Friction Observed

- `triggerId` is stored in the DB (`schema.ts:1305`) but never surfaced in the run detail proof strip or Correlation IDs section (`run-detail.tsx:247-278, 348-362`). A direct link from run → trigger is impossible via the current UI.
- Event payload is not expandable in `EventRow` (`run-detail.tsx:161-189`), preventing users from reading `triggerId` from the event log even when it's present and not redacted.
- The idempotency key format encodes the trigger ID, but this is undocumented and unformatted in the UI (`run-detail.tsx:352`). Expert users can decode it; others cannot.
- `source = github` appears without any additional context (PR number, branch, actor) that would help Riya understand which PR event triggered the failing run.
