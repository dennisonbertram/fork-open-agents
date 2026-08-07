# Controlling a Run: Pause / Resume / Cancel / Retry

Agent Loops — UX Story Set
Topic: Run control actions available on the run detail page.

## Quick Reference: Button Availability Rules

| Button | Renders when `status` is… | API call | Source |
|---|---|---|---|
| **Pause** | `running` only | `POST /api/agent-loop-runs/[runId]/pause` | `run-actions.tsx:102` |
| **Resume** | `paused` only | `POST /api/agent-loop-runs/[runId]/resume` | `run-actions.tsx:119` |
| **Cancel run** | `queued`, `running`, or `paused` (any non-terminal) | `POST /api/agent-loop-runs/[runId]/cancel` | `run-actions.tsx:136` |
| **Retry** | `completed`, `failed`, `cancelled`, or `stalled` (any terminal) | `POST /api/agent-loop-runs/[runId]/retry` | `run-actions.tsx:169` |

Server-side, Pause accepts `running` or `queued`; Cancel accepts `running`, `queued`, or `paused`; Resume accepts `paused` only; Retry accepts `failed` or `stalled` only — completed and cancelled runs return 409 `illegal_transition`.
(`store.ts:785`, `store.ts:839`, `store.ts:902`, `store.ts:967–970`)

---

## STORY-001: Pausing a Runaway Agent

**Type**: short
**Persona**: Mira, a platform engineer who triggered a loop manually to test a new "triage PR" playbook against her team's repo.
**Goal**: Stop the run before it exhausts its step budget or touches unintended branches.
**Preconditions**: Run `lrun_8kqz` is in `running` status. Mira is on `/loops/loop_pr_triage/runs/lrun_8kqz`. The page is polling every 2 s.

### Steps

1. Mira notices the "Steps" proof strip reads `38 / 50` — the run is consuming steps faster than expected, and "Current Node" shows `open_pr` when she expected it to stop at `label_pr`. She reaches for the controls. → She sees a **Pause** button (icon: `Pause`, lucide) and a **Cancel run** button side-by-side. No Resume is visible because the run is `running`, not `paused`. (`run-actions.tsx:102`, `run-actions.tsx:136`)

2. Mira clicks **Pause**. The button immediately shows a `Loader2` spinner (animation: `animate-spin`) and is disabled. All other buttons also become disabled (`loading !== null` guard). → After ~300 ms, a `toast.success("Pause successful")` notification slides in from the bottom. The button area momentarily still shows the spinner.

3. The next 2 s polling tick fires. `useLoopRunPolling` fetches the run and gets back `status: "paused"`. → The UI re-renders: Pause disappears, **Resume** appears in its place. **Cancel run** remains. The status pill in the page header changes from amber `running` to gray `paused`. The "Refreshing every 2s" label in the header remains because `paused` is still a non-terminal status. (`use-loop-run-polling.ts:11-12`, `run-detail.tsx:203-205`, `run-actions.tsx:119`)

4. Mira scrolls to the event log. She can see a new entry: event name `agent-loop.run.paused`, summary "Loop run paused (via API)". → She has a timestamped audit trail of her action without needing to inspect the database. (`run-controls.ts:46-53`)

### Variations

- **Queued run, user clicks Pause**: The server `pauseLoopRun` accepts `queued` in its WHERE clause (`store.ts:785`), so the API returns 200. However, the UI never renders a Pause button for `queued` status — only `running` renders Pause (`run-actions.tsx:102`). The server supports a wider set than the UI allows. A user cannot pause a queued run from the UI today.

### Edge Cases

- **Pause while the run is already completing**: Between the button click and the server update, the run transitions to `completed`. The server's conditional UPDATE finds 0 rows (status is no longer `running` or `queued`), re-checks ownership, and throws `RunControlError("illegal_transition")`. The route returns 409. `postControl` throws, and `toast.error("Cannot pause run lrun_8kqz: not in a pausable status (running/queued)")` appears. (`store.ts:803-806`, `map-control-error.ts:25-30`)

### UX Friction Observed

