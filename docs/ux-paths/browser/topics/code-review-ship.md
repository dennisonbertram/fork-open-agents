# Topic: Code Review & Ship — Diff, Files, Commit, PR, Checks, Merge, Preview

Generated from `apps/web/app/sessions/[sessionId]/chats/[chatId]/git-panel.tsx`,
`git-panel-context.tsx`, `diff-tab-view.tsx`, `download-diff-dialog.tsx`,
`session-header-pr-actions.tsx`, `components/merge-check-runs.tsx`,
`components/merge-pr-dialog.tsx`, `components/close-pr-dialog.tsx`,
`app/api/sessions/[sessionId]/git/*`, `app/api/generate-pr/*`,
`lib/github/actions/pr.ts`, `lib/github/queries/pr.ts`, and
`lib/merge-readiness-polling.ts`.

## Surface map (read this before the stories)

- **Right git panel** (`GitPanel`) — opened/closed with `Cmd/Ctrl+Shift+B` or the
  panel toggle button; has three tabs: **Files**, **Changes** (badge = file
  count), **PR** (hidden with a disabled ghost tab + tooltip until a PR can be
  opened). Rendered top bar shows either the open PR chip (`#123`), a
  **Create PR** chip, or nothing; a **Preview** chip appears once a deployment
  resolves.
- **Main content area** swaps between chat, `DiffTabView` (all files inline,
  reached by clicking **Changes** or a file row), and `FileTabView` (reached by
  clicking a file in the **Files** tab) — driven by `activeView` in
  `GitPanelContext`.
- **Two legacy modal components exist in the code but are currently
  unreachable from any button**: `MergePrDialog` and the dialog-flavored
  `DiffViewer` (opened only via `MergePrDialog`'s "View Diff" action, which is
  itself never opened). Their state setters (`setMergeDialogOpen`,
  `setShowDiffPanel`) are only ever set to `false`/never set to `true` from a
  click handler in `session-chat-content.tsx`. Do not treat them as live user
  paths — the real merge and diff surfaces are the **PR** tab's
  `InlineMergePanel` and the **Changes** tab's `DiffTabView`.
- **A contextual single-button header action** (`SessionHeaderPrActions`, top
  right of the session header) exists alongside the panel: it shows exactly
  one button whose label/action depends on state — **Create PR** (no open PR),
  **Merge PR** (PR open, mergeable), or **Resolve Conflicts** (PR open, blocked
  by a merge conflict). All three do not perform the git action directly —
  they send a templated instruction to the agent in chat and let the agent run
  the tools. This is a real, always-available alternate route to creating and
  merging a PR that bypasses the panel forms entirely.

---

## STORY-501: Orient in the git panel — open it, switch tabs, close it

**Type**: short
**Topic**: Code Review & Ship
**Persona**: Priya, a tech lead who just got a Slack ping that her agent
session finished a task. She wants to see what changed before anyone else
looks at it.
**Goal**: Open the git panel and get from "what changed" to "is there a PR yet"
in a few clicks.
**Preconditions**: An active session with a linked repo, some file changes
already present, no PR yet.
**Ideal path**: 1 — the panel's default tab (`Files`) is one click from the
already-open session; pressing the documented shortcut is the fastest way in.
**Alternate paths**: Click the panel-toggle button in the session header
instead of the keyboard shortcut (same `handleGitPanelToggle` code path).

### Steps
1. Priya presses `Cmd+Shift+B` (or `Ctrl+Shift+B` on Windows/Linux) → the git
   panel opens on the right, defaulting to the **Files** tab.
2. She clicks the **Changes** tab (shows a small file-count badge next to the
   label) → the panel switches to the diff file list; the main content area
   does not change yet (the panel's Changes tab is a compact list, not the
   full diff).
3. She notices there is no **PR** tab yet — only **Files** and **Changes** are
   visible, because no PR can be opened until changes are committed.
4. She presses `Cmd+Shift+B` again → the panel closes.

### Variations
- If a PR already exists, a third **PR** tab is present from the start and the
  top bar shows the `#123` PR chip instead of nothing.

### Edge Cases
- Pressing the shortcut while it is held down (key repeat) does nothing — the
  handler explicitly ignores `event.repeat`.
- On a session with no repo linked at all, the top bar shows nothing (no PR
  chip, no Create PR chip); only Files and Changes tabs are usable, and the PR
  tab renders a disabled ghost tab with a tooltip.

---

## STORY-502: Jump from a file in the tree to its diff

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Marcus, a backend engineer, wants to check exactly what the agent
did to `apps/web/lib/db/schema.ts` without scrolling through every changed
file.
**Goal**: Go straight from a filename to its diff, expanded and scrolled into
view.
**Preconditions**: Git panel open, session has multiple changed files
including `schema.ts`, a renamed file, and a generated lockfile.
**Ideal path**: 1 — clicking the file row is the only control built for this;
there's no search box in the diff list.
**Alternate paths**: Open the **Changes** tab in the panel first, then click
the file row there instead of using the **Files** tab — both call the same
`openDiffToFile(path)` and land in the same place.

