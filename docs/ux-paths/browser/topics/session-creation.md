# Topic: Session Creation — Repository, Branch, Runtime Mode & Git Defaults

> Grounded in `components/session-starter.tsx`, `components/session-starter-helpers.ts`,
> `components/repo-selector-compact.tsx`, `components/branch-selector-compact.tsx`,
> `components/create-repository-dialog.tsx`, `components/create-repository-submit.ts`,
> `components/session-starter-vercel-sync-section.tsx`, `components/new-session-dialog.tsx`,
> `components/inbox-sidebar.tsx`, `components/inbox-sidebar-rail-actions.ts`,
> `components/inbox-sidebar-new-chat.ts`, `components/branch-picker-dialog.tsx`,
> `components/repo-picker-scope-empty-state.tsx`,
> `app/repos/[owner]/[repo]/repository-new-session-action.tsx`,
> `app/sessions/sessions-route-shell.tsx`, `app/sessions/layout.tsx`,
> `app/api/sessions/route.ts`, `lib/sessions/create-session.ts`, `lib/db/last-repo.ts`,
> `app/api/github/repos/route.ts`, `app/api/github/create-repo/route.ts`,
> `app/api/github/branches/route.ts`, `hooks/use-repo-defaults.ts`,
> `hooks/use-vercel-repo-projects.ts`, `hooks/use-github-connection-status.ts`.

**Notable structural finding, referenced throughout below**: there are **four
separate entry points** that create a repo-bound session, only one of which
(`SessionStarter`, the full dialog) exposes branch choice, runtime mode, git
defaults, and Vercel sync as controls. The other three (`+` per-repo-group
icon, `GitBranch` "Create from branch" icon, `repository-new-session-action.tsx`
button — the last one still routes through the dialog) apply saved defaults
silently with no per-session override UI. See STORY-213 and STORY-214.

---

## STORY-201: One-click scratch chat before touching any repo

**Type**: short
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Marcus Webb, an indie developer who wants to think through an
approach with the agent before deciding which of his repos it applies to.
**Goal**: Start a chat with zero repo/branch/runtime decisions.
**Preconditions**: Signed in; GitHub may or may not be connected — irrelevant
to this path since no repo is touched.
**Ideal path**: 1 — a single click should be able to reach a live chat with no
intermediate screen, since nothing about a repo-less chat needs configuring.
**Alternate paths**: (a) Open the full `SessionStarter` dialog and leave it on
the default "Standalone session" tab, then click "Start session" — 2+ clicks
for the same outcome (STORY-202). (b) The collapsed-sidebar icon rail has the
identical one-click action under the same tooltip.

### Steps
1. Marcus is on `/sessions` with the left sidebar expanded. He clicks the
   `MessageSquare`-icon button labeled "Quick chat (no repo)" next to the
   "New session" button at the top of the sidebar (`inbox-sidebar.tsx`,
   `handleCreateSandboxFreeChat`) → the button shows a spinner in place of the
   icon while `POST /api/sessions` runs with
   `{ isNewBranch: false, sandboxType: "vercel", autoCommitPush: false, autoCreatePr: false }`
   (`buildSandboxFreeChatInput()` — no repo fields at all, so the server
   creates the session with `sandboxState: null`).
2. On success he is routed straight to `/sessions/{id}/chats/{chatId}` with no
   dialog ever appearing.

### Variations
- Same action from the fully **collapsed** sidebar rail: the icon sits under
  the "Quick chat (no repo)" tooltip in the top icon column
  (`getCollapsedRailActions`) — identical single click, identical payload.

### Edge Cases
- If `handleCreateSandboxFreeChat` throws (e.g. rate limited), the sidebar has
  "no persistent form surface" for this action per the code comment in
  `sessions-route-shell.tsx`, so the failure surfaces as a toast
  (`toCreateSessionErrorInfo`) rather than an inline error — Marcus could miss
  it if he has already looked away.
