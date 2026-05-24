CREATE TABLE "managed_runtime_saved_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"source_draft_id" text,
	"scope" text DEFAULT 'session' NOT NULL,
	"version" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"setup_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"optional_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_runtime_saved_profiles" ADD CONSTRAINT "managed_runtime_saved_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_runtime_saved_profiles" ADD CONSTRAINT "managed_runtime_saved_profiles_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_runtime_saved_profiles_user_idx" ON "managed_runtime_saved_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "managed_runtime_saved_profiles_session_idx" ON "managed_runtime_saved_profiles" USING btree ("session_id");