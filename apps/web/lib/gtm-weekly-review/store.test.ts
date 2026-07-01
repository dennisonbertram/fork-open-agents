import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type SelectResult = Array<Record<string, unknown>>;
type InsertResult = Array<Record<string, unknown>>;
type InsertCall = { table: unknown; values: Record<string, unknown> };
type UpdateCall = { table: unknown; values: Record<string, unknown> };
type FakeDb = {
  transaction: <T>(callback: (tx: FakeDb) => T | Promise<T>) => Promise<T>;
  select: (_columns?: unknown) => {
    from: (_table: unknown) => {
      where: (_condition: unknown) => {
        orderBy: (_order: unknown) => Promise<SelectResult>;
      } & SelectResult;
    };
  };
  insert: (_table: unknown) => {
    values: (_values: Record<string, unknown>) => {
      returning: () => Promise<InsertResult>;
    };
  };
  update: (_table: unknown) => {
    set: (_values: Record<string, unknown>) => {
      where: (_condition: unknown) => {
        returning: () => Promise<InsertResult>;
      };
    };
  };
};

const insertCalls: InsertCall[] = [];
const updateCalls: UpdateCall[] = [];
let selectResults: SelectResult[] = [];
let insertResults: InsertResult[] = [];
let updateResults: InsertResult[] = [];
let transactionCount = 0;

function nextSelectResult(): SelectResult {
  return selectResults.shift() ?? [];
}

function buildFakeDb(): FakeDb {
  return {
    transaction: async <T>(callback: (tx: FakeDb) => T | Promise<T>) => {
      transactionCount += 1;
      return callback(buildFakeDb());
    },
    select: () => ({
      from: () => ({
        where: () => {
          const rows = nextSelectResult();
          return Object.assign(rows, {
            orderBy: async () => rows,
          });
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ table, values });
        return {
          returning: async () => insertResults.shift() ?? [],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push({ table, values });
        return {
          where: () => ({
            returning: async () => updateResults.shift() ?? [],
          }),
        };
      },
    }),
  };
}

function fakeDatabase() {
  return buildFakeDb() as never;
}

const storePromise = import("./store");

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  selectResults = [];
  insertResults = [];
  updateResults = [];
  transactionCount = 0;
});

