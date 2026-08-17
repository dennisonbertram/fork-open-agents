# UX Journeys — Agent Loops: Template, Builder, Triggers, Watchdog & Run Control

> Grounded against `apps/web/app/loops/**`, `apps/web/app/automations/agent-loop/**`,
> `apps/web/app/repos/[owner]/[repo]/loops/page.tsx`, `apps/web/app/api/agent-loops/**`,
> `apps/web/app/api/agent-loop-runs/**`, and `apps/web/lib/agent-loops/**`. Node
> kinds, edge `when` values, status enums, guardrail field names/defaults/
> ceilings, and error/rule strings below are copied from `lib/agent-loops/types.ts`,
> `lib/agent-loops/validation.ts`, `lib/db/schema.ts` (`agentLoops`,
> `agentLoopRuns`), and the corresponding UI copy files — not invented.
>
> **Same subsystem, two brand skins, three entry points.** `LoopDetail` and
> `BuilderCanvas` are single components rendered with a `surface: "legacy" |
> "automation"` prop. `/loops/[loopId]` and `/loops/[loopId]/builder` render
> `surface="legacy"` ("Loop", "Open builder"); `/automations/agent-loop/[loopId]`
> and `/automations/agent-loop/[loopId]/edit` render `surface="automation"`
> ("Multi-step Automation", "Edit Steps") against the identical database row.
> `/repos/[owner]/[repo]/loops` (`RepoLoopsPage`) always links onward to the
> **legacy** surface (`LoopCard` hrefs `/loops/${loop.id}`, "New loop" hrefs
> `/loops/new?repoOwner=...`) even though the repo dashboard itself is reached
> through the "Automations"-branded navigation. There is no data difference —
> only copy and URL — but a user bouncing between entry points sees the same
> loop called two different things.
>
> **Status vocabulary.** Loop lifecycle (`agentLoops.status`): `draft | active |
> paused | archived`. Run status (`agentLoopRuns.status`): `queued | running |
> paused | completed | failed | cancelled | stalled`. Trigger status
> (`backgroundAgentTriggers.status`): `enabled | disabled`. Watchdog run status:
> `pending | running | decided | failed`; watchdog decision: `retry | skip |
> pause`.

## STORY-701: First loop from a template, to Active, in one sitting

**Type**: long
**Topic**: Agent Loops
**Persona**: Farid, who wants a bot to review new PRs on `acme/api` and file GitHub issues for anything it finds, without hand-writing a graph.
**Goal**: Go from "I want this to exist" to an Active loop that will actually fire.
**Preconditions**: Farid is signed in, `AGENT_LOOPS_ENABLED=true`, and `acme/api` is inside `AGENT_LOOPS_ALLOWED_REPOS` (or the allowlist is `*`).
**Ideal path**: 6 — template pick → repo pick → create → land in builder already valid → flip status to Active → attach a trigger. Every template ships pre-validated (`loop-templates.test.ts` asserts each against `validateLoopDefinition`), so nothing between "Use this template" and "Active" requires fixing the graph itself.
**Alternate paths**: Farid could start from `/repos/acme/api/loops` → "New loop" (`newHref` pre-fills `repoOwner`/`repoName`, so the repo field is locked instead of an open combobox) — same form, same template gallery, redirects to the same legacy-surface builder. Or from `/automations/agent-loop/new` — identical `LoopCreateExperience`, but `surface="automation"` relabels everything "Multi-step Automation" / "Edit Steps" and the post-create redirect lands on `/automations/agent-loop/{id}/edit` instead of `/loops/{id}/builder`. Both paths write the same `agent_loops` row.

### Steps
1. Farid opens `/loops` and clicks "New loop". → `/loops/new`; `LoopCreateExperience` renders three tabs: Templates (default), Describe with AI, Blank.
2. On the Templates tab he reads the five cards — "Review to issues", "Review PRs and comment", "Backlog → PR", "Merge when green", "Email triage" (the last tagged "Needs setup") — each with a `FlowPreview` chip row (Start → node labels → Done) and a "Suggested trigger" line. He clicks "Use Review to issues template". → `chooseTemplate` sets `prefill`; the view swaps to a confirmation card showing the template name, description, and flow preview, plus `LoopCreateForm` prefilled with `initialName="Review to issues"` and the JSON tucked behind a collapsed "Advanced" `<details>` (`definitionCollapsible`).
3. He types `acme` / `api` into the `RepoCombobox`. → Free-typed or picked from repos he's used before.
4. He clicks "Create loop". → Before the POST, the form silently calls `GET /api/agent-loops/readiness?owner=acme&repo=api`; the `repo_access` check reports `ready` so nothing blocks. `POST /api/agent-loops` creates the row with `status: "draft"` (the default — nothing in this form sets it to anything else) and the exact template definition. Toast: `Loop "Review to issues" created.`
5. He's redirected to `/loops/{id}/builder`. → The two-node "Review code" → "File issues" chain renders on the canvas; the top-right badge reads "Valid" (green, `CheckCircle2`) because the template is pre-validated; the header shows a `StatusPill` reading "draft".
6. He clicks the loop's breadcrumb back to `/loops/{id}`, opens the "Loop status" `<Select>`, and picks "Active". → `PATCH /api/agent-loops/{id}` with `{status:"active"}`; toast `Loop status updated to active`; the meaning line below the dropdown updates to "Can run — triggers fire and Run now works."; "Run now" (previously disabled) becomes clickable.

