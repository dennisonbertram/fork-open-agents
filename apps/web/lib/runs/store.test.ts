import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentLoop } from "@/lib/db/schema";
import {
  buildAgentLoopExecutionSnapshot,
  hashAgentLoopExecutionSnapshot,
} from "@/lib/agent-loops/execution-snapshot";

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
  "definitionSnapshot",
  "executionSnapshot",
  "definitionVersion",
  "definitionHash",
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
    const query = {
      filters: { view: "all" as const },
      limit: 26,
      now: new Date("2026-07-11T12:00:00.000Z"),
    };

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
    }).background_agent({
      filters: { view: "all" },
      limit: 26,
      now: new Date("2026-07-11T12:00:00.000Z"),
    });
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

  test("retains verified frozen name and repository for a deleted loop", async () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    const definition = {
      nodes: [
        {
          id: "start",
          kind: "start" as const,
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "end",
          kind: "end" as const,
          label: "End",
          position: { x: 1, y: 0 },
        },
      ],
      edges: [
        {
          id: "edge",
          source: "start",
          target: "end",
          when: "always" as const,
        },
      ],
    };
    const loop = {
      id: "deleted-loop",
      userId: "user-1",
      name: "Frozen release",
      description: null,
      repoOwner: "acme",
      repoName: "shop",
      definition,
      status: "active",
      guardrails: null,
      permissions: {},
      watchdogEnabled: false,
      watchdogInstructions: null,
      watchdogRetryBudget: 2,
      createdAt: now,
      updatedAt: now,
    } satisfies AgentLoop;
    const snapshot = buildAgentLoopExecutionSnapshot(loop);
    loopRows = [
      {
        id: "deleted-run",
        loopId: null,
        triggerId: null,
        triggerKind: null,
        loopName: null,
        repoOwner: null,
        repoName: null,
        definitionSnapshot: snapshot.definition,
        executionSnapshot: snapshot,
        definitionVersion: 1,
        definitionHash: hashAgentLoopExecutionSnapshot(snapshot),
        status: "completed",
        source: "manual",
        currentNodeId: "end",
        stepCount: 2,
        failedStepCount: 0,
        errorKind: null,
        requestId: null,
        workflowRunId: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
      },
    ];

    const { createDbRunSourceLoaders } = await storePromise;
    const items = await createDbRunSourceLoaders({
      userId: "user-1",
    }).agent_loop({ filters: { view: "all" }, limit: 26, now });

    expect(items[0]).toMatchObject({
      automationName: "Frozen release",
      repository: { owner: "acme", name: "shop" },
    });
  });

  test("corrupt deleted snapshot falls back to a generic label and no repository", async () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    loopRows = [
      {
        id: "corrupt-run",
        loopId: null,
        triggerId: null,
        triggerKind: null,
        loopName: null,
        repoOwner: null,
        repoName: null,
        definitionSnapshot: { nodes: [], edges: [] },
        executionSnapshot: { source: { name: "Unverified canary" } },
        definitionVersion: 1,
        definitionHash: "0".repeat(64),
        status: "failed",
        source: "manual",
        currentNodeId: null,
        stepCount: 0,
        failedStepCount: 0,
        errorKind: "snapshot_hash_mismatch",
        requestId: null,
        workflowRunId: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: now,
      },
    ];

    const { createDbRunSourceLoaders } = await storePromise;
    const items = await createDbRunSourceLoaders({
      userId: "user-1",
    }).agent_loop({ filters: { view: "all" }, limit: 26, now });

    expect(items[0]).toMatchObject({
      automationName: "Deleted automation",
      repository: null,
    });
    expect(JSON.stringify(items)).not.toContain("Unverified canary");
  });
});
