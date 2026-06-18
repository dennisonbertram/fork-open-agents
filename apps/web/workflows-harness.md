# Audit Scratchpad: Durable Workflows & Harness Run Control

## Files Read

- `apps/web/lib/workflows/run-start.ts` — Input validation and snapshot persistence
- `apps/web/lib/workflows/catalog.ts` — Workflow registry, buildRegistry, DEFAULT_CATALOG
- `apps/web/lib/workflows/inputs.ts` — parseWorkflowInputSchema, field validation
- `apps/web/lib/workflows/goal-validation.ts` — validateGoalCompletion
- `apps/web/lib/workflows/goal-ledger-recorder.ts` — recordGoalLedgerStart/Event/Close
- `apps/web/lib/harness/client.ts` — HarnessClient with requestJson, runAction, etc.
- `apps/web/lib/harness/config.ts` — getHarnessConfig, HarnessConfigError
- `apps/web/lib/harness/events.ts` — reduceHarnessEvent, parseSseBlock, extractSseBlocks
- `apps/web/lib/harness/run-mapping.ts` — startVerifiedBuildRun, persistVerifiedBuildEvent, updateVerifiedBuildRunFromHarnessStatus
- `apps/web/lib/harness/sandbox-bridge.ts` — createOpenAgentsSandboxBridge
- `apps/web/lib/harness/types.ts` — HarnessMode, HarnessRunResponse, etc.
- `apps/web/lib/harness/redaction.ts` — redactHarnessPayload
- `apps/web/lib/harness/logger.ts` — logHarnessEvent
- `apps/web/lib/harness/request-id.ts` — getRequestId
- `apps/web/lib/harness/client-error.ts` — HarnessClientError
- `apps/web/app/api/harness/_lib/run-access.ts` — requireHarnessRunAccess, requireOwnedHarnessSessionChat
- `apps/web/app/api/harness/_lib/proxy.ts` — proxyRunAction, proxyRunResource, proxyTraceExportPlan, proxyArtifact
- `apps/web/app/api/harness/_lib/responses.ts` — errorToHarnessResponse, harnessErrorResponse
- `apps/web/app/api/harness/runs/route.ts` — GET/POST for runs
- `apps/web/app/api/harness/runs/[runId]/route.ts` — GET run snapshot
- `apps/web/app/api/harness/runs/[runId]/approve/route.ts` — POST approve
- `apps/web/app/api/harness/runs/[runId]/cancel/route.ts` — POST cancel
- `apps/web/app/api/harness/runs/[runId]/audit/route.ts` — GET audit
- `apps/web/app/api/harness/runs/[runId]/trace/route.ts` — GET trace
- `apps/web/app/api/harness/runs/[runId]/trace/export-plan/route.ts` — GET trace export plan
- `apps/web/app/api/harness/runs/[runId]/events/route.ts` — GET SSE events
- `apps/web/app/api/harness/runs/[runId]/artifacts/route.ts` — GET artifacts
- `apps/web/app/api/harness/runs/[runId]/capsules/route.ts` — GET capsules
- `apps/web/app/api/harness/runs/[runId]/repair/route.ts` — POST repair
- `apps/web/app/api/harness/artifacts/[artifactId]/route.ts` — GET artifact
- `apps/web/app/api/harness/workcells/[workcellId]/route.ts` — GET workcell
- `apps/web/app/api/harness/ready/route.ts` — GET readiness
- `apps/web/app/api/workflows/catalog/route.ts` — GET catalog
- `apps/web/app/api/sessions/_lib/session-context.ts` — requireAuthenticatedUser, requireOwnedSessionChat
- `apps/web/app/workflows/background-agent.ts` — "use workflow" body
- `apps/web/app/workflows/agent-loop-step.ts` — "use workflow" body
- `apps/web/lib/background-agents/executor.ts` — executeBackgroundAgentRun (has "use step")
- `apps/web/lib/agent-loops/chain.ts` — runAgentLoopStep (has "use step"), advanceLoopRun
- `apps/web/app/workflows/sandbox-lifecycle.ts` — sandboxLifecycleWorkflow body
- `apps/web/app/workflows/chat.ts` — runAgentWorkflow body (excerpts around workflow body)
- `apps/web/app/workflows/chat-sandbox-runtime.ts` — resolveChatSandboxRuntime (has "use step")
- `apps/web/lib/db/schema.ts:810-889` — verifiedBuildRuns and verifiedBuildEvents tables

