---
name: production-ops
description: Use when checking, deploying, debugging, or promoting Open Agents production; covers ops snapshot, public smoke, authenticated canary, env isolation, alert sink, scheduler catch-up, stuck-run sweeper, and branch safety gates.
---

Use this skill whenever the task involves production status, release promotion,
production incidents, scheduled monitors, environment isolation, branch
protection, or background-agent scheduler resilience.

## First Reads

Read these current repo files before acting:

- `docs/process/production-release-runbook.md`
- `docs/deployment/vercel-open-agents-setup.md`
- `docs/process/background-agents-live-proof.md`
- `.github/workflows/production-smoke.yml`
- `.github/workflows/scheduled-production-smoke.yml`
- `.github/workflows/authenticated-production-canary.yml`
- `apps/web/scripts/ops-status.ts`
- `apps/web/scripts/ops-env-isolation.ts`
- `apps/web/scripts/ops-authenticated-canary.ts`
- `apps/web/scripts/ops-alert.ts`

## Core Commands

Start with the read-only status snapshot:

```bash
bun run ops:status -- --since 30m
```

Check dev or preview backing-service isolation without printing raw env values:

```bash
bun run ops:env-isolation -- --compare dev
```

Run the authenticated production canary only when the disposable test identity
is configured:

```bash
bun run ops:authenticated-canary
```

Create or update a deduped owner-visible alert issue:

```bash
bun run ops:alert -- \
  --source public-smoke \
  --environment production \
  --status failing \
  --run-url "$RUN_URL" \
  --commit-sha "$SHA" \
  --summary "route /api/models failed"
```

## Operating Rules

- Never print secrets, raw env values, OAuth cookies, auth headers, diagnostic
  tokens, prompts, or provider tokens.
- Use source-gap language when access is missing; do not guess at production
  health from absent evidence.
- Treat `ops:status` as the first live diagnostic surface for an agent. It
  should report live deployment metadata, public smoke, recent 5xx logs, GitHub
  run state, source gaps, and next action.
- Treat `ops:env-isolation` as proof only when critical backing-service
  fingerprints differ from production. `isolation_violation` blocks destructive
  dev/preview testing.
- Treat `ops:authenticated-canary` as configuration-blocked unless
  `PRODUCTION_CANARY_REPO`, `PRODUCTION_CANARY_IDENTITY`, and
  `PRODUCTION_CANARY_AUTH_COOKIE` are configured for a disposable test path.
- Use `ops:alert` for scheduled monitor failure/recovery artifacts; dedupe is
  based on `production-ops:<source>:<environment>`.
- Background-agent cron now catches up a missed persisted `nextRunAt` window and
  sweeps stale queued/running runs with `background-agent.run.swept_stale`
  events.

## Release Promotion

Feature work lands in `develop`. Production promotion is a release PR from
`develop` to `main`.

Before merging to `develop`, require the stable branch gates:

- `lint-and-typecheck`
- `build`
- `guards`

After `develop` deploys, run or inspect dev smoke and `ops:status` where
available. For production promotion, merge the release PR to `main`, wait for
the production deployment, then run:

```bash
bun run ops:status -- --since 30m
DEPLOYMENT_URL=https://open-agents-azure-xi.vercel.app bun run --cwd apps/web preview:smoke
vercel logs --project open-agents --environment production --status-code 500,502,503,504 --since 30m
```

Do not claim production is agent-ready unless public smoke, authenticated canary
state, alert behavior, branch gates, and environment isolation state are all
explicitly known.
