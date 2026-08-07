# UX Stories: Guardrails and Limits

**Feature area:** Agent Loops — `maxStepsPerRun`, `maxIterations`, `maxRunDurationMs`, `stepTimeoutMs`
**Discovery source:** `docs/ux-paths/discovery.md`
**Code grounded:** `apps/web/lib/agent-loops/types.ts`, `apps/web/lib/agent-loops/chain.ts`, `apps/web/app/loops/[loopId]/runs/[runId]/run-detail.tsx`, `apps/web/lib/agent-loops/request-schemas.ts`

---

## STORY-001: Run Stopped and I Don't Know Why
**Type**: short
**Persona**: Priya, a platform engineer who built a loop that polls CI status, branches on the result, and loops back to re-check — a cycle by design.
**Goal**: Understand why her loop run stopped after what felt like a short time.
**Preconditions**: Loop is `active`, has no custom guardrails set (all defaults apply). Run was triggered manually. The loop's graph has a deliberate cycle: `check_ci → condition → agent_fix → check_ci → ...`. The run completed its 10th cycle visit and stopped.

### Steps
1. Priya opens `/loops/[loopId]/runs/[runId]` and sees the run's status pill shows **failed** in red. She expected it to keep cycling until CI passed. → The proof strip renders immediately from initial server data, then begins polling every 2s (`use-loop-run-polling.ts:11-12`).
2. She scans the proof strip. She sees `Iterations 10` with no denominator — there is no `/10` displayed because she never set a custom `maxIterations` and the guardrail JSONB column is `null`. The field just reads `10`. → She has no reference point; she doesn't know 10 is the default ceiling.
3. She scrolls to the error banner below the proof strip. It shows `guardrail_exceeded` with the message `Guardrail exceeded: maxIterations`. → `run-detail.tsx:284-295` renders the `errorKind` and `errorMessage` from `agent_loop_runs`.
4. She reads "maxIterations" and wonders what value that refers to. There is no number in the message, no link to documentation, and no indication of the default (10) or the server ceiling (50). → `chain.ts:261-262` sets `errorMessage: "Guardrail exceeded: maxIterations"` — the resolved value is not included.
5. She opens the event log and finds `agent-loop.guardrail.tripped` with a payload that includes `maxIterations: 10`, `iterationCount: 10`. This is the first place she sees the actual limit. → `chain.ts:231-234` records the full payload including the resolved value.

### Variations
- **Custom `maxIterations` set via PATCH:** If Priya had patched `guardrails.maxIterations = 20` before the run, the proof strip would render `Iterations 10 / 20` (`run-detail.tsx:255`), and the ceiling would be legible without diving into the event log.
- **`maxStepsPerRun` trips first:** If the step count reaches 50 (default) before 10 iterations, the `whichGuardrail` field in the event is `maxStepsPerRun` instead — same invisible-default problem.

### Edge Cases
- **`guardrails` JSONB is null:** The proof strip renders `Iterations 10` and `Steps 7` with no denominator (`run-detail.tsx:255`, `259`). The user sees a count with no ceiling. This is the common case for all loops created through the UI, which has no guardrail fields in the create form.
- **Both step and iteration ceilings trip simultaneously:** `chain.ts:221` checks `stepCountTripped` first; the event names `maxStepsPerRun` as `whichGuardrail` even if both are at ceiling.

### UX Friction Observed
- `run-detail.tsx:255` — when `guardrails` is null (the default for UI-created loops), the "Iterations" proof-strip field shows a bare count with no ceiling; users cannot distinguish "I set no limit and it ran forever" from "there is a hidden default and it tripped it."
- `chain.ts:261-262` — the `errorMessage` string is `"Guardrail exceeded: maxIterations"` but does not embed the resolved value (10); the user must dig into the raw event log payload to find the number.
- `apps/web/lib/agent-loops/types.ts:27-30` — `GUARDRAIL_DEFAULTS` are server-side constants with no user-facing surface; the create form (`loop-create-form.tsx`) and the loop detail page offer no "current effective limits" summary.

