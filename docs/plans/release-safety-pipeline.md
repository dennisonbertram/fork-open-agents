# Release Safety Pipeline Plan

## Summary

Add a release pipeline that keeps velocity high while making production hard to
break: branch-protected PRs, Vercel Preview review with Agent Browser, a stable
staging environment for authenticated/live-service paths, explicit production
smoke, and a rollback runbook.

This is an epic-sized process/platform effort. Implement it as PR-sized slices.

## Current State

- The repo already has strong local engineering rules:
  - issue-sized work in `docs/process/github-build-process.md`
  - behavior-first TDD in `docs/process/development-workflow.md`
  - observability requirements in `docs/process/observability-discipline.md`
  - PR deployment notes in `.github/pull_request_template.md`
- CI exists in `.github/workflows/ci.yml` and runs:
  - `bun run check`
  - `bun run typecheck`
  - `bun run test:isolated`
  - `bun run --cwd apps/web db:check`
- GitHub `main` now has low-friction branch protection:
  - pull requests are required
  - `lint-and-typecheck` is required and must be up to date
  - conversation resolution is required
  - administrators are included
  - force pushes and branch deletion are blocked
  - approvals are not required yet, to preserve solo-maintainer speed
- The Vercel project is linked and configured correctly for the app:
  - project: `dennisons-projects/open-agents`
  - root directory: `apps/web`
  - framework: Next.js
  - install command: `bun install`
  - build command: `bun run build`
  - Node.js: 24.x
- Vercel deployments currently include both Production and Preview deployments.
- Vercel env shape has an important gap:
  - Neon/Postgres and Redis/KV values exist for Production, Preview, and
    Development.
  - Vercel OAuth and GitHub App values exist for Production and Development,
    but not Preview.
  - That means ordinary previews are useful for unauthenticated UI and route
    smoke, but not for the full signed-in GitHub/sandbox/inference path.
- There is no configured custom staging environment visible in the env listing.

## Research Findings

- Vercel supports Custom Environments such as `staging` or `QA` on Pro and
  Enterprise plans. Custom environments can have their own environment variables
  and can be deployed through `vercel deploy --target=staging`.
- Vercel Preview deployments can be tested by automation. For protected
  deployments, Vercel supports a project-level automation bypass secret sent as
  `x-vercel-protection-bypass`.
- For browser automation against a protected deployment, Vercel supports setting
  a bypass cookie with `x-vercel-set-bypass-cookie: true`.
- Vercel can promote a preview deployment to production with `vercel promote`,
  but promotion rebuilds with production environment variables. Treat promotion
  as "same source commit, production build", not as immutable artifact
  promotion.
- Vercel production rollback is available with `vercel rollback`; on Hobby it
  rolls back to the immediately previous production deployment, while Pro and
  Enterprise can roll back to a specific deployment URL.
- Agent Browser can open remote `https://` preview URLs, send custom headers,
  capture snapshots/screenshots, inspect console/errors/network, and exercise
  product paths manually.

Sources:

- Context7 library: `/websites/vercel`
- Vercel environments:
  https://vercel.com/docs/deployments/environments
- Vercel automated/agent access:
  https://vercel.com/docs/deployment-protection/automated-agent-access
- Vercel protection bypass:
  https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
- Vercel promote preview to production:
  https://vercel.com/docs/deployments/promote-preview-to-production
- Vercel rollback production:
  https://vercel.com/docs/deployments/rollback-production-deployment

## Target Release Model

Use four gates:

1. Local gate
   - developer/agent runs targeted tests
   - `git diff --check`
   - `bun --bun run ci`
   - local Agent Browser smoke for UI changes
2. PR Preview gate
   - Vercel Preview deployment for every PR
   - automated preview smoke after `deployment_status: success`
   - manual Agent Browser review of the Preview URL for visible changes
   - no production secrets or production data
