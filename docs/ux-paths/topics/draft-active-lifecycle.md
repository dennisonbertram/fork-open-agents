# UX Stories: Draft → Active Lifecycle

Topic: After creating a loop, the user must flip it from `draft` to `active`
before "Run now" works. This is the highest single-friction moment for a new
Loops user.

**Source code grounding:**

- Button disabled condition: `loop-detail.tsx:242` — `disabled={runningNow || loop.status !== "active"}`
- "Loop not active" banner: `loop-detail.tsx:266-271` — shown whenever `loop.status !== "active"`
- Banner text (exact): `"Loop must be in active status to run manually."`
- Status Select location: `loop-detail.tsx:317-331` — sidebar section titled "Loop status"
- Select options: Draft, Active, Paused, Archived (all four states always available)
- PATCH handler: `apps/web/app/api/agent-loops/[loopId]/route.ts:44-101` — no transition guard; any→any allowed
- `loop_inactive` API error: `apps/web/app/api/agent-loops/[loopId]/runs/route.ts:83-90` — HTTP 409, message "Loop must be in 'active' status to start a run. Update the loop status to 'active' first."
- Schema enum: `apps/web/lib/db/schema.ts:932-936` — `["draft", "active", "paused", "archived"]`, default `"draft"`
- Active run 409 banner: `loop-detail.tsx:251-263` — amber, text "This loop already has an active or paused run: {runId}. Wait for it to complete, resume, or cancel it before starting a new run."

---

## STORY-001: The "Why Is the Button Gray?" First Impression

**Type**: short
**Persona**: Priya, a platform engineer who just created her first loop ("nightly-lint-sweep") and wants to fire it immediately to test her JSON graph
**Goal**: Click "Run now" and watch the first execution
**Preconditions**: Priya just landed on `/loops/abc123` after the create form redirected her. The loop status is `draft`.

### Steps

1. Priya sees the loop detail page with the loop name ("nightly-lint-sweep"), the repo slug ("priya-org/backend"), and a `draft` status pill next to the title. Her eye goes straight to the "Run now" button in the top-right corner → The button is present but visually grayed out (disabled). She tries to click it. Nothing happens.

2. She looks around the page for an explanation. Below the header she notices a muted gray callout box: "Loop must be in `active` status to run manually." → She sees the word `active` in monospace but does not yet know how to get there.

3. She hovers over the "Run now" button again, expecting a tooltip or cursor hint → No tooltip appears. The button is `disabled` with no `title` attribute. Dead end.

4. She scans the right sidebar and notices a card labeled "Loop status" with a Select control showing "Draft". She opens the dropdown → She sees four options: Draft, Active, Paused, Archived.

5. She selects "Active". The Select briefly shows a loading state (`updatingStatus = true`). A toast appears: "Loop status updated to active" → The status pill in the header updates to `active` (emerald green). The banner disappears.

6. She clicks "Run now". The button shows "Starting…" briefly, then she is redirected to `/loops/abc123/runs/run456` → The run detail page loads showing `queued` status.

### Variations

- **User misses the sidebar entirely on narrow viewport**: On a small laptop screen the two-column layout (`grid gap-6 lg:grid-cols-[1fr_320px]`) may stack vertically, pushing "Loop status" below the run-history section. The gray banner is still visible but the path to the Select is longer to discover.

### Edge Cases

- **User selects Active while loop has an invalid definition**: The PATCH handler in `route.ts:83-93` validates the definition on write. If the definition is invalid, status remains `draft` and a `loop_invalid` 400 response is returned. The UI shows a toast error but the banner persists.

### UX Friction Observed

- No tooltip on the disabled "Run now" button (`loop-detail.tsx:240-247`) — the button is gray with no inline hint pointing to the sidebar.
- The status banner (`loop-detail.tsx:266-271`) correctly names the problem but does not contain an inline link or button to fix it. The user must hunt for the "Loop status" Select independently.
- The draft state is never explained in the create flow (`loop-create-form.tsx`) — the first time a user encounters the word "draft" is on the detail page after creation.