---

## STORY-002: Reading the Iterations Proof-Strip Field
**Type**: short
**Persona**: Marcus, a senior developer who just finished watching a completed loop run. He set `maxIterations: 7` via a PATCH call before triggering the run.
**Goal**: Confirm that his loop ran the expected number of cycles and did not hit the ceiling early.
**Preconditions**: Loop has `guardrails: { maxIterations: 7 }` stored in the JSONB column. Run completed normally (reached the `end` node on iteration 3). Status is `completed`.

### Steps
1. Marcus opens `/loops/[loopId]/runs/[runId]`. The run detail page loads with the completed status. → `run-detail.tsx` renders `RunDetail` with `initialData` from server; polls stop immediately because status is `completed`.
2. He reads the proof strip. The "Iterations" item shows `3 / 7`. → `run-detail.tsx:254-256`: `guardrails?.maxIterations` is `7`, so the display is `${run.iterationCount} / ${guardrails.maxIterations}`.
3. The "Steps" item shows `11 / 50` — his loop had no custom `maxStepsPerRun`, so the denominator comes from whatever was set. But wait: `guardrails` only contains `maxIterations`, not `maxStepsPerRun`. The denominator for Steps is absent — it shows `11` with no `/50`. → `run-detail.tsx:259`: `guardrails?.maxStepsPerRun` is `undefined` (not in the JSONB object), so the condition `guardrails?.maxStepsPerRun ? ...` is falsy, producing no denominator.
4. Marcus interprets "11" as "it ran 11 steps" and does not know the default ceiling was 50. He is satisfied because the run completed. → No immediate confusion here, but the asymmetry between `/7` for iterations and bare `11` for steps could be surprising during a partial run.

### Variations
- **Full guardrails object set:** If Marcus had PATCHed `{ maxStepsPerRun: 50, maxIterations: 7 }`, both denominators would render: `3 / 7` and `11 / 50`.
- **Run still in progress:** Same display, but values increment live as the 2s poll returns updated `run.iterationCount` and `run.stepCount`.

### Edge Cases
- **`guardrails` is non-null but a field is explicitly `0`:** `loopGuardrailsSchema` requires `z.number().int().positive()` (`types.ts:186-187`), so 0 is rejected at the API boundary; this state cannot exist in the DB via the API.
- **`guardrails` JSONB is an unexpected shape (DB corruption):** `run-detail.tsx:207-210` casts to `Record<string, unknown> | null | undefined`. A corrupted JSONB object would produce `undefined` for both `maxIterations` and `maxStepsPerRun`, silently reverting to bare-count display.

### UX Friction Observed
- `run-detail.tsx:259` — `maxStepsPerRun` denominator only renders if explicitly set in the `guardrails` JSONB object; the resolved server default (50) is never shown. Users with custom `maxIterations` but no custom `maxStepsPerRun` see inconsistent denominators in the same proof strip.
- `run-detail.tsx:207-210` — `guardrails` is cast via `as Record<string, unknown> | null | undefined` rather than parsed through the Zod schema; type safety at the display layer is weaker than at the API ingestion layer.

---

## STORY-003: Wanting to Raise a Limit and Finding No UI
**Type**: medium
**Persona**: Dario, a DevOps engineer who runs a long-horizon loop: it monitors a deployment pipeline, retries failed steps, and cycles up to 30 times before declaring success or failure. His loop keeps hitting the `maxIterations` ceiling at 10.
**Goal**: Raise `maxIterations` from the default 10 to 30 so his run can complete.
**Preconditions**: Loop was created via `/loops/new`. Dario is comfortable with the UI and has used the loop for a week. He knows his loop cycled 10 times and stopped from the event log.

