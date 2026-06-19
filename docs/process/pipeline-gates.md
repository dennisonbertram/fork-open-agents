# Pipeline Gates

This is the machine-enforced layer under the prose process docs. The workflow
docs describe what to do; these gates make the important parts hard to skip,
which matters most when a lot of the work is done by coding agents.

## Local: pre-push hook

A committed git hook lives in [`.githooks/pre-push`](../../.githooks/pre-push)
and is wired up by `./init.sh` or `bun run hooks:install`
(`git config core.hooksPath .githooks`).

On every `git push` it runs the fast, deterministic subset of CI:

1. `git diff --check` (whitespace / leftover merge markers),
2. `bun run check` (lint + format),
3. `bun run typecheck`.

The full test suite stays in CI. Bypass in an emergency with `SKIP_HOOKS=1
git push` or `git push --no-verify`, and explain why in the PR.

## CI jobs (`.github/workflows/ci.yml`)

| Job | What it proves | Notes |
| --- | --- | --- |
| `lint-and-typecheck` | format, lint, typecheck, isolated tests, migration drift | the long-standing required check |
| `build` | `next build` compiles the way Vercel builds it | runs with placeholder env; catches RSC/`"use client"`/bundler errors typecheck misses |
| `guards` | migration-safety + test-touch (PR-only) | needs full history; diffs against the PR base |

`build` exists because typecheck is not a build: boundary errors, route export
shape, and bundler failures pass typecheck and would otherwise only surface on
the production deploy from `main`.

### Making the new jobs required

`build` and `guards` are not blocking until they are added to branch
protection. Once they have a green history, add `build` (and optionally
`guards`) to the required status checks alongside `lint-and-typecheck`, and
make the Vercel preview deployment required too.

## Faster isolated test runner

`bun run test:isolated` ([`scripts/test-isolated.ts`](../../scripts/test-isolated.ts))
runs each test file in its own process so state cannot leak between files. It
now runs files with a bounded worker pool and **reports every failing file in
one run** instead of stopping at the first failure. Override parallelism with
`TEST_CONCURRENCY` (`TEST_CONCURRENCY=1` reproduces strict serial runs).

## Migration safety (`bun run check:migration-safety`)

Enforces the [Production Release Runbook](production-release-runbook.md)
Migration Rollback Rule as a gate. For each migration `.sql` file **added** in
the PR diff that contains a destructive statement (`DROP TABLE/COLUMN/
CONSTRAINT`, `TRUNCATE`, or `SET NOT NULL`), the file must carry a rollback
acknowledgment comment:

```sql
-- migration-safety: app-only <reason>
-- migration-safety: forward-compatible <reason>
-- migration-safety: fix-forward <reason>
```

Non-destructive migrations need nothing. Outside a diff context the check
passes.

## Test-touch guard (`bun run check:test-touch`)

Surfaces "behavior changed but no test changed". If a PR touches watched source
(`apps/web/lib/**`, `apps/web/app/api/**`, `packages/*/**`) without changing any
`*.test.ts(x)` file, it emits a PR warning. It is a warning by default so
refactors and type-only changes are not blocked; set `STRICT_TEST_TOUCH=1` in
CI to make it blocking once desired.

## Production smoke (`.github/workflows/production-smoke.yml`)

`preview-smoke.yml` deliberately skips production, so production previously had
no automated smoke. This workflow runs the same smoke checks against a
production deployment as soon as Vercel reports success, turning the commit's
checks red if production is broken. It does **not** auto-roll-back; follow the
manual `vercel rollback` path in the release runbook.
