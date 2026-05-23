CREATE TABLE "managed_runtime_profile_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text,
	"user_id" text NOT NULL,
	"workflow_run_id" text,
	"sandbox_name" text,
	"profile_id" text NOT NULL,
	"profile_version" text NOT NULL,
	"profile_display_name" text NOT NULL,
	"status" text NOT NULL,
	"expected_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"optional_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"setup_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"failure_message" text,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"event_name" text NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"request_id" text,
	"workflow_run_id" text,
	"harness_run_id" text,
	"sandbox_name" text,
	"managed_runtime_profile_run_id" text,
	"service_id" text,
	"browser_run_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redaction_status" text DEFAULT 'passed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "runtime_mode" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "sandbox_name" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "managed_runtime_profile_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "managed_runtime_profile_version" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "managed_runtime_profile_run_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_runs" ADD CONSTRAINT "managed_runtime_profile_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_runs" ADD CONSTRAINT "managed_runtime_profile_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_runs" ADD CONSTRAINT "managed_runtime_profile_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_managed_runtime_profile_run_id_managed_runtime_profile_runs_id_fk" FOREIGN KEY ("managed_runtime_profile_run_id") REFERENCES "public"."managed_runtime_profile_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_service_id_sandbox_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sandbox_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_browser_run_id_sandbox_browser_runs_id_fk" FOREIGN KEY ("browser_run_id") REFERENCES "public"."sandbox_browser_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_runtime_profile_runs_session_created_idx" ON "managed_runtime_profile_runs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "managed_runtime_profile_runs_workflow_idx" ON "managed_runtime_profile_runs" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "managed_runtime_profile_runs_status_idx" ON "managed_runtime_profile_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "session_events_session_created_idx" ON "session_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "session_events_chat_created_idx" ON "session_events" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "session_events_workflow_idx" ON "session_events" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "session_events_request_idx" ON "session_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "session_events_profile_run_idx" ON "session_events" USING btree ("managed_runtime_profile_run_id");--> statement-breakpoint
CREATE INDEX "session_events_service_idx" ON "session_events" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "session_events_browser_run_idx" ON "session_events" USING btree ("browser_run_id");--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_managed_runtime_profile_run_id_managed_runtime_profile_runs_id_fk" FOREIGN KEY ("managed_runtime_profile_run_id") REFERENCES "public"."managed_runtime_profile_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runs_request_id_idx" ON "workflow_runs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_runtime_mode_idx" ON "workflow_runs" USING btree ("runtime_mode");--> statement-breakpoint
CREATE INDEX "workflow_runs_profile_run_idx" ON "workflow_runs" USING btree ("managed_runtime_profile_run_id");