---

## STORY-002: Returning to a Forgotten Draft Loop

**Type**: medium
**Persona**: Marcus, a developer who created a loop two weeks ago, never activated it, and is returning after a meeting reminded him it exists
**Goal**: Get the loop running and confirm triggers fire on pull requests
**Preconditions**: Loop "pr-review-assistant" is in `draft` status; Marcus left the create page before activating. He navigates from the Settings → Loops → clicks the loop name.

### Steps

1. Marcus opens `/loops` and sees his loop listed. The status column shows a muted gray pill labeled "draft" → He does not immediately recall that this is why nothing has fired.

2. He clicks the loop name to open `/loops/loop789`. The "Run now" button is disabled. He looks at the triggers section in the sidebar and sees one trigger configured: `github.pull_request` / `active` status pill → He is confused: the trigger shows as `active` but the loop has never run. He assumes the trigger is broken.

3. He reads the gray banner beneath the header: "Loop must be in `active` status to run manually." → He thinks this only applies to manual runs, not trigger-driven runs. He does not realize the `loop_inactive` gate in `dispatcher-bridge.ts:332-334` also blocks trigger fires.

4. He opens the "Background agents settings" link in the Triggers section to investigate the trigger → He is taken to `/settings/background-agents`, now off the loop detail page with no breadcrumb back. He sees the trigger listed but no indication that the loop itself is the bottleneck.

5. He returns to the loop detail page (browser back). Now understanding the issue is the loop status, he finds the "Loop status" Select → He opens it and selects "Active". Toast: "Loop status updated to active". Header pill turns emerald.

6. He waits for an open PR to fire the trigger → A PR event arrives 10 minutes later. The run history section (polling every 5 s, `loop-detail.tsx:127`) updates to show a new row with status `queued`, then `running`. He is satisfied.

### Variations

- **User tries "Run now" after activating but an old queued run from a trigger already exists**: On click, the API returns 409 `active_run`. The amber banner appears: "This loop already has an active or paused run: {runId}. Wait for it to complete, resume, or cancel it before starting a new run." The run ID is a clickable monospace link.

### Edge Cases

- **Trigger fires while loop is still in draft**: The dispatcher (`dispatcher-bridge.ts:332-334`) returns `skipped: true, reason: "loop_inactive"`. No run row is created. No error is surfaced to the user on the loop detail page — the run history remains empty with "No runs yet." The user may not discover the blocked triggers without inspecting background-agent event logs (which are not linked from the loop detail).

### UX Friction Observed

- The trigger status pill (`loop-detail.tsx:357-358`) shows the trigger's own status (e.g., `active`), which is independent of the loop's activation status. This makes it appear the trigger is healthy when the loop itself is the blocker (`loop-detail.tsx:340-368`).
- No indication anywhere on the loop detail page that `draft` loops also block trigger-driven runs — the banner at `loop-detail.tsx:266` says only "run manually."
- Cross-page trigger management at `loop-detail.tsx:343-349` loses the loop context when navigating to `/settings/background-agents`.

---

## STORY-003: The Accidental Deactivation

**Type**: short
**Persona**: Diana, a DevOps lead who manages three loops. She is updating the name of one loop in the sidebar and accidentally changes the status.
**Goal**: Edit the loop name without disrupting the active status
**Preconditions**: Loop "deploy-gatekeeper" is `active` with an in-progress run.

### Steps

1. Diana opens the loop detail page for "deploy-gatekeeper". She intends to edit the loop name but there is no name-edit field on this page (name is set at create time and not editable via the UI — only via direct PATCH API call) → She is confused, but moves on.

2. While exploring the sidebar, she accidentally opens the "Loop status" Select and clicks "Paused" instead of dismissing it → The PATCH fires immediately via `handleStatusChange` (`loop-detail.tsx:184-216`). Toast: "Loop status updated to paused". The header pill changes to a muted color.

