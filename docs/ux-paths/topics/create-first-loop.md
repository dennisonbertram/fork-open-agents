# UX Story Topic: "Create Your First Loop" Onboarding

**Feature area:** Agent Loops — `/loops/new` create form
**Discovery source:** `docs/ux-paths/discovery.md`
**Code grounding:** `apps/web/app/loops/new/page.tsx`, `apps/web/app/loops/loop-create-form.tsx`, `apps/web/lib/agent-loops/validation.ts`, `apps/web/lib/agent-loops/types.ts`, `apps/web/app/api/agent-loops/route.ts`, `apps/web/lib/agent-loops/request-schemas.ts`

---

## STORY-001: Happy path — minimal start-to-end loop

**Type**: short
**Persona**: Marcus, a platform engineer at a mid-size SaaS company who has just had the feature flag `AGENT_LOOPS_ENABLED=true` set by his admin and wants to prove the feature works before investing time in a real workflow.
**Goal**: Create the simplest valid loop — just a start and end node — and confirm it appears in the loop list.
**Preconditions**: Marcus is authenticated. `AGENT_LOOPS_ENABLED=true`. No `AGENT_LOOPS_ALLOWED_REPOS` restriction. No loops exist yet.

### Steps

1. Marcus navigates to the sidebar, finds "Loops" under "Tools" (RefreshCw icon), clicks it → lands on `/loops`. Sees the "No loops yet — Create a loop to automate multi-step agent workflows" empty state with a "New loop" button.
2. Clicks "New loop" button (top-right of the `/loops` page, `Plus` icon) → navigates to `/loops/new`. Sees the "New loop" heading, the subtitle "Define a multi-step agent workflow using JSON.", and the form with fields: `name` (lowercase label), `Repository owner`, `Repository name`, `Description (optional)`, and the `Loop definition (JSON)` textarea.
3. Types `smoke-test` in the `name` field. Notices the label is literally lowercase "name" — slightly odd compared to the Title-Case sibling labels — but moves on.
4. Types `acme-corp` in `Repository owner`, `api-service` in `Repository name`. Does not fill `Description (optional)`.
5. Sees the `Loop definition (JSON)` textarea is pre-filled with the default stub. Does not touch it — it is already the minimal valid graph:
   ```json
   {
     "nodes": [
       { "id": "start", "kind": "start", "label": "Start", "position": { "x": 0, "y": 0 } },
       { "id": "end",   "kind": "end",   "label": "End",   "position": { "x": 200, "y": 0 } }
     ],
     "edges": [
       { "id": "e1", "source": "start", "target": "end", "when": "always" }
     ]
   }
   ```
6. Clicks "Create loop" → client runs `validateLoopDefinition`, it passes; `POST /api/agent-loops` returns 201; toast "Loop "smoke-test" created." fires; router pushes to `/loops/<id>`.
7. On the detail page Marcus sees the loop name `smoke-test`, a `draft` status pill, and "Run now" button that is visually grayed out. He has no idea why he cannot click it. → **First confusion point.**

### Variations

- With description filled: same flow; `description` sends to API as optional string.
- With repo name containing mixed case: `AGENT_LOOPS_ALLOWED_REPOS` check is case-insensitive (`config.ts:5`), so `Acme-Corp/API-Service` matches `acme-corp/api-service` in the allowlist.

### Edge Cases

- If `AGENT_LOOPS_ENABLED` is false, the `/loops` list shows "Loops feature is disabled — Ask your workspace administrator to enable the loops feature flag." (`loops-list.tsx:131-135`). Marcus cannot even reach the create form — the list blocks him but the route `/loops/new` itself has no feature-gate server-side check, so a direct URL visit still renders the form; `POST /api/agent-loops` returns `403 feature_disabled`.
- If `AGENT_LOOPS_ALLOWED_REPOS` is set and `acme-corp/api-service` is not in the list, the `POST` returns a 400 error (the store validation path). The form shows a toast "Failed to create loop." with no actionable message about the allowlist.

### UX Friction Observed

- `loop-create-form.tsx:160` — the `name` field label renders as lowercase "name" while all other labels are Title-Case. Inconsistency creates momentary hesitation.
- `apps/web/app/loops/[loopId]/loop-detail.tsx:266-271` — after a successful create, the user lands on the detail page with "Loop must be in `active` status to run manually." but there is zero explanation in the create form that loops start as `draft`. No inline guidance, no tooltip, no next-step prompt.

