# Sandbox Lifecycle: Provision, Hibernate, Restore, Reconnect, Fail, Absent

Source grounding for these stories:

- `apps/web/lib/sandbox/lifecycle.ts` — `SandboxLifecycleState` enum
  (`provisioning | active | hibernating | hibernated | restoring | archived |
  failed`), `SandboxLifecycleReason` enum, `evaluateSandboxLifecycle`.
- `apps/web/lib/sandbox/utils.ts` — sandbox-state predicates and the three
  `clear*SandboxState` variants that decide what survives a failure.
- `apps/web/app/api/sandbox/status/route.ts`, `.../reconnect/route.ts`,
  `.../snapshot/route.ts`, `.../extend/route.ts`, `.../activity/route.ts`,
  `apps/web/app/api/sandbox/route.ts` (create/delete).
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
  — the `_sandboxUiStatus` nine-pill computation (line ~3556),
  `runtimeToolsDisabledReason` (line ~3620), `attemptReconnection` /
  `syncSandboxStatus` (in `session-chat-context.tsx`).
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/sandbox-activity.ts` and
  `sandbox-activity-dialog.tsx` — the Sandbox Activity dialog and its
  independent `resolveTone` color computation.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/workspace-startup-status.tsx`
  and `apps/web/app/workflows/workspace-startup-log.ts` — the live log panel.
