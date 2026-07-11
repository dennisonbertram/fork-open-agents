import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type ColumnRef = { table: string; name: string };
type QueryRecord = {
  fromTable: unknown;
  joins: Array<{ kind: "left" | "inner"; table: unknown; condition: unknown }>;
  whereArg: unknown;
};

function table(tableName: string, names: string[]): Record<string, ColumnRef> {
  return Object.fromEntries(
    names.map((name) => [name, { table: tableName, name }]),
  ) as Record<string, ColumnRef>;
}

const backgroundAgentRuns = table("backgroundAgentRuns", [
  "id",
  "agentId",
  "triggerId",
  "userId",
  "status",
  "source",
  "triggerKind",
  "repoOwner",
  "repoName",
  "branch",
  "prNumber",
  "issueNumber",
  "outputUrl",
  "errorKind",
  "sandboxName",
  "requestId",
  "workflowRunId",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
]);
const backgroundAgents = table("backgroundAgents", ["id", "userId", "name"]);
const backgroundAgentTriggers = table("backgroundAgentTriggers", [
  "id",
  "userId",
  "kind",
]);
const agentLoopRuns = table("agentLoopRuns", [
  "id",
  "loopId",
  "triggerId",
  "userId",
  "status",
  "source",
  "currentNodeId",
  "stepCount",
  "errorKind",
  "workflowRunId",
  "requestId",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
]);
const agentLoops = table("agentLoops", [
  "id",
  "userId",
  "name",
  "repoOwner",
  "repoName",
]);
const agentLoopStepRuns = table("agentLoopStepRuns", [
  "id",
  "loopRunId",
  "status",
]);

let records: QueryRecord[] = [];
let backgroundRows: unknown[] = [];
let loopRows: unknown[] = [];

function queryChain(record: QueryRecord) {
  const chain = {
    from: mock((fromTable: unknown) => {
      record.fromTable = fromTable;
      return chain;
    }),
    leftJoin: mock((joinTable: unknown, condition: unknown) => {
      record.joins.push({ kind: "left" as const, table: joinTable, condition });
      return chain;
    }),
    innerJoin: mock((joinTable: unknown, condition: unknown) => {
      record.joins.push({
        kind: "inner" as const,
        table: joinTable,
        condition,
      });
      return chain;
    }),
    where: mock((condition: unknown) => {
      record.whereArg = condition;
      return chain;
    }),
    orderBy: mock(() => chain),
    limit: mock(async () =>
      record.fromTable === backgroundAgentRuns ? backgroundRows : loopRows,
    ),
  };
  return chain;
}

const select = mock(() => {
  const record: QueryRecord = { fromTable: null, joins: [], whereArg: null };
  records.push(record);
  return queryChain(record);
});

mock.module("@/lib/db/client", () => ({ db: { select } }));
mock.module("@/lib/db/schema", () => ({
  agentLoopRuns,
  agentLoops,
  agentLoopStepRuns,
  backgroundAgentRuns,
  backgroundAgents,
  backgroundAgentTriggers,
}));
mock.module("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ kind: "and", values }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
  inArray: (left: unknown, right: unknown) => ({
    kind: "inArray",
    left,
    right,
  }),
  lt: (left: unknown, right: unknown) => ({ kind: "lt", left, right }),
  or: (...values: unknown[]) => ({ kind: "or", values }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings: Array.from(strings),
    values,
  }),
}));

const storePromise = import("./store");

function containsOwnerPredicate(
  value: unknown,
  column: ColumnRef,
  userId: string,
): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.kind === "eq" &&
    record.left === column &&
    record.right === userId
  ) {
    return true;
  }
  return Object.values(record).some((child) =>
    Array.isArray(child)
      ? child.some((entry) => containsOwnerPredicate(entry, column, userId))
      : containsOwnerPredicate(child, column, userId),
  );
}

describe("Runs source loaders", () => {
  beforeEach(() => {
    records = [];
    backgroundRows = [];
    loopRows = [];
    select.mockClear();
  });

  test("binds the authenticated owner in both source queries", async () => {
    const { createDbRunSourceLoaders } = await storePromise;
    const loaders = createDbRunSourceLoaders({ userId: "user-1" });
    const query = { filters: { view: "all" as const }, limit: 26 };

    await loaders.background_agent(query);
    await loaders.agent_loop(query);

    const background = records.find(
      (record) => record.fromTable === backgroundAgentRuns,
    );
    const loop = records.find((record) => record.fromTable === agentLoopRuns);
    expect(
      containsOwnerPredicate(
        background?.whereArg,
        backgroundAgentRuns.userId!,
        "user-1",
      ),
    ).toBe(true);
    expect(
      containsOwnerPredicate(loop?.whereArg, agentLoopRuns.userId!, "user-1"),
    ).toBe(true);
  });

  test("uses owner-scoped left joins and keeps an orphaned background run", async () => {
    backgroundRows = [
      {
        id: "orphan-run",
        agentId: null,
        triggerId: null,
        agentName: null,
        status: "running",
        source: "github",
        triggerKind: "github.issue",
        repoOwner: "acme",
        repoName: "shop",
        branch: null,
        prNumber: null,
        issueNumber: 42,
        outputUrl: null,
        errorKind: null,
        sandboxName: null,
        requestId: null,
        workflowRunId: null,
        createdAt: new Date("2026-07-11T12:00:00.000Z"),
        updatedAt: new Date("2026-07-11T12:00:00.000Z"),
        startedAt: null,
        finishedAt: null,
      },
    ];
    const { createDbRunSourceLoaders } = await storePromise;
    const items = await createDbRunSourceLoaders({
      userId: "user-1",
    }).background_agent({ filters: { view: "all" }, limit: 26 });
    const query = records.find(
      (record) => record.fromTable === backgroundAgentRuns,
    );

    expect(query?.joins.every((join) => join.kind === "left")).toBe(true);
    expect(
      query?.joins.some(
        (join) =>
          join.table === backgroundAgents &&
          containsOwnerPredicate(
            join.condition,
            backgroundAgents.userId!,
            "user-1",
          ),
      ),
    ).toBe(true);
    expect(items[0]).toMatchObject({
      id: "background_agent:orphan-run",
      automation: null,
      automationName: "Deleted automation",
    });
  });
});
