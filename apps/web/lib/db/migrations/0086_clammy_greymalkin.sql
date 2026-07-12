-- #962: additive, nullable columns preserve legacy rows. IF NOT EXISTS keeps
-- persistent Neon preview branches safe if the migration is replayed.
ALTER TABLE "background_agent_runs" ADD COLUMN IF NOT EXISTS "execution_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "background_agent_runs" ADD COLUMN IF NOT EXISTS "definition_version" integer;--> statement-breakpoint
ALTER TABLE "background_agent_runs" ADD COLUMN IF NOT EXISTS "definition_hash" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'background_agent_runs_execution_snapshot_all_or_none'
      AND conrelid = 'background_agent_runs'::regclass
  ) THEN
    ALTER TABLE "background_agent_runs"
      ADD CONSTRAINT "background_agent_runs_execution_snapshot_all_or_none"
      CHECK (
        num_nonnulls(execution_snapshot, definition_version, definition_hash) IN (0, 3)
        AND (
          num_nonnulls(execution_snapshot, definition_version, definition_hash) = 0
          OR (
            definition_version = 1
            AND definition_hash ~ '^[0-9a-f]{64}$'
            AND execution_snapshot ->> 'snapshotVersion' = definition_version::text
          )
        )
      );
  END IF;
END $$;
