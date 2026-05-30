CREATE TABLE "agent_api_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_id" text,
	"status" text DEFAULT 'accepted' NOT NULL,
	"idempotency_key_hash" text,
	"request_id" text,
	"session_id" text,
	"chat_id" text,
	"workflow_run_id" text,
	"prompt_message_id" text,
	"result_message_id" text,
	"title" text,
	"repository" jsonb,
	"runtime_mode" text NOT NULL,
	"managed_runtime_profile_id" text,
	"model_id" text,
	"inference_route" text,
	"inference_profile_id" text,
	"sandbox_name" text,
	"failure_kind" text,
	"failure_message" text,
	"failure_retryable" boolean,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text DEFAULT 'oa_' NOT NULL,
	"start" text NOT NULL,
	"last4" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"repository_policy" jsonb DEFAULT '{"allowedRepositories":null}'::jsonb NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"last_used_user_agent" text,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_window_ms" integer DEFAULT 60000 NOT NULL,
	"rate_limit_max" integer DEFAULT 60 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "agent_api_runs" ADD CONSTRAINT "agent_api_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_runs" ADD CONSTRAINT "agent_api_runs_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_runs" ADD CONSTRAINT "agent_api_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_runs" ADD CONSTRAINT "agent_api_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_runs" ADD CONSTRAINT "agent_api_runs_inference_profile_id_inference_profiles_id_fk" FOREIGN KEY ("inference_profile_id") REFERENCES "public"."inference_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_api_runs_user_created_idx" ON "agent_api_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_api_runs_token_created_idx" ON "agent_api_runs" USING btree ("token_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_api_runs_status_idx" ON "agent_api_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_api_runs_session_chat_idx" ON "agent_api_runs" USING btree ("session_id","chat_id");--> statement-breakpoint
CREATE INDEX "agent_api_runs_workflow_idx" ON "agent_api_runs" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "agent_api_runs_request_idx" ON "agent_api_runs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_api_runs_idempotency_idx" ON "agent_api_runs" USING btree ("user_id","token_id","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_tokens_start_idx" ON "api_tokens" USING btree ("start");