describe("GTM weekly review store", () => {
  test("summarizes completed experiments and approval-gates learning persistence", async () => {
    const { runGtmWeeklyReview } = await storePromise;
    selectResults = [
      [
        {
          id: "experiment-1",
          title: "Founder DM test",
          hypothesis: "Founder-led DMs create qualified demos",
          channel: "linkedin",
          owner: "founder",
          status: "completed",
          startedAt: new Date("2026-06-24T00:00:00Z"),
          endedAt: new Date("2026-06-27T00:00:00Z"),
          expectedSignal: "Demo replies",
          outcomeSummary: "3 replies from 20 DMs",
          metrics: { replies: 3, sent: 20 },
          evidenceRefs: [{ sourceType: "manual", recordId: "sheet-1" }],
          updatedAt: new Date("2026-06-27T00:00:00Z"),
        },
      ],
      [],
    ];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "event-started" }],
      [{ id: "event-summarized" }],
      [{ id: "event-candidate" }],
      [{ id: "insight-1" }],
      [{ id: "event-persisted" }],
      [{ id: "event-completed" }],
    ];

    const result = await runGtmWeeklyReview(
      {
        userId: "operator-1",
        requestId: "req-1",
        weekStart: "2026-06-22",
        weekEnd: "2026-06-29",
        approvals: [{ candidateKey: "experiment-1", decision: "approved" }],
      },
      fakeDatabase(),
    );

    expect(transactionCount).toBe(1);
    expect(result.persistedLearningIds).toEqual(["insight-1"]);
    expect(result.approvalIds).toEqual([]);
    expect(result.experimentSummaries[0]?.metricSummary).toEqual([
      { key: "replies", value: 3 },
      { key: "sent", value: 20 },
    ]);
    expect(insertCalls.map((call) => call.values)).toContainEqual(
      expect.objectContaining({
        kind: "experiment",
        status: "active",
        createdBy: "gtm_weekly_review_agent",
      }),
    );
  });

  test("reports source gaps without hallucinating missing metrics", async () => {
    const { runGtmWeeklyReview } = await storePromise;
    selectResults = [
      [
        {
          id: "experiment-1",
          title: "Docs CTA",
          hypothesis: "Docs CTA drives activation",
          channel: "product",
          owner: null,
          status: "completed",
          outcomeSummary: "No analytics export connected",
          metrics: {},
          evidenceRefs: [],
          updatedAt: new Date("2026-06-27T00:00:00Z"),
        },
      ],
      [],
    ];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "event-started" }],
      [{ id: "event-summarized" }],
      [{ id: "event-gap-metrics" }],
      [{ id: "event-gap-evidence" }],
      [{ id: "event-candidate" }],
      [{ id: "approval-1" }],
      [{ id: "event-approval" }],
      [{ id: "event-completed" }],
    ];

    const result = await runGtmWeeklyReview(
      {
        userId: "operator-1",
        requestId: "req-1",
        weekStart: "2026-06-22",
        weekEnd: "2026-06-29",
      },
      fakeDatabase(),
    );

    expect(result.status).toBe("partial");
    expect(result.sourceGaps).toEqual([
      expect.objectContaining({ sourceKind: "metrics" }),
      expect.objectContaining({ sourceKind: "evidence" }),
    ]);
    expect(result.experimentSummaries[0]?.metricSummary).toEqual([]);
    expect(result.persistedLearningIds).toEqual([]);
    expect(result.approvalIds).toEqual(["approval-1"]);
  });

  test("blocks secret-bearing learning candidates before approval or persistence", async () => {
    const { runGtmWeeklyReview } = await storePromise;
    selectResults = [
      [
        {
          id: "experiment-1",
          title: "Private source",
          hypothesis: "Private notes reveal a segment",
          channel: "manual",
          owner: "founder",
          status: "completed",
          outcomeSummary: "Customer said token=super-secret caused churn",
          metrics: { calls: 1 },
          evidenceRefs: [{ sourceType: "manual", recordId: "note-1" }],
          updatedAt: new Date("2026-06-27T00:00:00Z"),
        },
      ],
    ];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "event-started" }],
      [{ id: "event-summarized" }],
      [{ id: "event-candidate" }],
      [{ id: "event-redaction" }],
      [{ id: "event-completed" }],
    ];

    const result = await runGtmWeeklyReview(
      {
        userId: "operator-1",
        requestId: "req-1",
        weekStart: "2026-06-22",
        weekEnd: "2026-06-29",
        approvals: [{ candidateKey: "experiment-1", decision: "approved" }],
      },
      fakeDatabase(),
    );

    expect(result.learningCandidates[0]).toMatchObject({
      redactionStatus: "blocked",
      approvalStatus: "denied",
    });
    expect(result.sourceGaps).toEqual([
      expect.objectContaining({ sourceKind: "redaction" }),
    ]);
    expect(
      insertCalls.some(
        (call) => call.values.createdBy === "gtm_weekly_review_agent",
      ),
    ).toBe(false);
  });

  test("dedupes approved learning candidates into existing GTM insights", async () => {
    const { runGtmWeeklyReview } = await storePromise;
    selectResults = [
      [
        {
          id: "experiment-1",
          title: "Founder DM test",
          hypothesis: "Founder-led DMs create qualified demos",
          channel: "linkedin",
          owner: "founder",
          status: "completed",
          outcomeSummary: "3 replies from 20 DMs",
          metrics: { replies: 3 },
          evidenceRefs: [{ sourceType: "manual", recordId: "sheet-1" }],
          updatedAt: new Date("2026-06-27T00:00:00Z"),
        },
      ],
      [{ id: "insight-existing" }],
    ];
    insertResults = [
      [{ id: "run-1" }],
      [{ id: "event-started" }],
      [{ id: "event-summarized" }],
      [{ id: "event-candidate" }],
      [{ id: "event-dedupe" }],
      [{ id: "event-completed" }],
    ];
    updateResults = [[{ id: "insight-existing" }]];

    const result = await runGtmWeeklyReview(
      {
        userId: "operator-1",
        requestId: "req-1",
        weekStart: "2026-06-22",
        weekEnd: "2026-06-29",
        approvals: [{ candidateKey: "experiment-1", decision: "approved" }],
      },
      fakeDatabase(),
    );

    expect(result.dedupedCount).toBe(1);
    expect(result.learningCandidates[0]).toMatchObject({
      approvalStatus: "merged",
      existingLearningId: "insight-existing",
    });
    expect(updateCalls.map((call) => call.values)).toContainEqual(
      expect.objectContaining({
        status: "active",
        summary: "3 replies from 20 DMs",
      }),
    );
  });

  test("retrieves active GTM learnings for future agent context", async () => {
    const { listActiveGtmLearningsForContext } = await storePromise;
    selectResults = [
      [
        {
          id: "insight-1",
          title: "Founder DMs work for infra founders",
          summary: "Manual founder outreach produced replies.",
          confidence: "medium",
          sourceId: "run-1",
          evidenceRefs: [{ sourceType: "manual", recordId: "sheet-1" }],
          updatedAt: new Date("2026-06-27T00:00:00Z"),
        },
      ],
    ];

    const result = await listActiveGtmLearningsForContext(
      "operator-1",
      fakeDatabase(),
    );

    expect(result).toEqual([
      {
        learningId: "insight-1",
        title: "Founder DMs work for infra founders",
        summary: "Manual founder outreach produced replies.",
        confidence: "medium",
        sourceId: "run-1",
        evidenceRefs: [{ sourceType: "manual", recordId: "sheet-1" }],
        updatedAt: new Date("2026-06-27T00:00:00Z"),
      },
    ]);
  });
});