### Steps
1. Dario opens `/loops/[loopId]` (the loop detail page). He expects to find a "Guardrails" or "Settings" section where he can type a new iteration limit. → He sees the loop name, status dropdown, description, definition JSON, triggers section, and run list. There is no guardrails section. `loop-detail.tsx` has no guardrails display or edit affordance.
2. He clicks the definition textarea area, thinking guardrails might be embedded in the JSON. The definition JSON only contains `nodes` and `edges` — no guardrail fields. → The definition schema is separate from guardrails; `loopDefinitionSchema` in `types.ts:175-180` covers only `nodes` and `edges`.
3. He returns to `/loops/new` to see if the create form has a guardrails section he missed. He reads every field: name, repo owner, repo name, description, loop definition JSON. No guardrails fields. → `loop-create-form.tsx:113-122` POSTs only `{ name, description, repoOwner, repoName, definition }` — guardrails are not in the form body. `createAgentLoopBodySchema` accepts `guardrails` but the form does not expose it.
4. Dario checks the product documentation link — there isn't one from the UI. He searches for "agent loops API" and finds the endpoint `PATCH /api/agent-loops/[loopId]`. → `updateAgentLoopBodySchema` in `request-schemas.ts:31-40` accepts `guardrails` as an optional field.
5. Dario opens his terminal and runs:
   ```
   curl -X PATCH https://app.example.com/api/agent-loops/loop_abc123 \
     -H "Content-Type: application/json" \
     -d '{"guardrails": {"maxIterations": 30}}'
   ```
   He gets a 401 because his session cookie is not a bearer token. He must figure out how to authenticate via cookie or a session token. → The PATCH handler uses `requireAuthenticatedUser()` which reads the better-auth session from the request cookie, not a bearer header.
6. After figuring out the correct curl invocation with cookie, the PATCH succeeds. The server clamps `maxIterations` at 50 (`GUARDRAIL_CEILINGS.maxIterations`), so `30` is stored as-is since it is below the ceiling. `resolveGuardrails` in `chain.ts:96` will use `Math.min(30, 50) = 30`. → Success. But Dario had to discover the API, figure out authentication, and send a raw HTTP request to do something as routine as "run my loop more times."
7. On the next run, the proof strip shows `Iterations 0 / 30` initially, then increments as the run progresses. Dario can now monitor progress against a visible ceiling. → `run-detail.tsx:255` now shows the denominator because `guardrails.maxIterations` is non-null.

### Variations
- **Dario sets `maxIterations: 60` (above ceiling):** The API does not reject the value (schema only requires positive integer), but `resolveGuardrails` clamps to `Math.min(60, 50) = 50`. The stored JSONB contains `60` but the run enforces `50`. The proof strip denominator would show `/ 60` (the stored value from JSONB, not the resolved ceiling) because `run-detail.tsx` reads raw JSONB without clamping. This is a mismatch: the proof strip may say `/ 60` but the run fails at 50.
- **Dario sets all four fields:** `{ maxStepsPerRun: 100, maxIterations: 30, maxRunDurationMs: 3600000, stepTimeoutMs: 600000 }` — all accepted. `stepTimeoutMs` is stored but the run detail proof strip has no field for it; it is enforced during `agent_step` execution but not visible on the run page.

### Edge Cases
- **PATCH with an empty `guardrails: {}`:** Valid per schema (all fields are optional). Stored as `{}` in JSONB. `resolveGuardrails({})` falls back to all defaults, same as `null`. No visible change to the proof strip denominators.
- **PATCH with `guardrails: null`:** Valid per `guardrailsBodySchema` (`.nullable().optional()`). Clears the JSONB to null, restoring all defaults — useful if Dario wants to reset.

