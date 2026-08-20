# Cursor Cloud Agent Environment

Durable notes for running Open Agents inside a Cursor Cloud Agent VM. This is
the long-form companion to the `## Cursor Cloud specific instructions` section
in [AGENTS.md](../../AGENTS.md). For the general (non-cloud) local setup, see
[Local Development Setup](local-development.md).

## What the environment provides

The VM snapshot is pre-provisioned with everything the app needs to run
locally without external services:

- **Bun** (`~/.bun/bin`, pinned to the repo's `packageManager` version). Already
  on `PATH` for both login and non-interactive shells.
- **PostgreSQL 16** installed as a local cluster (`/var/lib/postgresql/16/main`)
  with an `open_agents` role/database created for local development.
- **`apps/web/.env.local`** written for local dev (gitignored): a local
  `POSTGRES_URL`, a generated `BETTER_AUTH_SECRET`, and the rest of the keys
  left blank from `apps/web/.env.example`.
- **Node modules** installed via `bun install --frozen-lockfile`.

The startup **update script** only runs `bun install --frozen-lockfile` to keep
dependencies in sync after a `git pull`. System dependencies (Bun, Postgres) and
one-time provisioning (database, `.env.local`) live in the snapshot, not the
update script.

## Starting the environment each session

Postgres is **not** auto-started on boot. Start it before any DB work or before
running the app:

```bash
sudo pg_ctlcluster 16 main start   # idempotent; already-online is fine
```

Run the web app (serves http://localhost:3000):

```bash
bun run web
```

Health check (unauthenticated): `GET /api/auth/info` returns `{}`.

If `apps/web/.env.local` is ever missing (e.g. a fresh clone), recreate it:

```bash
./init.sh --offline --skip-install
# then point POSTGRES_URL at the local cluster:
#   POSTGRES_URL=postgres://open_agents:open_agents@127.0.0.1:5432/open_agents
bun run --cwd apps/web db:migrate:apply
```

The local database role/database, if missing, is created with:

```bash
sudo -u postgres psql -c "CREATE ROLE open_agents WITH LOGIN PASSWORD 'open_agents' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE open_agents OWNER open_agents;"
```

## Gotchas discovered during setup

- **Do not use the `bun --bun run` variant on this VM.** The AGENTS.md
  "Codex/recovery-safe" guidance to prefer `bun --bun run check` / `bun --bun
  run ci` does **not** apply here: under `--bun`, the `ultracite` check pins one
  process at 100% CPU for 10+ minutes with no output. The plain scripts finish
  in seconds. Use `bun run check`, `bun run typecheck`, `bun run ci`.
- **Sign-in is OAuth-only** (Vercel for identity, GitHub for repo access). No
  OAuth app credentials are configured, so interactive login — and everything
  gated behind it (model/AI Gateway calls, GitHub repo work, Vercel Sandbox
  execution) — cannot run until those secrets are added. Clicking "Sign in with
  Vercel" correctly redirects to Vercel and shows "app ID is invalid", which
  confirms routing works.
- **Unauthenticated DB-writing paths do work** and are the easiest end-to-end
  smoke of the app↔DB path. Example: RFC 7591 MCP dynamic client registration
  writes a row to `oauth_applications`:

  ```bash
  curl -s -X POST http://localhost:3000/api/auth/mcp/register \
    -H 'Content-Type: application/json' \
    -d '{"client_name":"smoke","redirect_uris":["http://localhost:9999/callback"],"grant_types":["authorization_code"],"response_types":["code"],"token_endpoint_auth_method":"none"}'
  ```

- **One flaky test under parallel load.** `bun run test:isolated` can report a
  single timeout in `packages/agent/tools/tools.test.ts` ("taskTool emits
  initial worker status before subagent stream startup completes", ~5s timeout).
  It passes deterministically in isolation:
  `bun test packages/agent/tools/tools.test.ts`.

## Validation performed during setup

- `bun run typecheck` — passes (all 5 packages).
- `bun run check` (ultracite lint + format) — 0 warnings, 0 errors.
- `bun run test:isolated` — 977 test files pass (one flaky timeout noted above,
  passes on isolated re-run).
- `bun run --cwd apps/web db:check` — migrations in sync with `schema.ts`.
- `bun run web` — boots on port 3000; landing page renders; `/api/auth/info`
  responds; MCP client registration persists to Postgres.
