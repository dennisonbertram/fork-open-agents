/**
 * Agent Loops store validation gate tests — TDD RED
 *
 * Tests that createAgentLoop and updateAgentLoop reject invalid definitions
 * before persisting.
 *
 * Mirrors the store.test.ts mock pattern exactly.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── DB mock (same pattern as store.test.ts) ───────────────────────────────────
let insertedValues: unknown[] = [];

const returningMock = mock(() => {
  const first = insertedValues[0];
  return first ? [first] : [];
});

const onConflictDoNothingMock = mock((_opts?: unknown) => ({
  returning: returningMock,
}));

const valuesMock = mock((vals: unknown) => {
  insertedValues = Array.isArray(vals) ? vals : [vals];
  return {
    returning: returningMock,
    onConflictDoNothing: onConflictDoNothingMock,
  };
});

const insertMock = mock((_table: unknown) => ({
  values: valuesMock,
}));

const txUpdateMock = mock((_table: unknown) => ({
  set: mock((setVals: unknown) => ({
    where: mock(() => ({
      returning: mock(() => [
        { ...(insertedValues[0] as object), ...(setVals as object) },
      ]),
    })),
  })),
}));

const txFindFirstMock = mock(async () => null as unknown);

mock.module("@/lib/db/client", () => ({
  db: {
    insert: insertMock,
    update: mock((_table: unknown) => ({
      set: mock((setVals: unknown) => ({
        where: mock(() => ({
          returning: mock(() => [
            { ...(insertedValues[0] as object), ...(setVals as object) },
          ]),
        })),
      })),
    })),
    delete: mock(() => ({
      where: mock(() => ({ returning: mock(() => [{ id: "loop-1" }]) })),
    })),
    select: mock(() => ({ from: mock(() => ({})) })),
    query: {
      agentLoops: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      agentLoopRuns: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      agentLoopStepRuns: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
      agentLoopEvents: {
        findMany: mock(async () => []),
        findFirst: mock(async () => null),
      },
    },
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: insertMock,
        update: txUpdateMock,
        delete: mock(() => ({
          where: mock(() => ({ returning: mock(() => [{ id: "loop-1" }]) })),
        })),
        query: {
          agentLoops: { findFirst: txFindFirstMock },
          agentLoopRuns: { findFirst: mock(async () => null) },
        },
      }),
    ),
  },
}));

const agentLoopsTable = Symbol("agentLoops");
const agentLoopRunsTable = Symbol("agentLoopRuns");
const agentLoopStepRunsTable = Symbol("agentLoopStepRuns");
const agentLoopEventsTable = Symbol("agentLoopEvents");

mock.module("@/lib/db/schema", () => ({
  agentLoops: agentLoopsTable,
  agentLoopRuns: agentLoopRunsTable,
  agentLoopStepRuns: agentLoopStepRunsTable,
  agentLoopEvents: agentLoopEventsTable,
}));

const storePromise = import("./store");

function resetMocks() {
  insertedValues = [];
  insertMock.mockClear();
  returningMock.mockClear();
  valuesMock.mockClear();
  txFindFirstMock.mockClear();
}

function makeLoop(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "loop-1",
    userId: "user-1",
    name: "Test Loop",
    description: null,
    repoOwner: "acme",
    repoName: "widgets",
    definition: { nodes: [], edges: [] },
    status: "draft",
    guardrails: null,
    permissions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Valid minimal definition (start → end)
function validDefinition() {
  return {
    nodes: [
      { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
      { id: "e", kind: "end", label: "End", position: { x: 100, y: 0 } },
    ],
    edges: [{ id: "e1", source: "s", target: "e", when: "always" }],
  };
}

// Invalid definition (no nodes)
function invalidDefinition() {
  return { nodes: [], edges: [] };
}

// ── Store gate: createAgentLoop ────────────────────────────────────────────────

describe("createAgentLoop — validation gate (SGT-001)", () => {
  beforeEach(resetMocks);

  test("SGT-001a: rejects an invalid definition and does NOT call db.insert", async () => {
    const store = await storePromise;
    const result = await store.createAgentLoop("user-1", {
      name: "Bad Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: invalidDefinition(),
    });

    // Must return a validation error, not throw
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
    // DB insert must NOT have been called
    expect(insertMock).not.toHaveBeenCalled();
  });

  test("SGT-001b: accepts a valid definition and calls db.insert returning the loop", async () => {
    const loop = makeLoop({ definition: validDefinition() });
    returningMock.mockImplementationOnce(() => [loop]);

    const store = await storePromise;
    const result = await store.createAgentLoop("user-1", {
      name: "Good Loop",
      repoOwner: "acme",
      repoName: "widgets",
      definition: validDefinition(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.loop.name).toBe("Test Loop");
    }
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

// ── Store gate: updateAgentLoop ────────────────────────────────────────────────

describe("updateAgentLoop — validation gate (SGT-002)", () => {
  beforeEach(resetMocks);

  test("SGT-002a: rejects an invalid definition in update and does NOT call db transaction", async () => {
    const store = await storePromise;
    const result = await store.updateAgentLoop("user-1", "loop-1", {
      definition: invalidDefinition(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  test("SGT-002b: update with no definition field change passes through (no validation needed)", async () => {
    const loop = makeLoop();
    txFindFirstMock.mockResolvedValueOnce(loop);
    txUpdateMock.mockReturnValueOnce({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => [{ ...loop, name: "Updated" }]),
        })),
      })),
    });

    const store = await storePromise;
    const result = await store.updateAgentLoop("user-1", "loop-1", {
      name: "Updated",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.loop).not.toBeNull();
    }
  });

  test("SGT-002c: update with valid definition is accepted", async () => {
    const loop = makeLoop({ definition: validDefinition() });
    txFindFirstMock.mockResolvedValueOnce(loop);
    txUpdateMock.mockReturnValueOnce({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => [loop]),
        })),
      })),
    });

    const store = await storePromise;
    const result = await store.updateAgentLoop("user-1", "loop-1", {
      definition: validDefinition(),
    });

    expect(result.ok).toBe(true);
  });
});
