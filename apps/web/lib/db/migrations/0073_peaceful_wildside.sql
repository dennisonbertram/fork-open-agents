CREATE TABLE IF NOT EXISTS "workflow_tool_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"approval_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"category" text,
	"reason" text,
	"session_id" text,
	"chat_id" text,
	"user_id" text,
	"decision" text DEFAULT 'pending' NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_tool_approvals_approval_id_unique" UNIQUE("approval_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_tool_approvals" ADD CONSTRAINT "workflow_tool_approvals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_tool_approvals" ADD CONSTRAINT "workflow_tool_approvals_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_tool_approvals" ADD CONSTRAINT "workflow_tool_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_tool_approvals_session_created_idx" ON "workflow_tool_approvals" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_tool_approvals_user_created_idx" ON "workflow_tool_approvals" USING btree ("user_id","created_at");