### UX Friction Observed
- `loop-create-form.tsx:113-122` — guardrails are not in the POST body; the create form has no fields for them. A user setting up a long-running loop must do a separate PATCH after creation just to set sensible limits.
- `loop-detail.tsx` — there is no guardrails section on the loop detail page; there is no affordance to see or edit current guardrail values through the UI at all.
- `request-schemas.ts:18` — `guardrailsBodySchema` does not validate that values are below the server ceilings (`GUARDRAIL_CEILINGS`); values above the ceiling are accepted and stored but silently clamped at runtime, creating a discrepancy between stored JSONB and enforced limits.
- `run-detail.tsx:255,259` — the proof strip reads raw JSONB for denominators, not the resolved (clamped) value, so a user who stored `maxIterations: 60` sees `/ 60` even though the run will fail at 50.

---

## STORY-004: A Long-Running Step Times Out
**Type**: medium
**Persona**: Zara, an ML engineer whose loop includes an `agent_step` node that triggers a model training script in the sandbox. The script normally runs for about 12 minutes. Her loop has no custom `stepTimeoutMs`.
**Goal**: Understand why her agent_step failed with a timeout error and know what limit to change.
**Preconditions**: Loop is `active`. Default `stepTimeoutMs` is 10 minutes (`GUARDRAIL_DEFAULTS.stepTimeoutMs = 10 * 60 * 1000`). The agent step node was dispatched and the sandbox started the training script.

### Steps
1. Zara triggers her loop manually and watches the run detail page. The step timeline shows the `train_model` node in amber ("running"). → `run-detail.tsx:109,117` highlights the active step row; `useLoopRunPolling` polls every 2s.
2. After about 10 minutes, the step flips to `failed` (red) and the run status becomes `failed`. The error banner shows `workflow_failed` with message `Agent step timed out`. → `agent-step.ts` uses `AGENT_STEP_TIMEOUT_MS = 10 * 60 * 1000` (line 101) for the internal agent invocation; an AbortError results in a `workflow_failed` typed failure.
3. Zara reads the error and searches for "stepTimeoutMs" in the UI. She finds nothing — there is no mention of `stepTimeoutMs` on the run detail page, the loop detail page, or the create form. → `run-detail.tsx` has no proof-strip field for `stepTimeoutMs`; `loop-detail.tsx` has no guardrails display.
4. She checks the event log for `agent-loop.step.failed` events. The payload contains `errorKind: "workflow_failed"` and `errorMessage: "Agent step timed out"`. No mention of the 10-minute default or the `stepTimeoutMs` guardrail name. → The error message in `agent-step.ts` (approximate) maps an AbortError to a human-readable message but does not name the guardrail.
5. Zara infers she needs a longer timeout. She sends `PATCH /api/agent-loops/[loopId]` with `{ "guardrails": { "stepTimeoutMs": 900000 } }` (15 minutes). She is guessing at the field name. → `loopGuardrailsSchema` (types.ts:184-191) accepts `stepTimeoutMs`; the ceiling is 30 minutes (`GUARDRAIL_CEILINGS.stepTimeoutMs = 30 * 60 * 1000`).
6. After patching, Zara re-triggers the run. The step now has 15 minutes to complete. The training script finishes in 12 minutes and the step succeeds. → `agent-step.ts` reads the resolved `stepTimeoutMs` from the loop guardrails (via `resolveGuardrails`).

### Variations
- **Step timeout is within default:** If the training script ran in 8 minutes, Zara would never encounter this path. The default 10-minute `stepTimeoutMs` is also the internal `AGENT_STEP_TIMEOUT_MS` constant in `agent-step.ts:101`, not the same as the sandbox-level `DEFAULT_SANDBOX_TIMEOUT_MS` which may be different.
- **`maxRunDurationMs` expires first:** If the total run has been going for 2 hours (default `maxRunDurationMs`) across multiple steps, the guardrail check in `chain.ts:213-215` trips before the step even starts; `stepTimeoutMs` is never reached.

