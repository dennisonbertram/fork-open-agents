CREATE TABLE "managed_runtime_profile_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text,
	"tool_call_id" text NOT NULL,
	"status" text DEFAULT 'draft_ready' NOT NULL,
	"target_scope" text DEFAULT 'session' NOT NULL,
	"goal" text NOT NULL,
	"repo_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile_draft" jsonb NOT NULL,
	"questions_for_user" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latest_test_run_id" text,
	"user_instructions" text,
	"user_decision" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_drafts" ADD CONSTRAINT "managed_runtime_profile_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_drafts" ADD CONSTRAINT "managed_runtime_profile_drafts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_drafts" ADD CONSTRAINT "managed_runtime_profile_drafts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_runtime_profile_drafts_session_created_idx" ON "managed_runtime_profile_drafts" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "managed_runtime_profile_drafts_chat_idx" ON "managed_runtime_profile_drafts" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "managed_runtime_profile_drafts_tool_call_idx" ON "managed_runtime_profile_drafts" USING btree ("session_id","tool_call_id");