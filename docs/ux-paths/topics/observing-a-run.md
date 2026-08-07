# UX Paths: Observing a Run — Step Timeline + Event Log

Topic: **Observing a run** — the run detail page at `/loops/[loopId]/runs/[runId]`
Discovery source: `docs/ux-paths/discovery.md`
Code sources: `run-detail.tsx`, `use-loop-run-polling.ts`, `run-actions.tsx`,
`app/api/agent-loop-runs/[runId]/route.ts`, `apps/web/lib/db/schema.ts`

---

## STORY-001: Watching a Manual Run Come Alive
**Type**: short
**Persona**: Priya, a developer who just clicked "Run now" on her first active loop
**Goal**: Confirm the run started and is actually doing something
**Preconditions**: Loop status is `active`; user clicked "Run now" from the loop detail page and was navigated to `/loops/abc123/runs/run456`

### Steps
1. Page loads with server-rendered initial data showing `status: queued` in the proof strip. Priya sees the header "Loop run" with an amber pill reading "queued". She wonders if something is broken. → Amber proof strip pill and "Refreshing every 2s" label are visible; `useLoopRunPolling` has already started its 2-second SWR cycle (`use-loop-run-polling.ts:11-12`).
2. Two seconds pass. The pill flips to "running" and the step timeline section gains its first row: node ID `analyze-repo`, kind `agent_step`, status amber "running". → `StepRow` renders with `isActive = true` (amber background tint: `run-detail.tsx:109`) because `step.id === run.currentStepRunId`.
3. Priya watches new rows append as the run visits subsequent nodes. The header subtitle shows the run ID in mono font. → She has no idea whether 4 steps is a lot or a little. No progress percentage exists.

### Variations
- **Already-completed run**: if Priya navigates via a bookmark to a finished run, the "Refreshing every 2s" label is absent, the step timeline is static, and `computeLoopRunRefreshInterval` returns 0 (`use-loop-run-polling.ts:22`).

### Edge Cases
- **Network hiccup during polling**: `fetchRunDetail` throws; SWR surfaces `error = true`; the header shows "Live refresh failed. Last known state is shown." (`run-detail.tsx:232-234`). Polling resumes on next tick without user action.

