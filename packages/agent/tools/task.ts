import {
  type LanguageModelUsage,
  type ModelMessage,
  tool,
  type UIToolInvocation,
} from "ai";
import { z } from "zod";
import {
  buildDelegatedWorkspaceLaunchPolicy,
  delegatedWorkspaceLaunchPolicySchema,
  delegatedWorkspacePolicySchema,
  type DelegatedWorkspaceLaunchPolicy,
} from "../delegated-workspace";
import {
  buildDelegatedWorkerLifecycleEvent,
  delegatedWorkerLifecycleEventSchema,
  type DelegatedWorkerLifecycleEvent,
  type DelegatedWorkerLifecycleStatus,
} from "../delegated-worker-lifecycle";
import {
  buildDelegatedWorkerCompletionPacket,
  delegatedWorkerCompletionPacketSchema,
  delegatedWorkerCompletionPacketValidationStatusSchema,
  type DelegatedWorkerCompletionPacket,
  type DelegatedWorkerCompletionPacketValidation,
} from "../delegated-worker-completion-packet";
import {
  IsolatedWorkspaceProvisioningError,
  isolatedWorkerWorkspaceResultSchema,
  provisionIsolatedWorkerWorkspace,
  type IsolatedWorkerWorkspaceResult,
} from "../isolated-worker-workspace";
import {
  delegatedWorkspaceResolverDecisionSchema,
  resolveDelegatedWorkspacePolicy,
} from "../delegated-workspace-resolver";
import {
  defaultSharedWriterLeaseManager,
  sharedWriterLeaseEventSchema,
  sharedWriterLeaseReleaseSchema,
  sharedWriterLeaseResultSchema,
  type SharedWriterLeaseRelease,
  type SharedWriterLeaseResult,
} from "../shared-writer-lease";
import { SharedWriterLeaseConflictError } from "../shared-writer-lease-error";
import {
  captureSharedWorkspaceBaseline,
  checkSharedWorkspaceDrift,
  sharedWorkspaceBaselineSchema,
  sharedWorkspaceDriftCheckSchema,
  type SharedWorkspaceBaseline,
  type SharedWorkspaceDriftCheck,
} from "../shared-workspace-drift";
import { SharedWorkspaceDriftError } from "../shared-workspace-drift-error";
import {
  buildSubagentSummaryLines,
  SUBAGENT_REGISTRY,
  SUBAGENT_TYPES,
} from "../subagents/registry";
import { applyRosterOverrides } from "../subagents/roster";
import { SUBAGENT_STEP_LIMIT } from "../subagents/constants";
import { sumLanguageModelUsage } from "../usage";
import {
  getSandboxContext,
  getSubagentModel,
  getSubagentRoster,
} from "./utils";

const subagentTypeSchema = z.enum(SUBAGENT_TYPES);

const subagentSummaryLines = buildSubagentSummaryLines();

const taskInputSchema = z.object({
  subagentType: subagentTypeSchema.describe(
    `Subagent to launch. Available options:\n${subagentSummaryLines}`,
  ),
  workspacePolicy: delegatedWorkspacePolicySchema
    .optional()
    .describe(
      "Workspace policy for the delegated worker: auto, shared, or isolated. Defaults to auto for backward compatibility.",
    ),
  task: z
    .string()
    .describe("Short description of the task (displayed to user)"),
  instructions: z.string().describe(
    `Detailed instructions for the subagent. Include:
- Goal and deliverables
- Step-by-step procedure
- Constraints and patterns to follow
- How to verify the work`,
  ),
});

const taskPendingToolCallSchema = z.object({
  name: z.string(),
  input: z.unknown(),
});

export type TaskPendingToolCall = z.infer<typeof taskPendingToolCallSchema>;
export type TaskWorkspacePolicy = DelegatedWorkspaceLaunchPolicy;

const WRITE_CAPABLE_SUBAGENTS = new Set(["executor", "design"]);

const taskRuntimeOutputSchema = z.object({
  mode: z.literal("managed_runtime"),
  label: z.literal("Managed runtime worker"),
  workerType: z.string(),
  profileId: z.string().optional(),
  profileVersion: z.string().optional(),
  profileDisplayName: z.string().optional(),
  profileRunId: z.string().optional(),
  sandboxName: z.string().optional(),
});

