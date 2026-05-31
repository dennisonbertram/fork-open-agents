<!-- TITLE: feat: Multi-repo sessions (coordinated cross-repo changes, linked PRs) -->

## Why this matters

A session is 1:1 with a repo today, so the most common real-world change —
rename an API in one repo and fix its call site in another — is impossible as a
single coordinated task. The `sessions` table carries single-repo columns
(`repoOwner`, `repoName`, `branch`, `cloneUrl`, `prNumber`, `prStatus`),
`buildSandboxSource()` clones exactly one repo into one working directory, and
every agent tool resolves paths against that single root via
`resolveWorkspacePath()`. The everyday polyrepo case — API + consumer, shared
library + users, service + client SDK — forces users into two disconnected
sessions, manual context-copying, and two PRs that don't know about each other.
Teams with split frontend/backend feel this coordination tax on nearly every
non-trivial change.

POC 5b (PR #92, `poc/5b-multi-repo`) proved the coordinated-change core on
**real git repos** (20/20 assertions): N checkouts into distinct workspaces, a
`PathRouter` that routes every file op to the owning repo (rejecting outside
paths), per-repo isolated branches and commits with disjoint dirty-file sets,
and linked cross-referencing PRs sharing one `changeSetId`. A coherence build
**fails before** the change, **passes after** both repos move, and **fails again**
on a partial one-repo change — proving the change is only correct when
coordinated. Verdict: **Medium, not Hard** for the core; the hard parts (no
atomic cross-repo merge, CI coupling, cross-installation permissions) are
organizational. This issue scopes the coordinated-but-not-atomic MVP: surface the
linked set to the human, do not fake atomicity.

## User/operator path protected

The session → sandbox → agent-tools → PR path. Today this path assumes a single
workspace root throughout: one clone, one `workingDirectory`, one
`resolveWorkspacePath()` boundary, one PR. After this work, a session can span N
repos with **per-repo branch isolation** preserved end to end (a commit in one
repo never touches another's HEAD/index/log) and **coordinated linked PRs** that
cross-reference each other. The protected invariants are: (1) the existing
single-repo flow stays the default and unchanged; (2) a file op outside every
repo is rejected exactly as today's single-root router rejects out-of-workspace
paths; (3) per-repo isolation is never violated.

## Behavior contract

- **Given** a session with `acme/api` (primary) and `acme/consumer` (secondary),
  **when** the repos are attached, **then** each clones into a distinct
  `/workspace/<repoName>` on its own fresh feature branch and the repos panel
  shows both with per-repo branch + PR status.
- **Given** the agent edits `src/users.js` (owned by api) and `src/app.js`
  (owned by consumer), **when** it writes each file, **then** the `PathRouter`
  routes each to the owning repo (most-specific match for nested checkouts), and
  a write to a path outside **every** repo is rejected (`null`).
- **Given** edits in both repos, **when** each repo's slice is committed, **then**
  the api commit contains only `users.js`, the consumer commit only `app.js`,
  dirty-file sets are disjoint, commit shas differ, and neither `git log`
  references the other (per-repo branch isolation).
- **Given** committed slices, **when** PRs are opened, **then** exactly one PR
  per repo is created with correct `head`/`base`, each body cross-references the
  other repo's PR, and both share a single `changeSetId`.
- **Given** a coordinated change, **when** only one repo has changed, **then** the
  coherence check detects an incoherent (partial) state and the UI shows an amber
  "incoherent: only api changed" indicator.
- **Given** the api PR merges but the consumer PR has not, **when** the
  half-merged window is detected, **then** the UI shows a prominent "`main` may
  be transiently broken until consumer #N merges" warning with merge-order
  metadata.
- **Given** a secondary repo under an un-authorized GitHub App installation,
  **when** it is attached, **then** it fails cleanly as "not authorized" without
  poisoning the rest of the session.
- **Given** PR A opened and PR B failed to open, **when** the partial-open state
  is detected, **then** A's cross-reference shows "pending" until B succeeds or A
  is rolled back to draft.

## Product and design spec

### UX — how users use it & how it's exposed

- **A multi-repo session picker** at session creation: start from a primary repo,
  then **"+ Add repo"** to attach secondaries (with role and order). The existing
  single-repo flow stays the default; multi-repo is opt-in.
- **A repos panel in the session header** — one row per attached repo showing
  repo identity (`owner/name`), role badge (**primary**/**secondary**), order
  index, the per-repo isolated feature branch, and per-repo PR status (**none →
  branch pushed → PR open → checks running → mergeable → merged**) with the PR
  number linked.
- **A changeset banner** above the list: "Changeset abc123 spans 2 repos" with a
  merge-order hint ("merge `consumer` after `api`").
- **Add/remove a repo mid-session** within installation/permission limits, since
  cross-repo scope is often discovered partway through a task.

### UX — how the feature demonstrates & explains its value to the user

The value lands in one moment: a single task opens **linked PRs across repos**
that reviewers can see belong together. The user asks "rename `getUserV1` to
`fetchUser` and update the call site," and instead of two disconnected sessions
they get one coordinated changeset — the api PR and the consumer PR each
cross-reference the other and carry the same `changeSetId`. The coherence
indicator turning green when both repos move is the visible proof that the
cross-repo change is *complete and correct together*, not two halves the user has
to reconcile by hand. The merge-order hint and half-merged warning make the one
genuinely hard part (no atomic merge) safe and legible rather than surprising.

### UX — how it's clear what the feature is doing (states & feedback)

Every state is designed and reachable:
- **Single-repo (default)** — panel collapsed to one row; indistinguishable from
  today.
- **Multi-repo, editing** — per-repo dirty-file counts; the agent's current
  target repo highlighted.
- **Coordinated, PRs open** — both PRs linked, each body cross-referencing the
  other; a **coherence indicator** (green when both moved, amber "incoherent:
  only api changed" on a partial state — the POC's coherence check surfaced to
  the user).
- **Half-merged (danger state)** — api merged, consumer not: a prominent "`main`
  may be transiently broken until consumer #N merges" warning with merge-order
  metadata.
- **Permission failure** — a secondary repo under an un-authorized installation
  shows "not authorized" cleanly, without poisoning the rest of the session.
- **Partial-open failure** — PR A opened, PR B failed: A's cross-reference shows
  "pending" until B succeeds.

### UX — how to test the UX, including regressions

Use the [Authenticated Local UI Smoke](../../docs/process/development-workflow.md#authenticated-local-ui-smoke):
confirm DB env, apply migrations, `bun run web`, sign in.

- **Drive:** Create a session on a primary repo; click **"+ Add repo"** and
  attach a secondary; assert two rows in the repos panel, each on a fresh branch.
  Run a cross-repo edit; assert per-repo dirty-file counts update and an
  out-of-repo path is rejected. Trigger PR creation; assert two linked PRs with
  cross-references and a shared `changeSetId`, and the coherence indicator is
  green. Simulate a partial change; assert the amber "incoherent" state. Simulate
  api-merged/consumer-open; assert the half-merged warning. Attach an
  un-authorized repo; assert the clean "not authorized" state.
- **Assertions:** single-repo flow unchanged when no repo is added; per-repo
  branch/PR status accurate; cross-reference text present in both PR bodies.
- **UX regressions to lock (fail-before/pass-after):** (1) attaching a second
  repo must not alter the default single-repo session shape (fail if the picker
  leaks into single-repo); (2) an out-of-repo edit must be rejected (fail before
  `PathRouter`); (3) the half-merged warning must appear in the api-merged/
  consumer-open state and clear once consumer lands. Capture screenshots of
  single / multi-editing / PRs-open / half-merged / permission-fail states; check
  `agent-browser errors`/`console` and the dev-server log.

## Integration spec

- **Data model:** add `session_repos` to `apps/web/lib/db/schema.ts` (per
  `POC/5b-multi-repo/src/session-repos-schema.ts`), generalizing the single-repo
  columns on `sessions` (`repoOwner`, `repoName`, `branch`, `cloneUrl`,
  `prNumber`, `prStatus` — confirmed at `schema.ts` ~L228–L285) into N rows per
  session, adding `localPath`, `role` (`primary`/`secondary`), `orderIndex`, and
  `changeSetId`. Migration window: backfill a `primary` row from the existing
  `sessions` columns, dual-read, then drop the legacy columns.
- **Clone/workspace layout:** generalize `buildSandboxSource()` in
  `apps/web/app/workflows/chat-sandbox-runtime.ts` from one `cloneUrl` to a loop
  over `session_repos`, cloning each into `/workspace/<repoName>` (its
  `localPath`). The coordinator's `cloneAll()` in
  `POC/5b-multi-repo/src/coordinator.ts` is the reference shape.
- **Path-aware tool routing:** replace the single-root `resolveWorkspacePath()`
  in `packages/agent/tools/path-security.ts` (which today returns valid iff a
  path is within the one `workingDirectory` via `isPathWithinDirectory`) with a
  `PathRouter` (per `POC/5b-multi-repo/src/path-router.ts`) constructed from the
  session's repos. `read.ts`, `edit.ts`, `write.ts`, and `bash.ts` (its `cwd`
  resolution) resolve a path to the owning repo and run the op in that repo's
  `localPath`, rejecting outside paths exactly as `read.ts` rejects out-of-
  workspace paths today.
- **Per-repo git:** a per-cwd git wrapper (per
  `POC/5b-multi-repo/src/git.ts`) with the same `(command, cwd)` shape as
  `sandbox.exec(...)`, so every git op is repo-scoped.
- **Coordinated PRs:** after per-repo commit+push, create one PR per repo via the
  existing GitHub App flow in `apps/web/lib/github/actions/pr.ts`, inject the
  `LinkedPrPlan.crossReferences` block into each PR body, and persist
  `prNumber`/`prStatus`/`changeSetId` back on each `session_repos` row.
- **Events/observability:** a named `multi-repo` service emits structured clone /
  route-reject / commit / linked-PR / coherence events (see Observability).
- **Compatibility:** the single-repo path remains the default; `session_repos`
  with one `primary` row is behaviorally identical to today.

## In scope

- `session_repos` table + migration (backfill primary, dual-read, drop legacy
  columns).
- Generalize `buildSandboxSource()` to clone N repos into `/workspace/<repo>`.
- Replace `resolveWorkspacePath()` with `PathRouter` across `read.ts`/`edit.ts`/
  `write.ts`/`bash.ts`, preserving outside-path rejection.
- Per-repo branch/commit isolation via the per-cwd git wrapper.
- Coordinated linked-PR creation with cross-reference injection + shared
  `changeSetId` via the existing GitHub App flow.
- Repo picker, repos panel, changeset banner, coherence indicator, half-merged
  warning, permission-fail and partial-open states.
- Structured observability and the per-repo isolation regression test.

## Out of scope

- **Atomic cross-repo merge** (impossible on GitHub) — MVP surfaces the linked
  set with merge-order guidance; the human merges in order.
- A merge-queue bot and cross-repo CI-coupling fixes (sequenced fast-follow).
- Monorepo / multi-package coordination (a monorepo is one checkout, one PR — an
  explicit polyrepo-only policy routes monorepos to the single-PR path).
- Ephemeral cross-repo preview environments.
- Any dependency on 5a (memory) or 5c (budgets).

## Research and context sources

- POC PR: #92 (`poc/5b-multi-repo`).
- POC folder: `POC/5b-multi-repo/` — `README.md`, `PRODUCT-BRIEF.md`,
  `src/types.ts`, `src/session-repos-schema.ts`, `src/path-router.ts`,
  `src/git.ts`, `src/coordinator.ts`, `eval/run.ts`.
- Eval evidence: `POC/5b-multi-repo/evidence/` — `summary.json` (20/20),
  `api-commit.txt`, `consumer-commit.txt`, `api.diff`, `consumer.diff`,
  `coherence-before.txt`, `coherence-after.txt`, `linked-pr-plan.json`,
  `linked-pr-bodies.md`.
- Repo seams: `apps/web/lib/db/schema.ts` (`sessions` single-repo columns
  ~L228–L285), `apps/web/app/workflows/chat-sandbox-runtime.ts`
  (`buildSandboxSource`), `packages/agent/tools/path-security.ts`
  (`resolveWorkspacePath`/`isPathWithinDirectory`), `packages/agent/tools/`
  (`read.ts`, `bash.ts`), `packages/sandbox/interface.ts` (single
  `workingDirectory`/`currentBranch`), `apps/web/lib/github/actions/pr.ts`.
- Project docs: [Behavior-First TDD](../../docs/process/behavior-tdd.md),
  [Observability Discipline](../../docs/process/observability-discipline.md),
  [Feature Ticket Format](../../docs/process/feature-ticket-format.md).

## Agent todo checklist

- [ ] Read `POC/5b-multi-repo/README.md`, `PRODUCT-BRIEF.md`, and `src/` to map
      the coordinator/router shapes onto current `chat-sandbox-runtime.ts` and
      `path-security.ts`.
- [ ] Add a **failing** per-repo isolation test (committing in one repo never
      touches another's HEAD/index/log; dirty sets disjoint). Confirm red.
- [ ] Add a **failing** path-routing test (correct repo resolution + outside-path
      rejection, incl. nested most-specific match). Confirm red.
- [ ] Add a **failing** coherence test (fails on partial change, passes only when
      both repos move). Confirm red.
- [ ] Commit the failing test-only state on the work branch.
- [ ] Add `session_repos` to `schema.ts`; run
      `bun run --cwd apps/web db:generate`; commit the `.sql`. Implement
      backfill/dual-read.
- [ ] Generalize `buildSandboxSource()` to clone N repos into `/workspace/<repo>`.
- [ ] Replace `resolveWorkspacePath()` with `PathRouter`; update `read.ts`,
      `edit.ts`, `write.ts`, `bash.ts`.
- [ ] Add the per-cwd git wrapper for per-repo branch/commit isolation.
- [ ] Implement coordinated linked-PR creation + cross-reference injection +
      `changeSetId` persistence via `pr.ts`.
- [ ] Build the repo picker, repos panel, changeset banner, coherence indicator,
      half-merged warning, permission-fail and partial-open states.
- [ ] Add `multi-repo` structured events + redaction (never log tokens/clone
      URLs with credentials).
- [ ] Run targeted tests; run the authenticated local UI smoke; capture
      screenshots.
- [ ] Run the adjacent agent/sandbox/workflow suites, `git diff --check`, and
      `bun --bun run ci`.
- [ ] Update process/agent docs with verification notes.

## Tests to add first

1. **Per-repo isolation** — build two real git repos; commit a slice in each;
   assert disjoint dirty-file sets, differing shas, and that neither `git log`
   references the other; a second commit in repo A leaves repo B's HEAD/index
   untouched. **Must fail before isolated per-cwd git wiring.**
2. **Path routing** — assert the router maps each file to its owning repo
   (nested-checkout most-specific match) and returns `null` for a path outside
   every repo. **Must fail before `PathRouter` replaces single-root resolution.**
3. **Coherence** — a cross-checkout coherence script fails before the change,
   passes after both repos change, and fails again on a one-repo-only partial
   change.
4. **Linked-PR plan** — one PR per repo with correct `head`/`base`, each body
   cross-referencing the other and sharing one `changeSetId`.
5. **Compatibility** — a session with a single `primary` `session_repos` row
   behaves identically to today's single-repo session.

## Observability and user feedback

- **User-visible status:** the repos panel (per-repo branch + PR status), the
  changeset banner, the coherence indicator, and the half-merged warning.
- **Named service:** `multi-repo` emits structured events.
  - `repo-cloned` at info: `{ sessionId, changeSetId, repoOwner, repoName, role,
    localPath, branch }`.
  - `path-route-rejected` at warn: `{ sessionId, chatId, attemptedPath }`
    (path basename only; never log full absolute paths that could embed secrets).
  - `repo-committed` at info: `{ sessionId, changeSetId, repoOwner, repoName,
    sha, fileCount }`.
  - `linked-pr-opened` at info: `{ sessionId, changeSetId, repoOwner, repoName,
    prNumber, crossReferencedPrNumbers }`.
  - `coherence-evaluated` at info: `{ sessionId, changeSetId, coherent,
    changedRepos, totalRepos }`.
  - `half-merged-detected` at warn: `{ sessionId, changeSetId, mergedRepos,
    pendingRepos }`.
  - `repo-permission-denied` at warn: `{ sessionId, repoOwner, repoName,
    installationId, errorKind }`.
- **Typed error kinds:** `errorKind` ∈ `clone_failed | path_outside_all_repos |
  permission_denied | pr_open_failed | partial_open | coherence_incoherent`.
- **Correlation IDs:** `sessionId`, `chatId`, `changeSetId`, `repoOwner`,
  `repoName`, `installationId`, `prNumber`.
- **Redaction:** never log clone URLs containing tokens, GitHub App installation
  tokens, or full diffs; log shas, file counts, branch names, and IDs only.
- **Debug recipes:**
  `grep '"service":"multi-repo"' logs | grep '"changeSetId":"<id>"'`;
  to find half-merged sets:
  `grep '"half-merged-detected"' logs | grep '"sessionId":"<id>"'`.
- **Evidence expectation:** screenshots of single / multi-editing / PRs-open /
  half-merged / permission-fail states, plus the rendered linked-PR bodies and a
  log excerpt of a `repo-cloned` → `repo-committed` → `linked-pr-opened` →
  `coherence-evaluated` cycle.

## Regression harness plan

- **Existing coverage:** the single-repo sandbox runtime and tool path-security
  tests are the baseline; they must keep passing (compatibility).
- **New durable signals:**
  - A **per-repo isolation regression test** against real git (disjoint commits,
    no cross-log references) — the smallest durable signal that branch isolation
    regressed.
  - A **path-routing regression test** including outside-path rejection — a
    routing regression is a security-adjacent regression (writing outside a repo).
  - A coherence scenario test (fail-before/pass-after/partial-fail).
  - A linked-PR plan test asserting cross-references + shared `changeSetId`.
  - An authenticated UI smoke for the repos panel and half-merged warning.
- **Fixtures:** two real git repos built in the test (the POC `eval/run.ts`
  rename-and-update-call-site fixture).
- **Fail-before/pass-after:** isolation test fails if git ops aren't per-cwd;
  routing test fails before `PathRouter`; coherence fails on partial change.
- **Limits not caught by the harness:** no atomic cross-repo merge (organizational
  — surfaced, not prevented), CI coupling between repos, cross-installation
  permission grants that depend on real GitHub state, and partial-open repair
  timing. These are documented as risks and surfaced in UI rather than caught by
  a unit test.

## TDD audit trail

- **Red commit 1:** per-repo isolation test — observed failing.
- **Red commit 2:** path-routing test (incl. outside-path rejection) — failing.
- **Red commit 3:** coherence test (fail-before/pass-after/partial-fail) —
  failing.
- **Green commit 1:** `session_repos` schema/migration + per-cwd git wrapper →
  isolation green.
- **Green commit 2:** `PathRouter` across tools → routing green.
- **Green commit 3:** clone-N + coordinated linked-PR creation → coherence +
  linked-PR green.
- **Green commit 4:** UI (picker/panel/banner/coherence/half-merged) +
  observability.
- Any deviation recorded as an explicit exception in the PR.

## Regression risks and concerns

- **No atomic cross-repo merge** — if the api PR merges and the consumer PR does
  not, `main` is transiently broken. Mitigation: merge-order metadata, optional
  merge-queue bot (fast-follow), and `changeSetId` half-merge detection surfaced
  in UI. Not eliminable.
- **CI coupling** — each repo's CI runs in isolation and won't see the other
  repo's branch, so consumer CI may fail against published `main`. Mitigation:
  relaxed required checks or ephemeral cross-repo previews during the coordinated
  window (fast-follow).
- **Cross-installation permissions** — repos may live under different GitHub App
  installations; the session must hold a token per installation and degrade
  cleanly when one repo is not authorized.
- **Partial-open failure** — if PR A opens and PR B fails, A's cross-reference
  points at a branch with no PR; the integration must repair the link on B's
  success or roll A back to draft.
- **Monorepo scope-creep** — a monorepo is one checkout/one PR; forcing it
  through `session_repos` is wrong. An explicit polyrepo-only policy routes
  monorepos to the single-PR path.

## Deploy or migration impact

- **Migration:** new Drizzle migration adding `session_repos` (with `localPath`,
  `role`, `orderIndex`, `changeSetId`). Migration window: backfill a `primary`
  row per existing session from the `sessions` single-repo columns, run a
  dual-read period, then drop the legacy `sessions` repo columns in a follow-up
  migration. Migrations apply automatically on `bun run build` per deploy; Neon
  preview branching isolates preview data.
- **Operational:** verify GitHub App installation tokens are resolvable
  per-repo; confirm sandbox disk supports N checkouts under `/workspace/<repo>`.
- **Rollout:** ship behind a multi-repo enable flag; single-repo remains the
  default and unchanged. No user data backfill beyond the `primary`-row backfill.

## Definition of done

- [ ] Protected path named: session → sandbox → tools → PR, single-repo default
      preserved.
- [ ] Behavior proof written as **red** tests first and observed failing.
- [ ] Red-test commit recorded on the work branch (or an explicit exception).
- [ ] Green implementation commit(s) follow the red commit.
- [ ] Per-repo isolation regression test present and green.
- [ ] Path-routing regression test (incl. outside-path rejection) present and
      green.
- [ ] Coherence scenario test (fail-before/pass-after/partial-fail) green.
- [ ] Compatibility test: single `primary` row behaves identically to today.
- [ ] Targeted tests pass.
- [ ] Adjacent agent/sandbox/workflow suites pass.
- [ ] `git diff --check` clean.
- [ ] `bun --bun run ci` passes.
- [ ] Regression harness implemented (isolation + routing + coherence + linked-PR
      + UI smoke).
- [ ] Observability evidence captured (state screenshots + linked-PR bodies + a
      clone→commit→linked-PR→coherence log excerpt).
- [ ] Deploy notes included (`session_repos` migration + backfill/dual-read/drop;
      enable flag).
- [ ] Docs updated (architecture/lessons-learned + verification notes).
