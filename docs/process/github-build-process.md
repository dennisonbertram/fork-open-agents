# GitHub Build Process

This is the target build workflow as Open Agents moves toward a professional
multi-contributor environment.

## Core Chain

Build through this chain:

1. planning docs or GitHub Project items capture broad sequencing,
2. GitHub issues define executable slices,
3. one branch implements one primary issue,
4. one PR proves the slice with tests and docs,
5. CI gates merge to `develop`,
6. Vercel deploys `develop` to the shared dev environment,
7. release PRs promote `develop` to `main`,
8. Vercel deploys `main` to production.

Feature requests should be captured as GitHub issues by default. Planning docs
can hold architecture and roadmaps, but issue bodies should define the
implementation slice agents execute.

## Issue Sizing Rules

Every non-trivial implementation task intended for merge should have an issue.

A good issue is:

1. small enough for one PR,
2. behavior-oriented,
3. explicit about in-scope and out-of-scope work,
4. explicit about tests to add first,
5. explicit about observability evidence,
6. explicit about migration or deploy risk,
7. specific enough that another person or agent can implement it without the
   chat transcript.

Good issue sizes:

1. enforce managed runtime coordinator tool policy,
2. add task worker runtime attribution to the transcript,
3. add a migration check for a new session column,
4. add a browser smoke for a dev-server preview button.

Bad issue sizes:

1. make managed runtime real,
2. add observability everywhere,
3. fix all agent quality issues,
4. improve the UI.

## Branch And PR Rules

1. Branch from current `develop`.
2. Keep the branch scoped to one primary issue.
3. Use worktrees for parallel agent or contributor work.
4. Open a PR before merging to `develop`.
5. Link the primary issue.
6. Include test output, docs updated, and observability evidence.
7. Include deploy notes for Vercel, Neon, Upstash, GitHub App, sandbox profile,
   OAuth, or workflow changes.
8. Do not push directly to `develop` or `main`; branch protection requires
   PR-based changes.

Use this branch model:

```text
feature branch -> PR into develop -> shared dev deployment
develop        -> release PR into main
main           -> production deployment
```

`develop` is the integration branch. `main` is production. Do not retarget
ordinary feature PRs to `main`; only release PRs from `develop` should target
`main`.

Recommended flow:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c <branch-name>

# work, test, commit

git push origin <branch-name>
gh pr create --base develop --title "<title>" --body "<description>"
```

For parallel work:

```bash
git fetch origin
git worktree add -b <branch-name> .worktrees/<branch-name> origin/develop
cd .worktrees/<branch-name>
bun install --frozen-lockfile
```

## Release Promotion

After a change is merged to `develop`, smoke the shared dev deployment. Promote
to production with a release PR from `develop` to `main`.

Release PRs should be boring:

1. branch or compare from `develop` to `main`,
2. summarize the PRs or commits already proven in dev,
3. link dev smoke evidence,
4. name migration and rollback risk,
5. merge only after CI and required conversations are clear.

## Backlogged PRs

For existing PRs opened before the `develop` branch model:

1. Retarget feature PRs from `main` to `develop`.
2. Update each branch with the latest `origin/develop` using a normal merge.
3. Resolve conflicts against `develop`, not `main`.
4. Re-run the PR checks and keep the original issue link/test evidence.
5. Merge into `develop` after CI passes.
6. Let Vercel deploy `develop` to the shared dev environment.
7. Batch one or more verified PRs into production with a release PR from
   `develop` to `main`.

If a backlogged PR has already been merged to `main`, do not recreate it. Treat
it as already in production history, and make sure `develop` contains that
commit before merging newer feature work.

If a PR is a production hotfix, branch from `main`, target `main`, and then
merge `main` back into `develop` after the hotfix ships so the integration
branch does not drift.

### Backlog PR Operator Prompt

Use this prompt when asking an agent or model to work through the existing PR
backlog. Fill in the repository, PR list, and any priority notes before running
it.

```text
You are helping merge the pull request backlog for
dennisonbertram/fork-open-agents.

Follow the repository's current branch and deployment process exactly:

- Feature and integration PRs target develop.
- develop deploys to the shared Vercel dev environment:
  https://open-agents-env-dev-dennisons-projects.vercel.app
- Production releases happen only through release PRs from develop to main.
- main deploys to Vercel Production.
- Direct PRs to main are only for production release PRs or urgent hotfixes.

For each backlogged PR I give you:

1. Inspect the PR title, body, linked issue, changed files, comments, checks,
   and current base branch.
2. Classify it as one of: feature/integration, production release, urgent
   hotfix, already merged/obsolete, or needs human decision.
3. For feature/integration PRs, retarget the PR to develop if needed.
4. Update the PR branch with latest origin/develop using a normal merge, not a
   rebase, unless I explicitly ask otherwise.
5. Resolve conflicts against develop while preserving the PR's intended change.
6. Run the smallest relevant checks first, then the repo-required checks:
   git diff --check, bun --bun run check, and bun --bun run ci.
7. If behavior changed, verify or add the smallest useful regression test and
   report the test evidence.
8. Confirm the PR template has current evidence for tests, docs, deploy impact,
   observability, rollback, and dev smoke when applicable.
9. Do not merge a PR with failing checks, unresolved review threads, unclear
   conflicts, missing secrets, or ambiguous product behavior. Report the blocker
   and move to the next PR.
10. After a PR merges to develop, confirm the Vercel dev deployment completes
    and run the applicable dev smoke before marking it ready for production
    batching.

After a batch of PRs is verified in dev:

1. Open a release PR from develop to main.
2. Summarize the included PRs/commits and link the dev smoke evidence.
3. Call out migrations, env changes, service dependencies, rollback risk, and
   any remaining manual verification.
4. Merge to main only after CI, required reviews, and required conversations are
   clear.

Important safety notes:

- The dev deployment lane exists, but dev-specific backing services may still
  need to be provisioned. Do not run destructive, migration-heavy, background
  agent, sandbox/workflow, auth/webhook, or live-service tests against dev until
  dev Neon and Redis/KV isolation is confirmed.
- If a backlogged PR was already merged to main, do not recreate it. Ensure
  develop contains that commit before merging newer feature work.
- If you ship a hotfix directly to main, merge main back into develop
  immediately afterward so the integration branch does not drift.

Work through these PRs in this order:

<paste PR numbers or URLs here>

Priority notes:

<paste priority, grouping, risk, or dependency notes here>

For each PR, report: classification, actions taken, checks run, dev deployment
or smoke evidence, blockers, and whether it is ready to merge, merged to
develop, or deferred.
```

## PR Expectations

Every PR should answer:

1. What changed?
2. What is out of scope?
3. What test failed first?
4. What tests are now green?
5. What docs changed?
6. What user/operator observability proves it works?
7. What deploy or migration steps are required?
8. What rollback path exists?

## Merge Gate

No non-trivial PR should merge unless:

1. the issue exists or the PR explains why docs-only work does not need one,
2. tests were added or updated when behavior changed,
3. regressions were covered for bugs,
4. docs still describe reality,
5. CI passes,
6. the work remains one clean PR-sized slice.

## Branch Protection

`develop` and `main` are protected with a low-friction solo-friendly gate:

1. require PR before merge,
2. require the `lint-and-typecheck` status check,
3. require branches to be up to date before merge,
4. require conversation resolution,
5. include administrators,
6. block force pushes and deletions.

Approvals are not required yet so the repo can keep moving quickly while a
single maintainer is driving the work. Add a one-approval requirement once there
is a second regular reviewer.