export const taskOutputSchema = z.object({
  pending: taskPendingToolCallSchema.optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
  startedAt: z.number().int().nonnegative().optional(),
  modelId: z.string().optional(),
  runtime: taskRuntimeOutputSchema.optional(),
  workspacePolicy: delegatedWorkspaceLaunchPolicySchema.optional(),
  workspaceResolution: delegatedWorkspaceResolverDecisionSchema.optional(),
  sharedWriterLease: sharedWriterLeaseResultSchema.optional(),
  sharedWriterLeaseRelease: sharedWriterLeaseReleaseSchema.optional(),
  sharedWriterLeaseEvents: z.array(sharedWriterLeaseEventSchema).optional(),
  sharedWorkspaceBaseline: sharedWorkspaceBaselineSchema.optional(),
  sharedWorkspaceDrift: sharedWorkspaceDriftCheckSchema.optional(),
  isolatedWorkspace: isolatedWorkerWorkspaceResultSchema.optional(),
  delegatedWorkerLifecycle: delegatedWorkerLifecycleEventSchema.optional(),
  delegatedWorkerLifecycleEvents: z
    .array(delegatedWorkerLifecycleEventSchema)
    .optional(),
  completionPacket: delegatedWorkerCompletionPacketSchema.optional(),
  completionPacketValidation: z
    .object({
      status: delegatedWorkerCompletionPacketValidationStatusSchema,
      reasonCode: z.string(),
      reason: z.string(),
      createdAt: z.number().int().nonnegative(),
    })
    .optional(),
  final: z.custom<ModelMessage[]>().optional(),
  usage: z.custom<LanguageModelUsage>().optional(),
});

export type TaskToolOutput = z.infer<typeof taskOutputSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getManagedRuntimeOutput(
  experimentalContext: unknown,
  workerType: string,
): TaskToolOutput["runtime"] {
  if (!isRecord(experimentalContext)) {
    return undefined;
  }

  if (experimentalContext.runtimeMode !== "managed_runtime") {
    return undefined;
  }

  const managedRuntime = isRecord(experimentalContext.managedRuntime)
    ? experimentalContext.managedRuntime
    : {};

  return {
    mode: "managed_runtime",
    label: "Managed runtime worker",
    workerType,
    profileId: getString(managedRuntime.profileId),
    profileVersion: getString(managedRuntime.profileVersion),
    profileDisplayName: getString(managedRuntime.profileDisplayName),
    profileRunId: getString(managedRuntime.profileRunId),
    sandboxName: getString(managedRuntime.sandboxName),
  };
}

function getRuntimeMode(
  experimentalContext: unknown,
): "classic" | "managed_runtime" {
  if (!isRecord(experimentalContext)) {
    return "classic";
  }

  return experimentalContext.runtimeMode === "managed_runtime"
    ? "managed_runtime"
    : "classic";
}

function getParentWorkspaceId(sandboxState: unknown): string | undefined {
  if (!isRecord(sandboxState)) {
    return undefined;
  }

  return getString(sandboxState.sandboxId) ?? getString(sandboxState.id);
}

function getSessionId(experimentalContext: unknown): string {
  if (!isRecord(experimentalContext)) {
    return "session";
  }

  return getString(experimentalContext.sessionId) ?? "session";
}

function isWriteCapableSubagent(subagentType: string): boolean {
  return WRITE_CAPABLE_SUBAGENTS.has(subagentType);
}

function buildTaskEvidenceRefs(output: {
  runtime?: TaskToolOutput["runtime"];
  workspacePolicy?: TaskToolOutput["workspacePolicy"];
  workspaceResolution?: TaskToolOutput["workspaceResolution"];
  isolatedWorkspace?: TaskToolOutput["isolatedWorkspace"];
  usage?: LanguageModelUsage;
}) {
  const refs: Array<{
    kind: "task_output" | "runtime" | "workspace" | "usage";
    ref: string;
  }> = [{ kind: "task_output", ref: "tool-task.output" }];

  if (output.runtime) {
    refs.push({ kind: "runtime", ref: "tool-task.output.runtime" });
  }

  if (output.workspacePolicy || output.workspaceResolution) {
    refs.push({ kind: "workspace", ref: "tool-task.output.workspace" });
  }

  if (output.isolatedWorkspace) {
    refs.push({
      kind: "workspace",
      ref: "tool-task.output.isolatedWorkspace",
    });
  }

  if (output.usage) {
    refs.push({ kind: "usage", ref: "tool-task.output.usage" });
  }

  return refs;
}

