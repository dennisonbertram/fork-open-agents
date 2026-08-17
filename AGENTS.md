# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

**This is a living document.** When you make a mistake or learn something new about this codebase, add it to [Lessons Learned](docs/agents/lessons-learned.md).

Keep this file as a routing document. Do not add long runbooks, design notes,
or detailed procedures here; put that material in `docs/agents`,
`docs/process`, or `docs/plans`, then link to it from this file.

## Quick Links

- [Architecture & Workspace Structure](docs/agents/architecture.md)
- [Code Style & Patterns](docs/agents/code-style.md)
- [Lessons Learned](docs/agents/lessons-learned.md)
- [Process Index](docs/process/index.md)
- [Local Development Setup](docs/process/local-development.md)
- [Development Workflow](docs/process/development-workflow.md)
- [Guard Integrity](docs/process/guard-integrity.md)
- [Reviewing What Tests Cannot See](docs/process/reviewing-what-tests-cannot-see.md)
- [UI References](docs/design/ui-references.md)
- [Dogfood The Cloud Loop](docs/process/dogfood-cloud-fanout.md)
- [Behavior-First TDD](docs/process/behavior-tdd.md)
- [Authenticated Local UI Smoke](docs/process/development-workflow.md#authenticated-local-ui-smoke)
- [Observability Discipline](docs/process/observability-discipline.md)
- [Managed Runtime Proof Standard](docs/process/managed-runtime-proof-standard.md)
- [Deployed Feature Proof Standard](docs/process/deployed-feature-proof-standard.md)
- [Production Release Runbook](docs/process/production-release-runbook.md)

## Repository Ownership And Upstream Policy

This project is being developed independently in Dennison Bertram's GitHub
workspace. Treat `vercel-labs/open-agents` as an upstream source only.

- Do not push commits, branches, tags, issues, pull requests, releases, or
  workflow changes to `vercel-labs/open-agents` or any Vercel Labs repository
  unless the user explicitly asks for that exact upstream write.
- It is acceptable, and expected, to fetch or pull updates from
  `vercel-labs/open-agents` so this fork can stay current with upstream.
- Before any GitHub write, verify the target with `git remote -v`,
  `gh repo view`, or the equivalent GitHub API data. The expected working
  target for this checkout is the user's fork/workspace, not Vercel Labs.
- If the fork, issue tracker, or PR target is ambiguous or disabled, stop and
  report that instead of falling back to Vercel Labs upstream.

## Build Process

**Implementation work defaults to running on this product.** Plan locally, then
dispatch the work to Open Agents cloud sessions over the hosted MCP server,
review what comes back, and file whatever the attempt exposes. One day of doing
this surfaced ten defects that the test suite, the type checker, and CI all
passed clean — including work silently lost to a protected-branch push, runs
truncated by the token limit and recorded as `completed`, and headless runs
stalling forever on an approval nobody could give.

Two rules that follow from it, because a slice always reports `completed`
whether its output is excellent or unusable:

- **Never merge on a green status.** Read the whole diff, confirm no file
  outside the slice's assigned list changed, confirm no line changed that the
  task did not call for, and run its tests locally.
- **Write the acceptance condition before dispatching** — "only these files may
  change, no existing line may be modified" — so grading is a mechanical check
  on the diff rather than a judgment call afterwards.

See [Dogfood The Cloud Loop](docs/process/dogfood-cloud-fanout.md) for the full
loop, the evidence behind it, and when staying local is the right call.

Use the process docs for non-trivial work:

- [Local Development Setup](docs/process/local-development.md) defines the
  `./init.sh` bootstrap path for checkouts, worktrees, sandboxes, and VMs.
- [Feature Ticket Format](docs/process/feature-ticket-format.md) defines the
  GitHub issue shape for PR-sized work.
- [GitHub Build Process](docs/process/github-build-process.md) defines the
  issue, branch, PR, CI, and deployment structure.
- [Regression Discipline](docs/process/regression-discipline.md) defines the
  bug-to-regression workflow.
- [Formatting Gate](docs/process/formatting-gate.md) defines completion checks.
- [GTM Operating System](docs/process/gtm-operating-system.md) defines the
  agent-first GTM state, ledger, redaction, and approval boundary.
- [Authenticated Local UI Smoke](docs/process/development-workflow.md#authenticated-local-ui-smoke)
  defines the database-backed local browser QA gate for settings, sessions,
  repositories, and other persisted UI paths.

All GitHub issues created or materially edited by agents must follow
[Feature Ticket Format](docs/process/feature-ticket-format.md). Do not open
blank issues. Use the standard feature, bug regression, or research spike
template; fill unknown fields explicitly; and include the required structured
observability, regression harness plan, protected path, tests-first plan, deploy
impact, and definition-of-done sections before implementation starts.

Whenever an agent creates a non-trivial plan, roadmap, epic, or implementation
breakdown, first create or identify the corresponding GitHub issue or epic and
flesh it out according to the standard issue format. The issue/epic is the
durable record of what is being built and why; planning docs can expand on it,
but they must link back to the issue/epic instead of replacing it.

For behavior-changing work, name the protected user/operator path, write or
identify the failing test first, confirm the red state, implement the smallest
green change, and then run the adjacent suite plus `git diff --check` and
`bun --bun run ci`.

When a change adds a **guard** — anything whose job is to refuse, block, or
validate — follow [Guard Integrity](docs/process/guard-integrity.md). Passing
unit tests are not evidence that a guard fires in the real path. This repo has
shipped four guards that were green and inert. Exercise the refusal through the
real entry point, check its exit code without a pipe, prove the allow paths, and
confirm every input the guard reads actually reaches it in Turbo's env
allowlist, in every Vercel environment, and in `.env.example`.

When **reviewing** a change, a green suite is only evidence about code the suite
can reach. Follow
[Reviewing What Tests Cannot See](docs/process/reviewing-what-tests-cannot-see.md):
ask what the harness structurally cannot observe — lines needing live
infrastructure, option combinations tested only in isolation, behavior decided
in YAML or environment variables, and which environment your evidence came
from — then read those places. Three defects on 2026-08-16 were found that way
in a repository with thousands of passing tests. Where a line cannot be executed
under test, guard it from the source text, and mutation-test the guard before
trusting it.

For managed runtime, sandbox, workflow, browser, deploy, auth, or GitHub App
changes, include observability evidence: user-visible status, runtime/sandbox
attribution, logs/events/metadata, browser or service evidence when relevant,
and final verification notes.

For managed runtime work specifically, do not claim the runtime path is proven
unless the evidence satisfies
[Managed Runtime Proof Standard](docs/process/managed-runtime-proof-standard.md).

At the end of any implementation, include a concise summary of what was built,
what changed for users, and what was verified so the next person can quickly
understand the shipped work without reading the full transcript.

At the end of implementation work, always preserve the work in Git: create an
intentional commit, push it to the user's fork/workspace, and open a pull
request before calling the task complete. Stage only the files that belong to
the implementation, keep unrelated dirty files out of the commit, and report any
blocker that prevents committing, pushing, or opening the PR.

## Pull Request Descriptions

PR descriptions must be detailed enough that a reviewer, release operator, or
future agent can understand and safely operate the change without reading the
chat transcript. Do not open or update a PR with a sparse body, placeholder
bullets, or generic "tests pass" language.

Every non-trivial PR body must include:

- **Why:** the user/operator problem, linked issue or explicit reason no issue is
  needed, and the protected path.
- **What changed:** the important files, components, APIs, data flows,
  permissions, and user-visible behavior changed by the PR.
- **Out of scope:** adjacent work intentionally left out, especially when the
  change touches a larger epic or follow-up plan.
- **How it was verified:** exact commands run, focused tests, full-suite checks,
  browser or service smoke evidence, preview/dev/prod URLs when relevant, and
  any local smoke that was blocked with the concrete blocker.
- **Evidence quality:** note whether the proof is deterministic test coverage,
  local integration proof, Agent Browser/Playwright smoke, Vercel preview/dev
  smoke, production smoke, or an approved exception.
- **Risk and rollback:** deploy or migration impact, external services involved,
  operator observability, compatibility concerns, and the rollback or fix-forward
  path.
- **Reviewer guide:** where to start reviewing, which files are mechanical, and
  which behavior or edge cases deserve extra attention.

If a PR is docs-only, say that explicitly and still describe the affected
process, the reason tests were not run, and the command used to check formatting
or links when practical. If a PR touches UI, include browser evidence or the
specific reason browser QA was blocked. If it touches managed runtime, sandbox,
workflow, browser, deploy, auth, GitHub App, database, or background-agent
behavior, include the observability and deployment evidence required by the
process docs.

## Authentication

Authentication uses [Better Auth](https://www.better-auth.com/) with Vercel OAuth (sign-in) and GitHub OAuth (repo access). Config lives in `apps/web/lib/auth/config.ts`. Sessions are managed by better-auth's built-in session system — there is no manual JWE/encryption layer.

Key env vars: `BETTER_AUTH_SECRET` (session signing), `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` + `VERCEL_APP_CLIENT_SECRET` (Vercel OAuth), plus GitHub App credentials for repo access. See `apps/web/.env.example` for the full list.

## Database & Migrations

Schema lives in `apps/web/lib/db/schema.ts`. Migrations are managed by Drizzle Kit.

**After modifying `schema.ts`, always generate a migration:**

```bash
bun run --cwd apps/web db:generate   # Creates a new .sql migration file
```

Commit the generated `.sql` file alongside the schema change. **Do not use `db:push`** except for local throwaway databases.

Migrations run automatically during `bun run build` (via `lib/db/migrate.ts`), so every Vercel deploy — both preview and production — applies pending migrations to its own database.

### Environment isolation

Each Vercel environment points at its own Neon branch via an environment-scoped
`POSTGRES_URL`:

| environment | Neon branch |
| --- | --- |
| Production | `main` |
| Preview | `preview` |
| Development | `dev` |

`POSTGRES_URL` is the only database variable the app reads, so it is the only
one that has to differ per environment.

**This was not true until #1167.** Preview and Production shared one
`POSTGRES_URL`, and because `apps/web/package.json` runs `db:migrate:apply` in
every build, PR preview builds applied unmerged migrations to the production
database and preview traffic read and wrote production rows. If you are reading
an older copy of this file that claims previews were always isolated, it was
wrong.

`lib/db/migrate.ts` now refuses to migrate the production database from a
non-production build. It compares the target against `PRODUCTION_DB_HOST`
(pooled and direct Neon hosts are treated as the same database) and **fails
open** when that variable is unset — migrations gate every build, so an
unconfigured guard must never block a deploy. Override deliberately with
`ALLOW_PRODUCTION_MIGRATION=1`.

Local development is *intended* to point at the `dev` branch via
`POSTGRES_URL`, the only database variable the app and `drizzle.config.ts` read.
Treat that as the default, not a guarantee: `init.sh` reuses an existing
`apps/web/.env.local` without checking which database it targets, and it can
pull Preview configuration on request, so a stale or hand-edited file may point
somewhere else. **Check the actual target before any database write:**

```bash
grep '^POSTGRES_URL=' apps/web/.env.local | grep -o 'ep-[a-z0-9-]*' | head -1
```

Note the guard above **fails open when `PRODUCTION_DB_HOST` is unset**, which is
the default for a fresh checkout — so it does not protect a local run until that
variable is set. `apps/web/.env.example` carries it for this reason.

Note that `.env.local` also carries several *unused* variables
(`DATABASE_URL`, `PGHOST`, `POSTGRES_PRISMA_URL`, and similar) that still hold
production credentials. Nothing reads them today, but a future script reaching
for `DATABASE_URL` by convention would silently get production (#1162).

## Commands

```bash
# Development
./init.sh              # Set up local dependencies and env
bun run web            # Run web app

# Quality checks (REQUIRED after making any changes)
bun run ci                                 # Required: run format check, lint, typecheck, and tests
bun --bun run ci                           # Codex/recovery-safe equivalent when native CLIs load under Node
turbo typecheck                            # Type check all packages

# Linting and formatting (Ultracite - oxlint + oxfmt, run from root)
bun run check                              # Lint and format check all files
bun --bun run check                        # Codex/recovery-safe equivalent for oxfmt native bindings
bun run fix                                # Lint fix and format all files

# Filter by package (use --filter)
turbo typecheck --filter=web # Type check web app only

# Testing
bun run test                                          # Run all tests safely (uses --isolate; prevents mock.module contamination)
bun test path/to/file.test.ts                         # Run single test file (safe; isolation not needed for one file)
bun test --isolate <dir>                              # Run multiple files with per-file isolation (use instead of bare bun test <dir>)
bun test --watch                                      # Watch mode
bun run test:verbose                                  # Run tests with JUnit reporter streamed to stdout (useful in non-interactive shells)
bun run test:verbose path/to/file.test.ts             # Same verbose output for a single test file
```

**CI/script execution rules:**

- Run project checks through package scripts (for example `bun run ci`, `bun run --cwd apps/web db:check`).
- In Codex desktop or crash-recovery shells, prefer `bun --bun run <script>` for scripts that invoke native Bun-installed CLIs (especially `check`/`ci`). This keeps the script under Bun instead of the app's bundled Node runtime, which can fail to load `oxfmt` native bindings.
- Prefer `bun run <script>` over invoking tool binaries directly (`bunx`, `bun x`, `tsc`, `eslint`, etc.) so local runs match CI behavior.

## Local Service Recovery

- If `bun` or `railway` is missing after a machine crash, check PATH/bootstrap before changing the app: on this machine Bun lives in `~/.bun/bin` and Railway in `~/.railway/bin`.
- Repair dependencies from the repo root with `bun install --frozen-lockfile`.
- Start the local web app with `bun run web`; it serves `http://localhost:3000` and loads `apps/web/.env.local` / `apps/web/.env`.
- Verify local health with `curl -I http://localhost:3000` and `curl http://localhost:3000/api/auth/info`.
- For authenticated UI smoke, first confirm `POSTGRES_URL` and
  `BETTER_AUTH_SECRET` are present in `apps/web/.env.local`, run
  `bun run --cwd apps/web db:migrate:apply`, and use an explicit `PORT` /
  `LOCAL_URL` if `3000` is occupied by another app. Do not mark authenticated
  browser QA complete when the sessions/settings path cannot load due to a
  missing database env.
- Local Vercel sign-in requires the Vercel OAuth app to include `http://localhost:3000/api/auth/callback/vercel` alongside the production callback.
- Railway CLI auth and install state are separate from project linking. Use `railway whoami --json` to verify auth; `railway status --json` only works after this repo is linked to the correct Railway project.
- Do not link or deploy to Railway based on a guessed project name. Confirm the project URL or project ID first, then use `railway link <project-id>` or explicit `--project`/`--environment` flags.

## Production Operations

For production deploys, incidents, release promotion, or agent-ready ops
questions, use the repo-bundled `production-ops` skill first:
`.agents/skills/production-ops/SKILL.md`.

Primary commands:

```bash
bun run ops:status -- --since 30m
bun run ops:env-isolation -- --compare dev
bun run ops:authenticated-canary
bun run ops:alert -- --source public-smoke --environment production --status failing --summary "..."
```

Use [Production Release Runbook](docs/process/production-release-runbook.md)
for the full operator loop. `ops:status` is read-only and should be the first
live check before or after risky deploy work. `ops:env-isolation` prints only
fingerprints, never raw env values. The authenticated canary must stay
`blocked_by_configuration` until the disposable production test identity,
allowlisted repo, and GitHub Actions cookie secret are configured. Production
monitor failures should create/update one deduped GitHub issue through
`ops:alert`.

The background-agent cron path also acts as the scheduler resilience point: it
catches up a missed persisted `nextRunAt` window once and sweeps stale queued or
running background-agent runs with `background-agent.run.swept_stale` evidence.

## Git Commands

- **Feature branch base:** Branch feature work from `origin/develop` and open
  feature PRs into `develop`. Promote tested changes to production with a
  release PR from `develop` to `main`.
- **Branch sync preference:** When bringing in `origin/develop`, prefer a
  normal merge (`git fetch origin develop` then `git merge origin/develop`)
  instead of rebasing, unless explicitly requested otherwise.
- **Backmerge immediately after every release.** Merging a release PR creates a
  merge commit on `main` only, so `develop` is instantly behind and the next
  release PR reports `BEHIND` before any work starts. Open the
  `main` → `develop` backmerge PR as the last step of releasing, not when it
  blocks something. A release is not finished until it is merged.
- **Nothing merges directly to `main` except a release PR.** Docs, chores, and
  hotfixes land on `develop` first. Direct-to-`main` commits are the biggest
  source of drift. If a hotfix truly cannot wait, backmerge in the same sitting.
- See [Release Merge Train](docs/process/release-merge-train.md) for the cause,
  the backmerge commands, and how to read `BEHIND` / `BLOCKED` / `UNSTABLE`
  (a `BLOCKED` PR with green checks is usually an unresolved review thread).

**Quote paths with special characters**: File paths containing brackets (like Next.js dynamic routes `[id]`, `[slug]`) are interpreted as glob patterns by zsh. Always quote these paths in git commands:

```bash
# Wrong - zsh interprets [id] as a glob pattern
git add apps/web/app/tasks/[id]/page.tsx
# Error: no matches found: apps/web/app/tasks/[id]/page.tsx

# Correct - quote the path
git add "apps/web/app/tasks/[id]/page.tsx"
```

## Architecture (Summary)

```
Web (apps/web) -> Agent (packages/agent) -> Sandbox (packages/sandbox)
                                              -> packages/shared (utilities)
```

- **apps/web** — Next.js app: auth, sessions/chat, repositories, settings, and
  the API routes under `app/api/*` that drive every subsystem below. Domain
  logic lives in `apps/web/lib/*` (one folder per concern: `auth`, `db`,
  `sandbox`, `session`, `chat`, `github`, `vercel`, `managed-runtime`,
  `background-agents`, `verified-build`, `composio`, `workflows`, `harness`,
  `inference`, `skills`, `observability`, `usage`, `deployment`, `git`, `diff`).
- **packages/agent** — `openAgent`, a `ToolLoopAgent` with file/bash/fetch/task
  tools, the `explorer`/`executor` subagents (`task` tool delegation), skills
  loading, and two runtime modes: `classic` and `managed_runtime`
  (`OPEN_AGENT_RUNTIME_MODES`). Tool policy per mode lives in `open-agent.ts`.
- **packages/sandbox** — execution backend abstraction. The active backend is
  Vercel Sandbox (`connectSandbox` → `connectVercel`), plus managed-runtime
  profile setup/verification commands.
- **packages/shared** — cross-package utilities (diff, tool-state, paste-blocks).

Database tables (`apps/web/lib/db/schema.ts`) back these subsystems: sessions &
chats, sandbox services/browser runs, managed-runtime profiles & runs,
verified-build runs/events, background agents (triggers, grants, runs, events,
outputs, tool sessions), workflow runs/steps, Composio profiles/sessions,
GitHub installations, Vercel project links, inference profiles, usage events,
and user preferences.

See [Architecture & Workspace Structure](docs/agents/architecture.md) for the
canonical description.

### Major Subsystems

These are the larger feature areas; each has a plan/epic that is the durable
record of intent (link back to it from new planning docs and issues):

- **Managed Runtime** — runtime profiles that declare their own toolchain and
  setup/verification commands. See
  [Managed Runtime Profiles](docs/plans/managed-runtime-profiles.md) and the
  [Managed Runtime Proof Standard](docs/process/managed-runtime-proof-standard.md).
- **Background Agents** — triggered/cron sandbox automation gated by repo
  allowlist and tool grants. See
  [Background Agents Epic](docs/plans/background-agents-epic.md) and the
  [Background Agents Live Proof](docs/process/background-agents-live-proof.md).
- **Chief of Staff Account Coordinator** — authenticated account status and
  deep diagnosis APIs for scoped cross-subsystem observability. See
  [Chief of Staff Account Coordinator](docs/plans/chief-of-staff-account-coordinator.md).
- **Verified Build** — verified build bridge, contracts, and observability. See
  [Verified Build Roadmap](docs/plans/verified-build-roadmap.md).
- **Composio Tools** — external tool connections for agents. See
  [Composio Agent Tools Epic](docs/plans/composio-agent-tools-epic.md).
- **Workflows / Harness** — multi-step run orchestration and the agent harness
  API under `app/api/harness/*`.

## File Organization & Separation of Concerns

- Do **not** append new functionality to the bottom of an existing file by default.
- Before adding code, decide whether the behavior is a separate concern that should live in its own file.
- Prefer creating a new colocated file for distinct concerns (components, hooks, utilities, schemas, data-access helpers, etc.).
- If a file is already large or handling multiple responsibilities, extract the new logic (and related helpers/types) into focused modules and import them.
- For large page/view/client components, default to adding new feature behavior in colocated hooks and colocated child components instead of growing the main file.
- If a change introduces a distinct cluster of state, effects, handlers, API calls, or derived UI labels for one feature, treat that as a strong signal to extract it.
- Keep each file focused on one primary responsibility; avoid mixing unrelated UI, business logic, and data-access code in the same file.

## Code Style (Summary)

- **Bun exclusively** (not Node/npm/pnpm)
- **Files**: kebab-case, **Types**: PascalCase, **Functions**: camelCase
- **Never use `any`** -- use `unknown` and narrow with type guards
- **No `.js` extensions** in imports
- **Ultracite** (oxlint + oxfmt) for linting and formatting (double quotes, 2-space indent)
- **Zod** schemas for validation, derive types with `z.infer`

See [Code Style & Patterns](docs/agents/code-style.md) for full conventions, tool implementation patterns, and dependency patterns.
