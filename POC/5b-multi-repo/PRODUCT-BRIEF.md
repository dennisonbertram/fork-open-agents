# Product Brief: Multi-Repo / Monorepo Sessions

> Status: Proof-of-concept complete (eval-backed). This brief argues whether to productize it.

## TL;DR
Sessions are 1:1 with a repo today, so the most common real-world change — rename an API in one repo and fix its call site in another — is impossible in a single coordinated task. POC 5b proves a session that spans N repos: each cloned into its own workspace, edits path-routed to the correct repo, per-repo isolated branches and commits, and coordinated cross-referencing PRs sharing one `changeSetId`. The eval runs against **real git repos** (20/20 assertions, including a coherence build that fails before, passes after both repos change, and fails again on a partial one-repo change). Verdict: **Medium, not Hard** for the coordinated-change core — the hard parts are organizational (no atomic cross-repo merge), not mechanical. Build the minimal viable version; surface the linked set to the human rather than faking atomicity.

## The gap today
A session can only ever touch one repo. The `sessions` table carries single-repo columns (`repoOwner`, `repoName`, `branch`, `cloneUrl`, `prNumber`), `buildSandboxSource()` clones exactly one repo into one working directory, and every agent tool resolves paths against that single root via `resolveWorkspacePath()`. So a polyrepo change — the everyday case of an API and its consumer, a shared library and its users, a service and its client SDK — forces the user into two disconnected sessions, manual context-copying between them, and two PRs that don't know about each other. The user feels this as a coordination tax: they hold the cross-repo plan in their head, keep the two halves in sync by hand, and hope they merge in the right order. Teams with split frontend/backend or library/consumer repos feel it on nearly every non-trivial change.

## What we'd build
A session that spans multiple repos as a first-class object. The user picks N repos for the session; the system clones each into a distinct `/workspace/<repoName>`, and a `PathRouter` maps every file operation to the repo that owns it (most-specific match for nested checkouts, rejecting paths outside *every* repo — exactly as today's single-root router rejects out-of-workspace paths). The agent reads/edits/commits per repo on **isolated feature branches** (git's per-directory index gives branch isolation almost for free), then opens **one PR per repo**, each cross-referencing the others and sharing a single `changeSetId`. The POC proves all of this on real git: disjoint dirty-file sets, commits that never mention each other's sha, correct path routing with rejection of outside paths, and a linked-PR plan with cross-references — plus a coherence check proving the change is only correct when *both* repos move together.

## How users experience it
### Where it lives (exposure)
- **A multi-repo session picker** at session creation: start from a primary repo, then "+ Add repo" to attach secondaries (with role and order). The existing single-repo flow stays the default; multi-repo is an opt-in expansion.
- **A repos panel in the session header** listing every attached repo with its per-repo branch and live PR status, so the cross-repo state is always visible.
- **Add/remove a repo mid-session** (within installation/permission limits), since cross-repo scope is often discovered partway through a task.

### Sample UI
The **repos panel** is the home for multi-repo state — a list, one row per repo:
- Repo identity: `owner/name`, role badge (**primary** / **secondary**), order index.
- Per-repo branch: the isolated feature branch for this changeset.
- Per-repo PR status: **none → branch pushed → PR open → checks running → mergeable → merged**, with the PR number linked.
- A shared **changeset banner** above the list: "Changeset abc123 spans 2 repos" with a merge-order hint ("merge `consumer` after `api`").

