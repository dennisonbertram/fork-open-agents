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
vercel logs --scope <team-or-org-id> --project <project-id> --environment production --status-code 500,502,503,504 --since 5m
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
tokens. Add `--strict` when any blocked, degraded, unknown, or otherwise
non-healthy proof source should fail the command.

## Recurring Production Monitors

`Scheduled Production Smoke` runs every 30 minutes and can also be dispatched
manually. It checks `/`, `/api/auth/info`, and `/api/models` against the stable
production URL. Failures call the alert sink and then fail the workflow.

`Authenticated Production Canary` runs every six hours and can also be
dispatched manually. It has three legs — `account-status` (the original
authenticated account status/diagnosis proof), `background-agents-journey`
(the full create/enable/dispatch/cleanup background-agent journey from
`background-agents:journey-proof`), and `loops-journey` (the equivalent
agent-loop journey from `loops:journey-proof`) — all gated by the same four
values for a disposable production test identity. Scheduled and manually
dispatched monitoring always sets `PRODUCTION_CANARY_REQUIRE_CONFIG=true`.
Each leg runs as an independent `continue-on-error: true` step so aggregation
can still run, but it captures the real command exit before the pipeline and
exports one of these classifications:

- exit `0`: `passed` — the journey actually executed and passed;
- exit `1`: `failed` — an executed journey failed or timed out;
- exit `2`: `blocked_by_configuration` — required configuration was missing or
  malformed, so no production proof occurred.

The always-run aggregator writes all three classifications and the workflow run
URL to the GitHub step summary. It opens/updates the deduplicated alert for a
failed or blocked leg, and a final gate keeps the workflow red unless all three
classifications are `passed`. Local CLI diagnostics remain backward compatible:
without strict mode a configuration block is printed loudly but exits `0`.

Provisioning (all four values are required for any leg to run for real;
otherwise every production-monitor leg reports `blocked_by_configuration`, the
workflow remains red, and no recovery/proof claim is emitted):

- GitHub Actions **variables** (repo settings → Secrets and variables →
  Actions → Variables):
  - `PRODUCTION_URL` — optional; the workflow falls back to the stable
    production URL if unset.
  - `PRODUCTION_CANARY_REPO` — `owner/repo` of the disposable repo used for
    both the background-agent and loop journeys.
  - `PRODUCTION_CANARY_IDENTITY` — a human-readable label for the disposable
    test user (not a secret, just identifies which account the cookie
    belongs to).
- GitHub Actions **secret**:
  - `PRODUCTION_CANARY_AUTH_COOKIE` — the disposable identity's Better Auth
    session cookie. Set it from stdin, never argv or shell history:
    `gh secret set PRODUCTION_CANARY_AUTH_COOKIE --repo dennisonbertram/fork-open-agents`
    then paste the cookie value and press Ctrl-D.

Minting the cookie safely: sign in to production as the disposable identity
in a private/incognito browser window, then copy the Better Auth session
cookie from devtools (the full `Cookie` header value works — the harnesses
send it verbatim). The local dev-only `open_agents_test_user_id` test-auth
cookie does **not** work in production, because
`OPEN_AGENTS_ENABLE_TEST_AUTH` is unset there — a real authenticated session
cookie is required. `apps/web/lib/auth/config.ts` does not override
better-auth's default session lifetime, so verify the actual expiry and set
a rotation reminder shorter than it; never paste the cookie value into
issues, PRs, or logs.

Production prerequisites for the two journey legs (beyond the four values
above): the disposable repo must be present in both
`BACKGROUND_AGENTS_ALLOWED_REPOS` and `AGENT_LOOPS_ALLOWED_REPOS`,
`AGENT_LOOPS_ENABLED=true` must be set in the production Vercel environment,
and the GitHub App must be installed on the disposable repo.
Both allowlists fail closed when missing, blank, malformed, or when `*` is
mixed with repository entries. Exact `*` is a deliberate allow-all override;
do not use it to bypass repository inventory before a release. Readiness
reports only policy state and valid-entry count, never raw malformed values.

Debugging blocked vs. failed: inspect the workflow step summary first, which
lists `account-status`, `background-agents-journey`, and `loops-journey` with
their safe classification and workflow run URL. `blocked_by_configuration`
means the leg was skipped because configuration was missing or malformed;
`failed` means a configured journey executed and failed/timed out, or the step
could not export a valid classification. Then inspect only the named leg and
the deduplicated production-ops issue. Never print the cookie or headers.

Recovery is emitted only when all three classifications are `passed`, using the
copy "All three authenticated production canary journeys passed." A blocked leg
is never treated as recovered, green, or production proof.

Failure classification: both journey legs intentionally run with
`BACKGROUND_AGENT_PROOF_REQUIRE_SUCCEEDED` /
`LOOP_JOURNEY_PROOF_REQUIRE_SUCCEEDED` unset, so any run that reaches a
typed terminal status counts as journey-passed — the canary proves the
journey *mechanics* (create/enable/dispatch/poll/cleanup reach a terminal
state), not that every run *succeeds*. Only broken mechanics (a
`dispatch_failed`/`workflow_failed`/`turn_budget_exceeded` status, or a
missing started event, or no terminal state reached by the deadline) fail a
leg.

Known residual gap: the agent-loop journey can legitimately take up to ~20
minutes; if the job's overall 40-minute timeout is hit mid-journey, GitHub
Actions cancels the in-flight steps (outcome `cancelled`, not `failure`), so
the alert step is skipped and no deduped issue is filed even though the run
shows red in the Actions UI — treat a cancelled/timed-out run as equivalent
to a failure when reviewing it manually.

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

Incident titles are status-neutral (`[production-ops] <source> in
<environment>`) so the title remains accurate across the alert lifecycle.
Repeated failures comment on the existing open alert. Recovery runs add a
recovery comment only when a matching open incident exists; recovery without
an open incident is a no-op and does not create an issue. Recovered issues stay
open as the dedupe target for later observations. The helper redacts
secret-like text before issue bodies, comments, or command errors are printed.

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
vercel logs --scope <team-or-org-id> --project <project-id> --environment production --status-code 500,502,503,504 --since 5m
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
