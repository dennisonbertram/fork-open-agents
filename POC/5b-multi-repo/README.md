# POC 5b — Multi-Repo / Monorepo Sessions

**Status:** Working proof-of-concept. 20/20 eval assertions pass against real
git repos. Self-contained in `POC/5b-multi-repo/` (no root deps touched).

## Goal

Sessions are 1:1 with a repo today. A cross-repo task — e.g. rename a function
in an "api" repo and update its call site in a "consumer" repo — needs a single
session that spans N repos: each cloned into the sandbox, the agent able to
read/edit/commit per repo on **isolated branches**, producing **coordinated,
linked PRs** (PR in repo A references PR in repo B).

## What is 1:1 today (research findings)

- **`apps/web/lib/db/schema.ts` — `sessions` table** carries single-repo
  columns: `repoOwner`, `repoName`, `branch`, `cloneUrl`, `prNumber`,
  `prStatus`, plus one `sandboxState`. One session = one repo.
- **`apps/web/app/workflows/chat-sandbox-runtime.ts` — `buildSandboxSource()`**
  clones exactly one `session.cloneUrl` at one branch into a single
  `sandbox.workingDirectory`.
- **`packages/sandbox/interface.ts`** — a `Sandbox` exposes exactly one
  `readonly workingDirectory` and one `currentBranch`.
- **`packages/agent/tools/read.ts`, `bash.ts`, `path-security.ts`** — every
  tool resolves paths against that single working directory via
  `resolveWorkspacePath()` + `isPathWithinDirectory()`. A path is valid iff it
  is within the *one* workspace root. This single-root assumption is exactly
  what makes the model 1:1.

## What was built

All code is in `src/`:

- **`types.ts`** — `SessionRepo` (the `session_repos` row), `RepoResolution`,
  `RepoWorkingState`, `RepoPrPlan`, `LinkedPrPlan`.
- **`session-repos-schema.ts`** — the proposed `session_repos` Drizzle table +
  DDL that generalizes the single-repo columns on `sessions`.
- **`path-router.ts`** — `PathRouter`, the multi-repo replacement for
  `resolveWorkspacePath`. Given N repo localPaths, it maps an absolute path to
  the repo that owns it (most-specific match for nested checkouts) and returns
  `null` for paths outside **every** repo.
- **`git.ts`** — a per-cwd git wrapper with the same `(command, cwd)` shape as
  `sandbox.exec(...)`, so every git op is repo-scoped.
- **`coordinator.ts`** — `MultiRepoCoordinator`: clones all repos into distinct
  workspace paths, tracks per-repo branch/dirty-file/commit state, routes
  file writes/reads to the correct repo (rejecting outside paths), commits each
  repo's slice in isolation, and emits the linked-PR plan with cross-references.

## How it was tested + evidence

Run:

```bash
cd POC/5b-multi-repo
bun run eval        # 20/20 assertions, writes evidence/
```

The eval (`eval/run.ts`) builds two **real** git repos and performs one logical
cross-repo change (rename `getUserV1 -> fetchUser` in api + update the call site
in consumer). It asserts:

**Coordinated change**

- Both repos cloned into distinct workspace paths, each on its own feature
  branch.
- A cross-checkout coherence script (imports both checkouts, asserts consumer
  calls the new `api.fetchUser`) **FAILS before** the change and **PASSES
  after** both repos change. It **FAILS again** if only one repo is changed
  (partial state) — proving the change is only coherent when coordinated.

**Per-repo isolation (no cross-contamination)**

- `api` commit contains **only** `src/users.js`; `consumer` commit contains
  **only** `src/app.js`. Dirty-file sets are disjoint.
- Commit shas differ; neither repo's `git log` mentions the other's commit.
- Both working trees clean after their own commit.
- A second commit in `api` leaves `consumer`'s HEAD and index untouched.

**Path routing**

- Router maps the api file -> api repo and the consumer file -> consumer repo.
- An edit to a path **outside all repos is rejected**; router returns `null`.

**Linked-PR plan**

- One PR per repo with correct `head`/`base`.
- Each PR body cross-references the **other** repo's PR and shares a single
  `changeSetId`.

Evidence written to `evidence/`:

- `summary.json` — all 20 assertion results.
- `api-commit.txt`, `consumer-commit.txt` — branch, sha, files, log, status.
- `api.diff`, `consumer.diff` — per-repo diffs (each touches only its own files).
- `coherence-before.txt`, `coherence-after.txt` — the failing-then-passing build.
- `linked-pr-plan.json`, `linked-pr-bodies.md` — the coordinated PR plan and the
  rendered cross-referencing PR bodies.