- Because `runtimeMode` is never sent in this payload, the session silently
  gets whatever `runtimeMode`/`managedRuntimeProfileId` the server's repo-less
  precedence resolves to (system default `classic` in practice, since there
  are no repo defaults for a repo-less session) — Marcus has no way to ask for
  a managed runtime through this button, even though a repo-less session *can*
  run managed (see STORY-209's edge case).

---

## STORY-202: Standalone session via the full New Session dialog

**Type**: short
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Renata Silva, a backend engineer who wants a scratch chat but
also wants to check the runtime-mode picker before committing, since she
suspects she'll need Playwright tools.
**Goal**: Reach a repo-less chat, but via the full dialog so she can see the
runtime options first (unlike STORY-201's blind one-click).
**Preconditions**: Signed in; on `/sessions`.
**Ideal path**: 2 — one click to open the dialog, one to submit; the dialog
opens already on the "Standalone session" tab by design (`mode` defaults to
`"empty"` unless `initialRepository` was passed).
**Alternate paths**: STORY-201's one-click "Quick chat" button reaches the
same server payload (`isNewBranch:false`, no repo fields) without ever
showing the runtime picker — duplicate destination, different amount of
visibility into the choice being made.

### Steps
1. Renata clicks "New session" (`Plus` icon + label, top of the sidebar) →
   `NewSessionDialog` opens; `SessionStarter` renders with the segmented
   control defaulted to "Standalone session" (`MessageSquare` icon) since she
   has no `initialRepository` context.
2. She reads the "How should the agent work?" radiogroup — "Vercel sandbox
   (classic)" is pre-selected; she leaves it (this dialog is not gated by
   `mode`, so it appears even for a repo-less session) and clicks "Start
   session" (`getButtonLabel` returns the generic label since `mode !== "repo"`)
   → `POST /api/sessions` fires with no repo fields, `runtimeMode: "classic"`.

### Variations
- She instead picks "Through a verified environment (managed): web-bun-agent-browser"
  before submitting — a fully repo-less session can still be `managed_runtime`
  (see STORY-209's edge case for why this is surprising).

### Edge Cases
- The footer under the button reads "No sandbox starts immediately. One starts
  automatically when code execution is needed." (`getSessionFooter`) — it does
  **not** mention which runtime mode she picked, even though `mode==="repo"`
  sessions do get `· {runtimeModeLabel}` appended. Renata has no confirmation
  her managed-runtime choice registered.

---

## STORY-203: First-time repo session — the baseline happy path

**Type**: medium
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Priya Raman, a staff engineer at Northstar Labs starting a fresh
bugfix session against `northstar-labs/checkout-service`.
**Goal**: Start a session on a fresh auto-generated branch with default
settings, with minimum friction.
**Preconditions**: Signed in; GitHub connected; GitHub App installed on the
`northstar-labs` org with `repositorySelection: "all"`; no `lastRepo` yet
(first session ever).
**Ideal path**: 4 — open dialog, switch to repo mode, pick repo (branch and
runtime already default correctly), submit. Everything else in this story is
Priya reading confirmatory copy, not making decisions.
**Alternate paths**: `RepositoryNewSessionAction` on the repo dashboard
(STORY-212) reaches the same dialog pre-filled to the repo-select step.

### Steps
1. Priya clicks "New session" → dialog opens on "Standalone session" tab
   (no `lastRepo` to seed `mode: "repo"` yet).
2. She clicks the "Repository session" segmented-control tab (`GitBranch`
   icon) → `RepoSelectorCompact` expands: an org-switcher button (GitHub
   icon + "northstar-labs"), a repo search box, and a scrollable 280px list
   of repos sorted by `updated_at` descending, each row showing name, a
   `LockIcon` if private, and a relative date ("3d ago").
3. She types "checkout" into "Search repositories…" → the list narrows after
   a 200ms debounce (`debouncedRepoSearch`) to `checkout-service`.
4. She clicks "Select" on the `checkout-service` row → `handleRepoSelect`
   collapses the picker to a single compact row (org pill · repo name ·
   "Change" button); `BranchSelectorCompact` mounts below it, briefly reading
   "Loading..." then auto-firing `onChange(null, true)` once `/api/github/branches`
   resolves with no prior value — the trigger now reads "New branch (auto)".
5. She skips the collapsed "Auto commit and push disabled" row and the (not
   yet rendered — see step 6) Vercel section, and types nothing into "Session
   name (optional)".
6. Since Priya's Vercel-linked account triggers `shouldLoadVercelProjects`,
   the compact env-sync row appears reading "Scanning for linked Vercel
   projects…" then resolves to "No matching Vercel project. Env sync is off."
   — she leaves it collapsed.
7. She clicks "Start with northstar-labs/checkout-service" (`getButtonLabel`)
   → button shows a spinner + "Creating session…"; `POST /api/sessions` sends
   `{ repoOwner: "northstar-labs", repoName: "checkout-service", isNewBranch: true, fullClone: false, runtimeMode: "classic", autoCommitPush: false, autoCreatePr: false, vercelProject: null }`.
8. On success she's routed to `/sessions/{id}/chats/{chatId}`; server-side
   `resolveSessionBranches` generated a branch like `pr/4f18a9c2` cut from the
   repo's default branch, and since she left the title blank,
   `resolveSessionTitle` assigned a random unused city name (e.g. "Lisbon")
   instead of a repo-derived name.

### Variations
- If Priya had typed a title ("Fix double-charge on refund"), it is trimmed
  (`prepareSessionTitle`) and sent as `title`, overriding the city-name
  fallback.

### Edge Cases
- If `sortedRepos.length === 25` and she hadn't searched, a footer note reads
  "Showing first 25 results. Use search to narrow." — the list is hard-capped
  at 25 with no pagination, only search.
- What Priya is thinking at step 4: the branch trigger reads "New branch
  (auto)" with no visible name — she has no way to preview the generated
  branch name (`{initials}/{8-hex}`) before submitting; she only sees it once
  inside the session's git panel.

---

## STORY-204: `lastRepo` pre-fills the picker, but doesn't pre-select the tab

**Type**: short
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Priya Raman again, the next day, wanting a second session against
the same repo she used yesterday.
**Goal**: Reuse the repo from her last session with minimal re-selection.
**Preconditions**: Signed in; her most recently *created* session (not most
recently *opened* — `getLastRepoByUserId` orders by `sessions.createdAt desc`
and requires non-null `repoOwner`/`repoName`) was on
`northstar-labs/checkout-service`.
**Ideal path**: 3 — a well-designed default would land her directly in repo
mode with the repo already selected; the actual flow needs one extra tab
click first, so the ideal (3) undercuts the real minimum (4).
**Alternate paths**: none found — `lastRepo` only flows into `SessionStarter`
via `app/sessions/layout.tsx` → `getLastRepoByUserId`; no other surface reads it.

### Steps
1. Priya clicks "New session" → the dialog opens on the "Standalone session"
   tab *even though* `lastRepo` is populated — the comment in
   `session-starter.tsx` explains this is deliberate: "Default to a lightweight
   standalone session... even for returning users who have a lastRepo... so no
   sandbox is provisioned until code execution needs one." `selectedOwner` /
   `selectedRepo` state is already seeded from `lastRepo`, invisibly, while the
   empty tab is showing.
2. She clicks "Repository session" → `RepoSelectorCompact` renders already
   collapsed to the compact selected-repo row (`hasSelection` is true from
   the seeded state) — no list, no search, just
   "northstar-labs · checkout-service · Change".
3. `BranchSelectorCompact` mounts and, since `isNewBranch` was seeded `true`
   (`Boolean(repositorySeed)`), immediately shows "New branch (auto)" with no
   network round-trip needed to decide that.
4. She clicks "Start with northstar-labs/checkout-service" to submit
   unchanged.

### Variations
- If she wants a *different* repo, she clicks "Change" on the compact row,
  which calls `handleDeselect` → `onSelect(selectedOwner, "")`, re-expanding
  the full picker with the org still set to `northstar-labs`.

### Edge Cases
- What Priya would notice, if she's paying attention: the tab defaulting to
  "Standalone session" despite `lastRepo` existing means a returning,
  repo-focused user's very first glance at the dialog shows the *wrong* mode.
  It's a one-click fix, but it reads as the app "forgetting" her habit.

---

## STORY-205: Picking an existing branch instead of the auto-generated one

**Type**: medium
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Théo Lefebvre, a backend engineer who needs to continue a
teammate's already-pushed feature branch, not start a new one.
**Goal**: Start a session directly on `feature/retry-webhook-delivery`
instead of an auto-generated branch cut from `main`.
**Preconditions**: Signed in; repo `northstar-labs/checkout-service` selected;
that branch already exists on GitHub.
**Ideal path**: 3 — repo already chosen (assume via `lastRepo`), open the
branch popover, select the branch, submit.
**Alternate paths**: The sidebar's per-repo "Create from branch" quick action
(`GitBranch` icon → `BranchPickerDialog`, STORY-214) reaches the identical
server-side outcome (an existing-branch session) with a *smaller*, purpose-built
picker and zero other controls — a real duplicate of this sub-flow.

### Steps
1. With `northstar-labs/checkout-service` already selected, Théo clicks the
   `BranchSelectorCompact` trigger (shows "New branch (auto)" by default) →
   a popover opens with a `CommandInput` ("Search branches..."), a list of up
   to 50 branches (`limit=50` on `/api/github/branches`), and a separated
   "Safe — creates a workspace branch" group containing only the "New branch
   (auto-generated)" item.
2. He types "retry" → the list narrows client-side via the combobox filter.
3. He clicks `feature/retry-webhook-delivery` → `handleSelectBranch` calls
   `onChange(branch, false)`, closing the popover; the trigger now reads the
   branch name directly, and a `CheckIcon` marks it selected in the list.
4. He submits → payload includes `branch: "feature/retry-webhook-delivery"`,
   `isNewBranch: false`; server sets `baseBranch: null` (existing-branch
   sessions don't record a base — only new-branch sessions do, per
   `resolveSessionBranches`).

### Variations
- If the repo's default branch is `main` and it appears in the same list, it
  carries a "repository default" tag on the right — Théo could have picked it
  instead for a from-scratch session on `main` directly (not recommended, but
  not blocked).

### Edge Cases
- If `/api/github/branches` fails on first load: `CommandEmpty` reads "Couldn't
  load branches for this repository." and a `Retry` link calls `mutate()`; the
  trigger itself falls back to reading "Branches unavailable" rather than
  silently showing "main" as if it were a real fetched default.
- If it fails on a *refresh* (stale data present): a banner above the list
  reads "Couldn't refresh branches. Showing last loaded." with its own Retry —
  distinct copy from the no-data case, so Théo knows the list he's looking at
  might be outdated but isn't fabricated.

---

## STORY-206: Creating a brand-new GitHub repo inline, then starting on it

**Type**: medium
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Sienna Park, an indie developer starting a project that doesn't
have a GitHub repo yet and doesn't want to leave Open Agents to make one.
**Goal**: Create `sienna-park/lantern-notes` from inside the picker, then
start a session on it in one continuous flow.
**Preconditions**: Signed in; GitHub connected; at least one installation
exists so the picker is in its normal (not zero-installation) state.
**Ideal path**: 6 — open dialog → repo tab → "New repository" → fill name →
create → submit. Matches the actual flow closely; little to trim.
**Alternate paths**: none found for *inline* repo creation — this is the only
UI path. (The mid-session "Create Repo" button in the git panel looks like an
alternate path but is dead — see the Edge Cases below.)

### Steps
1. Sienna opens "New session", switches to "Repository session".
2. In the picker footer she clicks "New repository" (`Plus` icon, disabled
   only if no `currentOwner` is resolved yet) → `CreateRepositoryDialog` opens
   showing "Create repository" / "Create a new empty GitHub repository under
   sienna-park, then start a session on it."
3. She types `lantern-notes` into "Repository name" — a live preview line
   above the input updates to "sienna-park/lantern-notes" as she types.
4. She leaves "Private repository" on (default `isPrivate: true`) and adds a
   one-line description.
5. She clicks "Create repository" (disabled until `REPO_NAME_PATTERN` passes
   and the field is non-empty) → `submitCreateRepository` POSTs to
   `/api/github/repos` (not the differently-named-but-similar
   `/api/github/create-repo` — see Edge Cases) → success view appears: a green
   check, "Repository created successfully!", "sienna-park/lantern-notes", and
   a "View on GitHub" external link.
6. She clicks "Close" → `handleRepoCreated` fires `onSelect("sienna-park",
   "lantern-notes")` and `refreshRepos()`; the picker collapses straight to
   the compact selected-repo row for her brand-new repo — she never has to
   find it in the list.
7. `BranchSelectorCompact` mounts on the fresh repo (only its default branch
   exists) and settles on "New branch (auto)".
8. She submits → "Start with sienna-park/lantern-notes".

### Variations
- If the current org is actually an organization whose GitHub App install has
  `repositorySelection: "selected"`, the success view adds an amber warning:
  "The GitHub App only has access to selected repositories, so it cannot see
  this repo yet. Grant access before starting the session." with a "Manage
  access" link to `installationUrl`. Nothing in the picker actually *blocks*
  Sienna from proceeding to select and submit anyway — the warning is
  advisory only, so submitting could still fail downstream at clone time if
  she skips granting access.

### Edge Cases
- Repo-name validation: `my repo!` is rejected client-side before any request
  ("Use letters, numbers, hyphens, underscores, and periods only.");
  `REPO_NAME_PATTERN` also caps at 100 characters.
- **Dead alternate surface, worth flagging as a duplicate/misleading path**:
  inside an *already-created standalone session*, the Git panel offers its
  own "Create Repo" button (`git-panel.tsx`, gated on `!hasRepo &&
  supportsRepoCreation`) — but it is rendered with a hardcoded `disabled`
  prop and a tooltip reading "Creating repositories from Open Agents is
  temporarily disabled. Create the repository on GitHub first, then connect
  it to a session." Its own target endpoint, `POST /api/github/create-repo`,
  unconditionally returns `501 not_implemented` with that same message. This
  is a second, fully-wired "create repo" code path (`components/create-repo-dialog.tsx`)
  that is permanently switched off, sitting alongside the one in this story
  that works. A user who starts standalone (STORY-201/202) and later wants to
  attach a fresh repo will hit this dead end, not the working flow.

---

## STORY-207: Switching GitHub org and hitting the scoped-empty state

**Type**: medium
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Yuki Tanaka, an engineer whose personal GitHub account has full
repo access but whose employer's org install is locked down to a handful of
approved repos.
**Goal**: Start a session against an org repo, but first has to figure out why
the org shows no repos at all.
**Preconditions**: Signed in; two installations exist — personal account
(`repositorySelection: "all"`) and `beacon-analytics` org
(`repositorySelection: "selected"`, but the admin hasn't yet approved any repos
for this GitHub App).
**Ideal path**: 5 — switch org, see the scoped message immediately, click
"Manage access", grant access on GitHub, return and the list populates.
**Alternate paths**: none found — the org switcher only lives inside
`RepoSelectorCompact`.

### Steps
1. Yuki opens the dialog, switches to "Repository session" — the org dropdown
   auto-selected her personal account first (`hasAutoSelectedRef`, picks
   `installations[0]`).
2. She clicks the org-switcher button (GitHub icon + her username) → a
   popover lists both installations by `accountLogin`, each with a `CheckIcon`
   marking the current one, plus a footer action "Add GitHub account" (routes
   to `/api/github/app/install`).
3. She selects `beacon-analytics` → `setCurrentOwner` fires; the repo list
   area re-fetches for the new installation's id.
4. Because `isScopedEmpty(currentInstallation.repositorySelection, sortedRepos.length)`
   is true (scope is `"selected"` and zero repos came back), the list area
   shows "This installation only covers selected repositories." instead of
   the generic "No repositories found." — with a "Manage access" link
   (`ExternalLink` icon) to `currentInstallation.installationUrl`, opened in a
   new tab.
5. She clicks "Manage access", grants the App access to
   `beacon-analytics/ingest-pipeline` on GitHub, returns to the tab, and
   clicks "Refresh" (bottom-right, `RefreshCw` icon) → the repo now appears
   and she selects it.

### Variations
- If she instead *searches* for a repo name that simply doesn't match any of
  her selected repos (scope not empty overall, but the filtered result is),
  `isScopedEmpty` is false (repo count for the *unfiltered* installation check
  isn't what's tested — the check uses `sortedRepos.length`, i.e. the current
  filtered result) so this is still reachable via search too, same copy.

### Edge Cases
- If `currentInstallation.installationUrl` is `null` (installation exists but
  URL wasn't captured), the "Manage access" link is simply omitted — Yuki sees
  only the explanatory sentence with no way forward from this screen, and
  would need to find the App's settings independently on GitHub.

---

## STORY-208: Reconnect required mid-picker

**Type**: short
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Priya Raman, whose GitHub OAuth token has gone stale since her
last visit.
**Goal**: Get back to a working repo picker.
**Preconditions**: Signed in; `hasGitHub` true but `useGitHubConnectionStatus`
reports `reconnect_required`.
**Ideal path**: 2 — click "Reconnect GitHub", complete GitHub's re-auth
redirect, land back with the picker working.
**Alternate paths**: none found in this component; the same reconnect state
also surfaces elsewhere in the app (Settings → Connections), so this is one
of at least two places a stale connection is caught — not a duplicate flow,
but duplicated *detection*.

### Steps
1. Priya opens "New session" → "Repository session" → instead of the normal
   picker, `RepoSelectorCompact` renders `GitHubActionCard` with title
   "Reconnect GitHub" and description "Your saved GitHub connection is no
   longer valid. Reconnect to refresh repository access." and a single button
   "Reconnect GitHub".
2. She clicks it → `buildGitHubReconnectUrl(currentPath)` redirects her
   through GitHub's OAuth re-auth; on return she's back on `/sessions` with
   the dialog closed (full page redirect), and re-opening "New session" now
   shows the normal picker.

### Edge Cases
- While `reconnectRequired` is true, both the branch selector and the Vercel
  sync section are unmounted entirely (`!reconnectRequired` guards both in
  `session-starter.tsx`) — so this isn't just a picker-level message, it
  suppresses the rest of the repo-mode form too.
- `isSubmitBlocked` also hard-blocks submission whenever `mode === "repo" &&
  reconnectRequired`, even if `selectedOwner`/`selectedRepo` happen to still
  be populated from `lastRepo` — Priya cannot bypass this by leaving the repo
  fields alone and just clicking submit.

---

## STORY-209: Runtime mode — switching to managed and repo-default precedence

**Type**: medium
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Alex Kim, a dev lead whose team's `northstar-labs/checkout-service`
repo has a saved repo-default of `managed_runtime` with the
`web-bun-agent-browser` profile (because the suite needs Playwright installed
consistently), configured earlier at `/settings/repositories/northstar-labs/checkout-service`.
**Goal**: Confirm a new session against that repo defaults to the managed
profile without having to remember to pick it every time.
**Preconditions**: Signed in; repo defaults saved as above; Alex's personal
Preferences default is plain `classic`.
**Ideal path**: 3 — pick repo, see the managed option already highlighted,
submit.
**Alternate paths**: none found for reaching *this precedence outcome*
specifically, but the runtime radiogroup itself is reachable identically from
both standalone and repo mode (STORY-202).

### Steps
1. Alex selects `northstar-labs/checkout-service` in the picker.
2. While `repoDefaults` is still loading, `effectiveRuntimeSelection` shows
   the not-yet-resolved fallback ("classic", highlighted) — a brief flash.
3. Once `/api/settings/repositories/northstar-labs/checkout-service` resolves,
   `getEffectiveRuntimeSelection` re-evaluates: no explicit
   `userRuntimeSelection` yet, so it falls through to
   `repoDefaults.runtimeMode ?? "classic"` → `"managed_runtime"` — the second
   radio button, "Through a verified environment (managed):
   web-bun-agent-browser", becomes highlighted instead, with no action from
   Alex.
4. He submits without touching the radiogroup. Per the `getRuntimeSelectionForSubmit`
   guard (Codex #834 P2 fix), because he made no explicit choice, the payload
   *omits* `runtimeMode`/`managedRuntimeProfileId` entirely once
   `repoDefaultsResolved` is true and lets the server's own repo-defaults
   precedence (`body > repo defaults > "classic"`) apply — the explicit intent
   here is to never let a stale client-side "classic" flash accidentally
   overwrite a saved managed-runtime repo default.

### Variations
- If Alex explicitly clicks the "classic" radio (overriding the repo default
  on purpose for this one session), `userRuntimeSelection` is set and the
  payload now *does* send `runtimeMode: "classic"` explicitly — his one-off
  choice always wins over the repo default (Decision D1).

### Edge Cases
- **Surprising cross-mode reach**: the runtime radiogroup is not scoped to
  `mode === "repo"` in the JSX — a fully standalone session (STORY-202) can
  also be started as `managed_runtime`, which is a genuinely unusual
  combination (a "verified environment" profile with no repository attached)
  that the UI never calls out as unusual.
- If the repo-defaults fetch errors instead of loading, `repoDefaultsResolved`
  is computed as `!repoDefaultsEnabled || !!repoDefaults` — an error leaves
  `repoDefaults` `undefined` forever, so `repoDefaultsResolved` stays `false`
  and the submit payload keeps omitting the runtime fields indefinitely,
  silently deferring to the server's own fallback rather than surfacing the
  fetch failure to Alex anywhere in the UI.

---

## STORY-210: Git defaults — auto commit/push, auto-PR, and full clone

**Type**: medium
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Renata Silva, planning a long unattended agent run and wanting
every turn committed and pushed automatically, with a PR opened once there's
something to review, on a full (non-shallow) clone because the agent will
need `git blame`/history.
**Goal**: Turn on all three git defaults for this one session.
**Preconditions**: Signed in; repo mode; repo selected; her Preferences
defaults have `autoCommitPush: false`, `autoCreatePr: false` (both off).
**Ideal path**: 5 — expand the section, flip two switches (PR switch is
gated on commit switch being on), flip full clone, submit.
**Alternate paths**: none found — these three toggles exist only in this
dialog; per-repo defaults for the first two can be pre-set in Settings →
Repository settings, but there is no separate settings-page equivalent for
`fullClone` (see Edge Cases).

### Steps
1. With a repo selected, Renata sees the collapsed summary row: `GitCommitHorizontal`
   icon, "Auto commit and push disabled", `ChevronDownIcon`.
2. She clicks it → it expands into a bordered card. The header row itself is
   now a button too (clicking it re-collapses), showing "Auto commit and
   push" / "Automatically commit and push after each agent turn." with a
   `ChevronUpIcon`.
3. Below it, a "Commit and push" row with a `Switch` — she turns it on
   (`effectiveAutoCommitPush` becomes `true`).
4. Turning it on reveals a new indented row, "Create pull request", with its
   own `Switch` (only rendered `{effectiveAutoCommitPush && (...)}` — it
   cannot be set independently) — she turns that on too.
5. A separate bordered sub-section below reads "Full clone" / "Include full
   git history (slower start). Off uses a fast shallow clone." — she turns
   that `Switch` on as well (local `fullClone` state, no repo-default or
   Preferences fallback backing it).
6. She submits — payload: `autoCommitPush: true, autoCreatePr: true, fullClone: true`.

### Variations
- If she'd left "Commit and push" off, the "Create pull request" row simply
  never renders — there's no way to request auto-PR without auto-commit,
  which matches the server precedence: `autoCreatePr` is force-set to `false`
  server-side whenever `effectiveAutoCommitPush` is false, regardless of what
  was sent (`autoCreatePr: effectiveAutoCommitPush ? effectiveAutoCreatePr : false`).

### Edge Cases
- The collapsed summary row is dense but informative: "Auto commit on · Auto
  PR on" when both are on, vs. just "Auto commit on" when only the first is,
  vs. "Auto commit and push disabled" when neither is — a returning user can
  audit the current session's git posture without expanding anything.
- `fullClone` has **no persistence path** at all — not a Preferences field,
  not a repo default, always resets to the shallow-clone default `false` on
  the next session even against the same repo, unlike the other two switches
  which both have a `repoDefaults?.X ?? preferences.X` fallback chain. A user
  who always wants full clone for one particular repo has to remember to
  re-toggle it every single time.

---

## STORY-211: Vercel environment sync — the full branch survey

**Type**: long
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Owen Baptiste, a frontend engineer whose team links most repos to
Vercel projects and relies on env-sync to avoid hand-copying `.env.local`
values into every new sandbox.
**Goal**: Walk every state the "Environment sync" section can be in across
four different repos, to understand what a new teammate would see in each
case before writing onboarding notes.
**Preconditions**: Signed in with `session.authProvider === "vercel"`
(required for `shouldLoadVercelProjects`); has access to four repos in
different Vercel-linking states.
**Ideal path**: for any *single* one of these outcomes, 3 steps (pick repo,
read/act on the section, submit) — this story deliberately chains all of them
to survey the surface, so its own real step count is much higher than any one
user's actual path would be.
**Alternate paths**: the "Repo settings" and "Connect Vercel" deep-links inside
this section (`/settings/repositories/{owner}/{repo}` and
`/settings/connections`) are alternate ways to fix an unresolved state, but
they leave the dialog entirely rather than resolving inline.

### Steps
1. Owen opens "New session" → "Repository session" and selects
   `northstar-labs/dashboard-web`, a repo with exactly one matching Vercel
   project and a previously-saved default link.
2. `shouldLoadVercelProjects` becomes true (owner+repo set, GitHub connection
   resolved, `authProvider === "vercel"`); `isVercelLookupPending` is briefly
   true, so submit is blocked and the compact row reads "Scanning for linked
   Vercel projects…" with a spinner.
3. The fetch resolves with `repoProjects.selectedProjectId` set →
   `vercelProjectChoice` is auto-set to that id; the compact row collapses to
   a green `CheckCircle2Icon` and "Syncing env from **northstar-labs /
   dashboard-web**" (using `formatVercelProjectLabel`, team-slug-prefixed).
4. Owen expands it anyway (clicking the row) to confirm — the expanded card
   shows the same project pre-selected in a `Select` dropdown, with a
   "Don't sync env variables" option below a separator. He collapses it again
   without changing anything and submits — `vercelProject` sent as the full
   matched project object.
5. He clears the repo (`handleDeselect`) and selects
   `northstar-labs/marketing-site`, which has **two** Vercel projects linked
   to it and no previously saved default.
6. The load effect finds `repoProjects.selectedProjectId === null` and
   `projects.length > 0`, so it sets `vercelProjectChoice` to `null` ("don't
   sync") as the safe default — *not* leaving it `undefined`. Because of this,
   `requiresVercelChoice` (`vercelProjectChoice === undefined`) never actually
   becomes visibly true in practice: the effect resolves the ambiguity before
   Owen's next render paints anything with the amber "Select a project to
   sync, or opt out for this session." copy. (Grounded in the effect's read
   order in `session-starter.tsx`/`session-starter-vercel-sync-section.tsx`;
   worth confirming in a live browser pass since a one-tick race is easy to
   misjudge from source alone.) The compact row instead reads "No matching
   Vercel project. Env sync is off." if `projects.length === 0`, or (in this
   two-project case) shows nothing pre-selected but does *not* block submit.
7. Owen expands the card manually and picks the correct one of the two from
   the `Select`, then submits.
8. He selects a third repo, `northstar-labs/legacy-api`, which has zero
   linked Vercel projects. The compact row reads "No matching Vercel project.
   Env sync is off." with an `XCircleIcon`; expanding it shows the fuller
   explanation ("No Vercel project connected to this GitHub repo was found.
   Environment sync is optional...") plus "Connect Vercel" and "Repo
   settings" links. He submits anyway with sync simply off — never blocked.
9. He selects a fourth repo and the Vercel API call errors (e.g. token
   revoked). The compact row shows an `AlertCircleIcon` and "Env sync needs a
   Vercel project check" with an inline "Retry" button sitting *outside* the
   expand button (not nested inside it, per the component's own HTML-validity
   comment). Expanding shows the fuller error copy, the raw
   `repoProjectsError` string, and "Connect Vercel" / "Repo settings" links.
10. He clicks "Retry" → `refreshVercelProjects()` re-fires the SWR fetch.
11. Submit is still not blocked by any of this (`isSubmitBlocked` explicitly
    excludes `requiresVercelChoice`, and an error simply routes to
    `vercelProject: undefined` in the payload, letting the server fall back to
    `getVercelProjectLinkByRepo`) — Owen confirms he could have submitted at
    any point in the walk without ever resolving the Vercel section.

### Variations
- None of these states ever hard-block the primary submit button — the whole
  section is explicitly optional-by-design per the `isSubmitBlocked` code
  comment referencing issue #219.

### Edge Cases
- If `vercelProject` is sent explicitly but the user's Vercel token has gone
  stale, `/api/sessions` returns a distinct 403 with
  `errorKind: "forbidden"`, `kind: "vercel_reauth_required"`, and
  `actionUrl: "/settings"` — surfaced in the dialog as an inline error with a
  "Go to Settings" link, one of only two error kinds the dialog maps a
  specific action link for (`ACTION_BY_KIND` in `create-session-error.ts`).
- If the explicitly-chosen `vercelProjectChoice` no longer matches any project
  the server can find for that repo (e.g. unlinked between selection and
  submit), `/api/sessions` returns 400 "Selected Vercel project no longer
  matches this repository" — a race the dialog has no special copy for beyond
  the generic error surface.

---

## STORY-212: Starting a session from the repository dashboard

**Type**: short
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Grace Liu, a product manager reviewing `northstar-labs/checkout-service`
on its repo dashboard who decides mid-review to kick off an agent session
right there instead of navigating back to Sessions first.
**Goal**: Start a session on this exact repo without re-finding it in a picker.
**Preconditions**: Signed in; on `/repos/northstar-labs/checkout-service`.
**Ideal path**: 3 — click the dashboard's "New Session" tile, confirm the
repo is right, submit (branch/runtime already sensible defaults).
**Alternate paths**: opening "New session" from the sidebar and manually
re-selecting the same repo (STORY-203/204) reaches the identical dialog state
with more clicks.

### Steps
1. Grace clicks the large "New Session" button/tile on the repo dashboard
   (`RepositoryNewSessionAction`, full-width, `Plus` icon) →
   `openNewSessionDialog({ owner: "northstar-labs", repo: "checkout-service" })`
   is called via `useSessionsShell()`.
2. `NewSessionDialog` opens with `initialRepository` set — inside
   `SessionStarter`, `repositorySeed` resolves to `initialRepository` (which
   takes precedence over any `lastRepo`), so `mode` initializes directly to
   `"repo"` and the compact selected-repo row is already showing — she skips
   the "Standalone session" default entirely, unlike STORY-204's returning-user
   path which still opens on "Standalone session" first.
3. She clicks "Start with northstar-labs/checkout-service" straight away.

### Edge Cases
- The dialog is keyed by `newSessionRepository ? "{owner}/{repo}" : "generic"`
  in `sessions-route-shell.tsx` — remounting `SessionStarter` fresh each time
  a *different* repo dashboard triggers it, so no stale state from a
  previous dashboard's repo can leak in.

---

## STORY-213: Sidebar's one-click "Create session" per-repo action

**Type**: medium
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Felix Nakamura, mid-flow on `beacon-analytics/ingest-pipeline`,
who wants a second parallel session on a fresh branch of the same repo without
re-opening the full dialog.
**Goal**: Get a new branch-scoped session on a known repo as fast as possible.
**Preconditions**: Signed in; sidebar already has a group for
`beacon-analytics/ingest-pipeline` (at least one prior session there);
sidebar in expanded (not collapsed-rail) mode.
**Ideal path**: 1 — this is the fastest path in the whole topic by design.
**Alternate paths**: the full `SessionStarter` dialog reaches the same
`{repo, isNewBranch: true}` outcome with full visibility into branch/runtime/
git-defaults (STORY-203) — this action is a strict subset with zero of that
visibility.

### Steps
1. In the expanded sidebar, Felix hovers the `beacon-analytics/ingest-pipeline`
   group header, revealing a row of icon actions
   (`getCollapsedRepoRailActions`-equivalent rendering in expanded mode):
   `LayoutDashboard` (repo dashboard link), `GitBranch` ("Create from
   branch"), `Settings` (workspace settings), and `Plus` ("Create session").
   He clicks `Plus` → `handleCreateForRepo("beacon-analytics",
   "ingest-pipeline")` → `onCreateSessionForRepo` →
   `handleCreateSessionForRepo` in `sessions-route-shell.tsx` calls
   `createSession` directly with `{ repoOwner, repoName, cloneUrl, isNewBranch: true, sandboxType: preferences.defaultSandboxType, autoCommitPush: preferences.autoCommitPush, autoCreatePr: preferences.autoCreatePr }` —
   no dialog ever opens.
2. On success, `router.push` navigates straight to the new session's chat.

### Variations
- On failure, this path *does* toast (unlike the dialog's inline error) —
  "the sidebar shell has no persistent form surface for this action" per the
  code comment, mirroring STORY-201's failure handling for the same reason.

### Edge Cases
- **No runtime-mode control at all**: this payload never sets `runtimeMode`,
  so it always falls to the server's `body > repo defaults > "classic"`
  chain — if this repo doesn't have a saved managed-runtime repo default,
  Felix gets `classic` with no way to ask for managed from this button, even
  if he habitually chooses managed in the full dialog.
- **No branch preview**: identical to STORY-203's edge case — Felix never
  sees the generated branch name before the session exists.
- **Silently reuses Preferences, not repo defaults**: this handler reads
  `preferences?.autoCommitPush` / `preferences?.autoCreatePr` directly — it
  does *not* consult the repo's own saved defaults the way
  `createSessionCore`'s server-side precedence would for the full dialog's
  path (server-side precedence is `body > repoDefaults > preferences`, but
  this client call sends the Preferences values explicitly in the body,
  which — per that same precedence — means a repo-specific
  `autoCommitPush`/`autoCreatePr` override configured in Settings →
  Repository settings is skipped entirely for this quick-create path,
  because `body` already won).

---

## STORY-214: Sidebar's "Create from branch" quick action

**Type**: short
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Isla Brennan, who needs a session on a specific existing branch
her teammate just pushed, `release/2026.08`, without configuring anything else.
**Goal**: Jump onto that exact branch as fast as possible.
**Preconditions**: Signed in; sidebar group for the target repo already
exists; `release/2026.08` exists on GitHub.
**Ideal path**: 3 — click the group's branch icon, pick the branch, done.
**Alternate paths**: STORY-205 (full dialog's branch popover) reaches the
same "existing branch, `isNewBranch:false`" server outcome with visibility
into runtime mode and git defaults that this path skips.

### Steps
1. Isla clicks the `GitBranch` icon in the repo group's action row
   (`handleOpenBranchPicker`) → `BranchPickerDialog` opens: "Select branch for
   {owner}/{repo}", a `CommandInput` ("Search branches…"), and a plain list of
   branches from `/api/github/branches` (no "new branch" option in this
   dialog at all — unlike `BranchSelectorCompact`, this one is existing-branch
   only).
2. She types "release" and clicks `release/2026.08` (marked "default" only if
   it happens to be the repo's default branch, which it isn't here) →
   `handleSelect` sets local `selectedBranch` and immediately calls
   `onSelectBranch(branch)`.
3. The dialog's body swaps to a loading state — "Creating session on
   release/2026.08…" with a spinner — while `handleBranchSelected` awaits
   `onCreateSessionFromBranch`, which calls `createSession` with
   `{ repoOwner, repoName, branch, isNewBranch: false, sandboxType: preferences.defaultSandboxType, autoCommitPush: preferences.autoCommitPush, autoCreatePr: preferences.autoCreatePr }`.
   On success the dialog closes and she's routed into the new session.

### Edge Cases
- While `isCreating` is true, the dialog's `onOpenChange` refuses to close it
  (`if (!isCreating) { onOpenChange... }`) — Isla cannot dismiss it mid-creation
  even by clicking outside or pressing Escape.
- If the branch fetch errors with no cached data, the whole `Command` list is
  replaced by "Couldn't load branches for this repository." plus a Retry —
  there is no way to type a branch name that isn't in the fetched list (no
  free-text fallback), so an extremely new branch not yet reflected by
  GitHub's API would be unreachable from this dialog until a retry succeeds.

---

## STORY-215: End-to-end — new repo, managed runtime, full git defaults, Vercel sync, custom title, survives a rate limit

**Type**: long
**Topic**: Session Creation: Repository, Branch, Runtime Mode & Git Defaults
**Persona**: Priya Raman, kicking off Northstar Labs' newest service,
`northstar-labs/webhook-relay`, and wanting the session fully configured in one
pass: managed runtime (the team's Playwright profile), auto-commit/push,
auto-PR, full clone, Vercel env sync, and a real title — exercising nearly
every control this topic covers in one continuous journey, including a submit
that gets rate-limited and has to be retried.
**Goal**: Reach a fully-configured session on a brand-new repo in a single
sitting.
**Preconditions**: Signed in; GitHub connected with `northstar-labs` org
installed (`repositorySelection: "all"`); Vercel connected
(`authProvider === "vercel"`); a `web-bun-agent-browser` managed-runtime
profile exists; she has created 10 sessions in the last 60 seconds already
today (close to the `sessions-create` rate limit of 10/60s on `/api/sessions`).
**Ideal path**: 12 — open dialog, repo tab, create repo (4 sub-steps), branch
stays auto, runtime pick, git-defaults expand + 3 toggles, Vercel section
resolves on its own, title, submit, retry once. The real walk below runs
longer because it narrates each read/decision explicitly.
**Alternate paths**: every individual piece of this journey has its own
narrower alternate path documented in STORY-206 (repo creation),
STORY-209 (runtime precedence), STORY-210 (git defaults), and STORY-211
(Vercel sync) — this story is the only one that chains all of them serially
against one repo.

### Steps
1. Priya clicks "New session" → dialog opens on "Standalone session" (no
   `lastRepo`-driven repo mode this time — she has no prior session on this
   brand-new repo).
2. She clicks "Repository session" → the picker expands with her org
   pre-selected (`hasAutoSelectedRef`).
3. She clicks "New repository" in the footer → `CreateRepositoryDialog` opens.
4. She types `webhook-relay`; the live preview reads
   "northstar-labs/webhook-relay".
5. She adds a description, "Inbound webhook fan-out and retry service", and
   leaves "Private repository" on.
6. She clicks "Create repository" → success view: green check, "Repository
   created successfully!", "northstar-labs/webhook-relay", "View on GitHub"
   (no scoped-access warning, since this org install covers "all" repos).
7. She clicks "Close" → picker collapses to the compact row for the new repo;
   `BranchSelectorCompact` mounts and settles on "New branch (auto)" (the
   fresh repo has only its default branch, so there's nothing else to pick).
8. In the "How should the agent work?" radiogroup, she clicks "Through a
   verified environment (managed): web-bun-agent-browser" explicitly (no
   repo defaults exist yet for a repo she just created, so without this
   click it would default to plain "classic") → `userRuntimeSelection` is set,
   which will make the payload send `runtimeMode`/`managedRuntimeProfileId`
   explicitly regardless of repo-defaults resolution.
9. She clicks the collapsed "Auto commit and push disabled" row to expand it,
   turns on "Commit and push", then the newly-revealed "Create pull request",
   then scrolls to "Full clone" and turns that on too.
10. Because `authProvider === "vercel"`, the env-sync row appears: "Scanning
    for linked Vercel projects…" then resolves to "No matching Vercel
    project. Env sync is off." (the repo is brand new, nothing's linked yet)
    — she leaves it as-is; this does not block submit.
11. She types "Webhook relay bring-up" into "Session name (optional)".
12. She clicks "Start with northstar-labs/webhook-relay" → button shows
    "Creating session…" with a spinner.
13. `POST /api/sessions` returns `429` — the account-level rate limit
    (`sessions-create`, 10/60s per user) has just been hit from her earlier
    burst of session creation today. `checkRateLimit` returns the limited
    response before any of the request body is even parsed.
14. `toCreateSessionErrorInfo` maps this to `kind: "rate_limited"`; the dialog
    renders the inline `role="alert"` error banner below the form with the
    server's message — `ACTION_BY_KIND` has no entry for `rate_limited`, so
    no action link accompanies it, just the message.
15. `isCreating` resets to `false`; the button re-enables reading "Start with
    northstar-labs/webhook-relay" again — nothing she configured (repo,
    runtime choice, all three git-default toggles, title) was reset by the
    failed submit, since it's all still local component state.
16. She waits roughly a minute for the window to clear, then clicks "Start
    with northstar-labs/webhook-relay" again — this time `POST /api/sessions`
    succeeds; payload includes the explicit `runtimeMode: "managed_runtime"`,
    `managedRuntimeProfileId: "web-bun-agent-browser"`,
    `autoCommitPush: true`, `autoCreatePr: true`, `fullClone: true`,
    `vercelProject: null`, `title: "Webhook relay bring-up"`.
17. She's routed to `/sessions/{id}/chats/{chatId}` — the session's title
    shows exactly what she typed, not a random city name, since
    `resolveSessionTitle` used her explicit non-empty title.

### Variations
- If she had left the runtime radiogroup untouched at step 8, since this is
  a brand-new repo with no saved repo defaults yet, `repoDefaultsResolved`
  would still resolve `true` once the (empty) repo-defaults fetch completes,
  and the payload would explicitly send `runtimeMode: "classic"` anyway (the
  fallback default) — so touching it was necessary to actually get managed
  runtime here, unlike STORY-209 where an existing repo already had a saved
  managed default.

### Edge Cases
- Step 13's rate limit is scoped to session *creation* generally
  (`sessions-create`), not to this repo or this dialog specifically — any of
  her other session-creation activity today (including the sidebar's
  one-click actions from STORY-213/214, or STORY-201's quick chat) count
  against the same budget, so a heavy morning of quick chats could cause this
  exact 429 on what looks like an unrelated, carefully-configured attempt.
- `checkRateLimit` runs *before* JSON body validation in `/api/sessions`'s
  `POST` handler — so a 429 here reveals nothing about whether her payload
  was even well-formed; a genuinely malformed request and a rate-limited
  well-formed one look identical to her at this step (both are simply
  "couldn't create the session").