3. Staging gate
   - stable `staging` Vercel custom environment
   - isolated staging Neon database
   - isolated staging Upstash Redis/KV
   - stable staging URL registered with Vercel OAuth and GitHub App callbacks
   - live signed-in smoke for auth, GitHub App, sandbox, workflows, AI Gateway,
     Composio, and future user-owned inference profiles
4. Production gate
   - branch-protected merge to `main`
   - production deploy or promotion only after preview and staging evidence
   - immediate production smoke
   - rollback path recorded in the PR/release notes

## Source Of Truth

Before:

- Local CI output and production behavior are the main proof that a change is
  safe.
- Vercel production aliases move frequently after direct `main` work.
- Preview deployments exist, but they are not a required review gate.
- Authenticated/live-service proof is mostly manual and production-adjacent.

After:

- GitHub PR status is the source of truth for code review and automated gates.
- Vercel Preview deployment URL is the source of truth for per-PR visual review.
- Staging deployment URL is the source of truth for signed-in/live-service
  release proof.
- PR/release notes record test output, Agent Browser evidence, staging smoke,
  production smoke, deployment id/URL, and rollback path.
- Production is only a final confirmation, not the first realistic test.

## Implementation Slices

### Slice 1: Protect `main` and tighten PR requirements

Goal: stop accidental production-bound direct pushes.

Status: implemented for the low-friction first phase on 2026-05-25.

Tasks:

- Enable GitHub branch protection or a ruleset for `main`:
  - require pull request before merge
  - require current CI workflow
  - block force pushes
  - block branch deletion
  - require conversation resolution
  - include administrators
- Defer one required approval until there is a second regular reviewer.
- Update `docs/process/github-build-process.md` with the enforced rule.
- Update `.github/pull_request_template.md` with explicit Preview/Staging/Prod
  smoke checkboxes.

Verification:

- `gh api repos/dennisonbertram/fork-open-agents/branches/main/protection`
  returns configured protection, or rulesets API returns an active ruleset.
- A test branch cannot push directly to `main`.
- CI remains required on PRs.

### Slice 2: Add automated Preview smoke

Goal: every successful Vercel Preview gets a low-cost automated health check.

Status: implemented in repo; must be proven on the next Preview deployment.

Tasks:

- Add a script such as `apps/web/scripts/preview-smoke.ts`.
- Script inputs:
  - `DEPLOYMENT_URL`
  - optional `VERCEL_AUTOMATION_BYPASS_SECRET`
- Script behavior:
  - add `x-vercel-protection-bypass` when the bypass secret is present
  - add `x-vercel-set-bypass-cookie: true` when browser-like follow-up requests
    are needed
  - request `/`
  - request `/api/auth/info`
  - request `/api/models`
  - fail on 5xx, unexpected HTML protection pages, or missing critical content
  - print safe status summaries only
- Add `.github/workflows/preview-smoke.yml` triggered by `deployment_status`.
- Run only when:
  - deployment status is `success`
  - target URL is present
  - deployment is not production
- Store `VERCEL_AUTOMATION_BYPASS_SECRET` as a GitHub Actions secret only if
  deployment protection is enabled.

Verification:

- Open a PR and confirm the Preview smoke check appears.
- Confirm the check fails if pointed at a bad URL.
- Confirm logs include URL, routes checked, status codes, and no secrets.

### Slice 3: Define Agent Browser Preview review

Goal: make preview review repeatable for humans and agents.

Status: implemented in docs and PR template.

Tasks:

- Add `docs/process/agent-browser-preview-review.md`.
- Include command templates:

  ```bash
  agent-browser --session "pr-<number>" open "$PREVIEW_URL"
  agent-browser snapshot -i
  agent-browser errors
  agent-browser console
  agent-browser network requests
  ```

