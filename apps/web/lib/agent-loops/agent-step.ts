/**
 * Agent Loops — agent_step executor (M1-05)
 *
 * executeAgentStep(params): Promise<StepExecutionResult>
 *
 * Flow:
 *   1. Verify repo access (write) — installation_missing / permission_missing
 *   2. Mint installation token (contents:write, scoped to repo)
 *   3. Resolve working branch via resolveWorkingBranch (see below).
 *      Connect sandbox named agent_loop_<stepRunId>; clone repo with token.
 *      Sandbox connect failure → sandbox_unavailable.
 *   4. Record agent-loop.step.sandbox.started event.
 *   5. Build prompt via buildLoopStepPrompt.
 *   6. Run openAgent in a bounded loop:
 *        Loop until finishReason !== "tool-calls", up to maxAgentTurnsPerStep.
 *        Each iteration appends response messages so the next call sees
 *        tool results, then records an agent-loop.step.agent.turn.completed
 *        heartbeat event (turn number, finish reason, duration, tool call
 *        count, usage) — emitted on every turn, including the final one
 *        (#863). Exhausting the bound → typed turn_budget_exceeded failure.
 *        AbortError / timeout → typed workflow_failed failure.
 *   7. Record agent-loop.step.agent.completed event with usage summary.
 *   8. Read /tmp/loop-step-output.json from sandbox:
 *        - missing / ENOENT → step_output_invalid
 *        - unparseable JSON → step_output_invalid
 *        - exceeds 64KB cap → step_output_invalid
 *        - fails node.outputSchema (if present) → step_output_invalid
 *          Dual-shape validation (#766, see output-schema-shape.ts):
 *          flat map ({name: type}, from the builder's quick-add "Outputs"
 *          control) requires + type-checks every declared key; JSON-Schema-
 *          Lite ({type, required, properties}) keeps its existing semantics.
 *   9. If node.checkCommand configured: run with timeout.
 *        - non-zero exit → checks_failed; record agent-loop.step.check.completed
 *        - zero exit → record agent-loop.step.check.completed (success)
 *  10. If file changes present: stage all, build commit intent, createCommit
 *        via withScopedInstallationOctokit.
 *        - commit ok → record agent-loop.step.commit.completed
 *        - commit failed (ok:false OR throws) → typed commit_failed failure;
 *          record agent-loop.step.commit.failed (error level)
 *        Branch for commit: output JSON "branch" field, then working branch.
 *  11. Merge validated output into run context via mergeStepOutput +
 *        updateAgentLoopRunContext; persist stepOutput; mark succeeded.
 *  12. ALWAYS dispose sandbox in finally — including all failure paths.
 *
 * Working-branch resolution (resolveWorkingBranch):
 *   Priority order:
 *   (1) context[nodeId].branch  — re-run of same node keeps its own branch
 *   (2) scan context entries in INSERTION ORDER, take the LAST entry whose
 *       value is a plain object with a non-empty string "branch" field —
 *       this allows a downstream agent_step to continue on the branch
 *       declared by the most-recently-completed producing step
 *   (3) access.defaultBranch    — repo default branch (fallback)
 *
 * Branch-declaration convention (output JSON):
 *   The agent writes a "branch" field to /tmp/loop-step-output.json.
 *   The executor reads that field to know which branch to commit/push to.
 *   This overrides the working branch for the commit only.
 *
 * Redaction:
 *   The installation token is never included in any event payload or stepOutput.
 *   Raw agent transcripts are never persisted.
 *
 * Out of scope: edge evaluation, next-step dispatch (M1-06).
 */

import "server-only";

import { openAgent, sanitizeUnattendedToolCalls } from "@open-agents/agent";
import {
  connectSandbox,
  hasUncommittedChanges,
  stageAll,
} from "@open-agents/sandbox";
import {
  mintInstallationToken,
  revokeInstallationToken,
  withScopedInstallationOctokit,
} from "@/lib/github/app";
import { verifyRepoAccess } from "@/lib/github/access";
import { buildCommitIntentFromSandbox } from "@/lib/github/commit-intent";
import { buildCoAuthor, createCommit } from "@/lib/github/commit";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
  DEFAULT_SANDBOX_VCPUS,
} from "@/lib/sandbox/config";
import { mergeStepOutput } from "./context";
import { isFlatOutputSchema } from "./output-schema-shape";
import { resolveWorkingBranch } from "./resolve-working-branch";
import {
  effectiveStepPermissions,
  permissionsToInstallationToken,
} from "./token-permissions";
import {
  assertComposioRepoToolkitsStillAllowed,
  resolveComposioToolsForBgRun,
} from "@/lib/background-agents/composio-tools";
import {
  updateAgentLoopStepRun,
  recordAgentLoopEvent,
  updateAgentLoopRunContext,
  isAgentLoopRunSourceLive,
} from "./store";
import { buildLoopStepPrompt } from "./loop-step-prompt";
import type { ModelMessage } from "ai";
import type { AgentLoopRun } from "@/lib/db/schema";
import type { AgentLoopExecutionPolicy } from "./execution-snapshot";
import { GUARDRAIL_CEILINGS, GUARDRAIL_DEFAULTS } from "./types";
import type { AgentStepNode } from "./types";
import type { StepExecutionResult } from "./step-executor";
import type { Sandbox } from "@open-agents/sandbox";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Maximum size for step output JSON (64KB). */
const STEP_OUTPUT_MAX_BYTES = 64 * 1024;

