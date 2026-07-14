ALTER TABLE "agent_loop_step_runs" ADD COLUMN "execution_claim_generation" text;
UPDATE "agent_loop_step_runs"
SET "execution_claim_generation" = "step_input" ->> 'executionClaimGeneration'
WHERE "step_input" ->> 'executionClaimGeneration' IS NOT NULL;