States to design:
- **Single-repo (default)** — panel collapsed to one row; indistinguishable from today.
- **Multi-repo, editing** — per-repo dirty-file counts; the agent's current target repo highlighted.
- **Coordinated, PRs open** — both PRs linked, each body cross-referencing the other; a **coherence indicator** (green when both moved, **amber "incoherent: only api changed"** when a partial state is detected — the POC's coherence check surfaced to the user).
- **Half-merged (the danger state)** — api merged, consumer not: a prominent warning "`main` may be transiently broken until consumer #45 merges," with the merge-order metadata called out.
- **Permission failure** — a secondary repo under an un-authorized installation shows "not authorized" cleanly, without poisoning the rest of the session.
- **Partial open failure** — PR A opened, PR B failed to open: A's cross-reference shows "pending" until B succeeds.

### UX walkthrough
1. A user starts a session on `acme/api` (primary) and clicks "+ Add repo" → `acme/consumer` (secondary).
2. Both repos clone into `/workspace/api` and `/workspace/consumer`; the repos panel shows two rows, each on a fresh feature branch.
3. The user asks: "rename `getUserV1` to `fetchUser` and update the call site." The agent edits `src/users.js` (routed to api) and `src/app.js` (routed to consumer); an attempt to touch a path outside both repos is rejected.
4. The agent commits each repo's slice in isolation — the api commit touches only `users.js`, the consumer commit only `app.js`; neither log references the other.
5. The system opens two PRs, each body cross-referencing the other and tagged with the shared `changeSetId`. The coherence indicator is green (both moved).
6. The panel shows a merge-order hint. The user merges api, then consumer; the half-merged warning appears between the two merges and clears once consumer lands.

## Value to the user
**Job to be done:** "Make one logical change that crosses repo boundaries as a single coordinated task, not two disconnected ones."
- **Scenario — API + consumer.** Rename/refactor an endpoint and fix its caller in one session, with two linked PRs reviewers can see belong together.
- **Scenario — shared library bump.** Change a shared package and update every consuming repo's usage in the same changeset, with a single `changeSetId` to track the rollout.
- **Scenario — contract change.** Update a backend response shape and the frontend that parses it together, with the coherence check flagging if only one side moved before merge.

## Value to the product
- **Differentiation on real-world scope.** Most coding agents are stuck at one-repo-per-task; coordinated polyrepo changes are a capability competitors largely lack and that maps directly to how teams actually organize code.
- **Expansion into team/org accounts.** Multi-repo is inherently a team-shaped feature — it pulls open-agents from individual-repo tasks toward org-wide workflows, the natural expansion path to higher-tier accounts.
- **Activation for split-stack teams.** Any org with separate frontend/backend or library/consumer repos hits the 1:1 wall constantly; removing it is a concrete reason to adopt.
- **Strategic positioning.** "One agent, one task, every repo it touches" is a credible enterprise story that single-repo tools can't tell.

## The case FOR (strong)
1. **The mechanical core is proven on real git, not mocked.** Multiple checkouts, per-repo branches, isolated commits, path routing, and linked-PR bodies all work in the eval against real repositories — including the discriminating coherence test that fails on a partial change. This de-risks the part teams assume is hard.
2. **It's Medium, not Hard.** Git's per-directory working tree and index give branch isolation almost for free; the POC confirms a second commit in one repo never touches another's HEAD/index/log. The feared complexity is largely absent from the core.
3. **It generalizes the existing model cleanly.** `session_repos` is a straightforward N-row generalization of the single-repo columns already on `sessions`, with a clear migration window (backfill a `primary` row, dual-read, drop legacy columns). The `PathRouter` is a drop-in replacement for `resolveWorkspacePath()` with the same reject-outside-workspace semantics.
4. **It targets the everyday case.** API+consumer, library+users, service+client — these aren't edge cases; they're the default shape of real codebases. The 1:1 limit blocks the most common non-trivial change.
5. **A safe MVP exists.** Ship clone-N + `PathRouter` + per-repo branch/commit/PR with cross-references and a shared `changeSetId`, with **no attempt at atomic merge** — surface the linked set and let the human merge in order. This sidesteps the genuinely hard organizational problems while delivering the core value.

## The case AGAINST (strong)
1. **GitHub has no atomic cross-repo merge — and never will for us.** If the api PR merges and the consumer PR doesn't, `main` is transiently broken. We can add merge-order metadata, a merge-queue bot, and `changeSetId` detection, but we cannot make it atomic. We'd be shipping a coordinated-but-not-atomic primitive and managing user expectations about a half-merged window forever.
2. **CI coupling is unsolved and can block merges.** Each repo's CI runs in isolation and won't see the other repo's branch, so consumer CI can fail against published `main` even when the changeset is correct. Fixing this needs ephemeral cross-repo preview wiring or relaxed required checks during the coordinated window — both non-trivial, both org-policy-sensitive.
3. **Permissions span installations and orgs.** Repos may live under different GitHub App installations; the session must hold a token per installation and degrade cleanly when one repo isn't authorized. This multiplies the auth surface and the failure modes, and many orgs will simply not grant cross-repo access.
4. **Partial-open and partial-failure states are genuinely messy.** If PR A opens and PR B fails, A's cross-reference points at a branch with no PR; the integration must repair the link on B's success or roll A back to draft. These are the states users will actually hit, and they're the least pleasant to get right.
5. **It risks scope-creeping into monorepo coordination, which is a different problem.** A monorepo with internal package boundaries is one checkout and one PR; forcing it through `session_repos` is wrong. The boundary between "polyrepo (this design)" and "monorepo multi-package (simpler, single-PR)" must be policed, or the feature bloats.

## Effort, dependencies & risk
- **Feasibility verdict (from POC): Medium, not Hard** for the coordinated-change core; the hard parts are organizational, not mechanical.
- **Build size:** `session_repos` table + migration (backfill/dual-read/drop legacy columns); generalize `buildSandboxSource()` to clone N repos into `/workspace/<repo>`; replace `resolveWorkspacePath()` with `PathRouter` across `read.ts`/`edit.ts`/`write.ts`/`bash.ts`; coordinated PR creation via the existing GitHub App flow with cross-reference injection and `changeSetId` persistence; plus the net-new **repo picker / repos panel / coherence + half-merged UI**.
- **Dependencies:** the existing single-repo sandbox runtime, the GitHub App PR flow, and per-installation token handling. No dependency on 5a/5c.
- **Top risks + mitigations:** no atomic merge → merge-order metadata + optional merge-queue bot + `changeSetId` half-merge detection surfaced in UI; CI coupling → relaxed required checks or ephemeral cross-repo previews during the coordinated window; cross-installation permissions → token-per-installation + clean per-repo authorization failure; partial open/merge → link repair on success or draft-rollback; monorepo scope-creep → explicit polyrepo-only policy, route monorepos to the single-PR path.

## The decision
**The crisp question:** Do we ship a *coordinated* (cross-referenced, changeset-tagged, human-merged-in-order) multi-repo session now, explicitly **not** attempting atomic merge — or wait until we can solve the merge-queue/CI-coupling problem first?

**Recommended trigger to greenlight:** Greenlight the **MVP** when there's demonstrated demand from split-stack/library-owner users (e.g. repeated API+consumer or shared-library tasks split across sessions). Ship coordinated PRs with merge-order guidance and the half-merged warning; defer the merge-queue bot and CI-coupling work to a fast-follow.

**Success metrics:** number of multi-repo sessions / share of changes that are cross-repo; rate of cleanly-merged changesets (both PRs merged) vs. half-merged windows; time-to-coordinated-PR vs. the old two-session flow; incidence and duration of transiently-broken `main` from half-merges (must trend down as merge-order guidance lands).

**Suggested default: BUILD — but the MVP, soon, not now-now.** The core is proven and Medium-effort, and it targets the most common real change. Build the coordinated-not-atomic MVP behind the demand trigger; explicitly defer atomic-merge, merge-queue, and CI-coupling as a sequenced fast-follow rather than gating v1 on them. Do **not** let it absorb monorepo coordination.