### Steps
1. Marcus is on the **Files** tab; he clicks `schema.ts` in the file tree →
   `openDiffToFile` fires, the main content area switches to `DiffTabView`
   (activeView becomes `diff`), and `schema.ts`'s section auto-expands and
   scrolls into view.
2. He reads the unified diff rendered by `PatchDiff`, sees `+` lines in
   green, `-` lines in red.
3. He clicks the collapsed row for the renamed file (icon is a yellow
   square-dot, same icon used for "modified") to expand it and confirm it's
   just a rename with no content change.
4. He clicks the row for a `bun.lock`-style generated file → it expands but
   shows "Generated file — diff content hidden" instead of a patch.

### Variations
- Doing the same from the panel's **Changes** tab list (instead of **Files**)
  produces an identical `openDiffToFile` call and identical result.
- Switching diff style from **Unified** to **Split** (icon toggle, top right
  of `DiffTabView`) re-renders the currently expanded file in two columns;
  this preference is remembered per the user's `defaultDiffMode` setting on
  future visits, except it is always forced back to Unified on mobile.

### Edge Cases
- Added files show a green square-plus icon; deleted files show a red
  square-minus icon; renamed and modified files share the same yellow
  square-dot icon, so a user can't tell a rename from a content edit without
  opening it.
- Markdown/text files (`.md`, `.mdx`, `.markdown`, `.txt`) render with
  line-wrap enabled instead of horizontal scroll — everything else scrolls.
- Clicking a file that has no diff content available (edge case in the data)
  shows "No diff content available" instead of a patch.

---

## STORY-503: Toggle between "All Changes" and "Uncommitted" scope

**Type**: short
**Topic**: Code Review & Ship
**Persona**: Sam, a solo builder who just committed once already and wants to
see only what's changed *since* that commit, not the whole branch diff.
**Goal**: Narrow the diff view to only uncommitted work.
**Preconditions**: A branch with one prior commit already pushed, plus new
uncommitted edits on top.
**Ideal path**: 1 — the scope toggle is the only control for this in both the
panel's Changes tab and the main `DiffTabView`.
**Alternate paths**: none found — the same `diffScope` value from
`GitPanelContext` drives both the compact panel list and the full
`DiffTabView`, so switching it in either place changes both.

### Steps
1. In the panel's **Changes** tab, Sam sees two small pills: **All Changes**
   and **Uncommitted** (the panel defaults to whichever has content: it opens
   on **Uncommitted** if there are unstaged edits, otherwise **All Changes**).
2. He clicks **All Changes** → the file list and the "N files changed / +X
   -Y" summary above it update to include the already-committed file too.
3. He clicks **Uncommitted** → the list and stats shrink back to just the new
   edit.

### Variations
- The same two-pill toggle exists independently inside `DiffTabView`'s
  `ScopeDropdown` (labeled "All changes" / "Uncommitted changes" there) on the
  legacy dialog `DiffViewer` — but that dialog is unreachable in the current
  UI, so this variation does not apply to a real user today.

### Edge Cases
- If there are zero uncommitted changes, the **Uncommitted** pill's file list
  shows "No uncommitted changes" instead of an empty list.
- The scope choice is not sticky across panel close/reopen — the effect that
  auto-picks a default scope re-runs every time `gitPanelOpen` flips back to
  true, unless the user manually picked a scope (`diffScopeManuallySetRef`)
  during the current open session, which is reset on close.

---

## STORY-504: Download the diff as a patch file to apply elsewhere

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Dana, an engineer on a locked-down corporate laptop who isn't
allowed to push directly from the agent sandbox and needs to apply the change
to her own local clone.
**Goal**: Get a `.diff` file and know exactly how to apply it.
**Preconditions**: Session has committed and/or uncommitted changes, sandbox
is connected (download requires a live sandbox).
**Ideal path**: 1 — the Download icon in the `DiffTabView` toolbar is the only
UI for this.
**Alternate paths**: none found.

### Steps
1. Dana opens the **Changes** tab in the panel and clicks a file to land in
   `DiffTabView`, or clicks the top bar's file-count badge — either way she's
   now looking at the full diff toolbar.
2. She clicks the download icon (tooltip "Download diff") → a **Download
   diff** dialog opens showing a ready-to-copy shell snippet:
   `git checkout main`, `git pull`, `git checkout -b apply-session-diff`,
   `git apply --check ~/Downloads/<branch>-<hash>.diff`, then `git apply`, with
   a 3-way-apply fallback line if the target branch has drifted.
3. She clicks the copy icon on the code block → button briefly shows a
   checkmark for 1.6 seconds confirming the copy.
4. She clicks **Download diff** in the dialog footer → the browser downloads
   `<branch-name>-<4-byte-hex>.diff`, a success toast reads "Diff downloaded".

