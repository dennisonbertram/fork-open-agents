<!-- TITLE: feat: reusable policy-driven per-tool approval gate (park → approve/deny) for outward-facing actions -->

## Why this matters

Today approval is a one-off, hard-coded special case. `bashTool` carries an inline `commandNeedsApproval()` regex block in `packages/agent/tools/bash.ts`, the web client knows how to render that single tool's `approval-requested` state, and most recently `fetch.ts` simply hard-codes `needsApproval: true`. There is no general, reusable gate: every new outward-facing tool re-implements its own ad-hoc "should I pause?" logic, and there is no shared policy describing *what classes of action* are dangerous. The moment we add a browser tool that navigates arbitrary URLs (POC 1a), an MCP client that hits external services (POC 1c), or any `git push` / external-write capability, each one either ships ungated (unsafe) or reinvents the bash special-case (inconsistent, divergent, error-prone). Users get an approval prompt for one risky thing (some bash) and silent execution for others — exactly the inconsistency that erodes trust in an autonomous agent.

This feature builds a reusable, policy-driven "this action needs your sign-off" gate that parks any outward-facing or destructive tool call (destructive bash, `git push --force`, `git reset --hard`, external API writes, outbound messages) behind a human decision, then resumes on approve or returns a denied result on deny. The bet: a single, consistent, trustworthy "park → approve/deny" affordance lets users grant the agent *more* autonomy, not less, because the dangerous edges are reliably fenced. It is the trust substrate that makes the browser tool (1a) and MCP client (1c) safely shippable, and the seed of an audit-log / compliance story terminal-only competitors don't naturally have.

## User/operator path protected

The agent chat tool loop and its pause/resume boundary: `apps/web/app/workflows/chat.ts` stops the step loop when a tool part is `approval-requested` (`shouldPauseForToolInteraction`), persists the parked assistant message + tool parts at the pause boundary (`apps/web/app/workflows/chat-post-finish.ts`), and the resume POST persists the client's `approval-responded` part (`apps/web/app/api/chat/_lib/persist-tool-results.ts`, which already special-cases `state === "approval-responded"`). The client renders the parked/denied states off `packages/shared/lib/tool-state.ts` (`extractRenderState` → `approvalRequested` / `isActiveApproval` / `denied` / `denialReason`). Generalizing the bash special-case into a reusable policy must not regress: existing bash approval behavior, the existing pause/persist/resume flow, the rendering of `approval-requested` / `output-denied`, or the recently-added `fetch` approval.

## Behavior contract

- **Given** a tool call the policy classifies as requiring approval (e.g. `rm -rf ./build`, `git push --force`, an external `POST`), **when** the agent reaches it, **then** the call **parks** without executing, a `tool-approval-request` part is emitted carrying a stable `approvalId`, the tool part state is `approval-requested`, and **no side effect has occurred** (observable: marker absent at park time).
- **Given** a parked call, **when** the user **approves**, **then** the wrapped tool executes, an `output-available` result streams, the part state becomes `output-available`, and the side effect happens (marker present).
- **Given** a parked call, **when** the user **denies** (optionally with a reason), **then** an `output-denied` result streams carrying the reason, the part state becomes `output-denied` with `approval.approved === false`, and the side effect **never happens** (no marker).
- **Given** a safe action (read-only `GET`, `ls -la`), **when** the agent reaches it, **then** it passes straight through with no approval part and streams `output-available` directly.
- **Given** a parked record, **when** the process/store is reconstructed (stateless restart), **then** resume works from persistence alone (the parked record is JSON-serializable and the resume reads the `approvalId` only from the persisted record).
- **Given** two resume POSTs for the same `approvalId`, **when** both arrive, **then** the decision is applied **at most once** (idempotent compare-and-delete; no double execution).
- **Given** an unknown/unclassified command, **when** the policy evaluates it, **then** it conservatively defaults to **requiring approval** (unknown → approve).
- **Given** a parked action with no decision past its TTL, **then** it surfaces as `expired` and is not silently executed.

## Product and design spec

