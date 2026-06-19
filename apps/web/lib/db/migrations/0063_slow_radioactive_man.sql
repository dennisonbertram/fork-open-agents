-- M3-01: watchdog schema + idempotent migration
-- Hand-edited for idempotency (Neon preview lesson):
-- - CREATE TABLE ... IF NOT EXISTS
-- - CREATE INDEX ... IF NOT EXISTS
-- - ALTER TABLE ADD COLUMN guarded via DO $$ ... EXCEPTION WHEN duplicate_column
-- - ADD CONSTRAINT guarded via DO $$ ... EXCEPTION WHEN duplicate_object
-- Safe to run twice on a persistent Neon preview branch.

CREATE TABLE IF NOT EXISTS "agent_loop_watchdog_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_run_id" text NOT NULL,
	"step_run_id" text,
	"node_id" text NOT NULL,
	"status" text NOT NULL,
	"decision" text,
	"diagnosis" text,
	"decision_payload" jsonb,
	"attempt" integer NOT NULL,
	"budget_remaining" integer NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Add watchdog_enabled column (idempotent)
DO $$ BEGIN
 ALTER TABLE "agent_loops" ADD COLUMN "watchdog_enabled" boolean DEFAULT false NOT NULL;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
-- Add watchdog_instructions column (idempotent)
DO $$ BEGIN
 ALTER TABLE "agent_loops" ADD COLUMN "watchdog_instructions" text;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
-- Add watchdog_retry_budget column (idempotent)
DO $$ BEGIN
 ALTER TABLE "agent_loops" ADD COLUMN "watchdog_retry_budget" integer DEFAULT 2 NOT NULL;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loop_watchdog_runs" ADD CONSTRAINT "agent_loop_watchdog_runs_loop_run_id_agent_loop_runs_id_fk" FOREIGN KEY ("loop_run_id") REFERENCES "public"."agent_loop_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loop_watchdog_runs" ADD CONSTRAINT "agent_loop_watchdog_runs_step_run_id_agent_loop_step_runs_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."agent_loop_step_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loop_watchdog_runs_loop_run_idx" ON "agent_loop_watchdog_runs" USING btree ("loop_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loop_watchdog_runs_loop_node_idx" ON "agent_loop_watchdog_runs" USING btree ("loop_run_id","node_id");
