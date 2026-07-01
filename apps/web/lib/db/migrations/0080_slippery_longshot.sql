-- #745: background_agents config surface (githubActions, writeScope,
-- requireCiGreenForMerge, modelId) + backfill from the legacy outputMode
-- enum. Additive only — output_mode itself is NOT dropped here (#748/#C7).
--
-- All DDL uses IF NOT EXISTS / idempotent guards, and the backfill UPDATEs
-- are scoped to rows still holding the untouched column default, so this
-- migration is safe to re-run against a Neon preview branch that already
-- applied it (see docs/agents/lessons-learned.md "Neon preview migration
-- renumber").
--
-- background_agent_outputs.kind is a plain `text` column at the DB level
-- (Drizzle's `enum` option is TS-only and generates no CHECK constraint), so
-- widening its TS union in schema.ts to add pr_comment/pr_review/merge/push/
-- branch_delete requires no DDL here.
ALTER TABLE "background_agents" ADD COLUMN IF NOT EXISTS "github_actions" jsonb DEFAULT '{"open_pull_request":true,"comment_on_pr_or_issue":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "background_agents" ADD COLUMN IF NOT EXISTS "write_scope" jsonb DEFAULT '{"mode":"this_repo"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "background_agents" ADD COLUMN IF NOT EXISTS "require_ci_green_for_merge" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "background_agents" ADD COLUMN IF NOT EXISTS "model_id" text;--> statement-breakpoint
-- Backfill: rows with output_mode='ready_pr' get open_pull_request,
-- comment_on_pr_or_issue, and push all true. Scoped to rows still at the
-- column default so re-running this migration cannot double-apply the
-- backfill or clobber a user's later edits to github_actions.
UPDATE "background_agents"
SET "github_actions" = '{"open_pull_request":true,"comment_on_pr_or_issue":true,"push":true}'::jsonb
WHERE "output_mode" = 'ready_pr'
  AND "github_actions" = '{"open_pull_request":true,"comment_on_pr_or_issue":true}'::jsonb;--> statement-breakpoint
-- Backfill: rows with output_mode='comment' get comment_on_pr_or_issue true.
-- Scoped the same way for idempotency.
UPDATE "background_agents"
SET "github_actions" = '{"open_pull_request":true,"comment_on_pr_or_issue":true}'::jsonb
WHERE "output_mode" = 'comment'
  AND "github_actions" = '{"open_pull_request":true,"comment_on_pr_or_issue":true}'::jsonb;--> statement-breakpoint
-- output_mode in ('issue', 'notification', 'none') keep the column default
-- (open_pull_request + comment_on_pr_or_issue) — no further backfill needed.
