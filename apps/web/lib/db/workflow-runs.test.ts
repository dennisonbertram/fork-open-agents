import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { FinishedWorkflowRun } from "./workflow-runs";

// #1270: open_agents_get_updates reads the `workflowRuns` table to answer
// "which of my sessions finished while I was away". These tests pin the read
// query's contract: it projects the run plus its session's summary columns,
// carries the caller-scoped window total on every row (so a cap can be
// detected rather than silently dropping finishes), and forwards a limit.
let fakeSelectRows: Array<Record<string, unknown>> = [];
let lastSelectColumns: unknown;
let lastLimit: unknown;
let whereWasCalled = false;
let innerJoinWasCalled = false;

const fakeDb = {
  // Fluent select chain used by getWorkflowRunsFinishedSince:
  //   db.select({…}).from(workflowRuns).innerJoin(sessions, c).where(c)
  //     .orderBy(o).limit(limit)
  select: (columns: unknown) => {
    lastSelectColumns = columns;
    return {
      from: (_table: unknown) => ({
        innerJoin: (_joinTable: unknown, _condition: unknown) => {
          innerJoinWasCalled = true;
          return {
            where: (_condition: unknown) => {
              whereWasCalled = true;
              return {
                orderBy: (_order: unknown) => ({
                  limit: async (limit: number) => {
                    lastLimit = limit;
                    return fakeSelectRows;
                  },
                }),
              };
            },
          };
        },
      }),
    };
  },
};

mock.module("./client", () => ({
  db: fakeDb,
}));

const workflowRunsModulePromise = import("./workflow-runs");

beforeEach(() => {
  fakeSelectRows = [];
  lastSelectColumns = undefined;
  lastLimit = undefined;
  whereWasCalled = false;
  innerJoinWasCalled = false;
});

describe("getWorkflowRunsFinishedSince", () => {
  test("projects the run's session summary fields onto each finished run, and returns the rows", async () => {
    const { getWorkflowRunsFinishedSince } = await workflowRunsModulePromise;
    const row: FinishedWorkflowRun = {
      runId: "run-1",
      sessionId: "session-1",
      status: "completed",
      finishedAt: new Date("2026-01-01T00:05:00Z"),
      title: "Fix the bug",
      label: "batch-1",
      branch: "d/abc",
      baseBranch: "main",
      prNumber: 42,
      prStatus: "open",
      totalCount: 1,
    };
    fakeSelectRows = [row];

    const result = await getWorkflowRunsFinishedSince({
      userId: "user-1",
      since: new Date("2026-01-01T00:00:00Z"),
      limit: 20,
    });

    expect(result).toEqual([row]);
    // The projection must carry everything the tool needs to describe a
    // finished session without a second lookup: run outcome + session summary.
    expect(lastSelectColumns).toMatchObject({
      runId: expect.anything(),
      sessionId: expect.anything(),
      status: expect.anything(),
      finishedAt: expect.anything(),
      title: expect.anything(),
      label: expect.anything(),
      branch: expect.anything(),
      baseBranch: expect.anything(),
      prNumber: expect.anything(),
      prStatus: expect.anything(),
      totalCount: expect.anything(),
    });
    // The query joins the session so ownership/descriptive columns come from
    // the same statement, never a follow-up fetch per row.
    expect(innerJoinWasCalled).toBe(true);
    // Ownership must fail closed at the query boundary: never a bare table
    // read without a WHERE.
    expect(whereWasCalled).toBe(true);
  });

  test("forwards the caller's limit so a client can cap the response", async () => {
    const { getWorkflowRunsFinishedSince } = await workflowRunsModulePromise;
    fakeSelectRows = [];

    await getWorkflowRunsFinishedSince({
      userId: "user-1",
      since: new Date("2026-01-01T00:00:00Z"),
      limit: 7,
    });

    expect(lastLimit).toBe(7);
  });

  test("returns an empty array (window total 0) when nothing finished in the window", async () => {
    const { getWorkflowRunsFinishedSince } = await workflowRunsModulePromise;
    fakeSelectRows = [];

    const result = await getWorkflowRunsFinishedSince({
      userId: "user-1",
      since: new Date("2026-01-01T00:00:00Z"),
      limit: 20,
    });

    expect(result).toEqual([]);
  });
});