- For protected previews, include the header pattern without hardcoding the
  secret:

  ```bash
  agent-browser \
    --session "pr-<number>" \
    --headers "{\"x-vercel-protection-bypass\":\"$VERCEL_AUTOMATION_BYPASS_SECRET\",\"x-vercel-set-bypass-cookie\":\"true\"}" \
    open "$PREVIEW_URL"
  ```

- Define required evidence by change type:
  - UI-only: screenshot/snapshot, console/errors clean, changed controls clicked
  - API/state: relevant network requests inspected
  - auth/live-service: defer to staging unless Preview has a deliberately
    protected test-auth setup
  - migrations: Preview deploy passed and staging migration smoke completed
- Add a PR template checkbox requiring either Agent Browser evidence or a
  documented reason it is not applicable.

Verification:

- Run Agent Browser against an existing Preview URL.
- Capture one screenshot and one interactive snapshot.
- Confirm the checklist is clear enough for another agent to follow.

### Slice 4: Create stable staging

Goal: make real signed-in, GitHub, sandbox, workflow, and inference testing
possible without touching production.

Tasks:

- Create a Vercel custom environment named `staging`.
- Add a stable staging domain, for example:
  - `staging.open-agents-azure-xi.vercel.app`, or
  - a dedicated custom domain if available
- Add isolated staging env vars:
  - `POSTGRES_URL` for a staging Neon branch/database
  - `REDIS_URL` or `KV_URL` for staging Redis/KV
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - `VERCEL_PROJECT_PRODUCTION_URL`
  - `NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL`
  - Vercel OAuth app credentials for staging, or a shared app with the staging
    callback registered
  - GitHub App credentials for staging, preferably a separate staging GitHub App
  - `GITHUB_WEBHOOK_SECRET`
  - `AI_GATEWAY_API_KEY` if OIDC is not sufficient in staging
  - `OPEN_AGENTS_RESOURCE_PROFILE=hobby` if needed
  - `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` only after staging snapshot behavior is
    proven
- Register callback URLs:
  - `https://<staging-domain>/api/auth/callback/vercel`
  - `https://<staging-domain>/api/auth/callback/github`
  - `https://<staging-domain>/api/github/app/callback`
  - `https://<staging-domain>/api/github/webhook`
- Add a staging deploy command to docs:

  ```bash
  vercel deploy --target=staging
  ```

- Add a staging smoke checklist:
  - open staging
  - sign in with Vercel
  - connect/update GitHub App
  - repo list loads
  - create session
  - sandbox starts
  - send a trivial agent prompt
  - inspect workflow/run attribution
  - check Vercel logs for recent errors

Verification:

- `vercel deploy --target=staging` succeeds.
- `vercel inspect <staging-url>` reports target `staging`.
- Staging sign-in works.
- Staging session creation works.
- Staging smoke is recorded in PR/release notes before production.

### Slice 5: Production deployment and rollback runbook

Goal: make production deploys boring and reversible.

Status: initial runbook implemented; needs proof during the next production
deployment.

Tasks:

- Add `docs/process/production-release-runbook.md`.
- Define the release command path:
  - Short-term: merge to protected `main` triggers production deploy.
  - Later: use an explicit release workflow or `vercel promote` with manual
    approval.
- Require these before production:
  - PR CI green
  - Preview smoke green
  - Agent Browser Preview evidence for UI changes
  - staging smoke green for auth/sandbox/workflow/provider/migration changes
  - migration risk classification complete
- Require these after production:
  - record commit SHA
  - record deployment URL/id
  - run production smoke
  - inspect production error logs for the last 5 minutes
- Include rollback commands:

  ```bash
  vercel rollback
  vercel rollback status
  vercel logs --environment production --status-code 5xx --since 5m
  ```

- For Pro/Enterprise, document specific deployment rollback:

  ```bash
  vercel rollback <deployment-url>
  ```

Verification:

- Run the runbook against a harmless docs-only deploy or dry-run where possible.
- Confirm the runbook identifies the current production deployment and previous
  deployment.

### Slice 6: Migration safety policy

