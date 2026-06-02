# GitHub Build Process

This is the target build workflow as Open Agents moves toward a professional
multi-contributor environment.

## Core Chain

Build through this chain:

1. planning docs or GitHub Project items capture broad sequencing,
2. GitHub issues define executable slices,
3. one branch implements one primary issue,
4. one PR proves the slice with tests and docs,
5. CI gates merge to `main`,
6. deployment is traceable to committed source.

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

1. Branch from current `main`.
2. Keep the branch scoped to one primary issue.
3. Use worktrees for parallel agent or contributor work.
4. Open a PR before merging to `main`.
5. Link the primary issue.
6. Include test output, docs updated, and observability evidence.
7. Include deploy notes for Vercel, Neon, Upstash, GitHub App, sandbox profile,
   OAuth, or workflow changes.
8. Do not push directly to `main`; branch protection requires PR-based changes.

Recommended flow:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <branch-name>

# work, test, commit

git push origin <branch-name>
gh pr create --base main --title "<title>" --body "<description>"
```

For parallel work:

```bash
git fetch origin
git worktree add -b <branch-name> .worktrees/<branch-name> origin/main
cd .worktrees/<branch-name>
bun install --frozen-lockfile
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

`main` is protected with a low-friction solo-friendly gate:

1. require PR before merge,
2. require the `lint-and-typecheck` status check,
3. require branches to be up to date before merge,
4. require conversation resolution,
5. include administrators,
6. block force pushes and deletions.

Approvals are not required yet so the repo can keep moving quickly while a
single maintainer is driving the work. Add a one-approval requirement once there
is a second regular reviewer.

CI also runs a `build` job (`next build`) and a PR-only `guards` job
(migration-safety + test-touch). These are not blocking until added to the
required-status-check list; promote them once they have a green history. See
[Pipeline Gates](pipeline-gates.md) for the full machine-enforced layer.
