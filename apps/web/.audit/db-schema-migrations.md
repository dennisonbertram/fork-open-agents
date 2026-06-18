# DB Schema Integrity / FK / Transactions / Migration Safety Audit

Domain: DB schema integrity, FK/transaction boundaries, migration safety/drift.
Scope: `apps/web/lib/db` (schema.ts + migrations).

## Known lessons that bound this audit (do NOT re-report these if fixed)

- L16: After schema edits, review generated Drizzle migrations for unrelated schema drift (defaults on untouched columns) before committing.
- L150: FK constraints on event/run tables are invisible to mock tests — runtime-only PG 23503. Mock stores should enforce FK shape.

## Files read

- docs/agents/lessons-learned.md (full)
- apps/web/lib/db/schema.ts (2260 lines) — IN PROGRESS
- migrations dir listing (0063 entries, meta/ subdir)

## Candidate defects

(pending)

## Coverage gaps

(pending)