A composable approval policy plus uniform gate behavior across all outward-facing tools: a `packages/agent/tools/approval-policy.ts` module with layered policies (`bashPolicy` lifted out of `bash.ts`, plus `gitPushPolicy`, `externalWritePolicy`, composed first-match-wins), and `needsApproval: (input) => classify(toolName, input).requires` set on each outward-facing tool.

### UX — how users use it & how it's exposed

- **Inline in the chat stream (primary surface)**: when a gated action is reached, the agent visibly stops and renders an **approval card** with Approve / Deny buttons, exactly where the action would have run. Walkthrough: user says "clean up the release branch and force-push it" → agent commits and reaches `git push --force origin release` → policy classifies it history-rewriting → agent **parks**, card renders inline with the exact command, the reason, Approve/Deny → user sees it targets `release` (not `main`) and clicks **Approve** → card collapses to "Approved", push executes, `output-available` streams. Later "reset main to last week" → `git reset --hard` parks → user clicks **Deny** + types "wrong branch — leave main alone" → agent receives denial+reason and adapts; the reset never ran.
- **Settings → Agent Capabilities → "Require approval for"**: a per-repo policy panel with toggles/levels for action classes (destructive file ops, `git push` / history rewrite, external API writes, outbound messages). Power users can loosen (auto-approve a class) or tighten (require approval for all writes).
- **Session-level autonomy slider** ("Cautious / Balanced / YOLO") mapping to a policy preset, so users pick a posture once instead of clicking through every action.

### UX — how the feature demonstrates & explains its value to the user

- The **approval card itself is the value made visible**: it surfaces the exact command/args and a plain-language policy reason ("History-rewriting push — irreversible"), turning an invisible risky moment into a reviewable decision. The "caught the near-miss" moment (denying a `git reset --hard` on the wrong branch) is where the gate visibly pays for itself in one click.
- **Passthrough invisibility teaches trust**: safe actions never render a card, so the gate is silent until it matters — users learn it only interrupts for things they'd actually want to review, which is what keeps each prompt worth reading.
- **The captured deny reason flows back to the agent**, and the user sees the agent adapt ("Understood, I won't touch main — did you mean `release`?"), demonstrating that denial is a conversation, not a dead end.

### UX — how it's clear what the feature is doing (states & feedback)

- **Parked (awaiting)**: a bordered card with a caution accent, a one-line title ("Approve `git push --force` to `origin/release`?"), the exact command/args in a code block, the policy reason, and Approve (primary) / Deny buttons; the conversation below shows "Agent paused — waiting for your decision."
- **Approved**: card collapses to "Approved"; the tool result streams below (`output-available`); the agent continues automatically.
- **Denied**: Deny opens an optional reason field; the card collapses to "Denied — *reason*"; the reason flows to the agent.
- **Passthrough**: no card; the action just executes.
- **Expired**: "This request expired; ask the agent to retry" (TTL with no decision).
- **Superseded**: a second decision for an already-resolved request is idempotently ignored.
- **Notification**: if the user navigated away, a "1 action awaiting your approval" badge + optional push, since a parked agent is otherwise silently stalled.

### UX — how to test the UX, including regressions