### Variations
- Choosing "Backlog → PR" or "Merge when green" instead surfaces a `requiresTool`-free but trigger-dependent template — see STORY-702 and STORY-712.
- If Farid types a repo `acme/private-thing` that isn't in `AGENT_LOOPS_ALLOWED_REPOS`, step 4's precheck fetch returns a `repo_access` check with `status !== "ready"`; `getRepoAllowlistBlockMessage` returns `"This repository isn't enabled for loops on this deployment."` as a toast, and the POST never fires. If the precheck fetch itself fails (network blip), the form falls through and submits anyway — the real `POST /api/agent-loops` enforces the allowlist authoritatively regardless.
- If `AGENT_LOOPS_ALLOWED_REPOS` is unset entirely, `readiness`'s `repo_allowlist` check reports `missing` and the detail text reads "AGENT_LOOPS_ALLOWED_REPOS is required; loop dispatch is denied until it is configured." — same user-facing block message, different underlying `AgentLoopRepoRefusalReason` (`repo_allowlist_unconfigured` vs `repo_not_allowed`).

### Edge Cases
- The loop is created `draft` and stays that way until someone manually flips it — there is no "create and activate" shortcut. A first-timer who stops after step 5 has a loop that will never run (`getRunHistoryEmptyState("draft")` reads "No runs yet. Set the loop to Active to enable "Run now"." and the page banner reads "Loop must be in `active` status to run manually.").
- Even with status `active` and zero triggers, the loop only ever runs when someone clicks "Run now" — `getActiveStatusNote` renders "Active — runs manually only. Add a trigger to run automatically." right under the status dropdown so this isn't a silent trap.

---

## STORY-702: The fix→review cycle in "Backlog → PR" — a condition node with a real loop

**Type**: medium
**Topic**: Agent Loops
**Persona**: Priya, evaluating whether Agent Loops can replace a manual "assign issue → review → merge" ritual.
**Goal**: Understand what the `condition` node and the `true`/`false` edges in the "Backlog → PR" template actually do, especially the part that loops back.
**Preconditions**: Priya has created a loop from the "Backlog → PR" template (STORY-701 steps 1-5) and is looking at it in the builder.
**Ideal path**: 2 — open the "Passed?" condition node, then trace its two outgoing edges. The template ships already wired; there's nothing to build, only to read.
**Alternate paths**: none found — this is a comprehension journey over an existing template, not a construction task.

### Steps
1. Priya clicks the "Passed?" node (kind `condition`, amber `#f59e0b` in the palette). → The right-side node config panel opens showing "Context path" = `review.passed`, "Operator" = `eq`, "Value" = `true` — i.e. it reads `context.review.passed` written by the upstream "Review" `agent_step`.
2. She traces the two edges leaving "Passed?": one labeled `true` running forward to "Open PR", one labeled `false` running back to "Review" via "Fix issues". → `edge e5: gate→pr when=true`, `e6: gate→fix when=false`, `e7: fix→review when=success` — the graph re-enters a node ("review") it already visited.

### Variations
- If Priya instead opens "Open PR" (an `agent_step`), the config panel shows a `permissions.github.pullRequests: "write"` badge/section — the template's comment notes this is the one node in the chain allowed to run `gh pr create`, everything else stays read-only by default.

### Edge Cases
- Re-entering "review" is not an error. `validateLoopDefinition`'s VR-09 rule explicitly documents cycles as "positively accepted" — the runtime tracks it via `agentLoopRuns.iterationCount`, incremented whenever an edge targets an already-visited node, and the loop only stops looping via the `maxIterations` guardrail (default 10, ceiling 50) or the fix→review cycle eventually taking the `true` branch. A naive user might expect a loop back to a node to be flagged as a mistake; it isn't, by design.

---

## STORY-703: Describing a loop in plain English and getting a working graph back

**Type**: medium
**Topic**: Agent Loops
**Persona**: Marcus, who doesn't know the node vocabulary yet and just wants to type what he wants.
**Goal**: Turn "check my inbox and file feature requests as issues" into a real, editable loop without hand-authoring JSON.
**Preconditions**: Signed in, `AGENT_LOOPS_ENABLED=true`.
**Ideal path**: 3 — type the description, generate, create. The draft endpoint validates the graph server-side before ever handing it back, so there's no separate "fix the AI's mistakes" step in the happy path.
**Alternate paths**: He could click one of the three `AI_EXAMPLES` chips instead of typing (they populate the textarea verbatim, including the exact email-triage example that maps closely onto the "Email triage" template).

### Steps
1. Marcus opens `/loops/new`, clicks the "Describe with AI" tab, and types "Check my inbox; if a new email is a feature request, file it as an issue." → `Textarea` bound to `aiDescription`, `aria-label="Describe your loop"`.
2. He clicks "Generate loop". → `aiLoading=true`, button reads "Drafting…", helper text "Drafting your loop from your description — this usually takes 10-20 seconds." `POST /api/agent-loops/draft` with `{description}` calls `anthropic/claude-opus-4.6` (45s timeout) using a system prompt that spells out node kinds, the `context.<nodeId>.<field>` output-passing convention, and — notably — instructs the model to **not** wire a `failure` edge to `end` unless the user explicitly asked for failure handling (so a failed step fails visibly instead of masquerading as `completed`).
3. The model's positionless JSON is parsed, laid out left-to-right by BFS depth (`layoutDraftDefinition`, 340px column / 220px row gaps), and re-validated with the same `validateLoopDefinition` the builder uses. → `200` with `{name, description, definition}`; the view swaps to the same confirm-and-create card as the template flow, badged "AI draft" instead of "Template", with its own `FlowPreview`.
4. Marcus picks a repository and clicks "Create loop". → Same `POST /api/agent-loops` / redirect-to-builder path as STORY-701.

### Variations
- If he clicks an `AI_EXAMPLES` chip that's the literal PR-review-to-issues sentence, the result is functionally close to the "Review to issues" template — the AI path and the template gallery can converge on nearly the same graph via two different roads.

### Edge Cases
- A description under 8 characters never reaches the network — `aiDescription.trim().length < 8` shows a local error ("Add a sentence or two describing what the loop should do.") before any fetch fires.
- See STORY-704 for what happens when the model's output doesn't parse or doesn't validate.

---

## STORY-704: The AI draft comes back unusable

