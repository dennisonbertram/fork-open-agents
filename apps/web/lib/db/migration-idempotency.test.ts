/**
 * #745: the background_agents config-surface migration must be safe to
 * re-run against a Neon preview branch that already applied it (repo lesson:
 * renumbered/re-run migrations fail on persistent preview DBs — see
 * docs/agents/lessons-learned.md "Neon preview migration renumber").
 *
 * This is a static file-content check, not a DB integration test: it asserts
 * the generated SQL for this ticket uses idempotent guards (IF NOT EXISTS /
 * DO $$ ... EXCEPTION) for its DDL, and that its backfill UPDATE only
 * touches rows that still have the column default (so re-running it does not
 * clobber user edits or duplicate the backfill).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(__dirname, "migrations");

function findGithubActionsMigrationFile(): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const match = files.find((f) => {
    const contents = readFileSync(join(migrationsDir, f), "utf-8");
    return (
      contents.includes("github_actions") &&
      contents.includes("write_scope") &&
      contents.includes("require_ci_green_for_merge")
    );
  });
  if (!match) {
    throw new Error(
      "Expected a migration adding github_actions/write_scope/require_ci_green_for_merge columns to background_agents",
    );
  }
  return join(migrationsDir, match);
}

describe("background_agents config-surface migration (#745) is idempotent", () => {
  test("adds the new columns with IF NOT EXISTS guards", () => {
    const sql = readFileSync(findGithubActionsMigrationFile(), "utf-8");

    expect(sql).toMatch(
      /ALTER TABLE "background_agents" ADD COLUMN IF NOT EXISTS "github_actions"/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "background_agents" ADD COLUMN IF NOT EXISTS "write_scope"/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "background_agents" ADD COLUMN IF NOT EXISTS "require_ci_green_for_merge"/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "background_agents" ADD COLUMN IF NOT EXISTS "model_id"/,
    );
  });

  test("backfills output_mode='ready_pr' rows with push+open_pull_request+comment_on_pr_or_issue", () => {
    const sql = readFileSync(findGithubActionsMigrationFile(), "utf-8");

    const readyPrBackfillMatch = sql.match(
      /UPDATE "background_agents"[\s\S]*?WHERE[\s\S]*?output_mode[\s\S]*?'ready_pr'[\s\S]*?;/,
    );
    expect(readyPrBackfillMatch).not.toBeNull();
    const readyPrBackfill = readyPrBackfillMatch?.[0] ?? "";
    expect(readyPrBackfill).toContain("open_pull_request");
    expect(readyPrBackfill).toContain("comment_on_pr_or_issue");
    expect(readyPrBackfill).toContain("push");
  });

  test("backfills output_mode='comment' rows with comment_on_pr_or_issue", () => {
    const sql = readFileSync(findGithubActionsMigrationFile(), "utf-8");

    const commentBackfillMatch = sql.match(
      /UPDATE "background_agents"[\s\S]*?WHERE[\s\S]*?output_mode[\s\S]*?'comment'[\s\S]*?;/,
    );
    expect(commentBackfillMatch).not.toBeNull();
    expect(commentBackfillMatch?.[0]).toContain("comment_on_pr_or_issue");
  });

  test("backfill UPDATEs are guarded to only touch rows still at the column default", () => {
    const sql = readFileSync(findGithubActionsMigrationFile(), "utf-8");

    // Idempotency guard: re-running the migration must not double-apply the
    // backfill. Every backfill UPDATE must scope its WHERE clause to rows
    // that still hold the untouched default githubActions value.
    const updates = sql.match(/UPDATE "background_agents"[\s\S]*?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update).toMatch(/github_actions[\s\S]*?=[\s\S]*?'\{/);
    }
  });

  test("does not drop the output_mode column (deferred to #748/#C7)", () => {
    const sql = readFileSync(findGithubActionsMigrationFile(), "utf-8");

    expect(sql).not.toMatch(/DROP COLUMN "output_mode"/i);
  });

  test("does not rewrite background_agent_outputs.kind (Drizzle text-enum has no DB constraint)", () => {
    const sql = readFileSync(findGithubActionsMigrationFile(), "utf-8");

    // background_agent_outputs.kind is a plain `text` column in the Drizzle
    // schema (enum is TS-only, no CHECK constraint is generated). Extending
    // the TS union in schema.ts must not produce any DDL that touches this
    // column, so the migration stays additive.
    expect(sql).not.toMatch(/"background_agent_outputs"[\s\S]*?"kind"/);
  });
});