- The cooperative pause takes effect "at the next step boundary" (dialog copy on cancel references this concept, but there is no equivalent tooltip or copy on Pause). Mira has no way to know whether the running step will finish before the pause lands — the UI says nothing. (`run-actions.tsx:102-116`)
- The server accepts `queued` as a pausable status but the UI does not surface a Pause button for `queued` runs. This asymmetry means a queued run that has not yet started cannot be paused from the UI — only cancelled. (`store.ts:785`, `run-actions.tsx:102`)

---

## STORY-002: Resuming After Inspection

**Type**: medium
**Persona**: Mira (same engineer, continuing from STORY-001).
**Goal**: Confirm the run is on the right node, then let it continue.
**Preconditions**: Run `lrun_8kqz` is `paused`. Step count is `38 / 50`. Current Node shows `open_pr`.

### Steps

1. Mira reviews the step timeline. The last step row shows `open_pr` with status `succeeded` and `attempt 1`. She expected the next node to be `label_pr`. She checks the loop definition (not visible on this page — she must navigate to `/loops/loop_pr_triage` to see the JSON). → She opens a new tab to read the definition and confirms `open_pr → label_pr` is correct. Nothing on the run page links to the loop definition. (`run-detail.tsx` has no definition link)

2. Returning to the run page, she clicks **Resume**. The button shows a `Loader2` spinner and disables. → `POST /api/agent-loop-runs/lrun_8kqz/resume` fires. The server calls `storeResumeLoopRun`, transitions status to `running`, and then attempts to re-dispatch `currentStepRunId` via `start(runAgentLoopStepWorkflow, ...)`. (`run-controls.ts:84-128`)

3. `toast.success("Resume successful")` appears. The next poll tick (2 s) returns `status: "running"` and a new current node. → The Run Actions area re-renders: **Pause** and **Cancel run** are back; **Resume** is gone.

4. Mira watches the step timeline. A new row appears for `label_pr` with status `running` highlighted in amber background (`isActive` check). → The event log also adds `agent-loop.run.resumed` and `agent-loop.chain.dispatched`. (`run-controls.ts:101-112`)

### Variations

- **Resume when `currentStepRunId` is absent**: If the run was paused in a state where `currentStepRunId` is null, `storeResumeLoopRun` still transitions to `running` but the re-dispatch block is skipped (`run.currentStepRunId` falsy check). The run status becomes `running` but no step is dispatched, leaving the run in a limbo where it looks active but makes no progress. No user-visible warning is emitted. (`run-controls.ts:96`)

### Edge Cases

- **Resume when step is already queued (post-stall advance)**: After a stall sweep, the run may be `paused` with `currentStepRunId` pointing at a `queued` step that was never dispatched. `storeResumeLoopRun` transitions the run to `running`. The re-dispatch fires `start(runAgentLoopStepWorkflow)` for the queued step — the chain picks up from the already-advanced node. No new step run row is created. (`run-controls.ts:97-112`, comment in `store.ts:876-881`)
- **Concurrent Resume + Cancel**: If another session cancels the run while Resume is in-flight, the store UPDATE for resume matches 0 rows (status is no longer `paused`), throws `RunControlError("illegal_transition")`, and the route returns 409. The cancelling session wins. (`store.ts:919-922`)

### UX Friction Observed

- There is no link from the run detail page to the loop's definition JSON to help a user verify what node comes next before resuming. The user must manually navigate to `/loops/[loopId]` and mentally parse the raw JSON DAG. (`run-detail.tsx`: no definition link)
- The "Refreshing every 2s" label in the header persists during `paused` status. A paused run is not actively changing, so polling every 2 s is unnecessary work, but the copy implies activity. (`run-detail.tsx:239`, `use-loop-run-polling.ts:11-12`)

---

## STORY-003: Cancelling a Run with the Confirmation Dialog

**Type**: medium
**Persona**: Dev Ops engineer Kenji who triggered a loop against the wrong repository branch and needs to abort immediately.
**Goal**: Stop the run and move on; does not need it to complete.
**Preconditions**: Run `lrun_zt4r` is `running`. Kenji is on the run detail page. He is confident this is the right run to cancel.

### Steps