**Type**: short
**Topic**: Agent Loops
**Persona**: Marcus, mid-STORY-703, but the model's response this time doesn't parse.
**Goal**: Recover from a failed AI draft without losing his place.
**Preconditions**: Same as STORY-703, but the draft endpoint fails.
**Ideal path**: 2 — read the inline error, retry with clearer wording or switch tabs to a template. No dead end exists; the failure is local to the AI tab.
**Alternate paths**: Switch to the Templates tab instead of retrying — the two tabs are siblings in the same `Tabs` component, so nothing is lost by abandoning the AI attempt.

### Steps
1. Marcus clicks "Generate loop" with a vague description. → One of three failure branches server-side, each returning a **distinct `errorKind`** but near-identical user copy: network/timeout failure → `502 draft_failed` ("Couldn't reach the model to draft your loop..."); the model's text has no `{...}` object → `422 draft_unparseable` ("The model didn't return a usable loop..."); the JSON parses but fails `draftLoopSchema` or the post-layout `validateLoopDefinition` → `422 draft_invalid` ("The drafted loop didn't fit the expected shape..." / "...wasn't a valid graph..."). All four messages end the same way: "Try rephrasing, or start from a template."
2. The client shows `aiError` under the textarea (red text) and resets `aiLoading`; the textarea keeps his original text. → He edits the description and clicks "Generate loop" again, or clicks the "Templates" tab.

### Variations
- none found — every failure branch in `route.ts` funnels to the same client-side `setAiError(body.message ?? ...)` handling.

### Edge Cases
- A `draft_invalid` caused by the post-layout `validateLoopDefinition` call also carries a structured `errors` array (the same `LoopValidationError[]` shape the builder uses), but the draft route's client only reads `body.message` — the granular per-rule detail is discarded at this surface, unlike the create-form's own JSON editor which shows the full `ValidationErrorList`.

---

## STORY-705: Building from a blank definition, then finishing the graph visually

**Type**: medium
**Topic**: Agent Loops
**Persona**: Priya, who already knows the node/edge JSON shape and wants a starting skeleton she can extend by hand before switching to the canvas.
**Goal**: Create a minimal loop from raw JSON, then flesh it out using the builder's node palette instead of continuing to hand-edit JSON.
**Preconditions**: Signed in, `AGENT_LOOPS_ENABLED=true`.
**Ideal path**: 5 — Blank tab ships a valid two-node skeleton by default, so create succeeds on the first try; everything past that is builder work, not JSON work.
**Alternate paths**: none found for the create step — Blank is the only tab that starts from `DEFAULT_DEFINITION` rather than a template or AI draft.

