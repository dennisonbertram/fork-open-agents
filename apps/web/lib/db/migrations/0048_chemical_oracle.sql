CREATE TABLE "managed_runtime_worker_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text,
	"user_id" text NOT NULL,
	"workflow_run_id" text,
	"task_tool_call_id" text NOT NULL,
	"worker_type" text NOT NULL,
	"status" text NOT NULL,
	"sandbox_name" text,
	"profile_id" text,
	"profile_version" text,
	"profile_display_name" text,
	"profile_run_id" text,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_runtime_worker_runs" ADD CONSTRAINT "managed_runtime_worker_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_runtime_worker_runs" ADD CONSTRAINT "managed_runtime_worker_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_runtime_worker_runs" ADD CONSTRAINT "managed_runtime_worker_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_runtime_worker_runs" ADD CONSTRAINT "managed_runtime_worker_runs_profile_run_id_managed_runtime_profile_runs_id_fk" FOREIGN KEY ("profile_run_id") REFERENCES "public"."managed_runtime_profile_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "managed_runtime_worker_runs_session_task_idx" ON "managed_runtime_worker_runs" USING btree ("session_id","task_tool_call_id");--> statement-breakpoint
CREATE INDEX "managed_runtime_worker_runs_session_created_idx" ON "managed_runtime_worker_runs" USING btree ("session_id","created_at");