---

## STORY-002: First-timer authors a real agent_step node — hits missing edge error

**Type**: medium
**Persona**: Yuna, a DevOps engineer who read the feature announcement. She wants to build a loop that runs a CI-fix agent, checks CI status, and terminates. She has used YAML-based pipelines before but has never written a graph definition by hand.
**Goal**: Create a three-node loop: start → agent_step (fix CI) → end.
**Preconditions**: Authenticated. Feature enabled. No allowlist. The default stub is in the textarea.

### Steps

1. Yuna arrives at `/loops/new`, fills `name` as `ci-fix-loop`, `Repository owner` as `yuna-dev`, `Repository name` as `payments-service`.
2. Clicks into the JSON textarea. She replaces the default with what she thinks is correct, mentally mapping from "nodes are steps, edges are connections":
   ```json
   {
     "nodes": [
       { "id": "start", "kind": "start", "label": "Start", "position": { "x": 0, "y": 0 } },
       { "id": "fix",   "kind": "agent_step", "label": "Fix CI", "instructions": "Run the failing tests and fix the root cause.", "position": { "x": 200, "y": 0 } },
       { "id": "end",   "kind": "end",   "label": "End",   "position": { "x": 400, "y": 0 } }
     ],
     "edges": [
       { "id": "e1", "source": "start", "target": "fix", "when": "always" }
     ]
   }
   ```
   She forgets to add the edge from `fix` to `end`.
3. Clicks outside the textarea (blur) → `handleDefinitionBlur` fires → `validateLoopDefinition` returns error VR-04 → error list appears:
   ```
   no_outgoing_edge   Node "fix" (kind: agent_step) has no outgoing edges. Every non-end node must have at least one.
   ```
   Yuna reads the error. The rule code `no_outgoing_edge` is shown in `font-mono text-red-700`. She understands something is missing from `fix` but does not know the exact syntax for edges.
4. She looks at the existing `e1` edge and copies the pattern. Adds:
   ```json
   { "id": "e2", "source": "fix", "target": "end", "when": "always" }
   ```
   Clicks outside again → no errors. Good.
5. Clicks "Create loop" → client pre-validates (passes) → `POST /api/agent-loops` → 201 → toast "Loop "ci-fix-loop" created." → redirects to detail page.
6. She sees the detail page. "Run now" is grayed out. The banner says "Loop must be in `active` status to run manually." She looks at the right sidebar and finds a "Loop status" section with a dropdown showing "Draft". She selects "Active". A toast "Loop status updated to active" fires. Now "Run now" is enabled.
7. She clicks "Run now" → the loop starts. She feels successful, but it took two non-obvious discovery steps (fix the missing edge, then change status from draft to active).

### Variations

- If Yuna had typed `"when": "success"` on the `start → fix` edge: no error — `success` is a valid `EdgeWhen` value (`types.ts:154-160`). But if she had typed `"when": "true"` on that non-condition edge, she would see VR-06 `invalid_when`.
- If she had omitted the `instructions` field from the `agent_step` node: valid — `instructions` is optional (`types.ts:109`). The agent runs with no specific instruction text.

### Edge Cases

- If she pastes JSON with a trailing comma (common mistake from manual editing), `JSON.parse` throws and the form shows "Invalid JSON — please check your definition." (`loop-create-form.tsx:79`). No diff hint, no line number.
- If she sets `"id": "constructor"` on a node, the form shows error `forbidden_node_id` (`validation.ts:131`): `Node id "constructor" is forbidden (prototype-pollution-safe key restriction).` — confusing for someone who named a node after a conceptual "constructor step."

### UX Friction Observed

- `loop-create-form.tsx:208-210` — the only instruction near the textarea is "Paste or edit the loop definition JSON. Errors are validated on blur before saving." There is no link to docs, no example, no schema reference, and no list of valid `kind` values (`start`, `agent_step`, `github_check`, `condition`, `end`) or valid `when` values (`success`, `failure`, `true`, `false`, `always`).
- `loop-create-form.tsx:29` — validation errors render `err.rule` in `font-mono text-red-700`. These are internal rule codes (`no_outgoing_edge`, `missing_condition_edge`), not human-readable labels. A first-timer cannot tell what "no_outgoing_edge" means without cross-referencing the validation comment block in `validation.ts`.
- `apps/web/app/loops/[loopId]/loop-detail.tsx:242` — "Run now" is `disabled` when `loop.status !== "active"` but the only explanation is a muted-foreground banner. There is no button in the create flow or on the detail page to suggest "Activate this loop to run it" or to auto-activate on first creation.

