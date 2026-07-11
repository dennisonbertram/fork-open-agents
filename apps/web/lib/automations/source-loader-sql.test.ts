import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const backgroundAgentRuns = {
  id: "background_runs.id",
  agentId: "background_runs.agent_id",
  userId: "background_runs.user_id",
  createdAt: "background_runs.created_at",
};
const backgroundAgentTriggers = {
  id: "triggers.id",
  loopId: "triggers.loop_id",
  userId: "triggers.user_id",
  createdAt: "triggers.created_at",
};
const agentLoopRuns = {
  id: "loop_runs.id",
  loopId: "loop_runs.loop_id",
  userId: "loop_runs.user_id",
  createdAt: "loop_runs.created_at",
};
const agentLoopStepRuns = {
  id: "step_runs.id",
  loopRunId: "step_runs.loop_run_id",
  status: "step_runs.status",
};

mock.module("@/lib/db/schema", () => ({
  backgroundAgentRuns,
  backgroundAgentTriggers,
  agentLoopRuns,
  agentLoopStepRuns,
}));

const predicate = (op: string, ...values: unknown[]) => ({ op, values });
mock.module("drizzle-orm", () => ({
  and: (...values: unknown[]) => predicate("and", ...values),
  count: (value: unknown) => predicate("count", value),
  desc: (value: unknown) => predicate("desc", value),
  eq: (left: unknown, right: unknown) => predicate("eq", left, right),
  inArray: (left: unknown, right: unknown) =>
    predicate("inArray", left, right),
  isNotNull: (value: unknown) => predicate("isNotNull", value),
}));

let distinctRows: unknown[] = [];
let countRows: unknown[] = [];
let distinctWhere: unknown;
let countWhere: unknown;
let triggerWhere: unknown;

const distinctOrderBy = mock(async () => distinctRows);
const distinctWhereMock = mock((value: unknown) => {
  distinctWhere = value;
  return { orderBy: distinctOrderBy };
});
const distinctFrom = mock(() => ({ where: distinctWhereMock }));
const selectDistinctOn = mock(() => ({ from: distinctFrom }));

const groupBy = mock(async () => countRows);
const countWhereMock = mock((value: unknown) => {
  countWhere = value;
  return { groupBy };
});
const innerJoin = mock(() => ({ where: countWhereMock }));
const selectFrom = mock(() => ({ innerJoin }));
const select = mock(() => ({ from: selectFrom }));

const findMany = mock(async (config: { where: unknown }) => {
  triggerWhere = config.where;
  return [];
});

mock.module("@/lib/db/client", () => ({
  db: {
    selectDistinctOn,
    select,
    query: { backgroundAgentTriggers: { findMany } },
  },
}));
mock.module("@/lib/background-agents/store", () => ({
  listBackgroundAgents: mock(async () => []),
}));
mock.module("@/lib/agent-loops/store", () => ({
  listAgentLoops: mock(async () => []),
}));
mock.module("./adapters", () => ({
  adaptBackgroundAutomation: mock(() => ({ item: {}, invalid: false })),
  adaptLoopAutomation: mock(() => ({ item: {}, invalid: false })),
}));

const sourceLoadersPromise = import("./source-loaders");

describe("default Automation SQL source scopes", () => {
  beforeEach(() => {
    distinctRows = [];
    countRows = [];
    distinctWhere = undefined;
    countWhere = undefined;
    triggerWhere = undefined;
    selectDistinctOn.mockClear();
    select.mockClear();
    findMany.mockClear();
  });

  test("binds owner and all agent ids in one latest-background-run query", async () => {
    const { listLatestBackgroundAutomationRuns } =
      await sourceLoadersPromise;

    await listLatestBackgroundAutomationRuns({
      userId: "owner-1",
      agentIds: ["agent-1", "agent-2"],
    });

    expect(selectDistinctOn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(distinctWhere)).toContain("owner-1");
    expect(JSON.stringify(distinctWhere)).toContain("agent-1");
    expect(JSON.stringify(distinctWhere)).toContain("agent-2");
    expect(JSON.stringify(distinctWhere)).toContain("background_runs.user_id");
  });

  test("binds owner and all loop ids in batched trigger and latest-run queries", async () => {
    const {
      listLatestLoopAutomationRuns,
      listLoopAutomationTriggers,
    } = await sourceLoadersPromise;
    const scope = {
      userId: "owner-1",
      loopIds: ["loop-1", "loop-2"],
    };

    await listLoopAutomationTriggers(scope);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(triggerWhere)).toContain("owner-1");
    expect(JSON.stringify(triggerWhere)).toContain("loop-1");
    expect(JSON.stringify(triggerWhere)).toContain("loop-2");

    await listLatestLoopAutomationRuns(scope);
    expect(selectDistinctOn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(distinctWhere)).toContain("owner-1");
    expect(JSON.stringify(distinctWhere)).toContain("loop_runs.user_id");
  });

  test("joins failed-step counts back through owner-scoped loop runs", async () => {
    const { listLoopFailedStepCounts } = await sourceLoadersPromise;

    await listLoopFailedStepCounts({
      userId: "owner-1",
      runIds: ["run-1", "run-2"],
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(countWhere)).toContain("owner-1");
    expect(JSON.stringify(countWhere)).toContain("loop_runs.user_id");
    expect(JSON.stringify(countWhere)).toContain("run-1");
    expect(JSON.stringify(countWhere)).toContain("run-2");
  });
});