### Variations
- If she instead clicks the toolbar download icon while the sandbox is
  offline, the button is disabled (`canDownloadDiff` requires `sandboxInfo`).

### Edge Cases
- If the fetch to `/api/sessions/[id]/diff/patch` fails, a toast shows the
  server's error message instead of "Diff downloaded"; the dialog stays open
  so she can retry.
- The download filename is generated client-side from the branch name
  (sanitized to `[a-zA-Z0-9._-]`, truncated to 80 chars) plus a random 4-byte
  hex suffix — two downloads in the same session never collide.

---

## STORY-505: Review a cached diff after the sandbox goes offline

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Leo, reviewing an agent's work on a train; the sandbox hibernates
mid-review because he stepped away from the tab.
**Goal**: Keep reading the diff he was already looking at, and understand that
what he's seeing might be stale.
**Preconditions**: Session had a live diff loaded, then the sandbox goes
offline/hibernates while the diff panel is open.
**Ideal path**: 1 — there's no action to take here; the banner is purely
informational and the diff stays visible from `session.cachedDiff`.
**Alternate paths**: none found.

### Steps
1. Leo has `DiffTabView` open with several expanded files.
2. The sandbox connection drops; `sandboxInfo` becomes null while `diff` stays
   populated from the last successful fetch → an amber banner appears just
   below the toolbar: "Viewing cached changes - sandbox is offline (saved Aug
   17, 3:42 PM)".
3. The diff content area gets a subtle opacity reduction (90%) to reinforce
   staleness, but remains fully readable and scrollable.
4. The refresh icon in the toolbar is disabled while offline (`disabled={...
   || !sandboxInfo}`), so he can't force a refresh until the sandbox
   reconnects.

### Variations
- If he had never successfully loaded a live diff (no cache at all), he'd see
  the normal empty/loading states instead of a stale banner — the banner only
  appears when there IS cached data to show alongside no live connection.

### Edge Cases
- The download-diff button is also disabled while offline (`canDownloadDiff`
  requires a live `sandboxInfo`), so he can look but not export until the
  sandbox comes back.
- The commit and discard controls in the panel's Changes tab are separately
  gated on `hasSandbox`, so the whole "act on this diff" surface goes quiet at
  once, not just the download button.

---

## STORY-506: Discard changes to a single file

**Type**: short
**Topic**: Code Review & Ship
**Persona**: Wei, who likes the agent's fix but not its unrelated edit to
`.env.example`.
**Goal**: Revert just that one file, keep everything else.
**Preconditions**: Multiple uncommitted files, sandbox connected, agent not
currently working.
**Ideal path**: 1 — the per-row trash icon in the panel's Changes tab is the
only single-file discard control.
**Alternate paths**: none found — discard is not available from `DiffTabView`,
only from the panel's compact file list.

### Steps
1. Wei opens the panel's **Changes** tab, hovers the `.env.example` row → a
   trash icon fades in on the right (only shown for unstaged/partial files;
   staged files have no discard control).
2. He clicks it → a confirm dialog opens: "Discard file changes?" / "This
   permanently removes local changes for .env.example. Committed changes stay
   intact."
3. He clicks **Discard file** → the row disappears from the list, diff/git
   status/file tree all refresh in parallel.

### Edge Cases
- The trash icon is disabled (not hidden) while the agent is actively
  responding, or while another discard is already in flight for a different
  file — clicking it does nothing but the icon stays visible with a spinner
  replacing the icon on the file actually being discarded.
- If the discard call fails, the dialog stays open and shows the server error
  inline instead of closing.

---

## STORY-507: Discard all uncommitted changes at once

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Nora, whose agent went off in a direction she doesn't want at
all — several files, none of them worth keeping.
**Goal**: Wipe every uncommitted edit in one action and get back to a clean
tree.
**Preconditions**: Several uncommitted files across the branch, sandbox
connected.
**Ideal path**: 1 — the toolbar-level trash icon (next to the scope pills,
only shown when `hasUncommittedGitChanges`) discards everything with no
per-file target.
**Alternate paths**: Discard each file individually via STORY-506's per-row
trash icon — slower, but reaches the same end state.