### Edge Cases
- **`stepTimeoutMs` set to 31 minutes (above ceiling):** Stored as `1860000` in JSONB; `GUARDRAIL_CEILINGS.stepTimeoutMs = 1800000` (30 min). The `resolveGuardrails` function in `chain.ts:85-101` does NOT clamp `stepTimeoutMs` — it returns `maxRunDurationMs` but not `stepTimeoutMs`; the `ResolvedGuardrails` type at `chain.ts:70-74` omits `stepTimeoutMs` entirely. It is up to `agent-step.ts` to read and enforce `stepTimeoutMs` directly from loop guardrails; the ceiling check may not be applied uniformly. Worth verifying.
- **`stepTimeoutMs` not set, `maxRunDurationMs` not set:** Both use defaults. The run can accumulate up to 2 hours of total wall time; any individual step can take up to 10 minutes. A loop with many short steps could complete well before either ceiling.

### UX Friction Observed
- `run-detail.tsx` — there is no proof-strip field for `stepTimeoutMs`; users cannot see the per-step timeout ceiling from the run page at all.
- `agent-step.ts:101` — `AGENT_STEP_TIMEOUT_MS` is a module-level constant, not directly sourced from the resolved guardrails; it is unclear from the UI whether `stepTimeoutMs` in guardrails actually overrides this constant or whether both limits compete.
- `chain.ts:70-74` — `ResolvedGuardrails` type omits `stepTimeoutMs`, which is present in `GUARDRAIL_CEILINGS` and `GUARDRAIL_DEFAULTS`; the ceiling for `stepTimeoutMs` (`30 * 60 * 1000`) is defined in `types.ts:23` but is not applied in `resolveGuardrails`.

---

## STORY-005: Checking Whether the Run Will Exceed the 2-Hour Wall Clock
**Type**: short
**Persona**: Olu, a reliability engineer who needs his loop (a nightly code review automation) to finish within a 2-hour CI window. He worries it might run over.
**Goal**: Confirm the run has a wall-clock cap and understand how much time has elapsed so far.
**Preconditions**: Loop has no custom guardrails. Default `maxRunDurationMs` is 2 hours (`GUARDRAIL_DEFAULTS.maxRunDurationMs = 2 * 60 * 1000 * 60 = 7200000`). Run has been going for 45 minutes. Status is `running`.

### Steps
1. Olu opens the run detail page mid-execution. The proof strip shows "Duration" as "Running" (formatted by `formatDuration` in `run-detail.tsx:32-43` when `finishedAt` is null). He sees a count of elapsed time is not rendered — "Running" is a static label. → He cannot read the elapsed milliseconds to compare against the 2-hour cap without doing arithmetic.
2. He looks for "Duration" as a ceiling — there is no `maxRunDurationMs` denominator in the proof strip. The proof strip never displays duration limits: only `Iterations` and `Steps` fields have ceiling denominators (and only when explicitly set). → `run-detail.tsx:263-265` shows `formatDuration(run.startedAt, run.finishedAt)` — a human-readable elapsed string — but has no ceiling display for `maxRunDurationMs`.
3. Olu opens the event log and looks for `agent-loop.guardrail.tripped` events. There are none — the run has not yet tripped the wall-clock guardrail. He reads the `payload` of the most recent step event and calculates from `createdAt` timestamps that about 45 minutes have elapsed. → Manual arithmetic is required.
4. Olu concludes the run should finish in time, but cannot confirm the 2-hour cap is actually enforced without reading `chain.ts`. He does not have access to source code. → The cap IS enforced: `chain.ts:213-215` computes `walledOut = now - loopRun.startedAt.getTime() >= guardrails.maxRunDurationMs` before each step.
5. If the run does hit the cap: status flips to `failed`, `errorKind = "guardrail_exceeded"`, and the error banner shows `"Guardrail exceeded: maxRunDurationMs"` — same as the iteration case. The event log has `agent-loop.guardrail.tripped` with `elapsedMs` and `maxRunDurationMs` in the payload.

