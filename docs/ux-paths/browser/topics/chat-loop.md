# The Chat Loop: Composer, Tools, Approvals & the 13 Run Outcomes

Source grounding for these stories:

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
  (5,330 lines) — the composer, attachments, mic, `@`-mention and `/`-slash
  wiring, model/Composio/runtime-mode/workflow chips, `ContextUsageIndicator`,
  `MessageRow` (thinking blocks, text, tool-call dispatch), tool-approval
  handlers (`handleApproveTool`, `handleDenyTool`,
  `handleApproveAllToolsForSession`), `stopChatStream`.
- `apps/web/app/workflows/chat.ts` (4,180 lines) — the actual agent loop that
  produces all 13 outcomes; `deriveWorkflowRunOutcomeStatus` call sites; every
  `sendTextMessage` call (or its absence) that puts stop-reason text in front
  of the user.
- `apps/web/lib/chat/workflow-run-outcome.ts` — the `WorkflowRunStatus` union
  and precedence order.
- `apps/web/lib/runs/status.ts` — how the outcome vocabulary collapses for the
  `/runs` feed.
- `apps/web/app/lib/pending-tool-approvals.ts`,
  `apps/web/components/tool-call/tool-layout.tsx`,
  `apps/web/components/tool-call/approval-buttons.tsx` — the approval state
  machine and its buttons.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-mcp-run-lock.tsx`
  — `useMcpComposerLock`, `McpRunLockNotice`.
- `apps/web/hooks/use-audio-recording.ts`, `apps/web/hooks/use-slash-commands.ts`,
  `apps/web/components/file-suggestions-dropdown.tsx`,
  `apps/web/components/slash-command-dropdown.tsx` — voice, `/`, `@`.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/workflow-picker-compact.tsx`,
  `runtime-mode-selector-compact.tsx`, `apps/web/components/model-selector-compact.tsx`,
  `apps/web/components/composio-tool-selector-compact.tsx`.
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/provider-rejection-actions.tsx`,
  `apps/web/lib/chat/provider-error.ts`.
- `apps/web/app/workflows/repeated-tool-failure.ts`,
  `apps/web/lib/chat/headless-progress-budget.ts`,
  `apps/web/lib/chat/declared-expectation-budget.ts`,
  `apps/web/lib/chat/length-continuation-budget.ts` — the exact user-facing
  copy (or lack of it) for each stop reason.
- `apps/web/components/pinned-todo-panel.tsx`, `goal-ledger-panel.tsx`,
  `apps/web/components/tool-call/renderers/task-renderer.tsx`,
  `apps/web/components/assistant-message-groups.tsx`.
- `packages/agent/tools/{read,write,bash,fetch,task}.ts` — which tools
  actually gate on approval, and under what condition.

Four verified findings that shape most of the stories below (confirmed by
reading `chat.ts` directly, not inferred from the type's doc comments):

1. **Three of the twelve non-`completed` outcomes append no explanatory text
   to the chat at all.** `max_steps` (`exhaustedMaxSteps = true; break;`),
   `truncated` (`truncationBoundExhausted = true; break;`), and
   `ended_unexpectedly` (`endedUnexpectedly = true; break;`) all `break` the
   agent loop with no `sendTextMessage` call anywhere near them — confirmed by
   grepping every `sendTextMessage` call site in `chat.ts`. The other nine
   outcomes (`repeated_tool_failure`, `no_progress_fuse`, `no_file_changes`,
   `no_sandbox_step_cap`, `step_ceiling`, `diff_violation`, plus the generic
   pre-content `failed` path) each write a specific plain-English paragraph
   into the transcript as the assistant's own text. For the three silent
   ones, the transcript just stops — mid-sentence, mid-file-write, or after a
   normal-looking tool call — with nothing telling the user why.
2. **Five outcomes cannot fire from a browser-composer-initiated turn.**
   `no_progress_fuse`, `no_sandbox_step_cap`, `no_file_changes`, and
   `step_ceiling` are gated behind `isHeadlessRun` (`options.agentOptions
   ?.unattended === true`), which only an MCP client sets. `diff_violation`
   depends on `options.expectedFiles`, populated only by the
   `open_agents_start_session` MCP tool's `expectedFiles` parameter — no
   browser session-creation UI exposes it. `step_ceiling` is additionally
   unreachable in the browser for a second, independent reason:
   `app/api/chat/route.ts` hardcodes `maxSteps: 500` for every browser turn,
   and the loop checks `options.maxSteps` **before** the outer step ceiling on
   every iteration, so `max_steps` always wins first. The five stories for
   these outcomes are written from the seat of a browser user watching a
   session an MCP client is driving unattended — genuinely supported, since
   the same chat stream both clients share is exactly what
   `useMcpComposerLock`'s `activeRunSource: "mcp"` exists to arbitrate.
3. **The fine-grained outcome vocabulary is invisible to every browser
   component.** `grep -rln "workflowRunOutcomeStatus\|WorkflowRunStatus"
   apps/web/app apps/web/components` returns only `chat.ts` itself and
   `app/types.ts` — no page, panel, or badge reads it. `lib/runs/status.ts`
   collapses all nine non-abort/non-complete/non-waiting outcomes into one
   generic `outcome: "failed"`, `attentionReasons: ["failed"]` for the
   `/runs` feed, and a `chat_workflow` row's `detailUrl` just points back at
   `/sessions/{sessionId}/chats/{chatId}` — the same chat, no extra detail.
   Whatever text did or didn't land in the transcript (finding 1) is the
   entire explanation available anywhere in the browser UI.
4. **Tool approval is narrow, not blanket.** `web_fetch` always requires
   approval in an attended (browser) run (`packages/agent/tools/fetch.ts`).
   `bash` only requires it when `classifyToolApproval` flags the command as
   dangerous (destructive `rm`/`find`/`shred`, `git push --force`, `git reset
   --hard`, `git clean -fd`) — an ordinary `bun test` never pauses.
   `read`/`write`/`edit` only require it for a `.env`-shaped path. Most tool
   calls in a normal turn never touch the approval flow at all.

---

## STORY-401: `failed` — the model provider rejects the turn outright

**Type**: medium
**Topic**: The Chat Loop
**Persona**: Dana, mid-way through a long debugging chat with a reasoning-capable model, switches the chat to a cheaper model via `ModelSelectorCompact` to save cost on a simple follow-up.
**Goal**: Get a normal reply to her next message.
**Preconditions**: The chat already contains earlier reasoning/thinking parts from the previous model. The newly selected model's provider refuses to accept another provider's reasoning history back in the request.
**Ideal path**: 1 — type the follow-up and press Send; nothing about the failure is avoidable from the composer, so the "ideal path" is really about recovering once it happens.
**Alternate paths**: none found for triggering it (it's a provider-side rejection, not a user action); two real recovery routes exist once it happens (see Steps).

### Steps
1. Dana sends her message → the turn streams briefly, then the provider returns a 4xx/5xx rejection before any usable content comes back.
2. `chat.ts`'s catch block builds `getUserFacingWorkflowErrorMessage(error)`. Because `isProviderRejectionMessage` matches, the assistant's entire response becomes one plain-text bubble starting `"The model provider rejected this request (HTTP <code>), so this turn stopped."`, followed by `Provider said: <first 200 chars of the provider's own response>`, followed by `"This chat contains earlier model thinking, which some providers refuse to accept back. You can remove the earlier thinking from this chat and send again, or switch back to the model that last worked here."`
3. Because the message text matches `PROVIDER_REJECTION_PREFIX`, `ProviderRejectionActions` renders under it (only once streaming has finished, `!isMessageStreaming`): a **Remove earlier thinking** button and the line *"or switch the model back in the composer."*
4. Dana clicks **Remove earlier thinking** → `POST /api/sessions/{sessionId}/chats/{chatId}/strip-reasoning` → on success the button area replaces itself with `"Removed earlier thinking from N message(s). Send your message again."` (or, if there was nothing to strip, `"No earlier thinking left to remove — try switching the model instead."`) and the page does a `router.refresh()`.
5. Dana resends her message → this time it completes normally (`completed`).

**What the user should understand from the UI alone**: the bubble text itself names the cause (provider rejected the request) and quotes the provider's own words, then offers exactly the two ways out — no guessing needed. This is the one `failed` variant that is fully self-explanatory in-chat.

