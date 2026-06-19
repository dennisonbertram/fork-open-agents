CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'main' NOT NULL,
	"scope" text DEFAULT 'user_default' NOT NULL,
	"session_id" text,
	"repo_owner" text,
	"repo_name" text,
	"model_id" text,
	"inference_profile_id" text,
	"instructions" text,
	"skill_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"builtin_tool_names" jsonb,
	"composio_toolkit_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"composio_profile_id" text,
	"managed_runtime_profile_id" text,
	"tool_authoring_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_inference_profile_id_inference_profiles_id_fk" FOREIGN KEY ("inference_profile_id") REFERENCES "public"."inference_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_user_idx" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agents_user_role_scope_idx" ON "agents" USING btree ("user_id","role","scope");--> statement-breakpoint
CREATE INDEX "agents_session_idx" ON "agents" USING btree ("session_id");