---

## STORY-003: Condition node — user guesses wrong `when` value and gets two errors

**Type**: medium
**Persona**: Dmitri, a senior backend developer building a loop that checks a context variable (e.g., `pr_checks_passed`) and routes to different agent steps depending on the outcome.
**Goal**: Wire a `condition` node with true/false branches.
**Preconditions**: Authenticated. Feature enabled. Dmitri already created a simple loop before, so he knows the basic structure.

### Steps

1. Dmitri navigates to `/loops/new`. Fills in `name` = `pr-triage-loop`, owner = `dmitri`, repo = `backend-monorepo`.
2. He replaces the default definition with a condition-branching graph. He guesses that condition outgoing edges use `"when": "success"` and `"when": "failure"` (the natural language choice by analogy with CI systems), not `"when": "true"` / `"when": "false"`:
   ```json
   {
     "nodes": [
       { "id": "start",      "kind": "start",     "label": "Start",          "position": { "x": 0, "y": 0 } },
       { "id": "check",      "kind": "condition",  "label": "PR Checks OK?",  "position": { "x": 200, "y": 0 },
         "condition": { "path": "pr_checks_passed", "op": "eq", "value": true } },
       { "id": "fix-step",   "kind": "agent_step", "label": "Fix failures",   "position": { "x": 400, "y": 100 },
         "instructions": "Find and fix the failing checks." },
       { "id": "merge-step", "kind": "agent_step", "label": "Merge PR",       "position": { "x": 400, "y": -100 },
         "instructions": "Approve and merge the pull request." },
       { "id": "end",        "kind": "end",        "label": "End",            "position": { "x": 600, "y": 0 } }
     ],
     "edges": [
       { "id": "e1", "source": "start",      "target": "check",     "when": "always" },
       { "id": "e2", "source": "check",      "target": "merge-step","when": "success" },
       { "id": "e3", "source": "check",      "target": "fix-step",  "when": "failure" },
       { "id": "e4", "source": "fix-step",   "target": "end",       "when": "always" },
       { "id": "e5", "source": "merge-step", "target": "end",       "when": "always" }
     ]
   }
   ```
3. Blurs the textarea. Four errors appear simultaneously:
   ```
   missing_condition_edge   Condition node "check" is missing a "true" outgoing edge.
   missing_condition_edge   Condition node "check" is missing a "false" outgoing edge.
   invalid_condition_edge   Edge "e2" uses when="success" on condition node "check". Condition nodes may only have true/false outgoing edges; the runtime evaluator never traverses other when values.
   invalid_condition_edge   Edge "e3" uses when="failure" on condition node "check". Condition nodes may only have true/false outgoing edges; the runtime evaluator never traverses other when values.
   ```
4. Dmitri reads all four. It takes a moment — the first two say "missing true/false edge" while the last two say the edges he added are wrong. He eventually understands: rename `"when": "success"` → `"when": "true"` and `"when": "failure"` → `"when": "false"`. He makes the two edits.
5. Blurs the textarea again → no errors.
6. Clicks "Create loop" → 201 → redirects to detail. He changes status to "Active" and triggers a run.

### Variations

- If Dmitri adds a third outgoing edge from `check` with `"when": "always"`, he gets `invalid_condition_edge` for that edge even though true/false edges exist. VR-18 (`validation.ts:242-248`) blocks any non-true/false edge on a condition node regardless of whether the required branches are present.
- If he omits the `condition` config object entirely on the condition node, he gets `missing_node_config` (`validation.ts:307-312`): `Node "check" (kind: condition) is missing required "condition" config.`

### Edge Cases

- `exists` op requires no `value` field — `VALUE_EXEMPT_OPS` (`validation.ts:43`). Using `"op": "exists"` without `"value"` is valid. Using `"op": "eq"` without `"value"` yields VR-14 `missing_condition_value`.
- `condition.path` must be a non-empty string (`types.ts:57`). An empty string `""` yields VR-15 `schema_error`.

### UX Friction Observed