function buildManagedRuntimeWorkerInstructions(params: {
  experimentalContext: unknown;
  environmentDetails?: string;
}): string | undefined {
  if (!isRecord(params.experimentalContext)) {
    return undefined;
  }

  if (params.experimentalContext.runtimeMode !== "managed_runtime") {
    return undefined;
  }

  const managedRuntime = isRecord(params.experimentalContext.managedRuntime)
    ? params.experimentalContext.managedRuntime
    : {};
  const profileId = getString(managedRuntime.profileId);
  const profileVersion = getString(managedRuntime.profileVersion);
  const profileDisplayName = getString(managedRuntime.profileDisplayName);
  const profileRunId = getString(managedRuntime.profileRunId);
  const sandboxName = getString(managedRuntime.sandboxName);
  const profileLabel =
    profileDisplayName && profileId
      ? `${profileDisplayName} (${profileId})`
      : profileDisplayName || profileId || "unknown profile";
  const lines = [
    "## Managed Runtime Worker Context",
    "",
    "- Runtime mode: managed runtime.",
    `- Active profile: ${profileLabel}.`,
    profileVersion ? `- Profile version: ${profileVersion}.` : undefined,
    profileRunId ? `- Profile run id: ${profileRunId}.` : undefined,
    sandboxName ? `- Sandbox name: ${sandboxName}.` : undefined,
    "- Use only tools verified by the active profile; do not assume Node, npm, Bun, Python, or any other tool exists unless the profile setup/verification notes say it is available.",
    profileId === "web-bun-agent-browser"
      ? "- This profile verifies Bun and agent-browser. Prefer `bun install`, `bun run ...`, and `bun --bun run ...` for JavaScript/TypeScript work. Treat Node/npm as optional observations; if they are unavailable, report that as non-blocking unless the task explicitly requires Node/npm."
      : "- Follow the active profile's setup and verification notes when choosing install, build, lint, test, and browser-check commands.",
  ].filter((line): line is string => typeof line === "string");

  if (params.environmentDetails?.trim()) {
    lines.push(
      "",
      "Environment details from the parent runtime. Managed-runtime-specific notes override generic base-sandbox notes:",
      "",
      params.environmentDetails.trim(),
    );
  }

  return lines.join("\n");
}

