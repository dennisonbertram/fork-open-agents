CREATE TABLE "delegated_worker_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text,
	"user_id" text NOT NULL,
	"workflow_run_id" text,
	"parent_tool_call_id" text NOT NULL,
	"parent_worker_run_id" text,
	"worker_id" text NOT NULL,
	"worker_type" text NOT NULL,
	"task_title" text,
	"status" text NOT NULL,
	"reason_code" text NOT NULL,
	"requested_workspace_policy" text,
	"effective_workspace_policy" text,
	"workspace_mode" text,
	"workspace_id" text,
	"sandbox_name" text,
	"managed_runtime_profile_id" text,
	"managed_runtime_profile_version" text,
	"managed_runtime_profile_run_id" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lifecycle_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD CONSTRAINT "delegated_worker_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD CONSTRAINT "delegated_worker_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD CONSTRAINT "delegated_worker_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD CONSTRAINT "delegated_worker_runs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delegated_worker_runs_workflow_tool_call_idx" ON "delegated_worker_runs" USING btree ("workflow_run_id","parent_tool_call_id");--> statement-breakpoint
CREATE INDEX "delegated_worker_runs_session_created_idx" ON "delegated_worker_runs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "delegated_worker_runs_chat_created_idx" ON "delegated_worker_runs" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "delegated_worker_runs_status_idx" ON "delegated_worker_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "delegated_worker_runs_parent_worker_idx" ON "delegated_worker_runs" USING btree ("parent_worker_run_id");