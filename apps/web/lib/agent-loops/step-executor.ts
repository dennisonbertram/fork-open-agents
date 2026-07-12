/**
 * Agent Loops — step executor
 *
 * executeAgentLoopStep({ stepRunId, workflowRunId }): Promise<StepExecutionResult>
 *
 * Flow:
 *   1. Load step run + loop run + loop via getAgentLoopStepRunWithContext
 *   2. Parse definitionSnapshot with the zod loopDefinitionSchema
 *      (parse failure → typed loop_invalid step failure)
 *   3. Find the node by stepRun.nodeId (missing → typed loop_invalid failure)
 *   4. Mark step running + emit agent-loop.step.started event
 *   5. Dispatch by node kind:
 *      - github_check: verify repo access + mint token, execute typed check fn,
 *        normalize output, merge into run context
 *      - condition: evaluateCondition against run context (pure, no I/O)
 *      - end: finalize run (completed + finishedAt + terminal event)
 *      - start: trivially succeed
 *      - agent_step: typed not_implemented failure (M1-05)
 *   6. Update step run status/timestamps/durationMs
 *   7. Emit agent-loop.step.completed (success) or .step.failed (failure)
 *
 * Out of scope: edge evaluation, next-step dispatch (M1-06).
 */

import "server-only";

import {
  mintInstallationToken,
  revokeInstallationToken,
} from "@/lib/github/app";
import { verifyRepoAccess } from "@/lib/github/access";
import { loopDefinitionSchema } from "./types";
import { evaluateCondition } from "./condition";
import { mergeStepOutput, lookupContextPath } from "./context";
import {
  checkListIssues,
  checkPrStatus,
  checkDeploymentStatus,
  checkCiStatus,
} from "./github-checks";
import {
  getAgentLoopStepRunWithContext,
  updateAgentLoopStepRun,
  recordAgentLoopEvent,
  conditionallyTransitionRunStatus,
  updateAgentLoopRunContext,
} from "./store";
import { executeAgentStep } from "./agent-step";
import { AgentLoopSourceDeletedError } from "./source-deleted-error";
import {
  buildAgentLoopNormalizedStepInput,
  projectAgentLoopLiveSource,
} from "./normalized-step-input";
import {
  resolveAgentLoopExecutionDefinition,
  type AgentLoopExecutionPolicy,
} from "./execution-snapshot";
import { NormalizedUnattendedInputError } from "@/lib/unattended-runtime/normalized-step-input";
import type { AgentLoop } from "@/lib/db/schema";

// ── Public types ───────────────────────────────────────────────────────────────

export type StepOutcome = "success" | "failure" | "true" | "false";

