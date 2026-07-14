# Local Development Setup

Use this document for setting up Open Agents in a local checkout, Git worktree,
sandbox, or VM. The happy path is intentionally short:

```bash
./init.sh
bun run web
```

The script is conservative. It prepares the checkout and validates local
configuration, but it does not silently mutate production services or apply
database migrations.

## What `init.sh` Does

`./init.sh` runs from the repository root and performs these steps:

1. Verifies required tools are available: `git` and `bun`.
2. Installs dependencies with `bun install --frozen-lockfile`.
3. Installs the tracked `.githooks` path in both ordinary checkouts and linked
   Git worktrees.
4. Ensures `apps/web/.env.local` exists.
5. Pulls Vercel **Development** environment variables when the env file is
   missing or `--force-env-pull` is passed.
6. Generates a local `BETTER_AUTH_SECRET` only when that value is missing.
7. Validates the env file and prints clear warnings for partially configured
   auth, repo access, inference, Redis, and local OAuth state.
8. Runs typecheck and a temporary local server smoke only when requested with
   `--verify` or `--ci`.

The script always writes local secrets only to ignored files.

Use the exact Bun version declared by root `packageManager` (`bun@1.3.14`). The
unit lane validates both that version and workspace dependency resolution before
discovering or spawning any product test files.

## What `init.sh` Does Not Do

`./init.sh` does not:

- pull Production env by default,
- overwrite `apps/web/.env.local` unless `--force-env-pull` is passed,
- apply database migrations,
- create or change Vercel environments,
- create GitHub Apps or OAuth apps,
- start a persistent dev server,
- commit files or change branches.

Keep database mutations explicit. For schema work, follow the migration rules in
[AGENTS.md](../../AGENTS.md) and
[Development Workflow](development-workflow.md).

## Standard Setup

Run:

```bash
./init.sh
```

If `.vercel/project.json` is missing and the shell is interactive, the script
will prompt through `vercel link`. In non-interactive agent, CI, sandbox, or VM
contexts, pass the linking flags described below.

Then start the app:

```bash
bun run web
```

The app serves `http://localhost:3000`.

Local Vercel sign-in requires the Vercel OAuth app to include this callback:

```text
http://localhost:3000/api/auth/callback/vercel
```

If the dev server starts on another port, either restart it on `3000` or add the
exact callback URL for that port.

## Fresh Worktree, Sandbox, Or VM

Fresh checkouts usually do not have `.vercel/project.json`, because `.vercel/`
is intentionally ignored. For non-interactive setup, link the checkout and pull
Development env in one command:

```bash
./init.sh --link-vercel --vercel-project open-agents --vercel-team dennisons-projects
```

If the Vercel project lives in your personal scope and the CLI can infer it, the
team flag may not be needed:

```bash
./init.sh --link-vercel --vercel-project open-agents
```

Equivalent environment variables are supported for automation:

```bash
VERCEL_PROJECT=open-agents VERCEL_TEAM=dennisons-projects ./init.sh --link-vercel
```

If the machine cannot access Vercel, use offline mode:

```bash
./init.sh --offline
```

Offline mode creates `apps/web/.env.local` from
`apps/web/.env.example` when needed and generates `BETTER_AUTH_SECRET`, but it
cannot fill service credentials. The app may not be runnable until you provide
at least:

```env
POSTGRES_URL=
BETTER_AUTH_SECRET=
```

## Refreshing Local Env

To refresh local env from Vercel Development:

```bash
./init.sh --force-env-pull
```

This intentionally uses Vercel Development, not Production. Vercel documents
Development environment variables as the local-development env source for
`vercel dev` and other preferred local commands, and this project keeps local
OAuth, GitHub App, model, and sandbox configuration there.

To intentionally test against Preview-scoped env, pass:

```bash
./init.sh --environment preview --force-env-pull
```

Preview env is useful for debugging preview-deployment behavior, but it may not
contain the local OAuth/GitHub/model credentials needed for full interactive
development.

Do not pull Production env for ordinary local development. If a production-only
incident requires production env, document the reason, keep the session scoped,
and avoid running write paths unless the user explicitly approves them.

## Verification Mode

To prove the checkout is runnable:

```bash
./init.sh --verify
```

Verification mode:

1. installs dependencies,
2. validates env,
3. runs `bun --bun run typecheck`,
4. starts a temporary `bun run web` server when one is not already running,
5. checks `http://localhost:3000/api/auth/info`,
6. stops the temporary server before exiting.

If a server is already running at `LOCAL_URL`, the script smokes that server
instead.

Use a custom local URL when needed:

```bash
LOCAL_URL=http://localhost:3001 ./init.sh --verify
```