### Variations
- **Operator wants a 30-minute cap:** PATCH `{ "guardrails": { "maxRunDurationMs": 1800000 } }`. There is no server ceiling on `maxRunDurationMs` (per spec: `GUARDRAIL_CEILINGS.maxRunDurationMs = undefined` in `types.ts:22`). A value of `1` (1ms) would immediately trip every run. No floor validation exists.
- **Operator sets `maxRunDurationMs: 0`:** Rejected by `loopGuardrailsSchema` which requires `z.number().int().positive()` — 0 is not positive.

### Edge Cases
- **`startedAt` is null:** `chain.ts:212-215` guards with `loopRun.startedAt != null`; if null, `walledOut` is false and the wall-clock check is skipped. This can happen if the run is still `queued` and the initial transition to `running` has not yet committed.
- **No server ceiling for `maxRunDurationMs`:** A user could PATCH `{ "maxRunDurationMs": 86400000 }` (24 hours) and the system would honour it. Long-running loops tie up workflow run capacity for the full duration.

### UX Friction Observed
- `run-detail.tsx:263-265` — "Duration" field shows a human-readable elapsed string but has no ceiling display (`/ 2h` or similar); users cannot tell from the proof strip that a wall-clock cap exists.
- `types.ts:22` — `maxRunDurationMs` has no server ceiling (`undefined`), unlike the other three guardrail fields; this inconsistency is not communicated anywhere in the UI.
- `chain.ts:222` — wall-clock check uses `>=`, not `>`, meaning a run that lands exactly on the `maxRunDurationMs` boundary is considered a guardrail trip, not a successful completion.

---

## STORY-006: Operator Wants to See All Effective Limits Before Starting a Run
**Type**: long
**Persona**: Benedita, a platform lead who manages 15 loops for her team. She wants a "limits audit" moment before triggering a high-stakes production run — confirming each guardrail value, knowing whether defaults or custom values apply, and knowing what the server ceilings are.
**Goal**: See all four guardrail values (effective, not just stored) in one place before triggering the run.
**Preconditions**: The loop in question has `guardrails: { maxIterations: 20 }` set via a prior PATCH. The other three fields are absent from the JSONB object. Loop status is `active`.

### Steps
1. Benedita opens `/loops/[loopId]` (the loop detail page). She scans all visible sections: name, status dropdown, repo, description, definition JSON display, triggers, and run history. She finds no guardrails section. → `loop-detail.tsx` has no guardrails display component.
2. She tries the loop's API directly: `GET /api/agent-loops/[loopId]`. The response includes the full `loop` object: `{ ..., "guardrails": { "maxIterations": 20 }, ... }`. She can see what is stored, but not the effective resolved values (defaults applied, ceilings clamped). → `GET` handler at `apps/web/app/api/agent-loops/[loopId]/route.ts:35-41` returns the raw DB row; no resolution layer is applied to the response.
3. She wants to know: what is the effective `maxStepsPerRun`? Since it is absent from the JSONB, she must know that the default is 50 from reading source code or external documentation — neither of which is linked from the UI. → `GUARDRAIL_DEFAULTS.maxStepsPerRun = 50` in `types.ts:28`.
4. She triggers the run and immediately opens the run detail page. The proof strip shows:
   - `Iterations 0 / 20` — denominator visible because `guardrails.maxIterations` is 20.
   - `Steps 0` — no denominator because `guardrails.maxStepsPerRun` is absent from JSONB.
   - `Duration Running` — no ceiling display.
   → She now knows the iteration ceiling but not the step or duration ceiling.
