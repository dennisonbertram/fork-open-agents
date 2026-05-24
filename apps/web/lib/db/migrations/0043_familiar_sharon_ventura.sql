ALTER TABLE "managed_runtime_profile_drafts" ADD COLUMN "test_results" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_drafts" ADD COLUMN "test_failure_message" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_profile_drafts" ADD COLUMN "tested_at" timestamp;