export const taskTool = tool({
  needsApproval: false,
  description: `Launch a specialized subagent to handle complex tasks autonomously.

AVAILABLE SUBAGENTS:
${subagentSummaryLines}

WHEN TO USE:
- Clearly-scoped work that can be delegated with explicit instructions
- Work where focused execution would clutter the main conversation
- Tasks that match one of the available subagent descriptions above
- Managed runtime coordinator mode, where repository exploration, implementation, and verification must be delegated

WHEN NOT TO USE (do it yourself):
- Simple, single-file or single-change edits
- Tasks where you already have all the context you need
- Ambiguous work that requires back-and-forth clarification

BEHAVIOR:
- Subagents work AUTONOMOUSLY without asking follow-up questions
- They run up to ${SUBAGENT_STEP_LIMIT} tool steps and then return
- They return ONLY a concise summary - their internal steps are isolated from the parent

HOW TO USE:
- Choose the appropriate subagentType based on the subagent descriptions above
- Choose workspacePolicy when it matters: auto preserves the default policy, shared declares use of the active session workspace, and isolated declares that the worker should use an isolated workspace when provisioning is available
- Provide a short task string (for display) summarizing the goal
- Provide detailed instructions including goals, steps, constraints, and verification criteria

IMPORTANT:
- Be explicit and concrete - subagents cannot ask clarifying questions
- Include critical context (APIs, function names, file paths) in the instructions
- The parent agent will not see the subagent's internal tool calls, only its final summary`,
  inputSchema: taskInputSchema,
  outputSchema: taskOutputSchema,
  execute: async function* (
    rawInput,
    { experimental_context, abortSignal, toolCallId },
  ) {
    const parsedInput = taskInputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      throw new Error(
        "policy_validation_failed: invalid workspacePolicy; expected auto, shared, or isolated. Worker was not started.",
      );
    }

    const { subagentType, task, instructions } = parsedInput.data;
    const workspacePolicy = parsedInput.data.workspacePolicy ?? "auto";
    const startedAt = Date.now();
    const sandboxContext = getSandboxContext(experimental_context, "task");
    const defaultModel = getSubagentModel(experimental_context, "task");
    const roster = getSubagentRoster(experimental_context);
    const runtime = getManagedRuntimeOutput(experimental_context, subagentType);
    const workspacePolicyOutput =
      buildDelegatedWorkspaceLaunchPolicy(workspacePolicy);
    const workspaceResolution = resolveDelegatedWorkspacePolicy({
      parentRunId: toolCallId ?? "task",
      runtimeMode: getRuntimeMode(experimental_context),
      requestedPolicy: workspacePolicy,
      parentWorkspaceId:
        getParentWorkspaceId(sandboxContext.sandbox.state) ??
        "active-session-workspace",
    });
    let sharedWriterLease: SharedWriterLeaseResult | undefined;
    let sharedWriterLeaseRelease: SharedWriterLeaseRelease | undefined;
    let sharedWorkspaceBaseline: SharedWorkspaceBaseline | undefined;
    let sharedWorkspaceDrift: SharedWorkspaceDriftCheck | undefined;
    let isolatedWorkspace: IsolatedWorkerWorkspaceResult | undefined;
    let workerSandboxContext = sandboxContext.sandbox;
    const delegatedWorkerLifecycleEvents: DelegatedWorkerLifecycleEvent[] = [];
    const workerId = toolCallId ?? `${subagentType}-${startedAt}`;
    let toolCallCount = 0;
    let pending: TaskPendingToolCall | undefined;
    let usage: LanguageModelUsage | undefined;
    let completionPacket: DelegatedWorkerCompletionPacket | undefined;
    let completionPacketValidation:
      | DelegatedWorkerCompletionPacketValidation
      | undefined;
    const managedRuntimeInstructions = buildManagedRuntimeWorkerInstructions({
      experimentalContext: experimental_context,
      environmentDetails: sandboxContext.sandbox.environmentDetails,
    });
    const delegatedInstructions = managedRuntimeInstructions
      ? `${instructions}\n\n${managedRuntimeInstructions}`
      : instructions;

    // Apply per-role roster overrides if the subagent role has a configured entry.
    // For non-subagent roles (managed_runtime workers etc.) the cast below is safe
    // because applyRosterOverrides only reads known keys from the roster object.
    const isSubagentRole = (
      role: string,
    ): role is "explorer" | "executor" | "design" =>
      role === "explorer" || role === "executor" || role === "design";

    const rosterOverrides = isSubagentRole(subagentType)
      ? applyRosterOverrides({
          role: subagentType,
          roster,
          base: { model: defaultModel, instructions: delegatedInstructions },
        })
      : { model: defaultModel, instructions: delegatedInstructions };

    const model = rosterOverrides.model as typeof defaultModel;
    const effectiveInstructions = rosterOverrides.instructions;
    const subagentModelId = typeof model === "string" ? model : model.modelId;
    const appendLifecycleEvent = (
      status: DelegatedWorkerLifecycleStatus,
      reasonCode: string,
    ) => {
      const event = buildDelegatedWorkerLifecycleEvent({
        workerId,
        workerType: subagentType,
        workerLabel: subagentType,
        parentToolCallId: toolCallId,
        status,
        reasonCode,
        workspaceMode:
          workspaceResolution.status === "accepted"
            ? workspaceResolution.decision
            : workspacePolicyOutput.executionMode,
        requestedWorkspacePolicy: workspacePolicyOutput.requestedPolicy,
        effectiveWorkspacePolicy: workspacePolicyOutput.effectivePolicy,
        workspaceId:
          isolatedWorkspace?.childWorkspaceId ??
          (workspaceResolution.status === "accepted"
            ? workspaceResolution.parentWorkspaceId
            : undefined),
        modelId: subagentModelId,
        startedAt,
      });
      delegatedWorkerLifecycleEvents.push(event);
      return event;
    };
    const buildTerminalCompletionPacket = (
      status: "completed" | "blocked" | "failed" | "cancelled",
      reasonCode: string,
      finalMessages?: ModelMessage[],
    ) => {
      const packetResult = buildDelegatedWorkerCompletionPacket({
        status,
        reasonCode,
        workerId,
        workerType: subagentType,
        workspaceMode:
          workspaceResolution.status === "accepted"
            ? workspaceResolution.decision
            : workspacePolicyOutput.executionMode,
        finalMessages,
        taskTitle: task,
        toolCallCount,
        evidenceRefs: buildTaskEvidenceRefs({
          runtime,
          workspacePolicy: workspacePolicyOutput,
          workspaceResolution,
          isolatedWorkspace,
          usage,
        }),
        createdAt: Date.now(),
      });
      completionPacket = packetResult.packet;
      completionPacketValidation = packetResult.validation;
    };

    if (
      workspaceResolution.status === "accepted" &&
      workspaceResolution.decision === "isolated"
    ) {
      const provisioningStarted = appendLifecycleEvent(
        "launching",
        "isolated_workspace_creation_started",
      );
      yield {
        toolCallCount: 0,
        startedAt,
        modelId: subagentModelId,
        runtime,
        workspacePolicy: workspacePolicyOutput,
        workspaceResolution,
        delegatedWorkerLifecycle: provisioningStarted,
        delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
      };

      try {
        const provisioned = await provisionIsolatedWorkerWorkspace({
          provisioner: sandboxContext.sandbox.isolatedWorkspaceProvisioner,
          parentSandbox: sandboxContext.sandbox,
          parentWorkspaceId: workspaceResolution.parentWorkspaceId,
          workerId,
          startedAt,
        });
        isolatedWorkspace = provisioned.result;
        workerSandboxContext = provisioned.sandbox;
        const provisioningSucceeded = appendLifecycleEvent(
          "launching",
          "isolated_workspace_creation_succeeded",
        );
        yield {
          toolCallCount: 0,
          startedAt,
          modelId: subagentModelId,
          runtime,
          workspacePolicy: workspacePolicyOutput,
          workspaceResolution,
          isolatedWorkspace,
          delegatedWorkerLifecycle: provisioningSucceeded,
          delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
        };
      } catch (error) {
        if (!(error instanceof IsolatedWorkspaceProvisioningError)) {
          throw error;
        }

        isolatedWorkspace = error.result;
        const blockedLifecycle = appendLifecycleEvent(
          "blocked",
          error.result.reasonCode,
        );
        buildTerminalCompletionPacket("blocked", error.result.reasonCode);
        yield {
          toolCallCount: 0,
          startedAt,
          modelId: subagentModelId,
          runtime,
          workspacePolicy: workspacePolicyOutput,
          workspaceResolution,
          isolatedWorkspace,
          delegatedWorkerLifecycle: blockedLifecycle,
          delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
          completionPacket,
          completionPacketValidation,
        };
        throw error;
      }
    }

    const releaseSharedWriterLease = (reasonCode: string) => {
      if (
        sharedWriterLease?.status !== "acquired" ||
        sharedWriterLeaseRelease
      ) {
        return;
      }

      sharedWriterLeaseRelease = defaultSharedWriterLeaseManager.release({
        sessionId: sharedWriterLease.sessionId,
        workspaceId: sharedWriterLease.workspaceId,
        workerId: sharedWriterLease.workerId,
        reasonCode,
      });
    };
    const shouldAcquireSharedWriterLease =
      workspaceResolution.status === "accepted" &&
      workspaceResolution.decision === "shared" &&
      isWriteCapableSubagent(subagentType);

    if (shouldAcquireSharedWriterLease) {
      sharedWriterLease = defaultSharedWriterLeaseManager.acquire({
        sessionId: getSessionId(experimental_context),
        workspaceId: workspaceResolution.parentWorkspaceId,
        workerId,
      });

      if (sharedWriterLease.status === "denied") {
        const blockedLifecycle = appendLifecycleEvent(
          "blocked",
          "shared_writer_lock_denied",
        );
        buildTerminalCompletionPacket("blocked", "shared_writer_lock_denied");
        yield {
          toolCallCount: 0,
          startedAt,
          modelId: subagentModelId,
          runtime,
          workspacePolicy: workspacePolicyOutput,
          workspaceResolution,
          sharedWriterLease,
          sharedWriterLeaseEvents: sharedWriterLease.events,
          delegatedWorkerLifecycle: blockedLifecycle,
          delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
          completionPacket,
          completionPacketValidation,
        };
        throw new SharedWriterLeaseConflictError(sharedWriterLease);
      }

      sharedWorkspaceBaseline = await captureSharedWorkspaceBaseline({
        workerId,
        workspaceId: workspaceResolution.parentWorkspaceId,
        workspacePath: sandboxContext.workingDirectory,
      });
      sharedWorkspaceDrift = await checkSharedWorkspaceDrift({
        baseline: sharedWorkspaceBaseline,
        workspacePath: sandboxContext.workingDirectory,
      });

      if (sharedWorkspaceDrift.status === "blocked") {
        releaseSharedWriterLease("workspace_drift_detected");
        const blockedLifecycle = appendLifecycleEvent(
          "blocked",
          "workspace_drift_detected",
        );
        buildTerminalCompletionPacket("blocked", "workspace_drift_detected");
        yield {
          toolCallCount: 0,
          startedAt,
          modelId: subagentModelId,
          runtime,
          workspacePolicy: workspacePolicyOutput,
          workspaceResolution,
          sharedWriterLease,
          sharedWriterLeaseRelease,
          sharedWriterLeaseEvents: [
            ...(sharedWriterLease?.events ?? []),
            ...(sharedWriterLeaseRelease?.events ?? []),
          ],
          sharedWorkspaceBaseline,
          sharedWorkspaceDrift,
          delegatedWorkerLifecycle: blockedLifecycle,
          delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
          completionPacket,
          completionPacketValidation,
        };
        throw new SharedWorkspaceDriftError(sharedWorkspaceDrift);
      }

      if (sharedWorkspaceDrift.status === "unsupported") {
        releaseSharedWriterLease("unsupported_workspace_baseline");
        const blockedLifecycle = appendLifecycleEvent(
          "blocked",
          "unsupported_workspace_baseline",
        );
        buildTerminalCompletionPacket(
          "blocked",
          "unsupported_workspace_baseline",
        );
        yield {
          toolCallCount: 0,
          startedAt,
          modelId: subagentModelId,
          runtime,
          workspacePolicy: workspacePolicyOutput,
          workspaceResolution,
          sharedWriterLease,
          sharedWriterLeaseRelease,
          sharedWriterLeaseEvents: [
            ...(sharedWriterLease?.events ?? []),
            ...(sharedWriterLeaseRelease?.events ?? []),
          ],
          sharedWorkspaceBaseline,
          sharedWorkspaceDrift,
          delegatedWorkerLifecycle: blockedLifecycle,
          delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
          completionPacket,
          completionPacketValidation,
        };
        throw new SharedWorkspaceDriftError(sharedWorkspaceDrift);
      }
    }

    const subagent = SUBAGENT_REGISTRY[subagentType].agent;
    const launchingLifecycle = appendLifecycleEvent(
      "launching",
      "worker_launching",
    );

    // Emit before starting the subagent stream so chat UIs can show that the
    // delegated worker has actually started, even before its first tool call.
    yield {
      toolCallCount,
      startedAt,
      modelId: subagentModelId,
      runtime,
      workspacePolicy: workspacePolicyOutput,
      workspaceResolution,
      sharedWriterLease,
      sharedWriterLeaseEvents: sharedWriterLease?.events,
      sharedWorkspaceBaseline,
      sharedWorkspaceDrift,
      isolatedWorkspace,
      delegatedWorkerLifecycle: launchingLifecycle,
      delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
    };
    let modelCallPending = false;
    try {
      const runningLifecycle = appendLifecycleEvent(
        "running",
        "worker_running",
      );
      // Only the model call itself may be reported as a model failure; once the
      // stream is open a failure can just as easily come from a tool or from
      // response assembly, and must keep its original error.
      modelCallPending = true;
      const result = await subagent.stream({
        prompt:
          "Complete this task and provide a summary of what you accomplished.",
        options: {
          task,
          instructions: effectiveInstructions,
          sandbox: workerSandboxContext,
          model,
          workspacePolicy: workspacePolicyOutput,
        },
        abortSignal,
      });

      // Deliberately NOT cleared here. Some providers surface a connection or
      // auth failure while the stream is first iterated rather than when
      // stream() resolves, and those are still model failures. The flag clears
      // on the first part actually yielded, which is the earliest point at
      // which the model is demonstrably producing output.
      for await (const part of result.fullStream) {
        modelCallPending = false;
        if (part.type === "tool-call") {
          toolCallCount += 1;
          pending = { name: part.toolName, input: part.input };
          yield {
            pending,
            toolCallCount,
            usage,
            startedAt,
            modelId: subagentModelId,
            runtime,
            workspacePolicy: workspacePolicyOutput,
            workspaceResolution,
            sharedWriterLease,
            sharedWriterLeaseEvents: sharedWriterLease?.events,
            sharedWorkspaceBaseline,
            sharedWorkspaceDrift,
            isolatedWorkspace,
            delegatedWorkerLifecycle: runningLifecycle,
            delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
          };
        }

        if (part.type === "finish-step") {
          usage = sumLanguageModelUsage(usage, part.usage);
          // Keep the last observed tool call in interim updates so task UIs don't
          // flicker back to an initializing state between subagent steps.
          yield {
            pending,
            toolCallCount,
            usage,
            startedAt,
            modelId: subagentModelId,
            runtime,
            workspacePolicy: workspacePolicyOutput,
            workspaceResolution,
            sharedWriterLease,
            sharedWriterLeaseEvents: sharedWriterLease?.events,
            sharedWorkspaceBaseline,
            sharedWorkspaceDrift,
            isolatedWorkspace,
            delegatedWorkerLifecycle: runningLifecycle,
            delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
          };
        }
      }

      const response = await result.response;
      const finalUsage = usage ?? (await result.usage);
      releaseSharedWriterLease("worker_terminal");
      const completedLifecycle = appendLifecycleEvent(
        "completed",
        "worker_terminal",
      );
      usage = finalUsage;
      buildTerminalCompletionPacket(
        "completed",
        "worker_terminal",
        response.messages,
      );
      yield {
        final: response.messages,
        toolCallCount,
        usage: finalUsage,
        startedAt,
        modelId: subagentModelId,
        runtime,
        workspacePolicy: workspacePolicyOutput,
        workspaceResolution,
        sharedWriterLease,
        sharedWriterLeaseRelease,
        sharedWriterLeaseEvents: [
          ...(sharedWriterLease?.events ?? []),
          ...(sharedWriterLeaseRelease?.events ?? []),
        ],
        sharedWorkspaceBaseline,
        sharedWorkspaceDrift,
        isolatedWorkspace,
        delegatedWorkerLifecycle: completedLifecycle,
        delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
        completionPacket,
        completionPacketValidation,
      };
    } catch (error) {
      const reasonCode = abortSignal?.aborted
        ? "worker_cancelled"
        : "worker_failed";
      releaseSharedWriterLease(reasonCode);
      const terminalLifecycle = appendLifecycleEvent(
        abortSignal?.aborted ? "cancelled" : "failed",
        reasonCode,
      );
      buildTerminalCompletionPacket(
        abortSignal?.aborted ? "cancelled" : "failed",
        reasonCode,
      );
      yield {
        pending,
        toolCallCount,
        usage,
        startedAt,
        modelId: subagentModelId,
        runtime,
        workspacePolicy: workspacePolicyOutput,
        workspaceResolution,
        sharedWriterLease,
        sharedWriterLeaseRelease,
        sharedWriterLeaseEvents: [
          ...(sharedWriterLease?.events ?? []),
          ...(sharedWriterLeaseRelease?.events ?? []),
        ],
        sharedWorkspaceBaseline,
        sharedWorkspaceDrift,
        isolatedWorkspace,
        delegatedWorkerLifecycle: terminalLifecycle,
        delegatedWorkerLifecycleEvents: [...delegatedWorkerLifecycleEvents],
        completionPacket,
        completionPacketValidation,
      };
      if (abortSignal?.aborted || !modelCallPending) {
        throw error;
      }
      // The model call failed after the workspace checks already passed, so
      // surface the model/provider failure instead of leaving the parent agent
      // to guess at a workspace cause.
      throw new Error(
        `subagent_model_failed: the delegated worker model "${subagentModelId}" failed before returning output: ${error instanceof Error ? error.message : String(error)}. Check that the model is reachable and configured; the shared workspace was not the cause.`,
        { cause: error },
      );
    } finally {
      releaseSharedWriterLease(
        abortSignal?.aborted ? "worker_cancelled" : "worker_terminal",
      );
    }
  },
  toModelOutput: ({ output: { final: messages } }) => {
    if (!messages) {
      return { type: "text", value: "Task completed." };
    }

    const lastAssistantMessage = messages.findLast(
      (p) => p.role === "assistant",
    );
    const content = lastAssistantMessage?.content;

    if (!content) {
      return { type: "text", value: "Task completed." };
    }

    if (typeof content === "string") {
      return { type: "text", value: content };
    }

    const lastTextPart = content.findLast((p) => p.type === "text");
    if (!lastTextPart) {
      return { type: "text", value: "Task completed." };
    }

    return { type: "text", value: lastTextPart.text };
  },
});

export type TaskToolUIPart = UIToolInvocation<typeof taskTool>;
