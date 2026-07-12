import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
  BackgroundAgentPermissions,
} from "@/lib/db/schema";
import {
  buildNormalizedLoopStepInput,
  type NormalizedUnattendedStepInputV1,
} from "@/lib/unattended-runtime/normalized-step-input";
import type { ResolvedAgentLoopExecutionDefinition } from "./execution-snapshot";
import { resolveWorkingBranchIntent } from "./resolve-working-branch";
import { loopDefinitionSchema } from "./types";

export type NormalizedLoopStepInput = Extract<
  NormalizedUnattendedStepInputV1,
  { executionKind: "loop_agent_step" }
>;

export type AgentLoopLiveStepPolicy = {
  permissions: BackgroundAgentPermissions | undefined;
  builtinToolNames: string[] | null;
  composioToolkitSlugs: string[];
};

/**
 * The only mutable source fields an executing step may observe. Definition
 * behavior such as instructions, checks, output schemas, repository, and
 * budgets is deliberately absent so a caller cannot accidentally re-read it.
 */
export type AgentLoopLiveSourceProjection = {
  id: string;
  userId: string;
  status: AgentLoop["status"];
  stepPolicy: AgentLoopLiveStepPolicy | null;
};

/** Pure projection used only as a current capability ceiling. */
export function projectAgentLoopLiveSource(
  loop: AgentLoop | null,
  nodeId: string,
): AgentLoopLiveSourceProjection | null {
  if (!loop) return null;
  const parsed = loopDefinitionSchema.safeParse(loop.definition);
  const node = parsed.success
    ? parsed.data.nodes.find((candidate) => candidate.id === nodeId)
    : null;
  const agentNode = node?.kind === "agent_step" ? node : null;
  const nodePermissions = agentNode?.permissions;
  const permissions =
    nodePermissions && Object.keys(nodePermissions.github ?? {}).length > 0
      ? nodePermissions
      : loop.permissions;

  return {
    id: loop.id,
    userId: loop.userId,
    status: loop.status,
    stepPolicy: agentNode
      ? {
          permissions,
          builtinToolNames: agentNode.builtinToolNames ?? null,
          composioToolkitSlugs: agentNode.composioToolkitSlugs ?? [],
        }
      : null,
  };
}

/**
 * Thin loop-specific adapter around the shared strict V1 builder. It accepts
 * only accepted Run/step state plus the live default branch needed for a
 * checkout, and performs no I/O.
 */
export function buildAgentLoopNormalizedStepInput(input: {
  resolvedDefinition: ResolvedAgentLoopExecutionDefinition;
  loopRun: AgentLoopRun;
  stepRun: AgentLoopStepRun;
  workflowRunId: string;
  defaultBranch: string | null;
}): NormalizedLoopStepInput {
  const context = input.loopRun.context ?? {};
  const checkout = resolveWorkingBranchIntent(
    context,
    input.stepRun.nodeId,
    input.defaultBranch ?? "",
  );
  const rawStepInput = (input.stepRun.stepInput ?? {}) as Record<
    string,
    unknown
  >;
  const watchdogHint =
    typeof rawStepInput["watchdogHint"] === "string"
      ? rawStepInput["watchdogHint"]
      : null;

  return buildNormalizedLoopStepInput({
    resolvedDefinition: input.resolvedDefinition,
    identity: {
      runId: input.loopRun.id,
      userId: input.loopRun.userId,
      stepRunId: input.stepRun.id,
      nodeId: input.stepRun.nodeId,
      attempt: input.stepRun.attempt,
      requestId: input.loopRun.requestId,
      workflowRunId: input.workflowRunId,
    },
    repositoryIntent: {
      ref: null,
      sha: null,
      branch: checkout.ref,
      defaultBranch: input.defaultBranch,
    },
    promptContext: context,
    watchdogHint,
    workspace: {
      sandboxName: `agent_loop_${input.stepRun.id}`,
      initialCheckout: checkout,
    },
  });
}