### Variations
- **Generic setup failure instead of a provider rejection** — e.g. the session is archived (`chat.ts`'s `getSetupErrorMessage` returns `"This session is archived. Unarchive it to continue."`), or the saved BYOK API key can no longer be decrypted (`"The saved API key for this model can't be decrypted in this environment — re-enter it in Settings → Models."`), or a managed-runtime setup command failed. All three land the same way: one plain-text assistant bubble, because `pendingAssistantResponse.parts.length === 0` at the moment of the crash so `chat.ts` synthesizes the friendly text and calls `sendTextMessage(writable, "setup-error", errorText)`. None of these get `ProviderRejectionActions` — that component only renders for text matching the provider-rejection prefix.
- **AI Gateway key rejected** — message reads `"The AI Gateway rejected the API key. Update AI_GATEWAY_API_KEY in your deployment environment, or switch this chat to a User model in Settings → Models."` Same single-bubble treatment.

### Edge Cases
- **The crash happens after some assistant content already streamed** (not before any). `chat.ts` only synthesizes the friendly error text when `pendingAssistantResponse.parts.length === 0`. If the model had already streamed a partial paragraph or a tool call before the provider rejected the continuation, no explanatory text is appended at all — the response just stops where it was, and `finish` still fires normally client-side. Dana would see an assistant message that trails off, with **no visible error, no red banner, no `ProviderRejectionActions`** — this is functionally identical in the UI to the silent `truncated`/`ended_unexpectedly` stops (STORY-409, STORY-412), even though the recorded outcome is `failed`. She would think: *"did it just... stop? Is it still thinking? Did I lose my place?"* — the only way to know for sure is that the Send button has returned (no longer showing the destructive Stop square) and the context-usage percentage hasn't grown since the last visible content.
- The transient `error && ...` red banner near the top of the chat pane (with a **Retry** button, `RefreshCw` icon) is a *different* thing — an AI SDK stream-connection error (e.g. iOS backgrounding killed the fetch), not this workflow-level `failed` outcome. Don't confuse the two: the connection-error banner has a Retry button that just resumes the stream; the provider-rejection bubble is a persisted assistant message with its own inline actions.

---

## STORY-402: `aborted` — the user clicks Stop mid-response

**Type**: short
**Topic**: The Chat Loop
**Persona**: Marcus, watching the agent begin editing files he suddenly realizes are the wrong ones.
**Goal**: Stop the run immediately, before more damage is done.
**Preconditions**: A turn is actively streaming (`isChatInFlight || hasPendingResponse` is true) — the composer's send-icon button has become a filled destructive circle with a `Square` (stop) icon.
**Ideal path**: 1 — click the Stop button.
**Alternate paths**: none found — there is no keyboard shortcut or secondary stop affordance in the session chat surface; the only way to interrupt a stream is this one button.

### Steps
1. Marcus clicks the destructive circular button → the client immediately calls `stopChatStream()`, sets local `userStopped = true`, and calls `setChatStreaming(chatInfo.id, false)`. This flips `isChatInFlight` to `false` **instantly, client-side**, before any server round-trip completes — the button reverts from Stop back to Send/Mic without a lag, so Marcus gets immediate visual confirmation his click registered.
2. Server-side, `result.stepWasAborted` becomes true on the in-flight step; `wasAborted` is set. Any tool call that was mid-flight when the abort landed renders with `state.interrupted = true` in `ToolLayout`: a yellow outlined-ring status dot instead of the usual color, an `OctagonPause` icon in the header, and — if expanded — a yellow-bordered `interrupted` block instead of a normal result.
3. `chat.ts` reaches its abort check: `workflowStatus = wasAborted ? "aborted" : "failed"`, `deriveWorkflowRunOutcomeStatus({ wasAborted: true, ... })` returns `"aborted"` — this precedence beats every other in-flight signal.
4. The session event summary records `"Agent workflow was stopped."` (not "failed") — a distinct message from a real crash.

**What the user should understand from the UI alone**: an interrupted tool call is visually distinct (yellow ring + "interrupted" panel, not the red error styling used for a real tool failure) — Marcus can tell at a glance this was *his* stop, not something breaking. Nothing more needs to happen: he can immediately type a new message.

### Variations
- Clicking Stop while a tool call is in `approval-requested` state (STORY-411) simply ends the stream without ever resolving the approval — the pending approval part stays as-is in the persisted message, unresolved, until the next turn's `annotateAbandonedTurns` treats it as abandoned.

### Edge Cases
- **Racing with a real crash.** `chat.ts`'s catch block computes `workflowStatus = wasAborted ? "aborted" : "failed"` — if the user clicks Stop at the exact moment something else fails server-side (a provider error, a sandbox disconnect), the abort still wins: the run files as `aborted`, not `failed`, because the check for `wasAborted` runs first. Marcus never sees a failure banner for a coincidence he wasn't responsible for triggering.
- If a tool call had already finished (`output-available`) before the abort landed, it keeps its normal green/result rendering — only the call that was genuinely in flight at abort time gets the interrupted treatment.

---

## STORY-403: `repeated_tool_failure` — a tool call fails the same way three times

**Type**: medium
**Topic**: The Chat Loop
**Persona**: Priya, asking the agent to fix a broken build; the agent keeps re-running `bun test` against a module path that doesn't exist in this branch.
**Goal**: Understand why the agent gave up instead of burning the whole turn retrying.
**Preconditions**: A `classic`-mode chat; the agent has already tried the same failing `bash` command (or any tool) with the byte-identical error text on three consecutive steps.
**Ideal path**: 1 — nothing to do differently; the circuit breaker exists precisely so Priya doesn't have to babysit a retry loop.
**Alternate paths**: none found — this fires automatically inside the agent loop, not from any composer action.

### Steps
1. Step N: `bash` tool call fails with `Cannot find module './legacy/util'`. `observeStepForRepeatedFailure` records the failure signature (tool name + exact error text) and resets nothing, since there is now a run of length 1.
2. Steps N+1, N+2: the agent retries the identical command, gets the identical error each time. `REPEATED_TOOL_FAILURE_THRESHOLD = 3` is reached on the third identical failure (`detectRepetition` flags a `"repeat"` verdict).
3. The loop breaks immediately (`stoppedForRepeatedToolFailure = true`) — Priya does **not** wait out the rest of the turn's step budget. A session event `workflow.tool.repeated-failure` is recorded (tool name, count, reason — never the raw tool input).
4. `buildRepeatedToolFailureMessage` produces the assistant's final text: `"Stopped: the \`bash\` tool failed 3 times in a row with the same error, so retrying it again would not have helped."`, a blank line, then the raw `errorText` (`Cannot find module './legacy/util'`) verbatim, sent via `sendTextMessage`.
5. Priya reads the exact failing command's error, fixes the real problem herself (or tells the agent the right path in her next message), and sends a follow-up.

**What the user should understand from the UI alone**: the message names the tool, the exact retry count, and repeats the actual error text — Priya doesn't need to scroll back through three identical failed tool-call cards to find out what broke; it's summarized for her in the stop message itself.

### Variations
- **Managed-runtime coordinator, `task` tool.** If the failing tool is `task` in `managed_runtime` mode, the message gets one extra paragraph: `"This session runs in managed runtime mode, where delegating to a worker is the only way the agent can reach the repository — so there was no other route to try."` — explains *why* the coordinator couldn't just switch tools instead of retrying.
- A genuinely transient failure that happens to produce the exact same error three times in a row (rare, but possible — e.g. the same flaky network timeout) trips this the same way a real bug would. The accepted trade-off, per the code's own comment: one turn Priya has to re-send, against burning the whole step budget silently.

### Edge Cases
- A tool that fails once, succeeds, then fails again does **not** trip the breaker — `observeStepForRepeatedFailure` resets its signature history the moment a step has zero new failures, so only a genuinely *consecutive* run of three identical failures counts.
- This check runs on every step of every run regardless of runtime mode or headless/browser origin — unlike the five MCP-only outcomes (STORY-405–408, 410), `repeated_tool_failure` is fully reachable from an ordinary browser turn.

---

## STORY-404: `max_steps` — a very long turn silently exhausts its step budget

**Type**: long
**Topic**: The Chat Loop
**Persona**: Sam, who asks the agent to migrate an entire package off a deprecated dependency across dozens of files in one message, then leaves the tab open and checks back an hour later.
**Goal**: Figure out whether the agent finished, is still working, or got stuck.
**Preconditions**: A browser-initiated chat turn (`app/api/chat/route.ts` sets `maxSteps: 500` for every non-MCP send). The task is large enough that the agent is still issuing tool calls (`finishReason: "tool-calls"`) at step 500.
**Ideal path**: 1 — send the big ask, then periodically check the pinned TODO panel and the tool-call stream rather than waiting for a final "done" message that may never come this cleanly.
**Alternate paths**: none found for avoiding the cap itself — there is no UI control to raise or see the step budget for a browser turn.

### Steps
1. Sam sends the migration request. Over the next many minutes, `PinnedTodoPanel` shows a growing, then shrinking, todo list (`N/M Tasks`); `AssistantMessageGroups`/`TaskRenderer` collapse long runs of file edits into "N tool calls · M files changed" summary bars; `ThinkingBlock`s appear and collapse between tool-call groups.
2. At step 500, the loop's own guard fires first: `if (options.maxSteps !== undefined && step + 1 >= options.maxSteps) { exhaustedMaxSteps = true; break; }`. **No text is appended anywhere** — confirmed by grep, there is no `sendTextMessage` call anywhere near this branch, unlike every other deliberate stop in the file.
3. The loop exits; the persisted assistant message ends with whatever the step-500 tool call's result happened to be — which, because `finishReason` was `"tool-calls"` (the agent was still actively working, not winding down), often looks like a perfectly ordinary mid-task tool-call card, not an ending.
4. `chat.ts` still runs its normal post-loop path: auto-commit (if enabled), the diff cache refreshes, `sendFinish`/`closeStream` fire — from the AI SDK's perspective this is an entirely clean finish (`status` goes to `"ready"`, the Stop button reverts to Send).
5. Sam returns to the tab: the stream has finished, the composer shows the normal Send button, the last tool card looks like ordinary progress, and the pinned TODO panel may still show several unchecked items.

**What the user should understand from the UI alone**: *nothing tells him this stopped because of a budget rather than because the task was actually done or actually stuck.* This is the story's central finding — `max_steps` is fully silent. Sam is left thinking: *"Is it done? Did it crash? Is it still going and I'm just not seeing new content?"* The only clue available anywhere in the browser is negative evidence: the composer's Send button (not Stop) is showing, and the todo list is not `allDone`.

### Variations
- If the step-500 boundary happens to land right after the agent's own natural "I'm done" summary (finishReason `"stop"` on step 499, no further steps needed), the cap never engages at all and the turn reads as a completely normal `completed` finish — same input, different luck.

### Edge Cases
- Because the pinned TODO panel hides itself once `allDone` or when no work has started (`totalCount === 0 || allDone || !hasActiveWork`), a run that got capped mid-way through its *last* few todos can still show a populated, partially-checked panel — a genuinely useful (if accidental) hint that something was left undone. A run capped earlier, before any todos were even written, gives Sam nothing to go on beyond re-reading the transcript himself.
- Checking `/runs` doesn't help either: this `chat_workflow` run's row shows the generic `outcome: "failed"` / `attentionReasons: ["failed"]` badge (STORY-403's finding 3), and its `detailUrl` just points back to this same chat — no separate detail page exists for a `chat_workflow` run (only `background_agent` and `agent_loop` runs get `/runs/{source}/{runId}` detail pages).
- Sam's only real recovery is to send a follow-up message asking the agent to continue / summarize where it left off — the next turn's context includes everything already done, so this generally works, but he has to *think* to do it rather than being told to.

---

## STORY-405: `no_progress_fuse` — watching an unattended MCP run circle in place

**Type**: medium
**Topic**: The Chat Loop
**Persona**: Priya, who kicked off a long-running fix from her own local agent over the hosted MCP server (`open_agents_send_message` against an existing session), then opens the same session in her browser to watch it work.
**Goal**: See what the headless run is doing and understand it if it stops early.
**Preconditions**: `activeRunSource: "mcp"` for this chat, `isStreaming: true` — the browser composer is locked (`McpRunLockNotice`, STORY-418). The run is unattended (`agentOptions.unattended === true`) against a repo-backed session, so `headlessHasSandbox` is true and the no-progress fuse is armed. The agent is stuck re-editing the same file back and forth (or cycling through the same short block of tool calls) with no net git change.
**Ideal path**: 0 — Priya isn't driving this turn; she's just watching it happen in the browser tab.
**Alternate paths**: none found for triggering it from the browser (it only exists on the `isHeadlessRun` path); once it fires, Priya's only route forward is a new message from the MCP client that started it, or taking over the composer herself (STORY-418).

### Steps
1. Priya watches tool calls stream in live — same `ToolCall`/`ThinkingBlock`/`PinnedTodoPanel` rendering as any other run, because the browser subscribes to the same message stream regardless of who is driving it.
2. Each step, the server probes the sandbox's git state (`probeHeadlessRunGitFingerprint`) and folds in tool-call activity (`buildHeadlessStepToolSignature`). The detector sees either the same fingerprint repeat, or a short repeating cycle, with no real workspace change.
3. Once the detector's `verdict` is `"stop"`, `headlessFuseTripped = true` and `buildHeadlessProgressFuseMessage` writes one of three leads depending on `reason`: for a plain stale run, `"Stopped: no workspace changes or new tool-call activity were detected for N consecutive steps (limit M), so this headless run is ending instead of continuing to burn steps with no progress."`; for a detected cycle, `"Stopped: a repeating K-call pattern of tool calls with no workspace change was detected, ..."`; for an exact repeat, `"Stopped: the same tool call was repeated N times in a row with no workspace change, ..."` Every variant ends with `"If the goal is still valid, send a follow-up message with a narrower next step or the missing decision."`
4. Priya sees this text appear live in her browser tab, exactly like any assistant message — she did not have to poll or refresh.
5. The MCP client's own run ends; `isStreaming` flips false; the composer unlocks automatically (`useMcpComposerLock`'s effect resets `takenOver` and re-evaluates `locked`).

**What the user should understand from the UI alone**: the message is explicit about *why* — no progress, not a crash — and gives an explicit next action (send a narrower message). Because it renders as a normal assistant bubble in a live-updating chat, it reads no differently from any other in-progress explanation, which is exactly the point: nothing here needs the MCP-specific mental model to understand.

### Variations
- If Priya is not watching live and only opens the chat afterward, she sees exactly the same persisted text — nothing about it is transient or SSE-only.

### Edge Cases
- A run that is doing genuinely varied tool calls against a frozen git tree (e.g. read-only investigation) does **not** trip this fuse — the fingerprint folds in tool-call activity specifically so a legitimately-exploring, non-editing run isn't punished for having no diff. This is a deliberate carve-out (see finding 2 in `no_file_changes`, STORY-406, for the *declared*-expectation counterpart that *does* catch this case when the caller asked for changes).
- A single failed git probe (timeout, transient connect error) degrades to "unknown, not stale" rather than tripping the fuse — a flaky sandbox network blip mid-run does not falsely end the turn.

---

## STORY-406: `no_file_changes` — a declared-to-edit MCP run produces no diff

**Type**: medium
**Topic**: The Chat Loop
**Persona**: Marcus, running an automated nightly refactor bot against his repo through `open_agents_start_session` with `expectFileChanges: true`, then checking the session's chat the next morning.
**Goal**: Find out whether last night's run actually changed anything.
**Preconditions**: The session was created via the MCP `open_agents_start_session` tool with `expectFileChanges: true` (or a numeric allowance) — a parameter only that MCP tool exposes; no browser session-creation form has this field. The run has a sandbox to probe (`headlessHasSandbox`).
**Ideal path**: 0 — Marcus reads the transcript the next morning rather than watching live.
**Alternate paths**: none found — this check only exists on the headless/MCP path; a browser-started chat can never declare `expectFileChanges`.

### Steps
1. Overnight, the agent repeatedly investigates but keeps deciding not to commit to an edit (maybe it's blocked on an ambiguous instruction, maybe it's just circling reading files).
2. Each step that produces no git delta, `headlessDiffExpectationDetector.observeTurn` increments `stepsWithoutChange`. This reuses only the *git* half of the no-progress fuse's fingerprint (not the tool-activity half) — deliberately, so a run doing varied-but-pointless reads still gets caught here even though it would slip past the plain no-progress fuse (STORY-405).
3. Once `stepsWithoutChange` exceeds the allowance, `headlessNoDiffCapped = true` and `buildHeadlessNoFileChangesMessage(stepsWithoutChange, allowance)` writes: `"Stopped: this run was declared to change files, but N consecutive steps produced no workspace change (limit M), so it is ending instead of continuing to burn steps with no output."`, then `"If the goal is still valid, send a follow-up message with a narrower next step or the missing decision."`
4. Marcus opens the chat the next morning and reads this directly in the transcript — no need to diff the branch himself to learn nothing changed.

**What the user should understand from the UI alone**: the message states plainly that *this specific run* declared an intent to change files and didn't — distinct from a plain `no_progress_fuse`, which never claims anything about intent.

### Variations
- A **second, later** check exists: even if the mid-loop detector never tripped, the end-of-run block still checks `changedPaths.length === 0` (via `probeChangedFilePaths`) against `declaredFileChanges` and sets `headlessNoDiffCapped = true` post-hoc — but only if nothing more specific already explains the empty diff (`truncationBoundExhausted`, `outerStepCeilingReached`, `endedUnexpectedly` are checked first) and only if auto-commit didn't already record a real committed change (`autoCommitRecordedAChange`). This guards against reporting "no changes" for a run that actually did commit and push, where the git probe's base ref shifted under it.
- A session declared `expectFileChanges: 40` (a custom numeric allowance rather than the default) shows that exact number in the "(limit M)" text — Marcus can tell at a glance whether the run used the platform default or a caller-tuned budget.

### Edge Cases
- A **read-only** MCP run (no `expectFileChanges` declared, or explicitly `false`) never engages this detector at all, however long it goes without a diff — this outcome is opt-in per the caller's own declared expectation, never inferred.

---

## STORY-407: `no_sandbox_step_cap` — an unattended run against a no-repo session

**Type**: short
**Topic**: The Chat Loop
**Persona**: Dana, who created an "empty" (no-repo) session for a scratch conversation, then later pointed an MCP client at it with `open_agents_send_message` for an unrelated headless task, forgetting it has nothing to work against.
**Goal**: Understand why the run stopped quickly instead of running for a long time.
**Preconditions**: `session.sandboxState` is `null` (a no-repo session — the composer for this session shows an **Add sandbox** button, per finding: `!session.sandboxState && !isArchived`). The run is unattended (`isHeadlessRun`).
**Ideal path**: 0 — Dana is again just reading a transcript, not steering the turn.
**Alternate paths**: none found — this cap only exists because there is *no* sandbox to probe for the normal fuse; a repo-backed session never reaches this path.

### Steps
1. Because `headlessHasSandbox` is false (no sandbox exists), the ordinary no-progress fuse can never run — every git probe would return `null`, which the budget treats as "unknown, not stale" forever, so without this fallback the run would be unbounded.
2. Instead, `headlessNoSandboxStepCap = getHeadlessRunNoSandboxStepCap()` bounds the run by a flat step count.
3. Once `step + 1 >= headlessNoSandboxStepCap`, `headlessNoSandboxCapped = true` and `buildHeadlessNoSandboxCapMessage(cap)` writes: `"Stopped: this session has no sandbox, so progress cannot be observed, and this headless run reached the fixed step cap for that case (N)."`, then `"If the goal needs a workspace (reading or changing files), retry against a repo-backed session. Otherwise send a follow-up message with a narrower next step."`
4. Dana reads this and realizes her mistake — she pointed the automation at the wrong session.

**What the user should understand from the UI alone**: the message is unusually actionable for a stop reason — it tells Dana exactly what precondition is missing (a sandbox) and gives the two concrete fixes (retry against a repo-backed session, or keep this one purely conversational).

### Variations
- none found — this is a single, simple condition with one message shape (only the cap number varies by env config).

### Edge Cases
- If Dana clicks **Add sandbox** on this same session mid-run (or afterward) to attach a repo, that doesn't retroactively rescue the run that already capped — it only changes what a *future* turn on this session can do.

---

## STORY-408: `step_ceiling` — the far-outer backstop fires on an otherwise-unbounded run

**Type**: short
**Topic**: The Chat Loop
**Persona**: Sam, whose custom MCP client keeps sending follow-up `open_agents_send_message` calls to the same session in a loop, without ever declaring `expectFileChanges` or hitting any of the more specific headless budgets.
**Goal**: Understand why an unusual "hard backstop" message appeared instead of one of the more specific stop reasons.
**Preconditions**: An unattended (`isHeadlessRun`) session where none of the more specific budgets (`no_progress_fuse`, `no_file_changes`, `no_sandbox_step_cap`) caught the run first — e.g. genuinely varied tool-call activity keeps resetting the no-progress fuse's fingerprint every step, so it never trips, while the run just keeps going regardless.
**Ideal path**: 0 — this is presented in the code itself as "unusual and worth reviewing," not a normal stop a well-behaved caller should ever reach.
**Alternate paths**: none found. In a browser turn this outcome is structurally unreachable at all: `options.maxSteps` (500 for a browser send) is checked **before** the outer ceiling on every loop iteration, so `max_steps` always fires first if it's going to fire at all.

### Steps
1. Step-by-step, none of the more specific stop checks fire — the run keeps being judged "progressing" by every narrower detector.
2. `runOuterStepCeiling = getRunOuterStepCeiling()` (a generous, env-tunable default well above a browser turn's normal 500-step cap) is checked **last**, after every other budget, on every iteration.
3. Once `step + 1 >= runOuterStepCeiling`, `outerStepCeilingReached = true` and `buildRunOuterStepCeilingMessage(ceiling)` writes: `"Stopped: this run reached the outer step ceiling (N) — a hard backstop, not the primary bound. None of this run's other budgets ended it first, which is unusual and worth reviewing."`, then `"If the goal is still valid, send a follow-up message with a narrower next step."`
4. Sam reads this and, per the message's own framing, treats it as a signal to review his client's behavior — not just resend and move on.

**What the user should understand from the UI alone**: the message itself flags its own rarity ("unusual and worth reviewing") — this is the one stop message in the whole set that explicitly tells the reader something about the *system's* behavior, not just the run's.

### Variations
- none found.

### Edge Cases
- Because this check runs after the no-sandbox cap and the no-progress fuse in the loop's own ordering, and precedes only `truncationBoundExhausted`/`diffAcceptanceViolated`/`awaitingToolApproval`/`endedUnexpectedly` in the final outcome-derivation precedence, a run that happens to also be mid-truncation-continuation or paused for approval at the exact same step boundary will still resolve to `step_ceiling` first if the ceiling check runs first in the loop body that iteration.

---

## STORY-409: `truncated` — a huge response silently gives up after 3 continuations

**Type**: long
**Topic**: The Chat Loop
**Persona**: Priya, asking the agent to write one very large generated file (a big schema dump, a long migration, a large data fixture) in a single `write` tool call.
**Goal**: Get the complete file written.
**Preconditions**: The model's per-response output-token ceiling is smaller than what a single response needs to finish the file in one shot — the step ends with `finishReason: "length"` (the AI SDK's own signal for "the provider cut me off, not that I chose to stop").
**Ideal path**: 1 — send the request normally; the platform automatically retries up to `CHAT_MAX_LENGTH_CONTINUATIONS` (default 3) more times before giving up, so most truncations self-heal without Priya noticing.
**Alternate paths**: none found — there's no manual "continue generating" button; recovery is always "send another message."

### Steps
1. Step N ends with `finishReason: "length"` — the model had more to say but got cut off. `isLengthContinuation` is true; `chat.ts` deliberately does **not** break the loop here — the truncated response is already appended to `modelMessages`, so the very next step continues from exactly where it left off, indistinguishable in the UI from an ordinary multi-step tool-calls sequence.
2. `consecutiveLengthContinuations` increments each time this repeats. Up to `maxLengthContinuations` (3 by default) continuations are allowed for free.
3. If the model is *still* getting truncated on the 4th attempt in a row, `truncationBoundExhausted = true` and the loop `break`s — **with no message appended anywhere**, confirmed by grep: there is no `sendTextMessage` call anywhere near the truncation-bound check, unlike every other deliberate stop.
4. The stream finishes cleanly from the client's point of view (`sendFinish`/`closeStream` still run in the normal post-loop path). Priya sees the file's `write` tool call end mid-content — the `WriteRenderer`'s diff view simply stops partway through the file, with no error styling, no red icon, nothing marking it incomplete.
5. Priya scrolls to the bottom expecting either a "done" summary or an error, finds neither, and has to actually open the written file (via the Files tab / diff viewer) to notice it's truncated by comparing what she asked for against what's actually there.

**What the user should understand from the UI alone**: nothing distinguishes this from a completed turn except the content itself looking obviously unfinished (a file that just stops mid-line, a response that ends without a closing thought). Priya's likely internal monologue: *"Is that the whole file? It looks cut off, but the agent didn't say it was truncated — did it just decide to stop there, or did something break?"* There is no in-chat signal to resolve this uncertainty; she has to inspect the actual output.

### Variations
- A response truncated once or twice, then finishing normally on a later step within the allowance, is completely invisible — no different from a normal multi-step turn. Only exceeding the allowance produces (silently) the `truncated` outcome.

### Edge Cases
- Because this check has no browser/headless gating (unlike STORY-405–408), it is fully reachable from an ordinary chat send — one of only three outcomes (with `max_steps` and `ended_unexpectedly`) that are both browser-reachable *and* completely silent in the transcript.
- Recovery is genuinely simple once noticed — sending "continue" or "finish writing that file" as the next message works, because the model messages array already contains everything generated so far. The friction is entirely in *noticing* there's something to continue.

---

## STORY-410: `diff_violation` — an MCP run edits outside its declared file list

**Type**: medium
**Topic**: The Chat Loop
**Persona**: Marcus, running an automated docs-only bot via `open_agents_start_session` with `expectedFiles: ["README.md", "docs/*.md"]`, then opening the session's chat to review what actually changed before trusting it.
**Goal**: Confirm the automation stayed inside its declared scope before merging anything.
**Preconditions**: The session was started via the MCP tool with a non-empty `expectedFiles` list — again, only that tool exposes this parameter. The run has already finished its normal work (this check is computed **after** the loop, not mid-run).
**Ideal path**: 0 — Marcus reads the finished transcript; there's no live decision to make during the run itself.
**Alternate paths**: none found — no browser-started session can declare `expectedFiles`.

### Steps
1. The agent completes its declared docs task, but also — while investigating — edits `apps/web/lib/some-unrelated-file.ts`, believing it was in scope.
2. The run finishes naturally (`finishedNaturally`, or whatever other outcome applies) and only *then*, post-loop, does `checkDiffAcceptance(changedPaths, options.expectedFiles)` run against the final diff.
3. Because the diff touched a path outside the declared list, `acceptance.violated` is true. `diffAcceptanceViolated = true`, `diffAcceptanceOffendingPaths` is set, and `buildDiffAcceptanceViolationMessage(offendingPaths)` **appends** a new paragraph to the already-finished assistant response: `"Stopped: this run's diff touched 1 file(s) outside the declared file list: apps/web/lib/some-unrelated-file.ts."`, then `"Review the diff before trusting or merging this run's output."` — note the message itself says "Stopped," even though by this point the run had actually already finished; it's a post-hoc violation notice, not a mid-run interruption.
4. Because `didUpdateGitData = true`, the assistant message is re-persisted with this paragraph appended — Marcus, opening the chat later, sees it as a natural continuation of the same final message, not a separate event.
5. Marcus opens the **Changes** tab, confirms the offending file, and either reverts just that file or asks a follow-up turn to fix it before merging anything.

**What the user should understand from the UI alone**: the message names the exact offending path(s), and its instruction ("Review the diff before trusting or merging this run's output") is a direct warning against blindly merging — appropriate given this is the one outcome computed from the *actual final diff*, not from behavior mid-run.

### Variations
- Multiple offending files are listed comma-separated in one message, all named explicitly — Marcus never has to diff the whole repo himself to find them.

### Edge Cases
- This is checked **once, at the end of the run**, never mid-loop — a run that touches an out-of-scope file early and reverts it before finishing produces no violation, because only the *final* diff is compared.
- `diff_violation` ranks above `awaiting_tool_approval` in the outcome precedence (see `workflow-run-outcome.ts`) — if a run both paused for approval on its last step *and* its diff (from earlier, already-approved edits) violated the declared scope, the persisted outcome is `diff_violation`, not `awaiting_tool_approval`, even though the composer would still show a pending approval prompt in that case.

---

## STORY-411: `awaiting_tool_approval` — the run pauses for a decision, and it isn't a failure

**Type**: long
**Topic**: The Chat Loop
**Persona**: Priya, asking the agent to research a third-party API by fetching its docs page.
**Goal**: Let the agent fetch the URL, but decide for herself whether it's safe.
**Preconditions**: An attended (browser) chat turn. The agent calls `web_fetch`, which **always** requires approval in an attended run (`packages/agent/tools/fetch.ts`, unconditional).
**Ideal path**: 1 — click **Approve** on the pending call.
**Alternate paths**: 2 — click **Deny** to refuse just this call and let the agent adapt; or click **Allow all this session** once, to pre-approve every future tool call in this browser tab for the rest of the session.

### Steps
1. The agent's tool call for `web_fetch` streams in as a `FetchRenderer` card inside `ToolLayout`. Once its state becomes `approval-requested`, the group containing it is force-expanded (`messageHasActiveApproval` in `assistant-message-groups.tsx` — a message with a pending approval is never left collapsed), and `showApprovalButtons` becomes true because `state.approvalRequested && !state.isActiveApproval`. The card's status dot turns solid yellow.
2. `ApprovalButtons` renders inline under that specific tool call (not as a separate banner): green-outlined **Approve**, red-outlined **Deny**, and (only when `onApproveAllForSession` is wired, which it always is here) yellow-outlined **Allow all this session**.
3. Meanwhile, `chat.ts`'s loop has already reached `shouldContinue = false` (a `tool-calls` finish reason with a pending interaction) and run its normal end-of-turn path — `sendFinish`/`closeStream` fire, `workflowStatus` stays `"completed"` at the coarse level (per the code's own comment: `awaitingToolApproval` deliberately does **not** flip the coarse status to `"failed"`, because pausing for the user is not a failure), while only the fine-grained `workflowRunOutcomeStatus` records `"awaiting_tool_approval"`.
4. Priya clicks **Approve** → `handleApproveTool` calls `addToolApprovalResponse({ id, approved: true })`. The buttons disappear immediately (the call briefly becomes `isActiveApproval`), replaced by a plain `"Running..."` notice, then the tool executes and a new streaming turn begins automatically — Priya never has to type anything or press Send again.
5. The fetch result renders normally; the agent continues its response.

