ALTER TABLE "delegated_worker_runs" ADD COLUMN "source_workspace_id" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "source_commit" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "child_workspace_id" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "child_workspace_created_at" timestamp;