import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => {
      throw new Error("default db.select should not be used in unit tests");
    },
    delete: () => {
      throw new Error("default db.delete should not be used in unit tests");
    },
    execute: () => {
      throw new Error("default db.execute should not be used in unit tests");
    },
  },
}));

/**
 * #1400 — event/output retention planning and job behavior.
 *
 * The planner is pure so window / keep-last-K / idempotency can be proven
 * without a live database. The job wrapper is exercised against an injectable
 * store that records batched deletes.
 */

type RetentionRow = {
  id: string;
  runKey: string;
  at: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe("planEventRetentionDeletes", () => {
  test("deletes rows older than the retention window", async () => {
    const { planEventRetentionDeletes } = await import("./retention");
    const now = new Date("2026-08-21T12:00:00.000Z");
    const rows: RetentionRow[] = [
      {
        id: "keep-recent",
        runKey: "run-a",
        at: new Date(now.getTime() - 5 * DAY_MS),
      },
      {
        id: "drop-old",
        runKey: "run-a",
        at: new Date(now.getTime() - 45 * DAY_MS),
      },
    ];

    const deleted = planEventRetentionDeletes(rows, {
      cutoff: new Date(now.getTime() - 30 * DAY_MS),
      keepPerRun: 200,
    });

    expect(deleted).toEqual(["drop-old"]);
  });

  test("deletes excess beyond keep-last-K per run (newest kept)", async () => {
    const { planEventRetentionDeletes } = await import("./retention");
    const now = new Date("2026-08-21T12:00:00.000Z");
    const rows: RetentionRow[] = [
      {
        id: "newest",
        runKey: "run-a",
        at: new Date(now.getTime() - 1 * DAY_MS),
      },
      { id: "mid", runKey: "run-a", at: new Date(now.getTime() - 2 * DAY_MS) },
      {
        id: "oldest",
        runKey: "run-a",
        at: new Date(now.getTime() - 3 * DAY_MS),
      },
      {
        id: "other-run",
        runKey: "run-b",
        at: new Date(now.getTime() - 1 * DAY_MS),
      },
    ];

    const deleted = planEventRetentionDeletes(rows, {
      cutoff: new Date(now.getTime() - 30 * DAY_MS),
      keepPerRun: 2,
    });

    expect(deleted).toEqual(["oldest"]);
  });

  test("second plan on remaining rows is idempotent (empty)", async () => {
    const { planEventRetentionDeletes } = await import("./retention");
    const now = new Date("2026-08-21T12:00:00.000Z");
    const rows: RetentionRow[] = [
      { id: "a", runKey: "run-a", at: new Date(now.getTime() - 1 * DAY_MS) },
      { id: "b", runKey: "run-a", at: new Date(now.getTime() - 2 * DAY_MS) },
      { id: "c", runKey: "run-a", at: new Date(now.getTime() - 40 * DAY_MS) },
      { id: "d", runKey: "run-a", at: new Date(now.getTime() - 41 * DAY_MS) },
    ];
    const options = {
      cutoff: new Date(now.getTime() - 30 * DAY_MS),
      keepPerRun: 2,
    };

    const first = new Set(planEventRetentionDeletes(rows, options));
    const remaining = rows.filter((row) => !first.has(row.id));
    const second = planEventRetentionDeletes(remaining, options);

    expect([...first].toSorted()).toEqual(["c", "d"]);
    expect(second).toEqual([]);
  });
});

describe("getRetentionConfig", () => {
  beforeEach(() => {
    delete process.env.EVENT_RETENTION_DAYS;
    delete process.env.EVENT_RETENTION_KEEP_PER_RUN;
  });

  test("defaults to 30 days and keep 200 per run", async () => {
    const { getRetentionConfig } = await import("./retention");
    expect(getRetentionConfig()).toEqual({
      windowDays: 30,
      keepPerRun: 200,
      batchSize: 500,
    });
  });

  test("reads EVENT_RETENTION_DAYS and EVENT_RETENTION_KEEP_PER_RUN", async () => {
    process.env.EVENT_RETENTION_DAYS = "14";
    process.env.EVENT_RETENTION_KEEP_PER_RUN = "50";
    const { getRetentionConfig } = await import("./retention");
    expect(getRetentionConfig()).toEqual({
      windowDays: 14,
      keepPerRun: 50,
      batchSize: 500,
    });
  });
});

describe("runEventRetention", () => {
  test("batches deletes across the three event/output tables and is idempotent", async () => {
    const storeRows: Record<string, RetentionRow[]> = {
      background_agent_events: [
        {
          id: "bae-old",
          runKey: "run-1",
          at: new Date("2026-06-01T00:00:00.000Z"),
        },
        {
          id: "bae-keep",
          runKey: "run-1",
          at: new Date("2026-08-20T00:00:00.000Z"),
        },
      ],
      background_agent_outputs: [
        {
          id: "bao-1",
          runKey: "run-1",
          at: new Date("2026-08-20T00:00:00.000Z"),
        },
        {
          id: "bao-2",
          runKey: "run-1",
          at: new Date("2026-08-19T00:00:00.000Z"),
        },
        {
          id: "bao-3",
          runKey: "run-1",
          at: new Date("2026-08-18T00:00:00.000Z"),
        },
      ],
      verified_build_events: [
        {
          id: "vbe-old",
          runKey: "vb-1",
          at: new Date("2026-05-01T00:00:00.000Z"),
        },
      ],
    };

    const deleteCalls: Array<{ table: string; ids: string[] }> = [];

    const { runEventRetention } = await import("./retention");
    const result = await runEventRetention({
      now: new Date("2026-08-21T12:00:00.000Z"),
      runId: "cron-run-1",
      config: { windowDays: 30, keepPerRun: 2, batchSize: 2 },
      store: {
        async listRows(table) {
          return storeRows[table] ?? [];
        },
        async deleteByIds(table, ids) {
          deleteCalls.push({ table, ids });
          storeRows[table] = (storeRows[table] ?? []).filter(
            (row) => !ids.includes(row.id),
          );
          return ids.length;
        },
      },
    });

    expect(result.tables.map((t) => t.table).toSorted()).toEqual([
      "background_agent_events",
      "background_agent_outputs",
      "verified_build_events",
    ]);
    expect(
      result.tables.find((t) => t.table === "background_agent_events")
        ?.deletedCount,
    ).toBe(1);
    expect(
      result.tables.find((t) => t.table === "background_agent_outputs")
        ?.deletedCount,
    ).toBe(1);
    expect(
      result.tables.find((t) => t.table === "verified_build_events")
        ?.deletedCount,
    ).toBe(1);

    // Batch size 2 must still delete the single eligible output via at least
    // one delete call; age/excess deletes may be split across calls.
    expect(deleteCalls.some((call) => call.ids.length <= 2)).toBe(true);

    const second = await runEventRetention({
      now: new Date("2026-08-21T12:00:00.000Z"),
      runId: "cron-run-2",
      config: { windowDays: 30, keepPerRun: 2, batchSize: 2 },
      store: {
        async listRows(table) {
          return storeRows[table] ?? [];
        },
        async deleteByIds(table, ids) {
          deleteCalls.push({ table, ids });
          storeRows[table] = (storeRows[table] ?? []).filter(
            (row) => !ids.includes(row.id),
          );
          return ids.length;
        },
      },
    });

    expect(second.tables.every((t) => t.deletedCount === 0)).toBe(true);
  });

  test("emits retention.run.completed structured logs without row payloads", async () => {
    const infoLogs: unknown[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      infoLogs.push(args);
    };

    try {
      const { runEventRetention } = await import("./retention");
      await runEventRetention({
        now: new Date("2026-08-21T12:00:00.000Z"),
        runId: "cron-obs-1",
        config: { windowDays: 30, keepPerRun: 200, batchSize: 500 },
        store: {
          async listRows() {
            return [
              {
                id: "old",
                runKey: "run-1",
                at: new Date("2026-01-01T00:00:00.000Z"),
              },
            ];
          },
          async deleteByIds(_table, ids) {
            return ids.length;
          },
        },
      });
    } finally {
      console.info = originalInfo;
    }

    const completed = infoLogs
      .flat()
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry) => entry?.event === "retention.run.completed");

    expect(completed.length).toBeGreaterThan(0);
    for (const entry of completed) {
      expect(entry?.service).toBe("db-retention");
      expect(entry).toHaveProperty("table");
      expect(entry).toHaveProperty("deletedCount");
      expect(entry).toHaveProperty("durationMs");
      expect(entry).toHaveProperty("windowDays");
      expect(JSON.stringify(entry)).not.toContain("payload");
      expect(JSON.stringify(entry)).not.toContain("eventPayload");
    }
  });

  test("emits retention.run.failed and continues other tables on batch error", async () => {
    const warnLogs: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnLogs.push(args);
    };

    try {
      const { runEventRetention } = await import("./retention");
      const result = await runEventRetention({
        now: new Date("2026-08-21T12:00:00.000Z"),
        runId: "cron-fail-1",
        config: { windowDays: 30, keepPerRun: 200, batchSize: 500 },
        store: {
          async listRows(table) {
            if (table === "background_agent_events") {
              throw new Error("boom");
            }
            return [];
          },
          async deleteByIds(_table, ids) {
            return ids.length;
          },
        },
      });

      expect(result.tables).toHaveLength(3);
      expect(
        result.tables.find((t) => t.table === "background_agent_events")
          ?.errorKind,
      ).toBe("retention_batch_failed");
    } finally {
      console.warn = originalWarn;
    }

    const failed = warnLogs
      .flat()
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => {
        try {
          return JSON.parse(entry) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry) => entry?.event === "retention.run.failed");

    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]?.service).toBe("db-retention");
    expect(failed[0]?.errorKind).toBe("retention_batch_failed");
  });
});