- `loop-create-form.tsx:29` — rule codes `missing_condition_edge` and `invalid_condition_edge` are shown together on the same node, but there is no grouping by node — Dmitri has to manually correlate four separate list items to one JSON node id.
- No inline indication near the `"kind": "condition"` token that condition nodes require `"when": "true"` / `"when": "false"` edges specifically. The distinction from `"when": "success"` / `"when": "failure"` is a key conceptual trap with no in-form guard rail.
- `validation.ts` comment in the file header lists all 18 rules but this information is completely inaccessible from the UI. A user would need to read source code to understand the taxonomy.

---

## STORY-004: github_check node — missing `check` config causes cryptic error

**Type**: short
**Persona**: Laila, a DevOps lead who wants to build a loop that polls CI status before proceeding. She is proficient with JSON but has not read internal validation docs.
**Goal**: Add a `github_check` node to a loop definition.
**Preconditions**: Authenticated. Feature enabled. Default stub is in the textarea.

### Steps

1. Laila navigates to `/loops/new`. Fills `name` = `ci-gate-loop`, owner = `laila-infra`, repo = `deploy-pipeline`.
2. Edits the definition to insert a `github_check` node between start and end. She knows about the `github_check` kind from a doc snippet, but does not know what sub-fields the `check` object requires:
   ```json
   {
     "nodes": [
       { "id": "start",    "kind": "start",        "label": "Start",      "position": { "x": 0, "y": 0 } },
       { "id": "ci-gate",  "kind": "github_check",  "label": "CI Status",  "position": { "x": 200, "y": 0 } },
       { "id": "end",      "kind": "end",            "label": "End",        "position": { "x": 400, "y": 0 } }
     ],
     "edges": [
       { "id": "e1", "source": "start",   "target": "ci-gate", "when": "always" },
       { "id": "e2", "source": "ci-gate", "target": "end",     "when": "always" }
     ]
   }
   ```
   She deliberately omits the `check` config because she does not know the schema.
3. Clicks "Create loop" directly (she skips the blur step). Client pre-validation fires → error:
   ```
   missing_node_config   Node "ci-gate" (kind: github_check) is missing required "check" config.
   ```
4. She now knows the field name is `check` but still does not know its shape. She tries:
   ```json
   "check": { "kind": "ci_status", "refFrom": "context.branch" }
   ```
   Blurs → no errors. Submits → 201. She is relieved but spent significant time guessing the shape of `check`.

### Variations

- `"kind": "list_issues"` does not require any extra fields (`types.ts:67-71`). Just `{ "kind": "list_issues" }` is valid.
- `"kind": "pr_status"` requires `"prNumberFrom"` (non-empty string). Omitting it gives VR-15 `schema_error` from the Zod discriminated union parse.
- `"kind": "deployment_status"` requires nothing beyond `"kind"` (environment is optional).

### Edge Cases

- If Laila writes `"check": {}` (empty object), the Zod discriminated union fails on VR-15 `schema_error`: `Invalid loop definition structure: nodes.1.check: Invalid discriminator value`.
- If she writes `"check": { "kind": "unknown_kind" }`, same VR-15 `schema_error` — `Invalid discriminator value`.

### UX Friction Observed

- `loop-create-form.tsx:205-219` — the textarea label is "Loop definition (JSON)" with no indication that different node kinds have different required sub-schemas. There is no list of `check` kinds (`list_issues`, `pr_status`, `deployment_status`, `ci_status`) anywhere in the UI.
- `validation.ts:294-305` — VR-12 only says "missing required check config", not what the `check` object should look like. There is no forward pointer to a schema or example.

---

## STORY-005: JSON parse error — accidental trailing comma blocks submit

**Type**: short
**Persona**: Tomás, a full-stack developer who is comfortable with code but habitually writes JSON by hand with trailing commas (from working in TypeScript/JSON5 contexts).
**Goal**: Create a loop with an agent_step node.
**Preconditions**: Authenticated. Feature enabled. Default stub in textarea.

### Steps

1. Tomás navigates to `/loops/new`. Fills `name` = `housekeeping`, `Repository owner` = `tomas-dev`, `Repository name` = `infra-tools`.
2. Edits the textarea, writes a three-node loop, and adds a trailing comma after the last edge object — a muscle-memory habit:
   ```json
   {
     "nodes": [ ... ],
     "edges": [
       { "id": "e1", "source": "start", "target": "step-1", "when": "always" },
       { "id": "e2", "source": "step-1", "target": "end",   "when": "success" },
     ]
   }
   ```