## Assumptions & Corrections

1. **"use step" directives**: The lesson says functions called from `"use workflow"` bodies that use Node modules must declare `"use step"`. I verified ALL functions called directly from the workflow bodies (`chat.ts`, `sandbox-lifecycle.ts`, `background-agent.ts`, `agent-loop-step.ts`) either have `"use step"` or are framework functions (from AI SDK, etc.). Functions called transitively (from within a `"use step"` function) do NOT need their own `"use step"`.

2. **Dynamic-only workflow imports**: `runAgentLoopStepWorkflow` IS statically imported in `run-controls.ts:27` and `dispatcher-bridge.ts:16`. `runBackgroundAgentWorkflow` IS statically imported in `dispatcher.ts:4`. The dynamic imports in `chain.ts:785` and `store.ts:1632` are additional cycle-breaking patterns, not the sole imports. The DevKit has static imports to register these workflows. NO bug.

3. **Trace export authz**: `proxyTraceExportPlan` calls `requireHarnessRunAccess` → `getVerifiedBuildRunByIdForUser` which filters by `userId`. Ownership IS checked. NO bug.

4. **Workcell authz**: The workcell route uses `requireAuthenticatedUser()` only. However, it passes `actorId: authResult.userId` to the harness client, and the harness backend gates access by tenant/project/actor context. This is not an IDOR in our code — the harness is authoritative. However, if the harness does NOT validate actorId for workcell access, this could leak data. Without harness-side knowledge, this is a coverage gap, not a confirmed finding.

5. **FK violations**: The `verifiedBuildEvents.verifiedBuildRunId` has a FK to `verifiedBuildRuns.id`. Mock-based tests that don't enforce FK shapes would miss runtime FK violations. But all actual code paths use real DB-queried run IDs (not hardcoded strings), so the bug pattern described in lessons-learned is NOT present in the current harness event/run code paths.

## Candidate Defects

### Accepted

**Finding 1: Cancel status update without rollback on harness failure**
- Location: `apps/web/app/api/harness/_lib/proxy.ts:81-86`
- The cancel path updates the local DB to `status: "cancellation_requested"` BEFORE calling the harness. If the harness call in line 88-93 throws (network error, timeout, 5xx), the catch block at line 110 returns an error response but the local DB was already mutated.
- Impact: The local DB shows "cancellation_requested" while the harness never processed the cancel. The SSE stream eventually corrects status, but there is an inconsistency window. If the harness is permanently unreachable, the status never corrects.
- The fix is to either move the local status update AFTER the successful harness call, or add a rollback in the catch block.

### Rejected

1. **Missing "use step"**: All called functions verified. Rejected.
2. **Dynamic-only workflow imports**: Static imports exist. Rejected.
3. **Trace export authz gap**: Ownership check present via requireHarnessRunAccess. Rejected.
4. **FK violation in event insert**: All IDs come from real DB queries, not hardcoded. Rejected.
5. **Workcell IDOR**: Harness backend handles authz via actorId header. Rejected (cannot confirm without harness source).
6. **Note about `claimLifecycleLease`**: Called from within `computeLifecycleWakeDecision` which has `"use step"`. Transitive calls within a step do not need their own `"use step"`. Rejected.

## Coverage Gaps

1. **Harness backend authorization**: The workcell route depends on the harness backend to enforce actorId-based access control. Without reviewing harness backend code, I cannot fully verify this.
2. **Idempotency semantics for approve/cancel/repair**: The harness backend may or may not enforce idempotency on these actions. The client does not send idempotency keys. Cannot evaluate without harness-side knowledge.
3. **SSE event ordering**: The `persistVerifiedBuildEvent` function updates `verifiedBuildRuns` without ordering checks on `harnessEventId`. If replay and live events interleave, stale events could overwrite newer run status. But SSE semantics from the harness likely guarantee ordering; cannot confirm without harness docs.