Goal: prevent database changes from being the easiest way to break prod.

Tasks:

- Add `docs/process/migration-release-policy.md`.
- Keep current build-time migrations for now, but codify safe constraints:
  - additive-first migrations by default
  - nullable columns before required writes
  - dual-read/dual-write before backfills
  - backfills separate from schema introduction when data volume is uncertain
  - destructive drops only after the old app version can no longer write/read
    the removed shape
- Require staging proof for every schema change.
- Require rollback notes that distinguish:
  - app rollback only
  - app rollback plus forward-compatible DB state
  - irreversible migration requiring fix-forward
- Extend PR template deploy notes with migration class:
  - no schema change
  - additive compatible
  - backfill required
  - destructive/deferred cleanup

Verification:

- A schema-changing PR cannot be marked ready without migration class and
  staging evidence.
- `bun run --cwd apps/web db:check` remains required in CI.

## Recommended Order

1. Slice 1: protect `main`.
2. Slice 2: automated Preview smoke.
3. Slice 3: documented Agent Browser Preview review.
4. Slice 4: stable staging.
5. Slice 5: production release/rollback runbook.
6. Slice 6: migration release policy.

This order gives immediate risk reduction before introducing more process. The
first three slices make PRs safer quickly. Staging then handles the parts
Preview cannot prove: real auth, GitHub App callbacks, sandbox, workflows, and
provider calls.

## Agent Browser Policy

Agent Browser should be required for user-visible frontend changes and strongly
recommended for any change where a naive user needs to understand status,
errors, or next steps.

Use Preview Agent Browser for:

- visual layout and responsiveness
- model picker/settings/dialog flows
- unauthenticated pages
- protected Preview pages when bypass headers are configured
- console/page/network checks

Use Staging Agent Browser for:

- real sign-in
- GitHub App installation/update
- repo-backed session creation
- sandbox startup
- managed runtime profile behavior
- workflow streaming
- inference-profile profile creation/test/run attribution

Do not rely on Agent Browser alone for regression prevention. Every behavior
that can be deterministic should have a unit, route, workflow, or integration
test first.

## Preview Authentication Options

Recommended default:

- Keep Preview mostly unauthenticated.
- Use it for smoke and visual review.
- Use staging for real auth and live services.

Optional later:

- Enable `OPEN_AGENTS_ENABLE_TEST_AUTH=1` only in protected Preview
  environments.
- Never enable test auth in Production.
- Treat test-auth Preview as lower trust than staging because it does not prove
  OAuth/GitHub App callbacks.

## Open Decisions

- Should production remain "merge to protected `main` deploys automatically",
  or should production require an explicit manual promotion workflow?
  - Recommendation: start with protected-main auto deploy for speed, then add
    explicit promotion once staging is stable.
- Should staging use separate OAuth/GitHub apps?
  - Recommendation: separate staging GitHub App if possible; shared Vercel OAuth
    app is acceptable if it supports multiple callbacks cleanly.
- Should Preview smoke be HTTP-only first or browser-based in CI?
  - Recommendation: HTTP-only first for reliability, documented Agent Browser
    manual review second, Playwright/Agent Browser CI later if needed.
- Should deployment protection be required for all Preview deployments?
  - Recommendation: yes if test auth or non-public test data is ever enabled on
    Preview.

## Definition Of Done For The Epic

- `main` cannot be updated without a PR and required checks.
- Every PR has a Vercel Preview URL and an automated Preview smoke result.
- UI PRs include Agent Browser Preview evidence or a clear exception.
- Staging exists with isolated DB/KV/auth/provider config.
- Auth/sandbox/workflow/provider changes prove the path in staging before prod.
- Production deploy notes include commit SHA, deployment URL/id, smoke result,
  and rollback path.
- Migration PRs include compatibility classification and staging proof.
- The process is documented well enough that a future agent can execute it
  without relying on this chat transcript.
