/**
 * TDD tests for #743 run integrity — store-level guards.
 *
 * BT-743-A: updateBackgroundAgentRunStatus refuses a non-forced transition
 *   OUT of a terminal status (succeeded/failed/skipped/cancelled) and emits
 *   a background-agent.run.status_conflict warn event.
 * BT-743-B: updateBackgroundAgentRunStatus still applies the transition when
 *   force:true is passed (the stale sweeper's use case).
 * BT-743-C: recordBackgroundAgentEvent assigns unique, gapless sequences to
 *   concurrent callers for the same run — a sequence collision is retried
 *   instead of silently dropping the event.
 *
 * These tests mock only @/lib/db/client (and @/lib/db/schema table symbols)
 * so the real store.ts logic runs against an in-memory fake table. No live
 * database or network is used.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ── In-memory fake `background_agent_runs` + `background_agent_events` ─────

type FakeRunRow = Record<string, unknown> & { id: string; status: string };
type FakeEventRow = Record<string, unknown> & {
  id: string;
  runId: string;
  sequence: number;
};

let runsTable: FakeRunRow[] = [];
let eventsTable: FakeEventRow[] = [];
let idCounter = 0;

mock.module("nanoid", () => ({
  nanoid: (size?: number) => {
    idCounter += 1;
    return size ? `id-${idCounter}-${size}` : `id-${idCounter}`;
  },
}));

// Table references are plain marker objects (not Symbols) so we can attach
// column-reference properties to them — the drizzle-orm condition mock below
// needs distinct identities per column to tell which column an eq()/
// notInArray() call targets.
const runsIdColumn = "runId.id";
const runsStatusColumn = "runId.status";
const runsWorkflowRunIdColumn = "runId.workflowRunId";
const eventsRunIdColumn = "eventId.runId";
const eventsSequenceColumn = "eventId.sequence";

const runsTableSymbol: { id: string; status: string; workflowRunId: string } = {
  id: runsIdColumn,
  status: runsStatusColumn,
  workflowRunId: runsWorkflowRunIdColumn,
};
const eventsTableSymbol: { runId: string; sequence: string } = {
  runId: eventsRunIdColumn,
  sequence: eventsSequenceColumn,
};

mock.module("@/lib/db/schema", () => ({
  backgroundAgentRuns: runsTableSymbol,
  backgroundAgentEvents: eventsTableSymbol,
  backgroundAgents: Symbol("backgroundAgents"),
  backgroundAgentTriggers: Symbol("backgroundAgentTriggers"),
  backgroundAgentOutputs: Symbol("backgroundAgentOutputs"),
  backgroundAgentToolGrants: Symbol("backgroundAgentToolGrants"),
  agentLoops: Symbol("agentLoops"),
}));

mock.module("./redaction", () => ({
  redactBackgroundAgentPayload: (payload: unknown) => payload ?? {},
}));

mock.module("./matching", () => ({
  triggerMatchesEvent: () => true,
}));

// A tiny condition-object interpreter matching the shapes produced by the
// drizzle-orm mock below (`_eq`, `_and`, `_notInArray`).
type FakeCond =
  | { _eq: [unknown, unknown] }
  | { _and: FakeCond[] }
  | { _inArray: [unknown, unknown[]] }
  | { _notInArray: [unknown, unknown[]] };

function evalCond(cond: FakeCond | undefined, row: FakeRunRow): boolean {
  if (!cond) return true;
  if ("_and" in cond) {
    return cond._and.every((c) => evalCond(c, row));
  }
  if ("_eq" in cond) {
    const [col, value] = cond._eq;
    if (col === "runId.id") return row.id === value;
    if (col === "runId.workflowRunId") return row.workflowRunId === value;
    return true;
  }
  if ("_notInArray" in cond) {
    const [col, values] = cond._notInArray;
    if (col === "runId.status") return !values.includes(row.status);
    return true;
  }
  if ("_inArray" in cond) {
    const [col, values] = cond._inArray;
    if (col === "runId.status") return values.includes(row.status);
    return true;
  }
  return true;
}

mock.module("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  isNotNull: (a: unknown) => ({ _isNotNull: a }),
  like: (a: unknown, b: unknown) => ({ _like: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ _inArray: [a, b] }),
  notInArray: (a: unknown, b: unknown) => ({ _notInArray: [a, b] }),
  desc: (a: unknown) => ({ _desc: a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      _sql: { strings: Array.from(strings), values },
    }),
    { raw: (s: string) => ({ _sqlRaw: s }) },
  ),
}));

let sequenceSelectQueue: number[] = [];

const db = {
  select: mock((_fields: Record<string, unknown>) => ({
    from: (_table: unknown) => ({
      where: async (_cond: unknown) => {
        const next = sequenceSelectQueue.shift();
        return [{ nextSeq: next ?? 1 }];
      },
    }),
  })),
  insert: mock((table: unknown) => ({
    values: (vals: FakeEventRow) => ({
      onConflictDoNothing: (_config: unknown) => ({
        returning: async () => {
          if (table !== eventsTableSymbol) return [vals];
          const collides = eventsTable.some(
            (row) => row.runId === vals.runId && row.sequence === vals.sequence,
          );
          if (collides) {
            return [];
          }
          eventsTable.push(vals);
          return [vals];
        },
      }),
    }),
  })),
  update: mock((table: unknown) => ({
    set: (setVals: Record<string, unknown>) => ({
      where: (cond: FakeCond) => ({
        returning: async () => {
          if (table !== runsTableSymbol) return [];
          const idx = runsTable.findIndex((row) => evalCond(cond, row));
          if (idx < 0) return [];
          runsTable[idx] = { ...runsTable[idx], ...setVals };
          return [runsTable[idx]];
        },
      }),
    }),
  })),
  query: {
    backgroundAgentRuns: {
      findFirst: async () => runsTable[0] ?? undefined,
    },
  },
};

mock.module("@/lib/db/client", () => ({ db }));

const storePromise = import("./store");

function resetFixtures() {
  idCounter = 0;
  runsTable = [];
  eventsTable = [];
  sequenceSelectQueue = [];
  db.select.mockClear();
  db.insert.mockClear();
  db.update.mockClear();
}

function seedRun(status: string): FakeRunRow {
  const row: FakeRunRow = {
    id: "run-1",
    agentId: "agent-1",
    userId: "user-1",
    status,
    workflowRunId: null,
    sandboxName: null,
    errorKind: null,
    errorMessage: null,
    outputUrl: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  };
  runsTable.push(row);
  return row;
}

describe("#743 terminal-status guard: updateBackgroundAgentRunStatus", () => {
  beforeEach(resetFixtures);

  test("BT-743-A: refuses a non-forced transition out of a terminal status", async () => {
    seedRun("succeeded");
    const { updateBackgroundAgentRunStatus } = await storePromise;

    const result = await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "running",
      agentId: "agent-1",
      userId: "user-1",
    });

    expect(result).toBeNull();
    expect(runsTable[0]?.status).toBe("succeeded");
  });

  test("BT-743-A: emits background-agent.run.status_conflict on refusal", async () => {
    seedRun("failed");
    const { updateBackgroundAgentRunStatus } = await storePromise;
    sequenceSelectQueue = [1];

    await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "succeeded",
      agentId: "agent-1",
      userId: "user-1",
    });

    expect(eventsTable).toHaveLength(1);
    const event = eventsTable[0];
    expect(event?.eventName).toBe("background-agent.run.status_conflict");
    expect(event?.level).toBe("warn");
    expect(event?.payload).toEqual({
      runId: "run-1",
      from: "failed",
      to: "succeeded",
    });
  });

  test("BT-743-B: force:true still applies the transition (sweeper use case)", async () => {
    seedRun("succeeded");
    const { updateBackgroundAgentRunStatus } = await storePromise;

    const result = await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "failed",
      errorKind: "stuck_running",
      force: true,
    });

    expect(result?.status).toBe("failed");
    expect(runsTable[0]?.status).toBe("failed");
    // Forced transitions are not conflicts — no status_conflict event.
    expect(eventsTable).toHaveLength(0);
  });

  test("#1396 force:true CAS only updates queued/running — terminal stays immutable", async () => {
    seedRun("succeeded");
    const { updateBackgroundAgentRunStatus } = await storePromise;

    const result = await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "failed",
      errorKind: "stuck_running",
      force: true,
    });

    expect(result).toBeNull();
    expect(runsTable[0]?.status).toBe("succeeded");
    expect(eventsTable).toHaveLength(0);
  });

  test("#1396 force:true still terminalizes a genuinely stuck running run", async () => {
    seedRun("running");
    const { updateBackgroundAgentRunStatus } = await storePromise;

    const result = await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "failed",
      errorKind: "stuck_running",
      force: true,
    });

    expect(result?.status).toBe("failed");
    expect(runsTable[0]?.status).toBe("failed");
  });

  test("#1396 touchBackgroundAgentRunHeartbeat bumps updatedAt for live runs", async () => {
    const row = seedRun("running");
    row.updatedAt = new Date("2026-06-01T00:00:00.000Z");
    const { touchBackgroundAgentRunHeartbeat } = await storePromise;

    const result = await touchBackgroundAgentRunHeartbeat({
      runId: "run-1",
      turnIndex: 3,
    });

    expect(result).not.toBeNull();
    expect((runsTable[0]?.updatedAt as Date).getTime()).toBeGreaterThan(
      new Date("2026-06-01T00:00:00.000Z").getTime(),
    );
  });

  test("non-forced transitions between non-terminal statuses still succeed", async () => {
    seedRun("queued");
    const { updateBackgroundAgentRunStatus } = await storePromise;

    const result = await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "running",
    });

    expect(result?.status).toBe("running");
    expect(runsTable[0]?.status).toBe("running");
  });

  test("expectedStatuses applies a compare-and-set transition when the status matches", async () => {
    seedRun("queued");
    const { updateBackgroundAgentRunStatus } = await storePromise;

    const result = await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "running",
      expectedStatuses: ["queued"],
    });

    expect(result?.status).toBe("running");
    expect(runsTable[0]?.status).toBe("running");
  });

  test("expectedStatuses refuses a stale compare-and-set without changing the run", async () => {
    seedRun("running");
    const { updateBackgroundAgentRunStatus } = await storePromise;

    const result = await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "failed",
      expectedStatuses: ["queued"],
    });

    expect(result).toBeNull();
    expect(runsTable[0]?.status).toBe("running");
    expect(eventsTable).toHaveLength(0);
  });

  test("expectedWorkflowRunId refuses a stale workflow owner", async () => {
    const row = seedRun("running");
    row.workflowRunId = "workflow-new-owner";
    const { updateBackgroundAgentRunStatus } = await storePromise;

    const result = await updateBackgroundAgentRunStatus({
      runId: "run-1",
      status: "failed",
      expectedStatuses: ["running"],
      expectedWorkflowRunId: "workflow-stale-owner",
    });

    expect(result).toBeNull();
    expect(runsTable[0]?.status).toBe("running");
    expect(runsTable[0]?.workflowRunId).toBe("workflow-new-owner");
  });
});

describe("#743 event-sequence uniqueness: recordBackgroundAgentEvent", () => {
  beforeEach(resetFixtures);

  test("BT-743-C: retries on a sequence collision instead of dropping the event", async () => {
    const { recordBackgroundAgentEvent } = await storePromise;
    // Seed an existing event at sequence 1 so the first computed max+1 (1,
    // because the fake max-select queue below returns 1) collides, forcing
    // a retry that recomputes max+1 as 2.
    eventsTable.push({
      id: "existing",
      runId: "run-1",
      sequence: 1,
    } as FakeEventRow);
    // First select call (before the retry) returns 1 — collides with the
    // seeded row above. Second select call (the retry) returns 2.
    sequenceSelectQueue = [1, 2];

    const event = await recordBackgroundAgentEvent({
      runId: "run-1",
      userId: "user-1",
      eventName: "background-agent.trigger.received",
      status: "info",
    });

    expect(event.sequence).toBe(2);
    expect(eventsTable).toHaveLength(2);
    const sequences = eventsTable.map((row) => row.sequence).sort();
    expect(sequences).toEqual([1, 2]);
  });

  test("assigns sequence 1 to the first event for a run", async () => {
    const { recordBackgroundAgentEvent } = await storePromise;
    sequenceSelectQueue = [1];

    const event = await recordBackgroundAgentEvent({
      runId: "run-2",
      userId: "user-1",
      eventName: "background-agent.run.created",
      status: "started",
    });

    expect(event.sequence).toBe(1);
  });
});
