/**
 * #945 RED decision harness.
 *
 * The original RED fixture modeled the smallest tempting physical merge: one
 * untagged common-column map per entity and triggers with only `targetId`.
 * These tests now exercise the accepted no-go decision: retain both source
 * models and specify the tagged, lossless invariants a future migration would
 * have to satisfy. This file performs no database I/O or migration.
 */
import { describe, expect, test } from "bun:test";
import {
  decodeSourceQualifiedStorage,
  detectSourceLocalIdCollisions,
  encodeSourceQualifiedStorage,
  hasExactlyOneLegacyTriggerTarget,
  modelCanonicalAndLegacyRollbackRead,
  simulateDefinitionRemovalPreservingFixtureHistory,
  tagLegacyAutomationTrigger,
  type StorageDecisionFixtures,
} from "./storage-decision";

const backgroundDefinition = {
  source: "background_agent" as const,
  id: "background-definition-1",
  userId: "user-1",
  name: "Review pull requests",
  description: "Review selected PRs",
  status: "enabled",
  repoOwner: "acme",
  repoName: "widgets",
  instructions: "Review the pull request and leave a comment.",
  permissions: { github: { pullRequests: "write" } },
  checkCommand: "bun test",
  composioToolkitSlugs: ["linear"],
  builtinToolNames: ["read", "bash"],
  githubActions: {
    open_pull_request: false,
    comment_on_pr_or_issue: true,
    approve_pull_request: false,
    request_changes: true,
    merge_pull_request: false,
    push: false,
    delete_branch: false,
  },
  writeScope: { mode: "this_repo" },
  requireCiGreenForMerge: true,
  runBudgetPerTarget: 10,
  modelId: "anthropic/claude-haiku-4.5",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:01:00.000Z",
};

const loopDefinition = {
  source: "agent_loop" as const,
  id: "loop-definition-1",
  userId: "user-1",
  name: "Implement then review",
  description: "Two step workflow",
  status: "active",
  repoOwner: "acme",
  repoName: "widgets",
  definition: {
    nodes: [
      {
        id: "implement",
        kind: "agent_step",
        label: "Implement",
        position: { x: 0, y: 0 },
        instructions: "Implement the issue.",
        outputSchema: { required: ["branch"] },
        checkCommand: "bun test",
        permissions: { github: { issues: "write" } },
        composioToolkitSlugs: ["linear"],
        builtinToolNames: ["bash"],
      },
      {
        id: "end",
        kind: "end",
        label: "Done",
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: "implement-to-end",
        source: "implement",
        target: "end",
        when: "success",
      },
    ],
  },
  guardrails: {
    maxStepsPerRun: 20,
    maxIterations: 3,
    stepTimeoutMs: 600_000,
    maxAgentTurnsPerStep: 8,
  },
  permissions: { github: { contents: "write" } },
  watchdogEnabled: true,
  watchdogInstructions: "Retry only when progress is possible.",
  watchdogRetryBudget: 2,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:01:00.000Z",
};

const backgroundRun = {
  source: "background_agent" as const,
  id: "background-run-1",
  definitionId: backgroundDefinition.id,
  triggerId: "background-trigger-1",
  userId: "user-1",
  status: "succeeded",
  triggerSource: "github",
  triggerKind: "github.pull_request",
  externalId: "pr:42:opened",
  idempotencyKey: "background:42",
  repoOwner: "acme",
  repoName: "widgets",
  ref: "refs/pull/42/head",
  sha: "abc123",
  branch: "feature/widgets",
  prNumber: 42,
  issueNumber: null,
  deploymentUrl: null,
  sandboxName: "background_agent_background-run-1",
  outputUrl: "https://github.com/acme/widgets/pull/42#issuecomment-1",
  payloadSummary: { title: "Fix widgets", actor: "mona" },
  resultSummary: { headline: "Review posted", warnings: [] },
  executionSnapshot: {
    snapshotVersion: 1,
    source: { definitionId: backgroundDefinition.id },
  },
  definitionVersion: 1,
  definitionHash: "a".repeat(64),
  requestId: "request-background-1",
  workflowRunId: "workflow-background-1",
  startedAt: "2026-07-12T00:02:00.000Z",
  finishedAt: "2026-07-12T00:03:00.000Z",
};

const loopRun = {
  source: "agent_loop" as const,
  id: "loop-run-1",
  definitionId: loopDefinition.id,
  triggerId: "loop-trigger-1",
  userId: "user-1",
  status: "completed",
  definitionSnapshot: loopDefinition.definition,
  executionSnapshot: {
    snapshotVersion: 1,
    source: { definitionId: loopDefinition.id },
  },
  definitionVersion: 1,
  definitionHash: "b".repeat(64),
  currentNodeId: "end",
  currentStepRunId: "loop-step-2",
  iterationCount: 1,
  stepCount: 2,
  context: {
    trigger: { eventKind: "github.issue", issueNumber: 7 },
    implement: { branch: "agent/issue-7", commitSha: "def456" },
  },
  triggerSource: "github",
  idempotencyKey: "loop:7",
  requestId: "request-loop-1",
  workflowRunId: "workflow-loop-step-2",
  startedAt: "2026-07-12T00:02:00.000Z",
  finishedAt: "2026-07-12T00:04:00.000Z",
};

