CREATE TABLE "agent_tool_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"toolkit_slug" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_by_chat_id" text,
	"created_by_run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent_tool_entries" ADD CONSTRAINT "agent_tool_entries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_entries" ADD CONSTRAINT "agent_tool_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;