3. The in-progress run is NOT paused — `paused` at the loop level blocks new runs but does not interrupt the executing run (`schema.ts:933`, discovery.md note: "Loop-level `paused` blocks new runs; does NOT pause an in-progress run.") → The run continues completing. Diana sees the run history row still showing `running`.

4. Diana realizes her mistake. She re-opens the Select and chooses "Active". Toast: "Loop status updated to active" → The header pill returns to emerald. No runs were lost.

### Variations

- **User selects Archived instead of dismissing**: The loop moves to `archived`. It still appears in the list but all new runs are blocked. Restoring to `active` is a single Select change (no guard on transitions in `updateAgentLoop` at `store.ts:164-211`).

### Edge Cases

- **Trigger fires during the brief paused window**: If a PR event arrives in the seconds between the accidental pause and the re-activation, the dispatcher returns `skipped: true, reason: "loop_inactive"` and no run is created. The missed trigger is invisible to the user.

### UX Friction Observed

- The status Select fires immediately on selection with no confirmation dialog — a single misclick produces a PATCH (`loop-detail.tsx:319`). High-traffic loops could miss trigger events during the accidental pause window.
- There is no undo affordance. The toast "Loop status updated to paused" disappears after a few seconds with no action button.

---

## STORY-004: Activating and Immediately Hitting the Active-Run 409

**Type**: medium
**Persona**: Sam, a new user who reads the gray banner, activates the loop correctly, then quickly clicks "Run now" twice
**Goal**: Start a run manually and navigate to it
**Preconditions**: Loop "refactor-checker" just activated. Sam is fast with the mouse.

### Steps

1. Sam reads the banner ("Loop must be in `active` status to run manually."), finds the "Loop status" Select in the sidebar, selects "Active", and sees the toast → The button becomes clickable. Status pill turns emerald.

2. Sam clicks "Run now" immediately. The button shows "Starting…" (`runningNow = true`). In the background, `handleRunNow` fires `POST /api/agent-loops/{loopId}/runs` → The API returns 202, a `runId` is in the response body. Sam is redirected to the run detail page.

3. Sam navigates back to the loop detail page to start a second run. He clicks "Run now" again → The API returns 409 `{ errorKind: "active_run", message: "...", activeRunId: "run456" }`. The `handleRunNow` handler (`loop-detail.tsx:140-159`) sets `activeRunNotice = "run456"`.

4. An amber banner appears below the header: "This loop already has an active or paused run: `run456`. Wait for it to complete, resume, or cancel it before starting a new run." The run ID is a clickable monospace link → Sam clicks the link and is taken to the run detail page for `run456`.

### Variations

- **API returns `activeRunId` in 409 body**: The UI uses `body.activeRunId` directly (`loop-detail.tsx:152-158`). If the API omits `activeRunId` for any reason, the UI falls back to scanning the local SWR runs list for the first run with status `running`, `queued`, or `paused`.
- **The in-flight run completes before Sam tries again**: The runs list (polling every 5 s) would update the status to `completed`. A second "Run now" click would succeed normally. The amber banner would never appear.

### Edge Cases

- **SWR cache shows stale data**: The runs list polls every 5 s (`loop-detail.tsx:127`). If a run completes between two polls, the local list might still show `running` but the next "Run now" POST would succeed (server state is authoritative).

### UX Friction Observed

- The amber 409 banner (`loop-detail.tsx:251-263`) appears only after a failed POST — there is no proactive indicator on the "Run now" button that a run is already in flight, even when the SWR-polled runs list shows a `running` row. A user landing on the page while a run is active has no visual cue that "Run now" will immediately 409.

---

## STORY-005: Trying to Run a Paused Loop

**Type**: short
**Persona**: Kenji, an ops engineer who uses Paused loops as a "hold" state for loops he is debugging
**Goal**: Understand why "Run now" is grayed out on a loop he thought was ready
**Preconditions**: Loop "staging-smoke" is in `paused` status. Kenji navigates to the detail page.

### Steps

1. Kenji opens the loop detail page. He sees a muted status pill with "paused" next to the loop name. The "Run now" button is disabled → He clicks it. Nothing happens.