### Steps
1. Nora opens the panel's **Changes** tab; because there are uncommitted
   changes, a trash icon appears next to the refresh icon at the row above the
   file list (separate from any single file's own trash icon).
2. She clicks it → the same confirm dialog opens, but titled "Discard
   uncommitted changes?" / "This permanently removes local uncommitted changes
   from the sandbox. Committed changes stay intact." — no filename is
   mentioned because `discardTarget` is null.
3. She clicks **Discard changes** → all uncommitted files clear from the list;
   diff, git status, and the file tree refresh together.

### Edge Cases
- This control only ever targets uncommitted work — already-committed changes
  on the branch are unaffected regardless of which discard button she uses;
  the dialog copy explicitly reassures "Committed changes stay intact."
- The toolbar discard icon is hidden entirely once there are zero uncommitted
  changes, so there's no way to accidentally re-trigger it after a successful
  discard until new edits appear.

---

## STORY-508: Review the diff, decide the agent got it wrong, and reject it

**Type**: long
**Topic**: Code Review & Ship
**Persona**: Elena, a senior engineer reviewing an agent run that was
supposed to fix a validation bug but instead rewrote half the form component.
**Goal**: Recognize a bad approach before it's committed, undo it cleanly, and
redirect the agent instead of shipping it.
**Preconditions**: Session with uncommitted changes across several files, no
PR yet, agent turn has completed (not actively streaming).
**Ideal path**: 3 — read the diff, discard the bad work, then send a
correction; there's no single-click "reject" — rejection is
review-then-discard-then-redirect, not a dedicated feature.
**Alternate paths**: Instead of discarding via the panel, she could tell the
agent in chat to revert its own changes — slower and depends on the agent
correctly identifying what to undo, versus the deterministic discard action.

### Steps
1. Elena presses `Cmd+Shift+B`, lands on **Files**, then clicks into the
   **Changes** tab to see the full file list with `+`/`-` counts per file.
2. She clicks the largest file by line count → `DiffTabView` opens with that
   file expanded; she reads the unified diff and sees the agent refactored a
   shared form component instead of touching the one validation function the
   bug report named.
3. She expands two more touched files the same way and confirms the scope is
   wrong — this isn't a small follow-on edit, it's the wrong approach
   entirely.
4. She decides not to commit any of it. Back in the panel's **Changes** tab,
   she clicks the toolbar discard (trash) icon next to the scope pills (all
   changes are uncommitted, so **Uncommitted** scope already shows everything
   relevant).
5. She confirms **Discard changes** in the dialog → the tree goes back to
   clean; diff, git status, and file tree refresh.
6. She sends a new chat message narrowing the scope: "Only touch the
   validation function in `X`, don't refactor the shared form component."

### Variations
- If only one of several files is wrong, she discards just that file
   (STORY-506) and commits the rest instead of discarding everything.
- If some of the bad work is already committed and pushed (not just
  uncommitted), the discard button can't remove it — the panel's discard tools
  only ever target uncommitted work; she would need to ask the agent to revert
  the commit or push a fix commit on top instead.

### Edge Cases
- Discarding is disabled while `isAgentWorking` is true — she must wait for
  the turn to fully finish before she can reject its output, even though she
  can already read the diff mid-stream.
- If she discards and then immediately asks the agent to redo the work, there
  is no built-in link between "discard" and "next instruction" — the agent has
  no automatic memory that its prior diff was rejected unless she says so in
  the message.

---

## STORY-509: First full ship — branch, AI commit message, push, AI PR, preview

**Type**: long
**Topic**: Code Review & Ship
**Persona**: Carlos, shipping his first change through Open Agents end to end
and wants to see the whole loop work before he trusts it on a real project.
**Goal**: Go from uncommitted changes on the base branch to an open PR with a
resolved preview URL.
**Preconditions**: Session on the repo's base branch (no feature branch
created yet — session git status shows the current branch equals base, or
detached HEAD), uncommitted changes present, Vercel project linked to the
repo (so preview deployments are possible).
**Ideal path**: 1 — the panel's Changes tab commit flow → PR tab create flow
is the single built-for-this path; every other route (below) either does the
same thing conversationally or requires pre-existing state this story doesn't
have.
**Alternate paths**: (a) Click the single **Create PR** button in the session
header instead of using the panel forms — it sends "Commit and push the
current changes on this branch, then open a pull request..." to the agent and
lets it drive the same underlying actions; (b) if the session's git defaults
have auto-commit/push and auto-PR enabled, the agent may create the branch,
commit, and PR itself as a side effect of finishing its turn, with no user
action here at all.

### Steps
1. Carlos opens the panel's **Changes** tab. Because the branch equals the
   base branch, `InlineCommitPanel` shows "On base branch — create a new
   branch first." and a **Create branch** button instead of a commit form.
2. He clicks **Create branch** → the branch is created in the sandbox; the
   panel swaps to the commit form once git status confirms the new branch.
3. He clicks the wand icon (`WandSparkles`) inside the (initially collapsed)
   commit textarea area — first he clicks **Edit message** to expand it, then
   the wand icon → `isGeneratingMessage` spins, then the textarea fills with
   an AI-written commit message from `/api/sessions/[id]/generate-commit-message`.
4. He clicks **Commit & Push** → button shows "Committing...", then a green
   "Committed" pill for 3 seconds; a synthetic assistant chat message with a
   `data-commit` part appears in the transcript recording the commit SHA and
   a link to the GitHub commit.
5. He clicks the **PR** tab (now enabled, since changes are committed and
   there are no more uncommitted changes) — or clicks the **Create PR** chip
   that appeared in the panel's top bar, which does the same
   `setGitPanelTab("pr")`.
