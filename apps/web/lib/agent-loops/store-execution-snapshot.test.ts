import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";

mock.module("server-only", () => ({}));

const tables = {
  agentLoops: Symbol("agentLoops"),
  agentLoopRuns: Symbol("agentLoopRuns"),
  agentLoopStepRuns: Symbol("agentLoopStepRuns"),
  agentLoopEvents: Symbol("agentLoopEvents"),
  agentLoopWatchdogRuns: Symbol("agentLoopWatchdogRuns"),
};
mock.module("@/lib/db/schema", () => tables);

let liveLoop: AgentLoop;
let persistedRun: AgentLoopRun | null;
let insertedRun: Record<string, unknown> | null;
let insertedEvents: Array<Record<string, unknown>>;
let eventInsertFails: boolean;
let runInsertWins: boolean;
let nextId: number;

const queryTerminal = (rows: unknown[]) => {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & {
    for: () => unknown;
    limit: () => Promise<unknown[]>;
  };
  promise.for = () => promise;
  promise.limit = async () => rows;
  return promise;
};

const tx = {
  select: () => ({
    from: () => ({
      where: () => queryTerminal([liveLoop]),
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      const returning = async () => {
        if (table === tables.agentLoopEvents) {
          if (eventInsertFails) return [];
          insertedEvents.push(values);
          return [values];
        }
        insertedRun = values;
        if (!runInsertWins) return [];
        persistedRun = values as unknown as AgentLoopRun;
        return [persistedRun];
      };
      return {
        returning,
        onConflictDoNothing: () => ({ returning }),
      };
    },
  }),
};

const db = {
  query: {
    agentLoopRuns: { findFirst: async () => persistedRun },
    agentLoops: { findFirst: async () => liveLoop },
  },
  transaction: async (callback: (value: typeof tx) => unknown) => {
    const before = persistedRun;
    try {
      return await callback(tx);
    } catch (error) {
      persistedRun = before;
      throw error;
    }
  },
  insert: tx.insert,
};

mock.module("@/lib/db/client", () => ({ db }));
mock.module("nanoid", () => ({ nanoid: () => `id-${nextId++}` }));

const { createAgentLoopRun } = await import("./store");

const graph = {
  nodes: [
    {
      id: "start",
      kind: "start",
      label: "Start",
      position: { x: 0, y: 0 },
    },
    { id: "end", kind: "end", label: "End", position: { x: 1, y: 0 } },
  ],
  edges: [
    { id: "edge", source: "start", target: "end", when: "always" },
  ],
};

function source(overrides: Partial<AgentLoop> = {}): AgentLoop {
  const now = new Date("2026-07-11T12:00:00.000Z");
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Accepted",
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: graph,
    status: "active",
    guardrails: null,
    permissions: {},
    watchdogEnabled: false,
    watchdogInstructions: null,
    watchdogRetryBudget: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  liveLoop = source();
  persistedRun = null;
  insertedRun = null;
  insertedEvents = [];
  eventInsertFails = false;
  runInsertWins = true;
  nextId = 1;
});

describe("createAgentLoopRun frozen transaction", () => {
  const input = {
    loopId: "loop-1",
    userId: "user-1",
    source: "manual" as const,
    idempotencyKey: "manual:1",
    requestId: "request-1",
  };

  test("atomically persists normalized graph, complete snapshot, hash and frozen evidence", async () => {
    const result = await createAgentLoopRun(input);
    expect(result?.created).toBe(true);
    expect(insertedRun).toMatchObject({
      definitionSnapshot: graph,
      executionSnapshot: {
        snapshotVersion: 1,
        source: { definitionId: "loop-1", name: "Accepted" },
        repository: { owner: "acme", name: "widgets" },
        definition: graph,
      },
      definitionVersion: 1,
      definitionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(insertedEvents).toContainEqual(
      expect.objectContaining({
        eventName: "agent-loop.snapshot.frozen",
        payload: expect.objectContaining({
          definitionVersion: 1,
          definitionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          snapshotSource: "frozen",
        }),
      }),
    );
  });

  test("duplicate returns the original snapshot without consulting an edited source", async () => {
    const first = await createAgentLoopRun(input);
    const originalHash = first?.run.definitionHash;
    liveLoop = source({
      name: "Edited",
      repoName: "edited",
      definition: { nodes: [], edges: [] },
    });
    insertedRun = null;
    const duplicate = await createAgentLoopRun(input);
    expect(duplicate?.created).toBe(false);
    expect(duplicate?.run.definitionHash).toBe(originalHash);
    expect(duplicate?.run.definitionSnapshot).toEqual(graph);
    expect(insertedRun).toBeNull();
    expect(insertedEvents).toHaveLength(1);
  });

  test("rolls back the winning run when frozen evidence cannot be persisted", async () => {
    eventInsertFails = true;
    await expect(createAgentLoopRun(input)).rejects.toThrow(
      "Failed to persist frozen loop execution snapshot evidence",
    );
    expect(persistedRun).toBeNull();
  });
});
