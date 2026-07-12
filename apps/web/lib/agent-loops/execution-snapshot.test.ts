import { describe, expect, test } from "bun:test";
import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";
import { loopDefinitionSchema } from "./types";
import {
  AgentLoopSnapshotError,
  buildAgentLoopExecutionSnapshot,
  hashAgentLoopExecutionSnapshot,
  parseAgentLoopExecutionSnapshot,
  resolveAgentLoopExecutionDefinition,
} from "./execution-snapshot";

const definition = loopDefinitionSchema.parse({
  nodes: [
    {
      id: "start",
      kind: "start",
      label: "Start",
      position: { x: 0, y: 0 },
    },
    {
      id: "agent",
      kind: "agent_step",
      label: "Implement",
      position: { x: 100, y: 0 },
      instructions: "Implement the accepted change",
      permissions: { github: { contents: "write", issues: "write" } },
      composioToolkitSlugs: ["github"],
      builtinToolNames: ["bash"],
    },
    {
      id: "end",
      kind: "end",
      label: "End",
      position: { x: 200, y: 0 },
    },
  ],
  edges: [
    {
      id: "start-agent",
      source: "start",
      target: "agent",
      when: "always",
    },
    {
      id: "agent-end",
      source: "agent",
      target: "end",
      when: "success",
    },
  ],
});