**What the user should understand from the UI alone**: this never looks like an error — no red styling anywhere, the status dot is yellow (pending), not red (denied/error). The message that just finished streaming reads like a normal completed turn (because it did complete); the approval card is the only thing marking unfinished business. Priya correctly reads this as "the agent is waiting on me," not "something broke."

### Variations
- **Deny.** Clicking **Deny** calls `handleDenyTool(id)` → `addToolApprovalResponse({ id, approved: false })` with no reason (the `ApprovalButtons` Deny button collects no text). The card shows `state.denied = true`: the tool name turns red, and a line reads `"Denied"` (no reason text appears, since none was collected). A new turn begins automatically; the agent sees the denial and adapts — e.g. proceeding without that URL, or asking Priya what she'd prefer instead.
- **Allow all this session.** Clicking it calls `setAutoApproveToolCallsForSession(true)` (local React state, not persisted to the database or the account) and immediately approves the clicked call. From then on, any *newly appearing* pending approval in this same browser tab auto-approves via an effect that walks `collectPendingApprovals(renderMessages)` — no more buttons will appear for the rest of this tab's session. Reloading the page, or opening the same chat in a different tab, resets this — it is **not** a durable per-session or per-account setting.
- **A dangerous `bash` command instead of `web_fetch`.** e.g. `git push --force` — `classifyToolApproval` flags it, and the same Approve/Deny/Allow-all card appears on the `BashRenderer` card instead.
- **Reading or writing a `.env`-shaped path** — `read`/`write`/`edit` also pause for approval, but only for that one narrow condition; an ordinary source-file read or edit never does.

