-- Hand-edited for idempotency (Neon preview lesson):
-- - ALTER TABLE ADD COLUMN guarded via DO $$ ... EXCEPTION WHEN duplicate_column
-- Safe to run twice on a persistent Neon preview branch (the column may already
-- exist from a prior deploy of this branch under an earlier migration number).
DO $$ BEGIN
 ALTER TABLE "agents" ADD COLUMN "github_tools_enabled" boolean DEFAULT false NOT NULL;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
