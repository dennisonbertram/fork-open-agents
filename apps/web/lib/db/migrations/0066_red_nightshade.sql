CREATE TABLE "repository_sidebar_archives" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_sidebar_archives" ADD CONSTRAINT "repository_sidebar_archives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_sidebar_archives_user_idx" ON "repository_sidebar_archives" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_sidebar_archives_repo_idx" ON "repository_sidebar_archives" USING btree ("user_id","repo_owner","repo_name");