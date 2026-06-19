-- Agent Loops M1-01: schema + migration + store
-- Hand-edited for idempotency (Neon preview lesson):
-- - CREATE TABLE ... IF NOT EXISTS
-- - CREATE INDEX ... IF NOT EXISTS
-- - CREATE UNIQUE INDEX ... IF NOT EXISTS
-- - ALTER TABLE ADD COLUMN guarded via DO $$ ... EXCEPTION WHEN duplicate_column
-- - ALTER TABLE DROP NOT NULL guarded via DO $$ ... EXCEPTION WHEN others (no-op if already nullable)
-- - ADD CONSTRAINT guarded via DO $$ ... EXCEPTION WHEN duplicate_object
-- Safe to run twice on a persistent Neon preview branch.

CREATE TABLE IF NOT EXISTS "agent_loop_events" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_run_id" text NOT NULL,
	"step_run_id" text,
	"node_id" text,
	"event_name" text NOT NULL,
	"status" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"summary" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redaction_status" text DEFAULT 'passed' NOT NULL,
	"request_id" text,
	"workflow_run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_loop_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"definition_snapshot" jsonb NOT NULL,
	"current_node_id" text,
	"current_step_run_id" text,
	"iteration_count" integer DEFAULT 0 NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"trigger_id" text,
	"idempotency_key" text NOT NULL,
	"error_kind" text,
	"error_message" text,
	"workflow_run_id" text,
	"request_id" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_loop_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_loop_step_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"node_kind" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"step_input" jsonb,
	"step_output" jsonb,
	"sandbox_name" text,
	"workflow_run_id" text,
	"error_kind" text,
	"error_message" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_loops" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"guardrails" jsonb,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Drop NOT NULL on agent_id (already nullable after first run → no-op)
DO $$ BEGIN
 ALTER TABLE "background_agent_triggers" ALTER COLUMN "agent_id" DROP NOT NULL;
EXCEPTION
 WHEN others THEN null;
END $$;
--> statement-breakpoint
-- Add loop_id column (idempotent)
DO $$ BEGIN
 ALTER TABLE "background_agent_triggers" ADD COLUMN "loop_id" text;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loop_events" ADD CONSTRAINT "agent_loop_events_loop_run_id_agent_loop_runs_id_fk" FOREIGN KEY ("loop_run_id") REFERENCES "public"."agent_loop_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loop_events" ADD CONSTRAINT "agent_loop_events_step_run_id_agent_loop_step_runs_id_fk" FOREIGN KEY ("step_run_id") REFERENCES "public"."agent_loop_step_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loop_runs" ADD CONSTRAINT "agent_loop_runs_loop_id_agent_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."agent_loops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loop_runs" ADD CONSTRAINT "agent_loop_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loop_runs" ADD CONSTRAINT "agent_loop_runs_trigger_id_background_agent_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."background_agent_triggers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loop_step_runs" ADD CONSTRAINT "agent_loop_step_runs_loop_run_id_agent_loop_runs_id_fk" FOREIGN KEY ("loop_run_id") REFERENCES "public"."agent_loop_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_loops" ADD CONSTRAINT "agent_loops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loop_events_loop_run_created_idx" ON "agent_loop_events" USING btree ("loop_run_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loop_events_request_idx" ON "agent_loop_events" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loop_runs_loop_created_idx" ON "agent_loop_runs" USING btree ("loop_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loop_runs_user_created_idx" ON "agent_loop_runs" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loop_runs_status_idx" ON "agent_loop_runs" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_loop_runs_idempotency_idx" ON "agent_loop_runs" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loop_step_runs_loop_run_created_idx" ON "agent_loop_step_runs" USING btree ("loop_run_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_loop_step_runs_run_node_attempt_idx" ON "agent_loop_step_runs" USING btree ("loop_run_id","node_id","attempt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loops_user_idx" ON "agent_loops" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loops_repo_idx" ON "agent_loops" USING btree ("repo_owner","repo_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_loops_status_idx" ON "agent_loops" USING btree ("status");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_agent_triggers" ADD CONSTRAINT "background_agent_triggers_loop_id_agent_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."agent_loops"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_triggers_loop_idx" ON "background_agent_triggers" USING btree ("loop_id");
--> statement-breakpoint
-- Check constraint: exactly one of (agent_id, loop_id) must be non-null.
-- Guarded so re-run on existing DB is a no-op.
DO $$ BEGIN
 ALTER TABLE "background_agent_triggers" ADD CONSTRAINT "background_agent_triggers_owner_check" CHECK (num_nonnulls(agent_id, loop_id) = 1);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
