-- migration-safety: fix-forward legacy output_mode/output_kind were replaced by
-- github_actions (backfilled in 0080) and per-action outputs rows; the dropped
-- tool-grants table had zero production readers. Rolling back requires fixing
-- forward: no runtime path reads these surfaces after #746/#747, and the
-- equivalent configuration is reconstructible from github_actions if ever
-- needed. See docs/process/production-release-runbook.md (Migration Rollback Rule).
DROP TABLE IF EXISTS "background_agent_tool_grants" CASCADE;--> statement-breakpoint
ALTER TABLE "background_agent_runs" DROP COLUMN IF EXISTS "output_kind";--> statement-breakpoint
ALTER TABLE "background_agents" DROP COLUMN IF EXISTS "output_mode";