Per the authenticated-local-UI-smoke discipline: DB-backed local app, sign in, open a session on a repo. **Happy-path smoke**: prompt the agent to perform a gated action (e.g. a destructive bash or a simulated `git push --force`), assert (a) an approval card renders inline with the exact command and a reason, (b) the conversation shows the paused state and nothing executed (no side effect / no result yet), (c) clicking **Approve** collapses the card to "Approved" and streams the result, (d) on a separate gated action clicking **Deny** with a reason collapses to "Denied — *reason*" and the side effect never happens, (e) a safe action produces no card. Reload the page mid-park and assert the card rehydrates from persistence. **UX regression locks**: a test that a part with `state: "approval-requested"` renders the approval card with Approve/Deny and the conversation marked paused (fails before generalized gate wiring renders new tools' cards; passes after); a test that `output-denied` renders the denied chip with the reason and shows no result; a test that a classified-safe action renders no approval card. A UX regression test asserts "a gated tool always parks behind a card before any side effect" and "a denied action shows the denial reason and never shows a result."

## Integration spec

- **Policy module**: add `packages/agent/tools/approval-policy.ts` from the POC's `src/classifier.ts` — `bashPolicy` (replacing the inline regex inside `packages/agent/tools/bash.ts#commandNeedsApproval`), plus `gitPushPolicy` / `externalWritePolicy`, composed first-match-wins, with the conservative "unknown → approve" default preserved.
- **Wiring**: set `needsApproval: (input) => classify(toolName, input).requires` on each outward-facing tool in `packages/agent/tools/` (registered in `index.ts`) — using AI SDK v6's existing `tool({ needsApproval })` parking, exactly as `bash.ts` does today and `fetch.ts` (`needsApproval: true`) does. No custom run/resume machinery is needed in production; the POC's `withApproval` is the framework-agnostic reference proving the four-path contract.
- **Pause boundary (exists)**: `apps/web/app/workflows/chat.ts`'s `shouldPauseForToolInteraction` already stops the loop on `approval-requested`; new gated tools inherit it.
- **Persistence (exists)**: parked parts persist via `apps/web/app/workflows/chat-post-finish.ts`; the resume POST persists `approval-responded` via `apps/web/app/api/chat/_lib/persist-tool-results.ts`. Add **idempotent compare-and-delete** on the parked-approval record so a second resume POST cannot double-execute.
- **Decision injection (exists)**: the client calls `addToolApprovalResponse({ id, approved, reason })`; the resume re-enters the workflow, the SDK matches the response to the parked `approvalId`, and runs `execute` (approve) or yields `output-denied` (deny).
- **State + renderer (exists)**: shapes already understood by `packages/shared/lib/tool-state.ts` (`approval-requested` / `output-denied`, `approval:{id,approved,reason}`); no `tool-state.ts` change required — new gated tools render through the same component with per-tool copy.
- **New**: TTL + expiry handling and operator notification; a Settings policy panel + autonomy preset.

## In scope

- `packages/agent/tools/approval-policy.ts` composable policy module (`bashPolicy`, `gitPushPolicy`, `externalWritePolicy`, first-match-wins, unknown→approve).
- Replacing the inline `commandNeedsApproval` in `bash.ts` with the policy module (behavior-preserving).
- Setting `needsApproval` via the policy on outward-facing tools registered in `packages/agent/tools/index.ts`.
- Idempotent compare-and-delete resume against the persisted approval record (no double execution).
- TTL/expiry + "awaiting approval" notification + expired/superseded states.
- Settings → Agent Capabilities "Require approval for" policy panel + session autonomy preset.
- Structured observability events for park/approve/deny/expire.

## Out of scope

- **End-to-end durable park/resume across a serverless teardown** — hard dependency on POC 2b (durable workflow / job queue); v1 is scoped to within-function-lifetime parks (plus DB-backed rehydration on the resume POST), and the full cross-restart workflow suspend/resume proof is deferred to 2b.
- **Gating the browser tool (1a) and MCP client (1c) specifically** — this issue provides the gate and policy; those tools register behind it in their own issues.
- **AI SDK 7 migration** (`needsApproval` → `toolApproval`) — the policy module is unaffected, but the wiring-point move is deferred until the upgrade.
- A full audit-log/compliance export UI (the events are emitted; the export surface is a stretch).

## Research and context sources

- POC PR **#81** (branch `poc/1b-approval-gate`) and folder `POC/1b-approval-gate/`.
- Eval evidence: `POC/1b-approval-gate/evidence/` — `path-A-park-chunks.json` (stable `approvalId`, marker absent), `path-B-approve-chunks.json`, `path-C-deny-chunks.json` (carries operator reason), `path-D-safe-chunks.json`, `persisted-parked-record-git.json` / `persisted-parked-record-http.json` (durable serializable records), `side-effect-*.marker` (ground-truth: deny leaves none), `summary.json` (22 assertions, 0 failures).
- Product brief: `POC/1b-approval-gate/PRODUCT-BRIEF.md` (TL;DR, gap, case FOR/AGAINST, greenlight trigger).
- README integration plan: `POC/1b-approval-gate/README.md`.
- External research findings (from README): AI SDK v6 `tool({ needsApproval })` already implements parking; AI SDK 7 renames it to `toolApproval`; `bash.ts` already defaults unknown commands to needing approval; `tool-state.ts` already maps `approval-requested`/`output-denied`; the existing `chat.ts` pause boundary and `persist-tool-results.ts` resume path require no changes.

## Agent todo checklist

- [ ] Write failing policy unit tests: destructive bash / `git push --force` / external `POST` → requires; read-only `GET` / `ls -la` → passthrough; unknown → requires.
- [ ] Write failing four-path behavior test (park / approve / deny / passthrough) asserting an observable side-effect marker and the emitted part states.
- [ ] Write failing idempotency test: two resume POSTs for one `approvalId` execute at most once.
- [ ] Confirm red; commit red tests.
- [ ] Add `packages/agent/tools/approval-policy.ts`; replace `bash.ts`'s inline `commandNeedsApproval`.
- [ ] Wire `needsApproval` via the policy on outward-facing tools in `index.ts`.
- [ ] Add compare-and-delete idempotency on the persisted approval record.
- [ ] Add TTL/expiry + notification + expired/superseded states.
- [ ] Add Settings policy panel + autonomy preset.
- [ ] Add structured observability events + typed error kinds.
- [ ] Run targeted tests green; commit green.
- [ ] Authenticated local UI smoke (park → approve, park → deny, passthrough, reload-rehydrate); capture evidence.
- [ ] `git diff --check`; `bun --bun run ci`.

## Tests to add first

- **Policy classification (behavior)**: `classify("bash", {command:"rm -rf ./build"}).requires === true`; `git push --force` and external `POST` require; read-only `GET` and `ls -la` pass; unknown command requires.
- **Four-path contract (behavior, observable side effect)**: a gated tool parks with no marker and emits `approval-requested` with a stable id; approve → marker present + `output-available`; deny → no marker + `output-denied` carrying the reason; safe → marker present, no approval part.
- **Durability/rehydration**: resume using only a freshly-constructed store/DB handle (no in-memory carry-over) executes the approved action.
- **Idempotency (UX/system)**: two resume POSTs for the same `approvalId` result in exactly one execution (compare-and-delete) — fails before the guard, passes after.
- **Renderer UX**: `approval-requested` renders the Approve/Deny card with the exact command + reason and a paused-conversation marker; `output-denied` renders the denied chip with the reason and no result.

## Observability and user feedback

- **User-visible status**: the inline approval card (parked), "Approved"/"Denied — *reason*" collapsed chips, "Agent paused — waiting for your decision", expired/superseded copy, and an "N actions awaiting your approval" badge/push.
- **Named service + structured events**: an `approval` service emits `approval.requested` (info; fields `approvalId`, `toolName`, `policy`, `reason`, `chatId`, `sessionId`, `userId`), `approval.approved` (info; fields `approvalId`, `toolName`, `decidedBy`, `latencyMs`), `approval.denied` (info; fields `approvalId`, `toolName`, `reason`), `approval.passthrough` (debug; fields `toolName`, `policy`), `approval.expired` (warn; fields `approvalId`, `ttlMs`), and `approval.double_decision_ignored` (warn; fields `approvalId`).
- **Typed error kinds**: `unknown_command_defaulted_to_approval`, `approval_expired`, `duplicate_decision_ignored`, `policy_classification_error`, `resume_record_not_found`.
- **Correlation IDs**: `approvalId`, `chatId`, `sessionId`, `userId`, `requestId`, and `workflowRunId` (for the resume re-entry).
- **Redaction rules**: redact secrets/tokens in logged command args and external-write payloads/headers; store the deny reason but never log credential material; log the policy name + classification, not raw secrets.
- **Grep-able debug recipes**: `grep 'approval.requested' | grep '"policy":"gitPushPolicy"'` to find history-rewriting parks; `grep 'approval.double_decision_ignored'` to confirm idempotency in the field; reconstruct a decision timeline by `approvalId`; compute approve/deny ratio per repo for fatigue tuning.
- **Evidence expectation**: the smoke captures a parked-card screenshot, an "Approved" and a "Denied — reason" screenshot, plus the `approval.requested`/`approved`/`denied` log lines and a ground-truth side-effect check (deny left no effect).

## Regression harness plan

- **New coverage**: (1) policy unit tests (port `POC/1b-approval-gate/src/classifier.ts` cases); (2) a four-path contract test with a marker-file side effect (port the POC `eval.ts` shape) asserting park/approve/deny/passthrough; (3) an idempotency test for the compare-and-delete resume; (4) a renderer test for the approval/denied states. **Fixtures/setup**: a marker-file-backed fake tool, a JSON/DB approval store, and the persisted parked-record fixtures. **Fail-before/pass-after**: before, the policy module and idempotency guard don't exist (tests red); after, all pass and the deny path leaves no marker. **Limits — what it will NOT catch**: whether Vercel's `"use workflow"` runtime durably suspends a real workflow across a serverless teardown and re-wakes on the resume POST (POC 2b territory), approval-fatigue tuning (a product/telemetry problem, not unit-testable), and novel dangerous commands the classifier doesn't know (mitigated only by the unknown→approve default).

## TDD audit trail

- **Red commit**: add the policy tests + four-path contract test + idempotency test. Command: `bun test packages/agent/tools/approval-policy.test.ts apps/web/app/workflows/chat.approval.test.ts`. Expected failing output: `cannot find module ".../approval-policy"` and side-effect/idempotency assertions failing (`expected marker absent … received present` for the deny path before the gate is wired; `expected 1 execution … received 2` before compare-and-delete). Commit the red tests.
- **Green commit**: add `approval-policy.ts`, wire `needsApproval`, add compare-and-delete; rerun the same command; expected `pass`. Commit green.
- **Exception**: none expected; red/green separable.

## Regression risks and concerns

- **Durability is an unproven hard dependency on POC 2b** (PRODUCT-BRIEF case AGAINST #1): a long-parked approval risks a stuck/lost session if the durable-workflow layer isn't ready; scope v1 to within-lifetime parks + DB rehydration.
- **A bad classifier breeds false confidence** (case AGAINST #2): the policy is only as safe as its patterns; keep "unknown → approve" and treat the policy as a reviewed, tested artifact.
- **Approval fatigue can nullify the gate** (case AGAINST #3): too-frequent prompts push users to reflexive Approve / YOLO; tune what parks via presets + approve/deny telemetry.
- **Race / double-decision + expiry** (case AGAINST #4, README): two resume POSTs must be idempotent (compare-and-delete); parked actions need TTL + notification.
- **Behavior-preservation risk**: lifting `commandNeedsApproval` out of `bash.ts` must not change existing bash gating; the recently-added `fetch` approval must keep working.

## Deploy or migration impact

- **Migrations**: a parked-approval record needs a durable home with a unique `approvalId` and a consumed/decided flag to support compare-and-delete + TTL (extend the existing tool-part persistence or add a focused table); generate via `bun run --cwd apps/web db:generate` and commit the `.sql`.
- **Env/flags**: a feature flag to enable the generalized policy per repo; a TTL config value; notification wiring.
- **Workflow/auth impact**: the resume path re-enters `runAgentWorkflow`; ensure the resume POST is authorized to the owning user/session. Full cross-restart durability is gated on POC 2b.
- **Rollout/rollback**: ship behind the flag with `bashPolicy` behavior identical to today; rollback by reverting to the inline `bash.ts` gating (the module is additive). **Cost**: negligible compute; one extra persisted record per parked action.

## Definition of done

- [ ] Red test observed first (policy + four-path + idempotency failing).
- [ ] Behavior proof red before implementation captured (deny leaves no marker only after the gate exists; before, the gate doesn't park).
- [ ] Red-test commit (or documented exception) recorded.
- [ ] Green commit after red.
- [ ] Targeted tests pass (`approval-policy` + contract + idempotency + renderer).
- [ ] Adjacent suite passes (bash tool, chat workflow, persist-tool-results, tool-state renderer).
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (policy + marker-file four-path + idempotency + renderer).
- [ ] Docs updated (policy module, autonomy presets, unknown→approve default; lessons-learned).
- [ ] Observability evidence captured (parked/approved/denied screenshots + `approval.*` log lines + side-effect check).
- [ ] Deploy notes included (migration, flag, TTL, 2b dependency, rollback).