1. Kenji clicks **Cancel run** (icon: `XCircle`). Unlike Pause or Resume, clicking this button does not fire an API call immediately. → A modal dialog opens with:
   - Title: **"Cancel run?"**
   - Body: *"The current step will finish or be abandoned at its boundary. This action cannot be undone."*
   - Two buttons: **"Keep running"** (outline variant) and **"Cancel run"** (destructive, red variant).
   (`run-actions.tsx:137-167`)

2. Kenji reads the dialog copy. He notes it says "cannot be undone" but does not say what happens to any in-progress sandbox work. He clicks the red **Cancel run** button. → `DialogClose` fires, closing the dialog. Simultaneously, `handleAction("cancel", "Cancel")` is called.

3. The dialog closes. The **Cancel run** button in the actions strip now shows a `Loader2` spinner and the entire button group is disabled. → `POST /api/agent-loop-runs/lrun_zt4r/cancel` is sent. The server transitions status to `cancelled`, sets `finishedAt`, and records event `agent-loop.run.cancelled`. (`run-controls.ts:61-74`, `store.ts:828-842`)

4. `toast.success("Cancel successful")` appears. On the next 2 s poll tick, the run returns `status: "cancelled"`. → The Run Actions area re-renders completely: Pause, Resume, and Cancel run all disappear. **Retry** appears (terminal status). The status pill changes to gray `cancelled`. Polling stops because `cancelled` is a terminal status. (`run-actions.tsx:30-35, 169-184`, `use-loop-run-polling.ts:12`)

5. Kenji sees the "Duration" proof strip now shows a wall-clock time (the `finishedAt` was set by the cancel). The event log has a final entry: "Loop run cancelled (via API)". → He navigates back with "← [loop name]" link to start a fresh run against the correct branch.

### Variations

- **Clicking "Keep running"**: Closes the dialog via `DialogClose`. No API call is made; the run continues normally. (`run-actions.tsx:153-155`)
- **Cancelling a paused run**: The Cancel dialog renders for `paused` status too (`isNonTerminal` includes `paused`). The store accepts `paused → cancelled`. The UX is identical: dialog → confirm → toast → Retry appears. (`store.ts:839`, `run-actions.tsx:136`)
- **Cancelling a queued run**: Same flow. The run never started executing. (`store.ts:839`)

### Edge Cases

- **Cancel race: run finishes between dialog open and confirm click**: Kenji opens the dialog, the run completes naturally (status becomes `completed`) before he clicks the red button. He clicks "Cancel run". The POST fires, but the store's conditional UPDATE finds 0 rows (status is no longer in `running/queued/paused`). The route returns 409. `toast.error("Cannot cancel run lrun_zt4r: not in a cancellable status (running/queued/paused)")` appears — jarring because Kenji just confirmed a cancel. The run shows `completed` on the next poll. (`store.ts:856-859`, `map-control-error.ts:25-30`)
- **Double-click prevention**: `loading !== null` disables the button immediately on first click. A second rapid click before the spinner renders is theoretically possible in a very fast browser, but the React re-render that sets `loading` happens synchronously in the same event loop turn, so double submission is unlikely. (`run-actions.tsx:66-68, 139`)

### UX Friction Observed

- The dialog says "The current step will finish or be abandoned at its boundary" but does not clarify which case applies. A user has no way to tell whether their sandbox will be killed mid-execution or allowed to drain. (`run-actions.tsx:147-150`)
- After confirming cancel in the dialog, both `DialogClose` and `handleAction` fire — the dialog closes before the API response. If the API returns an error toast, the user no longer sees the dialog context that led to it. (`run-actions.tsx:156-162`)

---

## STORY-004: The Surprising "Retry" — Step-Only, Not Run-Over

**Type**: long
**Persona**: Lucas, a developer who set up a loop to auto-draft GitHub PRs. His first real run failed after step 3 of 8. He expects "Retry" to restart the whole loop from the beginning.
**Goal**: Get the loop to run again from scratch.
**Preconditions**: Run `lrun_9wrp` has `status: "failed"`. `currentNodeId` is `draft_pr`. `currentStepRunId` is `srun_a3b`. The step timeline shows 3 steps: `clone_repo` (succeeded), `run_tests` (succeeded), `draft_pr` (failed, attempt 1, `errorKind: "sandbox_timeout"`).