2. He reads the gray banner: "Loop must be in `active` status to run manually." → He now understands that `paused` is not an "inactive" state that he can click through — it requires an explicit status change.

3. He opens the "Loop status" Select in the sidebar. It shows "Paused". He clicks it and sees the four options: Draft, Active, Paused, Archived → He selects "Active". Toast: "Loop status updated to active". The banner disappears. The button becomes enabled.

4. He clicks "Run now" → 202 response, redirected to the new run.

### Variations

- **Kenji selects Draft instead of Active by mistake**: The banner persists. The button remains disabled. He must re-open the Select and choose Active.
- **Kenji selects Archived**: Same as Draft — still blocked. The status pill turns muted with label "archived".

### Edge Cases

- **Loop has an in-flight run from a prior trigger while in paused status**: This is only possible if a trigger fired before the loop was paused. The run continues. If Kenji then activates the loop and clicks "Run now", he will hit the 409 `active_run` banner.

### UX Friction Observed

- `paused` and `draft` are indistinguishable from the user's perspective when it comes to the "Run now" gate: both result in the same gray button and the same banner text at `loop-detail.tsx:266-271`. There is no per-state explanation for why the loop is paused (e.g., "You paused this loop on Jun 10") versus why it is still in draft.

---

## STORY-006: Archiving a Loop After Deprecating a Workflow

**Type**: medium
**Persona**: Lena, a tech lead retiring a loop that was used for an old release process. She wants to keep the history visible but stop any new runs.
**Goal**: Archive the loop cleanly, verify no new runs start, and confirm old run history is preserved
**Preconditions**: Loop "release-v1-checker" is `active`; it has 14 completed runs visible in the history table. No in-progress run.

### Steps

1. Lena opens `/loops/loop_abc`. She confirms no active runs (run history shows all rows as `completed` or `failed`). She opens the "Loop status" Select → She selects "Archived". Toast: "Loop status updated to archived". Status pill changes to muted "archived".

2. The "Run now" button becomes disabled. The banner appears: "Loop must be in `active` status to run manually." → Lena reads this and confirms the behavior is correct.

3. She navigates to `/loops` to check the list → The loop "release-v1-checker" still appears (soft delete — `archived` status is not a hard delete; loops remain in the list per `listAgentLoops` at `store.ts:224-238`).

4. She clicks the loop name to return to the detail page. The 14 prior run rows are still visible in the run history section → History is preserved. She bookmarks the page for future reference.

5. A background cron trigger is still configured for this loop. She wants to confirm it will not fire. She opens the Triggers section → The trigger card shows the trigger's status (`active`) but she cannot confirm from this page whether trigger events are being silently suppressed. She clicks "Background agents settings" to check there.

6. She finds the trigger listed at `/settings/background-agents` but there is no loop-level filter or indication that the target loop is archived → She must remember to delete or disable the trigger manually if she wants to silence the events entirely.

### Variations

- **Lena re-activates from Archived**: Selecting "Active" in the Select is permitted with no guard. The loop immediately becomes runnable again. All prior run history remains.

### Edge Cases

- **Cron trigger fires while loop is archived**: `dispatcher-bridge.ts:332-334` returns `skipped: true, reason: "loop_inactive"` (archived is not `active`). No run is created. No error or notification is sent to the user — the skip is invisible from the loop detail page.

### UX Friction Observed

- The Triggers section on the loop detail page (`loop-detail.tsx:336-368`) does not warn that the loop's `archived` status means trigger events are being silently dropped.
- Navigating to `/settings/background-agents` from the Triggers section does not pre-filter by this loop (`loop-detail.tsx:347` links to the bare URL without a query param).
- There is no soft-delete confirmation dialog before archiving — it is a single Select interaction with immediate effect, same as all other status changes.

---

## STORY-007: Discovering the Status Select via the API (Power User Path)

**Type**: long
**Persona**: Alex, a backend engineer who prefers to understand the API before touching the UI. He reads the network requests on the detail page, then tries to PATCH status directly from `curl`, and finally uses the UI Select.
**Goal**: Activate a loop programmatically and verify the UI reflects the change
**Preconditions**: Loop "ci-health-monitor" is in `draft` status. Alex has a valid session cookie.