### UX Friction Observed
- `run-detail.tsx:239`: "Refreshing every 2s" is rendered as plain muted text with no visual indicator (spinner, pulse dot). A user who misses it has no signal the page is live.
- `run-detail.tsx:306-309`: when a run has just started and the first step hasn't been written yet, the step timeline shows "No steps recorded yet." This is shown identically whether the run is `queued` (hasn't started) or `running` (step record hasn't flushed). Priya can't tell if the system is warming up or stalled.

---

## STORY-002: Reading the Proof Strip — What Do These Numbers Mean?
**Type**: medium
**Persona**: Marcus, a platform engineer evaluating whether a loop stayed within budget
**Goal**: Understand how many steps the run consumed and whether it was at risk of hitting a ceiling
**Preconditions**: Run is `completed`. Loop has guardrails: `maxStepsPerRun: 50`, `maxIterations: 10`.

### Steps
1. Marcus opens the run detail page. He scans the proof strip grid (`run-detail.tsx:246-278`): Status, Source, Repository, Iterations, Steps, Duration, Workflow Run, Request ID. → He immediately sees "Iterations 3 / 10" and "Steps 12 / 50". The slash notation is helpful; he understands the ceiling.
2. He notices "Iterations" has a specific count. He tries to reconcile "3 iterations" vs "12 steps". → No tooltip or label explains that "Iterations" counts how many times the loop revisited an already-visited node (`schema.ts:1294` comment: "Incremented when an edge targets an already-visited node"). He interprets it as "number of passes through the whole graph," which may be wrong.
3. He sees "Workflow Run" with a long opaque ID like `wfrun_01hx3k...` and a copy button. → He copies it, searches his internal dashboards, and finds the corresponding workflow record. This is exactly the correlation he needed, but the page gives no hint that the value is a Vercel Workflows correlation ID, not an internal loop ID.
4. Marcus notices "Request ID" with another opaque ID. → He doesn't know whether this is the HTTP request ID from the trigger webhook, the request to the inference provider, or something else. No label clarification exists (`run-detail.tsx:272-274`).

### Variations
- **No guardrails set on loop**: the proof strip shows "Iterations 3" and "Steps 12" without the ` / max` suffix (`run-detail.tsx:254-260`). The user has no ceiling reference and cannot tell whether 12 is large or small.
- **Run triggered by schedule**: Source shows "schedule" verbatim. The raw enum value appears without a human-readable label (`run-detail.tsx:248-250`).

### Edge Cases
- **Run never reached `startedAt`**: `Duration` shows "-" (`run-detail.tsx:36-37`). If the run is `queued` and never started, the user cannot distinguish between "waiting in queue" and "failed to start."

### UX Friction Observed
- `run-detail.tsx:254-255`: `label="Iterations"` with value `${run.iterationCount}` uses internal schema terminology. `iterationCount` means "graph cycles traversed" not "number of top-level passes." A user expecting a loop repetition count will misread this.
- `run-detail.tsx:265-274`: "Workflow Run" and "Request ID" are conditionally rendered only when non-null, so the proof strip width changes mid-run. The grid layout reflows silently.
- `schema.ts:1311-1313`: Both `workflowRunId` and `requestId` on the run are described only in comments; neither is labeled for end users in the UI. The "Correlation IDs" debug section at the bottom duplicates them (`run-detail.tsx:348-362`) with no explanation of the difference.

---

## STORY-003: Diagnosing a Failed Step
**Type**: medium
**Persona**: Dana, a backend engineer whose loop failed on the third step
**Goal**: Understand why the step failed and what to do next
**Preconditions**: Run status is `failed`. One step in the timeline has `status: failed` and a non-null `errorKind`.

### Steps
1. Dana lands on the run detail page. The header pill is red "failed". She sees a red error banner below the run actions section (`run-detail.tsx:284-295`) showing `errorKind: "step_timeout"` and `errorMessage: "Step exceeded the configured stepTimeoutMs limit."` → She now knows the cause at the run level.
2. She scrolls to the step timeline. Two steps show green "succeeded" pills; a third row shows red "failed" with `nodeId: lint-and-test`, `nodeKind: agent_step`. → The failed row renders `step.errorKind` in red mono text (`run-detail.tsx:137-143`): `step_timeout`. She sees the same error kind as the run banner.
3. She clicks the "Output" `<details>` toggle on the failed step (`run-detail.tsx:145-154`). → A collapsed `<pre>` expands showing the step's `stepOutput` JSON. In this case it's `{"exitCode": 124, "stderr": "timeout: sending signal TERM"}`. She now has the evidence she needs.
4. She notes the step shows `sandboxName: agent_loop_a1b2c3d4` (`run-detail.tsx:130-135`). → She has no direct link to sandbox logs from this UI. The sandbox name is actionable only if she knows to search it in an external log aggregator.
5. She clicks "Retry" to retry the current step (`run-detail.tsx:170-185`). → The button label says "Retry," but the underlying call is `POST /api/agent-loop-runs/[runId]/retry`. She doesn't know whether this retries the whole run from the start or just the failed step. (Per `discovery.md:114`: it retries only the last step — the label is misleading.)

### Variations
- **`errorKind` on step but not on run**: possible if the run-level error hasn't been propagated yet during a mid-flight failure. The red banner is absent and only the timeline row shows the error.
- **Step has `attempt: 2`**: the watchdog bumped it. The timeline shows `attempt 2` in the metadata line but does not explain that there was a prior attempt or what happened to it.

### Edge Cases
- **`stepOutput` is null**: the `<details>` element is not rendered at all (`run-detail.tsx:145`: `{step.stepOutput && ...}`). If the step failed before producing output, Dana sees no output section and may not realize output was expected.
- **`sandboxName` is null on a failed `agent_step` node**: the sandbox line is omitted silently. Dana has no correlation handle.

### UX Friction Observed
- `run-detail.tsx:170-185`: "Retry" is shown for all terminal statuses including `completed`. There is no indication what "Retry" does (retry last step, not full run). A user who successfully completed a run could accidentally trigger a new step execution.
- `run-detail.tsx:130-135`: `sandboxName` (e.g., `agent_loop_01hxk3...`) is an opaque internal identifier with no link to logs, no copy button, and no tooltip. Engineers must manually construct a log search query.
- `schema.ts:1350`: Comment says `sandboxName` follows the pattern `agent_loop_<stepRunId>` for `agent_step` nodes, but this pattern is not surfaced to the user.

---

## STORY-004: Reading the Event Log for the First Time
**Type**: long
**Persona**: Tomás, a new user inspecting his first completed run to understand what the agent actually did
**Goal**: Build a mental model of what happened during the run by reading the event log
**Preconditions**: Run is `completed`. Event log has 18 entries. No prior exposure to the Agent Loops feature.

### Steps
1. Tomás opens the run page. He scrolls past the proof strip and step timeline to the "Event log" section. He sees 18 rows, each with a title and a monospace subtitle. → The event log is ordered by `createdAt` ascending (`listAgentLoopEvents` in `store.ts`). The earliest events are at the top.
2. He reads the first row: title "Loop run started", subtitle `loop.run.started`, status "started", level "info". → He recognizes the summary as human-readable and the `eventName` as a machine key. The double display (summary on top, `eventName` below) helps but the relationship between the two fields isn't explained.
3. Three rows deep he sees: title "Analyzing repository structure", subtitle `agent.tool.bash`, status "running", level "info". → He doesn't understand that this event came from a specific step. There is no step grouping or indentation in the log; events from different steps are interleaved without visual separation.
4. He notices a metadata line under one row: `workflow wfrun_01hx3k... req req_7f4a2b...`. → These look like internal IDs. Tomás has no way to know that `wfrun_` prefixes identify the Vercel Workflows durable execution and `req_` prefixes identify the HTTP call to the inference provider.
5. He notices the word "redaction" on every event row (`run-detail.tsx:185`: `redaction {event.redactionStatus}`). Most rows show `redaction passed`. One shows `redaction not_required`. → He has no idea what redaction means in this context or why some events required it and others didn't. The enum values (`not_required`, `passed`, `failed`, `blocked`) are from `schema.ts:1410-1414`.
6. He looks for a way to filter the event log by step, by level, or by keyword. → No filter or search controls exist. With 18 events he can scan manually; at 200 events (the API ceiling, per `route.ts` — `listAgentLoopEvents` returns up to 200) this becomes unmanageable.
7. He sees one event with level "warn" styled identically to "info" events. → The `level` field is displayed as plain text in the metadata line (`run-detail.tsx:176`), not color-coded. The "warn" and "error" levels are visually indistinguishable from "info" at a glance.
8. He tries to expand an event to see its payload. → No expand affordance exists. The `payload` JSONB field (`schema.ts:1406-1409`) is not rendered in the UI at all.

### Variations
- **Run with 0 events**: The empty state "No events recorded." is shown (`run-detail.tsx:329-331`). Tomás doesn't know if this means the run was trivial, events were lost, or event tracking isn't wired up for this loop kind.
- **Event with `status: blocked`**: The status pill renders gray with the text "blocked" (the `capitalize` CSS class capitalizes it). There is no explanation of what "blocked" means (a redaction decision held the event from dispatch).

### Edge Cases
- **Event log hits 200-entry cap**: the API silently returns only the first 200 events. The UI shows no "truncated" indicator. A run with high event volume appears complete but is missing history.
- **`summary` is null on an event**: the row title shows `event.eventName` (the raw machine key) as fallback (`run-detail.tsx:168`: `event.summary ?? event.eventName`). Machine keys like `agent.tool.bash.result` appear as the primary label without visual distinction from human-readable summaries.

### UX Friction Observed
- `run-detail.tsx:185`: `redaction {event.redactionStatus}` is rendered on every single event row. For most users, "redaction passed" is noise — it's an internal pipeline status. Users who don't know what the redaction pipeline is will either ignore it or be confused by it.
- `run-detail.tsx:161-189`: Events have no expand control. The `payload` JSONB field (potentially the most useful debugging data) is entirely hidden from the UI.
- `run-detail.tsx:163-189`: No visual grouping by step. Events belonging to `lint-and-test` and `analyze-repo` are interleaved. Users cannot follow the causal chain of a single step.
- `run-detail.tsx:176`: `event.level` is displayed as a plain-text metadata field. The "warn" and "error" levels have no color treatment, making severity invisible at a glance.

---

## STORY-005: Interpreting "Iterations" vs. "Steps" — Confusion Loop
**Type**: short
**Persona**: Elena, a team lead reviewing whether a loop is looping correctly
**Goal**: Verify that the loop cycled through its graph nodes the expected number of times
**Preconditions**: Run is `completed`. The loop definition has a cycle: `analyze → patch → validate → analyze` (three-node cycle). Expected behavior: 2 full cycles, then exit.

### Steps
1. Elena opens the run detail page and reads the proof strip: "Iterations 2 / 10", "Steps 9 / 50". → She expects "Iterations 2" to mean "two complete passes through the graph." This is incorrect — `iterationCount` is incremented each time an edge targets an already-visited node (`schema.ts:1294`), which for a three-node cycle that repeats twice would be 2 (once per backward edge), not 6 (once per node per pass).
2. She cross-checks the step timeline: 9 rows — 3 for the first pass, 3 for the second, 3 for the exit path. → The step count (9) confirms 3 passes through 3 nodes, but the iteration count (2) does not match her mental model of "passes." She concludes the loop ran incorrectly.
3. She opens a support ticket asking why iterations is 2 when she expected it to be 3 (or 6). → The mismatch is a terminology problem, not a bug.

### Variations
- **Straight-line loop (no cycles)**: `iterationCount` stays 0 for the entire run. The proof strip shows "Iterations 0 / 10", which a user may interpret as "zero iterations were performed."

### Edge Cases
- **Guard hitting `maxIterations`**: when `iterationCount >= maxIterations`, the run transitions to `failed` with `errorKind: max_iterations_exceeded`. The proof strip then shows "Iterations 10 / 10" in red. The ceiling was reached but the user may not know it caused the failure without reading the error banner separately.

### UX Friction Observed
- `run-detail.tsx:253-256`: "Iterations" label directly exposes `run.iterationCount` without a tooltip or definition. The technical meaning (backward-edge traversal count) diverges from the common English meaning (loop repetition count).
- `schema.ts:1293-1294`: The comment "Incremented when an edge targets an already-visited node" is not surfaced anywhere in the UI.

---

## STORY-006: Spotting the Currently Executing Step in a Long Run
**Type**: short
**Persona**: Kai, a developer monitoring a long-running agent step live
**Goal**: Know which step is currently executing and how long it has been running
**Preconditions**: Run is `running`. 8 steps have already completed. A 9th step has been `running` for 4 minutes.

### Steps
1. Kai opens the run detail page. He scans the step timeline. The 9th row has a subtle amber background tint. → The amber tint on `StepRow` (`run-detail.tsx:109`: `isActive && "bg-amber-500/5"`) is the only visual differentiator for the current step. The contrast is very low (5% amber opacity).
2. He reads the active step's metadata: `attempt 1`, a timestamp, and "Running" (from `formatDuration` returning "Running" when `finishedAt` is null, `run-detail.tsx:37`). → The live duration does not tick upward. It always shows "Running" as a static string, not "4m 12s and counting." Kai cannot tell how long the step has been running without doing the math himself from the start timestamp.
3. Kai looks for the "Current Node" proof strip item. → It appears only when `run.currentNodeId` is non-null (`run-detail.tsx:275-278`). It is present and shows `validate-pr`. This confirms the node name but he still cannot see which step run corresponds to it without correlating `currentStepRunId` manually.

### Variations
- **`currentNodeId` is null**: the "Current Node" proof strip item is omitted. Kai sees no "Current Node" label at all, creating an inconsistent proof strip with a different number of columns.

### Edge Cases
- **Multiple retries of the same step**: `attempt` counter on the active step shows 2 or 3. No previous-attempt rows appear — they are separate `agentLoopStepRun` records that may already be in the timeline above, but the UI does not visually group them.

### UX Friction Observed
- `run-detail.tsx:36-37`: `formatDuration` returns the static string "Running" for in-progress steps. A clock that doesn't tick gives no urgency signal and no way to assess runaway steps.
- `run-detail.tsx:109`: `bg-amber-500/5` is an extremely low-contrast highlight. Users with display calibration variations or low-brightness settings may not see the amber tint at all.
- `run-detail.tsx:275-278`: "Current Node" proof strip card appears and disappears as the run progresses, causing grid reflow. The proof strip has between 6 and 9 cards depending on which nullable fields are populated.

---

## STORY-007: Copying a Correlation ID for a Support Ticket
**Type**: short
**Persona**: Sam, a developer filing a bug report about a failed run
**Goal**: Gather the right IDs to include in a support ticket or internal incident report
**Preconditions**: Run is `failed`. Both `workflowRunId` and `requestId` are non-null.

### Steps
1. Sam scans the proof strip. He sees "Workflow Run" with an ID and a copy button, and "Request ID" with an ID and a copy button. → He copies both.
2. He scrolls to the "Correlation IDs" section at the bottom of the page (`run-detail.tsx:342-363`). He sees: Loop Run ID, Loop ID, Workflow Run ID, Request ID, Idempotency Key. → He notices Workflow Run ID and Request ID appear in both the proof strip and the Correlation IDs section. He doesn't know which to use or why they're duplicated.
3. He copies the "Idempotency Key" too, just in case. → He has no idea what an idempotency key is (`schema.ts:1308`). It is a deduplication token for the run trigger, not a useful debugging handle.

### Variations
- **`workflowRunId` is null**: the "Workflow Run" proof strip item is absent; the Correlation IDs section still shows "Workflow Run ID" with value "-". The two sections are inconsistent in how they handle null values.
- **`requestId` is null**: same as above — proof strip item absent, Correlation IDs section shows "-".

### Edge Cases
- **Run created by a cron trigger**: `idempotencyKey` is a deterministic hash of the cron time + loop ID. Sam's support team needs this to trace deduplication, but there's no label explaining the key format.

### UX Friction Observed
- `run-detail.tsx:342-363`: The "Correlation IDs" section duplicates information already in the proof strip without explaining the relationship between the two sections or which to use when.
- `run-detail.tsx:352-354`: "Idempotency Key" is included in the Correlation IDs section with no tooltip. It is primarily a system field, not a user-debugging field, but appears at the same visual weight as the run ID.
- `run-detail.tsx:265-274`: Proof strip items for `workflowRunId` and `requestId` are conditionally rendered; the Correlation IDs debug section always renders them (with "-" fallback). This creates two different UX conventions for the same two fields on the same page.

---

## STORY-008: Encountering "redaction failed" in the Event Log
**Type**: medium
**Persona**: Leila, a security-conscious developer reviewing a run that touched a repository with a `.env` file
**Goal**: Understand why one event in the log is marked differently and whether sensitive data was exposed
**Preconditions**: Run is `completed`. Most events have `redactionStatus: passed`. One event has `redactionStatus: failed`.

### Steps
1. Leila opens the run detail page and scans the event log. Most rows show `redaction passed` in gray metadata text. One row shows `redaction failed`. → The visual difference is only in the text — no color change, no icon, no warning treatment. `run-detail.tsx:185` renders `redaction {event.redactionStatus}` identically regardless of the status value.
2. She tries to expand the event to read the payload and understand what the redaction failure means. → No expand affordance exists. `payload` is not rendered (`schema.ts:1406-1409`).
3. She looks for a tooltip or documentation link explaining `redaction failed`. → None exists. She must know that the redaction pipeline passes events through a scanner for secrets/PII before they are stored, and `failed` means the scanner could not complete (not that data leaked). This is impossible to infer from the UI.
4. She files a security review request because she thinks secrets may have been logged. → The concern was valid to raise but the semantics of `redaction failed` (`schema.ts:1414`) mean the scanner errored, not that secrets are confirmed present.

### Variations
- **`redactionStatus: blocked`**: the event was held pending a redaction decision. The UI shows `redaction blocked` with the same treatment as all other statuses. There is no recovery path shown.
- **Event with `level: error` and `redactionStatus: failed`**: both signals appear in the same metadata line with no visual hierarchy to indicate which is more urgent.

### Edge Cases
- **All events have `redactionStatus: not_required`**: this is valid for non-sensitive agent step types. The user sees "redaction not_required" on every row and may think the redaction feature is disabled or skipped for their run.

### UX Friction Observed
- `run-detail.tsx:185`: `redaction {event.redactionStatus}` is shown on every event row unconditionally. There are four possible values (`not_required`, `passed`, `failed`, `blocked`) with meaningfully different security implications, none of which are explained or visually differentiated.
- `run-detail.tsx:161-189`: The `payload` JSONB field — the actual content that redaction acts upon — is never shown. Users cannot audit what data the redaction pipeline evaluated.
- `schema.ts:1410-1414`: The `redactionStatus` enum is defined with four values; the UI displays them as plain lowercase strings with no styling distinctions between the two safe states (`not_required`, `passed`) and the two problem states (`failed`, `blocked`).

---

## STORY-009: Navigating Back to the Loop After Inspecting a Run
**Type**: short
**Persona**: Alex, a developer who deep-linked directly to a specific run from a Slack notification
**Goal**: Navigate back to the loop's run list to compare this run with previous ones
**Preconditions**: Alex arrived at `/loops/abc123/runs/run789` via a direct link. She has not previously seen the loop detail page.

### Steps
1. Alex reads the run detail header. She sees a back link: "← my-deploy-checker" in muted text above the "Loop run" heading (`run-detail.tsx:218-224`). → The link text is the loop's `name` value. She doesn't immediately recognize "my-deploy-checker" as the parent entity's name (she may call it a "workflow" or "playbook"). She clicks it.
2. She lands on `/loops/abc123` — the loop detail page — which shows the recent runs list. She can compare this run with the three previous ones. → Success. Navigation works as expected.
3. She wants to share the run URL with a colleague. The run ID in the page subtitle (`run-detail.tsx:229-231`) is shown in mono text but is not a clickable link and has no copy button. → She must copy the URL from the browser address bar manually.

### Variations
- **Loop name is long (>40 chars)**: the back link text truncates because it is inside a `min-w-0` container (`run-detail.tsx:218`). The truncated label loses meaning.
- **Loop name is empty string**: the back link renders an empty arrow with no label — technically impossible given `schema.ts:926` (`name.notNull()`) but visible during a race between SSR and client data.

### Edge Cases
- **Run's `loopId` references a deleted loop**: the SSR page returns 404 due to the cascade delete (`schema.ts:1272`: `onDelete: "cascade"`). But if a user navigates to a run page for a run whose loop was deleted after page load, the back link navigates to a 404. No guard exists on the client side.

### UX Friction Observed
- `run-detail.tsx:229-231`: the run ID shown as the page subtitle has no copy button, unlike the correlation IDs at the bottom of the page. A user who wants to share the run ID must scroll to the Correlation IDs section.
- `run-detail.tsx:218-224`: the breadcrumb back link is the only navigation affordance. There is no breadcrumb showing `Loops / my-deploy-checker / Run #789` — users who deep-link in have no positional context.