- `apps/web/app/workflows/chat-sandbox-runtime-impl.ts` — the server-side
  lazy provision/resume path that a chat send actually triggers.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/sandbox-create.ts` /
  `sandbox-create-error-banner.tsx` — the "Add sandbox" path for no-repo
  sessions and its error banner.

Two verified findings that shape several stories below (confirmed by `grep`
across `apps/web`, not inferred):

1. **`_handleRestoreSnapshot` and `_handleCreateNewSandbox`** (in
   `session-chat-content.tsx`) are the only client call sites for `PUT
   /api/sandbox/snapshot` (resume) and the manual create path, and both are
   underscore-prefixed unused functions — no button anywhere in the session
   chat page invokes them. There is no live "Restore sandbox" or "Create new
   sandbox" button. The only way a repo-backed session leaves `hibernated`
   (Paused) is sending a chat message, which triggers server-side lazy
   provisioning in `chat-sandbox-runtime-impl.ts` (`buildSandboxState`
   reconnects the named sandbox or recreates it under the same deterministic
   `session_<sessionId>` name).
2. **`POST /api/sandbox/extend` has no client caller anywhere in `apps/web`**
   (confirmed by `grep -rln "sandbox/extend"` returning only the route file
   itself). "Extend timeout" is a real, working API with a real reason
   (`timeout-extended`) and a real duration (`EXTEND_TIMEOUT_DURATION_MS` = 20
   minutes, rate-limited to 3/min), but there is no discoverable UI element
   that calls it.
3. **`_sandboxUiStatus.className`** (the nine-pill color) is computed but
   never applied to any rendered element — only `.label` is read, and it
   flows into `SandboxActivityDialog`, whose visible badge color comes from a
   *different*, coarser function (`resolveTone` in `sandbox-activity.ts`,
   5 tones: active/busy/paused/warning/offline) that keys off
   `lifecycleTiming.state === "failed"`, not `reconnectionStatus === "failed"`.
   A pill reading "Connection issue" is not guaranteed to render with the red
   `warning` tone — see STORY-309.

---

## STORY-301: First message on a brand-new repo session provisions the sandbox

**Type**: medium
**Topic**: Sandbox Lifecycle
**Persona**: Priya, opening a session she just created against her team's API repo, about to ask the agent to fix a failing test.
**Goal**: Send her first message and get a working sandbox without doing anything sandbox-specific.
**Preconditions**: Session just created, `session.sandboxState` is `null`, `lifecycleState` is `null` (**absent** — never provisioned). Pill area shows "No sandbox."
**Ideal path**: 1 — type the message and press send; provisioning is entirely server-side and implicit.
**Alternate paths**: none found — there is no manual "Create sandbox" button visible for a repo-backed session (that affordance only exists for repo-less sessions via "Add sandbox").

### Steps
1. Priya types her first message and presses send → chat status becomes `submitted`/`streaming`; `WorkspaceStartupStatus` appears under the last message with a spinner and "Thinking…" as the default `status.message`.
2. Server-side workflow (`chat-sandbox-runtime-impl.ts`) starts provisioning → the client's `reconnectionStatus`/pill logic is irrelevant during this window because `showThinkingIndicator` drives visibility, not the pill.
3. `data-workspace-status` chunks arrive and update the panel in order: "Setting up the workspace...", then (if repo access needs verifying) "Repository access verified.", then "Starting the sandbox...", then "Sandbox is ready." → each replaces `status.message`; each call also appends terminal log lines under a "Startup logs" header (`Terminal` icon, monospace, max 120 lines, 420 chars/line, secrets redacted).
4. Sandbox is ready → workflow clones the repo, runs skill installs, and the agent's first tool call executes → assistant content starts streaming → `WorkspaceStartupStatus` unmounts (`showThinkingIndicator` goes false once assistant content exists).
5. Independently, the client's own `attemptReconnection()` (fired on mount since `sandboxInfo` was falsy) resolves once the DB row updates, and `_sandboxUiStatus` will read "Active" once `serverSaysActive` and `sandboxInfo` line up.

### Variations
- Repo access needs a fresh installation token → adds "Repository access verified." log line before "Starting the sandbox..."; no separate error state at this stage unless the mint fails (see STORY-310-adjacent failure paths, not written up separately here since it is a GitHub-App concern, not lifecycle).
- Session has global or user skills configured → an extra "Installing session skills..." status line appears before "Workspace setup finished."

### Edge Cases
- If the user reloads the page mid-provision, the pill computation shows "Creating" only while `isCreatingSandbox` (a purely client-local `useState`) is true for *that* browser tab — a fresh page load has `isCreatingSandbox = false` by definition, so a reload during provisioning shows "No sandbox" or "Reconnecting" instead of "Creating," even though provisioning is still running server-side. The user has no way to tell from the pill alone that a provision is already in flight; the `WorkspaceStartupStatus` panel (tied to the chat stream, not the pill) is the only thing that would still show progress, and only if the stream is still attached in that tab.

---

## STORY-302: A session goes idle and hibernates while the user is away

**Type**: short
**Topic**: Sandbox Lifecycle
**Persona**: Marcus, who leaves a session's tab open in a background window for over 30 minutes while in a meeting.
**Goal**: No goal — this is what happens to him, not something he does.
**Preconditions**: `lifecycleState = "active"`, no chat stream running, `hibernateAfter` in the past.
**Ideal path**: 0 — this is a background/automatic transition; there is no user action.
**Alternate paths**: none found — hibernation has no manual trigger in the UI (no "Pause sandbox" button exists anywhere in `session-chat-content.tsx`).

### Steps
1. `evaluateSandboxLifecycle(sessionId, reason)` runs on the durable workflow's wake schedule → `getLifecycleDueAtMs` says now is past due (`hibernateAfter` or `sandboxExpiresAt - SANDBOX_EXPIRES_BUFFER_MS`, whichever is sooner) → no active chat stream (`hasActiveStreamForSession` false) → lifecycle flips to `"hibernating"`.
2. The sandbox is stopped (`sandbox.stop()`); on success, DB is updated via `buildHibernatedLifecycleUpdate()`: `lifecycleState = "hibernated"`, `sandboxExpiresAt = null`, `hibernateAfter = null`, `snapshotUrl/snapshotCreatedAt = null`. `sandboxState` is reduced by `clearSandboxState` to just `{type, sandboxName}` (resumable handle kept).
3. Back in Marcus's browser: the 15-second `requestStatusSync("normal")` poll picks up `lifecycle.state = "hibernated"` on its next tick → `isServerHibernated && hasSnapshot` → pill flips to "Paused."
4. If Marcus happened to be looking at the tab during the transition, he would briefly see "Hibernating" (`isServerHibernating` true) before it settles to "Paused."

### Variations
- If a background stream *is* still active (e.g., a headless MCP run), `hasActiveStreamForSession` is true and the evaluator returns `{action: "skipped", reason: "active-workflow"}` — no hibernation happens, sandbox stays active regardless of inactivity elapsed.

### Edge Cases
- If `sandbox.stop()` throws mid-hibernation, the catch block sets `lifecycleState = "failed"` with `lifecycleError` holding the raw error message, and clears `lifecycleRunId`. See STORY-311 for what the user actually experiences from this.
- Marcus polls every 15s only while `document.visibilityState === "visible"`; a background tab stops polling, so the pill can be stale (still "Active") for an arbitrarily long time until he refocuses the tab, at which point the next poll corrects it.

---

## STORY-303: Returning to a Paused session — sending a message is the only resume

**Type**: medium
**Topic**: Sandbox Lifecycle
**Persona**: Priya, back the next morning, opening yesterday's session to continue the same fix.
**Goal**: Get the sandbox back and keep working.
**Preconditions**: `lifecycleState = "hibernated"`, `hasSnapshot = true` (resumable `sandboxName` still present), pill shows "Paused."
**Ideal path**: 1 — type a message and send; the resume is invisible and happens inside the same chat turn (this IS the ideal path, verified: there is no working "Restore" button, so the product's actual designed path is "just send a message").
**Alternate paths**: none found. `_handleRestoreSnapshot` exists in the codebase and would call `PUT /api/sandbox/snapshot`, but no button wires to it — confirmed dead code, not a hidden shortcut.

### Steps
1. Priya opens the session → on mount, `attemptReconnection()` fires automatically (since `sandboxInfo` is null and `reconnectionStatus === "idle"`) → `GET /api/sandbox/reconnect` sees `hasRuntimeSandboxState(sandboxState)` is false → returns `{status: "no_sandbox", hasSnapshot: true, lifecycle: {...}}`.
2. Client sets `reconnectionStatus = "no_sandbox"`; pill logic hits `isServerHibernated && hasSnapshot` → "Paused."
3. `runtimeToolsDisabledReason` reads "Restore the sandbox before using runtime tools." — but hovering the dev-server Play button or the code-editor icon is the *only* place this sentence appears; there is no button whose label or action is literally "Restore."
4. Priya, trusting the product, just continues the conversation and sends her next message → the chat request reaches `chat-sandbox-runtime-impl.ts`, which calls `buildSandboxState(session)` (reusing the persisted `sandboxName`) and connects/resumes it inline as part of answering her message → `WorkspaceStartupStatus` reappears with startup log lines exactly as in STORY-301 (the server does not distinguish "cold create" from "resume" in the log copy the user sees — both say "Starting the sandbox...").
5. Once resumed, her message is answered normally; the pill catches up to "Active" on the next status sync.

### Variations
- If she instead opens the code editor or clicks "Start dev server" first (before sending a chat message), those actions are simply disabled with the "Restore the sandbox before using runtime tools." tooltip — there is no click target that resumes the sandbox for her. She must go back to the composer and type something.

### Edge Cases
- **What Priya is thinking**: the tooltip tells her to "restore the sandbox" as an instruction, but nothing in the UI is labeled "Restore" — no button, no menu item, no icon with that name. The only working recovery action (sending a chat message) is not phrased as a sandbox action at all. A user who read the tooltip literally and went looking for a "Restore" control would not find one.
- If the resume fails inside the chat workflow (e.g., the named sandbox was evicted), the failure surfaces as part of the chat turn's own error handling, not as a dedicated sandbox banner — there is no `sandbox-create-error-banner` equivalent for this path since that banner only wires to the dead client-side create flow.

---

## STORY-304: The reconnect probe flashes "Reconnecting" on every page load

**Type**: short
**Topic**: Sandbox Lifecycle
**Persona**: Devon, who reloads the session tab after a laptop sleep/wake cycle.
**Goal**: Just wants the page to show accurate status quickly.
**Preconditions**: Session has a live, unexpired sandbox (`lifecycleState = "active"`), but the client just mounted so local `sandboxInfo` is null.
**Ideal path**: 0 — this happens automatically on every page load; there's nothing for Devon to click.
**Alternate paths**: none found.

### Steps
1. Page mounts → `sandboxInfo` is null, `isCreatingSandbox`/`isRestoringSnapshot` are false, `reconnectionStatus === "idle"` → the mount effect calls `attemptReconnection()`.
2. While the fetch to `GET /api/sandbox/reconnect` is in flight, `reconnectionStatus === "checking"` and `sandboxInfo` is still null → `isReconnectingSandbox` is true → pill shows "Reconnecting."
3. Server: since `state.sandboxName` is set, `connectSandbox` uses the fast-path (skips the `exec("pwd")` probe) and the route hits `hasActiveFutureSandboxState` — if the DB already shows `lifecycleState: "active"` with a future `sandboxExpiresAt`, the "db-fast" path returns `connected` without ever touching the sandbox provider.
4. Client receives `status: "connected"` → `sandboxInfo` populated, `reconnectionStatus = "connected"` → pill flips to "Active."

### Variations
- If the DB-fast shortcut doesn't apply (state is stale or ambiguous), the server falls through to the live probe (`sandbox.exec("pwd", ...)`, 15s timeout) before answering — reconnect can visibly take longer, and "Reconnecting" stays up correspondingly longer.

### Edge Cases
- This "Reconnecting" flash happens on **every** fresh page load of an active session, not just after a real disconnect — a user who reloads a session that never actually lost its sandbox still sees the label for however long the round-trip takes. Nothing in the copy distinguishes "routine confirmation" from "the sandbox may actually be gone," so a fast flash and a slow, worrying flash look identical while they're happening.

---

## STORY-305: A sandbox is evicted between sessions — "expired" clears the resume handle

**Type**: medium
**Topic**: Sandbox Lifecycle
**Persona**: Marcus, opening a session he hasn't touched in three days.
**Goal**: Understand why the sandbox is gone and get back to work.
**Preconditions**: `lifecycleState = "hibernated"` (or stale `"active"` with an expired `sandboxExpiresAt`), but the underlying Vercel sandbox has actually been evicted by the provider.
**Ideal path**: 1 — send a message; the server-side lazy-provision path recreates a sandbox under the same deterministic name and re-clones the repo, so from Marcus's side this looks identical to STORY-303 even though the old VM is gone forever.
**Alternate paths**: none found.

### Steps
1. Marcus opens the session → `attemptReconnection()` fires → server tries `connectSandbox(state)` and the provider probe/connect throws a "not found"/410-class error → `isSandboxUnavailableError(message)` is true.
2. Server clears state via `clearUnavailableSandboxState`: because this is a 404-class not-found error, `clearSandboxResumeState` runs, wiping even the resumable `sandboxName` (not just runtime fields) → `updateSession` sets `sandboxState: {type: "vercel"}`, `lifecycleState: "hibernated"` (via `buildHibernatedLifecycleUpdate`).
3. Response: `status: "expired"`, `hasSnapshot` computed from the *post-clear* state — since the name was wiped, `hasResumableSandboxState` is false, so `hasSnapshot` is false too (unless `sessionRecord.snapshotUrl` still holds a legacy value).
4. Client: `data.status === "expired"` is not one of the three branches the client code checks by name (`"connected"`, `"no_sandbox"`, `"expired"` — the client's fallback `else` branch handles it) → falls to the generic `setReconnectionStatus("failed")` branch, clearing `sandboxState` further via `clearSandboxState`.
5. Pill: no snapshot, `reconnectionStatus === "failed"` → "Connection issue."
6. Marcus sends a message anyway → `buildSandboxState` has no `getResumableSandboxName`, so it falls back to `getSessionSandboxName(session.id)` (the deterministic `session_<id>` name) and creates a brand-new sandbox with `createIfMissing`, re-cloning the repo from scratch. Any uncommitted work in the old VM is gone; this is a fresh workspace with the same session history.

### Variations
- A **transient** (non-404) unavailable-condition error keeps the resumable name (`clearSandboxState` instead of `clearSandboxResumeState`), and the client separately has a non-fatal "reconnect-transient" warning path (`warningKind: "sandbox_reconnect_transient"`) that keeps `status: "connected"` with a possibly-stale `expiresAt` — the user sees no visible difference from a normal reconnect in this case, even though the server logged a warning.

### Edge Cases
- **What Marcus is thinking**: the pill just says "Connection issue" — no explanation of *why* (evicted VM vs. network blip vs. account problem), no mention that his workspace will be a fresh clone on next use, no indication of whether uncommitted changes are recoverable (they are not, once the VM is evicted — but nothing tells him that before he sends the message that triggers a silent full recreate).
- If `sessionRecord.snapshotUrl` (the legacy field) still holds a value even after the sandbox name is wiped, `hasSnapshot` can be `true` from that alone, and the pill would show "Paused" instead of "Connection issue" for what is actually a fully evicted sandbox — the legacy snapshot path and the named-sandbox path can disagree about whether resume is really possible.

---

## STORY-306: Hunting for a way to extend the sandbox before a long-running task

**Type**: long
**Topic**: Sandbox Lifecycle
**Persona**: Priya, mid-way through a large refactor, watching context accumulate and worried the agent will get cut off mid-task.
**Goal**: Extend the sandbox's remaining time before it expires, the way she's used to doing on other cloud dev-environment products.
**Preconditions**: `lifecycleState = "active"`, sandbox has been running long enough that she's thinking about its expiry (default hard timeout ~90 minutes on Pro plans, ~40 on Hobby, minus a 30s buffer).
**Ideal path**: none — there is no UI action that reaches `POST /api/sandbox/extend`. The only way total sandbox lifetime is extended today is indirectly, by keeping the chat active (each turn's `buildActiveLifecycleUpdate` refreshes `sandboxExpiresAt` from the sandbox's own `expiresAt`, and focusing the composer pings `/api/sandbox/activity` to push out `hibernateAfter`) — neither of those calls the extend endpoint or its 20-minute grant.
**Alternate paths**: none found — verified by `grep -rln "sandbox/extend"` across `apps/web`: the only file referencing the route is the route handler itself.

### Steps
1. Priya opens the Sandbox Activity dialog (the pill/dialog trigger button) hoping to find a timer or an extend control → sees stat tiles (Events, Running, Services, Tool uses) and detail rows for Lifecycle, Last activity, Hibernate after, Expires, Recorded work → the "Expires" row shows an absolute time (`formatDateTime`, e.g. "Aug 17, 4:05 PM"), not a countdown, and there is no button anywhere in the dialog.
2. She checks the composer toolbar (where the runtime mode selector, workflow picker, and the dialog trigger itself live) → no "Extend" icon or menu item exists there either.
3. She opens the Runtime Inspector (`RuntimeObservabilityPanel`, via `onOpenInspector`) → sees "Session Runtime" (Mode/Workflow/Sandbox/Profile Run) and further sections (Actors, Managed Profile, Services, Browser Checks, Event Timeline) — none of them expose an extend action either.
4. She concludes there is no way to proactively extend and just keeps working, hoping activity pings and per-turn refreshes keep it alive long enough.
5. Unbeknownst to her, the `EXTEND_TIMEOUT_DURATION_MS` (20 minutes) constant and the `timeout-extended` lifecycle reason exist and are fully wired server-side (rate-limited to 3 calls/minute per user) — the capability was built and then never given a caller.

### Variations
- If she had instead just kept sending chat messages, `buildActiveLifecycleUpdate(sandboxState)` on each turn recomputes `sandboxExpiresAt` from the *sandbox's own* `expiresAt` value, which does track the underlying VM's real timeout — so active use does keep the session alive in practice, just never through the dedicated extend endpoint, and with no user-visible confirmation that it happened.

### Edge Cases
- **What Priya is thinking**: "every other cloud IDE I've used has an 'extend session' button — where is it here?" She has no way to know the capability exists in the backend at all; from her side, this reads as a missing feature, not a hidden one.
- If the sandbox *does* expire mid-task with no way to have proactively extended it, the failure she experiences is whatever the in-flight tool call does when the VM disappears — not a graceful "your time is running out, extend now?" warning, because no such warning exists either.

---

## STORY-307: Reading the disabled-tool tooltip to figure out why nothing works

**Type**: short
**Topic**: Sandbox Lifecycle
**Persona**: Devon, clicking the code editor icon right after opening a session, before it's finished restoring.
**Goal**: Understand why "Start dev server" and the code editor button are greyed out.
**Preconditions**: Session in one of `isCreatingSandbox`, `isRestoringSnapshot`/`isServerRestoring`, `isReconnectingSandbox`, `isHibernatingUi`, or `isServerHibernated && hasSnapshot` (but not yet active).
**Ideal path**: 1 — hover the disabled icon and read the tooltip; the exact reason string is always present, so no digging is required.
**Alternate paths**: none found.

### Steps
1. Devon hovers the "Start dev server" Play icon (disabled because `runtimeToolsDisabledReason !== null`) → tooltip shows one of, in priority order: "Archived sessions cannot run sandbox tools." → "The sandbox is still being created." → "The sandbox is still restoring." → "The sandbox is reconnecting." → "The sandbox is hibernating." → "Restore the sandbox before using runtime tools." → "Send a message to start the sandbox before using runtime tools." (this last one covers both never-provisioned and cleared-by-failure states).
2. Devon hovers the code editor icon → same `runtimeToolsDisabledReason` feeds `codeEditorActionDisabledReason` (falling back to a separate `codeEditorDisabledReason` only when the runtime reason is null) → identical copy.
3. The pill next to these controls (surfaced through the Sandbox Activity dialog trigger, see STORY-309) shows a matching state label at the same time, so the two signals agree — but they are computed from overlapping-but-not-identical boolean sets (`_sandboxUiStatus` vs. `runtimeToolsDisabledReason`), so in principle they could diverge (see Edge Cases).

### Variations
- Archived sessions always show "Archived sessions cannot run sandbox tools." regardless of any other state — it is checked first.

### Edge Cases
- The reason strings describe *what phase the sandbox is in*, never *how long it will take* or *what to do* beyond "restore" (unlabeled action, see STORY-303) or "send a message." A user blocked on "The sandbox is still restoring." has no ETA and no way to know if it's stuck.
- `runtimeToolsDisabledReason` and `_sandboxUiStatus` share most of their inputs (`isArchived`, `isCreatingSandbox`, `isRestoringSnapshot`/`isServerRestoring`, `isReconnectingSandbox`, `isHibernatingUi`) but the pill has an extra terminal case (`reconnectionStatus === "failed"` → "Connection issue") that the tool-reason logic folds into the same generic "Send a message to start the sandbox before using runtime tools." as a plain absent sandbox — so "Connection issue" and "never had a sandbox" produce the *same* disabled-tool tooltip even though the pill distinguishes them.

---

## STORY-308: Archiving a session while its sandbox is still live

**Type**: medium
**Topic**: Sandbox Lifecycle
**Persona**: Priya, merging her PR and choosing "Merge & Archive" right after the agent finished a turn.
**Goal**: Archive the session for good, now that the work has shipped.
**Preconditions**: `lifecycleState = "active"` with a live, unexpired sandbox (`hasRuntimeSandboxState` true) at the moment `session.status` flips to `"archived"`.
**Ideal path**: 1 — use "Merge & Archive" from the PR panel; archiving itself needs no further sandbox action from Priya.
**Alternate paths**: archiving directly from the session/inbox sidebar without going through merge reaches the same `isArchived` state.

### Steps
1. `session.status` becomes `"archived"` → `isArchived` computed as `session.status === "archived"` → pill logic's first check (`if (isArchived) return "Archived"`) wins unconditionally, before any of the creating/restoring/hibernating/reconnecting checks are even evaluated.
2. The mount/reconnect effect explicitly skips itself for archived sessions (`if (isArchived) return;` inside the `attemptReconnection` trigger effect) — so an archived session never re-probes the sandbox from this point on, regardless of what the sandbox is actually doing.
3. Separately, `isArchiveSnapshotPending = isArchived && hasRuntimeSandboxState` is computed but only feeds internal bookkeeping — the pill itself still just says "Archived" whether or not a live sandbox is still running underneath.
4. `runtimeToolsDisabledReason` also short-circuits to "Archived sessions cannot run sandbox tools." — all runtime tools go dark immediately.
5. Whether the still-running sandbox actually gets hibernated/stopped as part of archiving depends entirely on the lifecycle workflow's own schedule (`evaluateSandboxLifecycle`, which explicitly skips archived sessions: `if (session.status === "archived" ...) return {action: "skipped", reason: "session-archived"}`) — the lifecycle evaluator will never touch an archived session's sandbox again, so a sandbox that was mid-turn at archive time is left exactly as it was until its own hard `sandboxExpiresAt` eventually elapses on the provider side.

### Variations
- none found — the archive-time sandbox state (idle vs. mid-tool-call) does not change any of the client-visible behavior; the pill reads "Archived" either way.

### Edge Cases
- **What the user is thinking**: nothing — this is invisible to Priya. But operationally: `evaluateSandboxLifecycle` explicitly refuses to hibernate archived sessions, so a sandbox that is running at the exact moment of archive keeps running (and billing) until its provider-side hard timeout, with the product's own lifecycle machinery deliberately not intervening.

---

## STORY-309: The Sandbox Activity dialog repeats the pill — and can disagree with it

**Type**: medium
**Topic**: Sandbox Lifecycle
**Persona**: Marcus, trying to figure out why his sandbox seems unreachable and clicking through every status surface he can find.
**Goal**: Get a clear, trustworthy read on what's wrong with the sandbox.
**Preconditions**: `reconnectionStatus === "failed"`, no snapshot (`hasSnapshot = false`) — pill computed as "Connection issue" (`className: "bg-destructive/10 text-destructive"`, though this class is never actually applied anywhere, see below).
**Ideal path**: N/A — this is an investigation story, not a task with a single correct action; the point is what he sees while looking.
**Alternate paths**: N/A.

### Steps
1. Marcus looks at the composer toolbar's Sandbox Activity dialog trigger button — this is the *only* place the nine-pill label is actually rendered on screen; `uiStatusLabel={_sandboxUiStatus.label}` is passed in as `"Connection issue"`.
2. The trigger button's colored dot, however, is **not** driven by `_sandboxUiStatus.className` (which computed `"bg-destructive/10 text-destructive"` but is never read anywhere in the codebase) — it's driven by `buildSandboxActivitySummary`'s own `resolveTone()`, which only turns red (`"warning"`) when `failedEvents > 0` or `lifecycleTiming.state === "failed"`. A reconnect failure (`reconnectionStatus === "failed"`) with a normal (non-`"failed"`) `lifecycleState` does not satisfy either condition, so the dot most likely renders muted/offline-gray, not red — the text says "Connection issue" but the color does not visually escalate it.
3. Marcus opens the dialog → the header re-shows the same "Connection issue" text as a badge (again colored by `resolveTone`, same mismatch) plus a description line, a "current activity" line (`resolveCurrentActivity` — falls through several data sources before landing on "No sandbox is attached to this session." if nothing else applies), and detail rows for Lifecycle/Last activity/Hibernate after/Expires — the raw `lifecycleState` value shown here (`formatLifecycleState`, underscores replaced with spaces) may read as something ordinary like "hibernated" even while the pill outside says "Connection issue," because they're driven by `lifecycleTiming.state` and `reconnectionStatus` respectively — two different pieces of state that update on different triggers (poll vs. reconnect probe).
4. Marcus also has the Runtime Inspector (`RuntimeObservabilityPanel`) available, which shows a third, independent "Sandbox" info row (just the sandbox name/id, no lifecycle state) and its own Event Timeline — a third place to look, with no lifecycle summary of its own.

### Variations
- If `failedEvents > 0` (a real event was logged as `"failed"` or `"blocked"`) the dialog's tone *does* correctly go red — the mismatch only appears for a pure client-side reconnect failure with no corresponding failed event/lifecycle record.

### Edge Cases
- **What Marcus is thinking**: he's cross-checking three surfaces (pill/dialog trigger, dialog body, Runtime Inspector) that all read from the same underlying session but were built at different times with different derivation logic, and their answers don't always agree. He has no way to know which one is authoritative.
- The dialog trigger is `disabled={!showDialog}` where `showDialog = hasSandboxState || hasSnapshot || summary.stats.events > 0` — for a genuinely never-provisioned session with zero events, the button is disabled with only an `aria-label` (no visible tooltip), so a sighted user gets no explanation at all for why the button doesn't respond to clicks.

---

## STORY-310: Adding a sandbox to a no-repo session, and what happens when it fails

**Type**: medium
**Topic**: Sandbox Lifecycle
**Persona**: Devon, using an "empty" (no-repo) session as a scratch environment to test a shell script.
**Goal**: Attach a sandbox so he can run commands.
**Preconditions**: `session.cloneUrl` is unset, `session.sandboxState` is `null` (the true "absent" state — this session type never auto-provisions on message send the way repo sessions do, since `SandboxFreeRuntime` (`mode: "sandbox-free"`) is a valid, intentional resting state).
**Ideal path**: 1 — click "Add sandbox" in the composer toolbar (only rendered when `!session.sandboxState && !isArchived`).
**Alternate paths**: none found — repo-backed sessions never show this button; it only exists for the sandbox-free case.

### Steps
1. Devon clicks "Add sandbox" (`Box` icon, tooltip "Add a sandbox to enable runtime tools for this session") → `handleAddSandbox` runs → `isCreatingSandbox = true`, button shows a spinner.
2. Client calls `createOnDemandSandboxForSession`: first `POST /api/sessions/{sessionId}/sandbox` (attach — sets DB-side intent), then `createSandbox(...)` (`POST /api/sandbox`, no `repoUrl`) to actually provision the VM.
3. On success: `setSandboxInfo`, `requestStatusSync("force")` → pill moves through "Creating" → "Active" as the status poll catches up.
4. On failure: `getSandboxCreateErrorDetails(err)` extracts a message (specific server message if present, or a 403-specific "Sandbox access denied. Please reconnect GitHub and try again." fallback, or a generic "Failed to create sandbox. Please try again.") → shown in `SandboxCreateErrorBanner` above the composer, dismissible → the client also best-effort calls `resetSandboxProvisioning` (`DELETE /api/sessions/{sessionId}/sandbox`) to roll back the attach, swallowing any error from that rollback itself (only logs a console warning).

### Variations
- A 403 specifically produces the GitHub-reconnect-flavored fallback message even for a sandbox-free session with no repo involved — the fallback copy assumes a GitHub-access cause, which may not be why a no-repo sandbox creation was denied.

### Edge Cases
- If the rollback (`resetSandboxProvisioning`) itself fails, the session is left in whatever partially-attached DB state the first call produced, with no user-visible indication — the banner only reports the original creation error, not a rollback failure.
- After a failed attempt, `session.sandboxState` may or may not still be `null` depending on whether the rollback succeeded; if it isn't, the "Add sandbox" button (gated on `!session.sandboxState`) disappears even though no sandbox was ever successfully created — leaving Devon with no working sandbox and no visible way to retry from this surface.

---

## STORY-311: A lifecycle marked "failed" quietly heals itself the next time anyone looks

**Type**: long
**Topic**: Sandbox Lifecycle
**Persona**: Marcus, who left a session open overnight; the hibernation attempt errored server-side while he was asleep.
**Goal**: None directly — he just opens the session the next morning expecting it to work.
**Preconditions**: `lifecycleState = "failed"` in the DB (set by the catch block in `evaluateSandboxLifecycle` when `sandbox.stop()` or a related call threw), while the sandbox itself is actually still alive and reachable (the failure was in the lifecycle bookkeeping, not in the VM).
**Ideal path**: 1 — open the session; both `/api/sandbox/status` (on the periodic poll) and `/api/sandbox/reconnect` (on mount) independently detect and repair this without Marcus doing anything extra.
**Alternate paths**: either surface alone is sufficient — `status` heals it if `isActive` is true at poll time; `reconnect` heals it if the live probe/fast-path succeeds. Both run on a normal page load, so in practice this self-heals almost immediately.

### Steps
1. Marcus opens the session → `attemptReconnection()` fires on mount → `GET /api/sandbox/reconnect`: `shouldRecoverFailedLifecycle = sessionRecord.lifecycleState === "failed"` is true → the live probe/fast-path succeeds (the VM never actually went away) → `updateSession` is called with `lifecycleState: "active", lifecycleError: null` alongside the refreshed sandbox state, in the *same* update as the routine reconnect sync (so this costs nothing extra).
2. In parallel, the 15s status poll (`GET /api/sandbox/status`) has its own independent recovery: `if (isActive && sessionRecord.lifecycleState === "failed")` → same repair, `lifecycleState: "active", lifecycleError: null`.
3. Marcus's pill never shows anything unusual: by the time any client render reflects `lifecycleState === "failed"`, one of the two self-heal paths has typically already fired within the same request cycle, so the failure is invisible end-to-end.
4. Nothing is ever surfaced to Marcus that a failure occurred and was auto-corrected — no toast, no log line in `WorkspaceStartupStatus`, no entry visible in the Sandbox Activity dialog's "Recent sandbox activity" list unless the original hibernation-attempt error happened to also emit a session event (the lifecycle evaluator's catch block only `console.error`s server-side).

### Variations
- If the sandbox is genuinely gone (not just a bookkeeping failure), the *same* reconnect call instead hits the `isSandboxUnavailableError` branch and does the STORY-305 eviction handling instead — the self-heal and the eviction-clear are two branches of the same function, distinguished only by whether the live probe actually succeeds.

### Edge Cases
- **What Marcus is thinking**: nothing, because there's nothing to notice — which is the intended behavior, but it also means a real, `console.error`-logged backend failure from the previous night leaves zero trace in any user-facing surface once it self-heals. An operator debugging "why did this session's lifecycle fail last night" has to go to server logs; the product itself shows a clean "Active" pill as if nothing happened.
- If neither self-heal path runs (e.g., the user never reopens the session, or opens it only through a route that skips both `/status` and `/reconnect`), `lifecycleState` stays `"failed"` indefinitely — there is no proactive repair job for `failed` sessions that aren't being looked at.

---

## STORY-312: A restore fails because the saved sandbox is gone for good

**Type**: short
**Topic**: Sandbox Lifecycle
**Persona**: Priya, whose session sat hibernated for weeks past its provider-side retention window.
**Goal**: Pick the session back up.
**Preconditions**: `lifecycleState = "hibernated"`, a persistent `sandboxName` is recorded, no legacy `snapshotUrl` fallback — and the named sandbox has been permanently evicted by the provider (404-class).
**Ideal path**: 1 — send a message; this is the same lazy-provision path as STORY-303/305, and it succeeds by recreating a fresh sandbox under the same deterministic name, so Priya's actual experience is indistinguishable from a normal resume.
**Alternate paths**: none found for this specific 404-with-no-legacy-fallback case *through the API route itself* — `PUT /api/sandbox/snapshot` would, if it were reachable, respond 404 with `errorKind: "sandbox_resume_unavailable"` and the message "Saved sandbox is no longer available. Create a new sandbox." and clear the resumable name server-side — but since no button calls this route (see the header note), Priya never sees that response at all; the chat-send path is the one that actually runs and it does not share this failure mode because it always passes `createIfMissing: true`/recreates rather than strictly resuming.

### Steps
1. Priya sends a message on the long-hibernated session.
2. `chat-sandbox-runtime-impl.ts`'s `buildSandboxState` resolves the sandbox name from `getResumableSandboxName(existingState)` (still present, since hibernation alone doesn't wipe it — only a confirmed 404 during a probe does, per `clearUnavailableSandboxState`) and connects with `createIfMissing`-equivalent semantics.
3. Provider reports the named sandbox doesn't exist → the workflow's own resume/recreate handling (informed by `isRecreatableSandboxError`, the lenient not-found check used specifically for this warm-reconnect-recreate decision) treats this as "recreate," not as a hard failure — a new VM comes up under the same name, the repo is re-cloned, and the turn proceeds.
4. Priya sees the normal `WorkspaceStartupStatus` sequence (STORY-301) and her message gets answered. She has no way to know her previous workspace state (any uncommitted edits, installed deps, running processes) is gone — the product silently gives her a clean slate under the same session.

### Variations
- If the *dead* `PUT /api/sandbox/snapshot` route were ever wired up again, this exact scenario would instead surface as a blocking 404 with "Saved sandbox is no longer available. Create a new sandbox." and no automatic recreate — a meaningfully different (more honest, less silent) failure mode than what actually ships today.

### Edge Cases
- The two code paths that both "resume" a named sandbox — the dead `PUT /api/sandbox/snapshot` route and the live `chat-sandbox-runtime-impl.ts` path — disagree on what a hard-404 means: one treats it as a terminal, user-facing error requiring an explicit "create new," the other treats the identical condition as routine and silently recreates. Only the second path is actually reachable today.

---

## STORY-313: Watching startup log lines for a slow or stuck provision

**Type**: short
**Topic**: Sandbox Lifecycle
**Persona**: Devon, whose session's setup is taking unusually long (large monorepo clone).
**Goal**: Confirm the sandbox isn't stuck, and see what it's actually doing.
**Preconditions**: Mid-provisioning or mid-restore turn, `WorkspaceStartupStatus` visible with `logLines.length > 0`.
**Ideal path**: 0 — this is a passive-observation story; there's no action, just reading.
**Alternate paths**: the Sandbox Activity dialog and Runtime Inspector are open at the same time in principle, but neither shows live startup log lines — those only exist inside `WorkspaceStartupStatus`, scoped to the active chat stream.

### Steps
1. Devon watches the terminal-styled panel (`bg-zinc-950`, monospace, `Terminal` icon, "Startup logs" title by default or the reporter's custom title) scroll as new lines append (`max-h-52 overflow-auto`, newest content pushes the view).
2. Each `startupReporter.send(...)` call both replaces the one-line status message above the panel and appends 1+ lines to the log (secrets redacted via `SECRET_PATTERNS` — Bearer/Basic auth headers, `api_key=`/`token=`/`secret=`/`password=` query-style pairs, and JWT-shaped triples are all replaced with `[REDACTED]`).
3. Command output specifically (`appendCommandResult`) is formatted as `exit {code}: {command}` followed by up to the last 24 lines of combined stdout+stderr, each line capped at 420 characters with a trailing ellipsis if truncated.
4. If setup genuinely stalls (no new `data-workspace-status` chunk arrives), the panel simply stops updating — the spinner keeps spinning next to the last message, and the log pane keeps showing its last lines. Nothing tells Devon how long is "too long."

### Variations
- A managed-runtime session shows profile-specific setup/verification step messages (`Managed runtime profile setup (2/4): ...`) interleaved with the generic sandbox-starting messages.

### Edge Cases
- The log buffer caps at 120 lines total (oldest lines silently drop off, `.slice(-MAX_LOG_LINES)`) — for a very chatty setup (long dependency installs), Devon may lose the earliest lines (e.g., the original clone output) by the time setup finishes, with no way to scroll back further or export the full log.
- The panel and its log only exist for the duration of `showThinkingIndicator` being true; once any assistant content renders, the whole thing unmounts — if setup fails right at the boundary, Devon may see the panel disappear rather than show a terminal error state, with the actual failure explanation living in the chat's own error/message content instead.

---

## STORY-314: A managed-runtime profile mismatch during restore, seen only in the Inspector

**Type**: medium
**Topic**: Sandbox Lifecycle
**Persona**: Priya, whose team recently changed the default managed runtime profile for her repo.
**Goal**: Understand why the agent's tool access looks different after resuming an old session.
**Preconditions**: Session in `managed_runtime` mode, sandbox resumed (from Paused, via a chat send per STORY-303) with a profile resolution that differs from what was requested.
**Ideal path**: 2 — send the message that triggers resume, then open the Runtime Inspector (`onOpenInspector`) to see the mismatch banner; the mismatch is not shown anywhere else.
**Alternate paths**: none found — this detail is exclusive to `ProfileRunSection` inside `RuntimeObservabilityPanel`; the pill, the Sandbox Activity dialog, and `WorkspaceStartupStatus` do not surface a profile mismatch at all.

### Steps
1. Priya sends a message → sandbox resumes → `ensureManagedRuntimeEnvironment` runs → a profile run record is created with `requestedProfileId` and `resolvedProfileId`.
2. She opens the Runtime Inspector → "Managed Profile" section → if `requestedProfileId !== resolvedProfileId`, an amber banner reads "Requested profile `<requestedProfileId>` does not match resolved profile `<resolvedProfileId>`." above the profile detail rows.
3. Below that, `expectedTools`/`optionalTools` and a per-tool reason list (`ToolReasonList`, using `getManagedRuntimeToolReason`) explain what each tool is for and why the profile needs it — the closest thing in this topic area to a "why is this disabled" explanation, but scoped to tool *requirements*, not sandbox *lifecycle state*.

### Variations
- If profile-run observation recording itself fails (a DB write failure, unrelated to the sandbox lifecycle), the note "Evidence unavailable: this run's setup/verification results could not be saved." is pushed into the startup log instead, and the Inspector falls back to "Evidence unavailable: managed runtime ran for this chat, but no profile run record was found."

### Edge Cases
- This is a case where a genuinely useful lifecycle-adjacent signal (your resumed sandbox is running a *different* profile than you asked for) exists in exactly one place, three clicks deep (open session → open Inspector → scroll to Managed Profile), with no surface-level hint (no pill state, no dialog note, no startup log line by default) that anything is different from a normal resume.

---

## STORY-315: Same session, three different "what's happening with my sandbox" answers at once

**Type**: long
**Topic**: Sandbox Lifecycle
**Persona**: Marcus, debugging a flaky session for a teammate who reported "it's stuck," trying to build a complete picture before escalating.
**Goal**: Get one clear, complete answer about the sandbox's current state.
**Preconditions**: Session mid-hibernation-transition (`isHibernatingUi` true from either the local `isHibernatingTransition` heuristic or the server-reported `lifecycleTiming.state === "hibernating"`), with some already-recorded session events.
**Ideal path**: N/A — the point of this story is that there isn't a single ideal path; a thorough user has to visit all three surfaces and reconcile them himself.
**Alternate paths**: N/A.

### Steps
1. Marcus reads the pill (via the Activity dialog trigger, the only place `_sandboxUiStatus.label` renders) → "Hibernating."
2. He hovers "Start dev server" → tooltip: "The sandbox is hibernating." — consistent so far.
3. He opens the Sandbox Activity dialog → header badge repeats "Hibernating" (text matches; color per `resolveTone` is `"busy"` amber, since `lifecycleState === "hibernating"` doesn't hit the `"failed"`/`running-signals`/`isSandboxActive` branches cleanly — actually falls to whichever of `runningSignals > 0` vs. default `"paused"` applies depending on recent events) → the "Lifecycle" detail row shows the raw value "hibernating" (space-formatted) → "Last activity"/"Hibernate after"/"Expires" show absolute timestamps he has to mentally diff against "now" himself (no relative "in 3 minutes" anywhere).
4. He opens the Runtime Inspector → "Session Runtime" section shows Mode/Workflow/Sandbox name/Profile Run — none of these fields say "hibernating"; the closest thing is the Event Timeline, which may or may not have a recent `sandbox`-sourced event describing the hibernation, depending on whether one was emitted (the lifecycle evaluator itself only `console.log`s on success — there is no confirmed `emitSessionEvent` call in `evaluateSandboxLifecycle`, so the Inspector's Event Timeline may show nothing at all for this transition).
5. Marcus now has: a consistent pill+tooltip+dialog-badge text ("Hibernating"), absolute (not relative) timestamps, and an Inspector that is silent on lifecycle state entirely and may have zero corroborating events. He cannot tell from the product alone whether this is a normal ~30-minute-idle hibernation in progress or a stuck transition, because no surface gives him elapsed/remaining time or a stall threshold.

### Variations
- If the teammate's report was actually about a `"failed"` lifecycle that already self-healed (STORY-311), Marcus would find *nothing* wrong on any surface by the time he looks — the strongest evidence of what happened would be server logs he cannot see from the product UI at all.

### Edge Cases
- Three independently-implemented status computations (`_sandboxUiStatus` in `session-chat-content.tsx`, `resolveTone`/`buildSandboxActivitySummary` in `sandbox-activity.ts`, and the Inspector's own per-section rendering in `runtime-observability-panel.tsx`) read overlapping but non-identical inputs (`lifecycleTiming.state`, `reconnectionStatus`, local `isCreatingSandbox`/`isRestoringSnapshot` booleans, and observability events) with no shared source of truth for "what should the user be told right now." This is the concrete instance of the redundancy signal noted throughout this topic: the same underlying lifecycle has at least three rendered opinions, and they are not guaranteed to move in lockstep.
