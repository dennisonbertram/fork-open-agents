/**
 * Self-contained Drizzle + bun:sqlite database for the POC eval.
 *
 * Uses `bun:sqlite` so there is no native build step (better-sqlite3) and no
 * external Postgres. In the real app this is replaced by the existing Neon
 * Postgres client at `apps/web/lib/db/client.ts` and the data-access helpers
 * in `apps/web/lib/db/sessions.ts`.
 */
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema>;

/**
 * Create an in-memory (or file-backed) database with the POC tables applied.
 * We create the tables with raw DDL that matches schema.ts so the POC does
 * not need drizzle-kit migration tooling for an ephemeral eval database.
 */
export function createDb(file = ":memory:"): { db: Db; sqlite: Database } {
  const sqlite = new Database(file);
  sqlite.exec("PRAGMA foreign_keys = ON;");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      branch TEXT,
      cron_expression TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS scheduled_jobs_owner_idx ON scheduled_jobs (owner_user_id);
    CREATE INDEX IF NOT EXISTS scheduled_jobs_enabled_idx ON scheduled_jobs (enabled);
    CREATE INDEX IF NOT EXISTS scheduled_jobs_next_run_idx ON scheduled_jobs (next_run_at);

    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'running',
      scheduled_for INTEGER NOT NULL,
      started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      finished_at INTEGER,
      result_chat_id TEXT,
      pr_url TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS scheduled_job_runs_job_idx ON scheduled_job_runs (job_id);
    CREATE INDEX IF NOT EXISTS scheduled_job_runs_status_idx ON scheduled_job_runs (status);

    -- Idempotency / overlap guard: at most one run per (job, scheduled minute).
    CREATE UNIQUE INDEX IF NOT EXISTS scheduled_job_runs_job_tick_uidx
      ON scheduled_job_runs (job_id, scheduled_for);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      repo_owner TEXT,
      repo_name TEXT,
      branch TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      parts TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
