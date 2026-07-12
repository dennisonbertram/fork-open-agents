import { describe, expect, test } from "bun:test";
import type {
  AgentLoop,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";
import {
  buildAgentLoopExecutionSnapshot,
  hashAgentLoopExecutionSnapshot,
} from "./execution-snapshot";
import {
  buildAgentLoopNormalizedStepInput,
  projectAgentLoopLiveSource,
} from "./normalized-step-input";

const node = {
  id: "work",
  kind: "agent_step" as const,
  label: "Work",
  position: { x: 0, y: 0 },
  instructions: "Frozen instructions",
  permissions: { github: { issues: "write" as const } },
  builtinToolNames: ["bash"],
  composioToolkitSlugs: ["linear"],
};

function makeLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  const now = new Date("2026-07-12T00:00:00.000Z");
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Loop",
    description: null,
    repoOwner: "frozen-owner",
    repoName: "frozen-repo",
    definition: { nodes: [node], edges: [] },
    status: "active",
    guardrails: null,
    permissions: { github: { contents: "write" } },
    watchdogEnabled: true,
    watchdogInstructions: "Retry carefully",
    watchdogRetryBudget: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRun(loop: AgentLoop): AgentLoopRun {
  const snapshot = buildAgentLoopExecutionSnapshot(loop);
  const now = new Date("2026-07-12T00:01:00.000Z");
  return {
    id: "run-1",
    loopId: loop.id,
    userId: loop.userId,
    status: "running",
    definitionSnapshot: snapshot.definition,
    executionSnapshot: snapshot,
    definitionVersion: 1,
    definitionHash: hashAgentLoopExecutionSnapshot(snapshot),
    currentNodeId: node.id,
    currentStepRunId: "step-1",
    iterationCount: 0,
    stepCount: 1,
    context: { prior: { branch: "feat/frozen" } },
    source: "manual",
    triggerId: null,
    idempotencyKey: "manual:1",
    errorKind: null,
    errorMessage: null,
    workflowRunId: "workflow-1",
    requestId: "request-1",
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeStep(): AgentLoopStepRun {
  const now = new Date("2026-07-12T00:02:00.000Z");
  return {
    id: "step-1",
    loopRunId: "run-1",
    nodeId: node.id,
    nodeKind: node.kind,
    attempt: 2,
    status: "queued",
    stepInput: { watchdogHint: "Use the smaller fix" },
    stepOutput: null,
    sandboxName: null,
    workflowRunId: null,
    errorKind: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    createdAt: now,
  };
}

describe("loop normalized step adapter", () => {
  test("projects only mutable capability ceilings from the live source", () => {
    const live = makeLoop({
      repoOwner: "edited-owner",
      repoName: "edited-repo",
      definition: {
        nodes: [
          {
            ...node,
            instructions: "Live instructions must not escape",
            permissions: { github: { issues: "read" } },
            builtinToolNames: [],
            composioToolkitSlugs: [],
          },
        ],
        edges: [],
      },
    });

    const projection = projectAgentLoopLiveSource(live, node.id);

    expect(projection).toEqual({
      id: live.id,
      userId: live.userId,
      status: "active",
      stepPolicy: {
        permissions: { github: { issues: "read" } },
        builtinToolNames: [],
        composioToolkitSlugs: [],
      },
    });
    expect(projection).not.toHaveProperty("repoOwner");
    expect(projection).not.toHaveProperty("definition");
  });

  test("builds retry identity and checkout from frozen Run state", () => {
    const accepted = makeLoop();
    const run = makeRun(accepted);
    const snapshot = run.executionSnapshot!;

    const input = buildAgentLoopNormalizedStepInput({
      resolvedDefinition: {
        definition: snapshot,
        snapshotSource: "frozen",
        definitionVersion: 1,
        definitionHash: run.definitionHash,
      },
      loopRun: run,
      stepRun: makeStep(),
      workflowRunId: "workflow-retry",
      defaultBranch: "main",
    });

    expect(input.identity).toMatchObject({
      runId: run.id,
      stepRunId: "step-1",
      nodeId: node.id,
      attempt: 2,
      workflowRunId: "workflow-retry",
    });
    expect(input.provenance.definitionHash).toBe(run.definitionHash);
    expect(input.workspace).toMatchObject({
      policy: "disposable_step",
      initialCheckout: { ref: "feat/frozen", source: "context_branch" },
      persistent: false,
      resume: false,
    });
    expect(input.prompt.watchdogHint).toBe("Use the smaller fix");
  });
});
