CREATE TABLE "workflow_run_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"pending_command_kind" text,
	"hook_token" text,
	"idempotency_key" text NOT NULL,
	"commanded_by" text,
	"commanded_at" timestamp,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run_controls" ADD CONSTRAINT "workflow_run_controls_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_controls" ADD CONSTRAINT "workflow_run_controls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_controls" ADD CONSTRAINT "workflow_run_controls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_run_controls_run_id_idx" ON "workflow_run_controls" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_run_controls_user_id_idx" ON "workflow_run_controls" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_controls_run_idempotency_idx" ON "workflow_run_controls" USING btree ("workflow_run_id","idempotency_key");