3. Clicks "Create loop" → client `JSON.parse` throws → form shows: "Invalid JSON — please fix the definition before saving." (`loop-create-form.tsx:98-100`). No line number, no diff highlight, no pointer to where the comma is.
4. Tomás stares at the wall of text in the monospace textarea trying to find the trailing comma. He eventually spot it and removes it.
5. Submits again → succeeds.

### Variations

- Blurring (instead of submitting) triggers the same code path via `handleDefinitionBlur` (`loop-create-form.tsx:72-87`). Error message is slightly different: "Invalid JSON — please check your definition." vs. "Invalid JSON — please fix the definition before saving."
- A missing closing brace shows the same error with no indication of depth or missing character.

### Edge Cases

- A completely empty textarea (user deletes all content and blurs): `JSON.parse("")` throws → "Invalid JSON — please check your definition."
- Pasting `null` or `42`: `JSON.parse` succeeds but Zod parse fails with VR-15 `schema_error`: `Invalid loop definition structure: nodes: Required`.

### UX Friction Observed

- `loop-create-form.tsx:79` and `loop-create-form.tsx:98-100` — the two error messages for invalid JSON are slightly different strings between blur and submit, which is a polish inconsistency.
- There is no syntax-highlighting or line-number gutter on the `Textarea` (`loop-create-form.tsx:212`). A full JSON tree above ~20 lines becomes difficult to debug by eye. The `min-h-48` class gives the textarea a fixed minimum height but no line numbers.
- `className="min-h-48 font-mono text-xs"` (`loop-create-form.tsx:217`) — the `text-xs` combined with `font-mono` works for readability but the textarea does not auto-grow, so a long definition forces scrolling inside a fixed-height box.

---

## STORY-006: Duplicate node id — copy-paste mistake triggers unclear error

**Type**: short
**Persona**: Wren, a backend engineer rapidly prototyping a multi-step loop by duplicating node entries.
**Goal**: Build a four-step loop quickly by copy-pasting node objects.
**Preconditions**: Authenticated. Feature enabled. Wren has created one loop before and understands the basic structure.

### Steps

1. Wren navigates to `/loops/new`. Fills `name` = `release-prep`, owner = `wren`, repo = `core-api`.
2. Copy-pastes a node entry to speed up authoring, forgets to change the `id` on the second copy:
   ```json
   {
     "nodes": [
       { "id": "start",  "kind": "start",      "label": "Start",    "position": { "x": 0, "y": 0 } },
       { "id": "step-1", "kind": "agent_step",  "label": "Lint",     "position": { "x": 200, "y": 0 } },
       { "id": "step-1", "kind": "agent_step",  "label": "Test",     "position": { "x": 400, "y": 0 } },
       { "id": "end",    "kind": "end",          "label": "End",      "position": { "x": 600, "y": 0 } }
     ],
     "edges": [
       { "id": "e1", "source": "start",  "target": "step-1", "when": "always" },
       { "id": "e2", "source": "step-1", "target": "end",    "when": "always" }
     ]
   }
   ```
3. Blurs → error appears:
   ```
   duplicate_node_id   Duplicate node id "step-1" (kinds: agent_step, agent_step). Node ids must be unique within a definition.
   ```
4. Wren immediately understands. She changes the second `"id": "step-1"` to `"id": "step-2"` and also adds the missing edge from `step-1 → step-2 → end`.
5. Blurs again → no errors. Submits → 201 → success.

### Variations

- If Wren had two nodes with different kinds but the same id (e.g., a `start` and an `agent_step` both with `id: "start"`), the error message includes both kinds: `Duplicate node id "start" (kinds: start, agent_step)`.

### Edge Cases

- Three or more nodes with the same id: VR-17 catches each duplicate pair. If `step-1` appears three times, two separate `duplicate_node_id` errors appear (first-vs-second, first-vs-third detection logic in `validation.ts:107-119`).
- After fixing the duplicate id, if Wren forgot to update the edge targets to match the new id, she will get VR-03 `dangling_edge` for any edge still targeting the old id.

### UX Friction Observed