## Integration plan

1. **Schema** — Add `session_repos` to `apps/web/lib/db/schema.ts`
   (see `src/session-repos-schema.ts`). It generalizes the single-repo columns
   (`repoOwner`, `repoName`, `branch`, `cloneUrl`, `prNumber`, `prStatus`) into
   N rows per session, adding `localPath`, `role` (`primary`/`secondary`), and
   `orderIndex`. Migration window: backfill a `primary` row from the existing
   `sessions` columns, run dual-read, then drop the legacy columns. Generate
   with `bun run --cwd apps/web db:generate` and commit the `.sql`.
2. **Clone/workspace layout** — Generalize `buildSandboxSource()` in
   `apps/web/app/workflows/chat-sandbox-runtime.ts` from one `cloneUrl` to a
   loop over `session_repos`, cloning each into `/workspace/<repoName>` (the
   `localPath`). The coordinator's `cloneAll()` is the reference shape.
3. **Path-aware tool routing** — Replace the single-root
   `resolveWorkspacePath()` in `packages/agent/tools/path-security.ts` with a
   `PathRouter` constructed from the session's repos. `read.ts`, `edit.ts`,
   `write.ts`, and `bash.ts` (its `cwd` resolution) then resolve a path to a
   repo and run the op in that repo's `localPath`, rejecting outside paths
   exactly as `read.ts` already rejects paths outside the workspace today.
4. **Coordinated PRs via the GitHub App** — After per-repo commit+push, create
   one PR per repo (existing GitHub App flow in `apps/web/lib/github/actions/pr.ts`)
   and inject the `LinkedPrPlan.crossReferences` block into each PR body so the
   PRs reference each other. Persist `prNumber`/`prStatus`/`changeSetId` back on
   each `session_repos` row.

## Feasibility verdict — is it really Hard?

**Medium, not Hard, for the polyrepo coordinated-change core.** The mechanics —
multiple checkouts, per-repo branches, isolated commits, path routing, linked-PR
bodies — are all demonstrated here with real git and are mechanically simple
because git's working tree + index are already per-directory, which gives branch
isolation almost for free.

**The genuinely hard parts are organizational, not mechanical:** atomic
cross-repo merge (impossible on GitHub — see risks), CI coupling between repos,
and permissions spanning repos/installations.

**Minimal viable version:** `session_repos` table + a coordinator that clones N
repos and a `PathRouter` for tools; per-repo branch + commit + PR with
cross-reference text and a shared `changeSetId`. No attempt at atomic merge —
surface the linked set to the human and let them merge in order.

## Blind spots eliminated

- **Workspace layout** — distinct `/workspace/<repo>` checkouts proven; clone +
  branch-per-repo works.
- **Per-repo branch isolation** — proven: committing in one repo never touches
  another's HEAD/index/log (git's per-tree index guarantees this).
- **Path routing** — proven: correct repo resolution + rejection of paths
  outside all repos, including the nested-checkout most-specific-match case.
- **Atomic-ish cross-repo PRs** — proven via a shared `changeSetId` and
  cross-reference blocks; the set is *coordinated and discoverable*, not atomic.
- **Partial-failure / coherence** — proven: a one-repo-only change is detectably
  incoherent (the coherence check fails), which is the signal the integration
  must surface when one PR opens and the other fails.

## Remaining risks

- **Cross-repo merge ordering** — GitHub has no atomic multi-repo merge. If the
  api PR merges and the consumer PR does not, `main` is transiently broken.
  Mitigation: merge order metadata (primary last, or a merge-queue bot that
  merges the set together), and the `changeSetId` to detect a half-merged set.
- **CI coupling** — each repo's CI runs in isolation and won't see the other
  repo's branch, so consumer CI may fail against published `main`. Needs either
  ephemeral cross-repo preview wiring or relaxed required checks during the
  coordinated window.
- **Permissions across repos** — repos may live under different GitHub App
  installations/orgs; the session must hold a token per installation and fail
  cleanly when one repo is not authorized.
- **Monorepo vs polyrepo** — a monorepo with internal package boundaries is a
  single checkout and single PR; this design targets *polyrepo*. Monorepo
  "multi-package" coordination is a different (easier, single-PR) problem and
  should not be forced through `session_repos`.
- **Partial open failure** — if PR A opens and PR B fails, the cross-reference
  in A points at a branch with no PR. The integration must update the link once
  B succeeds, or roll A back to draft.
```
