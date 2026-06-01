DROP INDEX "workflow_run_controls_run_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_controls_run_id_unique" ON "workflow_run_controls" USING btree ("workflow_run_id");