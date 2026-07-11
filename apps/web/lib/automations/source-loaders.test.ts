import { describe, expect, mock, test } from "bun:test";
import type {
  BackgroundSourceLoaderDependencies,
  LoopSourceLoaderDependencies,
} from "./source-loaders";

mock.module("server-only", () => ({}));

const sourceLoadersPromise = import("./source-loaders");

async function loadBackgroundAutomationSource(
  ...args: Parameters<
    (typeof import("./source-loaders"))["loadBackgroundAutomationSource"]
  >
) {
  const sourceLoaders = await sourceLoadersPromise;
  return sourceLoaders.loadBackgroundAutomationSource(...args);
}

async function loadLoopAutomationSource(
  ...args: Parameters<
    (typeof import("./source-loaders"))["loadLoopAutomationSource"]
  >
) {
  const sourceLoaders = await sourceLoadersPromise;
  return sourceLoaders.loadLoopAutomationSource(...args);
}

function backgroundAgent(id: string) {
  return {
    id,
    userId: "owner-1",
    name: id,
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Review",
    checkCommand: null,
    permissions: {},
    composioToolkitSlugs: [],
    builtinToolNames: null,
    githubActions: {},
    writeScope: { mode: "this_repo" },
    requireCiGreenForMerge: true,
    runBudgetPerTarget: 10,
    modelId: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    triggers: [],
  };
}

function backgroundRun(id: string, agentId: string, userId: string) {
  return {
    id,
    agentId,
    triggerId: null,
    userId,
    status: "succeeded",
    source: "github",
    triggerKind: "github.pull_request",
    externalId: id,
    idempotencyKey: id,
    repoOwner: "acme",
    repoName: "widgets",
    ref: null,
    sha: null,
    branch: "main",
    prNumber: 1,
    issueNumber: null,
    deploymentUrl: null,
    sandboxName: null,
    outputUrl: null,
    errorKind: null,
    errorMessage: null,
    payloadSummary: {},
    resultSummary: null,
    requestId: null,
    workflowRunId: null,
    startedAt: new Date("2026-07-10T00:00:00.000Z"),
    finishedAt: new Date("2026-07-10T00:01:00.000Z"),
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
    updatedAt: new Date("2026-07-10T00:01:00.000Z"),
  };
}

function loop(id: string) {
  return {
    id,
    userId: "owner-1",
    name: id,
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: {
      nodes: [
        {
          id: "start",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        { id: "end", kind: "end", label: "End", position: { x: 1, y: 0 } },
      ],
      edges: [],
    },
    status: "active",
    guardrails: null,
    permissions: {},
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-10T00:00:00.000Z"),
  };
}

function loopRun(id: string, loopId: string, userId: string) {
  return {
    id,
    loopId,
    userId,
    status: "completed",
    definitionSnapshot: {},
    currentNodeId: null,
    currentStepRunId: null,
    iterationCount: 0,
    stepCount: 0,
    context: {},
    source: "manual",
    triggerId: null,
    idempotencyKey: id,
    errorKind: null,
    errorMessage: null,
    workflowRunId: null,
    requestId: null,
    startedAt: new Date("2026-07-10T00:00:00.000Z"),
    finishedAt: new Date("2026-07-10T00:01:00.000Z"),
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
    updatedAt: new Date("2026-07-10T00:01:00.000Z"),
  };
}

describe("Automation source loaders", () => {
  test("batches background latest runs by raw agentId and rejects cross-owner rows", async () => {
    const listAgents = mock(async () => [
      backgroundAgent("agent-1"),
      backgroundAgent("agent-2"),
    ]);
    const listLatestRuns = mock(async () => [
      backgroundRun("owned-run", "agent-1", "owner-1"),
      backgroundRun("foreign-run", "agent-2", "other-user"),
    ]);
    const dependencies = {
      listAgents,
      listLatestRuns,
    } as unknown as BackgroundSourceLoaderDependencies;

    const result = await loadBackgroundAutomationSource(
      "owner-1",
      dependencies,
    );

    expect(listAgents).toHaveBeenCalledWith("owner-1");
    expect(listLatestRuns).toHaveBeenCalledTimes(1);
    expect(listLatestRuns).toHaveBeenCalledWith({
      userId: "owner-1",
      agentIds: ["agent-1", "agent-2"],
    });
    expect(
      result.items.map((item) => item.latestRun?.sourceId ?? null),
    ).toEqual(["owned-run", null]);
  });

  test("batches loop triggers/latest runs by loopId and rejects cross-owner rows", async () => {
    const listLoops = mock(async () => [loop("loop-1"), loop("loop-2")]);
    const listTriggers = mock(async () => [
      {
        id: "loop-trigger-1",
        loopId: "loop-2",
        userId: "owner-1",
        kind: "github.issue",
        status: "enabled",
        conditions: {},
        schedule: null,
        nextRunAt: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ]);
    const listLatestRuns = mock(async () => [
      loopRun("foreign-loop-run", "loop-1", "other-user"),
      {
        ...loopRun("owned-loop-run", "loop-2", "owner-1"),
        source: "github",
        triggerId: "loop-trigger-1",
        requestId: "loop-request-1",
        workflowRunId: "loop-workflow-1",
      },
    ]);
    const listFailedStepCounts = mock(
      async () => new Map([["owned-loop-run", 0]]),
    );
    const dependencies = {
      listLoops,
      listTriggers,
      listLatestRuns,
      listFailedStepCounts,
    } as unknown as LoopSourceLoaderDependencies;

    const result = await loadLoopAutomationSource("owner-1", dependencies);

    const expectedScope = {
      userId: "owner-1",
      loopIds: ["loop-1", "loop-2"],
    };
    expect(listLoops).toHaveBeenCalledWith("owner-1");
    expect(listTriggers).toHaveBeenCalledTimes(1);
    expect(listTriggers).toHaveBeenCalledWith(expectedScope);
    expect(listLatestRuns).toHaveBeenCalledTimes(1);
    expect(listLatestRuns).toHaveBeenCalledWith(expectedScope);
    expect(listFailedStepCounts).toHaveBeenCalledWith({
      userId: "owner-1",
      runIds: ["owned-loop-run"],
    });
    expect(
      result.items.map((item) => item.latestRun?.sourceId ?? null),
    ).toEqual([null, "owned-loop-run"]);
    expect(result.items[1]?.latestRun).toMatchObject({
      automation: { source: "agent_loop", sourceId: "loop-2" },
      trigger: {
        id: "loop-trigger-1",
        source: "github",
        kind: "github.issue",
      },
      evidence: {
        requestId: "loop-request-1",
        workflowRunId: "loop-workflow-1",
        sandboxName: null,
        outputUrl: null,
      },
    });
  });
});
