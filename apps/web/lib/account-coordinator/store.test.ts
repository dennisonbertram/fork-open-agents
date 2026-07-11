import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type ColumnRef = {
  name: string;
  table: string;
};

type QueryRecord = {
  fromTable: unknown;
  limit: number | null;
  orderByArgs: unknown[];
  whereArg: unknown;
};

function makeTable(
  table: string,
  columns: string[],
): Record<string, ColumnRef> {
  return Object.fromEntries(
    columns.map((name) => [name, { name, table }]),
  ) as Record<string, ColumnRef>;
}

const sessionsTable = makeTable("sessions", [
  "id",
  "title",
  "status",
  "repoOwner",
  "repoName",
  "branch",
  "lifecycleState",
  "lifecycleError",
  "prNumber",
  "prStatus",
  "createdAt",
  "updatedAt",
  "userId",
]);

const workflowRunsTable = makeTable("workflowRuns", [
  "id",
  "chatId",
  "sessionId",
  "status",
  "runtimeMode",
  "errorMessage",
  "startedAt",
  "finishedAt",
  "createdAt",
  "userId",
]);

const chatsTable = makeTable("chats", ["id", "title"]);

const backgroundAgentRunsTable = makeTable("backgroundAgentRuns", [
  "id",
  "agentId",
  "status",
  "source",
  "triggerKind",
  "repoOwner",
  "repoName",
  "branch",
  "prNumber",
  "issueNumber",
  "errorKind",
  "errorMessage",
  "outputUrl",
  "payloadSummary",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "userId",
]);

const backgroundAgentsTable = makeTable("backgroundAgents", [
  "id",
  "name",
  "status",
  "repoOwner",
  "repoName",
]);

const agentLoopRunsTable = makeTable("agentLoopRuns", [
  "id",
  "loopId",
  "status",
  "source",
  "currentNodeId",
  "stepCount",
  "errorKind",
  "errorMessage",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "userId",
]);

const agentLoopsTable = makeTable("agentLoops", [
  "id",
  "name",
  "status",
  "repoOwner",
  "repoName",
]);

const agentLoopStepRunsTable = makeTable("agentLoopStepRuns", [
  "id",
  "loopRunId",
  "status",
]);

const backgroundAgentTriggersTable = makeTable("backgroundAgentTriggers", [
  "id",
  "name",
  "kind",
  "nextRunAt",
  "agentId",
  "loopId",
  "userId",
  "status",
]);

let queryRecords: QueryRecord[] = [];

function makeQueryChain(record: QueryRecord) {
  const chain = {
    from: mock((table: unknown) => {
      record.fromTable = table;
      return chain;
    }),
    leftJoin: mock((_table: unknown, _condition?: unknown) => chain),
    where: mock((condition?: unknown) => {
      record.whereArg = condition;
      return chain;
    }),
    orderBy: mock((...args: unknown[]) => {
      record.orderByArgs = args;
      return chain;
    }),
    limit: mock((count: number) => {
      record.limit = count;
      return Promise.resolve([]);
    }),
  };

  return chain;
}

const selectMock = mock((_columns?: unknown) => {
  const record: QueryRecord = {
    fromTable: null,
    limit: null,
    orderByArgs: [],
    whereArg: null,
  };
  queryRecords.push(record);

  return makeQueryChain(record);
});

mock.module("@/lib/db/client", () => ({
  db: {
    select: selectMock,
  },
}));

mock.module("@/lib/db/schema", () => ({
  agentLoopRuns: agentLoopRunsTable,
  agentLoopStepRuns: agentLoopStepRunsTable,
  agentLoops: agentLoopsTable,
  backgroundAgentRuns: backgroundAgentRunsTable,
  backgroundAgents: backgroundAgentsTable,
  backgroundAgentTriggers: backgroundAgentTriggersTable,
  chats: chatsTable,
  sessions: sessionsTable,
  workflowRuns: workflowRunsTable,
}));

mock.module("drizzle-orm", () => ({
  and: mock((...args: unknown[]) => ({ kind: "and", values: args })),
  asc: mock((column: unknown) => ({ direction: "asc", column })),
  desc: mock((column: unknown) => ({ direction: "desc", column })),
  eq: mock((left: unknown, right: unknown) => ({
    kind: "eq",
    left,
    right,
  })),
  gte: mock((left: unknown, right: unknown) => ({
    kind: "gte",
    left,
    right,
  })),
  inArray: mock((left: unknown, right: unknown) => ({
    kind: "inArray",
    left,
    right,
  })),
  or: mock((...args: unknown[]) => ({ kind: "or", values: args })),
  sql: Object.assign(
    mock((strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: "sql",
      strings: Array.from(strings),
      values,
    })),
    { raw: mock((value: string) => ({ kind: "sqlRaw", value })) },
  ),
}));

const storePromise = import("./store");

function resetMocks() {
  queryRecords = [];
  selectMock.mockClear();
}

describe("account snapshot store query ordering", () => {
  beforeEach(resetMocks);

  test("prioritizes running sessions before applying the source limit", async () => {
    const { createAccountSnapshotLoaders } = await storePromise;

    await createAccountSnapshotLoaders({
      userId: "user-1",
      since: new Date("2026-06-19T12:00:00.000Z"),
      limit: 2,
    }).sessions();

    const sessionQuery = queryRecords.find(
      (record) => record.fromTable === sessionsTable,
    );

    expect(sessionQuery?.limit).toBe(2);
    expect(sessionQuery?.orderByArgs).toEqual([
      {
        kind: "sql",
        strings: ["case when ", " = 'running' then 0 else 1 end"],
        values: [sessionsTable.status],
      },
      { direction: "desc", column: sessionsTable.updatedAt },
    ]);
  });

  test("sorts scheduled agents by the nearest next run with nulls last", async () => {
    const { createAccountSnapshotLoaders } = await storePromise;

    await createAccountSnapshotLoaders({
      userId: "user-1",
      since: new Date("2026-06-19T12:00:00.000Z"),
      limit: 3,
    }).scheduledAgents();

    const scheduledQuery = queryRecords.find(
      (record) => record.fromTable === backgroundAgentTriggersTable,
    );

    expect(scheduledQuery?.limit).toBe(3);
    expect(scheduledQuery?.orderByArgs).toEqual([
      {
        kind: "sql",
        strings: ["case when ", " is null then 1 else 0 end"],
        values: [backgroundAgentTriggersTable.nextRunAt],
      },
      {
        direction: "asc",
        column: backgroundAgentTriggersTable.nextRunAt,
      },
    ]);
  });

  test("keeps every normalized run source scoped to the authenticated user", async () => {
    const { createAccountSnapshotLoaders } = await storePromise;
    const loaders = createAccountSnapshotLoaders({
      userId: "user-1",
      since: new Date("2026-06-19T12:00:00.000Z"),
      limit: 3,
    });

    await loaders.chatWorkflowRuns();
    await loaders.backgroundAgentRuns();
    await loaders.agentLoopRuns();

    for (const [table, userIdColumn] of [
      [workflowRunsTable, workflowRunsTable.userId],
      [backgroundAgentRunsTable, backgroundAgentRunsTable.userId],
      [agentLoopRunsTable, agentLoopRunsTable.userId],
    ] as const) {
      const query = queryRecords.find((record) => record.fromTable === table);
      const predicates = (query?.whereArg as { values?: unknown[] } | null)
        ?.values;

      expect(predicates).toContainEqual({
        kind: "eq",
        left: userIdColumn,
        right: "user-1",
      });
    }
  });
});