### Steps

1. Alex opens `/loops/loop_xyz` in the browser. He opens DevTools → Network. He sees the SWR fetch to `GET /api/agent-loops/loop_xyz` returning `{ loop: { status: "draft", ... }, triggers: [] }` → He notes the endpoint and shape.

2. He clicks "Run now" to observe the failed request → He sees `POST /api/agent-loops/loop_xyz/runs` return HTTP 409 with body `{ errorKind: "loop_inactive", message: "Loop must be in 'active' status to start a run. Update the loop status to 'active' first." }` → The banner in the UI appears but Alex is more interested in the API response.

3. He opens a terminal and fires a curl: `curl -X PATCH https://localhost:3002/api/agent-loops/loop_xyz -H 'Content-Type: application/json' -d '{"status":"active"}' -H 'Cookie: ...'` → The server responds with HTTP 200 and `{ loop: { status: "active", ... } }`.

4. He refreshes the browser tab → The SWR cache revalidates on focus. The status pill shows "active" (emerald). The banner is gone. The "Run now" button is enabled.

5. He clicks "Run now" in the UI → 202, redirected to the run detail page. He is satisfied the API and UI are consistent.

6. Later, he tries to PATCH with an invalid status: `{"status":"hibernating"}` → The `updateAgentLoopBodySchema` at `request-schemas.ts:35` rejects the value with HTTP 400: `{ errorKind: "invalid_request", message: "status: Invalid enum value. Expected 'draft' | 'active' | 'paused' | 'archived', received 'hibernating'" }` → He now knows the exact enum values.

7. He tries to PATCH with extra unknown keys: `{"status":"active","undocumentedField":true}` → The schema uses `.strict()` at `request-schemas.ts:40`. The server returns 400: `{ errorKind: "invalid_request", message: "undocumentedField: Unrecognized key(s) in object" }` → He notes the strict schema for future scripting.

### Variations

- **PATCH with no status field (only updating name)**: Permitted — `status` is optional in `updateAgentLoopBodySchema` (`request-schemas.ts:35`). The loop status is unchanged.
- **PATCH with `status: "archived"` directly from draft**: No guard in `updateAgentLoop` (`store.ts:164-211`) — any → any transition is permitted. The loop moves straight to archived without ever being active.

### Edge Cases

- **PATCH fires after the SWR cache has a stale `active` value from a prior session**: The `handleStatusChange` function in the UI (`loop-detail.tsx:184-216`) calls `mutateLoopData` after a successful PATCH to update the SWR cache optimistically. If the cache was already stale, the PATCH response body is used to update it (`body.loop` on success, or a full revalidation on missing body — `loop-detail.tsx:198-209`).

### UX Friction Observed

- The `loop_inactive` API error (`apps/web/app/api/agent-loops/[loopId]/runs/route.ts:83-89`) returns a clear, actionable message ("Update the loop status to 'active' first"), but this message never reaches the user — `handleRunNow` only surfaces 409 errors with `errorKind === "active_run"` as banners (`loop-detail.tsx:146-159`); other 409s fall to `toast.error(body.message ?? "Cannot start run right now.")`. A `loop_inactive` 409 would appear as a transient error toast, not the persistent gray banner the `disabled` button produces — if a user somehow bypasses the client-side disabled check (e.g., via DevTools or curl), they get a toast instead of the persistent callout.
- No formal state-machine documentation is surfaced in the UI, though the `schema.ts:933` enum and `request-schemas.ts:35` make the allowed values clear at the API level.

---

## STORY-008: Loop Paused at the Run Level vs. the Loop Level — Confusion Under Load

**Type**: long
**Persona**: Tomás, a senior engineer who has used Loops for a month. A run is paused mid-execution (via the run detail "Pause" button). He then tries to start a second run to test a different branch, not realizing the existing paused run blocks new runs.
**Goal**: Start a fresh manual run while a prior run is in `paused` run status
**Preconditions**: Loop "integration-test-runner" is `active` (loop status). Run `run_abc` is in `paused` run status from a prior manual trigger. Tomás opens the loop detail page.