const backgroundEvent = {
  source: "background_agent" as const,
  id: "background-event-1",
  runId: backgroundRun.id,
  definitionId: backgroundDefinition.id,
  eventName: "background-agent.run.completed",
  status: "succeeded",
  level: "info",
  summary: "Background Run completed",
  requestId: backgroundRun.requestId,
  workflowRunId: backgroundRun.workflowRunId,
  sandboxName: backgroundRun.sandboxName,
  errorKind: null,
  payload: { outputUrl: backgroundRun.outputUrl },
  redactionStatus: "passed",
  sequence: 9,
  createdAt: "2026-07-12T00:03:00.000Z",
};

const loopEvent = {
  source: "agent_loop" as const,
  id: "loop-event-1",
  runId: loopRun.id,
  stepRunId: "loop-step-1",
  nodeId: "implement",
  eventName: "agent-loop.step.completed",
  status: "succeeded",
  level: "info",
  summary: "Step completed",
  requestId: loopRun.requestId,
  workflowRunId: "workflow-loop-step-1",
  payload: { attempt: 1, nodeKind: "agent_step" },
  redactionStatus: "passed",
  createdAt: "2026-07-12T00:03:00.000Z",
};

const backgroundOutput = {
  id: "background-output-1",
  runId: backgroundRun.id,
  kind: "pr_comment",
  status: "created",
  url: backgroundRun.outputUrl,
  prNumber: 42,
  payload: { review: "changes_requested" },
};

const loopStep = {
  id: "loop-step-1",
  runId: loopRun.id,
  nodeId: "implement",
  nodeKind: "agent_step",
  attempt: 1,
  status: "succeeded",
  stepInput: { watchdogHint: "Try a smaller change." },
  stepOutput: { branch: "agent/issue-7", commitSha: "def456" },
  sandboxName: "agent_loop_loop-step-1",
  workflowRunId: "workflow-loop-step-1",
  durationMs: 42_000,
};

const watchdogRun = {
  id: "watchdog-1",
  runId: loopRun.id,
  stepRunId: loopStep.id,
  nodeId: loopStep.nodeId,
  status: "decided",
  decision: "retry",
  diagnosis: "The first attempt changed no files.",
  decisionPayload: { hint: "Try a smaller change." },
  attempt: 1,
  budgetRemaining: 2,
};

const triggers = [
  {
    id: "background-trigger-1",
    agentId: backgroundDefinition.id,
    loopId: null,
    kind: "github.pull_request",
  },
  {
    id: "loop-trigger-1",
    agentId: null,
    loopId: loopDefinition.id,
    kind: "github.issue",
  },
];

const fixtures: StorageDecisionFixtures = {
  definitions: [backgroundDefinition, loopDefinition],
  runs: [backgroundRun, loopRun],
  events: [backgroundEvent, loopEvent],
  outputs: [backgroundOutput],
  steps: [loopStep],
  watchdogRuns: [watchdogRun],
  triggers,
};

