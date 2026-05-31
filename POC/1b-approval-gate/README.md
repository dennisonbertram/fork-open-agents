# POC 1b — Structured per-tool approval gate

A reusable "this action needs sign-off" wrapper that PARKS an agent tool call
behind a human approval, then resumes (execute) on approve or returns a denied
result on deny. It generalizes beyond bash to any outward-facing / destructive
action: destructive bash, `git push`/`git reset --hard`, external API writes,
outbound messages.

This is a **meaningful eval**, not a smoke test: both the approve and deny paths
are exercised against a real, observable side effect (a marker file), and the
emitted UI chunks for every path are captured to `evidence/`.

## Goal

Provide a generic approval gate that fits the repo's "confirm outward-facing
actions" discipline. When a tool call matches a policy, emit an
`approval-requested` UI part carrying a stable `approvalId` and suspend the
agent workflow until the client posts `{ approvalId, decision }`. On approve the
wrapped tool executes; on deny it returns an `output-denied` result and the side
effect never happens. Safe actions pass straight through.

## What was built

All code is self-contained in this folder (`zod` + `@types/bun` only; no root
lockfile or app source touched).

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Faithful local copies of the tool-part states and streamed chunk shapes the real codebase uses (`approval-requested`, `approval-responded`, `output-available`, `output-denied`, `output-error`, and the `approval: { id, approved, reason }` sub-object). |
| `src/classifier.ts` | Extensible **action classifier / policy**. `bashPolicy` is copied from `commandNeedsApproval()` in `packages/agent/tools/bash.ts`; `gitPushPolicy` and `externalWritePolicy` generalize it. `composePolicies()` layers them (first match wins). |
| `src/tool.ts` | Minimal `Tool` abstraction mirroring the side-effecting part of an AI SDK `tool({ execute })`. |
| `src/approval-gate.ts` | **`withApproval(tool, policy)`** — the reusable gate. `run()` either passes through (safe) or PARKS and emits a `tool-approval-request` chunk. `resume(parked, decision)` mirrors the client decision injection: approve -> `execute()` + `output-available`; deny -> `output-denied` (no execution). |
| `src/agent-loop.ts` | Simulated tool loop mirroring `apps/web/app/workflows/chat.ts`. Persists the parked record to a pluggable `ApprovalStore` (a `JsonFileStore` here) **before** suspending, then resumes from the store only. |
| `src/eval.ts` | The eval. Six labelled blocks, 22 assertions, observable marker-file side effect, evidence capture. |

### How the gate maps onto the real states

`withApproval` produces exactly the shapes `packages/shared/lib/tool-state.ts`
already understands. At park time the persisted part is:

```jsonc
{ "type": "tool-bash", "state": "approval-requested",
  "approval": { "id": "appr_call_001_1", "reason": "..." } }
```

`extractRenderState()` reads `state === "approval-requested"` ->
`approvalRequested: true`, and `approval.id === activeApprovalId` ->
`isActiveApproval`. On deny the part becomes `state: "output-denied"` with
`approval.approved === false`, which `extractRenderState()` maps to
`denied: true` + `denialReason`. No changes to `tool-state.ts` are required.

## How it was tested + evidence

Run:

```bash
cd POC/1b-approval-gate
bun install
bun run typecheck   # tsc --noEmit, clean
bun run eval        # 22 assertions, all pass
```

Real eval output (all four required paths plus generalization + durability):

```
[A+B] Destructive action parks, then is APPROVED
  PASS: destructive action PARKED (did not execute)
  PASS: emitted a tool-approval-request chunk
  PASS: approval-request carries a stable approvalId (appr_call_001_1)
  PASS: tool part state is approval-requested
  PASS: side effect has NOT happened yet (marker absent at park time)
  PASS: APPROVE streams a tool-output-available chunk
  PASS: resumed tool part state is output-available
  PASS: side effect HAPPENED after approve (marker present)
[C] Destructive action parks, then is DENIED
  PASS: destructive action PARKED
  PASS: DENY streams a tool-output-denied chunk
  PASS: denied tool part state is output-denied
  PASS: side effect NEVER happened after deny (marker absent)
[D] Safe action passes through (no approval)
  PASS: safe action COMPLETED without parking
  PASS: no tool-approval-request chunk emitted for safe action
  PASS: safe action streams tool-output-available directly
  PASS: safe action executed its side effect immediately
[E] Policy generalizes beyond bash (git push, external write)
  PASS: git force-push PARKED for approval
  PASS: external POST PARKED for approval
  PASS: external GET (read-only) passed through
[F] Durability: parked approval survives a fresh process/store
  PASS: parked record is durably persisted (survives restart)
  PASS: resumed-from-disk approval executed
  PASS: side effect ran after resume-from-disk

Assertions: 22, Failures: 0
```

### Captured evidence (`evidence/`)

