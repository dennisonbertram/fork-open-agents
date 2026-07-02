DROP TABLE IF EXISTS "background_agent_tool_grants" CASCADE;--> statement-breakpoint
ALTER TABLE "background_agent_runs" DROP COLUMN IF EXISTS "output_kind";--> statement-breakpoint
ALTER TABLE "background_agents" DROP COLUMN IF EXISTS "output_mode";