6. In `InlinePrCreatePanel`, he clicks **Edit title & description** to expand
   the form, then the wand icon next to the title field → generates both a
   title and body from `/api/generate-pr` using the branch's diff.
7. He clicks **Create Pull Request** → a synthetic `data-pr` chat message
   shows "pending" then "success"; the panel shows a green "Pull request
   created!" banner with a **View on GitHub** link, and the top bar now shows
   the `#N` PR chip.
8. Over the next moments a **Preview** chip appears in the top bar with a
   pulsing amber globe icon (deployment building); once Vercel resolves it,
   the icon turns solid green — clicking it opens the live preview URL in a
   new tab.

### Variations
- If he types his own commit message instead of generating one, the button
  icon switches from a sparkle to a `GitCommit` icon and the typed text is
  used verbatim (split into title/body on the first newline).
- Clicking the small chevron next to **Create Pull Request** offers **Create
  Draft PR** as a one-off menu item instead of a full second button.

### Edge Cases
- If he skips reading the generated PR body and it's empty/wrong, there's no
  "regenerate" affordance beyond clicking the same wand icon again, which
  overwrites the field.
- If the deployment fails instead of resolving, the Preview icon turns solid
  red instead of green, and clicking it opens the failed-deployment URL
  (still useful for debugging) rather than a working preview.
- Diff stats (files changed, +/-) are shown in at least three places by this
  point: the **Changes** tab badge (file count only), the `DiffTabView`
  toolbar (files + additions/deletions), and once a PR exists, the **PR**
  tab's stats row (files/additions/deletions/commit count pulled from GitHub)
  — these can momentarily disagree if GitHub hasn't finished indexing the
  freshly pushed commit when the PR tab first loads.
- Branch name is shown independently in the commit panel (`displayBranch`),
  the git status hook's raw value, the download-diff dialog's default
  filename, and the PR readiness response's `baseBranch` — all derived from
  the same git status refresh but not guaranteed to repaint in the same
  render.

---

## STORY-510: Create a draft PR with auto-merge enabled

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Aisha, shipping a small, low-risk fix and wants it to merge
itself the moment checks pass, without her coming back to click Merge.
**Goal**: Open a PR that merges automatically once CI is green, without
publishing it as ready-for-review immediately.
**Preconditions**: Committed changes on a feature branch, no existing PR.
**Ideal path**: 2 — expand the PR form, turn on **Auto-merge**, then use the
dropdown's **Create Draft PR** rather than the primary button, since she wants
both draft status and auto-merge together.
**Alternate paths**: none found for combining draft + auto-merge in one
action — the primary **Create Pull Request** button and the dropdown's
**Create Draft PR** are the only two ways to submit, and only one runs at a
time.

### Steps
1. Aisha opens the **PR** tab, clicks **Edit title & description** to reveal
   the full form (title, description, and an **Auto-merge** row with the
   caption "Merge automatically once checks pass.").
2. She toggles **Auto-merge** on.
3. She clicks the chevron next to **Create Pull Request** and selects
   **Create Draft PR** from the dropdown.
4. The success state shows "Draft pull request created!" — note the panel's
   success-message logic checks `autoMergeEnabled` before `isDraft`, so if
   auto-merge actually succeeded on a draft it would instead say "PR created —
   auto-merge enabled!"; whichever message wins, an inline amber note appears
   if `autoMergeError` is set.

### Variations
- If she leaves **Auto-merge** off and just creates a normal PR, she sees
  the plain "Pull request created!" message with no auto-merge note.

### Edge Cases
- Enabling auto-merge on a draft is a real combination in the code
  (`isDraft && shouldAutoMerge` is explicitly handled), but GitHub only
  allows auto-merge on non-draft PRs in some repo configurations — if enabling
  it server-side fails, the amber `autoMergeError` banner explains why instead
  of silently dropping the setting.
- The Auto-merge toggle itself is only visible once she's expanded the form
  (`isExpanded`); a user who never clicks **Edit title & description** and
  just hits the collapsed **Create Pull Request** button never sees the option
  and gets a normal PR.

---

## STORY-511: PR creation falls back to a GitHub compare page

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Tomás, working in an org repo where the connected GitHub identity
doesn't have permission to open PRs via the API directly.
**Goal**: Still get a PR opened, even if Open Agents can't create it for him
directly.
**Preconditions**: Committed changes on a branch, GitHub App/token lacks the
scope or permission to create a PR programmatically for this repo.
**Ideal path**: 1 — there's nothing to choose; the fallback is automatic
inside `openPullRequest` when the direct API path isn't available.
**Alternate paths**: none found — this is a server-side fallback, not a
user-selectable option.

### Steps
1. Tomás fills in the PR form (or leaves it to auto-generate) and clicks
   **Create Pull Request** as normal.
2. Instead of a created PR, the response comes back with
   `requiresManualCreation: true` and a pre-filled GitHub compare URL
   (`.../compare/<base>...<head>?expand=1&title=...&body=...`).
