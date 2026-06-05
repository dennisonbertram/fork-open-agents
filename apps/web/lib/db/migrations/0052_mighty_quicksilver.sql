ALTER TABLE "background_agent_triggers" ADD COLUMN "last_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "background_agent_triggers" ADD COLUMN "next_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "background_agent_triggers" ADD COLUMN "last_skip_reason" text;