### Steps

1. Lucas lands on the run detail page. The status pill shows red `failed`. The error banner reads: `sandbox_timeout` / "Step timed out after 10 minutes." The Run Actions area shows only one button: **Retry** (icon: `RefreshCw`). He scans for a "Run again" or "New run" button — there is none on this page. → The only option presented is Retry. (`run-actions.tsx:169-184`)

2. Lucas reads the button label "Retry" and assumes it will restart the whole loop. He clicks it. The button spins. `POST /api/agent-loop-runs/lrun_9wrp/retry` fires. → The server calls `retryCurrentStep({ runId: "lrun_9wrp", userId: "..." })`. Inside `storeRetryCurrentStep`, the function loads the run, confirms status is `failed`, and checks `currentNodeId` (`draft_pr`) and `currentStepRunId` (`srun_a3b`). (`run-controls.ts:136-140`, `store.ts:947-979`)

3. Inside the transaction, the server finds `srun_a3b` has `status: "failed"` (not `queued`), so it takes the n+1 branch. It inserts a new `agent_loop_step_runs` row for node `draft_pr`, `attempt: 2`. It transitions the run's status from `failed` to `running` and updates `currentStepRunId` to the new step run's id. A new workflow is dispatched for the new step run. (`store.ts:1044-1090`)

4. `toast.success("Retry successful")` appears. The next poll returns `status: "running"`. → Lucas sees the status pill change to amber `running`. The step timeline adds a new row: `draft_pr / attempt 2 / running`. The two earlier steps (`clone_repo`, `run_tests`) are still visible in the timeline — they are NOT being re-run. **This is not what Lucas expected.**

5. Lucas watches as `draft_pr attempt 2` completes. The run proceeds from `draft_pr` forward, walks the remaining nodes, and finishes as `completed`. The step timeline shows 4 rows total (3 original + 1 retry). → The two upstream steps were not repeated, so any state they generated (cloned repo, test results) was preserved in `context` from the original run.

6. Lucas realizes his assumption was wrong. If he actually wanted to re-run the loop from the start with fresh context, he must navigate back to the loop detail page (`← [loop name]`) and click **Run now** to trigger a brand new run with a new `lrun_*` ID. → No affordance on the run detail page explains this distinction or offers a "Start new run" shortcut. (`run-detail.tsx`: no new-run button; loop page `loop-detail.tsx:240-247` has "Run now")

### Variations

- **Retry on a `stalled` run**: Identical flow. `storeRetryCurrentStep` accepts `failed` or `stalled` (`store.ts:967`). The button is available for both terminal states.
- **Retry on a `completed` run**: Retry button renders (terminal status), but the API returns 409 `illegal_transition` because `completed` is not in `['failed', 'stalled']`. Toast: "Cannot retry run …: not in a retryable status (failed/stalled), got: completed". Lucas is stuck — there is no explanatory message before he clicks. (`store.ts:967-971`, `run-actions.tsx:30-35`)
- **Retry on a `cancelled` run**: Same as completed — 409, same confusing error toast. The button renders but does not work. (`store.ts:967-971`)

### Edge Cases

- **Retry with missing `currentNodeId`**: The store throws `RunControlError("illegal_transition", "Cannot retry run …: missing currentNodeId or currentStepRunId")`. 409 is returned. The toast message is technically accurate but uses internal field names. (`store.ts:974-978`)
- **Concurrent retry race**: Two tabs both click Retry for the same `failed` run at the same instant. The unique index on `(loopRunId, nodeId, attempt)` ensures only one INSERT succeeds; the second transaction rolls back with a unique-constraint violation, which the store re-throws as `RunControlError("illegal_transition")` → 409. One tab gets success, the other gets a toast error. (`store.ts:1051-1055`)
- **Retry after stall with queued step (P1 path)**: If the stall sweep advanced the node but suppressed the `start()` call, `currentStepRunId` may point to a `queued` step. Retry detects this (`failedStepRun.status === "queued"`) and dispatches the existing step run instead of creating attempt n+1. The user sees "Retry successful" and the run resumes from the queued step — but no new attempt row is visible in the timeline, which may confuse users who expect to see "attempt 2". (`store.ts:1012-1042`)