5. She opens the event log during the run and reads `agent-loop.guardrail.tripped` events as they would appear hypothetically: she studies the payload structure from prior run history — `{ maxStepsPerRun: 50, maxIterations: 20, maxRunDurationMs: 7200000, elapsedMs: ... }`. This payload is the only place all four resolved values appear together. → `chain.ts:228-233` records all three resolved values in the event payload.
6. Benedita decides to PATCH all four fields explicitly so the proof strip shows denominators for iterations and steps:
   ```json
   {
     "guardrails": {
       "maxStepsPerRun": 50,
       "maxIterations": 20,
       "maxRunDurationMs": 7200000,
       "stepTimeoutMs": 600000
     }
   }
   ```
   After patching, the next run's proof strip shows `Iterations 0 / 20` and `Steps 0 / 50`. `maxRunDurationMs` and `stepTimeoutMs` remain invisible in the proof strip. → `run-detail.tsx:255,259` only surfaces `maxIterations` and `maxStepsPerRun` as denominators; `maxRunDurationMs` and `stepTimeoutMs` have no denominator display.
7. Benedita notes that even with all four fields set, two of them (`maxRunDurationMs`, `stepTimeoutMs`) have no UI representation and are only verifiable via the raw API response or event log payloads. She documents the PATCH command in her team's runbook as the workaround. → End of story.

### Variations
- **Loop created via API with all guardrails set from the start:** `createAgentLoopBodySchema` (`request-schemas.ts:20-29`) accepts `guardrails` in the POST body, so a team using the API directly can set all four fields at creation time. Only the UI form is missing these fields.
- **Values set above ceilings:** `maxStepsPerRun: 300` is accepted by the schema (positive integer), stored as 300, but clamped to 200 at runtime by `resolveGuardrails`. The proof strip would show `Steps N / 300` but the run fails at 200 — a trust-eroding mismatch.

### Edge Cases
- **Loop deleted and re-created:** Guardrails must be PATCHed again; there is no copy/clone flow in the UI and no way to template guardrail defaults.
- **Two users PATCH guardrails concurrently:** `updateAgentLoop` in the store does a standard `UPDATE WHERE id = loopId AND userId = userId` — last writer wins; no optimistic concurrency token.

### UX Friction Observed
- `loop-detail.tsx` — there is no guardrails display or edit section; the loop detail page is the natural place to audit and adjust limits before a run, but offers nothing.
- `loop-create-form.tsx:113-122` — guardrails are absent from the POST body; only the API (not the UI) supports setting them at creation time, creating a two-step create-then-PATCH workflow for teams who need non-default limits.
- `run-detail.tsx:255,259` — only `maxIterations` and `maxStepsPerRun` have proof-strip denominators; `maxRunDurationMs` and `stepTimeoutMs` are invisible in the run UI even when explicitly set in guardrails.
- `request-schemas.ts:14-18` — schema comment explains that ceilings are not validated at the API boundary; they are only applied at runtime in `resolveGuardrails`. The stored JSONB can contain values that differ from runtime enforcement, making the raw API response misleading.
- `apps/web/app/api/agent-loops/[loopId]/route.ts:41` — `GET` response returns the raw `loop` object with unresolved JSONB guardrails; there is no resolved/effective representation exposed.

---

## STORY-007: Retrying After a Guardrail-Exceeded Failure
**Type**: medium
**Persona**: Carlos, a developer whose loop was building a multi-file refactor. It hit `maxStepsPerRun` at 50 (default) after completing 45 steps of work. He wants to raise the ceiling and resume from where it stopped.
**Goal**: Raise `maxStepsPerRun`, retry the run, and understand whether "Retry" resumes all work or restarts from the beginning.
**Preconditions**: Run has status `failed`, `errorKind: "guardrail_exceeded"`. `stepCount: 50`. The loop's graph has an `agent_step` node that was in the middle of iteration 3 of a planned 5-cycle refactor. The current step run (the one that was skipped by the guardrail) has status `skipped`.

