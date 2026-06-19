CREATE TABLE "repository_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"full_clone" boolean,
	"prewarm_enabled" boolean,
	"runtime_mode" text,
	"managed_runtime_profile_id" text,
	"vcpus" integer,
	"auto_commit_push" boolean,
	"auto_create_pr" boolean,
	"default_branch" text,
	"is_new_branch" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_settings" ADD CONSTRAINT "repository_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_settings_user_idx" ON "repository_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_settings_repo_idx" ON "repository_settings" USING btree ("user_id","repo_owner","repo_name");