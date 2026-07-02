-- #743: background_agent_events (run_id, sequence) becomes a UNIQUE index.
-- recordBackgroundAgentEvent computes max(sequence)+1 non-atomically, so two
-- concurrent writers for the same run could previously compute and persist
-- the same sequence, silently colliding in the SSE run timeline. The unique
-- index makes a colliding insert fail instead, and the application retries
-- with a freshly computed max+1 (store.ts recordBackgroundAgentEvent).
--
-- This migration is idempotent so it is safe to re-run against a Neon
-- preview branch that already applied it (see docs/agents/lessons-learned.md
-- "Neon preview migration renumber"):
--   1. Re-sequence any existing duplicate (run_id, sequence) rows first, so
--      the unique index can actually be created. This is a single set-based
--      UPDATE: for each run, any row past the first occurrence of a
--      duplicated sequence value is bumped past that run's current max
--      sequence, ordered by (created_at, id) for a stable, deterministic
--      result. Running this UPDATE again on an already-deduplicated table is
--      a no-op (no group has count(*) > 1 left).
--   2. Drop the old plain index and (re)create the unique index using
--      IF EXISTS / IF NOT EXISTS guards.
WITH ranked AS (
  SELECT
    id,
    run_id,
    sequence,
    row_number() OVER (
      PARTITION BY run_id, sequence
      ORDER BY created_at ASC, id ASC
    ) AS occurrence,
    max(sequence) OVER (PARTITION BY run_id) AS run_max_sequence
  FROM background_agent_events
  WHERE sequence IS NOT NULL
),
duplicates AS (
  SELECT
    id,
    run_max_sequence + row_number() OVER (
      PARTITION BY run_id
      ORDER BY id
    ) AS new_sequence
  FROM ranked
  WHERE occurrence > 1
)
UPDATE background_agent_events AS e
SET sequence = duplicates.new_sequence
FROM duplicates
WHERE e.id = duplicates.id;
--> statement-breakpoint
DROP INDEX IF EXISTS "background_agent_events_run_seq_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "background_agent_events_run_seq_idx" ON "background_agent_events" USING btree ("run_id","sequence");
