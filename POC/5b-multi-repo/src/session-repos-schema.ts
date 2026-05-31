// PROPOSED migration target for apps/web/lib/db/schema.ts.
//
// This file is NOT imported by the app. It documents, as runnable Drizzle, the
// `session_repos` table that generalizes the single-repo columns currently on
// `sessions` (repoOwner, repoName, branch, cloneUrl, prNumber, prStatus).
//
// Integration: when this lands in apps/web/lib/db/schema.ts, the single-repo
// columns on `sessions` become derived (the `primary` row of session_repos)
// during a migration window, then can be dropped. Generate the migration with
// `bun run --cwd apps/web db:generate` and commit the .sql.
//
// Kept here as a string-shaped reference so the POC stays dependency-free and
// does not need drizzle-orm installed.

export const sessionReposTableDDL = `
CREATE TABLE "session_repos" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  "repo_owner" text NOT NULL,
  "repo_name" text NOT NULL,
  "branch" text,
  "clone_url" text NOT NULL,
  -- Distinct checkout path inside the sandbox workspace, e.g. /workspace/api.
  "local_path" text NOT NULL,
  "role" text NOT NULL DEFAULT 'secondary', -- enum: primary | secondary
  "order_index" integer NOT NULL DEFAULT 0,
  -- Per-repo PR fields (generalize sessions.pr_number / sessions.pr_status).
  "pr_number" integer,
  "pr_status" text, -- enum: open | merged | closed
  -- Shared correlation id linking PRs of one coordinated change set.
  "change_set_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- One row per repo per session; each repo distinct within a session.
CREATE UNIQUE INDEX "session_repos_session_repo_idx"
  ON "session_repos" ("session_id", "repo_owner", "repo_name");
-- Exactly one primary repo per session enforced at app layer / partial index.
CREATE UNIQUE INDEX "session_repos_session_primary_idx"
  ON "session_repos" ("session_id") WHERE "role" = 'primary';
CREATE INDEX "session_repos_session_order_idx"
  ON "session_repos" ("session_id", "order_index");
`;

/**
 * Drizzle-shaped definition (commented form of what would be added to
 * apps/web/lib/db/schema.ts). Provided as documentation, not executed here.
 *
 * export const sessionRepos = pgTable(
 *   "session_repos",
 *   {
 *     id: text("id").primaryKey(),
 *     sessionId: text("session_id")
 *       .notNull()
 *       .references(() => sessions.id, { onDelete: "cascade" }),
 *     repoOwner: text("repo_owner").notNull(),
 *     repoName: text("repo_name").notNull(),
 *     branch: text("branch"),
 *     cloneUrl: text("clone_url").notNull(),
 *     localPath: text("local_path").notNull(),
 *     role: text("role", { enum: ["primary", "secondary"] })
 *       .notNull()
 *       .default("secondary"),
 *     orderIndex: integer("order_index").notNull().default(0),
 *     prNumber: integer("pr_number"),
 *     prStatus: text("pr_status", { enum: ["open", "merged", "closed"] }),
 *     changeSetId: text("change_set_id"),
 *     createdAt: timestamp("created_at").defaultNow().notNull(),
 *     updatedAt: timestamp("updated_at").defaultNow().notNull(),
 *   },
 *   (table) => [
 *     uniqueIndex("session_repos_session_repo_idx").on(
 *       table.sessionId, table.repoOwner, table.repoName,
 *     ),
 *     index("session_repos_session_order_idx").on(
 *       table.sessionId, table.orderIndex,
 *     ),
 *   ],
 * );
 */