### Edge Cases
- **Typing a new message instead of deciding.** Nothing in the composer blocks Priya from ignoring the approval buttons and sending a completely different message. If she does, the pending tool call is left unresolved in the persisted history; the next turn's message conversion (`annotateAbandonedTurns` → `sanitizeInterruptedToolCalls`) treats it as an abandoned call so it doesn't wedge the conversation with an orphaned tool-call/tool-result mismatch — but the original question (should this fetch happen?) is simply dropped, not asked again.
- **An MCP-driven unattended run never shows this to Priya at all.** `web_fetch`'s `needsApproval` is unconditionally `false` when `getUnattended(experimental_context)` is true — an unattended run has no human to ask, so exposure is governed entirely by the tool allowlist instead. If Priya is watching an MCP-driven run in her browser (STORY-405–408, STORY-418), she will never see an approval card for it, only for a turn she herself sent.

---

## STORY-412: `ended_unexpectedly` — the provider stops for a reason nobody asked for

**Type**: medium
**Topic**: The Chat Loop
**Persona**: Dana, asking the agent to summarize output from a `bash` command that happens to include content the model provider's own safety filter flags.
**Goal**: Get the summary she asked for.
**Preconditions**: A step's `finishReason` comes back as something other than `stop`, `tool-calls`, or `length` — currently `content-filter`, `error`, or `other`, the remaining members of the AI SDK's `FinishReason` union.
**Ideal path**: 1 — send the message; there's no way to predict or avoid this from the composer.
**Alternate paths**: none found — this is a provider-side classification, not something triggered by any UI action.