/**
 * Default agent invocation timeout for step execution (10 minutes).
 * Used as a fallback only when the caller does not resolve a guardrail
 * (e.g. AgentStepParams.stepTimeoutMs is omitted). The real default/ceiling
 * source of truth is GUARDRAIL_DEFAULTS/GUARDRAIL_CEILINGS in types.ts,
 * resolved per-run by chain.ts's resolveGuardrails.
 */
const AGENT_STEP_TIMEOUT_MS = 10 * 60 * 1000;

/** Timeout for checkCommand execution (2 minutes). */
const CHECK_COMMAND_TIMEOUT_MS = 120_000;

/** Path inside the sandbox where the agent writes its output JSON. */
const STEP_OUTPUT_PATH = "/tmp/loop-step-output.json";

/**
 * Number of turns remaining at (and below) which the wrap-up nudge is
 * injected into the per-turn customInstructions (#891). A single named
 * constant satisfies "configurable" per the issue; a per-loop setting is
 * out of scope.
 */
const WRAP_UP_THRESHOLD_TURNS = 2;

/** Base per-step instructions, before the per-turn budget block is appended. */
const BASE_STEP_CUSTOM_INSTRUCTIONS =
  "You are running inside an unattended agent loop step. Work autonomously, keep changes scoped, and write your structured output JSON to /tmp/loop-step-output.json when done.";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentStepParams = {
  stepRunId: string;
  workflowRunId: string;
  loopRunId: string;
  node: AgentStepNode;
  loopRun: AgentLoopRun;
  loop: Pick<
    AgentLoopExecutionPolicy,
    "repoOwner" | "repoName" | "permissions"
  >;
  startedAt: number;
  /** Optional watchdog hint from the previous failed attempt (via stepInput.watchdogHint). */
  watchdogHint?: string;
  /**
   * Resolved (default-applied, ceiling-clamped) agent invocation timeout in
   * ms — see resolveGuardrails in chain.ts. Falls back to
   * AGENT_STEP_TIMEOUT_MS when omitted (e.g. direct unit-test calls).
   */
  stepTimeoutMs?: number;
  /**
   * Resolved (default-applied, ceiling-clamped) internal openAgent.generate
   * turn budget for this step — see resolveGuardrails in chain.ts. Falls
   * back to GUARDRAIL_DEFAULTS.maxAgentTurnsPerStep for direct unit-test
   * calls; Math.min against GUARDRAIL_CEILINGS is the hard server-side
   * backstop.
   */
  maxAgentTurnsPerStep?: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildSandboxName(stepRunId: string): string {
  return `agent_loop_${stepRunId}`;
}

function nowMs(): number {
  return Date.now();
}

function guardToolSet(
  tools: import("ai").ToolSet | undefined,
  guard: () => Promise<void>,
): import("ai").ToolSet | undefined {
  if (!tools) return undefined;
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => {
      const candidate = value as { execute?: (...args: unknown[]) => unknown };
      if (typeof candidate.execute !== "function") return [name, value];
      return [
        name,
        {
          ...candidate,
          execute: async (...args: unknown[]) => {
            await guard();
            return candidate.execute?.(...args);
          },
        },
      ];
    }),
  ) as import("ai").ToolSet;
}

/**
 * Build the per-turn customInstructions for the agent step loop (#891).
 *
 * Every turn is told the current turn number and the total budget so
 * open-ended instructions can converge instead of burning every turn
 * exploring. Once turnsRemaining drops to WRAP_UP_THRESHOLD_TURNS or below,
 * a wrap-up nudge instructs the agent to stop exploring and write its
 * output JSON now with findings so far.
 */
function buildBudgetAwareInstructions({
  turn,
  maxTurns,
}: {
  turn: number;
  maxTurns: number;
}): { instructions: string; wrapUp: boolean } {
  const turnsRemaining = maxTurns - turn;
  const wrapUp = turnsRemaining <= WRAP_UP_THRESHOLD_TURNS;

  let instructions = `${BASE_STEP_CUSTOM_INSTRUCTIONS}\n\n## Turn Budget\nTurn ${turn} of ${maxTurns}.`;

  if (wrapUp) {
    instructions += `\n\n## Wrap up now\nStop exploring. Write the step's required output JSON to ${STEP_OUTPUT_PATH} now with the findings you have so far.`;
  }

  return { instructions, wrapUp };
}