- `loop-create-form.tsx:29` — the `duplicate_node_id` error message is reasonably clear, but the form highlights no specific line in the JSON. In a 30-line textarea, finding the two nodes with the same id requires scanning by eye.
- No "lint as you type" behavior — errors only fire on blur (`loop-create-form.tsx:71`) or submit. A user can write dozens of lines of JSON with multiple errors, then see them all at once.

---

## STORY-007: Long path — authoring a full CI-fix cycle with a condition loop-back

**Type**: long
**Persona**: Priya, a senior backend dev who just enabled the feature flag. She wants to build a CI-fix loop that: runs an agent step to fix a failing test, checks CI status, conditionally loops back to the fix step if CI still fails, or terminates if CI passes.
**Goal**: Author a looping graph with a `condition` node that cycles back on failure and terminates on success.
**Preconditions**: Authenticated. Feature enabled. Priya has read the discovery doc. She knows loops support cycles. No previous loops created.

### Steps

1. Priya navigates to `/loops/new`. Fills `name` = `auto-ci-fix`, owner = `priya-org`, repo = `checkout-service`.
2. Designs the graph mentally before typing:
   - `start` → `fix` (agent_step) → `ci-check` (github_check, `ci_status`) → `check-passed` (condition) →
     - true: `end`
     - false: back to `fix`
3. Types out the definition. She correctly uses `"when": "true"` / `"when": "false"` on the condition node, and `"when": "always"` elsewhere. She sets `refFrom: "context.working_branch"` for the CI check (guessing the context variable name — there is no documented list of available context keys in the UI).
4. She includes `outputSchema` on the `fix` node, wanting the agent to emit structured output:
   ```json
   "outputSchema": { "type": "object", "properties": { "files_changed": { "type": "array" } } }
   ```
   This is valid — `outputSchema` is `jsonSchemaLiteSchema` (`types.ts:90-91`), an open `z.record(z.string(), z.unknown())`.
5. Blurs the textarea. No validation errors. She is surprised — she expected some feedback given the complexity.
6. Submits → 201. Toast fires. She is redirected to the detail page. "Run now" is grayed out. The detail page shows `draft` status pill.
7. She finds the "Loop status" section in the right sidebar. The `Select` shows "Draft". She opens it and sees "Draft", "Active", "Paused", "Archived". She selects "Active". Toast: "Loop status updated to active". "Run now" button becomes enabled.
8. She clicks "Run now". Loop starts. She waits and watches the run detail page.
9. The loop iterates. On the second iteration, the condition branch fires correctly. On the fifth iteration, CI passes and the loop reaches `end` and completes.

### Variations

- If Priya had added an `"always"` edge out of `check-passed` alongside the `"true"` and `"false"` edges, she would get VR-18 `invalid_condition_edge` for the `"always"` edge. She must remove it.
- If she set `maxIterations` in the definition itself — she cannot. `guardrails` is not a field in the `definition` object. `guardrails` must be set via `PATCH /api/agent-loops/[loopId]` (`request-schemas.ts:18-28`). The create form has no `guardrails` section (`discovery.md` pain point 3).
- Cycles are explicitly legal (VR-09); the `fix → ci-check → check-passed → fix` cycle does not trigger any validation error.

### Edge Cases

- If the loop exceeds `maxIterations` (default 10, `types.ts:29`) before CI passes, the run terminates with status `stalled` or `failed` depending on the executor path. Priya sees the run status change with no explanation that the iteration ceiling was hit.
- The `refFrom` value `"context.working_branch"` is not validated by `validateLoopDefinition` — it is just stored as a string. If the runtime does not find this key in the loop's context at execution time, behavior depends on the executor's error handling, not the create-form validation.
- If Priya submits the definition while the textarea has a pending unsaved keystroke (typed but not yet recognized by React synthetic event), the form will POST the stale pre-keystroke JSON. No visual indicator of "unsaved changes."

### UX Friction Observed

- `apps/web/lib/agent-loops/types.ts:66-83` — `githubCheckSchema` has four kinds (`list_issues`, `pr_status`, `deployment_status`, `ci_status`), each with different required sub-fields. None of these are documented anywhere in the form UI. Priya guessed `refFrom: "context.working_branch"` — if the context key name is wrong, she will not learn this at create time; the loop will fail silently at runtime.
- `apps/web/lib/agent-loops/request-schemas.ts:20-29` — `guardrails` is in the API schema but completely absent from `loop-create-form.tsx`. A complex looping workflow like Priya's (up to 10 iterations by default) needs guardrail customization (e.g., raising `maxIterations` to 20). She must use a raw `PATCH` request after creation — there is no UI path.
- `apps/web/app/loops/[loopId]/loop-detail.tsx:266-271` — the "Loop must be in `active` status to run manually" notice renders as `text-xs text-muted-foreground`, a very low-contrast nudge. Priya found the status dropdown on her own, but the connection between "see this notice → open that dropdown" is implicit.
- No confirmation step or preview after "Create loop" — the definition is accepted as written and the run can start the moment Priya changes status to active.