### Steps
1. The step completes with, say, `finishReason: "content-filter"`. `shouldContinue` evaluates to false (it's not `tool-calls` without a pause, and not a length continuation).
2. Because `pausedForToolApproval` is false and `result.finishReason !== "stop"`, the code takes the `endedUnexpectedly = true` branch and `break`s the loop — **again, with no message appended**, confirmed by grep: there is no `sendTextMessage` call anywhere near this branch either.
3. The turn finishes cleanly from the AI SDK's perspective (`status` returns to `"ready"`); whatever partial content had streamed before the cutoff is all that's visible. There is no red banner, no yellow warning, nothing distinguishing this render from a normal short reply.
4. Dana reads a suspiciously short or oddly-truncated-feeling response and has no in-chat way to know the provider itself cut it off for a policy reason rather than the agent simply deciding it was done.

**What the user should understand from the UI alone**: nothing — this is the third and last of the fully silent outcomes (with `max_steps` and `truncated`). Dana's likely reaction: *"That's a weirdly short answer for what I asked — did it actually finish, or give up?"* She has no way to distinguish "the model chose to stop here" from "the model was stopped." Her only real signal is content-based: an answer that reads as abruptly incomplete relative to the question.

### Variations
- The AI SDK's `FinishReason` union has exactly three members outside `stop`/`tool-calls`/`length`: `content-filter`, `error`, and `other`. All three collapse into this same single outcome value, deliberately (per the type's own doc comment) — they're rare, provider-side, and a caller can't act on them differently from one another, so the vocabulary doesn't grow every time the SDK adds a new one.

