CREATE TABLE IF NOT EXISTS "workflow_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'expected' NOT NULL,
	"redaction_status" text DEFAULT 'pending' NOT NULL,
	"source_location" text,
	"summary" text,
	"created_by_actor" text,
	"workflow_run_id" text,
	"session_id" text,
	"chat_id" text,
	"goal_id" text,
	"gate_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_artifacts_workflow_run_idx" ON "workflow_artifacts" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_artifacts_kind_status_idx" ON "workflow_artifacts" USING btree ("kind","status");