function buildLoop(overrides: Partial<AgentLoop> = {}): AgentLoop {
  const now = new Date("2026-07-11T12:00:00.000Z");
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Accepted automation",
    description: null,
    repoOwner: "Acme",
    repoName: "Widgets",
    definition,
    status: "active",
    guardrails: {
      maxStepsPerRun: 80,
      maxIterations: 4,
      maxRunDurationMs: 3_600_000,
      stepTimeoutMs: 90_000,
      maxAgentTurnsPerStep: 12,
    },
    permissions: { github: { contents: "write", issues: "write" } },
    watchdogEnabled: true,
    watchdogInstructions: "Retry only transient failures",
    watchdogRetryBudget: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildRun(
  loop: AgentLoop,
  overrides: Partial<AgentLoopRun> = {},
): AgentLoopRun {
  const snapshot = buildAgentLoopExecutionSnapshot(loop);
  const now = new Date("2026-07-11T12:05:00.000Z");
  return {
    id: "run-1",
    loopId: loop.id,
    userId: loop.userId,
    status: "queued",
    definitionSnapshot: definition,
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
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("AgentLoopExecutionSnapshotV1", () => {
  test("keeps definitionSnapshot graph-shaped and freezes all loop policy", () => {
    const loop = buildLoop();
    const snapshot = buildAgentLoopExecutionSnapshot(loop);

    expect(loopDefinitionSchema.parse(snapshot.definition)).toEqual(definition);
    expect(snapshot).toEqual({
      snapshotVersion: 1,
      source: {
        definitionId: "loop-1",
        name: "Accepted automation",
        updatedAt: "2026-07-11T12:00:00.000Z",
      },
      repository: { owner: "Acme", name: "Widgets" },
      definition,
      guardrails: {
        maxStepsPerRun: 80,
        maxIterations: 4,
        maxRunDurationMs: 3_600_000,
        stepTimeoutMs: 90_000,
        maxAgentTurnsPerStep: 12,
      },
      permissions: { github: { contents: "write", issues: "write" } },
      watchdog: {
        enabled: true,
        instructions: "Retry only transient failures",
        retryBudget: 3,
      },
    });
  });

  test("hash is canonical and changes for every behavior-affecting field", () => {
    const loop = buildLoop();
    const accepted = buildAgentLoopExecutionSnapshot(loop);
    const reordered = parseAgentLoopExecutionSnapshot(
      JSON.parse(JSON.stringify(accepted)) as unknown,
    );
    expect(hashAgentLoopExecutionSnapshot(reordered)).toBe(
      hashAgentLoopExecutionSnapshot(accepted),
    );

    const variants = [
      buildLoop({ repoName: "edited" }),
      buildLoop({ guardrails: { maxStepsPerRun: 2 } }),
      buildLoop({ permissions: { github: { contents: "read" } } }),
      buildLoop({ watchdogRetryBudget: 1 }),
      buildLoop({ definition: { ...definition, edges: [] } }),
    ];
    for (const variant of variants) {
      expect(
        hashAgentLoopExecutionSnapshot(
          buildAgentLoopExecutionSnapshot(variant),
        ),
      ).not.toBe(hashAgentLoopExecutionSnapshot(accepted));
    }
  });

  test("rejects unknown fields and never snapshots description or user id", () => {
    const snapshot = buildAgentLoopExecutionSnapshot(buildLoop());
    expect(snapshot).not.toHaveProperty("description");
    expect(snapshot.source).not.toHaveProperty("userId");
    expect(() =>
      parseAgentLoopExecutionSnapshot({ ...snapshot, triggerPayload: {} }),
    ).toThrow();
    expect(() =>
      buildAgentLoopExecutionSnapshot(
        buildLoop({
          definition: { ...definition, rawContext: { secret: true } },
        }),
      ),
    ).toThrow();
    expect(() =>
      buildAgentLoopExecutionSnapshot(
        buildLoop({
          definition: {
            ...definition,
            nodes: definition.nodes.map((node, index) =>
              index === 0 ? { ...node, rawPrompt: "secret" } : node,
            ),
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseAgentLoopExecutionSnapshot({
        ...snapshot,
        repository: { ...snapshot.repository, token: "secret" },
      }),
    ).toThrow();
    expect(() =>
      parseAgentLoopExecutionSnapshot({
        ...snapshot,
        watchdog: { ...snapshot.watchdog, providerConfig: {} },
      }),
    ).toThrow();
    expect(() =>
      parseAgentLoopExecutionSnapshot({
        ...snapshot,
        definition: {
          ...snapshot.definition,
          context: { raw: true },
        },
      }),
    ).toThrow();
    expect(() =>
      parseAgentLoopExecutionSnapshot({
        ...snapshot,
        definition: {
          ...snapshot.definition,
          nodes: snapshot.definition.nodes.map((node, index) =>
            index === 0 ? { ...node, rawPrompt: "secret" } : node,
          ),
        },
      }),
    ).toThrow();
  });

  test("freezes embedded guardrails with validated column values winning", () => {
    const loop = buildLoop({
      definition: {
        ...definition,
        guardrails: {
          maxStepsPerRun: 17,
          maxIterations: 9,
          stepTimeoutMs: 50_000,
        },
      },
      guardrails: {
        maxStepsPerRun: 23,
        maxAgentTurnsPerStep: 7,
      },
    });
    const snapshot = buildAgentLoopExecutionSnapshot(loop);
    expect(snapshot.guardrails).toMatchObject({
      maxStepsPerRun: 23,
      maxIterations: 9,
      stepTimeoutMs: 50_000,
      maxAgentTurnsPerStep: 7,
    });
    expect(snapshot.definition).toEqual(definition);
    expect(snapshot.definition).not.toHaveProperty("guardrails");
  });
});

describe("resolveAgentLoopExecutionDefinition", () => {
  test("uses the frozen policy after a live edit", () => {
    const accepted = buildLoop();
    const run = buildRun(accepted);
    const edited = buildLoop({
      repoName: "edited",
      guardrails: { maxStepsPerRun: 1 },
      permissions: {},
      watchdogEnabled: false,
      watchdogInstructions: null,
      watchdogRetryBudget: 0,
    });

    const resolved = resolveAgentLoopExecutionDefinition(run, edited);
    expect(resolved.snapshotSource).toBe("frozen");
    expect(resolved.definition.repository.name).toBe("Widgets");
    expect(resolved.definition.guardrails.maxStepsPerRun).toBe(80);
    expect(resolved.definition.permissions).toEqual({
      github: { contents: "write", issues: "write" },
    });
    expect(resolved.definition.watchdog).toMatchObject({
      enabled: true,
      retryBudget: 3,
    });
  });

  test("fails closed for partial metadata, hash mismatch, graph mismatch, inactive or deleted source", () => {
    const loop = buildLoop();
    const run = buildRun(loop);
    const cases: Array<[AgentLoopRun, AgentLoop | null, string]> = [
      [{ ...run, definitionHash: null }, loop, "snapshot_invalid"],
      [{ ...run, definitionHash: "0".repeat(64) }, loop, "snapshot_hash_mismatch"],
      [
        { ...run, definitionSnapshot: { nodes: [], edges: [] } },
        loop,
        "snapshot_invalid",
      ],
      [run, buildLoop({ status: "paused" }), "source_inactive"],
      [run, null, "source_deleted"],
    ];

    for (const [candidate, source, kind] of cases) {
      try {
        resolveAgentLoopExecutionDefinition(candidate, source);
        throw new Error("expected resolution to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(AgentLoopSnapshotError);
        expect((error as AgentLoopSnapshotError).errorKind).toBe(kind);
      }
    }
  });

  test("allows observable graph-only legacy fallback only for an active source", () => {
    const loop = buildLoop();
    const run = buildRun(loop, {
      executionSnapshot: null,
      definitionVersion: null,
      definitionHash: null,
    });
    const resolved = resolveAgentLoopExecutionDefinition(run, loop);
    expect(resolved.snapshotSource).toBe("legacy_live_fallback");
    expect(resolved.definition.definition).toEqual(run.definitionSnapshot);
    expect(() => resolveAgentLoopExecutionDefinition(run, null)).toThrow(
      AgentLoopSnapshotError,
    );
  });
});
