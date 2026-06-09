CREATE TABLE "repo_learning_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"learning_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"excerpt" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_learning_extraction_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"background_agent_run_id" text,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"pr_number" integer,
	"trigger_kind" text NOT NULL,
	"candidates_extracted" integer DEFAULT 0 NOT NULL,
	"accepted" integer DEFAULT 0 NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"error_kind" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_learnings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"installation_id" integer,
	"type" text NOT NULL,
	"scope" text DEFAULT 'repo' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"root_cause" text,
	"solution" text,
	"prevention" text,
	"affected_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"dedup_signature" text NOT NULL,
	"supersedes_learning_id" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"source_pr_number" integer,
	"source_pr_url" text,
	"committed_file_path" text,
	"created_by" text DEFAULT 'pr_review_learnings_agent' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_learning_evidence" ADD CONSTRAINT "repo_learning_evidence_learning_id_repo_learnings_id_fk" FOREIGN KEY ("learning_id") REFERENCES "public"."repo_learnings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_learning_extraction_runs" ADD CONSTRAINT "repo_learning_extraction_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_learnings" ADD CONSTRAINT "repo_learnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_learning_evidence_learning" ON "repo_learning_evidence" USING btree ("learning_id");--> statement-breakpoint
CREATE INDEX "idx_learning_extraction_repo" ON "repo_learning_extraction_runs" USING btree ("user_id","repo_owner","repo_name");--> statement-breakpoint
CREATE INDEX "idx_repo_learnings_repo" ON "repo_learnings" USING btree ("user_id","repo_owner","repo_name");--> statement-breakpoint
CREATE INDEX "idx_repo_learnings_status" ON "repo_learnings" USING btree ("user_id","status","last_used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_repo_learnings_dedup" ON "repo_learnings" USING btree ("user_id","repo_owner","repo_name","dedup_signature");