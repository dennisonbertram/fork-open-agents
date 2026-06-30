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

## Staging Lane

Do not make staging mandatory for every PR. Use staging for high-risk changes
where Vercel Preview cannot prove the real path, such as OAuth callbacks,
GitHub App installation, provider credentials, workflow/sandbox startup,
billing/cost paths, migrations, or external tool credentials.

The staging target is still an explicit product decision. Use either a Vercel
custom environment named `staging` or a separate Vercel project, whichever gives
cleaner OAuth, GitHub App, provider, and database isolation.

Staging evidence should name the source SHA, deployment URL or id, smoke result,
and rollback or fix-forward expectation.

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
vercel logs --project open-agents --environment production --status-code 500,502,503,504 --since 5m
```

## Production Ops Snapshot

Use the read-only snapshot before and after high-risk deploys, and when an
agent needs a single starting point for production diagnosis:

```bash
bun run ops:status -- --since 30m
```

The report includes live deployment metadata when Vercel access is available,
public smoke status, recent 5xx log samples, open PR blockers, latest
Production Smoke check state, explicit source gaps, and the next safe action.
It does not print env values, cookies, auth headers, prompts, or provider
tokens. Add `--strict` when a degraded public smoke or 5xx signal should fail
the command.

## Recurring Production Monitors

`Scheduled Production Smoke` runs every 30 minutes and can also be dispatched
manually. It checks `/`, `/api/auth/info`, and `/api/models` against the stable
production URL. Failures call the alert sink and then fail the workflow.

`Authenticated Production Canary` runs every six hours and can also be
dispatched manually. It is blocked by configuration until these values are set
for a disposable production test identity:

```env
PRODUCTION_CANARY_REPO=owner/repo
PRODUCTION_CANARY_IDENTITY=label-for-test-user
PRODUCTION_CANARY_AUTH_COOKIE=<GitHub Actions secret>
```

The canary first proves the authenticated account status route, then the account
diagnosis route. It reports `blocked_by_configuration` instead of partially
mutating production when the disposable identity or repo is missing.

## Alert Sink

Production monitors write owner-visible alerts to GitHub Issues in this fork.
The helper dedupes by `production-ops:<source>:<environment>`:

```bash
bun run ops:alert -- \
  --source public-smoke \
  --environment production \
  --status failing \
  --run-url "$RUN_URL" \
  --commit-sha "$SHA" \
  --summary "route /api/models failed"
```

Repeated failures comment on the existing open alert. Recovery runs add a
recovery comment. The helper redacts secret-like text before issue bodies or
comments are printed.

## Branch Safety Gates

Current branch protection requires these stable CI contexts for `develop` and
`main`:

1. `build`
2. `guards`
3. `lint-and-typecheck`

The deployment-status and scheduled checks below remain advisory until their
recent run history is stable enough to avoid blocking solo-founder velocity:

1. `Preview Smoke`
2. `API Contract Tests`
3. `Production Smoke`
4. `Scheduled Production Smoke`
5. `Authenticated Production Canary`

Record the before/after branch protection readback when changing GitHub
required checks.

```bash
gh api repos/dennisonbertram/fork-open-agents/branches/main/protection --jq '.required_status_checks'
gh api repos/dennisonbertram/fork-open-agents/branches/develop/protection --jq '.required_status_checks'
```

## Rollback

If production smoke fails and the issue is not immediately understood, roll
back first and debug second.

```bash
vercel rollback
vercel rollback status
vercel logs --project open-agents --environment production --status-code 500,502,503,504 --since 5m
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