export type StepExecutionResult = {
  outcome: StepOutcome;
  errorKind?: string;
  errorMessage?: string;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function nowMs(): number {
  return Date.now();
}

/**
 * Builds a failure result and updates the step run + emits the step.failed event.
 * All failure paths must call this — never return failure without recording.
 */
async function recordStepFailure(params: {
  loopRunId: string;
  stepRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt: number;
  workflowRunId: string;
  startedAt: number;
  errorKind: string;
  errorMessage: string;
}): Promise<StepExecutionResult> {
  const finishedAt = new Date();
  const durationMs = nowMs() - params.startedAt;

  await updateAgentLoopStepRun({
    stepRunId: params.stepRunId,
    status: "failed",
    errorKind: params.errorKind,
    errorMessage: params.errorMessage,
    finishedAt,
    durationMs,
  });

  await recordAgentLoopEvent({
    loopRunId: params.loopRunId,
    stepRunId: params.stepRunId,
    nodeId: params.nodeId,
    eventName: "agent-loop.step.failed",
    status: "failed",
    level: "error",
    summary: params.errorMessage,
    payload: {
      errorKind: params.errorKind,
      errorMessage: params.errorMessage,
      nodeKind: params.nodeKind,
      attempt: params.attempt,
    },
    workflowRunId: params.workflowRunId,
  });

  return {
    outcome: "failure",
    errorKind: params.errorKind,
    errorMessage: params.errorMessage,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Executes a single agent loop step run.
 * Implements the github_check, condition, end, start, and agent_step (stub) arms.
 * Does NOT evaluate edges or dispatch the next step (that is M1-06 chain.ts).
 */
export async function executeAgentLoopStep(params: {
  stepRunId: string;
  workflowRunId: string;
  /**
   * Resolved (default-applied, ceiling-clamped) agent invocation timeout in
   * ms for agent_step nodes — see resolveGuardrails in chain.ts. Forwarded
   * to executeAgentStep; ignored by other node kinds.
   */
  stepTimeoutMs?: number;
  /**
   * Resolved (default-applied, ceiling-clamped) internal openAgent.generate
   * turn budget for agent_step nodes — see resolveGuardrails in chain.ts.
   * Forwarded to executeAgentStep; ignored by other node kinds.
   */
  maxAgentTurnsPerStep?: number;
}): Promise<StepExecutionResult> {
  const { stepRunId, workflowRunId, stepTimeoutMs, maxAgentTurnsPerStep } =
    params;
  const startedAt = nowMs();

  // ── 1. Load step run + loop run + loop ─────────────────────────────────────

  let ctx: Awaited<ReturnType<typeof getAgentLoopStepRunWithContext>>;
  try {
    ctx = await getAgentLoopStepRunWithContext(stepRunId);
  } catch (error) {
    if (error instanceof AgentLoopSourceDeletedError) {
      return {
        outcome: "failure",
        errorKind: "source_deleted",
        errorMessage: error.message,
      };
    }
    throw error;
  }
  if (!ctx) {
    // We cannot record an event without a loopRunId — just return a failure
    // result. The chain / dispatcher handles the missing-row case.
    return {
      outcome: "failure",
      errorKind: "loop_invalid",
      errorMessage: `Step run not found: ${stepRunId}`,
    };
  }

  const { stepRun, loopRun, loop } = ctx;
  const loopRunId = loopRun.id;

  // Durable workflow delivery is at-least-once. A terminal step already owns
  // its evidence and side effects, so a duplicate delivery is a strict no-op.
  if (["succeeded", "failed", "skipped"].includes(stepRun.status)) {
    return {
      outcome: stepRun.status === "succeeded" ? "success" : "failure",
      ...(stepRun.errorKind ? { errorKind: stepRun.errorKind } : {}),
      ...(stepRun.errorMessage ? { errorMessage: stepRun.errorMessage } : {}),
    };
  }

  // ── 2. Parse definitionSnapshot ────────────────────────────────────────────

  const snapshotParse = loopDefinitionSchema.safeParse(
    loopRun.definitionSnapshot,
  );
  if (!snapshotParse.success) {
    await updateAgentLoopStepRun({
      stepRunId,
      status: "failed",
      errorKind: "loop_invalid",
      errorMessage: `Definition snapshot failed validation: ${snapshotParse.error.message}`,
      finishedAt: new Date(),
      durationMs: nowMs() - startedAt,
    });
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: stepRun.nodeId,
      eventName: "agent-loop.step.failed",
      status: "failed",
      level: "error",
      summary: "Definition snapshot failed validation",
      payload: {
        errorKind: "loop_invalid",
        errorMessage: snapshotParse.error.message,
        nodeKind: stepRun.nodeKind,
        attempt: stepRun.attempt,
      },
      workflowRunId,
    });
    return {
      outcome: "failure",
      errorKind: "loop_invalid",
      errorMessage: snapshotParse.error.message,
    };
  }

  const definition = snapshotParse.data;

  // ── 3. Find node in snapshot ────────────────────────────────────────────────

  const node = definition.nodes.find((n) => n.id === stepRun.nodeId);
  if (!node) {
    await updateAgentLoopStepRun({
      stepRunId,
      status: "failed",
      errorKind: "loop_invalid",
      errorMessage: `Node '${stepRun.nodeId}' not found in definition snapshot`,
      finishedAt: new Date(),
      durationMs: nowMs() - startedAt,
    });
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: stepRun.nodeId,
      eventName: "agent-loop.step.failed",
      status: "failed",
      level: "error",
      summary: `Node '${stepRun.nodeId}' not found in definition snapshot`,
      payload: {
        errorKind: "loop_invalid",
        nodeId: stepRun.nodeId,
        nodeKind: stepRun.nodeKind,
        attempt: stepRun.attempt,
      },
      workflowRunId,
    });
    return {
      outcome: "failure",
      errorKind: "loop_invalid",
      errorMessage: `Node '${stepRun.nodeId}' not found in definition snapshot`,
    };
  }

  // ── 4. Mark step running + emit step.started ────────────────────────────────

  const startedDate = new Date();
  if (stepRun.status === "queued") {
    const claimed = await updateAgentLoopStepRun({
      stepRunId,
      status: "running",
      workflowRunId,
      startedAt: startedDate,
      expectedStatuses: ["queued"],
    });
    if (!claimed) {
      return { outcome: "failure", errorKind: "step_ownership_lost" };
    }
  } else if (
    stepRun.status === "running" &&
    stepRun.workflowRunId !== workflowRunId
  ) {
    return { outcome: "failure", errorKind: "step_ownership_lost" };
  }

  await recordAgentLoopEvent({
    loopRunId,
    stepRunId,
    nodeId: node.id,
    eventName: "agent-loop.step.started",
    status: "started",
    level: "info",
    summary: `Step started: ${node.kind} (${node.id})`,
    payload: {
      loopRunId,
      stepRunId,
      nodeId: node.id,
      nodeKind: node.kind,
      attempt: stepRun.attempt,
      workflowRunId,
    },
    workflowRunId,
  });

  // Shared failure context for all paths
  const failureCtx = {
    loopRunId,
    stepRunId,
    nodeId: node.id,
    nodeKind: node.kind,
    attempt: stepRun.attempt,
    workflowRunId,
    startedAt,
  };

  // ── 5. Dispatch by node kind ────────────────────────────────────────────────

  // ── agent_step: delegate to colocated executor (M1-05) ───────────────────

  if (node.kind === "agent_step") {
    // executeAgentStep handles all sandbox lifecycle, output contract,
    // checkCommand, commit/push, disposal, and events internally.
    // On failure it records the step update + event and returns a typed result.
    // On success it records the step update + context merge + completion event.
    const resolvedDefinition =
      ctx.resolvedDefinition ??
      resolveAgentLoopExecutionDefinition(
        loopRun,
        loop as unknown as AgentLoop,
      );
    const liveSource =
      ctx.liveSource ??
      projectAgentLoopLiveSource(loop as unknown as AgentLoop, stepRun.nodeId);

    // The live default branch is the only repository fact unavailable in the
    // frozen Run. Resolve it before normalization, but do not mint a token or
    // allocate a sandbox until strict V1 validation succeeds.
    const repository = resolvedDefinition.definition.repository;
    const checkoutAccess = await verifyRepoAccess({
      userId: loopRun.userId,
      owner: repository.owner,
      repo: repository.name,
      requiredUserPermission: "write",
    });
    if (!checkoutAccess.ok) {
      return recordStepFailure({
        ...failureCtx,
        errorKind:
          checkoutAccess.reason === "no_installation"
            ? "installation_missing"
            : "permission_missing",
        errorMessage: `Repo access denied: ${checkoutAccess.reason}`,
      });
    }

    let normalizedInput: ReturnType<typeof buildAgentLoopNormalizedStepInput>;
    try {
      normalizedInput = buildAgentLoopNormalizedStepInput({
        resolvedDefinition,
        loopRun,
        stepRun,
        workflowRunId,
        defaultBranch: checkoutAccess.defaultBranch,
      });
    } catch (error) {
      const normalizedError =
        error instanceof NormalizedUnattendedInputError ? error : null;
      const errorKind =
        normalizedError?.errorKind ?? "normalized_input_invalid";
      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId: stepRun.nodeId,
        eventName: "agent-loop.step.normalized-input.rejected",
        status: "failed",
        level: "error",
        summary: "Normalized loop step input was rejected.",
        payload: {
          runId: loopRunId,
          stepRunId,
          nodeId: stepRun.nodeId,
          errorKind,
          safeFieldPaths:
            normalizedError?.issues.map((issue) =>
              issue.path.map(String).join("."),
            ) ?? [],
          workflowRunId,
        },
        requestId: loopRun.requestId,
        workflowRunId,
      });
      return recordStepFailure({
        ...failureCtx,
        errorKind,
        errorMessage: "Normalized loop step input was rejected.",
      });
    }

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: normalizedInput.identity.nodeId,
      eventName: "agent-loop.step.normalized-input.accepted",
      status: "succeeded",
      level: "info",
      summary: "Accepted normalized loop step input.",
      payload: {
        runId: normalizedInput.identity.runId,
        stepRunId: normalizedInput.identity.stepRunId,
        nodeId: normalizedInput.identity.nodeId,
        attempt: normalizedInput.identity.attempt,
        inputVersion: normalizedInput.version,
        definitionVersion: normalizedInput.provenance.definitionVersion,
        definitionHash: normalizedInput.provenance.definitionHash,
        snapshotSource: normalizedInput.provenance.snapshotSource,
        workflowRunId: normalizedInput.identity.workflowRunId,
        workspacePolicy: normalizedInput.workspace.policy,
      },
      requestId: normalizedInput.identity.requestId,
      workflowRunId,
    });

    return executeAgentStep({
      stepRunId,
      workflowRunId,
      loopRunId,
      node,
      loopRun,
      loop: loop as AgentLoopExecutionPolicy,
      startedAt,
      normalizedInput,
      liveSource,
      stepTimeoutMs,
      maxAgentTurnsPerStep,
    });
  }

  // ── start: trivially succeeds ─────────────────────────────────────────────

  if (node.kind === "start") {
    const finishedAt = new Date();
    await updateAgentLoopStepRun({
      stepRunId,
      status: "succeeded",
      finishedAt,
      durationMs: nowMs() - startedAt,
    });
    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: node.id,
      eventName: "agent-loop.step.completed",
      status: "succeeded",
      level: "info",
      summary: "Start node completed",
      payload: { nodeKind: "start", attempt: stepRun.attempt },
      workflowRunId,
    });
    return { outcome: "success" };
  }

  // ── end: finalize the run ─────────────────────────────────────────────────

  if (node.kind === "end") {
    const finishedAt = new Date();

    const completed = await conditionallyTransitionRunStatus({
      runId: loopRunId,
      toStatus: "completed",
      fromStatuses: ["queued", "running"],
    });
    if (!completed) return { outcome: "success" };

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: node.id,
      eventName: "agent-loop.run.completed",
      status: "succeeded",
      level: "info",
      summary: "Loop run completed",
      payload: { loopRunId, workflowRunId },
      workflowRunId,
    });

    await updateAgentLoopStepRun({
      stepRunId,
      status: "succeeded",
      finishedAt,
      durationMs: nowMs() - startedAt,
    });

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: node.id,
      eventName: "agent-loop.step.completed",
      status: "succeeded",
      level: "info",
      summary: "End node completed",
      payload: { nodeKind: "end", attempt: stepRun.attempt },
      workflowRunId,
    });

    return { outcome: "success" };
  }

  // ── condition: pure evaluation ────────────────────────────────────────────

  if (node.kind === "condition") {
    if (!node.condition) {
      return recordStepFailure({
        ...failureCtx,
        errorKind: "loop_invalid",
        errorMessage: `Condition node '${node.id}' has no condition configured`,
      });
    }

    const evalResult = evaluateCondition(node.condition, loopRun.context ?? {});

    if (!evalResult.ok) {
      return recordStepFailure({
        ...failureCtx,
        errorKind: evalResult.errorKind,
        errorMessage: `Condition evaluation failed: ${evalResult.errorKind}`,
      });
    }

    const outcome: StepOutcome = evalResult.result ? "true" : "false";

    const finishedAt = new Date();
    await updateAgentLoopStepRun({
      stepRunId,
      status: "succeeded",
      finishedAt,
      durationMs: nowMs() - startedAt,
    });

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: node.id,
      eventName: "agent-loop.step.completed",
      status: "succeeded",
      level: "info",
      summary: `Condition evaluated: ${outcome}`,
      payload: { nodeKind: "condition", outcome, attempt: stepRun.attempt },
      workflowRunId,
    });

    return { outcome };
  }

  // ── github_check ──────────────────────────────────────────────────────────

  if (node.kind === "github_check") {
    // 5a. Check config validation — guard fires BEFORE any access/token work
    if (!node.check) {
      return recordStepFailure({
        ...failureCtx,
        errorKind: "loop_invalid",
        errorMessage: `github_check node '${node.id}' has no check configured`,
      });
    }

    // 5b. Resolve *From context paths BEFORE any API call or token mint
    let resolvedRef: string | undefined;
    let resolvedPrNumber: number | undefined;

    if (node.check.kind === "pr_status") {
      const lookup = lookupContextPath(
        loopRun.context ?? {},
        node.check.prNumberFrom,
      );
      if (!lookup.found) {
        return recordStepFailure({
          ...failureCtx,
          errorKind: "condition_path_missing",
          errorMessage: `Context path '${node.check.prNumberFrom}' not found for prNumberFrom`,
        });
      }
      const rawPr = lookup.value;
      if (typeof rawPr !== "number" || !Number.isInteger(rawPr) || rawPr <= 0) {
        return recordStepFailure({
          ...failureCtx,
          errorKind: "condition_type_mismatch",
          errorMessage: `prNumberFrom '${node.check.prNumberFrom}' must resolve to a positive integer, got: ${typeof rawPr === "number" ? rawPr : typeof rawPr}`,
        });
      }
      resolvedPrNumber = rawPr;
    }

    if (node.check.kind === "ci_status") {
      const lookup = lookupContextPath(
        loopRun.context ?? {},
        node.check.refFrom,
      );
      if (!lookup.found) {
        return recordStepFailure({
          ...failureCtx,
          errorKind: "condition_path_missing",
          errorMessage: `Context path '${node.check.refFrom}' not found for refFrom`,
        });
      }
      const rawRef = lookup.value;
      if (typeof rawRef !== "string" || rawRef.length === 0) {
        return recordStepFailure({
          ...failureCtx,
          errorKind: "condition_type_mismatch",
          errorMessage: `refFrom '${node.check.refFrom}' must resolve to a non-empty string, got: ${typeof rawRef}`,
        });
      }
      resolvedRef = rawRef;
    }

    // 5c. Verify repo access + resolve installationId / repositoryId
    const accessResult = await verifyRepoAccess({
      userId: loopRun.userId,
      owner: loop.repoOwner,
      repo: loop.repoName,
      requiredUserPermission: "read",
    });

    if (!accessResult.ok) {
      const errorKind =
        accessResult.reason === "no_installation"
          ? "installation_missing"
          : "permission_missing";
      return recordStepFailure({
        ...failureCtx,
        errorKind,
        errorMessage: `Repo access denied: ${accessResult.reason}`,
      });
    }

    // 5d. Mint installation token scoped to this repo
    let token: string;
    try {
      const scopedToken = await mintInstallationToken({
        installationId: accessResult.installationId,
        repositoryIds: [accessResult.repositoryId],
        permissions: {
          issues: "read",
          checks: "read",
          deployments: "read",
          pull_requests: "read",
          contents: "read",
        },
      });
      token = scopedToken.token;
    } catch (err) {
      return recordStepFailure({
        ...failureCtx,
        errorKind: "github_check_failed",
        errorMessage: `Failed to mint installation token: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 5e. Execute the typed check function
    let checkOutput: Record<string, unknown>;
    try {
      switch (node.check.kind) {
        case "list_issues": {
          checkOutput = (await checkListIssues({
            owner: loop.repoOwner,
            repo: loop.repoName,
            token,
            labels: node.check.labels,
            state: node.check.state,
          })) as unknown as Record<string, unknown>;
          break;
        }
        case "pr_status": {
          checkOutput = (await checkPrStatus({
            owner: loop.repoOwner,
            repo: loop.repoName,
            token,
            prNumber: resolvedPrNumber!,
          })) as unknown as Record<string, unknown>;
          break;
        }
        case "deployment_status": {
          checkOutput = (await checkDeploymentStatus({
            owner: loop.repoOwner,
            repo: loop.repoName,
            token,
            environment: node.check.environment,
          })) as unknown as Record<string, unknown>;
          break;
        }
        case "ci_status": {
          checkOutput = (await checkCiStatus({
            owner: loop.repoOwner,
            repo: loop.repoName,
            token,
            ref: resolvedRef!,
          })) as unknown as Record<string, unknown>;
          break;
        }
        default: {
          // TypeScript exhaustiveness guard
          const _exhaustive: never = node.check;
          throw new Error("Unknown check kind");
        }
      }
    } catch (err) {
      await revokeInstallationToken(token).catch(() => undefined);
      return recordStepFailure({
        ...failureCtx,
        errorKind: "github_check_failed",
        errorMessage: `GitHub check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Revoke token after use (best-effort — don't fail the step if revoke fails)
    await revokeInstallationToken(token).catch(() => undefined);

    // 5f. Merge output into run context
    // Use updateAgentLoopRunContext (not updateAgentLoopRunStatus) so that the
    // run's startedAt is never disturbed by the repeated context-merge writes
    // that happen after each successful github_check.
    const mergeResult = mergeStepOutput(
      loopRun.context ?? {},
      node.id,
      checkOutput,
    );

    await updateAgentLoopRunContext({
      runId: loopRunId,
      context: mergeResult.context,
    });

    // 5g. Persist step output + mark succeeded
    const finishedAt = new Date();
    await updateAgentLoopStepRun({
      stepRunId,
      status: "succeeded",
      stepOutput: checkOutput,
      finishedAt,
      durationMs: nowMs() - startedAt,
    });

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: node.id,
      eventName: "agent-loop.step.completed",
      status: "succeeded",
      level: "info",
      summary: `github_check completed: ${node.check.kind}`,
      payload: {
        nodeKind: "github_check",
        checkKind: node.check.kind,
        attempt: stepRun.attempt,
        truncated: mergeResult.truncated,
      },
      workflowRunId,
    });

    return { outcome: "success" };
  }

  // Should never reach here — TypeScript discriminated union exhaustion guard
  return recordStepFailure({
    ...failureCtx,
    errorKind: "loop_invalid",
    errorMessage: `Unknown node kind: ${(node as { kind: string }).kind}`,
  });
}