describe("#945 canonical storage decision safety harness", () => {
  test("marks the executable envelope as research-only, not a production migration contract", () => {
    expect(encodeSourceQualifiedStorage(fixtures)).toMatchObject({
      decisionScope: "research_only",
    });
  });

  test("representative definitions round-trip with every source-specific field", () => {
    const decoded = decodeSourceQualifiedStorage(
      encodeSourceQualifiedStorage(fixtures),
    );
    expect(decoded.definitions).toEqual(fixtures.definitions);
  });

  test("Runs, ordered events, outputs, steps, and watchdog evidence round-trip losslessly", () => {
    const decoded = decodeSourceQualifiedStorage(
      encodeSourceQualifiedStorage(fixtures),
    );
    expect(decoded.runs).toEqual(fixtures.runs);
    expect(decoded.events).toEqual(fixtures.events);
    expect(decoded.outputs).toEqual(fixtures.outputs);
    expect(decoded.steps).toEqual(fixtures.steps);
    expect(decoded.watchdogRuns).toEqual(fixtures.watchdogRuns);
  });

  test("source-local ID collisions are detected before an untagged map can overwrite rows", () => {
    const colliding: StorageDecisionFixtures = {
      ...fixtures,
      definitions: [
        { ...backgroundDefinition, id: "definition-collision" },
        { ...loopDefinition, id: "definition-collision" },
      ],
      runs: [
        { ...backgroundRun, id: "run-collision" },
        { ...loopRun, id: "run-collision" },
      ],
      events: [
        { ...backgroundEvent, id: "event-collision" },
        { ...loopEvent, id: "event-collision" },
      ],
    };
    expect(detectSourceLocalIdCollisions(colliding)).toEqual([
      {
        namespace: "definition",
        id: "definition-collision",
        sources: ["agent_loop", "background_agent"],
      },
      {
        namespace: "run",
        id: "run-collision",
        sources: ["agent_loop", "background_agent"],
      },
      {
        namespace: "event",
        id: "event-collision",
        sources: ["agent_loop", "background_agent"],
      },
    ]);
    const encoded = encodeSourceQualifiedStorage(colliding);
    expect(encoded.definitions.size).toBe(2);
    expect(encoded.runs.size).toBe(2);
    expect(encoded.events.size).toBe(2);
  });

  test("trigger migration preserves exactly one tagged target, not only an ambiguous targetId", () => {
    expect(triggers.every(hasExactlyOneLegacyTriggerTarget)).toBe(true);
    const decoded = decodeSourceQualifiedStorage(
      encodeSourceQualifiedStorage(fixtures),
    );
    expect(decoded.triggers).toEqual([
      {
        id: "background-trigger-1",
        target: {
          source: "background_agent",
          definitionId: backgroundDefinition.id,
        },
        kind: "github.pull_request",
      },
      {
        id: "loop-trigger-1",
        target: {
          source: "agent_loop",
          definitionId: loopDefinition.id,
        },
        kind: "github.issue",
      },
    ]);
    expect(
      hasExactlyOneLegacyTriggerTarget({ agentId: null, loopId: null }),
    ).toBe(false);
    expect(
      hasExactlyOneLegacyTriggerTarget({
        agentId: backgroundDefinition.id,
        loopId: loopDefinition.id,
      }),
    ).toBe(false);
  });

  test("trigger tagging rejects malformed, empty, both, and missing targets", () => {
    const invalidTargets: Array<{ agentId: unknown; loopId: unknown }> = [
      { agentId: undefined, loopId: null },
      { agentId: null, loopId: undefined },
      { agentId: undefined, loopId: undefined },
      { agentId: 42, loopId: null },
      { agentId: null, loopId: 42 },
      { agentId: {}, loopId: null },
      { agentId: null, loopId: {} },
      { agentId: "", loopId: null },
      { agentId: "   ", loopId: null },
      { agentId: null, loopId: "" },
      { agentId: null, loopId: " \n " },
      { agentId: null, loopId: null },
      {
        agentId: backgroundDefinition.id,
        loopId: loopDefinition.id,
      },
    ];

    for (const target of invalidTargets) {
      expect(hasExactlyOneLegacyTriggerTarget(target)).toBe(false);
      expect(() =>
        tagLegacyAutomationTrigger({
          id: "invalid-trigger",
          kind: "github.issue",
          ...target,
        }),
      ).toThrow("must target exactly one source");
    }
  });

  test("fixture definition removal preserves retained Run history and source evidence", () => {
    const envelope = encodeSourceQualifiedStorage(fixtures);
    simulateDefinitionRemovalPreservingFixtureHistory(
      envelope,
      backgroundDefinition,
    );
    simulateDefinitionRemovalPreservingFixtureHistory(envelope, loopDefinition);
    expect(envelope.definitions.size).toBe(0);
    expect([...envelope.runs.values()]).toEqual([backgroundRun, loopRun]);
    expect(envelope.evidence).toEqual({
      backgroundAgentOutputs: [backgroundOutput],
      agentLoopSteps: [loopStep],
      agentLoopWatchdogRuns: [watchdogRun],
    });
  });

  test("rollback dual reads preserve canonical and legacy rows with colliding local IDs", () => {
    const canonical = [
      {
        source: "background_agent" as const,
        id: "shared-run-id",
        migratedFrom: backgroundRun.id,
      },
    ];
    const legacy = [
      {
        source: "background_agent" as const,
        id: "shared-run-id",
        legacy: true,
      },
      {
        source: "agent_loop" as const,
        id: "shared-run-id",
        legacy: true,
      },
    ];
    const rows = modelCanonicalAndLegacyRollbackRead({ canonical, legacy });
    expect(rows.map(({ row }) => row)).toEqual([
      canonical[0],
      legacy[0],
      legacy[1],
    ]);
    expect(rows[0]?.sourceQualifiedId).toBe(rows[1]?.sourceQualifiedId);
    expect(rows[0]?.sourceQualifiedId).not.toBe(rows[2]?.sourceQualifiedId);
    expect(rows.map(({ storage }) => storage)).toEqual([
      "canonical",
      "legacy",
      "legacy",
    ]);
  });
});
