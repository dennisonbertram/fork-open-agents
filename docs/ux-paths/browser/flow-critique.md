# Flow Critique: Open Agents

Generated: 2026-08-17
Source: docs/ux-paths/browser/catalog.md (187 stories)
Candidates examined: 60
Confirmed in code: 56   Unconfirmed: 4

A note on scope: the catalog's `## Redundancy Candidates` section lists
roughly 100 individual bullet points across its three subsections (Duplicate
paths / Duplicate information / Overlapping features), but many of those
bullets cite the same underlying redundancy from different angles — for
example STORY-043, STORY-129, STORY-128 and STORY-415 in the catalog all
describe the same "background-agent run has too many URLs" problem. This
critique treats one *consolidated real-world redundancy* as one candidate,
citing every bullet/story that describes it, rather than producing one
finding per raw bullet. Every STORY-ID that appears in `## Redundancy
Candidates` is accounted for below, either in a numbered finding, in "What is
fine as it is," or in "Not confirmed."

## Verdict summary

| Verdict | Count |
|---------|-------|
| keep | 30 |
| redirect | 3 |
| merge | 11 |
| differentiate | 12 |
| unconfirmed | 4 |

## Findings

### F-001 — The same background-agent run has five or six live URLs

- **Verdict:** redirect
- **Stories:** STORY-043, STORY-129
- **Evidence:** `apps/web/app/background-runs/[runId]/page.tsx:33` renders
  `BackgroundRunDetail` with no `variant` prop (defaults to `"legacy"`);
  `apps/web/app/runs/background-agent/[runId]/page.tsx:29` renders the same
  component with `variant="canonical"`. Both paths render the identical
  `nativeDetail` block (`apps/web/app/background-runs/[runId]/background-run-detail.tsx:598`),
  differing only in wrapper chrome (`RunDetailShell` at
  `apps/web/app/runs/run-detail-shell.tsx`) and nav highlighting. Neither
  route redirects to the other. The same run is also linkable from
  `/repos/{owner}/{repo}/agents/{agentId}`, `/automations/background-agent/{agentId}`,
  and the filtered `/runs?automationId=...&automationSource=...` list — none
  of which redirect to canonical either.
- **What it costs the user:** A bookmark, a pasted link in a PR comment, or a
  link shared in Slack can point to `/background-runs/{id}` while the product
  elsewhere links to `/runs/background-agent/{id}` for the exact same run.
  Two people debugging the same failure can be looking at visually different
  pages and not realize it's the same evidence.
- **Recommendation:** Make `/background-runs/{runId}` a 308 redirect to
  `/runs/background-agent/{runId}` (preserve the legacy path for old links,
  but stop rendering it as a first-class page). Leave the *list* surfaces
  (agent detail run-history, automation detail run-history, filtered
  `/runs`) alone — those are legitimately different views that should simply
  link to the canonical detail URL.
- **Effort:** small

### F-002 — Two repository-creation dialogs post to two different endpoints

- **Verdict:** merge
- **Stories:** STORY-027
- **Evidence:** `apps/web/components/create-repository-dialog.tsx` submits
  via `submitCreateRepository`, which posts to `/api/github/repos`.
  `apps/web/components/create-repo-dialog.tsx:158` posts to
  `/api/github/create-repo` — a different endpoint entirely. The catalog's
  own claim ("both POST to the same `/api/github/repos` endpoint") is wrong;
  the real situation is worse than what the catalog reported.
- **What it costs the user:** This isn't cosmetic duplication reaching one
  outcome — it's two independent implementations of "create a repository."
  A bug fixed in one dialog's validation, error handling, or default-branch
  logic will not exist in the other. A user who hits a repo-creation bug via
  one entry point and later hits the *same class of bug* via the other entry
  point will reasonably conclude the fix didn't ship.
  **This is a top-3 offender** (see below).
- **Recommendation:** Establish one canonical repo-creation implementation
  (one dialog, one endpoint) and make every entry point call it. Delete the
  other dialog component and its endpoint once callers are migrated.
- **Effort:** medium

### F-003 — Actions and Secrets check the GitHub App's permission, not the signed-in user's

