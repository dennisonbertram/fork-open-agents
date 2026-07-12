/**
 * #945 RED decision harness.
 *
 * This deliberately models the smallest tempting physical merge: one
 * untagged definition map, one untagged Run map, one untagged event list, and
 * triggers with only `targetId`. The failing assertions are the migration
 * no-go conditions. A future GREEN design must introduce a tagged union and
 * source-specific side tables (or decide to retain the two storage models).
 * This file performs no database I/O or migration.
 */
import { describe, expect, test } from "bun:test";

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

type SourceFixtures = {
  definitions: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  outputs: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
  watchdogRuns: Array<Record<string, unknown>>;
  triggers: Array<Record<string, unknown>>;
};

const fixtures: SourceFixtures = {
  definitions: [backgroundDefinition, loopDefinition],
  runs: [backgroundRun, loopRun],
  events: [backgroundEvent, loopEvent],
  outputs: [backgroundOutput],
  steps: [loopStep],
  watchdogRuns: [watchdogRun],
  triggers,
};

/** The intentionally insufficient untagged/common-column candidate. */
type UntaggedCanonicalEnvelopeV0 = {
  definitions: Map<string, Record<string, unknown>>;
  runs: Map<string, Record<string, unknown>>;
  events: Map<string, Record<string, unknown>>;
  triggers: Map<string, { id: string; targetId: string; kind: unknown }>;
};

function pick(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.filter((key) => key in value).map((key) => [key, value[key]]),
  );
}

function encodeUntaggedV0(input: SourceFixtures): UntaggedCanonicalEnvelopeV0 {
  return {
    definitions: new Map(
      input.definitions.map((definition) => [
        String(definition.id),
        pick(definition, [
          "id",
          "userId",
          "name",
          "description",
          "status",
          "repoOwner",
          "repoName",
          "createdAt",
          "updatedAt",
        ]),
      ]),
    ),
    runs: new Map(
      input.runs.map((run) => [
        String(run.id),
        pick(run, [
          "id",
          "definitionId",
          "triggerId",
          "userId",
          "status",
          "idempotencyKey",
          "executionSnapshot",
          "definitionVersion",
          "definitionHash",
          "requestId",
          "workflowRunId",
          "startedAt",
          "finishedAt",
        ]),
      ]),
    ),
    events: new Map(
      input.events.map((event) => [
        String(event.id),
        pick(event, [
          "id",
          "runId",
          "eventName",
          "status",
          "level",
          "summary",
          "payload",
          "redactionStatus",
          "requestId",
          "workflowRunId",
          "createdAt",
        ]),
      ]),
    ),
    triggers: new Map(
      input.triggers.map((trigger) => [
        String(trigger.id),
        {
          id: String(trigger.id),
          targetId: String(trigger.agentId ?? trigger.loopId),
          kind: trigger.kind,
        },
      ]),
    ),
  };
}

function decodeUntaggedV0(
  envelope: UntaggedCanonicalEnvelopeV0,
): SourceFixtures {
  const definitions = [...envelope.definitions.values()];
  const runs = [...envelope.runs.values()];
  const events = [...envelope.events.values()];
  return {
    definitions,
    runs,
    events,
    outputs: [],
    steps: [],
    watchdogRuns: [],
    triggers: [...envelope.triggers.values()],
  };
}

function detectIdCollisions(_input: SourceFixtures): Array<{
  namespace: string;
  id: string;
  sources: string[];
}> {
  // V0 has no source tag or collision ledger, so overwrites are silent.
  return [];
}

function deleteDefinitionV0(
  envelope: UntaggedCanonicalEnvelopeV0,
  definitionId: string,
): void {
  envelope.definitions.delete(definitionId);
  for (const [runId, run] of envelope.runs) {
    if (run.definitionId === definitionId) envelope.runs.delete(runId);
  }
}

function readCanonicalThenLegacyV0(params: {
  canonical: Array<Record<string, unknown>>;
  legacy: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  // An untagged id is incorrectly treated as the global identity.
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of params.legacy) byId.set(String(row.id), row);
  for (const row of params.canonical) byId.set(String(row.id), row);
  return [...byId.values()];
}

function hasExactlyOneLegacyTriggerTarget(trigger: {
  agentId: unknown;
  loopId: unknown;
}): boolean {
  return (
    Number(trigger.agentId !== null) + Number(trigger.loopId !== null) === 1
  );
}

describe("#945 canonical storage decision RED harness", () => {
  test("representative definitions round-trip with every source-specific field", () => {
    const decoded = decodeUntaggedV0(encodeUntaggedV0(fixtures));
    expect(decoded.definitions).toEqual(fixtures.definitions);
  });

  test("Runs, ordered events, outputs, steps, and watchdog evidence round-trip losslessly", () => {
    const decoded = decodeUntaggedV0(encodeUntaggedV0(fixtures));
    expect(decoded.runs).toEqual(fixtures.runs);
    expect(decoded.events).toEqual(fixtures.events);
    expect(decoded.outputs).toEqual(fixtures.outputs);
    expect(decoded.steps).toEqual(fixtures.steps);
    expect(decoded.watchdogRuns).toEqual(fixtures.watchdogRuns);
  });

  test("source-local ID collisions are detected before an untagged map can overwrite rows", () => {
    const colliding: SourceFixtures = {
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
    expect(detectIdCollisions(colliding)).toEqual([
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
  });

  test("trigger migration preserves exactly one tagged target, not only an ambiguous targetId", () => {
    expect(triggers.every(hasExactlyOneLegacyTriggerTarget)).toBe(true);
    const decoded = decodeUntaggedV0(encodeUntaggedV0(fixtures));
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

  test("definition deletion preserves retained Run history and source evidence", () => {
    const envelope = encodeUntaggedV0(fixtures);
    deleteDefinitionV0(envelope, backgroundDefinition.id);
    deleteDefinitionV0(envelope, loopDefinition.id);
    expect(envelope.definitions.size).toBe(0);
    expect([...envelope.runs.keys()].sort()).toEqual([
      backgroundRun.id,
      loopRun.id,
    ]);
  });

  test("rollback dual reads preserve canonical and legacy rows with colliding local IDs", () => {
    const canonical = [
      {
        source: "background_agent",
        id: "shared-run-id",
        migratedFrom: backgroundRun.id,
      },
    ];
    const legacy = [
      { source: "background_agent", id: "shared-run-id", legacy: true },
      { source: "agent_loop", id: "shared-run-id", legacy: true },
    ];
    expect(readCanonicalThenLegacyV0({ canonical, legacy })).toEqual([
      canonical[0],
      legacy[0],
      legacy[1],
    ]);
  });
});