### UX Friction Observed

- The button is labeled **"Retry"** but the function is `retryCurrentStep` — it retries **the last step**, not the whole run. This is the most significant semantic mismatch in the controls surface. (`run-controls.ts:136`, discovery.md pain point 8, `run-actions.tsx:176`)
- **Retry** renders for `completed` and `cancelled` terminal statuses but the API rejects both. The UI gives no indication that clicking Retry on a `completed` or `cancelled` run will fail before the user tries it. (`run-actions.tsx:30-35`, `store.ts:967`)
- There is no "Start new run" shortcut on the run detail page. After a failed run, the user must navigate back to the loop detail page to trigger a fresh run. (`run-detail.tsx`: no new-run affordance)

---

## STORY-005: Clicking Controls That Race a Status Change

**Type**: short
**Persona**: Amara, a QA engineer monitoring a scheduled loop run that is close to its step limit.
**Goal**: Pause the run to review its current step output before it auto-completes.
**Preconditions**: Run `lrun_k7hm` shows `status: "running"`, `Steps: 49 / 50`. The page is polling every 2 s.

### Steps

1. Amara sees the step count at `49 / 50` and clicks **Pause** to freeze the run before the final step completes. The button enters loading state. → The `POST /api/agent-loop-runs/lrun_k7hm/pause` request is in-flight.

2. While the request is in-flight (network round-trip ~200 ms), the final step completes server-side. The run advances to `completed`. → The server's `pauseLoopRun` conditional UPDATE finds 0 rows: status is now `completed`, not `running` or `queued`. The re-check SELECT finds the run exists and is owned. It throws `RunControlError("illegal_transition")`. (`store.ts:790-806`)

3. The route returns 409. `postControl` throws. → `toast.error("Cannot pause run lrun_k7hm: not in a pausable status (running/queued)")` slides in. The button loading spinner clears.

4. The next 2 s poll tick returns `status: "completed"`. The UI re-renders: Pause and Cancel run disappear; **Retry** appears. The status pill shows green `completed`. Polling stops. → Amara has no way to inspect the final step output mid-execution; the run is done.

### Variations

- **Clicking Resume while run is already resuming (concurrent session)**: Two browser tabs are open for the same paused run. Both click Resume within the same second. One wins (200), the other gets 409 `illegal_transition`. The loser sees a toast error.

### Edge Cases

- **Network timeout on Pause request**: The `fetch` call in `postControl` hangs longer than the browser timeout. The button is stuck in spinner state. There is no client-side timeout or abort signal wired into `postControl`. The user must reload the page to recover. (`run-actions.tsx:41-55`)

### UX Friction Observed

- `postControl` has no `AbortController` / timeout — a slow or dropped request leaves the controls permanently disabled (all buttons show `loading !== null`) until the fetch settles or the page is reloaded. (`run-actions.tsx:41-55`)
- The 409 error toast message exposes the internal field name and allowed statuses (`running/queued`) in plain text. This is technically accurate but not user-friendly: a user seeing "not in a pausable status (running/queued)" has to know what `queued` means in the context of a run lifecycle. (`store.ts:803-806`, `map-control-error.ts:25-30`)

---

## STORY-006: Cancelling a Paused Run Before Resume

**Type**: short
**Persona**: Priya, a developer who paused a loop run to investigate a suspected bug in the loop definition and now wants to discard the run entirely rather than resume.
**Goal**: Cancel the paused run cleanly.
**Preconditions**: Run `lrun_bq2x` has `status: "paused"`. Priya is on the run detail page. She has decided the loop definition needs fixing before any further runs.

### Steps

