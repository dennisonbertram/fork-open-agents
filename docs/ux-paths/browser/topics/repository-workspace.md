# UX Journeys — Repository Workspace: Directory, Dashboard, GitHub Actions, Secrets & Vercel Link

> Grounded against `apps/web/app/repos/**`, `apps/web/app/settings/repositories/**`,
> `apps/web/app/api/repos/[owner]/[repo]/dashboard/route.ts`,
> `apps/web/app/api/github/repos/[owner]/[repo]/actions/**`,
> `apps/web/app/api/github/repos/[owner]/[repo]/secrets/**`,
> `apps/web/lib/github/access.ts`, `apps/web/lib/github/actions-manager/**`,
> `apps/web/lib/github/secrets-manager/**`, `apps/web/lib/repo-settings/**`, and
> `apps/web/lib/repositories/routes.ts`. Every button label, window title, status
> string, and route below is copied from source, not invented.
>
> **Verified scope correction to the discovery brief**: the discovery doc
> describes `/repos/[owner]/[repo]` as "a dashboard with collapsible windows —
> Overview, Agents, Activity, Workflows/Loops, Tools, GitHub windows." That was
> true historically. Commit `76847bcf` ("make Repositories an owner-scoped
> directory") reduced the live page to four destination links; the window
> components still exist as files but two of them
> (`github-windows.tsx` — Pull Requests/Issues/Actions cards — and
> `tools-window.tsx` — the Tools tab) are **dead code**: grep confirms no
> route imports them outside their own test files, and
> `compatibility-routes.test.ts` (the test that pins which legacy repo routes
> must keep existing) does not list a route for either. `dashboard-windows.tsx`'s
> `AgentsWindow` and `workflows-window.tsx`'s `WorkflowsWindowView` *are* still
> live — just relocated to `/repos/[owner]/[repo]/project`, a separate route
> from the main dashboard. STORY-904 and STORY-905 document what is actually
> live today; the gap is called out explicitly rather than describing the
> orphaned components as if a user could reach them.

## STORY-901: A repo doesn't show up because the App was never installed on that org

**Type**: short
**Topic**: Repository Workspace
**Persona**: Farid, who just linked his GitHub account (personal `farid-dev` org) but his employer's repos live under the `acme-corp` GitHub organization, where the App isn't installed.
**Goal**: Understand why `acme-corp/checkout-service` isn't in his repository list.
**Preconditions**: Farid is signed in and has linked GitHub, but has zero GitHub App installations (`installations.length === 0`).
**Ideal path**: 1 — `loadRepositoryDirectory` returns `status: "installation_required"` the moment there are zero installations; there's no filter or search to try first, the empty state is immediate.
**Alternate paths**: None found — this is the only entry point to `/repos`.

### Steps
1. Farid opens `/repos`. → `ReposPage` calls `loadRepositoryDirectory(userId)`, which short-circuits to `{ status: "installation_required" }` before ever calling GitHub's repo-listing API.
2. He reads the message. → Heading "Install the GitHub App", body "Your account is connected, but no GitHub App installation grants repository access yet.", button "Choose repository access" linking to `/api/github/app/install?next=%2Frepos`.
3. He clicks it and, in GitHub's installer, picks the `acme-corp` org and selects `checkout-service`. → GitHub redirects back through the App-install callback; on success `/repos` now shows `checkout-service` in the list.

### Variations
- If Farid instead has zero linked GitHub account at all (`hasGitHubAccount` false), step 1 shows a different empty state: heading "Connect GitHub", button "Connect GitHub" (same `/api/github/app/install` href) — one fewer step already completed, same destination.

### Edge Cases
- If `acme-corp` requires org-admin approval for App installations, the install flow can leave Farid in a "pending approval" state (per the discovery doc's onboarding notes) — `/repos` has no special copy for that; it just keeps showing `installation_required` until an admin approves and the row appears.

---

## STORY-902: Opening a repo from the directory, and the sort order that makes yesterday's push win over the alphabet

**Type**: medium
**Topic**: Repository Workspace
**Persona**: Priya, who works across a dozen repos under two orgs (`acme-corp`, personal `priya-oss`) and wants to jump into whichever one she pushed to most recently.
**Goal**: Find a specific repo in the directory and land in its workspace hub.
**Preconditions**: Priya has ≥2 GitHub App installations across two account logins, each covering several repos, some of which she updated at different times.
**Ideal path**: 2 — `/repos` → click the repo's "Open {owner}/{repo}" link. No search box exists on this page; ordering has to do the finding for her.
**Alternate paths**: None found — no filter, search, or sort control exists on `/repos`; `compareRepositories` picks the order for her.

### Steps
1. Priya opens `/repos`. → `loadRepositoryDirectory` fans out `listUserInstallationRepositories` across every installation in parallel (`Promise.allSettled`, up to 100 repos per installation), then de-dupes by lowercased `owner/name` — if the same repo is technically visible through two installations, `preferCandidate` keeps only the more recently updated entry. The merged list sorts by `updatedAt` descending (ties broken alphabetically, case-insensitive).
2. She scans the list. → Each row shows a lock icon for private repos, `owner/name` in monospace, an optional description (2-line clamp), and `language ?? "Language not reported"` — no stars, no visibility filter, no per-org grouping.
3. She clicks "Open acme-corp/checkout-service" (`ArrowRight` icon). → Navigates to `/repos/acme-corp/checkout-service` (`repositoryDashboardUrl`).

### Variations
- If two installations both grant access to the exact same repo (e.g. installed at both the org and a parent-account level), it appears once, not twice — `preferCandidate` resolves the duplicate silently; there's no UI signal that a dedup happened.

### Edge Cases
- There is no pagination and no search on `/repos` — with installations near the 100-repo-per-installation cap, the only way to find a repo is remembering it's near the top (recently updated) or scrolling the full list.

---

## STORY-903: One installation is down, but the list doesn't just look empty

**Type**: short
**Topic**: Repository Workspace
**Persona**: Marcus, whose personal-account installation is healthy but whose org installation's token briefly fails to enumerate repos (rate limit or transient GitHub error).
**Goal**: Trust that an empty-looking gap in the list is a real signal, not "no access."
**Preconditions**: Marcus has ≥2 installations; `listUserInstallationRepositories` rejects for at least one but not all of them.
**Ideal path**: 1 — the page renders the partial-failure banner automatically; there's nothing to click to discover it.
**Alternate paths**: none found.

### Steps
1. Marcus opens `/repos`. → Because at least one installation succeeded, `loadRepositoryDirectory` returns `status: "partial"` with whatever repos the healthy installations returned, plus `failedInstallationCount`.
2. He sees an amber `role="alert"` banner above the list: "Some GitHub installations could not be loaded" / "Showing repositories from the installations that responded. Request {requestId}." → The `requestId` is the concrete, supportable evidence trail — he can hand it to a teammate or a bug report.
3. He still sees and can open every repo from the healthy installation normally.

### Variations
- If **every** installation fails (`failures.length === results.length`), the status becomes `error` instead of `partial`: full-page `role="alert"` section, heading "Repositories could not be loaded", "Retry" (`RefreshCw` icon, links back to `/repos`) and "Settings → Connections" buttons — no repo rows at all.
- If installations succeed but return zero repos combined, status is `empty`: heading "No accessible repositories", body "Update your GitHub App installation to grant access to at least one repository.", button "Manage GitHub access" → `/settings/connections`.

### Edge Cases
- "Partial" and "empty" look nearly identical if the healthy installation happens to also return zero repos — partial's banner is the only differentiator; a user who doesn't read it could conclude "no repos" when the real story is "one installation is broken."

---

## STORY-904: The repo dashboard is a hub, not a report — and where the old report went

**Type**: medium
**Topic**: Repository Workspace
**Persona**: Dana, opening a repo she hasn't touched in Open Agents before, expecting an overview of its PRs/issues/CI like a typical repo dashboard.
**Goal**: Get oriented in `acme-corp/checkout-service` and start a session.
**Preconditions**: Dana has read access to the repo (GitHub App installation covers it).
**Ideal path**: 1 — `/repos/{owner}/{repo}` renders everything she needs to pick a next action on one screen; there's no drill-down required to see the four destinations.
**Alternate paths**: She could also reach a session against this repo from the repo picker inside "New Session" on `/sessions`, bypassing `/repos` entirely — not documented here since that's Session Creation's flow, but worth knowing the dashboard isn't the only door in.

### Steps
1. Dana clicks into `checkout-service` from `/repos`. → `RepoDashboardPage` calls `verifyRepoAccess({ requiredUserPermission: "read" })` server-side; on success it renders `RepositoryDashboardView` with `owner/repo` as a monospace `<h1>` and a "Repositories" breadcrumb back link.
2. She sees a 2×2 grid of destination cards: **New Session** (`Plus` icon, opens the new-session dialog pre-filled with this repo, via `useSessionsShell().openNewSessionDialog({owner, repo})` — no navigation, just opens a dialog in place), **Automations** (count summary, links to `/automations?repository=owner%2Frepo`), **Runs** (count summary, "N Runs" or "N+ recent Runs" if `hasMore`, links to `/runs?repoOwner=...&repoName=...`), and **GitHub** (external link icon, opens `github.com/{owner}/{repo}` in a new tab).
3. Below the grid, a ghost "Repository settings" button (`Settings` icon) links to `/settings/repositories/{owner}/{repo}` — the only way from this page to reach per-repo defaults, Actions, Secrets, or Project. None of those three are linked directly from the dashboard.
4. She clicks "New Session" and starts working — no extra navigation needed.

### Variations
- If Dana lacks any access to the repo (revoked, private, wrong owner typed in the URL), `verifyRepoAccess` returns `ok: false` and the page calls Next's `notFound()` — a plain 404, not an access-denied message explaining *why* (expired token vs. no installation vs. genuinely no permission are all collapsed into the same 404 here, unlike the typed reasons `getRepoAccessErrorMessage` defines for other surfaces).
- If `verifyRepoAccess` itself throws (GitHub outage mid-check, not just "access denied"), the page catches it and renders `RepositoryDashboardAccessError`: "Repository access could not be verified" / "Access to {owner}/{repo} could not be checked. Return to Repositories and try again." with a "Back to Repositories" button — this is the one branch that does distinguish "couldn't check" from "checked and denied."
- If the Automations or Runs summary fetch fails independently, its card still renders but shows "Automation summary unavailable" / "Run summary unavailable" in red instead of blocking the whole dashboard (`Promise.allSettled` isolation in `loadRepositoryDashboardSummary`).

### Edge Cases
- Neither Actions nor Secrets nor Project is reachable from this page at all — a user who doesn't already know `/repos/{owner}/{repo}/actions` exists as a URL, or doesn't go through Repository settings first, has no discoverable path to it from the dashboard. The dead `github-windows.tsx`/`tools-window.tsx` components would have surfaced PRs/Issues/Actions/Tools summaries and links directly on this page; today none of that exists here.

---

## STORY-905: Finding the repo's agents and loops on the Project page

**Type**: medium
**Topic**: Repository Workspace
**Persona**: Priya, who knows this repo has a background agent configured and wants to check its status without leaving the repo context.
**Goal**: See the repo's agents and loops together, and start a new loop scoped to this repo.
**Preconditions**: Priya has read access to the repo; `AGENT_LOOPS_ENABLED` is on.
**Ideal path**: 2 — she has to already know or guess the `/project` URL segment (there's no link to it from `/repos/{owner}/{repo}`); once there, one click reaches "New loop."
**Alternate paths**: `/repos/{owner}/{repo}/agents` (the standalone repo-agents dashboard) and `/repos/{owner}/{repo}/loops` (the standalone repo-loops list) show the same underlying data with more depth per surface — those are the Background Agents and Agent Loops topics' primary routes; `/project` is a condensed combined view of both.

### Steps
1. Priya navigates directly to `/repos/acme-corp/checkout-service/project` (typed URL or a bookmark — there's no link from the dashboard). → `RepoProjectPage` fetches `listRepoBackgroundAgents` and `listAgentLoops` in parallel with independent failure isolation (`Promise.allSettled`); a failure in one never blocks the other.
2. She sees the "Project agents" window (title from `AgentsWindow`): each agent row shows name, a status pill (green for `succeeded`/`enabled`/`active`, red for `failed`, amber for `running`/`queued`/`paused`, gray otherwise), a 2-line instructions preview, and trigger-kind chips.
3. Below it, the "Loops" window (`WorkflowsWindowView`, a `CollapsibleDashboardCard`) shows a one-line summary ("N loops · M active"), each loop's name/description/status pill, and an inline `LoopRunPreview`.
4. She clicks "New loop" in the Loops window header. → Navigates to `/loops/new?repoOwner=acme-corp&repoName=checkout-service`, pre-scoped to this repo.

### Variations
- If there are zero loops, the window instead shows "No loops configured for this repository." with a "Create your first loop" button in the same spot.
- The page header itself has an explicit "Repo dashboard" back button (`ArrowLeft`) and an "Agents settings" button pointing to `/settings/background-agents` — Project is the one repo-scoped sub-page that bothers to link back to the dashboard; Actions and Secrets (STORY-906–910) do not.

### Edge Cases
- `AGENT_LOOPS_ENABLED` off: the Loops window doesn't render at all (`loopsEnabled` gate), and the page silently becomes agents-only with no explanation that loops exist as a concept but are switched off.

---

## STORY-906: Watching a CI run go from queued to done, then reading its logs

**Type**: long
**Topic**: Repository Workspace
**Persona**: Marcus, whose PR just triggered a GitHub Actions run and who wants to watch it without leaving Open Agents for github.com.
**Goal**: Confirm the run passes and, if a job fails, read exactly what broke.
**Preconditions**: Marcus has read access to the repo; the GitHub App has Actions `read` permission for it (readiness `status: "ready"`).
**Ideal path**: 4 — `/repos/{owner}/{repo}/actions` → wait for the readiness check → click the running row → click a job → read the log. No shorter path exists; there's no direct-link-to-a-known-run-id affordance in this UI.
**Alternate paths**: None found inside Open Agents — the "GitHub" external link on the run detail sheet (and on `ReadinessVerdict`'s action button, when shown) is the only escape hatch to github.com's own Actions UI, which is a fuller alternate surface but outside this app.

### Steps
1. Marcus opens `/repos/acme-corp/checkout-service/actions`. → `ActionsPage` renders instantly (no server-side `verifyRepoAccess` — the page shell always loads for any authenticated user); `ActionsDashboardClient` then fires two parallel `readiness` fetches (`?` no param = read, `?permission=write` = write) plus, once read-readiness is `"ready"`, a `runs` fetch and a `workflows` fetch.
2. He sees `ReadinessVerdict`: headline "Connected — Actions read available", subtext "Workflow runs, jobs, and logs can be viewed for this repo." — a manual refresh icon re-triggers all four SWR fetches.
3. Below it, run rows render: a colored `StatusDot` (tooltip = human label), `{name} #{runNumber}`, a branch badge, `{actor} / {event} / {relative time} / {duration}`, and the display label on the right. One row shows `queued`/`in_progress` — `runs`'s SWR `refreshInterval` self-adjusts to poll every 5s *only* while any run in the list is `queued`/`in_progress`, and stops polling once none are.
4. He clicks that row. → A `Sheet` opens: title = run name, description "#{runNumber} / {label} / {branch}", a "GitHub" external-link button to the run's `htmlUrl`, and a "Jobs" list (each with a status icon and label) fetched from `/actions/runs/{runId}/jobs`.
5. He clicks a job. → `LogsPanel` fetches `/actions/jobs/{jobId}/logs` (proxied server-side through the GitHub App's installation token, `content-type: text/plain`) and renders it in a `<pre role="log" aria-live="polite">` block, with a "Copy logs" icon button.

### Variations
- If the selected job is still running, the panel still attempts the fetch — GitHub serves partial logs for in-progress jobs, so the pre-block just shows however much exists so far; there's no explicit "still running, logs incomplete" caption distinguishing that from a finished job's complete log.
- Very large logs are truncated server-side (`proxyJobLogs` reports `truncated`/`bytes`/`originalBytes` via response headers) — the client never reads those headers or shows a truncation notice; a truncated log looks identical to a complete one in the UI.

### Edge Cases
- If GitHub rate-limits mid-session, `errorCopy` maps `github_rate_limited` to "GitHub is rate-limiting requests - try again in a moment." on the runs list; the jobs/logs fetches inside the sheet have no equivalent mapped copy and fall back to generic "Could not load jobs." / "Could not load logs." text.
- Zero runs ever recorded: "No workflow runs yet for this repo." in a dashed-border empty state — indistinguishable at a glance from "Actions isn't enabled for this repo at all," since that case instead surfaces through the readiness banner, not the run list.

---

## STORY-907: Manually dispatching a workflow with typed inputs

**Type**: medium
**Topic**: Repository Workspace
**Persona**: Priya, who wants to manually trigger a `deploy.yml` workflow that takes an `environment` choice input and a `dry_run` boolean, without pushing a commit.
**Goal**: Start a `workflow_dispatch` run with the right inputs.
**Preconditions**: Priya has write access; Actions write-readiness is `"ready"`; at least one workflow in the repo declares `workflow_dispatch` triggers (`workflow.dispatch` is non-null).
**Ideal path**: 3 — open Actions → open the dialog → submit. The one constraint that can add a retry is that the ref field must exactly equal the default branch.
**Alternate paths**: none found inside the app; going to github.com's own "Run workflow" UI reaches the same GitHub endpoint but isn't wired to this app's run-polling.

### Steps
1. Priya opens `/repos/acme-corp/checkout-service/actions` and, once ready, clicks "Run workflow" (`Play` icon, top-right, only rendered once `isReady`). → A `Dialog` opens: title "Run workflow", description "Start a workflow_dispatch run on the default branch."
2. She picks `deploy.yml` from the Workflow `Select` (only workflows with `dispatch` metadata are listed — `dispatchWorkflows = workflows.filter(w => w.dispatch)`), leaves Ref at its pre-filled default (`defaultBranch` from the readiness response), and the input fields update reactively to that workflow's declared inputs.
3. She sets `environment` (a `choice` input → rendered as a `Select` of `input.options`) to `staging`, and toggles `dry_run` (a `boolean` input → rendered as a `Switch`, stored as the string `"true"`/`"false"`).
4. She clicks "Run workflow" (submit). → Client-side `dispatchSchema` (zod) validates non-empty `workflowId`/`ref`; then a client-side check that `ref === defaultBranch` (redundant with the server's own check, but gives instant feedback); on pass, `POST /actions/workflows/{id}/dispatch` with `{ ref, inputs }`.
5. The server dispatches, then polls GitHub briefly for the newly created run and returns it. → Toast: "Run started" (or "Dispatched - run may take a moment to appear" if polling didn't find it yet); the dialog closes and `pollRunsBriefly` re-fetches the runs list on a decaying schedule (2s, 4s, 6s, 8s, 10s, 14s, 18s) so the new run appears without a manual refresh.

### Variations
- If she edits the Ref field to a non-default branch, submit is blocked client-side with the exact reason spelled out: "This workflow must exist on the default branch ({defaultBranch}) to be dispatched" — the server enforces the identical rule and would 400 with `workflow_not_on_default_branch` if the client check were bypassed.
- A `string` input with `required: true` shows a red `*` next to its label and uses native HTML `required`; a `string` input without `required` has no client-side enforcement at all beyond GitHub's own eventual validation.

### Edge Cases
- If no workflow in the repo declares `workflow_dispatch`, the trigger button is disabled with tooltip "No workflows in this repo accept manual runs" — distinct from the write-permission-disabled case, which shows the readiness `subtext` instead. Both render as the same disabled-button-plus-tooltip shape; the reason only differs in the tooltip text.

---

## STORY-908: Re-running failed jobs and cancelling a run mid-flight

**Type**: short
**Topic**: Repository Workspace
**Persona**: Dana, whose CI run just failed on a flaky test and who separately wants to cancel a different, now-unnecessary run that's still queued.
**Goal**: Re-run only the failed jobs on one run, and cancel another.
**Preconditions**: Write-readiness is `"ready"`; one run has `conclusion === "failure"`, another has status in `{queued, in_progress, requested, waiting, pending}`.
**Ideal path**: 1 — everything happens from the row-level dropdown; no dialog, no confirmation step for either action.
**Alternate paths**: none found.

### Steps
1. Dana clicks the `MoreHorizontal` icon on the failed run's row. → `RunActionsMenu` opens: "Re-run all jobs", "Re-run failed jobs" (only shown because `conclusion === "failure"`) — no "Cancel" item, since this run already finished.
2. She clicks "Re-run failed jobs". → `POST /actions/runs/{id}/rerun?onlyFailed=true`; toast "Re-running failed jobs for #{runNumber}"; `onMutated` triggers the same decaying re-poll as dispatch.
3. On the still-queued run's row, she opens its menu — "Cancel run #{runNumber}" appears in red/destructive styling (only because its status is in the cancellable set) — and clicks it. → `POST /actions/runs/{id}/cancel`; toast "Cancelling #{runNumber}"; no confirmation dialog stands between the click and the cancel request.

### Variations
- If write-readiness isn't `"ready"` (see STORY-909), the trigger button itself is still visible but `disabled`, wrapped in a `Tooltip` showing the `subtext` reason — hovering (not clicking) is how a user discovers why it's greyed out.

### Edge Cases
- Cancel has **no confirmation dialog** — one misclick on a shared team run cancels it immediately, unlike Secrets' delete flow (STORY-910) which does confirm. If GitHub itself refuses the cancel (already completing), `mutationErrorCopy` falls back to "GitHub could not cancel this run." for the specific `run_not_cancellable` error kind — the one action-specific error message in this whole menu.

---

## STORY-909: The GitHub App itself hasn't been granted Actions permission

**Type**: medium
**Topic**: Repository Workspace
**Persona**: Farid, whose org's admin installed the App with a minimal permission set that didn't include Actions.
**Goal**: Understand why the Actions page shows nothing, and fix it.
**Preconditions**: The installation's App-level `permissions.actions` is unset or below the required level (this is a property of the **installation**, not of Farid's own repo role).
**Ideal path**: 2 — the readiness banner names the fix and links straight to it.
**Alternate paths**: An org admin could instead re-run the App's install flow from `/api/github/app/install`, which would prompt for the same permission grant — not surfaced from this page, only from `/repos`' own connect flow.

### Steps
1. Farid opens `/repos/acme-corp/checkout-service/actions`. → `getActionsManagerReadinessCheck` calls `GET /app` on the App's own metadata, finds `permissions.actions` doesn't satisfy `"read"`, and returns `status: "action-needed"`.
2. `ReadinessVerdict` shows headline "Re-authorize the GitHub App to view Actions", subtext "This repo needs the GitHub App's Actions read permission.", and an action button "Open GitHub App settings" linking to `https://github.com/apps/{slug}/installations/new/permissions` (or a fallback `github.com/settings/installations/{id}` URL if the App's slug can't be resolved) — opens in a new tab.
3. He clicks it, GitHub prompts to accept the new permission grant, he approves. → Back in Open Agents, he clicks the refresh icon on `ReadinessVerdict`; readiness re-checks and (once the App-level grant covers the repo too) flips to "ready".

### Variations
- Even after the App gains blanket "Actions: read" at the account level, a **second** check runs — `withScopedInstallationOctokit` actually calling the repo — which can still fail with `action-needed` if this specific repo wasn't included in the installation's repo selection, using the same headline but subtext "This installation has not granted Actions read permission for this repo."
- The write-readiness check repeats the exact same two-stage logic with `requiredPermission: "write"`, independently of read — a repo can be Actions-read-ready and Actions-write-not-ready at the same time (this is exactly what gates the Run-workflow/Rerun/Cancel controls in STORY-907/908).

### Edge Cases
- If the GitHub App itself isn't configured for this deployment at all (missing credentials), both readiness checks short-circuit to `status: "unavailable"`, headline "GitHub App is not configured" — visually similar enough to "action-needed" (same amber-ish treatment via `ReadinessVerdict`) that an operator has to read the subtext to tell "this environment isn't set up" apart from "this one repo needs a permission grant."

---

## STORY-910: Adding, rotating, and deleting a repository secret

**Type**: long
**Topic**: Repository Workspace
**Persona**: Marcus, setting up a `DEPLOY_TOKEN` secret for a new workflow, then rotating it three weeks later after a security review, then deleting an old unused one.
**Goal**: Manage the repo's GitHub Actions secrets without ever needing (or being able) to see a value once saved.
**Preconditions**: Secrets write-readiness (`canWrite`) is true.
**Ideal path**: 3 per operation (open Secrets → open the row/Add menu → confirm the form) — none of the three operations (create, rotate, delete) is shorter than that.
**Alternate paths**: none found inside the app.

### Steps — create
1. Marcus opens `/repos/acme-corp/checkout-service/secrets`. → Page description up front: "GitHub never returns secret values, so we only show names." `RepositorySecretsClient` fetches `GET /secrets`, which returns both `readiness` and the current `secrets` list (name + `createdAt`/`updatedAt` only — GitHub's API genuinely never returns values, so there is nothing server-side to redact either).
2. He clicks "Add secret" (`Plus` icon, disabled unless `readiness.canWrite`). → `AddSecretDialog` opens in "add" mode: title "Add repository secret", description "Enter a value to store in GitHub Actions. Values are encrypted server-side before they reach GitHub."
3. He types `DEPLOY_TOKEN` in Name (validated live by the same regex as the server: `^(?!GITHUB_)(?![0-9])[A-Z0-9_]+$`, help text visible under the field) and pastes the token value into the Value `Textarea` (monospace, max 48 KB, `autoComplete="off"`).
4. He submits. → `POST /secrets` (libsodium-encrypted server-side before reaching GitHub, per the description copy and the `putRepoSecret` implementation); toast "Secret DEPLOY_TOKEN saved"; the table re-fetches and shows the new row with `updatedAt` as "just now" (relative time, exact timestamp on hover tooltip).

### Steps — rotate
5. Three weeks later, Marcus opens the row's `MoreHorizontal` menu and clicks "Edit value". → The same `AddSecretDialog` opens in "edit" mode: title "Update value of DEPLOY_TOKEN", the **Name field is disabled** and pre-filled (can't rename via edit — matches GitHub's own model where a secret's identity is its name), only Value is editable and starts blank (never pre-filled with the old value, because the app never has it to pre-fill).
6. He pastes the new token and submits. → `PUT /secrets/DEPLOY_TOKEN`; same libsodium-encrypt-then-`PUT` path as create; toast "Secret DEPLOY_TOKEN saved"; `updatedAt` refreshes.

### Steps — delete
7. On an old secret's row, Marcus clicks "Delete" (destructive, in the same dropdown). → An `AlertDialog` interrupts: title "Delete {name}?", body "This can break workflows that use it.", actions "Cancel" / "Delete secret" (destructive-styled) — this is the one destructive action across Actions+Secrets that *does* get a confirm step, unlike Cancel-run (STORY-908).
8. He confirms. → `DELETE /secrets/{name}`; toast "Secret {name} deleted"; row disappears; table re-fetches.

### Variations
- A name that violates the pattern (lowercase, starts with a digit, starts with `GITHUB_`) is caught client-side before submit with the exact same help text used as the error; a value over 48 KB is caught client-side too (`secret_too_large`), so a rejection round-trip to the server for either of these is avoidable in the happy path.

### Edge Cases
- **Verified: the UI never reveals a secret's value once saved**, in either the table or either dialog mode — the table's own caption states this explicitly ("GitHub never returns secret values; this table only contains names and metadata."), and the code has no code path that could display one (the API responses for list/create/update never include a `value` field). This is a real, checked-against-source guarantee, not just copy.
- If GitHub itself rate-limits a save or delete, `errorCopy`/`mutationErrorCopy` both map `github_rate_limited` to "GitHub is rate-limiting requests - try again in a moment."; every other unmapped failure (including the read-only-collaborator case in STORY-911) collapses to a generic "Couldn't save the secret - try again." / "Couldn't delete the secret - try again." with no further detail.

---

## STORY-911: A read-only collaborator sees "Run workflow" and "Add secret" as clickable — and only finds out they can't when the request fails

**Type**: long
**Topic**: Repository Workspace
**Persona**: Elena, added to `acme-corp/checkout-service` as a **read-only** collaborator (triage/read GitHub role — `permissions.push`, `.maintain`, `.admin` all false), who wants to check CI status and, out of habit, tries to dispatch a workflow and add a secret.
**Goal**: (Test scenario) See whether the UI correctly prevents write actions for a read-only user, and whether it explains why when it doesn't.
**Preconditions**: Elena is signed in, GitHub grants her `read`-only permission on the repo, and the App installation itself *does* have Actions:write and Secrets:write scopes (a realistic setup, since the App needs those scopes to serve other users of the same installation who genuinely have write access).
**Ideal path**: N/A — this story characterizes actual behavior rather than an efficient path to a goal.
**Alternate paths**: none — this is what the code does, not a choice Elena makes.

### Steps
1. Elena opens `/repos/acme-corp/checkout-service`. → `verifyRepoAccess({ requiredUserPermission: "read" })` succeeds (she has read access); the dashboard renders normally, including the "New Session" card — session creation isn't gated by write permission at this layer either.
2. She opens `/repos/acme-corp/checkout-service/actions`. → The page shell always renders (no server-side access check in `ActionsPage` itself). The client fires both readiness fetches. **Critically: `getActionsManagerReadinessCheck` only inspects the GitHub App installation's own `permissions.actions` value — it never reads `verifyRepoAccess`'s resolved `userPermission`.** Because the installation has Actions:write, `?permission=write` readiness comes back `"ready"` for Elena exactly as it would for a repo admin.
3. She sees "Run workflow" fully enabled (not greyed out, no tooltip) and every run row's `MoreHorizontal` menu fully enabled — nothing in the UI signals she's a read-only user.
4. She clicks "Run workflow", fills the form, submits. → `POST /actions/workflows/{id}/dispatch` calls `requireActionsWriteAccess`, which calls `verifyRepoAccess({ requiredUserPermission: "write" })` — **this** check does read her real GitHub role, resolves `user_no_write`, and the route returns 403 with `errorKind: "repo_access_denied"`.
5. The dialog's `mutationErrorCopy` has no case for `"repo_access_denied"` — it falls to the default: **"GitHub could not start that workflow."** Nothing in the toast, the dialog's inline `formError`, or anywhere else states that the real cause is her own lack of write access to the repo.
6. She separately opens `/repos/acme-corp/checkout-service/secrets` and clicks "Add secret" — the button is enabled for the identical reason (`getSecretsManagerReadinessCheck` is also purely App-installation-scoped: `apps/web/lib/github/secrets-manager/readiness.ts`, `canWrite = permissionSatisfies(appPermissions.secrets, "write")`, with no reference to the calling user's permission at all). She fills the form and submits; `POST /secrets` calls `requireSecretsAccess(context, "write")` → `verifyRepoAccess({ requiredUserPermission: "write" })` → 403 `repo_access_denied` → generic fallback copy: **"Couldn't save the secret - try again."**

### Variations
- Rerun/rerun-failed/cancel (STORY-908) fail the identical way: the row menu is enabled (gated only by the App-level `writeReadinessVerdict`), the mutation route enforces user-level write, and `mutationErrorCopy` in `run-actions-menu.tsx` has no case for `repo_access_denied` either — same generic "GitHub could not complete that action."

### Edge Cases
- **This is not "write actions correctly unavailable" — it's the opposite finding.** The client never fetches or checks the caller's own repo permission for Actions or Secrets; it only checks whether the *installation* has the scope. The server-side mutation routes do correctly enforce `requiredUserPermission: "write"` via `verifyRepoAccess`, so nothing insecure actually happens — Elena cannot dispatch a run or write a secret — but the UI actively misleads her into thinking she can, right up until a generic, unhelpful failure toast. **The UI does not explain why: no case in any of the three `mutationErrorCopy`/`errorCopy` functions (`run-actions-menu.tsx`, `dispatch-dialog.tsx`, `repository-secrets-client.tsx`, `add-secret-dialog.tsx`) maps `repo_access_denied` to a permission-specific message; every one silently falls through to its generic default.**
- By contrast, `/settings/repositories/{owner}/{repo}` (STORY-912/913) has **no repo-access check at all**, server or client — Elena could open it and see/edit per-repo session defaults and Composio policy for a repo she only has read access to, since those settings are scoped by `(userId, repoOwner, repoName)` in the database with no GitHub permission check anywhere in `GET`/`PATCH`/`DELETE /api/settings/repositories/{owner}/{repo}`. This doesn't let her touch the actual repo or its secrets, but it is a second, distinct gap in the same family: the write-permission boundary that Actions/Secrets at least *try* (and partially fail) to enforce isn't checked here at all.

---

## STORY-912: Overriding this one repo's runtime and git-automation defaults

**Type**: medium
**Topic**: Repository Workspace
**Persona**: Priya, whose account-wide default is 2 vCPUs and Classic runtime, but `checkout-service` specifically needs the Managed runtime profile and more headroom because its test suite is heavy.
**Goal**: Override just this repo's runtime settings without touching her global defaults.
**Preconditions**: Priya is signed in; no repo-access check gates this page (see STORY-911's edge case) — she just needs to be authenticated.
**Ideal path**: 2 — `/settings/repositories/checkout-service` (via the picker or a direct link) → change the two fields. Every field autosaves on change/blur; there's no separate "Save" step.
**Alternate paths**: reachable either via `/settings/repositories` → `RepoSelector` picker → auto-navigates on selection, or via `/repos/{owner}/{repo}` → "Repository settings" ghost button. Both land on the identical page; see the note under Edge Cases about this being the *only* per-repo defaults surface, split from the repo dashboard.

### Steps
1. Priya opens `/settings/repositories/acme-corp/checkout-service`. → `RepoSettingsPage` fetches `resolveRepoDefaults` (three-layer merge: system default < user preference < repo override, repo override `null` = inherit) and the raw override row in parallel; renders `RepoSettingsSection`.
2. In "Clone & runtime", she changes "Runtime mode" from the inherited value to "Managed runtime" (`Select`, options exactly "Classic" / "Managed runtime"). → `onValueChange` optimistically updates local state and immediately `PATCH`es `{ runtimeMode: "managed_runtime" }` — no separate save button; a small "Saving…" spinner text appears at the bottom of the page during the request.
3. She changes "vCPUs" from the inherited value to "8 vCPUs" (`Select`, options "1 vCPU"/"2 vCPUs"/"4 vCPUs"/"8 vCPUs" from `ALLOWED_VCPU_VALUES`). → Same autosave-on-change pattern.
4. Both fields now show a small `RotateCcw` "Reset to inherited value" icon button next to them (only appears once a field is overridden — i.e. non-null); the "Inherited" badge that was there before is gone for both.

### Variations
- The "Default branch" text field and the two boolean switches (Full clone, Prewarm sandbox, Always create new branch, Auto-commit and push) all follow the same inherited/override/reset pattern, but text fields save `onBlur` instead of on every keystroke while switches save `onCheckedChange` immediately.
- "Auto-create PR" is cross-field-gated: its `Switch` is `disabled` whenever the *effective* (state-or-resolved) `autoCommitPush` is false, and turning "Auto-commit and push" off while "Auto-create PR" is currently on force-sets `autoCreatePr: false` in the same PATCH (client mirrors a server-side invariant in the PATCH route that rejects any patch resulting in `autoCreatePr: true` while `autoCommitPush` resolves false — a 400 with a spelled-out `error` message if somehow reached).

### Edge Cases
- If the PATCH request fails outright (network, 500), the local optimistic state has already flipped — the UI shows the new value as selected while `error` renders a plain red message below the whole form; there's no per-field rollback of the optimistic UI to the prior value, so the control can visually disagree with what's actually persisted until the next full page load.

---

## STORY-913: Blocking a tool for this repo only, and the Vercel "link" that doesn't actually link anything here

**Type**: medium
**Topic**: Repository Workspace
**Persona**: Marcus, who wants agents working in `checkout-service` specifically to never use the Slack tool (client secrets live in that Slack workspace), while leaving Slack available everywhere else.
**Goal**: Block one Composio toolkit for one repo, and separately understand what the "Vercel" row on this same page is for.
**Preconditions**: Marcus has a connected Slack Composio profile at the account level; `checkout-service` has no existing repo-level Composio override.
**Ideal path**: 2 — same settings page, scroll to "Tool access", toggle Slack off.
**Alternate paths**: The exact same editor (`ComposioWorkspaceSettingsPanel`) is also reachable from an active chat session's workspace settings — this page and the in-session editor are explicitly the same component/implementation (per the code comment: "onSaved triggers a server-component refresh... one implementation of 'edit repo Composio policy,' not two"), so a policy change made from inside a session and one made here converge on the same stored state.

### Steps
1. Marcus is already on `/settings/repositories/acme-corp/checkout-service` (from STORY-912). → Above "Tool access," the read-only "Integrations" group shows three rows: **GitHub** (Connected / Reconnect required / Not connected, based on `hasGitHubAccount` + a live token check), **Vercel** (either the linked project's name + team slug, or a "Link Vercel project" link), and **Composio** (a bare "Manage tools" link to `/settings/composio`), plus — only if any toolkit statuses exist — a read-only chip list under "Tool access for this repository" showing each toolkit's plain-language label (Allowed / Blocked / Selected / Default on / Not connected / Expired — reconnect).
2. In the "Tool access" `SettingsGroup` below (title: "Tool access", description: "Block or select which connected tools agents can use in this repository..."), he finds Slack and toggles it to blocked via `ComposioWorkspaceSettingsPanel`.
3. Save triggers `router.refresh()` (a server-component refresh, not a client-only state update) — the read-only chip list above updates to show Slack as "Blocked" ("Agents working in this repository can't use this tool.") using the exact same status-copy helper (`getRepoToolkitStatusCopy`) the (dead, per STORY-904) repo-dashboard Tools tab would have used, so the vocabulary is consistent even though one of the two intended display surfaces for it never shipped.

### Variations
- If Slack were never connected at the account level at all, its status would instead show "Not connected" with a "Connect" link to `/settings/composio` rather than a block toggle — there's nothing repo-specific to configure until the account-level connection exists.

### Edge Cases
- **The "Link Vercel project" link is a dead end for its stated purpose.** It points to `/settings/connections`, whose Vercel section (`VercelSection`) only displays Marcus's own Vercel account identity (avatar, name, connected badge) — it has no project picker and no way to associate a Vercel project with this repo. The actual place a Vercel project gets linked to a repo is a `SessionStarterVercelSyncSection` embedded in the **New Session** dialog (reachable from the repo dashboard, STORY-904) — a different flow entirely, on a different page, that this settings row's link doesn't mention or point to.

---

## STORY-914: Resetting every override back to defaults, and the split between the two "repo settings" pages

**Type**: short
**Topic**: Repository Workspace
**Persona**: Dana, who experimented with several per-repo overrides on `checkout-service` (STORY-912) and now wants a clean slate before handing the repo to a new team.
**Goal**: Clear every repo-level override in one action, with a safety check against fat-fingering it.
**Preconditions**: `checkout-service` has at least one non-null repository_settings field.
**Ideal path**: 2 — type the confirmation string, click "Reset to defaults."
**Alternate paths**: Individually clicking each field's own `RotateCcw` reset button (STORY-912) reaches the same end state field-by-field, with no typed confirmation required per field — the Danger Zone button is a bulk shortcut for the same underlying null-out, not a different operation.

### Steps
1. In the "Danger zone" group (red-toned `SettingsGroup`, `tone="danger"`), Dana reads: "Reset all overrides" / "Clear every per-repo override so this repo inherits all defaults. Type acme-corp/checkout-service to confirm."
2. She types `acme-corp/checkout-service` into the confirmation `Input` (styled with a destructive border) exactly matching `${owner}/${repo}`. → "Reset to defaults" (destructive-styled button) becomes enabled only once `confirmText === confirmTarget` exactly.
3. She clicks it. → `DELETE /api/settings/repositories/acme-corp/checkout-service`, which upserts every field to `null` in one call (not nine separate PATCHes); on success the whole form re-seeds from the now-all-inherited state, every "Inherited" badge reappears, and the confirmation text field clears itself.

### Variations
- None found — this is a single all-or-nothing action; there's no partial-reset selection UI.

### Edge Cases
- **The split this task asked to record**: `/repos/{owner}/{repo}` (the dashboard, STORY-904) is a live-GitHub-scoped hub gated by `verifyRepoAccess` — it shows session/automation/run entry points and links out to GitHub. `/settings/repositories/{owner}/{repo}` (this page) is a purely local, userId-scoped preferences editor with **no GitHub access check at all** — it can be opened and edited for an `owner/repo` string the user has never had GitHub access to (nothing in `GET`/`PATCH`/`DELETE` calls `verifyRepoAccess`; the DB row is just keyed by `(userId, repoOwner, repoName)`). The only connective tissue between the two pages is the dashboard's one-way "Repository settings" ghost-button link; there is no link back from settings to the dashboard, and no shared layout or breadcrumb ties the two together as "the same repo's workspace."