---

## STORY-008: Allowlist-blocked repo — silent 400 with no actionable message

**Type**: short
**Persona**: Kwame, an engineer at a company whose admin has restricted `AGENT_LOOPS_ALLOWED_REPOS` to `acme-corp/payments-service,acme-corp/identity-service`. Kwame wants to create a loop for a different repo.
**Goal**: Create a loop for `acme-corp/frontend-app`.
**Preconditions**: Authenticated. Feature enabled. `AGENT_LOOPS_ALLOWED_REPOS=acme-corp/payments-service,acme-corp/identity-service` set. Kwame does not know about this restriction.

### Steps

1. Kwame navigates to `/loops/new`. Fills `name` = `frontend-cleanup`, owner = `acme-corp`, repo = `frontend-app`.
2. Leaves the default definition in the textarea. Clicks "Create loop".
3. Client-side validation passes (graph is valid). `POST /api/agent-loops` fires.
4. The server runs `isAgentLoopRepoAllowed("acme-corp", "frontend-app")` → returns `false` → `createAgentLoop` returns `{ ok: false, errors: [...] }` (or the store returns a 400 depending on implementation).
5. The form shows a toast: "Invalid loop definition." or a generic error message. No indication that the repo is not in the allowlist.
6. Kwame tries again with `Acme-Corp` (capitalized) → same result (`config.ts:4-5` normalizes to lowercase before comparing).
7. He is stuck. He has no idea the restriction exists. He contacts his admin.

### Variations

- If `AGENT_LOOPS_ALLOWED_REPOS=*`, no restriction applies (`config.ts:22-24`) — all repos are permitted.

### Edge Cases

- Repo name with a slash (e.g., if the user typed `acme-corp/frontend-app` as the repo name field rather than just `frontend-app`): the owner/repo split is determined by the two separate form fields (`repoOwner` and `repoName`), so this would just set `repoName = "acme-corp/frontend-app"` — the allowlist check would fail for a different reason (combined key `acme-corp/acme-corp/frontend-app`).

### UX Friction Observed

- `apps/web/app/api/agent-loops/route.ts:43-65` — the server returns `errorKind: "loop_invalid"` with `errors` from the store validation, but the error message for an allowlist rejection is surfaced as a generic toast ("Invalid loop definition." or "Failed to create loop.") with no indication about the allowlist. The form has no readiness check against `GET /api/agent-loops/readiness` before the user fills out and submits the entire form.
- `apps/web/app/api/agent-loops/readiness/route.ts` provides the `repo_allowlist` check status but this is never surfaced in the `/loops/new` form or the `/loops` list page — it is API-only.

---

## STORY-009: Definition exceeds 64KB — size error at submit time

**Type**: short
**Persona**: Ines, a data engineer who built an exhaustive loop with 150 nodes and hundreds of edges in a JSON document generated by a script.
**Goal**: Submit a large programmatically-generated loop definition.
**Preconditions**: Authenticated. Feature enabled. Ines has a ~70KB JSON blob ready to paste.

### Steps

1. Ines navigates to `/loops/new`. Fills `name` = `data-pipeline-orchestration`, owner = `ines-data`, repo = `etl-monorepo`.
2. Pastes the 70KB JSON into the `Loop definition (JSON)` textarea. The textarea scrolls; the page does not freeze.
3. Blurs the textarea → client calls `validateLoopDefinition` → VR-10 fires immediately because `JSON.stringify(definition).length > 64 * 1024`:
   ```
   definition_too_large   Loop definition exceeds the 64KB size cap (71680 bytes). Reduce the number of nodes, edges, or per-node config.
   ```
4. The error appears in the validation error list below the textarea. Ines now knows the limit and the current byte size.
5. She trims her definition — removes ~10 nodes, shortens `instructions` strings — and blurs again. No error at ~61KB. She submits successfully.

### Variations