### Edge Cases
- Like `truncated` (STORY-409) and `max_steps` (STORY-404), this outcome is fully reachable from an ordinary browser turn — it has no headless/MCP gating. Unlike those two, there is no automatic recovery attempt at all (no continuation budget, no step-budget nuance) — the very first occurrence ends the turn.
- If this happens moments after a `web_fetch` approval was granted (STORY-411) — e.g. the fetched content itself trips the filter on the next step — Dana would see her approved fetch complete normally, then the response simply stop, with the same total absence of explanation.

---

## STORY-413: Composing a message with an `@`-file mention and a `/`-slash skill

**Type**: medium
**Topic**: The Chat Loop
**Persona**: Sam, wanting to point the agent at a specific file and invoke a saved skill in the same message.
**Goal**: Send one message that both references a file and runs a skill, without typing the full path or skill name from memory.
**Preconditions**: A repo-backed session with an active sandbox (for `@` file search) and at least one skill available to this session (for `/`).
**Ideal path**: 1 — type in the composer textarea, letting the two dropdowns do the lookup work.
**Alternate paths**: none found — there's no separate "attach a file reference" button; `@` in the text is the only entry point, and likewise `/` is the only entry point for a skill.

### Steps
1. Sam types `Fix the bug in @rou` in the textarea → because `@` is present and a search is active, `FileSuggestionsDropdown` renders above the input, showing sandbox file matches for `rou` (`filesLoading` while searching).
2. He arrows down to `apps/web/app/api/chat/route.ts` and selects it → `handleFileSelect` splices `@apps/web/app/api/chat/route.ts ` into the text at the mention's start position, with the cursor advanced past it (`mentionStart + value.length + 2` — `@` plus the path plus a trailing space).
3. He continues typing, then starts a new line with `/`: `extractSlashCommand` only recognizes a `/` at position 0 or preceded by whitespace — a `/` inside a word (like a path) never triggers it. `SlashCommandDropdown` shows matching skill names from this session's skill list (`filterSkillSuggestions`, case-insensitive substring match, capped at 20).
4. He presses **Tab** or **Enter** to select a skill → `handleSlashCommandSelect` splices the skill's invocation into the text at the slash's start.
5. Sam presses **Enter** (not Shift+Enter, and he's not on iOS) → the form submits: `e.currentTarget.form?.requestSubmit()`. If either dropdown is still open, keyboard events are captured by `handleSuggestionsKeyDown`/`handleSlashKeyDown` first, so arrow keys and Enter navigate the dropdown instead of submitting until it's dismissed or a selection is made.

**What the user should understand from the UI alone**: both dropdowns behave like a normal autocomplete (arrow to navigate, Enter/Tab to accept, Escape to dismiss) — nothing about them requires reading a keyboard-shortcut list.

### Variations
- Typing `@` with no sandbox available (no repo, or sandbox never provisioned) — the mention dropdown still opens but shows `filesLoading`/`CommandEmpty`-style results indefinitely or empty, since there's nothing to search.
- Typing `/` with zero skills configured for the session — `showSlashCommands` never becomes true (`slashSuggestions.length > 0` is required), so nothing appears; `/` in the text is left as plain text.
- Pressing **Escape** while a dropdown is open dismisses it (`closeSlashCommands`) without clearing the already-typed `/partial` text — the user can keep typing normally afterward.

### Edge Cases
- On iOS, Enter always inserts a newline instead of submitting (`!isIosDevice` guards the submit-on-Enter behavior) — the only way to send is tapping the Send button.
- If the composer is disabled (`isArchived || composerLock.locked`), typing `@` or `/` still works visually in a focused textarea state check, but the whole textarea is `disabled` at the DOM level, so no characters can actually be entered in the first place.

---

## STORY-414: Enriching a message — image, pasted text, drag-and-drop, and voice

**Type**: long
**Topic**: The Chat Loop
**Persona**: Marcus, reporting a UI bug: he has a screenshot, a long stack trace he wants to attach rather than paste inline, and wants to add a spoken clarification without typing it.
**Goal**: Send one message carrying an image, a large text attachment, and a dictated note.
**Preconditions**: Browser has clipboard/drag/microphone permissions available (or not, for the denial edge case).
**Ideal path**: 3 — paste the screenshot, paste the stack trace, then dictate a note, in any order, before sending once.
**Alternate paths**: 1 — click the paperclip (**Attach files**) button and pick files from a native file dialog instead of paste/drag, for either the image or the text file.

### Steps
1. Marcus copies a screenshot and pastes into the textarea (`onPaste`) → `isValidImageType` matches → `addImage(file)` runs, and `ImageAttachmentsPreview` shows a thumbnail with a remove control above the textarea. The paste event is prevented so no broken image markup lands in the text itself.
2. He pastes the long stack trace next → `isLargeText(pastedText)` returns true (over the large-text threshold) → the paste is intercepted (`e.preventDefault()`) and `addTextAttachment(pastedText)` creates a chip in `TextAttachmentsPreview` instead of dumping hundreds of lines into the visible textarea.
3. He drags a log file from his desktop onto the composer → `onDragOver`/`onDrop` handlers show a dashed-border overlay reading **"Drop files here"** (`Upload` icon) while `isDragging` is true, then `addAttachmentFiles(files)` runs on drop.
4. He clicks the microphone button (**Record voice input**) → `handleMicClick` calls `toggleRecording()` → `getUserMedia({ audio: true })` starts; the button turns solid red with a pulsing ring, and its label flips to **Stop recording**.
5. He speaks his clarification, clicks the mic again → recording stops, the button switches to a spinning loader (`recordingState === "processing"`), the audio blob is base64-encoded and `POST`ed to `/api/transcribe`. On success, the returned text is appended into the textarea (`prev ? \`${prev} ${transcribedText}\` : transcribedText`) — appended to whatever he'd already typed, not sent on its own.
6. He reviews everything in the composer (image thumbnail, text-attachment chip, transcribed text merged into the message) and presses Send. The submit handler builds a parts-based payload (`text` + `files` + `data-snippet` parts) because a text-snippet attachment is present.

**What the user should understand from the UI alone**: every attachment type gets its own visible preview before sending — nothing is attached invisibly; Marcus can always see and remove exactly what's about to go out.

### Variations
- Attaching via the paperclip button instead of paste/drag opens a native hidden `<input type="file" multiple accept="...">` dialog — functionally identical downstream (`addAttachmentFiles`), just a different entry point.
- Pasting *small* text (below the large-text threshold) is left as ordinary inline text in the textarea — only large pastes become attachments.

### Edge Cases
- **Microphone permission denied.** `startRecording`'s catch branch checks the error message for `"Permission denied"`/`"NotAllowedError"` and sets a specific `recordingError`: `"Microphone access denied. Please allow microphone access to use voice input."`, rendered as red text under the composer. `recordingState` resets to `"idle"` — the mic icon reverts to normal, no red pulse.
- **Transcription request fails.** A non-OK response from `/api/transcribe` sets `recordingError` to the server's own error message (via `readApiError`, falling back to `"Transcription failed"`); a thrown network error sets `"Transcription failed: <message>"`. Either way `recordingState` returns to `"idle"` and no text is inserted — Marcus has to try dictating again.
- **Send button disabled state.** The Send button (`ArrowUp`) is disabled unless there's real content — `input.trim()` non-empty OR at least one image OR at least one text attachment — so an empty message with only, say, a half-recorded (not yet transcribed) voice note in flight cannot accidentally be sent.
- Attaching files is blocked entirely once the session is archived (`isArchived` disables the paperclip, mic, and textarea alike) — see the composer-lock edge cases in STORY-418 for the MCP-driven equivalent.

---

## STORY-415: Configuring how the agent runs before sending

**Type**: long
**Topic**: The Chat Loop
**Persona**: Priya, about to hand off a sensitive task: she wants a specific model, wants the agent to have GitHub-issue tools available, wants the run recorded with verifiable evidence, and (if her workspace exposes it) wants to run a pre-built orchestration template instead of a freeform chat.
**Goal**: Set every relevant run configuration before sending her first message.
**Preconditions**: A session with at least one enabled model, Composio configured (or not — see variations), at least one managed-runtime profile, and (optionally) `OPEN_AGENTS_EXPOSE_WORKFLOW_CATALOG` set.
**Ideal path**: 1 — configure all the chips in the composer toolbar in any order, then send; none of them start a run on their own.
**Alternate paths**: none found for the model/tools/runtime-mode chips (composer-only); the deeper per-profile setup (creating a new managed-runtime profile, managing Composio connections) routes to Settings, out of scope for this topic.

### Steps
1. **Model.** Priya opens `ModelSelectorCompact` (only rendered once `chatInfo.modelId` exists) → picks a different model from the grouped-by-provider list. `onChange` calls `handleModelChange`, disabling the chip (`pointer-events-none opacity-60`) while `isUpdatingModel` is true.
2. **Tools.** She opens the **Select external tools** popover (`ComposioToolSelectorCompact`) → sees `"Tools this chat can use"` and the caption `"Selected for this chat — connection status shown in Settings → Composio."` → picks a Composio profile or individual toolkits via **Choose specific tools**. If GitHub is linked for this repo, a **Native connections** box shows `GitHub · Always on for this repo` above the picker — GitHub access isn't something she opts into per-chat.
3. **Runtime mode.** She opens `RuntimeModeSelectorCompact` (labeled **Direct** or **Delegated**) → reads the two radio options' inline descriptions (*"Agent edits files directly — fastest..."* vs. *"Agent delegates work to a verified sandbox worker and records evidence..."*) → switches to **Delegated** and picks a managed-runtime profile from the second radio group below the separator.
4. Because the selected profile isn't yet `"Tested"` (no `setup_and_verify` pass recorded), `RuntimeModeSelectorUntestedWarning` shows: `"Not yet tested — run Setup + verify first."` with an **Open Runtime Inspector** link — selection still succeeds; this only warns, it doesn't block.
5. **Workflow.** If `workflowCatalogExposed` is true, she opens `WorkflowPickerCompact` (**Workflow** chip, `Workflow` icon) → picks an orchestration template. The dropdown's own label clarifies: *"A workflow is a planned orchestration template for multi-step agent runs. It is separate from Direct vs Coordinated runtime mode."* Selecting one only sets local state (`setSelectedWorkflowId`) — it does not itself start anything.
6. Priya types her message and sends — all four selections (model, Composio selection, runtime mode/profile, workflow) travel with this send.

**What the user should understand from the UI alone**: every chip is a **configuration**, not an action — none of clicking through them starts a run; only the Send button does, and it carries whatever is currently selected.

### Variations
- **Composio not configured at all.** The popover's trigger shows `disabledReason: "No Composio profiles configured"` (distinct from a genuine fetch failure, `"Couldn't load Composio settings"`, and from the service being unavailable, which surfaces `data.status.message`).
- **Workflow catalog has zero runnable templates.** The chip stays visible but its tooltip reads `"Workflow templates are planned orchestration runs. None are runnable yet."`, and the dropdown body explains: `"These templates are not runnable yet, so chat will continue using the selected runtime mode."` — picking nothing is a safe, expected default.
- **`OPEN_AGENTS_EXPOSE_WORKFLOW_CATALOG` unset.** `WorkflowPickerCompact` returns `null` outright — the chip doesn't render at all; there is nothing to discover.

### Edge Cases
- All of these chips share one disabled condition with the Send button: `isArchived || isChatInFlight` (and the model chip additionally disables while `isUpdatingModel` or `modelOptionsLoading`) — none of them can be changed mid-turn while a response is streaming.
- Switching **out of** Delegated mode mid-project doesn't retroactively invalidate prior evidence — the Runtime Inspector (opened via `onOpenInspector`) remains the place to review what a Delegated run actually did, independent of what mode is currently selected.

---

## STORY-416: Watching a long multi-step run — thinking, subagents, todos, and cost

**Type**: long
**Topic**: The Chat Loop
**Persona**: Dana, who asked for a multi-file refactor and is now watching the agent work through it in real time rather than looking away.
**Goal**: Follow what the agent is doing and how much of her context budget it's using, without reading raw tool-call JSON.
**Preconditions**: A turn is actively streaming with reasoning, several tool calls, at least one `task` (subagent) delegation, and a `todo_write` call.
**Ideal path**: 0 — Dana is only observing; there's no action required to see any of this, it renders automatically as the stream arrives.
**Alternate paths**: none found — there's no "verbose mode" toggle; every user sees the same level of detail.

### Steps
1. A reasoning burst arrives first: a `ThinkingBlock` renders collapsed by default, showing the model's private reasoning text; `shouldKeepCollapsedReasoningStreaming` keeps it visually "streaming" only while genuinely still arriving and nothing renderable follows it yet.
2. A batch of tool calls follows. Because the assistant message now has collapsible content, `AssistantMessageGroups`/`ToolCallsSummaryBar` collapses the run into a one-line bar reading, e.g., **"6 tool calls · 2 files changed"** — expandable to see each call individually.
3. The agent calls `todo_write` with a task breakdown → `PinnedTodoPanel` appears pinned just above the input box (`mx-4`, rounded top border) showing `"3/8 Tasks"` with a chevron to collapse/expand; when minimized, it shows only the counter plus the current in-progress task's name in monospace. It automatically hides itself once every todo is done or none has started yet.
4. The agent delegates a chunk of work via `task` → `TaskRenderer` renders a distinct card: icon keyed to the subagent type (`Hammer` for executor, `Paintbrush` for design, `Telescope` for explorer, `Bot` as fallback), labeled **"Executor Subagent"** (or Design/Explorer), with a live-updating right-aligned stat line (**"N tools · M tokens"**) and, while running, a slide-up-animated preview of the subagent's current pending tool call inside the card. Once complete, the card expands to show every one of the subagent's own tool calls rendered with the real per-tool renderers (`BashRenderer`, `EditRenderer`, etc.) nested inside.
5. If this is a managed-runtime (**Delegated**) turn, the same `task` card instead reads **"Managed worker"**, with a cyan-accented `"Coordinator delegated"` line naming the worker type, sandbox name, profile, and profile-run id — and, if the worker returned a completion packet, a nested **Worker evidence** panel: status badge, changed-file count, verification-step count, and (for an isolated workspace) an integration-instructions hint.
6. Throughout, `ContextUsageIndicator` (next to the mic button, only visible once `inputTokens > 0`) shows a percentage plus a small circular progress ring; hovering reveals a breakdown — conversation input, cached input, uncached input, conversation output, and (when available) cost, labeled `"Cost"` for a gateway-billed run, `"Est. cost"` for a BYOK one, or `"Cost (partial est.)"` for a mixed run.
7. Dana, wanting the deeper evidence trail for the Delegated worker, clicks the runtime status area to open **Runtime Inspector**, where `GoalLedgerSection` shows this chat's recorded goal(s): objective text, a status chip (`draft`/`planned`/`running`/`awaiting_input`/`blocked`/`validating`/`complete`/`failed`/`canceled`/`archived`), evidence-ref chips, and a numbered event timeline. A `blocked` or `awaiting_input` goal shows an orange **"Needs attention"** banner with its blocked-reason text inline.

**What the user should understand from the UI alone**: the rendering deliberately mirrors the agent's own structure (todos, subagent delegation, evidence) rather than a flat scrolling log — Dana can tell what's actively in progress (the pinned panel's in-progress task, the subagent card's live preview) versus already finished (collapsed summary bars, checked-off todos) without reading raw text.

### Variations
- A message with a pending tool approval anywhere in it is force-expanded (`messageHasActiveApproval`) regardless of how much other collapsible content it has — Dana can never accidentally miss an approval prompt behind a collapsed summary bar.
- No goals recorded for this chat yet → `GoalLedgerSection` shows a plain `"No goals have been recorded for this chat."` empty state rather than an empty list.

### Edge Cases
- The context-usage indicator only appears once `inputTokens > 0` — a brand-new chat with no turns yet shows nothing there; it's not a persistent "0%" placeholder.
- The pinned TODO panel and the goal ledger are two genuinely separate systems reading different data (`getLatestTodos` from the live message stream vs. `GoalLedgerSection`'s `WorkflowGoalJson[]` from the Runtime Inspector's own fetch) — updating one does not necessarily update the other in lockstep, since they're populated by different tool calls (`todo_write` vs. the goal-ledger recorder steps in `chat.ts`).

---

## STORY-417: The approval loop in practice — Approve, Deny, Approve-all, and an inline question

**Type**: long
**Topic**: The Chat Loop
**Persona**: Marcus, working through a task where the agent needs to fetch two different URLs and, separately, asks him a clarifying multiple-choice question before proceeding.
**Goal**: Get through several interactive checkpoints in one turn without losing his place.
**Preconditions**: A browser turn where the agent issues two separate `web_fetch` calls in sequence and one `ask_user_question` call.
**Ideal path**: 3 — respond to each interactive element as it appears, in the order the agent raises them.
**Alternate paths**: 1 — use **Allow all this session** on the first approval to skip deciding on the second one individually.

### Steps
1. First `web_fetch` call appears with **Approve** / **Deny** / **Allow all this session** buttons (STORY-411's mechanics). Marcus clicks **Approve** — buttons vanish, `"Running..."` shows briefly, the fetch result renders.
2. A second, different `web_fetch` call appears later in the same turn. Because Marcus did **not** click Allow-all the first time, this one pauses for a fresh decision too — approval is per-call, not automatically extended after one manual approve.
3. This time he clicks **Allow all this session** → `handleApproveAllToolsForSession` sets the local `autoApproveToolCallsForSession` flag *and* immediately approves this specific call.
4. Shortly after, the agent calls `ask_user_question` with a set of questions. `AskUserQuestionRenderer` renders a distinct card (`MessageCircleQuestion` icon, name **"Ask user"**) — critically, this tool's own `needsApproval` is not part of the approval flow at all ("AskUserQuestion tool doesn't require approval, handled separately," per the dispatch comment in `ToolCall`) — no Approve/Deny buttons appear here.
5. Instead, `showInlineQuestion` becomes true: the composer's placeholder text and the primary action button change — the send-icon area shows a **Check**-icon button labeled with `inlineQuestion.buttonLabel` (compact label on narrow screens), disabled until `inlineQuestion.hasCurrentAnswer`. Pressing Enter while a question is active advances to the next question (`inlineQuestion.handleNext()`) instead of submitting the form as a chat message.
6. Marcus answers each question through this inline flow; once done, the completed card shows each question with its answer inline (`→ <answer>`), and any later, unrelated `web_fetch` call in this same session now auto-approves silently because of the Allow-all flag from step 3.

**What the user should understand from the UI alone**: three visually distinct interaction shapes exist for three different needs — a per-call Approve/Deny prompt for a risky action, a one-time session-wide opt-out of future prompts, and a completely separate inline-question flow for the agent simply asking for information (never a risk decision) — and none of them look alike, so Marcus never confuses "the agent wants permission" with "the agent wants information."

### Variations
- **Declining a question instead of answering.** If `ask_user_question`'s output later shows `declined: true`, the card's summary reads `"User declined to answer"` and its name renders in red — a different visual treatment from a plain `"Denied"` tool-approval card, even though both represent Marcus saying no to something.
- **Executor subagent proposal.** If a `task` call proposing an `executor` subagent (full write access) is ever the one carrying `approval-requested`, `TaskRenderer` adds an inline yellow warning beneath the normal approve/deny buttons: `"This executor has full write access and can create, modify, and delete files."` — a risk disclosure specific to that one subagent type.

### Edge Cases
- **Allow-all only applies going forward, not retroactively** — any approval that had already been resolved (approved or denied) before Marcus clicked it is untouched; only approvals still pending (or that appear later) auto-resolve, tracked via `autoApprovedToolApprovalIdsRef` so each id is only auto-approved exactly once.
- Reloading the page or opening the same chat in a second tab starts a fresh `autoApproveToolCallsForSession = false` — the "allow all" choice lives only in that one tab's component state, not in the database.

---

## STORY-418: The MCP run lock — a headless client holds the composer, then hands it back

**Type**: medium
**Topic**: The Chat Loop
**Persona**: Priya, who has an MCP client (her own script, or an assistant like Claude Desktop configured against the hosted MCP server) actively driving one of her sessions, and opens that same session in her browser mid-run to check on it.
**Goal**: Watch the run safely, and take over only if she decides she needs to intervene.
**Preconditions**: `activeRunSource: "mcp"` and `isStreaming: true` for this chat.
**Ideal path**: 0 — for pure observation, no action is needed; the composer simply stays locked while she reads.
**Alternate paths**: 1 — click **Take over** (twice — once to request, once to confirm) if she needs to steer the run herself.

### Steps
1. Priya opens the chat. `useMcpComposerLock({ activeRunSource: "mcp", isStreaming: true })` computes `locked = true` (not yet taken over). `McpRunLockNotice` renders as an amber alert bar above the composer: a `Bot` icon, **"This session is being driven by an MCP client"**, and **"A remote agent is waiting on this run. The composer is disabled until you take over."**, with one visible action: **Take over**.
2. The textarea itself is `disabled={isArchived || composerLock.locked}` — she can watch tool calls, thinking blocks, and todos stream in exactly as in any other run (the message stream is shared regardless of who's driving), but cannot type.
3. She decides she needs to intervene and clicks **Take over** → this doesn't take over immediately; it flips into a confirming state (`onRequestTakeOver` → `mcpRunTakeoverConfirming = true`). The banner's icon switches to `TriangleAlert`, its text changes to **"This is a remote agent's run."** / **"Taking over will steer or interrupt the run another client started and is waiting on. Are you sure?"**, and now shows two actions: **Cancel** and a destructive-styled **Take over**.
4. She clicks the destructive **Take over** → `composerLock.takeOver()` sets `takenOver = true`; `locked` recomputes to `false` (even though `activeRunSource` is still `"mcp"` and streaming is still ongoing) because `shouldLockComposer` checks `!takenOver`. The banner disappears, the textarea unlocks, and she can now type and send — interrupting or steering the MCP client's run.
5. Once that run genuinely ends (`isStreaming` goes false), an effect resets `takenOver` back to `false` — so the lock **re-arms automatically**: the next time an MCP client starts a new unattended run on this session, the composer locks again from scratch, regardless of Priya's earlier take-over decision.

**What the user should understand from the UI alone**: the two-step confirm on Take-over (request, then a visually escalated confirm) exists specifically so a browser user can't accidentally interrupt a remote agent's in-progress work with one stray click — the UI makes her deliberately affirm she understands what she's about to disrupt.

### Variations
- If she clicks **Cancel** during the confirming state, `mcpRunTakeoverConfirming` resets to `false` and the banner reverts to its original single-button state — no lasting effect.
- If Priya instead opens the chat from her *phone* (`/m/*` route group), the same lock concept exists via `mobile-tool-approval-bar.tsx`'s pending-approval bar and its own composer surface — same underlying `activeRunSource`/`isStreaming` state, adapted layout.

### Edge Cases
- **Losing/regaining connectivity mid-run.** Independent of the MCP lock, if Priya's own browser tab silently drops its stream connection (common after the tab is backgrounded, especially on iOS) while a turn is genuinely still in flight, `getStreamRecoveryDecision` in `stream-recovery-policy.ts` governs recovery: on a `visibilitychange`/focus event, if the chat looks idle (`status === "ready"`) it silently probes `/api/.../messages` (`ChatStreamingProbeResponse`) to check whether a workflow is actually still running server-side and reconnects the stream if so; if `status` shows `"submitted"` with no assistant content yet and more than 4 seconds (`STREAM_RECOVERY_STALL_MS`) have passed since the request started, it likewise probes. A hard `status === "error"` always triggers an immediate retry. All of this is throttled to at most once every 8 seconds (`STREAM_RECOVERY_MIN_INTERVAL_MS`) so a flapping connection can't hammer the probe endpoint. From Priya's point of view this is invisible when it works — she just sees the stream pick back up — and surfaces as the transient red error banner with a manual **Retry** button (STORY-401's edge case) only when automatic recovery itself fails.
- If the MCP client's run itself ends in one of the five headless-only outcomes (STORY-405–408, 410) while Priya is mid-observation without having taken over, she sees the exact same stop-reason text land in the transcript live, and the lock releases on its own the moment `isStreaming` goes false — she never needed to click Take Over just to regain the composer once the run is actually done.
