# Development log — UX catalog browser walk (2026-08-20)

## Done

- Branched from `origin/develop` as `cursor/ux-browser-walk-b536`.
- Stood up local Postgres 16 + offline `./init.sh --offline`, migrated schema.
- Walked ~25 catalog stories across all 12 topic files with `agent-browser`.
- Wrote `docs/ux-paths/browser/walk-2026-08-20.md` + screenshots.
- Filed #1384–#1387.
- Assessed cloud UX walk feasibility; stopped without a fake harness —
  `docs/plans/cloud-ux-walk.md`.

## Incorrect assumptions

1. Assumed Neon `ep-old-union` would be available via Vercel env pull — this
   cloud VM had no Vercel CLI auth; local Postgres was the safe substitute.
2. Assumed seeding a GitHub account row was enough for authenticated walks —
   `GitHubReconnectGate` still blocked until `/api/github/connection-status`
   was network-mocked.
3. Assumed `/automations/background-agent` was a product list URL — it is
   captured by `/[username]/[repo]`.
4. Assumed F-025 (unbranded missing-session 404) was still true — branded
   `sessions/not-found.tsx` already ships.
5. Assumed a cloud session could walk authenticated UI today — browser tools
   exist, but neither sandbox-hosted app nor deployed test-auth bootstrap is
   available without new infrastructure.

## Follow-up (2026-08-20, later)

- Filed epic #1389 with the six-slice unblock plan (sign-out cookie fix,
  production hard-guard for test-auth, cookie-only bootstrap route, reconnect
  gate exception, Dev-only env flip, single-story cloud proof) and linked it
  from `docs/plans/cloud-ux-walk.md`.

## Global learnings

See `docs/agents/lessons-learned.md` (Auth / OAuth + Next.js bullets) and
`docs/learnings.md`.