1. Priya sees the Run Actions area: **Resume** button and **Cancel run** button. No Pause is present (paused runs don't render Pause). → She clicks **Cancel run**. The confirmation dialog opens as usual. (`run-actions.tsx:119, 136`)

2. She reads: "The current step will finish or be abandoned at its boundary. This action cannot be undone." The dialog copy mentions "current step" — but the run is paused, so no step is executing. The copy is slightly misleading in this context. → She clicks the red **Cancel run** anyway.

3. `POST /api/agent-loop-runs/lrun_bq2x/cancel` fires. The server transitions `paused → cancelled` (accepted per `store.ts:839`). `finishedAt` is set. → `toast.success("Cancel successful")`. Next poll: status `cancelled`. Retry appears. Resume and Cancel disappear.

### Variations

- **Cancel while the run is in `queued` status**: Same flow. `queued` is also in `isNonTerminal`. Cancel dialog renders; API accepts it. (`run-actions.tsx:136`, `store.ts:839`)

### Edge Cases

- **Cancel a paused run where the step's sandbox is already idle**: Cancelling a paused run is instant — no sandbox teardown is initiated by the API (the cancel just marks the DB row). If a sandbox process was suspended (not killed) when the run was paused, it remains in an orphaned state. There is no observable event in the UI confirming sandbox cleanup. (`run-controls.ts:61-74` — no sandbox teardown call)

### UX Friction Observed

- The cancel dialog body says "The current step will finish or be abandoned at its boundary" — this copy is written for `running` status runs. For `paused` or `queued` runs, the current step is not executing, making the copy factually misleading. (`run-actions.tsx:147-150`)

---

## STORY-007: Distinguishing Retry from New Run After a Failure

**Type**: long
**Persona**: Lucas (same engineer as STORY-004, now more experienced). His second loop run also failed at `draft_pr attempt 2` — same sandbox timeout. He now understands Retry resumes from the failed step. He wants a fresh full run instead.
**Goal**: Start a completely new loop run from the first node (`clone_repo`), not retry `draft_pr attempt 3`.
**Preconditions**: Run `lrun_9wrp` has `status: "failed"`. He is on the run detail page. Step timeline: 4 rows (3 nodes × attempts, with `draft_pr attempt 2 / failed`).

### Steps

1. Lucas sees **Retry** in Run Actions. He now knows this would create `draft_pr attempt 3` — not what he wants. He looks for a "New run" or "Run from start" button on this page. → No such button exists. The run detail page only surfaces controls for the current run. (`run-detail.tsx:280-282`: `<RunActions runId={run.id} loopId={loop.id} status={run.status} />`)

2. Lucas clicks the breadcrumb link **"← pr-triage-loop"** in the page header to navigate back to `/loops/loop_pr_triage`. → He lands on the loop detail page. He finds the **Run now** button.

3. He clicks **Run now**. A new run `lrun_c9wm` is created with `status: "queued"`, step count `0`, iteration count `0`. → He is redirected (or manually navigates) to the new run's detail page. The fresh run starts from `clone_repo`.

4. The failed run `lrun_9wrp` still exists in the run history list on the loop detail page, timestamped and labelled `failed`. → Lucas can cross-reference both runs later.

### Variations

- **"Run now" returns 409 `active_run`**: If `lrun_9wrp` is still considered active by some concurrent process (unusual for a `failed` run), the loop detail page shows an amber notice: "A run is already active: [id]. Cancel it or wait for it to complete before starting a new run." (`run-actions.tsx:88-99`)

### Edge Cases

- **Retry vs. new run for `stalled`**: A stalled run may have `currentNodeId` pointing mid-graph. Retry dispatches from that mid-graph node. If the user wanted a clean start, they must navigate to the loop and use "Run now" — the same two-page dance described above.

### UX Friction Observed

- There is no "Start new run" or "Run from scratch" shortcut on the run detail page. For failed or stalled runs, the user must navigate away and back. The breadcrumb back-link is the only escape, and it does not pre-select or hint at "Run now". (`run-detail.tsx:218-222`)
- The distinction between Retry (step-only) and New run (full loop) is entirely implicit. No copy, tooltip, or secondary label on the Retry button communicates its scope. (`run-actions.tsx:169-184`)

---

## STORY-008: Observing the Event Log After Control Actions

**Type**: short
**Persona**: Site reliability engineer Yuki who needs an audit trail of who paused and cancelled a production loop run for an incident post-mortem.
**Goal**: Confirm which user actions were taken and when, without database access.
**Preconditions**: Run `lrun_n5qc` has `status: "cancelled"`. Yuki is on the run detail page.

### Steps

1. Yuki scrolls past the step timeline to the **Event log** section. → Each event row shows: summary text, event name (monospace), level, timestamp, and optionally `workflow [id]` and `req [id]`. (`run-detail.tsx:160-189`)

2. She scans the event log and finds, in order:
   - `agent-loop.run.paused` — "Loop run paused (via API)" — level: info
   - `agent-loop.run.resumed` — "Loop run resumed (via API)" — level: info
   - `agent-loop.run.cancelled` — "Loop run cancelled (via API)" — level: info
   → She can see the full pause → resume → cancel sequence. (`run-controls.ts:46-53`, `run-controls.ts:87-93`, `run-controls.ts:67-73`)

3. She wants to know **which user** triggered each action. → She checks the event's payload field — but `payload` is not rendered in the event row UI. It is stored in the database (`agentLoopEvents.payload` JSONB, which includes `{ runId, userId, source: "api" }`), but the detail page does not expose it. The only attribution visible is the `source: "api"` surface in the summary text. (`run-detail.tsx:161-189`: no payload render; `run-controls.ts:49`)

4. Yuki notes the `requestId` field shown on some events. → She can cross-reference with server logs if she has access, but the UI offers no user-identity display for control actions.

### Edge Cases

- **Event log capped at 200 entries**: If the run is very long and has >200 events, only the most recent 200 are shown. Control-action events could be pushed off the visible window by high-volume step events. (`discovery.md:91`)

### UX Friction Observed

- Control action events record `userId` in the payload JSONB, but the run detail page does not render the payload. There is no user-identity audit surface in the UI. (`run-controls.ts:49, 71, 93`, `run-detail.tsx:161-189`)
- "Loop run paused (via API)" is the only attribution — it does not distinguish between the run owner and an admin action. All control API calls pass the authenticated user's ID, but this is not surfaced. (`run-controls.ts:46-53`)

---

## STORY-009: Feature Flag Disabled — Control Buttons Silently Fail

**Type**: short
**Persona**: A developer using a staging environment where `AGENT_LOOPS_ENABLED` was accidentally unset.
**Goal**: Pause a running loop to investigate unexpected behavior.
**Preconditions**: Run `lrun_x2mf` appears `running` in the UI. The server-side `AGENT_LOOPS_ENABLED` env var is `false` (or absent). The run detail page rendered from a cached server response, so the status pill shows `running`.

### Steps

1. Developer clicks **Pause**. The spinner appears; the button is disabled. → `POST /api/agent-loop-runs/lrun_x2mf/pause` fires.

2. The route's `isAgentLoopsEnabled()` check returns `false`. The route returns 403: `{ errorKind: "feature_disabled", message: "Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable." }`. (`pause/route.ts:17-26`)

3. `postControl` reads `res.ok === false`, parses the body, and throws `Error("Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.")`. → `toast.error("Agent loops are not enabled. Set AGENT_LOOPS_ENABLED=true to enable.")` appears. The env var name is exposed directly in a user-visible toast.

4. The buttons unlock (spinner clears). The run continues running — nothing happened. → The developer must investigate the deployment configuration, not the run itself.

### Variations

- **Feature flag disabled on a terminal run clicking Retry**: Same 403 path. The message references the env var regardless of which control was attempted. (`retry/route.ts:17-26`)

### Edge Cases

- **Feature flag toggled mid-session**: The run detail page loaded when the flag was enabled. The flag is then disabled by an ops change. The page continues showing control buttons (client-side rendering, no awareness of server config changes). Only on action click does the user learn the flag is off. (`run-actions.tsx`: no flag check; flag is enforced server-side only)

### UX Friction Observed

- The error message surfaces the internal env var name (`AGENT_LOOPS_ENABLED`) in a user-facing toast. This is useful for platform engineers but confusing for end users who don't manage deployment config. (`pause/route.ts:22-25`)
- The control buttons remain visible on the page even when the feature is disabled. A user has no way to know their controls won't work until they click one and receive an error. (`run-actions.tsx`: no client-side feature-flag check)
