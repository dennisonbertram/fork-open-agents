-- migration-safety: fix-forward preserves Run history by replacing the source FK; reverting is unsafe after retained rows become null.
ALTER TABLE "agent_loop_runs" DROP CONSTRAINT "agent_loop_runs_loop_id_agent_loops_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_loop_runs" ALTER COLUMN "loop_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_loop_runs" ADD CONSTRAINT "agent_loop_runs_loop_id_agent_loops_id_fk" FOREIGN KEY ("loop_id") REFERENCES "public"."agent_loops"("id") ON DELETE set null ON UPDATE no action;
