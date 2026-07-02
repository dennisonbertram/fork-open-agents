/**
 * list-runs-failed-step-count.test.ts (#767)
 *
 * listAgentLoopRuns must extend each run with `failedStepCount` — the number
 * of step runs with status="failed" for that run — via ONE grouped query
 * (no N+1 per-run query). Mocks the db.select().from().leftJoin().where()
 * .groupBy().orderBy().limit() chain directly (store.test.ts's db mock uses
 * a different, fixed select-chain shape incompatible with groupBy).
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let rows: unknown[] = [];

const limitMock = mock(async () => rows);
const orderByMock = mock(() => ({ limit: limitMock }));
const groupByMock = mock(() => ({ orderBy: orderByMock }));
const whereMock = mock(() => ({ groupBy: groupByMock }));
const leftJoinMock = mock(() => ({ where: whereMock }));
const fromMock = mock(() => ({ leftJoin: leftJoinMock }));
const selectMock = mock((_fields?: unknown) => ({ from: fromMock }));

mock.module("@/lib/db/client", () => ({
  db: {
    select: selectMock,
    query: {},
    insert: mock(() => ({ values: mock(() => ({ returning: mock(() => []) })) })),
    update: mock(() => ({ set: mock(() => ({ where: mock(() => ({ returning: mock(() => []) })) })) })),
    delete: mock(() => ({ where: mock(() => ({ returning: mock(() => []) })) })),
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
}));

const agentLoopRunsTable = Symbol("agentLoopRuns");
const agentLoopStepRunsTable = Symbol("agentLoopStepRuns");

mock.module("@/lib/db/schema", () => ({
  agentLoops: Symbol("agentLoops"),
  agentLoopRuns: agentLoopRunsTable,
  agentLoopStepRuns: agentLoopStepRunsTable,
  agentLoopEvents: Symbol("agentLoopEvents"),
  agentLoopWatchdogRuns: Symbol("agentLoopWatchdogRuns"),
}));

const storePromise = import("./store");

describe("listAgentLoopRuns failedStepCount (#767)", () => {
  beforeEach(() => {
    rows = [];
    selectMock.mockClear();
    fromMock.mockClear();
    leftJoinMock.mockClear();
    whereMock.mockClear();
    groupByMock.mockClear();
    orderByMock.mockClear();
    limitMock.mockClear();
  });

  test("returns failedStepCount per run from a single grouped query (no N+1)", async () => {
    rows = [
      { run: { id: "run_1", status: "completed" }, failedStepCount: 2 },
      { run: { id: "run_2", status: "completed" }, failedStepCount: 0 },
    ];

    const { listAgentLoopRuns } = await storePromise;
    const result = await listAgentLoopRuns({
      loopId: "loop_1",
      userId: "user_1",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "run_1", failedStepCount: 2 });
    expect(result[1]).toMatchObject({ id: "run_2", failedStepCount: 0 });

    // Exactly one select call for the whole list — not one per run.
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(leftJoinMock).toHaveBeenCalledTimes(1);
    expect(groupByMock).toHaveBeenCalledTimes(1);
  });
});
