-- #808 (MR-1): ProfileRun data core additive columns.
--
-- migration-safety: additive-only, non-destructive. All columns are
-- nullable (or boolean with a safe default) and use IF NOT EXISTS so this
-- migration is safe to re-run against a Neon preview branch that already
-- applied it (see docs/agents/lessons-learned.md "Neon preview migration
-- renumber").
--
-- Decision D4 (remove the "repo" scope value from managed_runtime_saved_profiles
-- .scope and managed_runtime_profile_drafts.target_scope) requires no DDL here:
-- Drizzle's `enum` option on a `text` column is TS-level only and generates no
-- SQL CHECK constraint, so narrowing the TS union does not require a migration.
ALTER TABLE "managed_runtime_profile_drafts" ADD COLUMN IF NOT EXISTS "last_test_scope" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_drafts" ADD COLUMN IF NOT EXISTS "force_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_runs" ADD COLUMN IF NOT EXISTS "requested_profile_id" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_runs" ADD COLUMN IF NOT EXISTS "resolved_profile_id" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_runs" ADD COLUMN IF NOT EXISTS "error_kind" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_runs" ADD COLUMN IF NOT EXISTS "next_action" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_saved_profiles" ADD COLUMN IF NOT EXISTS "last_test_scope" text;
