import "server-only";

import { asc, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  backgroundAgentEvents,
  backgroundAgentOutputs,
  verifiedBuildEvents,
} from "@/lib/db/schema";

const SERVICE = "db-retention" as const;

export const RETENTION_TABLES = [
  "background_agent_events",
  "background_agent_outputs",
  "verified_build_events",
] as const;

export type RetentionTableName = (typeof RETENTION_TABLES)[number];

export type RetentionConfig = {
  windowDays: number;
  keepPerRun: number;
  batchSize: number;
};

export type RetentionRow = {
  id: string;
  runKey: string;
  at: Date;
};

export type RetentionStore = {
  listRows: (table: RetentionTableName) => Promise<RetentionRow[]>;
  deleteByIds: (table: RetentionTableName, ids: string[]) => Promise<number>;
};

export type RetentionTableResult = {
  table: RetentionTableName;
  deletedCount: number;
  durationMs: number;
  windowDays: number;
  errorKind?: "retention_batch_failed";
};

export type RetentionRunResult = {
  runId: string;
  tables: RetentionTableResult[];
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function getRetentionConfig(): RetentionConfig {
  return {
    windowDays: parsePositiveInt(process.env.EVENT_RETENTION_DAYS, 30),
    keepPerRun: parsePositiveInt(process.env.EVENT_RETENTION_KEEP_PER_RUN, 200),
    batchSize: 500,
  };
}

/**
 * Rows are deleted when they are older than `cutoff`, or when their
 * newest-first rank within a run exceeds `keepPerRun`.
 */
export function planEventRetentionDeletes(
  rows: RetentionRow[],
  options: { cutoff: Date; keepPerRun: number },
): string[] {
  const byRun = new Map<string, RetentionRow[]>();
  for (const row of rows) {
    const existing = byRun.get(row.runKey);
    if (existing) {
      existing.push(row);
    } else {
      byRun.set(row.runKey, [row]);
    }
  }

  const toDelete = new Set<string>();
  for (const runRows of byRun.values()) {
    const newestFirst = [...runRows].toSorted(
      (a, b) => b.at.getTime() - a.at.getTime(),
    );
    for (const [index, row] of newestFirst.entries()) {
      if (row.at < options.cutoff || index >= options.keepPerRun) {
        toDelete.add(row.id);
      }
    }
  }

  return [...toDelete];
}

function chunkIds(ids: string[], batchSize: number): string[][] {
  if (batchSize <= 0) {
    return [ids];
  }
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    chunks.push(ids.slice(i, i + batchSize));
  }
  return chunks;
}

function logRetentionCompleted(params: {
  runId: string;
  table: RetentionTableName;
  deletedCount: number;
  durationMs: number;
  windowDays: number;
}): void {
  console.info(
    JSON.stringify({
      service: SERVICE,
      event: "retention.run.completed",
      level: "info",
      runId: params.runId,
      table: params.table,
      deletedCount: params.deletedCount,
      durationMs: params.durationMs,
      windowDays: params.windowDays,
    }),
  );
}

function logRetentionFailed(params: {
  runId: string;
  table: RetentionTableName;
  errorKind: "retention_batch_failed";
}): void {
  console.warn(
    JSON.stringify({
      service: SERVICE,
      event: "retention.run.failed",
      level: "warn",
      runId: params.runId,
      table: params.table,
      errorKind: params.errorKind,
    }),
  );
}

async function deleteBackgroundAgentEventsByIds(
  ids: string[],
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const deleted = await db
    .delete(backgroundAgentEvents)
    .where(inArray(backgroundAgentEvents.id, ids))
    .returning({ id: backgroundAgentEvents.id });
  return deleted.length;
}

async function deleteBackgroundAgentOutputsByIds(
  ids: string[],
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const deleted = await db
    .delete(backgroundAgentOutputs)
    .where(inArray(backgroundAgentOutputs.id, ids))
    .returning({ id: backgroundAgentOutputs.id });
  return deleted.length;
}

async function deleteVerifiedBuildEventsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const deleted = await db
    .delete(verifiedBuildEvents)
    .where(inArray(verifiedBuildEvents.id, ids))
    .returning({ id: verifiedBuildEvents.id });
  return deleted.length;
}

async function deleteAgedBackgroundAgentEvents(
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  let deletedTotal = 0;
  for (;;) {
    const batch = await db
      .select({ id: backgroundAgentEvents.id })
      .from(backgroundAgentEvents)
      .where(lt(backgroundAgentEvents.createdAt, cutoff))
      .orderBy(asc(backgroundAgentEvents.createdAt))
      .limit(batchSize);
    if (batch.length === 0) {
      break;
    }
    deletedTotal += await deleteBackgroundAgentEventsByIds(
      batch.map((row) => row.id),
    );
    if (batch.length < batchSize) {
      break;
    }
  }
  return deletedTotal;
}

async function deleteAgedBackgroundAgentOutputs(
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  let deletedTotal = 0;
  for (;;) {
    const batch = await db
      .select({ id: backgroundAgentOutputs.id })
      .from(backgroundAgentOutputs)
      .where(lt(backgroundAgentOutputs.createdAt, cutoff))
      .orderBy(asc(backgroundAgentOutputs.createdAt))
      .limit(batchSize);
    if (batch.length === 0) {
      break;
    }
    deletedTotal += await deleteBackgroundAgentOutputsByIds(
      batch.map((row) => row.id),
    );
    if (batch.length < batchSize) {
      break;
    }
  }
  return deletedTotal;
}

