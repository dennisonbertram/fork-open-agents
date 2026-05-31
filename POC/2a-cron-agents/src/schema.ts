/**
 * POC 2a schema — standing (cron-triggered) agents.
 *
 * Shapes mirror the repo's Drizzle conventions in
 * `apps/web/lib/db/schema.ts` (text ids, timestamps, status enums via
 * `text({ enum })`, indexes). For the self-contained POC we use the
 * sqlite-core builders so the eval can run against an in-process database
 * with no external Postgres/Neon dependency. The Postgres translation for
 * the real app is documented in README.md "Integration plan".
 *
 * Two new tables:
 *   - scheduled_jobs       : a saved "standing agent" (repo + prompt + cron)
 *   - scheduled_job_runs   : one row per dispatched execution (audit + idempotency)
 *
 * The POC also models the minimal slice of the existing sessions/chats/
 * chat_messages tables so we can prove the result actually "lands" as a
 * chat message linked back to the job. In the real app these tables already
 * exist (see `sessions`, `chats`, `chatMessages` in the repo schema).
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// --- New: scheduled_jobs -------------------------------------------------

export const scheduledJobs = sqliteTable(
  "scheduled_jobs",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    branch: text("branch"),
    cronExpression: text("cron_expression").notNull(),
    prompt: text("prompt").notNull(),
    // SQLite has no boolean; the repo uses pg boolean. 0/1 here.
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("scheduled_jobs_owner_idx").on(table.ownerUserId),
    index("scheduled_jobs_enabled_idx").on(table.enabled),
    index("scheduled_jobs_next_run_idx").on(table.nextRunAt),
  ],
);

// --- New: scheduled_job_runs --------------------------------------------

export const scheduledJobRuns = sqliteTable(
  "scheduled_job_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => scheduledJobs.id, { onDelete: "cascade" }),
    // "running" is the in-flight marker used for overlap/idempotency control.
    status: text("status", {
      enum: ["running", "succeeded", "failed", "skipped"],
    })
      .notNull()
      .default("running"),
    // Deterministic tick key: which scheduled minute this run is for.
    // Unique per (jobId, scheduledFor) prevents double-dispatch on overlapping ticks.
    scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    // Where the result landed.
    resultChatId: text("result_chat_id"),
    prUrl: text("pr_url"),
    error: text("error"),
  },
  (table) => [
    index("scheduled_job_runs_job_idx").on(table.jobId),
    index("scheduled_job_runs_status_idx").on(table.status),
  ],
);

// --- Existing-app slice (already present in the real schema) -------------
// Modeled here only so the POC can prove the result lands. In production
// these are `sessions`, `chats`, `chatMessages` in apps/web/lib/db/schema.ts.

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  status: text("status", {
    enum: ["running", "completed", "failed", "archived"],
  })
    .notNull()
    .default("running"),
  repoOwner: text("repo_owner"),
  repoName: text("repo_name"),
  branch: text("branch"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const chats = sqliteTable("chats", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  // Repo stores parts as jsonb; sqlite uses TEXT JSON.
  parts: text("parts", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;
export type ScheduledJobRun = typeof scheduledJobRuns.$inferSelect;
