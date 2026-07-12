import { describe, expect, test } from "bun:test";
import type { BackgroundAgent, BackgroundAgentRun } from "@/lib/db/schema";
import {
  buildBackgroundAgentExecutionSnapshot,
  hashBackgroundAgentExecutionSnapshot,
} from "./execution-snapshot";
import {
  getBackgroundAgentSnapshotSource,
  toSafeBackgroundAgentEvidence,
} from "./public-run";

function buildAgent(overrides: Partial<BackgroundAgent> = {}): BackgroundAgent {
  const now = new Date("2026-07-11T12:00:00.000Z");
  return {
    id: "agent-1",
    userId: "user-1",
    name: "Live mutable name",
    description: null,
    status: "enabled",
    repoOwner: "acme",
    repoName: "widgets",
    instructions: "Review the pull request.",
    permissions: { github: { contents: "read" } },
    checkCommand: "bun --bun run ci",
    composioToolkitSlugs: [],
    builtinToolNames: null,
    githubActions: {},
    runBudgetPerTarget: 10,
    writeScope: { mode: "this_repo" },
    requireCiGreenForMerge: true,
    modelId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildRun(overrides: Partial<BackgroundAgentRun> = {}): BackgroundAgentRun {
  const now = new Date("2026-07-11T12:00:00.000Z");
  return {
    id: "run-1",
    agentId: "agent-1",
    triggerId: null,
    userId: "user-1",
    status: "queued",
    source: "github",
    triggerKind: "github.pull_request",
    externalId: "delivery-1",
    idempotencyKey: "agent-1:delivery-1",
    repoOwner: "acme",
    repoName: "widgets",
    ref: null,
    sha: null,
    branch: null,
    prNumber: 42,
    issueNumber: null,
    deploymentUrl: null,
    sandboxName: null,
    outputUrl: null,
    errorKind: null,
    errorMessage: null,
    payloadSummary: {},
    requestId: "request-1",
    workflowRunId: null,
    startedAt: null,
    finishedAt: null,
    resultSummary: null,
    executionSnapshot: null,
    definitionVersion: null,
    definitionHash: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildFrozenRun(agent = buildAgent()): BackgroundAgentRun {
  const executionSnapshot = buildBackgroundAgentExecutionSnapshot(agent);
  return buildRun({
    executionSnapshot,
    definitionVersion: 1,
    definitionHash: hashBackgroundAgentExecutionSnapshot(executionSnapshot),
  });
}

describe("background agent public snapshot provenance", () => {
  test("reports frozen only when the versioned snapshot hash verifies", () => {
    expect(getBackgroundAgentSnapshotSource(buildFrozenRun())).toBe("frozen");
  });

  test("reports tampered hashes, unsupported versions, malformed tuples, and malformed bodies as invalid", () => {
    const frozenRun = buildFrozenRun();

    expect(
      getBackgroundAgentSnapshotSource({
        ...frozenRun,
        definitionHash: "0".repeat(64),
      }),
    ).toBe("invalid");
    expect(
      getBackgroundAgentSnapshotSource({
        ...frozenRun,
        definitionVersion: 2,
      }),
    ).toBe("invalid");
    expect(
      getBackgroundAgentSnapshotSource({
        ...frozenRun,
        definitionHash: null,
      }),
    ).toBe("invalid");
    expect(
      getBackgroundAgentSnapshotSource({
        ...frozenRun,
        executionSnapshot: { snapshotVersion: 1, instructions: "private" },
      }),
    ).toBe("invalid");
  });

  test("rejects a correctly hashed snapshot bound to another source identity", () => {
    const otherAgent = buildAgent({ id: "agent-other" });
    const executionSnapshot = buildBackgroundAgentExecutionSnapshot(otherAgent);
    const run = buildRun({
      executionSnapshot,
      definitionVersion: 1,
      definitionHash: hashBackgroundAgentExecutionSnapshot(executionSnapshot),
    });

    expect(getBackgroundAgentSnapshotSource(run)).toBe("invalid");
    expect(toSafeBackgroundAgentEvidence(run, buildAgent())).toBeNull();
  });

  test("does not expose snapshot or mutable live evidence for invalid frozen provenance", () => {
    const liveAgent = buildAgent();
    const frozenRun = buildFrozenRun(
      buildAgent({ name: "Accepted frozen name" }),
    );

    expect(
      toSafeBackgroundAgentEvidence(
        { ...frozenRun, definitionHash: "0".repeat(64) },
        liveAgent,
      ),
    ).toBeNull();
    expect(
      toSafeBackgroundAgentEvidence(
        { ...frozenRun, definitionVersion: 2 },
        liveAgent,
      ),
    ).toBeNull();
    expect(
      toSafeBackgroundAgentEvidence(
        { ...frozenRun, definitionHash: null },
        liveAgent,
      ),
    ).toBeNull();
    expect(
      toSafeBackgroundAgentEvidence(
        {
          ...frozenRun,
          executionSnapshot: {
            snapshotVersion: 1,
            source: { name: "Unverified attacker-controlled name" },
          },
        },
        liveAgent,
      ),
    ).toBeNull();
  });

  test("preserves the all-null legacy live fallback", () => {
    const liveAgent = buildAgent();

    expect(getBackgroundAgentSnapshotSource(buildRun())).toBe(
      "legacy_live_fallback",
    );
    expect(toSafeBackgroundAgentEvidence(buildRun(), liveAgent)).toEqual({
      id: "agent-1",
      name: "Live mutable name",
      permissions: { github: { contents: "read" } },
      checkCommand: "bun --bun run ci",
      sourceDeleted: false,
    });
  });
});
