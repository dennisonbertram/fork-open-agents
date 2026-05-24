CREATE TABLE "composio_agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"agent_key" text NOT NULL,
	"profile_id" text NOT NULL,
	"config_hash" text NOT NULL,
	"composio_session_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "composio_tool_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"toolkit_slugs" jsonb NOT NULL,
	"auth_config_ids_by_toolkit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_account_ids_by_toolkit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workbench_enabled" boolean DEFAULT false NOT NULL,
	"allow_in_chat_connection_management" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "composio_selection" jsonb DEFAULT '{"mainProfileId":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "composio_agent_defaults" jsonb DEFAULT '{"main":{"defaultProfileId":null,"allowChatOverride":true},"explorer":{"defaultProfileId":null,"allowChatOverride":false},"executor":{"defaultProfileId":null,"allowChatOverride":false},"design":{"defaultProfileId":null,"allowChatOverride":false}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "composio_agent_sessions" ADD CONSTRAINT "composio_agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composio_agent_sessions" ADD CONSTRAINT "composio_agent_sessions_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composio_agent_sessions" ADD CONSTRAINT "composio_agent_sessions_profile_id_composio_tool_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."composio_tool_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composio_tool_profiles" ADD CONSTRAINT "composio_tool_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composio_agent_sessions_user_idx" ON "composio_agent_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "composio_agent_sessions_chat_idx" ON "composio_agent_sessions" USING btree ("chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "composio_agent_sessions_lookup_idx" ON "composio_agent_sessions" USING btree ("user_id","chat_id","agent_key","profile_id","config_hash");--> statement-breakpoint
CREATE INDEX "composio_tool_profiles_user_idx" ON "composio_tool_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "composio_tool_profiles_user_name_idx" ON "composio_tool_profiles" USING btree ("user_id","name");