### Steps
1. Carlos sees the run detail page with status `failed`, the error banner showing `guardrail_exceeded: Guardrail exceeded: maxStepsPerRun`, and the last step row showing status `skipped` (the step the guardrail blocked). → `chain.ts:254-259` sets the current step run to `skipped` before failing the run; this leaves a `skipped` row at the bottom of the step timeline.
2. He reads the run actions section. The only available action for a `failed` run is "Retry". He clicks it and reads the confirmation dialog. The button is labeled "Retry" — he expects this to retry the whole run from the start. → `run-actions.tsx` and `run-controls.ts` implement `retryCurrentStep`, not a full re-run; the UI label "Retry" does not convey this distinction.
3. Carlos first PATCHes the loop: `{ "guardrails": { "maxStepsPerRun": 100 } }`. The 200-step server ceiling (`GUARDRAIL_CEILINGS.maxStepsPerRun = 200` in `types.ts:19`) allows this. → The stored JSONB now contains `maxStepsPerRun: 100`; `resolveGuardrails` will use `Math.min(100, 200) = 100`.
4. He clicks "Retry" on the failed run. Per `run-controls.ts` (retryCurrentStep semantics), this re-dispatches the `skipped` step run at the current `currentNodeId` — it does NOT restart the run from the `start` node. The run re-enters `running` status and continues from the skipped step. → `run-controls.ts` `retryCurrentStep` path; the discovery doc notes: "labeled 'Retry' but calls `retryCurrentStep` (retries only the last step, not the whole run)" (`discovery.md:114`).
5. The re-dispatched step executes. The proof strip now shows `Steps 50 / 100` at the moment of re-entry (the counter was preserved from the failed run), and the run continues incrementing. The new ceiling (100) gives Carlos 50 more steps to complete the refactor. → `run.stepCount` is preserved across the retry; the raised ceiling lets the run continue.
6. The loop completes on step 73, well under the new ceiling of 100. Carlos sees `Steps 73 / 100` and status `completed`. → End of story.

### Variations
- **Carlos retries without patching the limit:** The run would trip the guardrail again immediately on the first step after retry (stepCount is still 50, ceiling is still 50). The run would fail again at `guardrail_exceeded`.
- **Carlos wants a full re-run (not retry-step):** There is no "Re-run from start" button in the UI. He would need to trigger a new run via "Run now" on the loop detail page, which creates a fresh `agent_loop_run` row with counters starting at 0.

### Edge Cases
- **`maxStepsPerRun` patched between the guardrail trip and the retry:** The PATCH updates the `loop.guardrails` JSONB. When `retryCurrentStep` re-dispatches, `chain.ts` loads the loop's current guardrails at execution time — so the new ceiling is immediately effective for the retry without any additional steps.
- **`stepCount` already at 50, new ceiling is 50:** Re-trip on first step. The PATCH must raise the ceiling strictly above the current `stepCount` for the retry to make progress.
- **"Skipped" step in timeline after guardrail trip:** `chain.ts:254-259` sets `status: "skipped"` and `finishedAt` on the current step run when the guardrail fires. After retry, the retried step creates a new attempt row (attempt N+1) alongside the existing `skipped` row — both appear in the step timeline, which can be confusing.

### UX Friction Observed
- `run-actions.tsx` — "Retry" label does not distinguish between retry-current-step and re-run-from-start; the confirmation dialog (if any) should clarify which step will be retried and how many steps of progress are preserved.
- `loop-detail.tsx` — no guardrails section means Carlos must PATCH via curl before clicking Retry; there is no UI flow that guides him through "raise limit → retry."
- `chain.ts:254-259` — the `skipped` step run remains in the timeline after a retry as a permanent historical artifact alongside the new attempt; the timeline UI has no annotation distinguishing "skipped by guardrail" from "skipped by pause" or "skipped by duplicate-advance."
- `run-detail.tsx:255` — after the PATCH but before the retry, the proof strip still shows `Steps 50 / 50` (reading the current failed run's JSONB, which was snapshotted at run time). Only after the retry run starts (new `stepCount` increments) does the ceiling reflect the patched value — but it's the same run, so the display updates via polling. This may briefly mislead the user into thinking the ceiling was not raised.