3. The panel's success state shows "Compare page opened" instead of "Pull
   request created!", with the link text reading **Open compare page** instead
   of **View on GitHub**.
4. He clicks it, and GitHub opens in a new tab with the compare/PR form
   already filled with his AI-generated (or hand-typed) title and body — he
   finishes the last click on GitHub itself.

### Edge Cases
- If Auto-merge was toggled on in this fallback scenario, it's forced off
  server-side and the amber note reads "Auto-merge can only be enabled for
  pull requests created through the GitHub API." — a real limitation, not a
  UI omission.
- Because no PR number is known yet in this state, `onPrDetected` never fires,
  so the top bar's PR chip and the **PR** tab don't switch into
  "existing PR" mode — Open Agents has no way to know the PR was actually
  opened until git status/branch polling later detects it via
  `checkPullRequest`.

---

## STORY-512: CI is red — see failing checks and ask the agent to fix them

**Type**: long
**Topic**: Code Review & Ship
**Persona**: Raj, who opened a PR and comes back ten minutes later to merge it,
only to find two checks failed.
**Goal**: Understand what's failing and get it fixed without leaving the
session.
**Preconditions**: An open PR with at least one required check that has
failed (`checks.failed > 0`).
**Ideal path**: 1 — the **Fix errors** button on the failing-checks group is
the one control built specifically for this.
**Alternate paths**: Click the header's contextual button — but note it would
show **Merge PR** here, not a fix action, since `selectPrAction` only shows
**Resolve Conflicts** for merge-conflict reasons, not failing checks; so for
CI failures specifically, the header button is not an alternate route — the
panel's **Fix errors** button is the only one.

### Steps
1. Raj opens the **PR** tab → `InlineMergePanel` loads merge readiness and
   shows the PR title/body, diff stats, and a **Checks** block.
2. Because there's more than one distinct check state present, checks are
   grouped: he sees a "1 failing check" section, a "2 passing checks" section,
   sorted failing-first.
3. He clicks a failing check's name → it opens the check run's `detailsUrl`
   (GitHub Actions log) in a new tab; he skims the log himself first.
