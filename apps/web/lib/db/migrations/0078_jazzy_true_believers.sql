ALTER TABLE "delegated_worker_runs" ADD COLUMN "cleanup_status" text DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "cleanup_reason_code" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "cleanup_reason" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "cleanup_resource_id" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "cleanup_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "cleanup_attempted_at" timestamp;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "cleanup_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "recovered_at" timestamp;