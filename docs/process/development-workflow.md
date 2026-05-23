# Development Workflow

Use this workflow for non-trivial changes to Open Agents.

## Non-Negotiables

1. Read [AGENTS.md](../../AGENTS.md), [Architecture](../agents/architecture.md),
   [Code Style](../agents/code-style.md), and
   [Lessons Learned](../agents/lessons-learned.md) before implementation.
2. Plan the slice before editing code.
3. Keep work scoped to one issue-sized branch, worktree, or change set.
4. Use behavior-first TDD for user-facing or operator-facing changes.
5. Add regression tests for bugs, review findings, and production incidents.
6. Prefer deterministic tests before live services, live models, or production
   sandboxes.
7. Update docs when workflow, deployment, public behavior, agent behavior, or
   architecture changes.
8. Do not normalize a red suite. Record the baseline and avoid increasing the
   failure count.

## Standard Loop

1. Create or identify the issue-sized slice.
2. Name the user or operator path being protected.
3. Run the smallest meaningful baseline command for the touched surface.
4. Add or identify the failing behavior, contract, or regression test.
5. Confirm the expected red state before implementation.
6. On a work branch, commit the failing test-only state when practical.
7. Implement the smallest change that turns the targeted test green.
8. Confirm the larger behavior or integration proof only goes green after the
   lower-level tests pass.
9. Commit the green implementation separately from the red test commit when
   practical, or document why that split is not practical.
10. Run the adjacent suite for the touched area.
11. Run repo-level checks:

    ```bash
    git diff --check
    bun --bun run ci
    ```

12. Update docs, issue checklists, and PR notes with verification and
    observability evidence.

Docs-only changes may skip test-first work, but still run `git diff --check`
and the relevant formatter/check command when practical.

## Surface-Specific Baselines

Use the smallest command that gives real signal:

```bash
# Whole repo
bun --bun run ci

# Fast typecheck
bun --bun run typecheck
turbo typecheck --filter=web

# Focused tests
bun test packages/agent/open-agent.test.ts
bun test apps/web/app/workflows/chat.test.ts
bun test apps/web/app/api/chat/route.test.ts

# DB and migrations
bun run --cwd apps/web db:check

# Formatting/lint
bun --bun run check
bun --bun run fix
```

Use package scripts rather than raw tool binaries. In Codex desktop or
crash-recovery shells, prefer `bun --bun run <script>` for scripts that invoke
native Bun-installed CLIs.

## Behavior-First TDD

User-facing, operator-facing, API, auth, persistence, workflow, sandbox,
managed runtime, browser-check, deployment, and observability changes need an
outer behavior or integration proof. Unit tests are the inner loop; they do not
replace the protected path test.

Use [Behavior TDD](behavior-tdd.md) for the template.

## Deterministic First

Preferred proof order:

1. pure unit or contract test,
2. route/workflow/sandbox integration test with deterministic mocks,
3. local service smoke,
4. Agent Browser or Playwright smoke for visible UI,
5. preview or production smoke after deploy.

Live LLM calls, real customer repositories, production databases, and live
provider behavior should be canaries, not the primary regression suite when a
deterministic local harness can cover the contract.

## Definition Of Done

A non-trivial change is done only when:

1. the intended behavior is covered by a test observed failing first, or an
   explicit exception is documented,
2. targeted tests pass,
3. adjacent integration or regression checks pass,
4. `git diff --check` passes,
5. `bun --bun run ci` passes or approved/pre-existing failures are documented,
6. docs and issue/PR checklists are updated,
7. deploy-impacting changes include rollback and smoke notes,
8. user/operator observability is sufficient to prove what happened.
