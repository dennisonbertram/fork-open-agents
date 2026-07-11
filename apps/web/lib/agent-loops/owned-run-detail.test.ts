import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const where = mock((_predicate: unknown) => ({
  limit: async () => [
    {
      run: { id: "run-1", userId: "user-1", loopId: "loop-1" },
      loop: { id: "loop-1", userId: "user-1" },
    },
  ],
}));
const leftJoin = mock((_table: unknown, _predicate: unknown) => ({ where }));
const from = mock((_table: unknown) => ({ leftJoin }));
const select = mock((_fields: unknown) => ({ from }));

mock.module("@/lib/db/client", () => ({ db: { select } }));

const eq = mock((column: unknown, value: unknown) => ({
  operator: "eq",
  column,
  value,
}));
const and = mock((...conditions: unknown[]) => ({
  operator: "and",
  conditions,
}));
const passthrough = (...values: unknown[]) => values;
const sql = Object.assign(
  (_parts: TemplateStringsArray, ...values: unknown[]) => ({ values }),
  { join: passthrough },
);

mock.module("drizzle-orm", () => ({
  and,
  asc: passthrough,
  count: passthrough,
  desc: passthrough,
  eq,
  inArray: passthrough,
  like: passthrough,
  sql,
}));

const agentLoopRuns = {
  id: "agentLoopRuns.id",
  loopId: "agentLoopRuns.loopId",
  userId: "agentLoopRuns.userId",
};
const agentLoops = { id: "agentLoops.id", userId: "agentLoops.userId" };

mock.module("@/lib/db/schema", () => ({
  agentLoopEvents: {},
  agentLoopRuns,
  agentLoops,
  agentLoopStepRuns: {},
  agentLoopWatchdogRuns: {},
}));

const storeModule = import("./store");

describe("owned loop Run detail lookup", () => {
  test("constrains the first SQL query by both run id and user id", async () => {
    const { getOwnedAgentLoopRunWithLoop } = await storeModule;

    const result = await getOwnedAgentLoopRunWithLoop({
      runId: "run-1",
      userId: "user-1",
    });

    expect(result?.run.id).toBe("run-1");
    expect(where).toHaveBeenCalledWith({
      operator: "and",
      conditions: [
        {
          operator: "eq",
          column: "agentLoopRuns.id",
          value: "run-1",
        },
        {
          operator: "eq",
          column: "agentLoopRuns.userId",
          value: "user-1",
        },
      ],
    });
  });
});
