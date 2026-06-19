ALTER TABLE "sessions" ADD COLUMN "full_clone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "sandbox_prewarm_run_id" text;