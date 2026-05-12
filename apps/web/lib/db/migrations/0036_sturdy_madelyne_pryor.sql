CREATE TABLE "verified_build_events" (
	"id" text PRIMARY KEY NOT NULL,
	"verified_build_run_id" text NOT NULL,
	"harness_event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"event_payload" jsonb NOT NULL,
	"event_at" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "verified_build_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"harness_run_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text,
	"actor_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"intent_summary" text,
	"selection_reason" text,
	"last_event_id" text,
	"last_event_name" text,
	"last_event_at" timestamp,
	"plan_approval_state" text DEFAULT 'not_required' NOT NULL,
	"pending_approval_kind" text,
	"final_report_artifact_id" text,
	"go_no_go" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "verified_build_runs_harness_run_id_unique" UNIQUE("harness_run_id")
);
--> statement-breakpoint
ALTER TABLE "verified_build_events" ADD CONSTRAINT "verified_build_events_verified_build_run_id_verified_build_runs_id_fk" FOREIGN KEY ("verified_build_run_id") REFERENCES "public"."verified_build_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_build_runs" ADD CONSTRAINT "verified_build_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_build_runs" ADD CONSTRAINT "verified_build_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_build_runs" ADD CONSTRAINT "verified_build_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "verified_build_events_run_event_idx" ON "verified_build_events" USING btree ("verified_build_run_id","harness_event_id");--> statement-breakpoint
CREATE INDEX "verified_build_events_run_received_idx" ON "verified_build_events" USING btree ("verified_build_run_id","received_at");--> statement-breakpoint
CREATE INDEX "verified_build_runs_session_chat_idx" ON "verified_build_runs" USING btree ("session_id","chat_id");--> statement-breakpoint
CREATE INDEX "verified_build_runs_user_status_idx" ON "verified_build_runs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "verified_build_runs_harness_run_id_idx" ON "verified_build_runs" USING btree ("harness_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verified_build_runs_idempotency_idx" ON "verified_build_runs" USING btree ("tenant_id","project_id","actor_id","idempotency_key");