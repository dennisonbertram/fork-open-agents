CREATE TABLE "repository_composio_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"inherit_global_defaults" boolean DEFAULT true NOT NULL,
	"allowed_profile_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_toolkit_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_composio_settings" ADD CONSTRAINT "repository_composio_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_composio_settings_user_idx" ON "repository_composio_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_composio_settings_repo_idx" ON "repository_composio_settings" USING btree ("user_id","repo_owner","repo_name");