- The size check (`validation.ts:60-77`) runs before Zod structural validation. If the JSON is also structurally invalid, only the size error is shown — not the structural errors. Once size is below 64KB, the structural errors may appear.

### Edge Cases

- A definition that is exactly 65535 bytes (just under 64KB) passes. Exactly 65536 bytes (`64 * 1024`) fails.
- The check calls `JSON.stringify(definition)` on the already-parsed object (`validation.ts:61`), not on the raw textarea string. So Unicode characters in `instructions` strings may expand or contract relative to the textarea character count.

### UX Friction Observed

- `loop-create-form.tsx:212-218` — the textarea has `min-h-48` but no `max-h` or character counter. Pasting a 70KB blob is visually identical to pasting a 2KB blob. There is no byte counter or size warning shown until blur.
- The error message `definition_too_large` (`validation.ts:71`) reports the current byte size (`71680 bytes`) but no target. A "current / max" display (e.g., "71,680 / 65,536 bytes") would be more actionable.

---

## STORY-010: Definition validates fine, but loop is stuck in draft — user never runs it

**Type**: long
**Persona**: Akira, a product engineer who created her first loop two weeks ago, validated it carefully, but never came back after the initial "Create loop" success. She assumed it was "live."
**Goal**: Understand why the loop has never run despite being created.
**Preconditions**: Loop `customer-onboarding-loop` exists with status `draft`. No runs. Akira is returning to check on it.

### Steps

1. Akira navigates to `/loops`. She sees `customer-onboarding-loop` in the list with a `draft` status pill (amber color). She clicks it.
2. Detail page loads. She sees: "Run now" button is grayed out. Run history section says "No runs yet. Click 'Run now' to start the first run." But the button is grayed out — she cannot click it. The message is contradictory.
3. She sees the smaller muted banner: "Loop must be in `active` status to run manually." This is the first written explanation she encounters, but it uses a monospace code token `active` that she does not immediately connect to an action she can take.
4. She looks at the top-right header area for any obvious action. She does not find a dedicated "Activate" button.
5. She looks at the right sidebar. She finds "Loop status" section with a `Select` dropdown showing "Draft". The `Select` component's trigger shows "Draft" — she clicks it, sees options: "Draft", "Active", "Paused", "Archived". She selects "Active".
6. Toast: "Loop status updated to active". The status pill in the header updates. "Run now" becomes clickable.
7. She clicks "Run now". Loop starts. She breathes a sigh of relief — but the time since creation to first run was two weeks, caused entirely by the invisible draft→active requirement.

### Variations

- If Akira had gone back to find her loop while a cron-triggered run was in progress (had triggers been configured), she would see the run in the run history regardless of draft status — triggered runs bypass the manual-only gate. But the form never explains this.

### Edge Cases

- Akira tries to click "Run now" while still in `draft` — the button is `disabled` (`loop-detail.tsx:242`) with no tooltip or aria-label explaining why. Screen reader users get no additional context.
- Akira changes status from `draft` directly to `paused` (skipping `active`). The API accepts this transition. The "Loop must be in `active` status to run manually" notice still shows — a paused loop also cannot run manually — but she now has to change status again.

### UX Friction Observed

- `apps/web/app/loops/new/page.tsx:34` — the subtitle "Define a multi-step agent workflow using JSON." and the post-create redirect give zero indication that the loop starts as `draft` and must be explicitly activated. No "What's next?" panel after creation.
- `apps/web/app/loops/[loopId]/loop-detail.tsx:266-271` — the `draft`-state notice is `text-xs text-muted-foreground` — 10px gray text. Low contrast, small font. It is easy to miss when "Run now" is the visually dominant CTA.
- `apps/web/app/loops/[loopId]/loop-detail.tsx:280-286` — "No runs yet. Click 'Run now' to start the first run." is shown when there are no runs, but it appears even when the loop is in `draft` and "Run now" is disabled. The instruction is literally impossible to follow in the current state.
- `apps/web/app/loops/[loopId]/loop-detail.tsx:242` — the "Run now" `Button` with `disabled={loop.status !== "active"}` has no `title` attribute, `aria-describedby`, or tooltip. The only explanation for why it is disabled is the muted banner below the header.
- No email, no notification, no highlight prompts the user to return to a `draft` loop. Once they navigate away from the detail page, the loop silently sits in `draft` indefinitely.
