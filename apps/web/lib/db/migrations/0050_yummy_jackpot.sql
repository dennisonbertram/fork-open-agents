CREATE TABLE IF NOT EXISTS "workflow_goal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"goal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workflow_run_id" text,
	"session_id" text,
	"chat_id" text,
	"objective" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"plan" jsonb,
	"blocked_reason" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'workflow_goal_events_goal_id_workflow_goals_id_fk'
	) THEN
		ALTER TABLE "workflow_goal_events" ADD CONSTRAINT "workflow_goal_events_goal_id_workflow_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."workflow_goals"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'workflow_goal_events_user_id_users_id_fk'
	) THEN
		ALTER TABLE "workflow_goal_events" ADD CONSTRAINT "workflow_goal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'workflow_goals_user_id_users_id_fk'
	) THEN
		ALTER TABLE "workflow_goals" ADD CONSTRAINT "workflow_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'workflow_goals_workflow_run_id_workflow_runs_id_fk'
	) THEN
		ALTER TABLE "workflow_goals" ADD CONSTRAINT "workflow_goals_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'workflow_goals_session_id_sessions_id_fk'
	) THEN
		ALTER TABLE "workflow_goals" ADD CONSTRAINT "workflow_goals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'workflow_goals_chat_id_chats_id_fk'
	) THEN
		ALTER TABLE "workflow_goals" ADD CONSTRAINT "workflow_goals_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_goal_events_goal_seq_idx" ON "workflow_goal_events" USING btree ("goal_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_goal_events_goal_created_idx" ON "workflow_goal_events" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_goals_user_created_idx" ON "workflow_goals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_goals_workflow_run_idx" ON "workflow_goals" USING btree ("workflow_run_id");