async function deleteAgedVerifiedBuildEvents(
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  let deletedTotal = 0;
  for (;;) {
    const batch = await db
      .select({ id: verifiedBuildEvents.id })
      .from(verifiedBuildEvents)
      .where(lt(verifiedBuildEvents.receivedAt, cutoff))
      .orderBy(asc(verifiedBuildEvents.receivedAt))
      .limit(batchSize);
    if (batch.length === 0) {
      break;
    }
    deletedTotal += await deleteVerifiedBuildEventsByIds(
      batch.map((row) => row.id),
    );
    if (batch.length < batchSize) {
      break;
    }
  }
  return deletedTotal;
}

function rowsFromExecute(result: unknown): Array<{ id: string }> {
  if (Array.isArray(result)) {
    return result as Array<{ id: string }>;
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: Array<{ id: string }> }).rows;
  }
  return [];
}

async function deleteExcessBeyondKeepPerRun(params: {
  table: RetentionTableName;
  keepPerRun: number;
  batchSize: number;
}): Promise<number> {
  const { table, keepPerRun, batchSize } = params;
  let deletedTotal = 0;

  for (;;) {
    const excessQuery = (() => {
      switch (table) {
        case "background_agent_events":
          return sql`
            SELECT id FROM (
              SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY run_id ORDER BY created_at DESC, id DESC
                ) AS rn
              FROM background_agent_events
            ) ranked
            WHERE rn > ${keepPerRun}
            ORDER BY id
            LIMIT ${batchSize}
          `;
        case "background_agent_outputs":
          return sql`
            SELECT id FROM (
              SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY run_id ORDER BY created_at DESC, id DESC
                ) AS rn
              FROM background_agent_outputs
            ) ranked
            WHERE rn > ${keepPerRun}
            ORDER BY id
            LIMIT ${batchSize}
          `;
        case "verified_build_events":
          return sql`
            SELECT id FROM (
              SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY verified_build_run_id
                  ORDER BY received_at DESC, id DESC
                ) AS rn
              FROM verified_build_events
            ) ranked
            WHERE rn > ${keepPerRun}
            ORDER BY id
            LIMIT ${batchSize}
          `;
      }
    })();

    const batch = rowsFromExecute(await db.execute(excessQuery));
    const ids = batch
      .map((row) => row.id)
      .filter((id) => typeof id === "string");
    if (ids.length === 0) {
      break;
    }
    switch (table) {
      case "background_agent_events":
        deletedTotal += await deleteBackgroundAgentEventsByIds(ids);
        break;
      case "background_agent_outputs":
        deletedTotal += await deleteBackgroundAgentOutputsByIds(ids);
        break;
      case "verified_build_events":
        deletedTotal += await deleteVerifiedBuildEventsByIds(ids);
        break;
    }
    if (ids.length < batchSize) {
      break;
    }
  }

  return deletedTotal;
}

async function retainTableOnDb(params: {
  table: RetentionTableName;
  cutoff: Date;
  config: RetentionConfig;
}): Promise<number> {
  const { table, cutoff, config } = params;
  let deleted = 0;
  switch (table) {
    case "background_agent_events":
      deleted += await deleteAgedBackgroundAgentEvents(
        cutoff,
        config.batchSize,
      );
      break;
    case "background_agent_outputs":
      deleted += await deleteAgedBackgroundAgentOutputs(
        cutoff,
        config.batchSize,
      );
      break;
    case "verified_build_events":
      deleted += await deleteAgedVerifiedBuildEvents(cutoff, config.batchSize);
      break;
  }
  deleted += await deleteExcessBeyondKeepPerRun({
    table,
    keepPerRun: config.keepPerRun,
    batchSize: config.batchSize,
  });
  return deleted;
}

async function retainTableWithStore(params: {
  table: RetentionTableName;
  cutoff: Date;
  config: RetentionConfig;
  store: RetentionStore;
}): Promise<number> {
  const rows = await params.store.listRows(params.table);
  const ids = planEventRetentionDeletes(rows, {
    cutoff: params.cutoff,
    keepPerRun: params.config.keepPerRun,
  });
  let deleted = 0;
  for (const batch of chunkIds(ids, params.config.batchSize)) {
    deleted += await params.store.deleteByIds(params.table, batch);
  }
  return deleted;
}

export async function runEventRetention(params?: {
  now?: Date;
  runId?: string;
  config?: RetentionConfig;
  store?: RetentionStore;
}): Promise<RetentionRunResult> {
  const config = params?.config ?? getRetentionConfig();
  const now = params?.now ?? new Date();
  const runId = params?.runId ?? crypto.randomUUID();
  const cutoff = new Date(
    now.getTime() - config.windowDays * 24 * 60 * 60 * 1000,
  );

  const tables: RetentionTableResult[] = [];

  for (const table of RETENTION_TABLES) {
    const started = Date.now();
    try {
      const deletedCount = params?.store
        ? await retainTableWithStore({
            table,
            cutoff,
            config,
            store: params.store,
          })
        : await retainTableOnDb({ table, cutoff, config });
      const durationMs = Date.now() - started;
      tables.push({
        table,
        deletedCount,
        durationMs,
        windowDays: config.windowDays,
      });
      logRetentionCompleted({
        runId,
        table,
        deletedCount,
        durationMs,
        windowDays: config.windowDays,
      });
    } catch {
      const durationMs = Date.now() - started;
      tables.push({
        table,
        deletedCount: 0,
        durationMs,
        windowDays: config.windowDays,
        errorKind: "retention_batch_failed",
      });
      logRetentionFailed({
        runId,
        table,
        errorKind: "retention_batch_failed",
      });
    }
  }

  return { runId, tables };
}