4. Back in the panel, he clicks **Fix errors** next to the failing group →
   button becomes "Analyzing logs…" with a spinner. Under the hood this posts
   to `/api/sessions/[id]/checks/fix`, which returns a prompt (and optional
   code snippets) built from the failing check names and logs; that prompt is
   sent to the agent as a new chat message (falling back to a generic "Fix the
   following checks: ..." prompt if the analysis endpoint fails).
5. He watches the agent work in the chat, push a fix commit.
6. Because a PR is open, `shouldPollMergeReadiness` keeps polling every 5
   seconds while `checks.pending > 0` — he watches the failing check flip to
   pending (yellow dashed-circle icon), then eventually to passed (green
   check), with no manual refresh needed.
7. Below the "Merge blocked" reasons area, a **Merge blocked** banner
   disappears once all reasons clear; the merge button becomes active.

### Variations
- If there are only two distinct... actually if all checks share one state
  (e.g., everything failing), the list isn't grouped into accordions — it's a
  flat sorted list instead, with a single **Fix errors** button above it
  covering every failing run.
- He could also click the manual refresh icon in the **Checks** header at any
  time instead of waiting for the poll interval.

### Edge Cases
- **Fix errors** is disabled while the agent is already working
  (`fixChecksDisabled`), with the disabled-state title "Disabled while the
  agent is working" shown on hover.
- If the fix attempt makes things worse (a *different* check now fails), the
  next `loadReadiness` poll simply shows the new failing check — there's no
  history of "what used to be failing."
- Required-check counts (`readiness.checks.requiredTotal`) versus all check
  runs (`checkRuns`) can diverge: a repo might have 5 check runs but only 2
  "required" — the passed/pending/failed summary counts only the required
  ones even though every run's row is listed.

---

## STORY-513: Merge blocked by a real merge conflict

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Yuki, whose PR has been open for a few days while a teammate
merged conflicting changes to the base branch.
**Goal**: Understand why merge is blocked and get the conflict resolved.
**Preconditions**: Open PR whose readiness reasons include a string
containing "merge conflict" (case-insensitive).
**Ideal path**: 1 — the **Fix conflicts** button inside the "Merge blocked"
banner is purpose-built for this.
**Alternate paths**: Click the header's contextual button — here it correctly
shows **Resolve Conflicts** (not Merge PR), because `selectPrAction` detects
the conflict reason via the same regex and switches the single header button
for her; both send effectively the same instruction to the agent
("Fetch <base>, resolve the conflicts, and avoid rebasing" vs. "Resolve the
merge conflicts on this branch").

### Steps
1. Yuki opens the **PR** tab; the "Merge blocked" banner shows the reason text
   from GitHub (something like "Merge conflict") plus panel-added guidance:
   "Fetch `origin/main`, resolve the conflicts, and avoid rebasing."
2. Because the reason matches the conflict pattern, a **Fix conflicts** button
   (sparkle icon) appears under the guidance text, absent for other kinds of
   blocking reasons.
3. She clicks it → a message is sent to the agent asking it to fetch the base
   branch and resolve conflicts without rebasing.
4. She watches the agent work, then sees readiness refresh (poll or manual
   refresh) drop the conflict reason once the agent pushes a resolved merge.

### Variations
- Using the header's **Resolve Conflicts** button instead skips the panel
  entirely — she never needs to open the **PR** tab to trigger the same fix.

### Edge Cases
- Merge conflicts are explicitly **not** one of the bypassable reasons — the
  panel's `forceBypassableReasons` set only covers failing/pending checks and
  generic branch-protection text, so `canForce` stays false and no
  "Merge without passing checks" escape hatch appears while a conflict reason
  is present, even if she desperately wants to force it.
- If there are multiple non-bypassable reasons at once (e.g., a conflict *and*
  an unrelated branch-protection rule), all of them are listed under "Merge
  blocked," but only the conflict-specific guidance and **Fix conflicts**
  button appear — the other reasons have no matching action button.

---

## STORY-514: Force-merge past a stuck required check

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Ben, working solo on a personal repo where a required check is
misconfigured and will never pass, but he's confident the code is fine.
**Goal**: Merge anyway, deliberately bypassing the check gate.
**Preconditions**: Open PR where `canMerge` is false, but every blocking
reason is one of the bypassable ones (failing/pending required checks or
generic branch-protection text) — no merge conflict present.
**Ideal path**: 1 — **Merge without passing checks** is the only control for
this, and it requires two clicks by design.
**Alternate paths**: none found — there is no force option in the header's
contextual button, only in the panel.

### Steps
1. Ben opens the **PR** tab; because `canMerge` is false but `canForce` is
   true (no non-bypassable reasons), the button area shows a destructive
   **Merge without passing checks** button instead of a normal merge button.
2. He clicks it once → the button relabels itself to "Click again to confirm"
   with an alert-triangle icon, and starts a 5-second window.
3. He clicks it again within that window → `mergePr` is called with
   `force: true`; on success, `handleMerged` runs — updates the session's PR
   status to merged, archives the session, and redirects to `/sessions`.

### Variations
- If he waits longer than 5 seconds without clicking again, the button
  silently reverts to "Merge without passing checks" and he has to start the
  confirm sequence over.

### Edge Cases
- If he switches away from the PR tab (or the readiness data reloads) between
  the first and second click, `forceConfirming` state persists locally in the
  component but is unrelated to server state — a stale `expectedHeadSha` could
  still cause the merge call to fail if someone pushed a new commit in the
  interim; the error surfaces inline instead of merging.
- Force merge and the **Delete source branch** toggle are independent — force
  does not imply skipping branch cleanup; whatever the toggle is set to at
  click time still applies.

---

## STORY-515: Merge readiness that never resolves

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Grace, whose PR sits at "GitHub is still calculating
mergeability" far longer than it should — a known GitHub-side delay on a
large repo.
**Goal**: Figure out whether she's stuck or just needs to wait, and get
unstuck without endlessly staring at a spinner.
**Preconditions**: Open PR whose readiness reasons include a transient
message ("GitHub is still calculating mergeability", or "Branch protection
requirements are not yet satisfied") with no pending or failed checks.
**Ideal path**: 2 — wait through the automatic poll window, then use the
manual refresh once it stops; there is no faster deterministic path since the
delay is on GitHub's side.
**Alternate paths**: none found — this state has no dedicated fix button, only
the general checks-refresh icon.

### Steps
1. Grace opens the **PR** tab; the "Merge blocked" banner shows "GitHub is
   still calculating mergeability" as the only reason, checks are all passed.
2. `shouldPollMergeReadiness` keeps re-fetching every 5 seconds
   (`MERGE_READINESS_POLL_INTERVAL_MS`) because the reason is on the
   transient list — she watches the panel silently refresh in place, nothing
   visibly changes.
3. After 6 transient polls (30 seconds total), `transientPollCount` hits
   `MERGE_READINESS_TRANSIENT_MAX_POLLS` and polling stops automatically —
   the panel goes quiet with the same blocked reason still showing, and
   nothing tells her polling has stopped.
4. She clicks the manual refresh icon inside the **Checks** header (the same
   `RefreshCw` control used everywhere else) → `loadReadiness` fires once
   more and resets `transientPollCount` implicitly via the readiness-change
   effect if the reason changes.

### Variations
- If instead the stuck state is `checks.pending > 0` (a check genuinely
  still running), polling never stops on its own — `shouldPollMergeReadiness`
  returns true unconditionally while pending checks exist, independent of the
  transient-reason cap. This is a real, permanent-until-GitHub-responds
  polling loop, not a bug — but from the user's perspective it looks identical
  to the stuck-calculating case until she reads the wording carefully.

### Edge Cases
- Nothing in the UI distinguishes "still polling automatically" from "polling
  gave up, click refresh yourself" — both render the same static "Merge
  blocked" banner; a careful user has to know the 30-second rule to realize a
  manual click is now required.
- Switching to another tab and back resets `transientPollCount` to 0 (the
  effect keys off `session.prNumber`, not visibility), so leaving the PR tab
  and returning restarts the 30-second automatic-poll allowance.

---

## STORY-516: Merge with a chosen method, and the no-merge ending

**Type**: medium
**Topic**: Code Review & Ship
**Persona**: Priya (from STORY-501), now actually ready to ship: checks are
green, no conflicts, and she has a house-style preference for squash commits.
**Goal**: Merge using a specific method, clean up the branch, and land back
on the sessions list with the session archived — or, if she changes her mind,
close the PR without merging at all.
**Preconditions**: Open PR, `canMerge` is true, repo allows more than one
merge method (`allowedMethods.length > 1`).
**Ideal path**: 1 — the merge button plus its method dropdown is the single
built path; every method (squash/merge/rebase) shares the same button, just
relabeled.
**Alternate paths**: (a) click the header's single **Merge PR** button
instead — it sends "Merge the open pull request for this branch..." to the
agent and lets it choose/call the merge itself, with no method picker exposed
to Priya at all; (b) abandon the merge and click **Close & Archive** instead.

### Steps
1. Priya opens the **PR** tab; **Checks** shows all-passed (solid green
   circle with a check, not the mixed pie-chart icon). No "Merge blocked"
   banner is present.
2. She leaves **Delete source branch** toggled on (default) — caption reads
   "Deletes the PR branch after merge."
3. The primary button reads **Squash & Archive** (the default method); she
   clicks the chevron beside it to open the method dropdown, which lists all
   three with descriptions: "Squash and merge — Combine all commits into one
   commit in the base branch.", "Create a merge commit — All commits will be
   added to the base branch via a merge commit.", "Rebase and merge — All
   commits will be rebased and added to the base branch."
4. She picks **Create a merge commit** → the primary button relabels to
   **Merge & Archive**.
5. She clicks **Merge & Archive** → button shows "Merging..."; on success,
   `handleMerged` marks the session's PR status "merged", archives the
   session, and the app redirects her to `/sessions` — she never sees a
   post-merge state inside this session again.

### Variations
- **No-merge ending**: instead of merging, she clicks the destructive
  **Close & Archive** button (present whenever `canCloseAndArchive` — PR
  open and session not already archived). A confirm dialog titled "Close &
  Archive" reads "Close PR #N and archive this session. This will not merge
  any changes." Confirming calls `closePr`, marks status "closed", archives
  the session, and redirects to `/sessions` — same destination, opposite
  outcome.
- If the repo only allows one merge method, no dropdown chevron is rendered
  at all — just a single button in that method's "& Archive" label.

### Edge Cases
- If she force-refreshes or navigates back into an already-merged session's
  PR tab (e.g., via browser back button before the redirect settles), the
  panel renders a distinct "merged" state: no merge/close buttons, just a
  purple-accented "Pull request merged" / "The branch has been merged and can
  be safely deleted." card — action buttons are fully replaced, not just
  disabled.
- If the branch-delete succeeds but archiving the session throws, the error
  is re-thrown with a combined message ("Pull request merged, but archiving
  the session failed: ...") — the PR is genuinely merged on GitHub even
  though the UI surfaces this as an error and she stays on the page instead
  of being redirected.
- If GitHub reports the branch could not be deleted (`branchDeleteError`)
  even though the merge itself succeeded, that failure is only logged to the
  console — nothing in the UI tells her the branch is still sitting there.

---

## Cross-surface duplication summary

- **PR number / status** (`open`/`merged`/`closed`) is rendered independently
  in: the git panel top bar chip, the **PR** tab's `InlineMergePanel` (title,
  body, merged banner), the session header's contextual button state
  (`SessionHeaderPrActions`), and synthetic `data-pr` chat messages logged at
  creation time. These all read from the same `session.prNumber`/`prStatus`
  plus live readiness polling, but update on different triggers/cadences and
  can disagree for a few seconds after any git action.
- **Diff stats** (files changed, +additions, -deletions) appear in: the
  **Changes** tab badge (count only), the `DiffTabView` toolbar (full stats,
  scope-filtered), and the **PR** tab's readiness stats row (GitHub's own
  numbers, includes commit count) — the first two come from the sandbox's live
  git diff, the third from the GitHub API, so they can be scoped differently
  (uncommitted-vs-branch vs. whole-PR) even when nothing is wrong.
- **Branch name** appears in the commit panel, the git status hook, the
  download-diff dialog's generated filename, and the PR readiness response's
  `baseBranch`/head branch — all ultimately sourced from one git-status fetch
  but each consumer resolves its own fallback (`"HEAD"` → session's stored
  branch → base branch) independently, so a detached-HEAD state can render
  differently across the three.