## CI Or Agent Mode

For non-interactive setup:

```bash
./init.sh --ci
```

`--ci` fails when the local env is not runnable and runs typecheck. It is useful
for sandboxes and automation where a warning should become a hard failure.

## Options

```bash
./init.sh --help
```

Supported options:

- `--offline` avoids Vercel calls and creates an env skeleton when missing.
- `--environment <development|preview>` selects which Vercel env to pull.
- `--force-env-pull` replaces `apps/web/.env.local` from the selected Vercel
  env.
- `--verify` runs typecheck and a temporary local server smoke.
- `--ci` runs in non-interactive validation mode.
- `--skip-install` skips dependency installation.
- `--skip-checks` skips typecheck.
- `--link-vercel` links the checkout before pulling env.
- `--vercel-project <name>` sets the project for `--link-vercel`.
- `--vercel-team <team>` sets the Vercel team for `--link-vercel`.

## Env Expectations

Minimum runnable env:

```env
POSTGRES_URL=
BETTER_AUTH_SECRET=
```

Required for sign-in:

```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
NEXT_PUBLIC_GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Required for repo-backed agent work:

```env
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
NEXT_PUBLIC_GITHUB_APP_SLUG=
GITHUB_WEBHOOK_SECRET=
```

Common local optional values:

```env
AI_GATEWAY_API_KEY=
REDIS_URL=
KV_URL=
COMPOSIO_API_KEY=
VERCEL_SANDBOX_BASE_SNAPSHOT_ID=
```

Inference has two intended paths:

- Public deployments use Vercel AI Gateway. On Vercel, project/OIDC
  authentication can authorize gateway calls without provider keys in the app.
- Personal or project-specific usage can use provider overrides. This is the
  intended path for developers who want to route their own Anthropic/OpenAI/etc.
  keys through a custom base URL or provider account.

For local development today, default gateway-backed model calls need local AI
Gateway authentication, usually `AI_GATEWAY_API_KEY`, until the user/project
override flow is available and configured for the current user/project.

`REDIS_URL` or `KV_URL` may be needed for rate-limited session and sandbox
creation paths.

A successful `./init.sh --verify` proves the checkout can install, typecheck,
start the web app, and answer the unauthenticated health path. It does not prove
interactive sign-in, GitHub repo access, model calls, Composio tools, or sandbox
creation unless the corresponding env groups above are present. For ordinary
development, those values should be configured in Vercel Development. Add safe
Preview-scoped values only when Preview deployments need to exercise the same
full product path.

## Local OAuth Warning

If `BETTER_AUTH_URL` is set in `apps/web/.env.local`, Better Auth may use that
canonical URL during local sign-in. That is useful for production deployments,
but it can make local OAuth redirect away from `localhost`.

For normal local development, prefer leaving `BETTER_AUTH_URL` unset unless you
are intentionally testing canonical URL behavior.

## Day-To-Day Development Loop

1. Create a focused branch or worktree.
2. Run `./init.sh`.
3. Start `bun run web`.
4. Name the protected user or operator path.
5. Add or identify the smallest useful failing test.
6. Implement the smallest green change.
7. Run focused tests for the touched area.
8. Before PR, run:

   ```bash
   git diff --check
   bun --bun run ci
   ```

9. Open a PR and let Vercel Preview Smoke run.
10. Use Agent Browser to inspect the Preview deployment when the change affects
    visible UI or user-facing behavior.

## Troubleshooting

If `bun` is missing, check the local machine bootstrap first. On the current
development machine, Bun is expected at:

```text
~/.bun/bin
```

If Vercel env pull fails, verify:

- `vercel whoami` succeeds,
- the checkout is linked with `.vercel/project.json`,
- the project name and team are correct,
- the selected Vercel environment has the required env vars.

If local sign-in redirects to production, remove or override
`BETTER_AUTH_URL` in `apps/web/.env.local` and confirm the localhost callback is
registered in the Vercel OAuth app.

If model calls fail locally, check whether the path under test is supposed to
use the public Vercel AI Gateway or a user/project provider override. For the
default gateway path outside Vercel, check `AI_GATEWAY_API_KEY`.

If session or sandbox creation fails with rate-limit errors, check `REDIS_URL`
or `KV_URL`.

If local CI hangs or fails because `REDIS_URL` or `KV_URL` points at an
unreachable production-like service, blank those values for the local command
instead of editing shared config:

```bash
REDIS_URL= KV_URL= bun --bun run ci
```

> **Caveat:** Only use this when the failure is caused by an unreachable local
> external service. Do not use it for changes that intentionally touch Redis/KV
> behavior — blanking these variables will mask integration coverage for those
> changes.
