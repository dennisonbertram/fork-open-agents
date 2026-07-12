import { describe, expect, test } from "bun:test";
import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";
import {
  buildAgentLoopExecutionSnapshot,
  hashAgentLoopExecutionSnapshot,
} from "./execution-snapshot";
import {
  getAgentLoopSnapshotSource,
  toPublicAgentLoopRun,
  toSafeAgentLoopEvidence,
} from "./public-run";

const now = new Date("2026-07-11T12:00:00.000Z");
const loop = {
  id: "loop-1",
  userId: "user-1",
  name: "Accepted",
  description: null,
  repoOwner: "acme",
  repoName: "widgets",
  definition: { nodes: [], edges: [] },
  status: "active",
  guardrails: null,
  permissions: {},
  watchdogEnabled: true,
  watchdogInstructions: "private guidance",
  watchdogRetryBudget: 2,
  createdAt: now,
  updatedAt: now,
} satisfies AgentLoop;
const snapshot = buildAgentLoopExecutionSnapshot(loop);
const run = {
  id: "run-1",
  loopId: null,
  userId: "user-1",
  status: "completed",
  definitionSnapshot: snapshot.definition,
  executionSnapshot: snapshot,
  definitionVersion: 1,
  definitionHash: hashAgentLoopExecutionSnapshot(snapshot),
  currentNodeId: null,
  currentStepRunId: null,
  iterationCount: 0,
  stepCount: 0,
  context: {},
  source: "manual",
  triggerId: null,
  idempotencyKey: "manual:1",
  errorKind: null,
  errorMessage: null,
  workflowRunId: null,
  requestId: null,
  startedAt: now,
  finishedAt: now,
  createdAt: now,
  updatedAt: now,
} satisfies AgentLoopRun;

describe("public loop run evidence", () => {
  test("omits the private snapshot and exposes safe provenance", () => {
    const publicRun = toPublicAgentLoopRun(run);
    expect(publicRun).not.toHaveProperty("executionSnapshot");
    expect(publicRun.snapshotSource).toBe("frozen");
    expect(publicRun.definitionVersion).toBe(1);
    expect(publicRun.definitionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("retains safe deleted-source name and repository without source action", () => {
    expect(getAgentLoopSnapshotSource(run)).toBe("frozen");
    expect(toSafeAgentLoopEvidence(run, null)).toEqual({
      id: "loop-1",
      name: "Accepted",
      repoOwner: "acme",
      repoName: "widgets",
      guardrails: snapshot.guardrails,
      sourceDeleted: true,
    });
  });

  test("marks corrupt tuples invalid without leaking their body", () => {
    const corrupt = { ...run, definitionHash: "0".repeat(64) };
    expect(getAgentLoopSnapshotSource(corrupt)).toBe("invalid");
    expect(toPublicAgentLoopRun(corrupt)).not.toHaveProperty(
      "executionSnapshot",
    );
    expect(toSafeAgentLoopEvidence(corrupt, null)).toBeNull();
  });
});
