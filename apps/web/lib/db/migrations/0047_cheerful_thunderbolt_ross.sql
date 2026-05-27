CREATE TABLE IF NOT EXISTS "background_agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"agent_id" text,
	"user_id" text NOT NULL,
	"event_name" text NOT NULL,
	"status" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"summary" text,
	"request_id" text,
	"workflow_run_id" text,
	"sandbox_name" text,
	"error_kind" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redaction_status" text DEFAULT 'passed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_agent_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"url" text,
	"pr_number" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"trigger_id" text,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"trigger_kind" text NOT NULL,
	"external_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"ref" text,
	"sha" text,
	"branch" text,
	"pr_number" integer,
	"issue_number" integer,
	"deployment_url" text,
	"sandbox_name" text,
	"output_kind" text,
	"output_url" text,
	"error_kind" text,
	"error_message" text,
	"payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"workflow_run_id" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_agent_tool_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"profile_id" text,
	"agent_role" text NOT NULL,
	"phase" text NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_agent_tool_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"agent_id" text,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"profile_id" text,
	"agent_role" text NOT NULL,
	"phase" text NOT NULL,
	"provider_session_id" text,
	"config_hash" text,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_agent_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'enabled' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" text,
	"webhook_public_id" text,
	"webhook_secret_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'disabled' NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"instructions" text NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_mode" text DEFAULT 'none' NOT NULL,
	"check_command" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_events_run_id_background_agent_runs_id_fk' AND conrelid = 'background_agent_events'::regclass) THEN
    ALTER TABLE "background_agent_events" ADD CONSTRAINT "background_agent_events_run_id_background_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."background_agent_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_events_agent_id_background_agents_id_fk' AND conrelid = 'background_agent_events'::regclass) THEN
    ALTER TABLE "background_agent_events" ADD CONSTRAINT "background_agent_events_agent_id_background_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."background_agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_events_user_id_users_id_fk' AND conrelid = 'background_agent_events'::regclass) THEN
    ALTER TABLE "background_agent_events" ADD CONSTRAINT "background_agent_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_outputs_run_id_background_agent_runs_id_fk' AND conrelid = 'background_agent_outputs'::regclass) THEN
    ALTER TABLE "background_agent_outputs" ADD CONSTRAINT "background_agent_outputs_run_id_background_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."background_agent_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_outputs_user_id_users_id_fk' AND conrelid = 'background_agent_outputs'::regclass) THEN
    ALTER TABLE "background_agent_outputs" ADD CONSTRAINT "background_agent_outputs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_runs_agent_id_background_agents_id_fk' AND conrelid = 'background_agent_runs'::regclass) THEN
    ALTER TABLE "background_agent_runs" ADD CONSTRAINT "background_agent_runs_agent_id_background_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."background_agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_runs_trigger_id_background_agent_triggers_id_fk' AND conrelid = 'background_agent_runs'::regclass) THEN
    ALTER TABLE "background_agent_runs" ADD CONSTRAINT "background_agent_runs_trigger_id_background_agent_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."background_agent_triggers"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_runs_user_id_users_id_fk' AND conrelid = 'background_agent_runs'::regclass) THEN
    ALTER TABLE "background_agent_runs" ADD CONSTRAINT "background_agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_tool_grants_agent_id_background_agents_id_fk' AND conrelid = 'background_agent_tool_grants'::regclass) THEN
    ALTER TABLE "background_agent_tool_grants" ADD CONSTRAINT "background_agent_tool_grants_agent_id_background_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."background_agents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_tool_grants_user_id_users_id_fk' AND conrelid = 'background_agent_tool_grants'::regclass) THEN
    ALTER TABLE "background_agent_tool_grants" ADD CONSTRAINT "background_agent_tool_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_tool_sessions_run_id_background_agent_runs_id_fk' AND conrelid = 'background_agent_tool_sessions'::regclass) THEN
    ALTER TABLE "background_agent_tool_sessions" ADD CONSTRAINT "background_agent_tool_sessions_run_id_background_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."background_agent_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_tool_sessions_agent_id_background_agents_id_fk' AND conrelid = 'background_agent_tool_sessions'::regclass) THEN
    ALTER TABLE "background_agent_tool_sessions" ADD CONSTRAINT "background_agent_tool_sessions_agent_id_background_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."background_agents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_tool_sessions_user_id_users_id_fk' AND conrelid = 'background_agent_tool_sessions'::regclass) THEN
    ALTER TABLE "background_agent_tool_sessions" ADD CONSTRAINT "background_agent_tool_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_triggers_agent_id_background_agents_id_fk' AND conrelid = 'background_agent_triggers'::regclass) THEN
    ALTER TABLE "background_agent_triggers" ADD CONSTRAINT "background_agent_triggers_agent_id_background_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."background_agents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agent_triggers_user_id_users_id_fk' AND conrelid = 'background_agent_triggers'::regclass) THEN
    ALTER TABLE "background_agent_triggers" ADD CONSTRAINT "background_agent_triggers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'background_agents_user_id_users_id_fk' AND conrelid = 'background_agents'::regclass) THEN
    ALTER TABLE "background_agents" ADD CONSTRAINT "background_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_events_run_created_idx" ON "background_agent_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_events_request_idx" ON "background_agent_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_outputs_run_idx" ON "background_agent_outputs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_outputs_user_idx" ON "background_agent_outputs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_runs_agent_created_idx" ON "background_agent_runs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_runs_user_created_idx" ON "background_agent_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_runs_repo_created_idx" ON "background_agent_runs" USING btree ("repo_owner","repo_name","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "background_agent_runs_idempotency_idx" ON "background_agent_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_tool_grants_agent_idx" ON "background_agent_tool_grants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_tool_grants_user_idx" ON "background_agent_tool_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_tool_sessions_run_idx" ON "background_agent_tool_sessions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_tool_sessions_user_idx" ON "background_agent_tool_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_triggers_agent_idx" ON "background_agent_triggers" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agent_triggers_user_kind_idx" ON "background_agent_triggers" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "background_agent_triggers_webhook_public_idx" ON "background_agent_triggers" USING btree ("webhook_public_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agents_user_idx" ON "background_agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agents_repo_idx" ON "background_agents" USING btree ("repo_owner","repo_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_agents_status_idx" ON "background_agents" USING btree ("status");