### Steps
1. Priya opens `/loops/new`, clicks the "Blank" tab. → Renders `LoopCreateForm` directly (not `definitionCollapsible` — the JSON textarea is fully visible, not tucked behind "Advanced"), pre-filled with `DEFAULT_DEFINITION`: a `start` node, an `end` node, and one `always` edge between them — already valid, no name filled in.
2. She fills in "Name" and picks a repository, leaving the JSON untouched, and clicks "Create loop". → Same allowlist precheck and `POST /api/agent-loops` as STORY-701; redirected to `/loops/{id}/builder`.
3. In the builder she selects the "Start" node and clicks "Agent step" in the left palette. → `addNode` inserts a new `agent_step` node auto-connected from the selected node with `when: "always"` (per the palette's "click-to-add" behavior); the guidance panel's first step ("Start with one work card") flips to "done".
4. She clicks the new card, types instructions into the config panel. → The graph is now Start → Agent step → End, still valid (the default `end` node was already there and the new step auto-wired between Start and it — or she re-points the edge manually if it wasn't).
5. She clicks "Save". → Enabled once `isDirty && validationErrors.length === 0`; `PATCH /api/agent-loops/{id}` with the new `definition`; toast "Changes saved."

### Variations
- If she instead pastes a hand-written JSON definition into the Blank tab's textarea and blurs the field, `handleDefinitionBlur` runs the same `validateLoopDefinition` the server uses and shows a `ValidationErrorList` inline before she ever submits.

### Edge Cases
- The Blank tab's default definition has **no** `agent_step`/`github_check`/`condition` node at all — just Start → End. It is technically valid (passes every VR rule) but does nothing. Nothing in the UI flags "valid but empty" as different from "valid and useful" until the builder's guidance panel (`buildBuilderGuidance`) notices `hasRunnableCard === false` and headlines "Build the loop one card at a time."

---

## STORY-706: Building an invalid graph — disconnected node, no end, and an exitless cycle

**Type**: long
**Topic**: Agent Loops
**Persona**: Farid, mid-build on a custom loop, dragging nodes onto the canvas faster than he's wiring them.
**Goal**: Understand what breaks and how the builder tells him, at each of three distinct ways a graph can go wrong.
**Preconditions**: Farid has an empty-ish draft loop open in `/loops/{id}/builder` (Start → End only).
**Ideal path**: N/A — this is a deliberate error-recovery walk, not a single ideal path; each of the three malformed states below is reached and then fixed.
**Alternate paths**: The same three errors are also reachable by hand-editing raw JSON in `LoopCreateForm`'s textarea (`handleDefinitionBlur` runs the identical `validateLoopDefinition`) — the builder canvas isn't the only way to produce them, just the easiest.

### Steps
1. **Disconnected node.** Farid clicks "Condition" in the palette without first selecting a node. → A new `condition` node lands on the canvas with **no edges at all** (unselected add doesn't auto-wire — `handleAddNode` only passes `connectFrom` when a non-end node is currently selected). The top-right badge flips from green "Valid" to a red "3 errors" button (`AlertTriangle`) — three separate validation rules all fire off the same zero-edge node: `no_outgoing_edge` ("Node "condition-1" (kind: condition) has no outgoing edges...") from VR-04, plus `missing_condition_edge` twice from VR-05 — once for the missing `true` branch, once for `false`, since a condition node must have both.
2. He clicks the `no_outgoing_edge` error row. → `handleErrorClick` calls `fitView` centered on that node and marks it selected — the canvas pans/zooms to show exactly the offending card, no manual hunting.
3. He drags a `true` edge from the condition node to "End" and a `false` edge back to an existing agent step. → Both `missing_condition_edge` errors clear; the badge count drops.
4. **No end node at all.** He selects and deletes the loop's only `end` node via the trash/delete action. → `DeleteNodeDialog` confirms first ("Deleting **End** will also remove `<N>` attached edges. This cannot be undone.", `N` = however many edges currently touch that node) before removing anything. Once confirmed, the badge shows `no_end` ("Loop definition must have at least one end node; found none.") — and because BFS reachability (`VR-08`) is skipped whenever `endNodes.length === 0`, no separate "unreachable" error piles on top of it.
5. He clicks "End" in the palette to add one back and reconnects the dangling edge. → `no_end` clears.
6. **A cycle with no exit.** He wires a "Review" → "Fix" → "Review" cycle (both `success` edges) but never routes either node to "End". → The badge shows `end_unreachable` ("No end node is reachable from the start node. Check the graph for disconnected branches or infinite cycles with no exit.") even though every individual node still has an outgoing edge — VR-04 is satisfied, but the BFS from `start` never touches an `end` id.
7. He adds a third edge from "Fix" to "End" (`when: success`, alongside the loop-back edge already there). → `end_unreachable` clears; the badge reads "Valid" again; "Save" (previously disabled — `validationErrors.length > 0`) becomes clickable.

### Variations
- The same `end_unreachable` state is reachable more subtly: a `condition` node whose `false` branch dead-ends without ever reaching `end`, while the `true` branch does — BFS only needs **one** end node reachable, so this specific case would NOT trigger `end_unreachable` (the rule is "any end node reachable from start," not "every path reaches an end").
- A node id like `__proto__`, `constructor`, `prototype`, or `trigger` is rejected outright as `forbidden_node_id` — the last one specifically because the dispatcher bridge seeds `run.context.trigger` at run start, and a node id of `trigger` would collide with that context key.

### Edge Cases
- The distinction the UI draws is exactly "disconnected/dead-end" (an error) vs. "cycle" (`VR-09` — explicitly, positively legal, see STORY-702). A user who assumes any loop-back edge is a mistake will be surprised the validator is silent about it right up until the cycle genuinely has no exit.
- "Save" staying disabled is the only hard block — nothing stops Farid from navigating away mid-error with unsaved, invalid changes; `isDirty` just keeps showing "Unsaved changes" in the top bar until he either fixes it or discards by leaving.

---

## STORY-707: The "Archived" status claims read-only, but the builder doesn't enforce it

**Type**: short
**Topic**: Agent Loops
**Persona**: Priya, cleaning up old automations by archiving ones she no longer needs.
**Goal**: Confirm an archived loop is actually locked down, per what the UI tells her.
**Preconditions**: Priya owns a loop; she sets its status to `archived` via the status dropdown.
**Ideal path**: N/A — this story documents a gap between copy and enforcement, not a task with a "correct" number of steps.
**Alternate paths**: none found — every edit surface (builder canvas, settings panel, guardrails, watchdog) shares the same unguarded `PATCH /api/agent-loops/{id}`.

### Steps
1. Priya opens the loop's "Loop status" `<Select>` and picks "Archived". → `PATCH {status:"archived"}` succeeds unconditionally — `updateAgentLoop` in `store.ts` sets whatever `status` value it's given with no legality check between statuses (no `draft→active→paused→archived` state machine is enforced server-side; any status can move to any other). The meaning line updates to "Read-only. Kept for reference; can't run or edit."
2. She clicks "Open builder" anyway. → The builder loads normally; nothing in `page.tsx` or `BuilderCanvas` checks `loopStatus === "archived"` to disable anything.
3. She edits a node's instructions and clicks "Save". → The header Save button's only guard is `!isDirty || validationErrors.length > 0 || saving` — no status check. `PATCH /api/agent-loops/{id}` succeeds; toast "Changes saved." The archived loop's definition just changed.

### Variations
- The same gap applies to guardrails and watchdog settings in the docked settings panel — every field there PATCHes through the identical unguarded route.

### Edge Cases
- "Run now" is the one control that *does* stay honest for archived loops — it's gated on `loop.status !== "active"` everywhere (`loop-detail.tsx`'s button `disabled` prop, and `builder-canvas.tsx`'s `runNowBlockedReason` falling to `"Set to Active to run"` for any non-active status). So "can't run" holds; "can't edit" does not.

---

## STORY-708: Tightening guardrails, and hitting the server ceiling

**Type**: medium
**Topic**: Agent Loops
**Persona**: Marcus, worried an agent step could run away and burn budget, wants to cap it hard.
**Goal**: Set stricter safety limits than the defaults, and find out what happens when he asks for more than the platform allows.
**Preconditions**: Marcus has a loop open in the builder.
**Ideal path**: 4 — open settings, edit fields, hit one ceiling, correct it, save. The ceiling error is caught client-side before any network round trip.
**Alternate paths**: none found — guardrails are edited nowhere except this one docked panel (there's no separate guardrails API or page).

### Steps
1. Marcus clicks the gear icon in the builder top bar. → `LoopSettingsPanel` docks a 320px-wide panel on the right: Name, Description, then a "Safety limits" section ("Limits on how long and how far a run can go before it's stopped automatically") with five numeric fields: **Max steps per run** (placeholder 50, ceiling 200), **Max iterations** (placeholder 10, ceiling 50), **Max run duration (minutes)** (placeholder 120 / "2 hours", no ceiling), **Step timeout (minutes)** (placeholder 10, ceiling 30), **Agent turns per step** (placeholder 8, ceiling 32).
2. He sets "Max steps per run" to `500`. → The number input accepts it (the HTML `max` attribute doesn't hard-block keyboard entry); the header now shows "Unsaved changes."
3. He clicks "Save" in the top bar. → `handleSave` first runs `validateLoopSettings` client-side; it finds `maxStepsPerRun(500) > GUARDRAIL_CEILINGS.maxStepsPerRun(200)` and returns an error *before any fetch fires*. Toast: "Fix the highlighted loop settings, then save again." The field itself shows a red border and inline text "maxStepsPerRun cannot exceed the server ceiling of 200."
4. He corrects it to `150` and clicks "Save" again. → Validation passes; `PATCH /api/agent-loops/{id}` sends `{definition, name, description, guardrails: {maxStepsPerRun: 150, ...}, watchdogEnabled, watchdogInstructions, watchdogRetryBudget}` in one request (settings and the graph definition save together, per `#877`); toast "Changes saved."

### Variations
- Leaving a field blank (not `0`) means "use the platform default" — `guardrails` only carries keys the user actually touched (`setGuardrailField` deletes the key on `undefined`), so an untouched loop's `guardrails` column can be entirely empty and every ceiling/default in `GUARDRAIL_DEFAULTS`/`GUARDRAIL_CEILINGS` applies implicitly at run time (`resolveGuardrails` in `chain.ts`).
- "Max run duration" has no ceiling at all — per the spec comment in `types.ts`, `GUARDRAIL_CEILINGS.maxRunDurationMs` is explicitly `undefined`; only positivity is checked.

### Edge Cases
- The UI works in whole minutes for `maxRunDurationMs`/`stepTimeoutMs`, but the database and the executor work in milliseconds — `msToMinOpt`/`* MS_PER_MIN` conversions happen invisibly at the settings-panel boundary. A guardrail value saved by another surface (e.g. hand-edited JSON `definition.guardrails`) with a non-round-minute millisecond value would silently round when displayed here.

---

## STORY-709: Watchdog retries a flaky step, then exhausts its budget and pauses

**Type**: long
**Topic**: Agent Loops
**Persona**: Priya, whose "Backlog → PR" loop keeps failing on a flaky network call inside the "Implement" step, and she wants it to self-heal instead of paging her every time.
**Goal**: Turn on auto-recovery, understand what it will and won't do, and see it act during a real run.
**Preconditions**: Priya's loop is Active; the "Implement" `agent_step` is failing intermittently.
**Ideal path**: 5 — enable, configure, save, run, watch the watchdog work. No manual intervention needed unless the budget runs out.
**Alternate paths**: none found — watchdog is a per-loop toggle, not something invoked ad hoc from the run page.

### Steps
1. In the builder's settings panel, below "Safety limits", Priya finds "Auto-recovery (watchdog)" ("When a step fails, let an agent diagnose it and decide whether to retry, skip, or pause the run.") and flips the "Enable watchdog" switch. → Progressive disclosure reveals two more fields: "Watchdog instructions (optional)" and "Retry budget per node" (default `2`, max `5`).
2. She types into the instructions field: "Retries are fine for network errors. Never retry anything touching `gh pr merge`." → Standing text appended to every future watchdog diagnosis prompt for this loop.
3. She leaves the retry budget at `2` and clicks "Save". → `PATCH` persists `watchdogEnabled: true`, `watchdogInstructions`, `watchdogRetryBudget: 2`.
4. She clicks "Run now". The "Implement" step fails with a transient error. → `invokeWatchdog` fires: it checks `countWatchdogRetryDecisions({loopRunId, nodeId}) < budget(2)` — `0 < 2`, so it proceeds. It records `agent-loop.watchdog.started`, calls `anthropic/claude-haiku-4.5` (3-minute timeout) with the failure evidence plus her standing instructions, and gets back `{decision: "retry", diagnosis: "...", hint: "..."}`. The step is retried at `attempt+1` with the hint folded into the new step's input.
5. On the run detail page, a violet-tinted `WatchdogRow` appears interleaved in the step timeline: "Watchdog: Retry", node id, "attempt 1", "budget remaining 1", with a collapsible "Diagnosis" `<details>`.
6. The step fails the same way twice more. The third failure means `countWatchdogRetryDecisions` returns `2`, equal to the budget — no LLM call is made this time; the watchdog forces a **pause** immediately with diagnosis "Retry budget exhausted (2/2) for node implement", and `pauseLoopRunSystem` transitions the run to `paused`.
7. Priya reloads the run page. → `PausedDiagnosisBanner` reads "Watchdog paused this run" with the diagnosis text and "Decision: Pause · Node implement · Budget remaining 0" — distinct from the generic error banner, because this is a specific "watchdog decided to stop" state, not a raw run failure.

### Variations
- If the model instead returns `skip`, the watchdog calls `advanceToFailureEdge` — if the failed node has a `failure`-labeled outgoing edge in the snapshot, the run advances along it; if not, `advanceResult.outcome === "no_failure_edge"` and it falls back to `pause` anyway (never silently drops the run).
- A **stall-sweep-initiated** watchdog invocation (STORY-715) uses `legalDecisions: ["retry", "pause"]` — if the model still returns `skip` in that context, it's coerced to `pause` with a diagnosis note appended: "(skip illegal for this invocation — coerced to pause)."
- If the model's response is unparseable JSON or the call times out, the decision is forced to `pause` with `errorKind` `watchdog_output_invalid` or `watchdog_timeout` respectively — the watchdog never leaves a run hanging on a bad model response.

### Edge Cases
- The watchdog is deliberately **read-only in v1** — no sandbox, no tools, evidence-in-prompt only (`stepInput`/`stepOutput` are hardcoded `null` in the current prompt builder, a known v1 limitation noted in the source comment). Its diagnosis is reasoning over the error kind/message alone, not live inspection of the failed step's actual output.
- The retry budget is per-node, not per-run — a loop with five `agent_step` nodes each getting 2 retries could see up to 10 watchdog-driven retries across one run before every node individually exhausts its own budget.

---

## STORY-710: Adding a schedule trigger and an event trigger to the same loop

**Type**: medium
**Topic**: Agent Loops
**Persona**: Farid, who wants his review loop to run automatically instead of only via "Run now".
**Goal**: Attach both a nightly cron schedule and a PR-open event trigger.
**Preconditions**: Farid's loop is Active (or he accepts it won't fire until it is — see Edge Cases).
**Ideal path**: 4 — open Triggers, add schedule, add event, done; both triggers coexist independently, no conflict logic between them.
**Alternate paths**: none found for adding — the Triggers card lives in exactly one place, `LoopTriggersCard` on the loop detail page, reused unchanged by both the legacy and automation surfaces.

### Steps
1. Farid opens the loop detail page and clicks "Add trigger" in the "Triggers" card. → `LoopTriggerAddForm` opens with two tabs: **Schedule** (default) and **Event**.
2. On Schedule, he opens the "Schedule" preset dropdown: Hourly (`0 * * * *`), **Nightly at 2am UTC** (`0 2 * * *`), Weekdays at 9am UTC (`0 9 * * 1-5`), Custom cron. He picks "Nightly at 2am UTC". → Below the picker, a muted panel always shows the humanized schedule plus "Next 3 runs (UTC)" computed live via `computeNextRuns`.
3. He clicks "Save trigger". → `POST /api/agent-loops/{id}/triggers` with `{kind: "schedule.cron", name: "Schedule: <humanized>", schedule: "0 2 * * *"}`; toast "Trigger added"; the card now lists one row: "Schedule" label, humanized text, "Next run: <date> UTC", an enabled `StatusPill`, and a toggle switch defaulting on.
4. He clicks "Add trigger" again, switches to the **Event** tab, and picks "Pull request" from the "When this happens" dropdown (options: Pull request, Issue, Deployment status, Pull request review, CI checks finishing). → Saves as `{kind: "github.pull_request", name: "Pull request"}`; a second row appears.

### Variations
- Choosing "Custom cron" on the Schedule tab reveals a raw cron input (placeholder `0 9 * * 1-5`, helper text "Five fields, in UTC — minute hour day month weekday.") instead of a preset.

### Edge Cases
- Nothing in this form warns about overlapping triggers firing near-simultaneous duplicate runs — the 409 `active_run` conflict (STORY-716) is the actual backstop if a scheduled fire and a manual "Run now" collide.
- If the loop's status is not `active` when a trigger is added, `getTriggersInactiveWarning` immediately shows "Triggers only fire while the loop is Active." right under the "Triggers" header — the trigger still saves, it just won't do anything yet.

---

## STORY-711: Disabling and deleting a trigger

**Type**: short
**Topic**: Agent Loops
**Persona**: Marcus, whose loop's nightly schedule is too noisy while he's debugging it — he wants to silence it without losing the config, then eventually remove it.
**Goal**: Pause one trigger without touching the loop's own status, then delete it for good.
**Preconditions**: The loop has at least one trigger (from STORY-710) and is `active` or `paused`.
**Ideal path**: 2 — toggle off, later delete with confirmation.
**Alternate paths**: none found.

### Steps
1. Marcus clicks the `Switch` next to the schedule trigger's row. → `PATCH /api/agent-loops/{id}/triggers/{triggerId}` with `{status: "disabled"}`; the row's `StatusPill` flips from "enabled" to "disabled"; the loop itself is untouched (still `active`).
2. Later he clicks "Delete" on the same row. → An `AlertDialog` confirms: "Delete this trigger? This loop will stop firing automatically for this trigger. This cannot be undone." He clicks "Delete". → `DELETE /api/agent-loops/{id}/triggers/{triggerId}`; toast "Trigger deleted"; the row disappears.

### Variations
- If Marcus disables the loop's own status to `paused` instead of disabling the individual trigger, `getTriggersInactiveWarning` shows the same "Triggers only fire while the loop is Active." banner even though the trigger row itself still shows `enabled` — the trigger's own status and the loop's status are two independent gates that both have to be right.

### Edge Cases
- If the trigger list becomes empty after the delete, the card falls back to its empty state: "No triggers yet — this loop only runs when you press Run now. Add one:" with another "Add trigger" button.

---

## STORY-712: The suggested-trigger nudge on "Merge when green"

**Type**: medium
**Topic**: Agent Loops
**Persona**: Priya, who picked the "Merge when green" template without realizing it's inert without a trigger.
**Goal**: Notice the template's own warning and wire up the one trigger it actually needs.
**Preconditions**: Priya just created a loop from the "Merge when green" template.
**Ideal path**: 2 — land in the builder, click the one-click attach nudge. The template author already anticipated this gap and built a nudge for it.
**Alternate paths**: She could dismiss the nudge and add the same trigger manually via the Triggers card (STORY-710's Event tab, "Pull request") — functionally identical, just more clicks.

### Steps
1. On the Templates tab, Priya reads "Merge when green"'s description: "Check a PR's CI status; if it's passing, merge it. Teaches the GitHub check node. Needs a PR-event trigger to be useful — without one, there's no PR ref to check." and "Suggested trigger: On a new PR (attach a PR-event trigger after creating)." She clicks "Use this template", picks a repo, and creates. → The create form carries `suggestedTriggerSpec: {kind: "github.pull_request"}` (from `template.suggestedTriggerSpec`) through as query params on the post-create redirect (`appendSuggestedTriggerParams`), landing on `/loops/{id}/builder?suggestedTrigger...`.
2. In the builder, below the top bar, `TemplateTriggerNudge` renders: "This template works best with a trigger. **Pull request**" with a button "Attach suggested trigger: Pull request". She clicks it. → `POST /api/agent-loops/{id}/triggers` with `{kind: "github.pull_request", name: "Suggested pull request trigger"}`; toast "Trigger attached."; the nudge disappears and `router.replace` strips the query params from the URL.

### Variations
- If she dismisses the nudge instead ("Dismiss" button), it's gone for that page view but nothing is deleted or blocked — she can still add the identical trigger manually later.
- Creating the loop never auto-attaches anything by itself, by explicit design (noted three times in `loop-templates.ts`'s comments) — this is purely an opt-in one-click convenience, never a silent side effect of "Create loop."

### Edge Cases
- The "Check CI" `github_check` node in this template reads `trigger.ref` (`check: {kind: "ci_status", refFrom: "trigger.ref"}`) — a context key only populated when a run is actually dispatched *by* a PR-event trigger. If Priya dismisses the nudge and instead clicks "Run now" with no trigger attached, the check step has no `trigger.ref` to read and fails with a `condition_path_missing`-style error — the template's own description warns about exactly this ("without one, there's no PR ref to check").

---

## STORY-713: Pausing a running loop, then resuming it

**Type**: medium
**Topic**: Agent Loops
**Persona**: Farid, who notices a currently-running loop is about to touch a file he's mid-editing elsewhere and wants it to stand down for a few minutes.
**Goal**: Stop the run from advancing without cancelling it outright, then let it continue.
**Preconditions**: A loop run is `status: "running"`.
**Ideal path**: 2 — Pause, then Resume once ready. Both are single-click, no confirmation dialog (unlike Cancel).
**Alternate paths**: none found — pause/resume exist only on the run detail page's `RunActions`.

### Steps
1. On `/loops/{loopId}/runs/{runId}` (or the canonical `/runs/loop/{runId}`), Farid clicks "Pause" (only rendered when `status === "running"`). → `POST /api/agent-loop-runs/{runId}/pause`; button shows a spinner "Pause"; on success, toast "Pause successful"; `agent-loop.run.paused` event recorded. The pause is **cooperative** — it takes effect at the next step boundary, not mid-step; the currently-executing step still finishes.
2. The run's status becomes `paused`; "Pause" is replaced by "Resume". He waits, then clicks "Resume". → `POST /api/agent-loop-runs/{runId}/resume`; the store transitions the run and, if `currentStepRunId` is still set, re-dispatches that queued step via `start(runAgentLoopStepWorkflow, ...)`; on success, `agent-loop.chain.dispatched` is recorded and toast reads "Resume successful."

### Variations
- If the loop's own status was changed to `paused` (a *loop*-level pause, different from a *run*-level pause) while a run was mid-flight, the run itself is unaffected — loop status and run status are independent; pausing the loop doesn't pause its currently active run.

### Edge Cases
- If resume's re-dispatch itself fails (the workflow backend rejects the `start()` call), this is the same "no false success" contract as everywhere else in this subsystem: the run is force-transitioned to `failed` with `errorKind: "dispatch_failed"` via a conditional status transition (only from `running|queued|paused`), an `agent-loop.chain.dispatch_failed` event is recorded, and the resume call itself throws so the UI never reports "Resume successful" over a run that's actually dead. The toast becomes the shared `DISPATCH_FAILED_MESSAGE`: "Couldn't start the run — the execution backend rejected the dispatch. The run is marked failed; see the run page for details."

---

## STORY-714: Cancelling a run mid-flight

**Type**: medium
**Topic**: Agent Loops
**Persona**: Priya, who spots a run about to merge a PR she didn't mean to trigger a merge on, and wants it stopped for good — not paused.
**Goal**: Kill the run irreversibly before it does more damage.
**Preconditions**: A run is `queued`, `running`, or `paused` (`NON_TERMINAL_STATUSES`).
**Ideal path**: 2 — click Cancel, confirm in the dialog. The confirmation step is deliberate friction; unlike pause, this can't be undone.
**Alternate paths**: none found.

### Steps
1. Priya clicks "Cancel run" on the run detail page. → A `Dialog` opens: "Cancel run? The current step will finish or be abandoned at its boundary. This action cannot be undone." with "Keep running" and a destructive "Cancel run" button.
2. She clicks the destructive "Cancel run". → `POST /api/agent-loop-runs/{runId}/cancel`; on success, `agent-loop.run.cancelled` is recorded, `status` moves to `cancelled` (a terminal status), and toast reads "Cancel successful."

### Variations
- If she clicks "Keep running" instead, the dialog just closes — no request is made.

### Edge Cases
- Cancelling is *not* in `RETRYABLE_STATUSES` (`{"failed", "stalled"}`) — once cancelled, "Retry" never appears for this run; the only way forward is starting an entirely new run via "Run now" on the loop page.
- The confirmation copy is honest about the cooperative nature of the stop ("finish or be abandoned at its boundary") — cancel doesn't kill mid-step execution instantly, matching the same step-boundary cooperation pause uses.

---

## STORY-715: A run stalls, and the sweep catches it

**Type**: long
**Topic**: Agent Loops
**Persona**: Marcus, who left a `running` loop unattended overnight; the sandbox executing its current step silently died without ever posting a completion event.
**Goal**: Understand how a run that's neither failed nor progressing gets flagged, and what happens next automatically.
**Preconditions**: A run is `queued` or `running`, and its most recent `agent_loop_events` row is older than `AGENT_LOOPS_STALL_MINUTES` (default 15 minutes). A cron caller with `CRON_SECRET` hits `GET`/`POST /api/agent-loops/sweep` on its usual schedule.
**Ideal path**: N/A — this journey is entirely automatic; Marcus is a spectator to what the platform does, not an actor.
**Alternate paths**: If watchdog is disabled on this loop, the sweep still marks the run `stalled` — it just skips the auto-triage step and leaves it stalled for a human.

### Steps
1. The sweep runs (on its cron cadence). It loads every `queued`/`running` run whose latest event is older than the threshold — explicitly excluding `paused` runs (a deliberate suspension isn't a stall) and any already-terminal run.
2. For Marcus's run, it attempts a **conditional** status transition `queued|running → stalled` with `errorKind: "stall_sweep"`. → If the row was already moved by something else in the meantime (a race with a real completion, or a prior sweep), zero rows update and this candidate is silently skipped — no double-processing.
3. The transition succeeds. If the loop has `watchdogEnabled` and the run still has a live `currentStepRunId`/`currentNodeId`, `invokeWatchdogForStall` runs — same diagnosis machinery as STORY-709, but with `errorKind: "stall_sweep"` and `legalDecisions: ["retry", "pause"]` (no `skip` — there's no live failed-step failure edge to skip along for a stall). The retry budget is the **same shared per-node counter** watchdog failure-retries use, so stall-triggered retries count against it too.
4. An `agent-loop.run.stalled` event is recorded (`warn` level) with the stall duration and threshold. Once per sweep batch, an `agent-loop.sweep.completed` event is also persisted (attached to the first stalled run's id, since the event schema requires a run FK) with `{stalledCount, checkedCount, thresholdMinutes}`.
5. Marcus opens the loop detail page. → An amber banner above the run history reads "1 stalled run needs attention." (or the plural form); the run's row in the list shows a `StatusPill` "stalled" (amber, same treatment as `running`/`queued` — "stalled needs attention... never the neutral gray fallback," per the pill's own source comment) plus a small note "No activity for a while — the run appears stuck."
6. If watchdog decided `retry`, the run is back to `stalled`→ effectively continuing after the retry dispatch (a `WatchdogRow` "Retry" entry appears in its timeline, same as STORY-709). If it decided `pause` (budget exhausted, or watchdog disabled entirely), Marcus sees the same `PausedDiagnosisBanner` from STORY-709 and manually clicks "Retry" or "Cancel run" to move forward.

### Variations
- If the watchdog's evidence-gathering path itself throws an `AgentLoopSnapshotError` (e.g. the loop's definition snapshot is now invalid, or execution authorization was revoked), the sweep force-transitions the run straight to `failed` with the specific `errorKind` and records either `agent-loop.snapshot.invalid` or `agent-loop.execution.revoked` — never leaves it stuck at `stalled` with no way forward.

### Edge Cases
- A watchdog error on one candidate in a sweep batch is caught and logged, never aborting the rest of the batch — the sweep is defense-in-depth wrapped so one bad row can't block every other stalled run in the same pass from being processed.
- `AGENT_LOOPS_STALL_MINUTES` is operator-configurable; a deployment with a very low threshold (or a very long-running legitimate `agent_step`, up to the 30-minute `stepTimeoutMs` ceiling) could flag runs as stalled that are actually still working — the sweep has no way to distinguish "dead" from "just slow" beyond the event-recency heuristic.

---

## STORY-716: Run now fails to dispatch, and the 409-conflict cousin

**Type**: medium
**Topic**: Agent Loops
**Persona**: Farid, hitting "Run now" on an Active loop right as the execution backend is having a bad moment — and, separately, a teammate double-clicking "Run now" on a loop that already has something in flight.
**Goal**: Understand what "Run now" tells him when it doesn't just work, and what to do next in each case.
**Preconditions**: Loop is `active`, definition is valid, repository access is allowed.
**Ideal path**: N/A — this documents two distinct failure branches of the same button, not a single task.
**Alternate paths**: none found — "Run now" is a single shared hook (`useLoopRunNow`) used identically by the loop detail page and the builder header.

### Steps — branch A: dispatch failure (502)
1. Farid clicks "Run now". → `POST /api/agent-loops/{id}/runs`. The run row is created, but the workflow backend rejects the actual dispatch call.
2. Per the "no false success" contract (issue #763), the route does **not** return `{success:true}` — it returns `502` with `{success:false, errorKind:"dispatch_failed", runId, error}`. The run itself is already marked `failed` server-side before this response is sent.
3. The client shows the toast: "Couldn't start the run — the execution backend rejected the dispatch. The run is marked failed; see the run page for details." and — unlike a plain error — still navigates him to `/loops/{id}/runs/{runId}` (or the canonical URL), because a real run row *does* exist, just in a `failed` state, not a "nothing happened" state.
4. On the run page, `status === "failed"` puts it in `RETRYABLE_STATUSES` — Farid clicks "Retry". → `POST /api/agent-loop-runs/{runId}/retry` creates attempt `n+1` of the current node and re-dispatches; if *that* dispatch also fails, the same `dispatch_failed` contract applies again (conditionally transitioning only from `running|queued`, never silently leaving a phantom "retry succeeded" state).

### Steps — branch B: active-run conflict (409)
1. A teammate clicks "Run now" on the same loop while Farid's run from branch A (before it failed) — or any other run — is still `running`/`queued`/`paused`. → `409` with `{errorKind:"active_run", error:"This loop already has an active or paused run. Wait for it to complete, resume, or cancel it before starting a new run.", activeRunId}`.
2. The UI does **not** toast this as a generic error — `onActiveRun` renders an inline amber notice instead: "This loop already has an active or paused run: `{activeRunId}`. Wait for it to complete, resume, or cancel it before starting a new run." with a link straight to that run.

### Variations
- If the retry itself races another retry attempt (two tabs, both clicking "Retry" on the same stalled run), the store's TOCTOU-race rejection is humanized specifically for this case — not the generic `dispatch_failed` copy — as "Someone else already retried this run — refresh to see the latest attempt." (`RETRY_CONFLICT_MESSAGE`), distinguished from other `illegal_transition` messages by checking for the literal substring `"TOCTOU race"` in the store's error.

### Edge Cases
- Branch A's run is retryable specifically *because* dispatch failure lands it in `failed`, not some third "dispatch_pending" limbo status — from the UI's perspective a dispatch-failed run and a run that failed mid-execution for a completely different reason look identical (`RunActions` only branches on `status`, never on `errorKind`).
- `RETRYABLE_STATUSES` deliberately excludes `completed` and `cancelled` even though both are equally "terminal" — the store rejects retrying either, so "Retry" simply never renders for them (`isRetryable` check), rather than rendering and then erroring on click.