### Steps

1. Tomás opens `/loops/loop_def`. The loop status pill shows "active" (emerald). The "Run now" button is enabled — he sees no visual warning that he is about to hit a conflict. He clicks "Run now" → `handleRunNow` fires `POST /api/agent-loops/loop_def/runs`.

2. The API call goes to `dispatchManualAgentLoopStart` → `hasActiveRunForLoop` at `store.ts:289-309` queries for runs with status `IN ('queued', 'running', 'paused')`. It finds `run_abc` (status: `paused`) and returns `run_abc`. The dispatcher returns `{ skipped: true, reason: "active_run", activeRunId: "run_abc" }`. The route returns 409.

3. `handleRunNow` in the UI receives the 409 with `errorKind === "active_run"` and `activeRunId === "run_abc"` → `setActiveRunNotice("run_abc")`. The amber banner appears: "This loop already has an active or paused run: `run_abc`. Wait for it to complete, resume, or cancel it before starting a new run."

4. Tomás is surprised. He thought "paused" at the run level meant the slot was free. He reads the banner carefully and notices the phrase "active or paused run" → He clicks the `run_abc` link in the banner and navigates to the run detail page.

5. On the run detail page he sees the run is `paused`. He clicks "Cancel" to free the slot. A confirmation dialog appears. He confirms. The run moves to `cancelled` (run status).

6. He navigates back to the loop detail page (`← integration-test-runner` breadcrumb on the run detail header). He clicks "Run now" → This time the 202 response fires. He is redirected to a new run.

### Variations

- **Tomás resumes instead of cancels**: He clicks "Resume" on the paused run. The run returns to `running`. Tomás navigates back to the loop detail page. "Run now" still 409s until the resumed run reaches a terminal state (`completed`, `failed`, `cancelled`, `stalled`).
- **Tomás waits for the stall sweep**: If the paused run was left unattended and the sweep runs (`/api/agent-loops/sweep`), paused runs are explicitly excluded from stall sweep candidates (per `findStalledLoopRunCandidates` at `store.ts:1203`, which only queries `status IN ('queued', 'running')`). A paused run will never be auto-stalled; it must be explicitly cancelled or resumed.

### Edge Cases

- **The SWR runs list shows the paused run but the 5 s cache hasn't refreshed**: `handleRunNow` falls back to scanning the local `runs` array for `running`, `queued`, or `paused` runs (`loop-detail.tsx:153-158`) when `body.activeRunId` is absent. This means even with a stale cache, the UI can find the paused run's ID to display in the banner as long as the last SWR fetch included it.
- **activeRunId is "unknown" in the banner**: If neither the API body nor the local runs list can identify the active run ID (`loop-detail.tsx:159`), the banner shows the monospace literal text "unknown" as the link target, which navigates to `/loops/{loopId}/runs/unknown` — a 404 on the run detail page. This is a very rare edge case but produces a broken link.

### UX Friction Observed

- The "Run now" button is fully enabled (not grayed, no tooltip, no banner) even when a paused run is blocking the next start (`loop-detail.tsx:242` only checks `loop.status !== "active"`). The user has to click and receive the 409 to learn about the conflict, even when the runs list visible on the same page shows a `paused` row.
- The amber 409 banner uses the phrase "active or paused run" (`loop-detail.tsx:258-260`) which maps correctly to `hasActiveRunForLoop`'s query at `store.ts:292-294`, but this nuance (that a paused run blocks new starts) is nowhere explained in the UI before the user hits it.
- Loop-level `paused` (blocks new runs, does not touch in-flight run) versus run-level `paused` (a run is suspended mid-execution) are conceptually very different but use the same word. Both the header status pill and the runs-list status pill use the same `StatusPill` component with the same muted style for `paused` (`loop-detail.tsx:64-81`), providing no visual distinction between the two concepts.
