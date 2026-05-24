ALTER TABLE "managed_runtime_saved_profiles" ADD COLUMN "latest_test_run_id" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_saved_profiles" ADD COLUMN "test_results" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_runtime_saved_profiles" ADD COLUMN "test_failure_message" text;--> statement-breakpoint
ALTER TABLE "managed_runtime_saved_profiles" ADD COLUMN "tested_at" timestamp;