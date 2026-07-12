import { describe, expect, test } from "bun:test";
import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";
import {
  buildAgentLoopExecutionSnapshot,
  hashAgentLoopExecutionSnapshot,
} from "./execution-snapshot";
import {
  getAgentLoopSnapshotSource,
  publicLoopGraphSchema,
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
  definition: {
    nodes: [
      {
        id: "agent",
        kind: "agent_step",
        label: "Private step",
        position: { x: 10, y: 20 },
        instructions: "instructions-canary",
        checkCommand: "check-command-canary",
        permissions: { github: { issues: "write" } },
        composioToolkitSlugs: ["composio-canary"],
        builtinToolNames: ["builtin-canary"],
        outputSchema: { secretOutput: { type: "string" } },
      },
    ],
    edges: [],
  },
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
  context: { trigger: { token: "private-context" } },
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
  test("the public graph runtime contract accepts topology-only agent nodes", () => {
    const publicRun = toPublicAgentLoopRun(run);
    expect(publicLoopGraphSchema.parse(publicRun.definitionSnapshot)).toEqual(
      publicRun.definitionSnapshot,
    );
  });

  test("omits the private snapshot and exposes safe provenance", () => {
    const publicRun = toPublicAgentLoopRun(run);
    expect(publicRun).not.toHaveProperty("executionSnapshot");
    expect(publicRun).not.toHaveProperty("context");
    expect(JSON.stringify(publicRun)).not.toContain("private-context");
    expect(JSON.stringify(publicRun)).not.toContain("private guidance");
    const serialized = JSON.stringify(publicRun);
    for (const canary of [
      "instructions-canary",
      "check-command-canary",
      "issues",
      "composio-canary",
      "builtin-canary",
      "secretOutput",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    expect(publicRun.definitionSnapshot).toEqual({
      nodes: [
        {
          id: "agent",
          kind: "agent_step",
          label: "Private step",
          position: { x: 10, y: 20 },
        },
      ],
      edges: [],
    });
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
      sourceActive: false,
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
