# Production Release Runbook

Use this runbook when a change is ready to move from PR Preview to shared dev,
then from shared dev to production.

## Before Merge

Required for every non-trivial PR:

1. CI is green.
2. Vercel Preview deployment is ready.
3. Preview smoke passed.
4. PR lists risk tier, test evidence, deploy notes, and rollback plan.
5. Agent Browser Preview review is recorded for browser-visible changes.

Required for high-risk PRs:

1. dev smoke is recorded,
2. migration compatibility is classified,
3. live-service risks are named,
4. rollback is either app-only or explicitly fix-forward.

High-risk surfaces include auth, ownership, secrets, billing, inference,
GitHub App, sandbox, workflows, and migrations.

## Current Release Path

The repo uses an explicit dev-before-production path:

1. merge a protected feature PR to `develop`,
2. let Vercel deploy `develop` to the shared `dev` environment,
3. smoke the shared dev deployment,
4. open and merge a release PR from `develop` to `main`,
5. let Vercel deploy production from `main`,
6. smoke production immediately,
7. roll back quickly if smoke fails.

For backlogged PRs, merge feature work into `develop` first, prove it in the
shared dev deployment, and then promote the accumulated, tested changes with a
release PR from `develop` to `main`. Do not merge backlogged feature PRs
directly to `main` unless they are explicit production hotfixes.

Vercel target mapping:

1. `dev` custom environment tracks `develop`.
2. `Production` tracks `main`.
3. `Preview` handles all unassigned branches and PR previews.

Keep production as a separate build/deploy from the same reviewed commit line
instead of promoting a dev-built deployment. The dev target has its own
environment variables, so a dev deployment should not be aliased directly to
production.

Dev must be production-shaped but service-isolated before it is used for risky
live testing. Confirm the dev database, Redis/KV, auth callbacks, GitHub App
webhook, and canonical URL are not production resources before running
destructive flows, migration tests, background-agent dispatch, or sandbox
workflow tests.

## Dev Smoke

After `develop` deploys to `dev`, record:

1. commit SHA,
2. Vercel dev deployment URL or id,
3. stable dev alias,
4. whether service isolation has been verified,
5. smoke result,
6. release PR URL when promoting to production.

Current stable dev alias:

```text
https://open-agents-env-dev-dennisons-projects.vercel.app
```

Minimal smoke:

```bash
DEPLOYMENT_URL=https://open-agents-env-dev-dennisons-projects.vercel.app \
  bun run --cwd apps/web preview:smoke
```

For UI changes, also run Agent Browser against the dev deployment:

```bash
agent-browser --session "dev-smoke-<sha>" open "<dev-deployment-url>"
agent-browser snapshot -i
agent-browser errors
agent-browser console
```

## Production Smoke

After production deploys, record:

1. commit SHA,
2. Vercel deployment URL or id,
3. production URL,
4. smoke result,
5. rollback command/path.

Minimal smoke:

```bash
DEPLOYMENT_URL=https://open-agents-azure-xi.vercel.app \
  bun run --cwd apps/web preview:smoke
```

For UI changes, also run Agent Browser against production:

```bash
agent-browser --session "prod-smoke-<sha>" open "https://open-agents-azure-xi.vercel.app"
agent-browser snapshot -i
agent-browser errors
agent-browser console
```

For high-risk changes, inspect recent production errors:

```bash
vercel logs --environment production --status-code 5xx --since 5m
```

## Rollback

If production smoke fails and the issue is not immediately understood, roll
back first and debug second.

```bash
vercel rollback
vercel rollback status
vercel logs --environment production --status-code 5xx --since 5m
```

On plans that support rolling back to a specific deployment:

```bash
vercel rollback <deployment-url>
```

## Migration Rollback Rule

Schema changes must state whether rollback is:

1. app-only rollback,
2. app rollback with forward-compatible database state,
3. fix-forward only because the migration is not safely reversible.

Do not ship destructive migrations in the same PR that removes the app fallback.
