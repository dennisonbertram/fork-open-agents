# Production Release Runbook

Use this runbook when a PR is ready to move from Preview or staging to
production.

## Before Merge

Required for every non-trivial PR:

1. CI is green.
2. Vercel Preview deployment is ready.
3. Preview smoke passed.
4. PR lists risk tier, test evidence, deploy notes, and rollback plan.
5. Agent Browser Preview review is recorded for browser-visible changes.

Required for high-risk PRs:

1. staging smoke is recorded,
2. migration compatibility is classified,
3. live-service risks are named,
4. rollback is either app-only or explicitly fix-forward.

High-risk surfaces include auth, ownership, secrets, billing, inference,
GitHub App, sandbox, workflows, and migrations.

## Current Release Path

The repo uses a speed-first path:

1. merge a protected PR to `main`,
2. let Vercel deploy production from `main`,
3. smoke production immediately,
4. roll back quickly if smoke fails.

Move to explicit manual promotion later if production deploys become frequent
enough that automatic `main` deploys create coordination problems.

## Production Smoke

The `Production Smoke` GitHub workflow
(`.github/workflows/production-smoke.yml`) runs the smoke checks automatically
when Vercel reports a successful production deployment, so a broken production
turns the commit's checks red without waiting for a human. It does not
auto-roll-back; use the manual path below. Still record the run by hand for
high-risk changes.

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
