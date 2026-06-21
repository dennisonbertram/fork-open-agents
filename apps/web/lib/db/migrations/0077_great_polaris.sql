ALTER TABLE "delegated_worker_runs" ADD COLUMN "completion_packet" jsonb;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "completion_packet_validation_status" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "completion_packet_validation_reason_code" text;--> statement-breakpoint
ALTER TABLE "delegated_worker_runs" ADD COLUMN "completion_packet_validation_reason" text;