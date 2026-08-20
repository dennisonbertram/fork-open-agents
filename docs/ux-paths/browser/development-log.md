# Development log — cloud UX walk unblock (2026-08-20)

## Done

- Branched `cursor/cloud-ux-walk-unblock-b536` from `origin/develop`.
- Implemented epic #1389 slices 1–4 tests-first:
  - Sign out deletes `open_agents_test_user_id` (#1386).
  - `VERCEL_ENV=production` hard-refuses test-auth (Guard Integrity).
  - `GET /api/dev/test-auth` cookie-only bootstrap + idempotent seed.
  - Connection-status short-circuit for the demo user.
- Documented remaining operator work (Dev env var) and the unfaked
  STORY-158 proof.

## Incorrect assumptions

1. Assumed Turbo needed `NODE_ENV` in its build env allowlist because
   `isTestAuthEnabled()` reads it — runtime builtins are not Turbo inputs.
2. Assumed the seed should store a placeholder GitHub token — that would
   send garbage to the GitHub API from other callers. Null token + status
   bypass is the safer pair.
3. Assumed this VM could flip the Dev env var (slice 5) — no Vercel CLI
   auth, so that slice stays an operator action.

## Global learnings

See `docs/agents/lessons-learned.md` (Auth / OAuth) and `docs/learnings.md`.