/**
 * Truncate a string to maxLen chars, appending "...[truncated]" if needed.
 */
function truncateOutput(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}...[truncated]`;
}

/**
 * Validates a flat-map outputSchema ({name: type}, as written by the
 * builder's "Outputs" quick-add control — see
 * components/agent-config-fields.tsx DeclaredOutputsField). Every declared
 * key is required and its value must match the declared type-name.
 * $-prefixed metadata keys (e.g. "$schema") are skipped, consistent with
 * isFlatOutputSchema and outputFieldNames, which both deliberately exclude
 * them when interpreting a flat map — otherwise a schema like
 * {"$schema": "...", "passed": "boolean"} would be classified as flat but
 * then always fail validation since the agent output never contains a
 * literal "$schema" field.
 * Returns null on success, or an error message on the first failure.
 */
function validateAgainstFlatSchema(
  output: Record<string, unknown>,
  schema: Record<string, unknown>,
): string | null {
  for (const [field, expectedType] of Object.entries(schema)) {
    if (field.startsWith("$")) {
      continue;
    }
    if (!(field in output)) {
      return `Missing required field: "${field}"`;
    }
    const actualValue = output[field];
    const actualType = Array.isArray(actualValue)
      ? "array"
      : typeof actualValue;
    if (actualType !== expectedType) {
      return `Field "${field}": expected type "${String(expectedType)}", got "${actualType}"`;
    }
  }
  return null;
}

/**
 * Minimal JSON-Schema-Lite validation for agent_step outputSchema.
 * Validates only the fields we care about: type, required, properties.
 * Returns null on success, or an error message on failure.
 *
 * Kept minimal per the spec — no deep nesting validation.
 */
function validateAgainstJsonSchemaLite(
  output: Record<string, unknown>,
  schema: Record<string, unknown>,
): string | null {
  // Only validate "required" fields for now
  const required = schema["required"];
  if (Array.isArray(required)) {
    for (const field of required) {
      if (typeof field === "string" && !(field in output)) {
        return `Missing required field: "${field}"`;
      }
    }
  }

  // Validate property types if properties is specified
  const properties = schema["properties"];
  if (
    properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  ) {
    const propsObj = properties as Record<string, unknown>;
    for (const [key, propSchema] of Object.entries(propsObj)) {
      if (!(key in output)) continue;
      const propSchemaObj = propSchema as Record<string, unknown>;
      const expectedType = propSchemaObj["type"];
      if (typeof expectedType === "string") {
        const actualValue = output[key];
        // eslint-disable-next-line valid-typeof
        const actualType = Array.isArray(actualValue)
          ? "array"
          : typeof actualValue;
        if (actualType !== expectedType) {
          return `Field "${key}": expected type "${expectedType}", got "${actualType}"`;
        }
      }
    }
  }

  return null;
}

/**
 * Validates step output against a node's outputSchema, dispatching to the
 * flat-map or JSON-Schema-Lite validator per isFlatOutputSchema's detection
 * rule (see output-schema-shape.ts). Returns null on success, or an error
 * message on failure.
 */
function validateStepOutput(
  output: Record<string, unknown>,
  schema: Record<string, unknown>,
): string | null {
  return isFlatOutputSchema(schema)
    ? validateAgainstFlatSchema(output, schema)
    : validateAgainstJsonSchemaLite(output, schema);
}

/**
 * Builds a failure result and records updates to DB + events.
 * Mirrors the pattern in step-executor.ts.
 */
async function recordAgentStepFailure(params: {
  loopRunId: string;
  stepRunId: string;
  nodeId: string;
  nodeKind: string;
  attempt: number;
  workflowRunId: string;
  startedAt: number;
  errorKind: string;
  errorMessage: string;
  payloadExtras?: Record<string, unknown>;
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
      ...params.payloadExtras,
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
 * Executes an agent_step node: connects a fresh sandbox, runs openAgent,
 * reads the structured output JSON, optionally runs checkCommand, commits
 * produced changes, and disposes the sandbox (always, in finally).
 *
 * Returns a StepExecutionResult — never throws.
 */
export async function executeAgentStep(
  params: AgentStepParams,
): Promise<StepExecutionResult> {
  const {
    stepRunId,
    workflowRunId,
    loopRunId,
    node,
    loopRun,
    loop,
    startedAt,
    watchdogHint,
    stepTimeoutMs = AGENT_STEP_TIMEOUT_MS,
  } = params;
  const maxAgentTurns = Math.min(
    params.maxAgentTurnsPerStep ?? GUARDRAIL_DEFAULTS.maxAgentTurnsPerStep,
    GUARDRAIL_CEILINGS.maxAgentTurnsPerStep,
  );

  const sandboxName = buildSandboxName(stepRunId);

  const failureCtx = {
    loopRunId,
    stepRunId,
    nodeId: node.id,
    nodeKind: node.kind,
    attempt: loopRun.iterationCount + 1,
    workflowRunId,
    startedAt,
  };
  const isExecutionAllowed = () =>
    isAgentLoopRunSourceLive(loopRunId, {
      repoOwner: loop.repoOwner,
      repoName: loop.repoName,
    });

  if (!(await isExecutionAllowed())) {
    return {
      outcome: "failure",
      errorKind: "source_deleted",
      errorMessage: "Source Automation deleted",
    };
  }

  // ── 1. Verify repo access (write required for agent_step commit/push) ────────

  const accessResult = await verifyRepoAccess({
    userId: loopRun.userId,
    owner: loop.repoOwner,
    repo: loop.repoName,
    requiredUserPermission: "write",
  });

  if (!accessResult.ok) {
    const errorKind =
      accessResult.reason === "no_installation"
        ? "installation_missing"
        : "permission_missing";
    return recordAgentStepFailure({
      ...failureCtx,
      errorKind,
      errorMessage: `Repo access denied: ${accessResult.reason}`,
    });
  }

  // ── 2. Mint installation token, scoped to this repo ──────────────────────────
  // Token scopes come from the step's declared GitHub permissions (or the loop's
  // as a default), so a step can e.g. create issues / open PRs. contents:write is
  // always included for clone + push.

  let cloneToken: string;
  try {
    const scopedToken = await mintInstallationToken({
      installationId: accessResult.installationId,
      repositoryIds: [accessResult.repositoryId],
      permissions: permissionsToInstallationToken(
        effectiveStepPermissions(node.permissions, loop.permissions),
      ),
    });
    cloneToken = scopedToken.token;
  } catch (err) {
    return recordAgentStepFailure({
      ...failureCtx,
      errorKind: "installation_missing",
      errorMessage: `Failed to mint installation token: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 3. Determine working branch ───────────────────────────────────────────────
  // Resolution order (see module-level doc and resolveWorkingBranch):
  //   (1) context[nodeId].branch — re-run of same node keeps its own branch
  //   (2) last insertion-order context entry with a non-empty string branch field
  //   (3) access.defaultBranch — repo default branch fallback

  const workingBranch = resolveWorkingBranch(
    (loopRun.context ?? {}) as Record<string, unknown>,
    node.id,
    accessResult.defaultBranch,
  );

  if (!(await isExecutionAllowed())) {
    await revokeInstallationToken(cloneToken).catch(() => undefined);
    return {
      outcome: "failure",
      errorKind: "source_deleted",
      errorMessage: "Source Automation deleted",
    };
  }

  // ── 4. Connect sandbox ────────────────────────────────────────────────────────

  let sandbox: Sandbox | undefined;
  try {
    sandbox = await connectSandbox({
      state: {
        type: "vercel",
        sandboxName,
        source: {
          repo: `https://github.com/${loop.repoOwner}/${loop.repoName}.git`,
          branch: workingBranch,
        },
      },
      options: {
        githubToken: cloneToken,
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        vcpus: DEFAULT_SANDBOX_VCPUS,
        ports: DEFAULT_SANDBOX_PORTS,
        baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
        persistent: false,
        resume: false,
        createIfMissing: true,
      },
    });
  } catch (err) {
    // Revoke token if sandbox connect fails
    await revokeInstallationToken(cloneToken).catch(() => undefined);
    return recordAgentStepFailure({
      ...failureCtx,
      errorKind: "sandbox_unavailable",
      errorMessage: `Failed to connect sandbox: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    // Revoke the clone token — the sandbox no longer needs it for clone
    // (git operations will use withTemporaryGitHubAuth if needed)
    if (!sandbox) {
      await revokeInstallationToken(cloneToken).catch(() => undefined);
    }
  }

  // If sandbox connected, revoke clone token now (sandbox is already cloned)
  await revokeInstallationToken(cloneToken).catch(() => undefined);

  // ── 5. Execute with sandbox (always dispose in finally) ───────────────────────

  try {
    // ── 5a. Emit sandbox.started event ───────────────────────────────────────

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: node.id,
      eventName: "agent-loop.step.sandbox.started",
      status: "running",
      level: "info",
      summary: `Sandbox ready: ${sandboxName}`,
      payload: {
        sandboxName,
        stepRunId,
        workingBranch,
      },
      workflowRunId,
    });

    // ── 5b. Build prompt ─────────────────────────────────────────────────────

    const contextSlice = (loopRun.context ?? {}) as Record<string, unknown>;
    const prompt = buildLoopStepPrompt({
      node,
      contextSlice,
      repo: `${loop.repoOwner}/${loop.repoName}`,
      branch: workingBranch,
      watchdogHint,
    });

    // ── 5c. Run openAgent in a bounded loop ─────────────────────────────────
    // A single generate call may return finishReason "tool-calls", meaning
    // the model wants to see tool results before it is done. We keep looping
    // until finishReason is no longer "tool-calls", or until we exceed
    // maxAgentTurnsPerStep. This mirrors the runMutationAgent pattern in
    // background-agents/executor.ts.

    let agentResult: Awaited<ReturnType<typeof openAgent.generate>>;
    const sandboxState = (sandbox as { getState?: () => unknown }).getState?.();
    const agentOptions = {
      sandbox: sandboxState
        ? {
            state: sandboxState as Parameters<
              typeof openAgent.generate
            >[0]["options"]["sandbox"]["state"],
            workingDirectory: sandbox.workingDirectory,
            currentBranch: sandbox.currentBranch,
            environmentDetails: sandbox.environmentDetails,
          }
        : undefined,
      runtimeMode: "classic" as const,
      // Unattended: no human can approve tool calls. Tools resolve their
      // approval gates deterministically (web_fetch auto-approves; dangerous
      // bash / sensitive reads are denied via the sanitizer below) so an
      // approval-gated call cannot wedge the run with a dangling tool_use.
      unattended: true,
      // Pre-approved built-in tools for this step. null = default policy.
      allowedBuiltinToolNames: node.builtinToolNames ?? null,
      customInstructions: BASE_STEP_CUSTOM_INSTRUCTIONS,
    };

    // Resolve any Composio tools this step is granted (B-P2). Gated by the
    // user's connected accounts + repo policy.
    //
    // #798 (loop parity): every non-ready outcome now emits a structured
    // event matching the background-agent executor's vocabulary
    // (agent-loop.step.composio.*), instead of the previous silent
    // off/error skip. Still non-fatal — the step continues without
    // Composio tools on off/error.
    let composioTools: import("ai").ToolSet | undefined;
    const toolkitSlugs = node.composioToolkitSlugs ?? [];
    if (toolkitSlugs.length > 0) {
      const composioResult = await resolveComposioToolsForBgRun({
        agentId: null,
        runId: loopRun.id,
        userId: loopRun.userId,
        slugs: toolkitSlugs,
        repoOwner: loop.repoOwner,
        repoName: loop.repoName,
      });
      if (composioResult.status === "ready") {
        composioTools = guardToolSet(composioResult.tools, async () => {
          if (!(await isExecutionAllowed())) {
            throw new Error("Loop execution authorization was revoked.");
          }
          await assertComposioRepoToolkitsStillAllowed({
            userId: loopRun.userId,
            repoOwner: loop.repoOwner,
            repoName: loop.repoName,
            toolkitSlugs: composioResult.toolkitSlugs,
          });
        });

        if (composioResult.disconnectedToolkits.length > 0) {
          await recordAgentLoopEvent({
            loopRunId,
            stepRunId,
            nodeId: node.id,
            eventName: "agent-loop.step.composio.not_connected",
            status: "succeeded",
            level: "warn",
            summary: `Composio toolkits resolved but not connected: ${composioResult.disconnectedToolkits.join(", ")}.`,
            payload: {
              disconnectedToolkits: composioResult.disconnectedToolkits,
            },
            workflowRunId,
          });
        }
      } else if (composioResult.status === "error") {
        await recordAgentLoopEvent({
          loopRunId,
          stepRunId,
          nodeId: node.id,
          eventName: "agent-loop.step.composio.error",
          status: "failed",
          level: "warn",
          summary: `Composio tool resolution failed: ${composioResult.message}`,
          // Do NOT include raw error details that might contain secrets.
          payload: { errorKind: composioResult.errorKind },
          workflowRunId,
        });
      } else {
        // #799 extends this switch with "not_in_repo_allowlist" (a non-null
        // repo selectedToolkitSlugs allowlist dropped every requested slug)
        // — distinct copy from "repo_policy_blocked" (denylist).
        let offSummary: string;
        if (composioResult.reason === "repo_policy_blocked") {
          offSummary = `Composio tools blocked by repo policy: ${(composioResult.blockedSlugs ?? []).join(", ")}.`;
        } else if (composioResult.reason === "not_in_repo_allowlist") {
          offSummary = `Composio tools not in repository allowlist: ${(composioResult.blockedSlugs ?? []).join(", ")}.`;
        } else {
          offSummary =
            "Composio tools requested but no toolkit slugs were selected.";
        }
        const includeBlockedSlugsInPayload =
          composioResult.reason === "repo_policy_blocked" ||
          composioResult.reason === "not_in_repo_allowlist";
        await recordAgentLoopEvent({
          loopRunId,
          stepRunId,
          nodeId: node.id,
          eventName: "agent-loop.step.composio.off",
          status: "succeeded",
          level: "warn",
          summary: offSummary,
          payload: {
            reason: composioResult.reason,
            ...(includeBlockedSlugsInPayload
              ? { blockedSlugs: composioResult.blockedSlugs ?? [] }
              : {}),
          },
          workflowRunId,
        });
      }
    }

    // Accumulate messages across turns so the next call sees prior tool results.
    let agentMessages: ModelMessage[] = [{ role: "user", content: prompt }];

    // stepTimeoutMs is the budget for the WHOLE step, not each individual
    // openAgent.generate call. Compute a single deadline before the loop and
    // pass each call only the remaining budget — otherwise a step configured
    // at e.g. 30 minutes could run up to maxAgentTurns x 30 minutes if
    // every iteration reset the timeout to the full stepTimeoutMs.
    const deadlineAt = Date.now() + stepTimeoutMs;

    try {
      let loopStep = 0;
      let wrapUpIssued = false;
      while (true) {
        loopStep++;

        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) {
          return await recordAgentStepFailure({
            ...failureCtx,
            errorKind: "workflow_failed",
            errorMessage: `Agent step timed out after ${stepTimeoutMs}ms`,
          });
        }

        const budget = buildBudgetAwareInstructions({
          turn: loopStep,
          maxTurns: maxAgentTurns,
        });
        if (budget.wrapUp) {
          wrapUpIssued = true;
        }

        // Repair any approval-gated tool call the previous turn left without a
        // result before re-sending history — otherwise the provider rejects the
        // request ("Tool result is missing for tool call …") and fails the run.
        agentMessages = sanitizeUnattendedToolCalls(agentMessages);
        const liveModelAccess = await verifyRepoAccess({
          userId: loopRun.userId,
          owner: loop.repoOwner,
          repo: loop.repoName,
          requiredUserPermission: "write",
        });
        if (!liveModelAccess.ok) {
          return await recordAgentStepFailure({
            ...failureCtx,
            errorKind: "permission_missing",
            errorMessage: "Repository access was revoked during execution.",
          });
        }
        const turnStartedAt = Date.now();
        agentResult = await openAgent.generate({
          messages: agentMessages,
          options: { ...agentOptions, customInstructions: budget.instructions },
          timeout: { totalMs: Math.max(1, remainingMs) },
          ...(composioTools ? { tools: composioTools } : {}),
        } as Parameters<typeof openAgent.generate>[0]);

        if (!(await isExecutionAllowed())) {
          return {
            outcome: "failure",
            errorKind: "source_deleted",
            errorMessage: "Source Automation deleted",
          };
        }

        // Append model response messages so tool results are visible next turn.
        if (agentResult.response?.messages?.length) {
          agentMessages.push(...agentResult.response.messages);
        }

        // Per-turn heartbeat: emitted on EVERY turn (including the final one)
        // so a run in progress shows incremental activity instead of sitting
        // static until the whole internal generate loop completes. Mirrors
        // executor.ts's background-agent.agent.step.completed payload shape.
        await recordAgentLoopEvent({
          loopRunId,
          stepRunId,
          nodeId: node.id,
          eventName: "agent-loop.step.agent.turn.completed",
          status: "succeeded",
          level: "info",
          summary: `Agent turn ${loopStep} completed (finishReason: ${agentResult.finishReason})`,
          payload: {
            turn: loopStep,
            maxAgentTurnsPerStep: maxAgentTurns,
            finishReason: agentResult.finishReason,
            rawFinishReason: agentResult.rawFinishReason ?? null,
            durationMs: Date.now() - turnStartedAt,
            toolCallCount: agentResult.steps.reduce(
              (c, s) => c + s.toolCalls.length,
              0,
            ),
            usage: agentResult.usage,
            totalUsage: agentResult.totalUsage,
          },
          workflowRunId,
        });

        if (agentResult.finishReason !== "tool-calls") {
          // Agent has stopped requesting tool calls — exit loop.
          break;
        }

        if (loopStep >= maxAgentTurns) {
          return await recordAgentStepFailure({
            ...failureCtx,
            errorKind: "turn_budget_exceeded",
            errorMessage: `Agent step exhausted ${maxAgentTurns} agent turns without finishing`,
            payloadExtras: {
              turnsUsed: loopStep,
              maxAgentTurnsPerStep: maxAgentTurns,
              wrapUpIssued,
            },
          });
        }
      }
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("aborted"));
      return await recordAgentStepFailure({
        ...failureCtx,
        errorKind: "workflow_failed",
        errorMessage: isAbort
          ? `Agent step timed out after ${stepTimeoutMs}ms`
          : `Agent step failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // ── 5d. Emit agent.completed event ───────────────────────────────────────

    await recordAgentLoopEvent({
      loopRunId,
      stepRunId,
      nodeId: node.id,
      eventName: "agent-loop.step.agent.completed",
      status: "succeeded",
      level: "info",
      summary: `Agent step completed (finishReason: ${agentResult.finishReason})`,
      payload: {
        finishReason: agentResult.finishReason,
        usage: agentResult.totalUsage ?? agentResult.usage,
        steps: agentResult.steps.length,
        toolCallCount: agentResult.steps.reduce(
          (c, s) => c + s.toolCalls.length,
          0,
        ),
      },
      workflowRunId,
    });

    // ── 5e. Read and validate output JSON ────────────────────────────────────

    let rawOutput: string;
    try {
      rawOutput = await sandbox.readFile(STEP_OUTPUT_PATH, "utf-8");
    } catch {
      return await recordAgentStepFailure({
        ...failureCtx,
        errorKind: "step_output_invalid",
        errorMessage: `Agent did not write output to ${STEP_OUTPUT_PATH}`,
      });
    }

    // Size cap
    const byteSize = new TextEncoder().encode(rawOutput).length;
    if (byteSize > STEP_OUTPUT_MAX_BYTES) {
      return await recordAgentStepFailure({
        ...failureCtx,
        errorKind: "step_output_invalid",
        errorMessage: `Step output exceeds size cap: ${byteSize} bytes (max ${STEP_OUTPUT_MAX_BYTES})`,
      });
    }

    // Parse JSON
    let parsedOutput: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawOutput);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("Output must be a JSON object");
      }
      parsedOutput = parsed as Record<string, unknown>;
    } catch (err) {
      return await recordAgentStepFailure({
        ...failureCtx,
        errorKind: "step_output_invalid",
        errorMessage: `Step output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Optional schema validation
    if (node.outputSchema) {
      const schemaError = validateStepOutput(parsedOutput, node.outputSchema);
      if (schemaError) {
        return await recordAgentStepFailure({
          ...failureCtx,
          errorKind: "step_output_invalid",
          errorMessage: `Step output fails schema validation: ${schemaError}`,
        });
      }
    }

    // ── 5f. checkCommand ─────────────────────────────────────────────────────

    if (node.checkCommand?.trim()) {
      const checkStartedAt = nowMs();
      const checkResult = await sandbox.exec(
        node.checkCommand.trim(),
        sandbox.workingDirectory,
        CHECK_COMMAND_TIMEOUT_MS,
      );
      const checkDurationMs = nowMs() - checkStartedAt;

      await recordAgentLoopEvent({
        loopRunId,
        stepRunId,
        nodeId: node.id,
        eventName: "agent-loop.step.check.completed",
        status: checkResult.success ? "succeeded" : "failed",
        level: checkResult.success ? "info" : "warn",
        summary: checkResult.success
          ? "Configured check passed"
          : "Configured check failed",
        payload: {
          checkConfigured: true,
          exitCode: checkResult.exitCode,
          durationMs: checkDurationMs,
          stdout: truncateOutput(checkResult.stdout, 2000),
          stderr: truncateOutput(checkResult.stderr, 2000),
          truncated: checkResult.truncated,
        },
        workflowRunId,
      });

      if (!checkResult.success) {
        return await recordAgentStepFailure({
          ...failureCtx,
          errorKind: "checks_failed",
          errorMessage: `Configured check exited with code ${checkResult.exitCode}`,
        });
      }
    }

    // ── 5g. Commit/push if changes ───────────────────────────────────────────

    // Determine target branch: prefer output JSON "branch" field,
    // then working branch, then default branch
    const outputBranch =
      typeof parsedOutput["branch"] === "string" &&
      parsedOutput["branch"].length > 0
        ? parsedOutput["branch"]
        : workingBranch;

    const hasChanges = await hasUncommittedChanges(sandbox);

    if (hasChanges) {
      await stageAll(sandbox);
      const commitAccess = await verifyRepoAccess({
        userId: loopRun.userId,
        owner: loop.repoOwner,
        repo: loop.repoName,
        requiredUserPermission: "write",
      });
      if (!commitAccess.ok) {
        return await recordAgentStepFailure({
          ...failureCtx,
          errorKind: "permission_missing",
          errorMessage: "Repository access was revoked before commit.",
        });
      }
      const coAuthor = await buildCoAuthor(loopRun.userId);
      const intentResult = await buildCommitIntentFromSandbox({
        sandbox,
        owner: loop.repoOwner,
        repo: loop.repoName,
        repositoryId: commitAccess.repositoryId,
        installationId: commitAccess.installationId,
        branch: outputBranch,
        message: "chore: agent_step changes",
        ...(coAuthor ? { coAuthor } : {}),
      });

      if (intentResult.ok) {
        if (!(await isExecutionAllowed())) {
          return {
            outcome: "failure",
            errorKind: "source_deleted",
            errorMessage: "Source Automation deleted",
          };
        }
        const finalCommitAccess = await verifyRepoAccess({
          userId: loopRun.userId,
          owner: loop.repoOwner,
          repo: loop.repoName,
          requiredUserPermission: "write",
        });
        if (!finalCommitAccess.ok) {
          return await recordAgentStepFailure({
            ...failureCtx,
            errorKind: "permission_missing",
            errorMessage: "Repository access was revoked before commit.",
          });
        }
        let commitResult: Awaited<ReturnType<typeof createCommit>>;
        try {
          commitResult = (await withScopedInstallationOctokit({
            installationId: finalCommitAccess.installationId,
            repositoryId: finalCommitAccess.repositoryId,
            permissions: { contents: "write" },
            operation: async (octokit) =>
              createCommit({
                octokit,
                owner: intentResult.intent.owner,
                repo: intentResult.intent.repo,
                branch: intentResult.intent.branch,
                expectedHeadSha: intentResult.intent.expectedHeadSha,
                message: intentResult.intent.message,
                files: intentResult.intent.files,
                ...(intentResult.intent.baseBranch
                  ? { baseBranch: intentResult.intent.baseBranch }
                  : {}),
                ...(intentResult.intent.coAuthor
                  ? { coAuthor: intentResult.intent.coAuthor }
                  : {}),
              }),
          })) as Awaited<ReturnType<typeof createCommit>>;
        } catch (commitErr) {
          const reason =
            commitErr instanceof Error ? commitErr.message : String(commitErr);
          await recordAgentLoopEvent({
            loopRunId,
            stepRunId,
            nodeId: node.id,
            eventName: "agent-loop.step.commit.failed",
            status: "failed",
            level: "error",
            summary: `Commit failed: ${reason}`,
            payload: { branch: outputBranch, reason },
            workflowRunId,
          });
          return await recordAgentStepFailure({
            ...failureCtx,
            errorKind: "commit_failed",
            errorMessage: `Commit failed: ${reason}`,
          });
        }

        if (!commitResult.ok) {
          const reason =
            (commitResult as { error?: string }).error ??
            "unknown commit error";
          await recordAgentLoopEvent({
            loopRunId,
            stepRunId,
            nodeId: node.id,
            eventName: "agent-loop.step.commit.failed",
            status: "failed",
            level: "error",
            summary: `Commit failed: ${reason}`,
            payload: { branch: outputBranch, reason },
            workflowRunId,
          });
          return await recordAgentStepFailure({
            ...failureCtx,
            errorKind: "commit_failed",
            errorMessage: `Commit failed: ${reason}`,
          });
        }

        // Commit succeeded — record branch + sha in the step output for downstream steps
        parsedOutput = {
          ...parsedOutput,
          branch: outputBranch,
          commitSha: commitResult.commitSha,
        };

        await recordAgentLoopEvent({
          loopRunId,
          stepRunId,
          nodeId: node.id,
          eventName: "agent-loop.step.commit.completed",
          status: "succeeded",
          level: "info",
          summary: `Committed changes to ${outputBranch}`,
          payload: {
            branch: outputBranch,
            sha: commitResult.commitSha,
            fileCount: intentResult.intent.files.length,
          },
          workflowRunId,
        });
      }
      // If intentResult is not ok (e.g. empty diff), proceed without commit
    }

    // ── 5h. Merge output into run context + persist ──────────────────────────

    const mergeResult = mergeStepOutput(
      loopRun.context ?? {},
      node.id,
      parsedOutput,
    );

    await updateAgentLoopRunContext({
      runId: loopRunId,
      context: mergeResult.context,
    });

    const finishedAt = new Date();
    await updateAgentLoopStepRun({
      stepRunId,
      status: "succeeded",
      stepOutput: parsedOutput,
      sandboxName,
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
      summary: `agent_step completed`,
      payload: {
        nodeKind: "agent_step",
        attempt: failureCtx.attempt,
        truncated: mergeResult.truncated,
      },
      workflowRunId,
    });

    return { outcome: "success" };
  } finally {
    // ALWAYS dispose sandbox — success and all failure paths
    await sandbox.stop().catch(() => undefined);
  }
}
