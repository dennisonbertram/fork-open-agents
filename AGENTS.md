# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

**This is a living document.** When you make a mistake or learn something new about this codebase, add it to [Lessons Learned](docs/agents/lessons-learned.md).

## Quick Links

- [Architecture & Workspace Structure](docs/agents/architecture.md)
- [Code Style & Patterns](docs/agents/code-style.md)
- [Lessons Learned](docs/agents/lessons-learned.md)
- [Process Index](docs/process/index.md)
- [Development Workflow](docs/process/development-workflow.md)
- [Behavior-First TDD](docs/process/behavior-tdd.md)
- [Observability Discipline](docs/process/observability-discipline.md)
- [Managed Runtime Proof Standard](docs/process/managed-runtime-proof-standard.md)

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

Use the process docs for non-trivial work:

- [Feature Ticket Format](docs/process/feature-ticket-format.md) defines the
  GitHub issue shape for PR-sized work.
- [GitHub Build Process](docs/process/github-build-process.md) defines the
  issue, branch, PR, CI, and deployment structure.
- [Regression Discipline](docs/process/regression-discipline.md) defines the
  bug-to-regression workflow.
- [Formatting Gate](docs/process/formatting-gate.md) defines completion checks.

For behavior-changing work, name the protected user/operator path, write or
identify the failing test first, confirm the red state, implement the smallest
green change, and then run the adjacent suite plus `git diff --check` and
`bun --bun run ci`.

For managed runtime, sandbox, workflow, browser, deploy, auth, or GitHub App
changes, include observability evidence: user-visible status, runtime/sandbox
attribution, logs/events/metadata, browser or service evidence when relevant,
and final verification notes.

For managed runtime work specifically, do not claim the runtime path is proven
unless the evidence satisfies
[Managed Runtime Proof Standard](docs/process/managed-runtime-proof-standard.md).

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

Neon database branching is enabled in the Vercel project settings. Every preview deployment automatically gets its own isolated database branch forked from production. This means preview deployments never read or write production data. Production deployments use the main Neon database.

## Commands

```bash
# Development
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
bun test                                              # Run all tests
bun test path/to/file.test.ts                         # Run single test file
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
- Local Vercel sign-in requires the Vercel OAuth app to include `http://localhost:3000/api/auth/callback/vercel` alongside the production callback.
- Railway CLI auth and install state are separate from project linking. Use `railway whoami --json` to verify auth; `railway status --json` only works after this repo is linked to the correct Railway project.
- Do not link or deploy to Railway based on a guessed project name. Confirm the project URL or project ID first, then use `railway link <project-id>` or explicit `--project`/`--environment` flags.

## Git Commands

- **Branch sync preference:** When bringing in `origin/main`, prefer a normal merge (`git fetch origin main` then `git merge origin/main`) instead of rebasing, unless explicitly requested otherwise.

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
Web -> Agent (packages/agent) -> Sandbox (packages/sandbox)
```

See [Architecture & Workspace Structure](docs/agents/architecture.md) for details.

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
