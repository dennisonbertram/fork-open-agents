CREATE TABLE "agent_loop_tool_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"loop_run_id" text NOT NULL,
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
ALTER TABLE "agent_loop_tool_sessions" ADD CONSTRAINT "agent_loop_tool_sessions_loop_run_id_agent_loop_runs_id_fk" FOREIGN KEY ("loop_run_id") REFERENCES "public"."agent_loop_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_loop_tool_sessions" ADD CONSTRAINT "agent_loop_tool_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_loop_tool_sessions_run_idx" ON "agent_loop_tool_sessions" USING btree ("loop_run_id");--> statement-breakpoint
CREATE INDEX "agent_loop_tool_sessions_user_idx" ON "agent_loop_tool_sessions" USING btree ("user_id");