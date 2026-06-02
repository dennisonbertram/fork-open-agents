CREATE TABLE "workflow_input_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"workflow_id" text,
	"schema_version" text,
	"input_values" jsonb NOT NULL,
	"persisted_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_input_snapshots" ADD CONSTRAINT "workflow_input_snapshots_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_input_snapshots_run_id_idx" ON "workflow_input_snapshots" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_input_snapshots_run_id_unique" ON "workflow_input_snapshots" USING btree ("workflow_run_id");