- `path-A-park-chunks.json` — the `tool-approval-request` chunk (stable `approvalId`, the destructive `rm -rf ./build` input). Side-effect marker is ABSENT at this point.
- `path-B-approve-chunks.json` — `tool-output-available` after approve.
- `path-C-deny-chunks.json` — `tool-output-denied` after deny (carries the operator's reason).
- `path-D-safe-chunks.json` — `tool-output-available` directly, no approval chunk.
- `persisted-parked-record-git.json`, `persisted-parked-record-http.json` — the durable on-disk parked records for a `git push --force` and an external `POST`, proving the parked state is JSON-serializable and survives a process boundary.
- `side-effect-*.marker` — ground-truth markers proving execution happened (approve, safe, durable) and did NOT happen (no `deny` marker exists).
- `summary.json` — machine-readable run summary.

The marker file is the key: "did it actually execute?" is observed, not
asserted. The deny path leaves **no** marker; the approve/safe/durable paths
each leave one.

## Integration plan into the real codebase

The repo already ships the v6-style primitive: `bashTool` sets
`needsApproval` and the web client renders the resulting `approval-requested`
state. This POC's contribution is generalizing that single-tool mechanism into a
**reusable, policy-driven wrapper** for any tool. Concretely:

1. **Classifier → policy module.** Land `src/classifier.ts` as
   `packages/agent/tools/approval-policy.ts`. `bashPolicy` replaces the inline
   regex block currently inside `packages/agent/tools/bash.ts`
   (`commandNeedsApproval`); `gitPushPolicy` / `externalWritePolicy` cover the
   new outward-facing tools. Keep it composable so callers can append policies,
   mirroring today's `ToolOptions.needsApproval` override hook.

2. **`withApproval` → AI SDK `needsApproval`.** In production you do **not** need
   the custom `run`/`resume` machinery — AI SDK v6 already implements parking
   via `tool({ needsApproval })`. The integration is to set
   `needsApproval: (input) => classify(toolName, input).requires` on each
   outward-facing tool in `packages/agent/tools/` (registered in `index.ts`),
   exactly as `bash.ts` does today. `withApproval` here is the framework-agnostic
   reference for that behavior and is what proves the four-path contract.

3. **Park boundary already exists.** `apps/web/app/workflows/chat.ts` already
   stops the step loop when a part is `approval-requested`
   (`shouldPauseForToolInteraction`, lines ~103–108 and the
   `shouldContinue`/`break` logic in the loop). No new pause logic is needed —
   new gated tools inherit it for free.

4. **Persistence already exists.** The parked assistant message + tool parts are
   persisted at the pause boundary (`persistAssistantMessage` /
   `persistAssistantMessageWithToolResults` in `chat-post-finish.ts`), and the
   resume POST persists the client's `approval-responded` part via
   `apps/web/app/api/chat/_lib/persist-tool-results.ts` (it already special-cases
   `state === "approval-responded"`). The `ApprovalStore` in this POC is the
   stand-in for that DB-backed persistence.

5. **Decision injection.** The client already calls
   `addToolApprovalResponse({ id, approved, reason })` (AI SDK v6 `useChat`),
   which produces the `tool-approval-response` model-message part. The new POST
   re-enters `runAgentWorkflow`, the SDK matches the response to the parked
   `approvalId`, and either runs `execute` (approve) or yields `output-denied`
   (deny) — exactly the `resume()` semantics validated here.

6. **Client UI.** The existing renderer keyed on `tool-state.ts`
   (`approvalRequested` / `isActiveApproval` / `denied`) already handles
   `approval-requested` and `output-denied`. New gated tools render through the
   same component with no UI change beyond per-tool copy.

## Feasibility verdict

**Feasible and low-risk.** The four-path contract (park / approve / deny /
passthrough) holds with real state assertions and an observable side effect, and
it maps onto primitives the repo already has: AI SDK v6 `needsApproval`, the
`tool-state.ts` states, the `chat.ts` pause boundary, and the existing
approval-response persistence path. The net new work is a composable policy
module plus setting `needsApproval` on the additional outward-facing tools —
not new framework plumbing.

## Blind spots eliminated

- **"Does the side effect really not run while parked?"** Proven: no marker
  exists at park time, and the deny path never writes one.
- **"Is the approvalId stable across the park/resume boundary?"** Proven: the
  resume reads the id only from the persisted record and the decision must match
  (`resume()` throws on mismatch).
- **"Does this generalize past bash?"** Proven: `git push --force` and an
  external `POST` park; a read-only `GET` and `ls -la` pass through.
- **"Does the parked state survive a stateless/serverless restart?"** Proven for
  the persistence shape: path **F** resumes using only a freshly-constructed
  store handle that reads the JSON file written before the suspend — no
  in-memory carry-over. The parked record is fully JSON-serializable
  (`persisted-parked-record-*.json`).

## Remaining risks

- **Durability depends on POC 2b.** This POC proves the parked record is
  serializable and that resume works from persistence alone. It does **not**
  prove that Vercel's `"use workflow"` runtime durably suspends a real workflow
  across a serverless teardown and re-wakes it on the resume POST. In production
  the suspend/resume is driven by the workflow engine + the new HTTP POST, not by
  this loop. **The end-to-end park/resume durability across a stateless
  serverless restart is a hard dependency on POC 2b (durable workflow / job
  queue).** If the workflow cannot durably park, an approval left pending past
  the function lifetime would require the resume POST to reconstruct context from
  the DB — which the persistence path supports, but that full rehydration is
  unverified here.
- **AI SDK version coupling.** The repo is on `ai ^6` (`needsApproval`). AI SDK 7
  renames this to `toolApproval` (a call/agent-level setting). The policy module
  is unaffected, but the wiring point moves on upgrade.
- **Race / double-decision.** Two resume POSTs for the same `approvalId` must be
  idempotent. This POC consumes (deletes) the record on resume; production needs
  an equivalent compare-and-delete against the DB to avoid double execution.
- **Classifier coverage.** A policy is only as safe as its patterns. The bash
  regexes are inherited from the repo and known-incomplete (unknown commands
  default to needing approval in `bash.ts`; this POC's `bashPolicy` only flags
  known-destructive patterns — production should keep the conservative
  "unknown → approve" default).
- **Approval expiry/notification.** Not modeled: a parked action with no decision
  for a long time. Production should add TTL + operator notification.
```
