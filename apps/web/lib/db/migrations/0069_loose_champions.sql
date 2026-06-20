ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "full_clone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "sandbox_prewarm_run_id" text;