- **Verdict:** differentiate
- **Stories:** STORY-124
- **Evidence:** `apps/web/lib/github/actions-manager/readiness.ts:70-117`
  computes `canWrite` from the GitHub *App installation's* `permissions.actions`
  field ("This installation has not granted Actions write permission for
  this repo") — it never checks the signed-in user's own collaborator role on
  GitHub. `apps/web/app/repos/[owner]/[repo]/actions/dispatch-dialog.tsx:113-124`
  and `apps/web/app/repos/[owner]/[repo]/secrets/repository-secrets-client.tsx:173,249`
  both gate their write controls on this same App-level `canWrite`/`readiness`
  value. The catalog's secondary claim — that there is "no mapped
  `repo_access_denied` error copy" — is not accurate: `repo_access_denied` is a
  real error kind (`apps/web/lib/github/actions-manager/errors.ts:94`,
  `apps/web/lib/github/secrets-manager/errors.ts:76`) with copy "Access
  denied to this repository." at `apps/web/app/repos/[owner]/[repo]/github-windows.tsx:47-48`.
- **What it costs the user:** A read-only GitHub collaborator, on a repo
  where the org's GitHub App happens to have write permission, sees an
  enabled "Run workflow" button and an enabled "Add secret" form — both look
  fully actionable. The request only fails at submit time, with a generic
  "Access denied to this repository" that doesn't explain *why* (it's your
  personal role, not the App's grant) or what to do about it. The control's
  enabled state is actively misleading about what this specific user can do.
- **Recommendation:** Check the signed-in user's actual repo permission
  (GitHub's `permission` field on the collaborator/repo API) in addition to
  the App's installation scope, and disable the control with a
  role-specific reason ("You have read access to this repo") rather than
  letting it fail at submission.
- **Effort:** medium

### F-004 — Background Agents' two edit surfaces enforce different rules for the same action

- **Verdict:** merge
- **Stories:** STORY-032, STORY-044, STORY-045
- **Evidence:** `apps/web/app/automations/background-agent/[agentId]/edit/automation-agent-edit-experience.tsx:61`
  passes a computed `readinessReady` into the Enable control, blocking it
  until the agent's readiness checks pass. `apps/web/app/repos/[owner]/[repo]/agents/[agentId]/edit/agent-edit-form.tsx:49`
  defaults `readinessReady` to `true` unconditionally — the repo-scoped
  legacy surface never computes or enforces the check. Both surfaces edit
  the same agent record through the same `AgentDetailContent` component
  (`apps/web/app/automations/background-agent/[agentId]/page.tsx` and
  `apps/web/app/repos/[owner]/[repo]/agents/[agentId]/page.tsx`).
- **What it costs the user:** The exact same "Enable" action is blocked or
  allowed depending on which URL the user happens to be on for the same
  agent. A user who gets blocked on `/automations/...` can walk to
  `/repos/.../agents/...` and enable the same not-ready agent anyway — the
  readiness gate exists to prevent shipping something broken, and one of its
  two front doors doesn't check for the lock.
- **Recommendation:** Move the `readinessReady` check into the shared
  `AgentDetailContent`/edit-form logic so both surfaces enforce it
  identically, or retire the repo-scoped legacy edit surface in favor of the
  automation one.
- **Effort:** small

### F-005 — Agent Loops' two surfaces are cosmetic-only duplication

- **Verdict:** redirect
- **Stories:** STORY-001, STORY-010
- **Evidence:** `apps/web/app/loops/[loopId]/page.tsx` and
  `apps/web/app/loops/new/page.tsx` render `LoopDetail`/`BuilderCanvas` with
  the default `surface` (legacy branding); `apps/web/app/automations/agent-loop/[loopId]/page.tsx:31`
  and `apps/web/app/automations/agent-loop/new/page.tsx:49` render the same
  components with `surface="automation"`. Both `/loops/new` (lines 24, 51-65)
  and `/automations/agent-loop/new` (lines 24, 45-61) check
  `isAgentLoopsEnabled()` and block identically — unlike the Background
  Agents case in F-004, there is no behavioral divergence here, only a
  `surface` prop that swaps copy/URL/redirect branding. The shared
  `TriggersCard` component (STORY-010) is reused unchanged by both.
- **What it costs the user:** Lower than F-004 (no functional difference),
  but it's still two full route trees maintained for one feature, and a user
  who bookmarks or shares `/loops/{id}` gets a visually different page than
  a colleague who bookmarks `/automations/agent-loop/{id}` for the same
  loop, with no indication they're the same object.
- **Recommendation:** Since the two surfaces are provably behavior-identical
  (unlike F-004), this is a clean redirect: pick the automation surface as
  canonical (it's the newer, consolidated naming) and 308-redirect the
  legacy `/loops/*` routes to it.
- **Effort:** small

### F-006 — Background Agents has no hard stop when disabled; Agent Loops does

- **Verdict:** merge
- **Stories:** STORY-097, STORY-086, STORY-134
- **Evidence:** `apps/web/app/loops/new/page.tsx:24,51-65` and
  `apps/web/app/automations/agent-loop/new/page.tsx:24,45-61` both check
  `isAgentLoopsEnabled()` and block creation with "Loops are disabled" copy
  when `AGENT_LOOPS_ENABLED` is off. No equivalent check exists on the
  background-agent creation pages (`apps/web/app/repos/[owner]/[repo]/agents/new/`
  and `apps/web/app/automations/new/`) — neither checks
  `BACKGROUND_AGENTS_ENABLED` before letting the user build and save an
  agent.
- **What it costs the user:** A user on a deployment with background agents
  disabled can fully configure an agent, wire up triggers, and save it, and
  it will simply never run — with no error, no warning, nothing at the point
  where the mistake is made. The equivalent mistake in Agent Loops is caught
  immediately with a clear "disabled" message.
- **Recommendation:** Apply the same `isAgentLoopsEnabled()`-style hard-stop
  pattern that Loops already has to the background-agent creation pages,
  gated on `BACKGROUND_AGENTS_ENABLED`.
- **Effort:** small

### F-007 — Four different ways of saying "this feature is off"

- **Verdict:** merge
- **Stories:** STORY-086
- **Evidence:** `apps/web/app/gtm/layout.tsx:7` calls `notFound()` with zero
  explanation when GTM is disabled. `apps/web/app/loops/new/page.tsx:58-62`
  shows raw env-var text: "Agent Loops are not enabled in this deployment.
  Set `AGENT_LOOPS_ENABLED=true` to enable them." `apps/web/app/loops/error-copy.ts:147-149`
  shows admin-directed copy for the dispatch-error case: "The loops feature
  is disabled on this deployment. Ask your workspace administrator to enable
  the loops feature flag." `apps/web/app/settings/admin/admin-access-gate.tsx:28-29`
  shows an honest, audience-appropriate gate: "This area is for workspace
  admins. You don't have access — that's expected for most people."
- **What it costs the user:** The same underlying event (a feature is
  off/gated) is communicated four different ways in one product: silently
  (404), technically (env-var name a normal user can't act on), helpfully
  (points at an admin), and honestly (explains why *this* audience is
  seeing it). A user hitting the GTM 404 has no idea it's a flag, not a bug.
- **Recommendation:** The admin-settings gate's pattern (state what this
  area is for, state plainly that most people won't have access, no jargon)
  is the one worth generalizing. Route the other three through a shared
  "feature unavailable" component with that same honest framing.
- **Effort:** medium

### F-008 — One of the Automations list's three empty states has no working retry

- **Verdict:** differentiate
- **Stories:** STORY-088, STORY-089
- **Evidence:** `apps/web/app/automations/automations-list.tsx:372-407`
  defines three distinct empty states because the list aggregates two run
  sources (`background_agent`, `agent_loop`). The `allUnavailable` state
  (lines 372-382) renders "Automations could not be loaded" with text that
  only *says* "Retry this page" — there is no button wired to an actual
  retry action, unlike the other two states.
- **What it costs the user:** When both sources are down, the one message
  that matters most (everything failed) is the one with no actionable
  affordance — the user has to know to hit their browser's refresh, because
  the in-app text implies a button that isn't there.
- **Recommendation:** Add a real retry button to the `allUnavailable` empty
  state that matches the affordance already present in the other two states,
  and keep the three states visually distinct given they already aggregate
  two source types.
- **Effort:** small

### F-009 — The runs list used to hide the reason for "Needs attention" — already fixed

- **Verdict:** keep
- **Stories:** STORY-128
- **Evidence:** The catalog claims "the list row shows only state/outcome/health
  badges; the actual attention reason (`attentionReasons` string) only
  renders on the detail page." That is no longer true.
  `apps/web/app/runs/runs-list.tsx:46-89` (`RunDimensions`) renders
  `visibleAttentionReasons(run)` directly in the list row, with an explicit
  in-code comment explaining the design: "'Needs attention' says something
  is wrong without saying what. The reason is already computed and already
  on the run, so show it — that is the difference between a list you can
  triage and one you have to open row by row." This matches commit
  `c3164287` ("fix(runs): make the run list triageable, #1334"), which is
  already on `develop` as of this branch.
- **What it costs the user:** Nothing, currently. This is a correction to
  the catalog, not a live redundancy: the exact gap the catalog describes
  was closed by a recent, already-merged fix.
- **Recommendation:** None for the product. Flag to whoever maintains
  `catalog.md` that this bullet is stale and should be dropped or updated
  on the next regeneration.
- **Effort:** small

### F-010 — The canonical run-detail page can show "Live streaming" next to a stale attention badge

- **Verdict:** differentiate
- **Stories:** STORY-130
- **Evidence:** `apps/web/app/runs/background-agent/[runId]/page.tsx:29`
  renders `BackgroundRunDetail` with `variant="canonical"`, which wraps its
  content in `RunDetailShell` (`apps/web/app/background-runs/[runId]/background-run-detail.tsx:580-599`).
  `RunDetailShell`'s proof-strip table (`apps/web/app/runs/run-detail-shell.tsx:83-90`)
  renders `summary.attentionReasons` from the server-computed data fetched at
  page load. Independently, `BackgroundRunDetail` maintains its own
  client-side SSE connection state and renders `STREAM_STATUS_LABELS.live`
  = `"Live streaming"` (`apps/web/app/background-runs/[runId]/background-run-detail.tsx:272-278,397`)
  once the socket connects — a value that updates continuously after mount
  and is not reconciled with the page-load snapshot.
- **What it costs the user:** A run that stalled after its last event can
  show a green "Live streaming" label (because the SSE socket itself is
  healthy) two lines above an "Attention: stale" row (because the last
  known application state hasn't changed in a while) — literally the
  contradiction the catalog describes, still present in the current code.
  A user reasonably reads "live" as "this is working."
- **Recommendation:** Either suppress the "Live streaming" label when the
  underlying run is independently flagged `stale`, or relabel it to
  something that doesn't imply progress (e.g. "Connected" vs. "Live") so it
  can't be read as a health signal.
- **Effort:** small

### F-011 — "Warning" and "Unknown" run health share the same badge color

- **Verdict:** differentiate
- **Stories:** STORY-139
- **Evidence:** `apps/web/lib/runs/types.ts:22` defines
  `RunHealth = "ok" | "warning" | "needs_attention" | "unknown"` — four
  distinct values. `apps/web/app/runs/runs-list.tsx:61-72` styles the health
  badge with only a two-way ternary: `needs_attention` gets destructive
  (red) styling, and *everything else non-`"ok"`* — including both
  `warning` and `unknown` — gets the same amber styling. The text label
  (`titleCase(run.health)`) does distinguish "Warning" from "Unknown" now,
  which partially resolves the catalog's original claim, but the color
  coding still can't.
- **What it costs the user:** Scanning a long list of amber badges by color
  (the fast way people actually triage), a user can't tell a known, mild
  warning apart from a genuinely unrecognized status without reading each
  badge's text individually.
- **Recommendation:** Give `unknown` its own tone (e.g. neutral gray, since
  it's an absence of information rather than a graded severity) distinct
  from `warning`'s amber.
- **Effort:** small

### F-012 — The sandbox timeout-extend endpoint has no caller anywhere in the app

- **Verdict:** merge
- **Stories:** STORY-147
- **Evidence:** `apps/web/app/api/sandbox/extend/route.ts:1-128` is a fully
  implemented endpoint (20-minute grant, rate-limited to 3/min). A
  repo-wide search for any `fetch`/call to `/api/sandbox/extend` from
  `apps/web` turns up nothing outside the route file itself. The only way a
  user can actually extend total sandbox lifetime today is indirectly, by
  keeping the chat session active.
- **What it costs the user:** A user staring down a long-running task with
  a sandbox about to time out has no UI to reach for — the mechanism built
  to solve exactly that problem is unreachable. They're left with the
  workaround (send a message to keep it alive) with no idea that's the
  intended path, because the "real" solution isn't wired to anything.
- **Recommendation:** Either wire a caller into the UI (e.g. a button next
  to the sandbox timeout warning) or remove the dead endpoint if it was
  superseded by the keep-alive approach on purpose.
- **Effort:** medium

### F-013 — "Connection issue" is shown twice with mismatched color logic, and part of it is dead code

- **Verdict:** differentiate
- **Stories:** STORY-150
- **Evidence:** `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx:3596`
  computes `_sandboxUiStatus.label = "Connection issue"` when
  `reconnectionStatus === "failed"`, and this single label value is passed
  to both the Sandbox Activity dialog's trigger button and its header badge
  (line 5075). Separately, `_sandboxUiStatus.className` is computed
  (nine possible tone classes) but a repo-wide grep for
  `_sandboxUiStatus.className` finds no render site that ever applies it —
  it is dead code. The badge's actual color comes from `resolveTone()`
  (`apps/web/app/sessions/[sessionId]/chats/[chatId]/sandbox-activity.ts:177-198`),
  which reads `lifecycleState`, not `reconnectionStatus`. Because the label
  and the color are driven by two different signals, a state where
  `reconnectionStatus === "failed"` but `lifecycleState !== "failed"` shows
  the red-sounding label "Connection issue" with a non-red badge tone.
- **What it costs the user:** The trigger button and dialog badge showing
  the same text is fine (that's a legitimate reuse, not the problem here);
  the problem is that the label and the visual severity it implies can
  point in different directions, so the badge's color can't be trusted to
  match what the text says.
- **Recommendation:** Delete the unused `_sandboxUiStatus.className` field,
  and make `resolveTone()` read the same signal (`reconnectionStatus`, not
  just `lifecycleState`) that drives the "Connection issue" label, so text
  and color always agree.
- **Effort:** small

### F-014 — "Hibernating" and runtime-profile mismatches are computed independently on every surface that shows them

- **Verdict:** merge
- **Stories:** STORY-154, STORY-155, STORY-156
- **Evidence:** Four surfaces show a "Hibernating" state — the status pill
  and "Start dev server" tooltip both read `isHibernatingUi`
  (`apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx:3569-3571,4025`);
  the Sandbox Activity dialog badge reads `summary.tone` from
  `resolveTone()`, which reads `lifecycleState`
  (`apps/web/app/sessions/[sessionId]/chats/[chatId]/sandbox-activity.ts:177-198,241-248`);
  the Runtime Inspector reads observability events independently. No shared
  selector/hook computes this once. Separately, a managed-runtime profile
  mismatch (requested vs. resolved profile) *is* shown outside the Runtime
  Inspector — `RuntimeStatusBadge`
  (`apps/web/app/sessions/[sessionId]/chats/[chatId]/runtime-status-badge.tsx:51-60,145-150`)
  renders it in the session header, which corrects the catalog's claim that
  it's "only surfaced in the Runtime Inspector." It is still absent from the
  pill, the Sandbox Activity dialog, and startup logs.
- **What it costs the user:** Three to four independent computations of
  overlapping-but-not-identical inputs create latent risk that "Hibernating"
  shows on one surface a beat before or after another, or that a profile
  mismatch is visible in the header badge but silent everywhere else a user
  might be looking (the dialog, the logs).
- **Recommendation:** Extract one shared hook/selector for sandbox
  lifecycle-derived UI state (hibernating, connection issue, profile
  mismatch) that every surface reads from, rather than each recomputing it.
- **Effort:** medium

### F-015 — GitHub-install approval-pending status looks different depending where you check it

- **Verdict:** differentiate
- **Stories:** STORY-020
- **Evidence:** `apps/web/app/get-started/github-status-notice.tsx:49` shows
  an explicit "Installation approval pending" notice when
  `status === "request_sent"`. `apps/web/app/settings/accounts-section.tsx`
  shows the same org as an `installStatus: "not_installed"` row with a plain
  "Install" button — there is no distinct "pending" label on the settings
  page.
- **What it costs the user:** A user who already requested installation and
  checks `/settings/connections` sees the same "not installed, click to
  install" UI they'd see if they'd never asked — nothing distinguishes
  "waiting on your admin" from "you haven't started." They may click
  Install again, generating a duplicate request or confusion about whether
  their first request went through.
- **Recommendation:** Have `/settings/connections` read and display the
  same `request_sent`/pending state that `/get-started` already computes,
  instead of collapsing it into the generic `not_installed` row.
- **Effort:** small

### F-016 — Sign-out is one action reached three ways, executed by two different mechanisms

- **Verdict:** merge
- **Stories:** STORY-031
- **Evidence:** The avatar menu (`apps/web/components/user-avatar-dropdown.tsx:56`)
  and the settings shell's nav (`apps/web/app/settings/layout.tsx:130,169`,
  rendered for both expanded and collapsed nav) both call a server action
  `signOut`. The mobile "Me" tab (`apps/web/components/mobile/me/mobile-me-screen.tsx:27`)
  calls the client method `authClient.signOut()` directly — a different
  code path for the same user-facing action.
- **What it costs the user:** The three *entry points* (desktop nav, settings,
  mobile) are fine — they're genuinely different contexts. The two
  *mechanisms* underneath are the actual problem: any behavior that lives in
  the server action (extra cleanup, cookie handling, redirect logic) is not
  guaranteed to also happen on mobile, since it goes through a different
  code path for what should be one operation.
- **Recommendation:** Route the mobile sign-out through the same server
  action the other two surfaces use, or confirm and document that the
  client method is intentionally equivalent.
- **Effort:** small

### F-017 — The home page can start a session without the onboarding check `/sessions` enforces

- **Verdict:** merge
- **Stories:** STORY-026
- **Evidence:** `apps/web/app/sessions/layout.tsx:25` calls
  `requireOnboarded()`, redirecting an unboarded user to `/get-started`.
  The home page (`apps/web/app/page.tsx`, redirecting authenticated users to
  a `HomePage` that renders the repo picker/`SessionStarter`) does not call
  this gate at all.
- **What it costs the user:** A user can bypass the onboarding flow
  entirely by starting a session from the home page — skipping whatever
  setup the gate exists to enforce (GitHub connection, App install, etc.) —
  and only discover the missing prerequisite later, mid-session, when
  something that depends on it fails.
- **Recommendation:** Apply `requireOnboarded()` (or an equivalent check)
  consistently to both entry points, since they lead to the identical
  outcome (a new session).
- **Effort:** small

### F-018 — Four entry points create a session, but quick actions hide choices the full dialog exposes

- **Verdict:** differentiate
- **Stories:** STORY-157, STORY-158, STORY-159, STORY-160, STORY-161, STORY-168, STORY-169, STORY-170
- **Evidence:** The sidebar's quick-chat button
  (`apps/web/components/inbox-sidebar-new-chat.ts:13-20`) sends
  `{isNewBranch: false, sandboxType: "vercel", autoCommitPush: false,
  autoCreatePr: false}` with no repo fields. The sidebar's per-repo `+` icon
  and branch icon (`apps/web/app/sessions/sessions-route-shell.tsx:298-347`)
  send `{repoOwner, repoName, isNewBranch, ...preferences.defaultSandboxType,
  preferences.autoCommitPush, preferences.autoCreatePr}` — silently applying
  the user's saved preferences. The repository-dashboard button
  (`apps/web/app/repos/[owner]/[repo]/repository-new-session-action.tsx:19`)
  and the full `SessionStarter` dialog (`apps/web/components/session-starter.tsx:41-60`)
  reach the same server payload shapes, but the dialog makes runtime mode,
  Vercel sync, and git defaults visible and editable before submit; the
  quick actions do not show any of that, they just apply saved defaults.
- **What it costs the user:** All four converge on 2-4 outcomes, which is
  fine — the actual cost is that the two fast paths (sidebar quick-chat,
  sidebar `+`/branch icon) silently use whatever the user's saved
  preferences currently are, with no visibility into what those are at the
  moment of the click. A user who changed their default sandbox type last
  week and forgot may be surprised what a quick action produces, with no way
  to see it was coming.
- **Recommendation:** Keep all four entry points (they serve genuinely
  different moments), but surface a one-line summary of what the quick
  actions will use (e.g. a tooltip: "Uses your saved defaults — classic
  runtime, auto-commit off") so the silent substitution is visible.
- **Effort:** small

### F-019 — `lastRepo` pre-seeds the session dialog, but the wrong tab still shows first

- **Verdict:** differentiate
- **Stories:** STORY-160
- **Evidence:** `apps/web/app/sessions/layout.tsx:26,35` calls
  `getLastRepoByUserId` (`apps/web/lib/db/last-repo.ts:9-29`) and passes it
  down. `apps/web/components/session-starter.tsx:68,76-80` uses it to seed
  `selectedOwner`/`selectedRepo` state invisibly — but the dialog's visible
  tab still defaults to "Standalone session," so a returning user with a
  clear repo habit has to notice and click over to "Repository session" to
  see that their repo was, in fact, already selected underneath.
- **What it costs the user:** One extra click that looks unnecessary once
  you notice the pre-seeded state was there all along — reads as the app
  "forgetting" a preference it actually remembered.
- **Recommendation:** When `lastRepo` is present, default the visible tab to
  "Repository session" instead of "Standalone."
- **Effort:** small

### F-020 — PR number, diff stats, and branch name are read from independently-mutated state and can disagree for a few seconds

- **Verdict:** merge
- **Stories:** STORY-074 (cross-surface duplication)
- **Evidence:** `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx:681-710`
  shows `updateSessionPullRequest` writing to two independent state
  containers on every git action: local `setSessionRecord` (lines 683-687)
  and the SWR cache for `/api/sessions` (lines 689-707). Lines 712-760 show
  a separate `checkBranchAndPr` call that re-fetches and updates both
  sources again. PR status/number is rendered from these sources
  independently in the git panel top-bar chip, the PR tab's
  `InlineMergePanel`, the session header's contextual button, and synthetic
  `data-pr` chat messages. Diff stats (file-count badge, full toolbar
  stats, GitHub's PR-tab numbers) and branch name (commit panel, git status
  hook, download-diff filename, PR readiness response) are similarly shown
  from separate reads rather than one shared value.
- **What it costs the user:** The catalog's characterization — "can
  disagree for a few seconds after any git action" — holds up: these are
  genuinely independent writes, not one write fanning out. A user watching
  two of these surfaces at once (e.g. header button + PR tab) after
  clicking Merge can see them settle at different times, which reads as
  the app being unsure whether the merge worked.
- **Recommendation:** Consolidate PR/diff/branch state into one hook that
  every consuming surface subscribes to, so a single update always reaches
  all four displays atomically instead of four separate writers.
- **Effort:** medium

### F-021 — Composio integration status is shown twice on the same settings page

- **Verdict:** merge
- **Stories:** STORY-126
- **Evidence:** `apps/web/app/settings/repositories/[owner]/[repo]/repo-settings-section.tsx:624`
  displays a read-only "Integrations" group (GitHub/Vercel/Composio rows)
  and line 659 separately mounts `ComposioWorkspaceSettingsPanel` — the same
  component used from the active chat session's workspace settings — with
  its own "Tool access" chip list. Both status displays are built from the
  same `getRepoToolkitStatusCopy` helper.
- **What it costs the user:** Two groups on one page, built from the same
  underlying data, framed differently (a summary row vs. a chip list) with
  no visual link between them — a user has to infer they're describing the
  same integration rather than two different things.
- **Recommendation:** Fold the read-only "Integrations" summary into the
  same section as the "Tool access" panel, or clearly subordinate one to
  the other (e.g. "Tool access" as an expandable detail under each
  Integrations row) so they read as one piece of information, not two.
- **Effort:** small

### F-022 — Tool access is configurable in three places that don't all edit the same field

- **Verdict:** differentiate
- **Stories:** STORY-179, STORY-184
- **Evidence:** `ComposioWorkspaceSettingsPanel` is genuinely the same
  component in repo settings (`apps/web/app/settings/repositories/[owner]/[repo]/repo-settings-section.tsx:659`)
  and the in-session workspace settings panel — that part is a legitimate,
  low-risk reuse. Separately, `/settings/composio` manages Composio
  *profile-level* auth configs, which is a conceptually related but
  distinct field from the repo-level block/allow list.
- **What it costs the user:** Three surfaces that all sound like "tool
  access" but only two of them (repo settings, session workspace) actually
  edit the same setting; the third (Composio profiles) is a different
  layer entirely (which tools *can* connect at all, vs. which are
  allowed for this repo). A user toggling something in Composio settings
  reasonably expects it to be reflected in the repo's tool-access list, and
  it may not be.
- **Recommendation:** Label the three surfaces by what they actually
  control ("Connected tools," "This repo's tool access," "This session's
  tool access") rather than letting them all read as "tool access"
  generically.
- **Effort:** small

### F-023 — Two unrelated skill mechanisms exist with no visible relationship

- **Verdict:** differentiate
- **Stories:** STORY-182
- **Evidence:** `/settings/skills` (`apps/web/app/settings/skills/page.tsx`)
  lets a user author local skills via a "Create Skill" dialog.
  `/settings/preferences` (`apps/web/app/settings/preferences-section.tsx`)
  has a separate "Skills" section for global skill pointers (repository
  source + skill name) to skills defined in a connected repo. These are two
  distinct CRUD paths for two distinct kinds of "skill," with nothing on
  either page pointing to the other.
- **What it costs the user:** A user looking for "where do I manage skills"
  has a 50/50 chance of landing on the page that doesn't have what they
  want, with no cross-link to the other one.
- **Recommendation:** Add a one-line cross-reference on each page ("Looking
  for skills defined in a repo? See Preferences." / "Looking to author a
  new local skill? See Skills.") so a user who lands on the wrong one isn't
  stuck.
- **Effort:** small

### F-024 — The archived-session lockout scatters what the MCP run lock keeps together

- **Verdict:** differentiate
- **Stories:** STORY-090, STORY-091
- **Evidence:** The archived-session overlay
  (`apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx:1050`)
  reads "This session is archived. Unarchive it to resume." — but the
  control to unarchive lives in the sidebar, not co-located with this
  message. A second string, "Archived sessions cannot run sandbox tools."
  (line 3621), explains the same archived state differently when a sandbox
  tool is attempted. By contrast, the MCP run lock
  (`apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-mcp-run-lock.tsx:110-115,132`)
  puts the reason ("This session is being driven by an MCP client...") and
  the resolving action ("Take over" button) in the same notice.
- **What it costs the user:** For the archived state, a user reads why
  they're locked out but then has to go find the unarchive control
  somewhere else in the UI — and may encounter a second, differently-worded
  explanation of the same lockout if they try a sandbox action first. The
  MCP lock shows this same product already knows how to do this well.
- **Recommendation:** Co-locate the unarchive action with the archived
  overlay's explanation, and use one string for "this session is archived"
  everywhere it's explained, following the MCP lock's own pattern.
- **Effort:** small

### F-025 — A missing session has no recovery boundary; a missing chat one level deeper does

- **Verdict:** differentiate
- **Stories:** STORY-084, STORY-085
- **Evidence:** `apps/web/app/sessions/[sessionId]/page.tsx:22-24` calls
  `notFound()` with no `not-found.tsx` in the `[sessionId]` directory, so a
  deleted/invalid session ID falls through to Next.js's generic unbranded
  404. `apps/web/app/sessions/[sessionId]/chats/[chatId]/not-found.tsx`
  exists and renders a dedicated `ChatNotFound` boundary with a "Chat not
  found" message and a "New Chat" button.
- **What it costs the user:** The exact same class of failure (dangling ID)
  gets a designed recovery path one level of the URL deeper, but not at the
  session level — a user who follows a stale session link (a bookmark, a
  shared link, a deleted session) lands on a generic Next.js page with no
  branding and no path back into the product.
  **This is a top-3 offender** (see below).
- **Recommendation:** Add a `not-found.tsx` for the `[sessionId]` route that
  mirrors the chat-level boundary's pattern — explain what happened, offer
  a way back to the session list.
- **Effort:** small

### F-026 — Rate-limit retry-after is computed and sent twice, then discarded by every caller

- **Verdict:** merge
- **Stories:** STORY-094
- **Evidence:** `apps/web/lib/rate-limit.ts:81-84` and
  `apps/web/lib/api/error-response.ts:79-86` compute `retryAfterSeconds` and
  send it both as a JSON body field *and* the HTTP `Retry-After` header.
  `apps/web/lib/api/read-api-error.ts:60,69-73` parses `retryAfterSeconds`
  out of the response — but the caller found
  (`apps/web/app/settings/skills/skill-editor-dialog.tsx:124-125`) does
  `toast.error(readApiError(data, ...).message)`, reading only `.message`
  and discarding the parsed retry time entirely.
- **What it costs the user:** The server correctly computes exactly how
  long to wait and sends it twice, redundantly, for reliability — and the
  client throws both copies away. A user rate-limited on skill generation
  sees "Too many requests" with no indication of when to try again, despite
  the app having that answer on hand.
- **Recommendation:** Use the already-parsed `retryAfterSeconds` in the
  toast/error copy (e.g. "Too many requests — try again in 12s") wherever
  `readApiError` is consumed for a rate-limit response.
- **Effort:** small

### F-027 — The ProductJourney checklist doesn't actually show a "GitHub connected" status

- **Verdict:** keep
- **Stories:** STORY-019
- **Evidence:** The catalog claims "GitHub connected" status is shown on
  three surfaces: get-started, `/settings/connections`, and the
  `ProductJourney` checklist. The first two are confirmed
  (`apps/web/app/get-started/get-started-flow.tsx:249` shows the checkmark;
  `apps/web/app/settings/accounts-section.tsx:722-726` shows the
  disconnected-state warning). `components/product-journey.tsx` and
  `lib/product-journey.ts`, however, render a static four-step checklist
  with no dynamic status indicators at all — this third claim doesn't hold.
- **What it costs the user:** Nothing from a third redundant surface,
  because it doesn't exist as described. The two real surfaces
  (get-started, settings) are showing the same fact in two places a user
  would reasonably check separately (during onboarding vs. later review),
  which is a legitimate use of duplication.
- **Recommendation:** None for the product; correct the catalog's
  ProductJourney claim on its next regeneration.
- **Effort:** small

### F-028 — Files vs. Changes tab: less duplication than claimed, but mobile silently overrides the diff-style preference

- **Verdict:** differentiate
- **Stories:** STORY-067
- **Evidence:** The catalog claims both the Files tab and the Changes tab
  call `openDiffToFile(path)` and land in the same `DiffTabView`. In the
  current code, the Changes tab does call `openDiffToFile(file.path)`
  (`apps/web/app/sessions/[sessionId]/chats/[chatId]/git-panel.tsx:229`),
  but the Files tab calls `openFileTab(filePath)` (line 1965), landing in a
  different `FileTabView` — these are not the same destination. What *is*
  confirmed: `apps/web/app/sessions/[sessionId]/chats/[chatId]/diff-tab-view.tsx:281-287`
  unconditionally forces `diffStyle = "unified"` on mobile regardless of the
  user's saved `preferences.defaultDiffMode`.
- **What it costs the user:** Little from the tabs themselves — they're
  legitimately different views for different purposes (browsing files vs.
  reviewing a diff), not a redundancy. The real cost is narrower: a user
  who set their diff preference to split view on desktop gets silently
  switched to unified on mobile with no explanation, which reads as the
  setting not being saved rather than an intentional mobile constraint.
- **Recommendation:** Correct the catalog's claim about the two tabs
  converging. For the mobile override, add a one-line note near the diff
  view on mobile ("Split view isn't available on small screens") so it
  reads as a deliberate constraint, not a bug.
- **Effort:** small

### F-029 — Mobile session creation intentionally omits desktop's advanced options

- **Verdict:** keep
- **Stories:** STORY-113
- **Evidence:** Desktop's `SessionStarter`
  (`apps/web/components/session-starter.tsx`) includes a runtime-mode
  picker (lines 105-117), Vercel project sync, and a full/shallow clone
  toggle. Mobile's `MobileNewSessionScreen`
  (`apps/web/components/mobile/new/mobile-new-session-screen.tsx:104-553`)
  has only a task field, suggestion chips, a chat/repo mode toggle, repo and
  branch pickers, and two "Advanced" switches (auto-commit, auto-PR) — no
  runtime picker, no Vercel selector, no clone toggle.
- **What it costs the user:** Nothing detected. This is exactly the case
  the brief warns against over-flagging: a deliberately reduced form for a
  phone-sized, time-constrained context. The gap doesn't strand a mobile
  user — it just doesn't expose settings that are awkward to configure on a
  small screen and default sensibly instead.
- **Recommendation:** None. If mobile users start asking for one of the
  missing controls specifically (e.g. runtime mode), add it individually
  rather than porting the whole desktop form.
- **Effort:** small

### F-030 — Two independent self-heal paths for a failed sandbox

- **Verdict:** keep
- **Stories:** STORY-152
- **Evidence:** `apps/web/app/api/sandbox/status/route.ts:76-85` (periodic
  poll) and `apps/web/app/api/sandbox/reconnect/route.ts:242-252` (on
  mount) each independently detect `lifecycleState === "failed"` and repair
  it to `"active"`.
- **What it costs the user:** Nothing observed — both paths repair the same
  condition the same way, silently and fast, so a user is unlikely to ever
  see the redundancy directly. Two independent recovery paths for a failure
  mode is a reasonable reliability choice (either one being unavailable
  still leaves the other), not wasted duplication.
- **Recommendation:** None functionally; if the two implementations ever
  need to diverge (e.g. one adds a new repair step), keep them
  synchronized deliberately rather than by accident.
- **Effort:** small

### F-031 — Runtime profile, model, and git defaults have a real, visible override hierarchy

- **Verdict:** keep
- **Stories:** STORY-172, STORY-183, STORY-184, STORY-166, STORY-158, STORY-165, STORY-176
- **Evidence:** `apps/web/app/settings/preferences-section.tsx:562-630`
  sets the account-level default runtime profile.
  `apps/web/app/settings/repositories/[owner]/[repo]/repo-settings-section.tsx:389-430`
  shows the per-repo override with a visible "Inherited" tag when unset and
  a reset control, backed by `state.managedRuntimeProfileId ??
  resolved.managedRuntimeProfileId` (lines 398-399). Git defaults
  (auto-commit/push, auto-PR) follow the same pattern:
  `apps/web/components/mobile/new/mobile-new-session-screen.tsx:212-215`
  resolves `explicit ?? repoDefaults?.X ?? preferences.X`. The session
  dialog's runtime-mode radiogroup is always visible
  (`session-starter.tsx:105-117`), not silently defaulted. Model
  enabled/disabled state writes one shared field
  (`preferences.enabledModelIds`) from both the profile-card "Models"
  button and the page-wide list.
- **What it costs the user:** Nothing detected — this is precedence done
  right: explicit choice beats repo default beats account default, the
  fallback is visible via the "Inherited" tag rather than silent, and the
  underlying storage field is shared rather than duplicated per surface.
- **Recommendation:** None. Worth using as the reference pattern the next
  time a new per-repo/per-account override is added elsewhere in the
  product (compare to F-022's less clearly-labeled tool-access surfaces).
- **Effort:** small

### F-032 — Public surfaces reuse authenticated-view logic by construction

- **Verdict:** keep
- **Stories:** STORY-101, STORY-102, STORY-106, STORY-110, STORY-111
- **Evidence:** The shared-chat view
  (`apps/web/app/shared/[shareId]/shared-chat-content.tsx:23,529-531`)
  imports and renders the identical `AssistantMessageGroups`, `ToolCall`,
  and `ThinkingBlock` components the authenticated chat view uses, just
  non-interactive. The identical `redactSharedEnvContent` function
  (`apps/web/app/shared/[shareId]/redact-shared-env-content.ts`) is applied
  to both the HTML share page
  (`apps/web/app/shared/[shareId]/page.tsx:96`) and the markdown export
  (`apps/web/app/api/shared/[shareId]/markdown/route.ts:197-199`). The same
  `SCOPE_DESCRIPTIONS` map and `McpConsentPanel` component render both the
  MCP approval and decline screens
  (`apps/web/app/mcp/consent/mcp-consent-panel.tsx:6-13,56-58`), forced
  consistent by `forceMcpConsentPrompt`
  (`apps/web/lib/auth/mcp-consent-hook.ts:185-193`).
- **What it costs the user:** Nothing — this is the good version of
  "duplicate information, multiple surfaces." Because each pair shares one
  implementation rather than two independent ones, the two surfaces are
  *guaranteed* consistent (what a user sees redacted in the HTML share is
  guaranteed to match what's redacted in the markdown export; what a user
  reads before approving MCP access is guaranteed to match what they read
  before declining).
- **Recommendation:** None. This is the pattern F-002's two repo-creation
  dialogs and F-020's four independent PR-status writers should be moving
  toward, not away from.
- **Effort:** small

### F-033 — Three reconnect surfaces, one shared action

- **Verdict:** keep
- **Stories:** STORY-023
- **Evidence:** `GitHubReconnectGate`
  (`apps/web/components/github-reconnect-gate.tsx:26`, shown as a blocking
  modal on most pages), the settings dropdown's "Re-authenticate"
  (`apps/web/app/settings/accounts-section.tsx:416-418`), and the repo
  picker card's "Reconnect GitHub"
  (`apps/web/components/repo-selector-compact.tsx:308-317`) all call the
  same `startGitHubReconnect()` function. The blocking modal is explicitly
  suppressed on `/get-started` and `/settings/connections`, where an inline
  amber warning takes its place instead — they don't co-occur.
- **What it costs the user:** Nothing — three genuinely different moments
  (interrupted mid-task elsewhere in the app, deliberately checking
  settings, picking a repo) reach the same one action through the same one
  function, and the two *display* variants (modal vs. inline) are mutually
  exclusive by page rather than both showing at once.
- **Recommendation:** None.
- **Effort:** small

### F-034 — Failed and stalled runs have both a full triage view and a contextual shortcut

- **Verdict:** keep
- **Stories:** STORY-128, STORY-141, STORY-135
- **Evidence:** `/runs?view=attention`
  (`apps/web/app/runs/runs-list.tsx:18`) is the full, filterable triage
  view. `/automations`'s "Latest run" link
  (`apps/web/app/automations/automations-list.tsx:189-196`) is a shortcut
  that only shows the single most recent run for that automation. The
  per-loop "Stalled-runs summary" widget
  (`apps/web/app/loops/[loopId]/loop-detail.tsx:461-472`) is a similar
  contextual shortcut scoped to one loop.
- **What it costs the user:** Nothing — "shorter, but only shows the
  latest run" (the catalog's own words) is an accurate description of a
  deliberate tradeoff: a fast path for "is my thing OK right now" from
  where you're already looking, versus a comprehensive path for "show me
  everything that needs attention" when you're specifically triaging.
- **Recommendation:** None.
- **Effort:** small

### F-035 — Agents and loops are shown at three depths, not three redundant copies

- **Verdict:** keep
- **Stories:** STORY-118
- **Evidence:** The catalog names the combined view as `/project`; the
  actual route is repo-scoped:
  `apps/web/app/repos/[owner]/[repo]/project/page.tsx`. It is an explicitly
  condensed combined view; `/agents` and `/loops` (also repo-scoped
  standalone lists) show "the same underlying data with more depth per
  surface," per the catalog's own description, which this review did not
  find reason to dispute.
- **What it costs the user:** Nothing detected beyond the catalog's route
  name being imprecise (it's `/repos/{owner}/{repo}/project`, not a global
  `/project`). An overview page plus two dedicated drill-down pages is
  standard, reasonable information architecture, not accidental
  duplication.
- **Recommendation:** None for the product; correct the route name in the
  catalog.
- **Effort:** small

### F-036 — `/u/<username>` is a literal re-export of `/<username>`

- **Verdict:** redirect
- **Stories:** STORY-107
- **Evidence:** `apps/web/app/u/[username]/page.tsx:1` is exactly:
  `export { default, generateMetadata } from "../../[username]/page";` —
  both URLs render the identical server component with zero risk of
  drift, since one file is nothing but a re-export of the other.
- **What it costs the user:** Very little today (no drift is possible), but
  two crawlable, shareable URLs for the same public profile splits
  backlinks/bookmarks and is pure upside to fix at near-zero cost.
- **Recommendation:** Since one is trivially a re-export of the other,
  redirect `/u/<username>` to `/<username>` (or vice versa) for a single
  canonical URL. Given the code is already this close to identical, this is
  as close to a free fix as this critique found.
- **Effort:** small

## The three worst offenders

1. **F-002 — Two repo-creation dialogs post to two different endpoints.**
   Every other "duplicate route" finding in this critique turned out to be
   one implementation reached two ways — genuinely low risk, because a fix
   applied once reaches every entry point. This one is the exception: it's
   two *independent* implementations of the same user-facing action, and
   the catalog's own description of it (same endpoint) turned out to be
   wrong — it's worse than reported. A user's experience of "create a
   repository" depends on which dialog they happened to open, with no
   guarantee bug fixes or behavior changes to one ever reach the other.

2. **F-025 — A missing session has no recovery boundary; a missing chat one
   level deeper does.** This is the starkest before/after in the whole
   catalog: the exact same failure mode (dangling ID) is handled well one
   directory down and not at all one directory up. A user following a
   stale session link — the single most likely way anyone reaches this
   state — lands on a bare, unbranded Next.js 404 with no path back into
   the product, right where a designed recovery screen already exists as a
   template two clicks away in the codebase.

3. **F-003 — Actions and Secrets check the GitHub App's permission, not the
   user's own.** Unlike the routing findings above, this one is a trust
   problem, not a navigation one: the enabled/disabled state of a
   destructive control (run a workflow, add a secret) tells a specific
   signed-in user something false about what *they* can do. It fails
   silently at the point of action rather than the point of decision,
   which is exactly backwards for a permission boundary.

## What is fine as it is

- STORY-098: Sign-in CTA appears at the hero and the nav bar (revealed on
  scroll) — standard progressive disclosure, not confusing.
- STORY-029: Reconnect-after-disconnect via Settings or the `/sessions`
  onboarding redirect — legitimately different moments (deliberate check vs.
  blocked-action recovery).
- STORY-164: A stale GitHub connection is detected independently in session
  creation and Settings via the same `useGitHubConnectionStatus()` hook —
  duplicated detection, not duplicated logic, as the catalog itself notes.
- STORY-125, STORY-127: Repo settings reachable from the repo dashboard
  button or the `/settings/repositories` picker land on the exact same page.
- STORY-035: The builder's inline `RunTestConsole` result links out via
  "Open full run" to the full run-detail page — a summary plus a drill-down,
  not a duplicate.
- STORY-167: Vercel-sync deep-links ("Connect Vercel," "Repo settings")
  inside the session-creation form are helpful escape hatches, not
  redundant routing.
- STORY-175: Leaderboard rank on the Profile page and the Leaderboard page
  both revalidate the same SWR key, so they can't disagree.
- STORY-177, STORY-178: Model variant selection appears in four pickers
  (default, subagent, per-role, system-prompt) because those are four
  genuinely different configuration targets, not one setting shown four
  times.
- STORY-148: The "Start dev server" tooltip and the code editor tooltip
  share identical `runtimeToolsDisabledReason` text — consistent messaging
  for the same underlying cause, not confusing duplication.
- STORY-051: A run's outcome shows detailed text in the chat transcript and
  a generic badge in the `/runs` feed; the feed's `detailUrl` points back to
  the same chat, so there's one source of truth behind two display styles.
- STORY-065, STORY-112: The MCP composer lock and the mobile tool-approval
  bar both drive off the same `activeRunSource`/`addToolApprovalResponse`
  state as desktop — shared decision logic, mobile-specific chrome only.
- STORY-066: The git panel keyboard shortcut and header button both call
  the same `handleGitPanelToggle` — no divergence risk.
- STORY-072: "Discard all" and per-file discard both route through the same
  `handleDiscardChanges` handler, differing only in whether a `filePath` is
  set.
- STORY-078: The panel's "Fix conflicts" and the header's "Resolve
  Conflicts" both send effectively the same instruction to the agent.
- STORY-081: The panel's merge button and the header's "Merge PR" button
  both call the same underlying `mergePr` action.

## Not confirmed

- **STORY-181** — "MCP server tools" are described in the source as
  "becoming available in chats in an upcoming update." This describes a
  planned future state, not a redundancy that exists in the product today;
  this review did not find (and would not expect to find) code for a
  not-yet-shipped feature, so it's excluded from verdicts rather than
  reported as a live overlap.
- **STORY-183** — The claim that the main Chat role's "Session
  coordinator" label overlaps with Background Agents/Agent Loops because
  "webhook and scheduled coding work lives in Automations" is a conceptual
  framing point from the story's prose, not a specific route, component, or
  field this review could open and check. No file or line could be pointed
  to as confirming or refuting it.
- **STORY-015** — The claim that a retry-budget counter is shared between
  failure-watchdog invocations and stall-sweep invocations ("the same
  shared per-node counter... stall-triggered retries count against it
  too") describes internal scheduling/backend state rather than a
  user-visible route or display. This review did not trace the relevant
  backend counter logic and cannot confirm or refute it from the
  `apps/web/app` surfaces examined.
- **STORY-172/183/184 (partial)** — The account-default and per-repo levels
  of the runtime-profile/model override hierarchy are confirmed in F-031.
  The specific claim that a *per-Chat-role* override exists as its own
  settings surface was not independently located as a distinct page or
  component during this review; it may exist under a name not searched for,
  or it may be a planned/prose-only distinction. Treat the per-role layer
  in F-031 as unconfirmed pending a direct look at the Chat-role settings
  UI.
