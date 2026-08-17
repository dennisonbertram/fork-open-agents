# Background Agents — UX Path Stories

> Generated from a direct code read of `apps/web/lib/background-agents/*`,
> `apps/web/app/repos/[owner]/[repo]/agents/*`, `apps/web/app/automations/*`,
> `apps/web/app/api/background-agents/*`, and `apps/web/lib/repository-allowlist.ts`.
> Every field name, trigger kind, status value, and skip-reason string below is
> copied from source, not invented. Line-level citations are in-line so a
> reviewer can re-check any claim.

## STORY-601: First Agent, Repo-Scoped Builder

**Type**: medium
**Topic**: Background Agents
**Persona**: Priya, a solo maintainer of a mid-size open-source repo who wants a bot that summarizes new pull requests so reviewers don't have to read the whole diff cold.
**Goal**: Create a background agent bound to her repo that comments a summary on every opened PR.
**Preconditions**: Signed in, GitHub App installed on the target repo, `BACKGROUND_AGENTS_ENABLED=true`.
**Ideal path**: 1 — `/repos/[owner]/[repo]/agents` is the natural entry point when she's already looking at her repo; "New agent" is the primary button (`repo-agents-dashboard.tsx`).

### Steps
1. Priya opens `/repos/priya-org/widgets/agents` → sees "Configured agents" empty state ("No agents configured for this repository.") and a "Recent runs" empty state.
2. Clicks **New agent** → lands on `/repos/priya-org/widgets/agents/new`, subtitle reads "New agents start off — save, test, then turn on."
3. Picks the **PR Backlog Maintainer** template from `TemplatePicker` (one of five named templates in `agent-templates.ts`, trigger kind `github.pull_request`) → `AgentSpecEditor` mounts pre-filled.
4. Edits the **Name** field and the merged **"What should this agent do?"** textarea (goal + instructions combined once on mount — see STORY-605 for what happens on a later edit).
5. Leaves trigger kind on "A pull request changes" (`github.pull_request`) → conditions collapsed under "Refine when it runs".
6. In **Tools**, picks GitHub access level "Read-only" on the `GitHubToolCard` (contents:read, pullRequests:read) — she only wants comments, not pushes.
7. In **GitHub actions**, leaves the template's default toggles as-is: the PR Backlog Maintainer template ships with only `githubActions: { comment_on_pr_or_issue: true }` — no `open_pull_request` — which matches exactly what she wants (comment-only, no write access needed).
8. Clicks **Save** → `POST /api/background-agents` with `status: "disabled"` (the Enable/Disable segmented control defaults to Disabled) → toast "Agent created successfully." → page stays put (no navigation) and now shows "View agent" plus the **Run a test** button becomes enabled.
9. Detail page confirms: Status pill "Paused" (the UI's word for `disabled`), Instructions section, Trigger section showing `github.pull_request` badge + human label "On pull request" (`formatTriggerLabel`), Permissions section listing `contents: read`, `pullRequests: read`, `issues: read`.

### Variations
- Same builder is reachable at `/automations/new?repoOwner=&repoName=` with `surface="automation"` — see STORY-613 for how the two surfaces relate.
- "Create with AI" instead of "New agent" — see STORY-602; it does not actually reach this flow's prefill.

### Edge Cases
- `runBudgetPerTarget` is never shown or asked for in this form — the server silently applies its schema default of 10 (`createBackgroundAgentSchema`, `apps/web/lib/background-agents/types.ts`). Priya has no way to see or change this number from any UI she used.
- The `description` field the DB row actually stores is never written by this form at all — the editor only takes a merged "goal" that gets folded into `instructions` once and then forgotten (see STORY-605).

---

## STORY-602: "Create with AI" Prompt Goes Nowhere

**Type**: short
**Topic**: Background Agents
**Persona**: Marcus, a backend engineer who wants to skip picking a template and just describe the agent he wants in his own words.
**Goal**: Type "watch for failing CI on main and auto-comment with the failing job name" and get a pre-filled agent to review.
**Preconditions**: On `/repos/marcus-inc/api/agents`.
**Ideal path**: 1 — the "Create with AI" button is presented right next to "New agent" as an equally valid, faster path (`repo-agents-dashboard.tsx`).

### Steps
1. Marcus clicks **Create with AI** → a `Dialog` opens with a `Textarea`.
2. Types his description, clicks the submit action → `router.push('/repos/marcus-inc/api/agents/new?ai=true&prompt=<encoded>')`.
3. The destination page, `apps/web/app/repos/[owner]/[repo]/agents/new/page.tsx`, never reads `searchParams` at all — it renders `<NewAgentBuilder owner repo />` with no `ai`/`prompt` prop.
4. `NewAgentBuilder` and everything it mounts (`new-agent-builder.tsx`) never reference `useSearchParams`, `ai`, or `prompt` anywhere in the component tree.
5. Marcus lands on the exact same blank `TemplatePicker` he'd have seen clicking plain "New agent" — his typed description is gone, with no error, no loading state, no partial fill.

### Variations
- None found — this is a single, deterministic dead code path, not a race or a flag gate.

### Edge Cases
- Marcus assumes the AI needs a moment and waits on the template picker; nothing ever changes. He has no way to know his prompt was received and discarded rather than still "thinking."
- If he types the identical description into the free-text "What should this agent do?" textarea by hand after picking a template, that part of his intent is fully honored — only the AI-assist entry point itself is a no-op.

---

## STORY-603: The Agent That Never Runs (Repository Allowlist)

**Type**: long
**Topic**: Background Agents
**Persona**: Dana, a platform engineer standing up background agents for her company's monorepo split across `acme/api`, `acme/web`, and `acme/infra`. She's rolling this out repo by repo.
**Goal**: Ship an agent on `acme/infra` that reviews Terraform PRs, confident it's live because every check she looked at was green.
**Preconditions**: `BACKGROUND_AGENTS_ENABLED=true`; `BACKGROUND_AGENTS_ALLOWED_REPOS` is a `list`-state value (`lib/repository-allowlist.ts`) that includes `acme/api` and `acme/web` — added when those two shipped first — but not `acme/infra`.
**Ideal path**: none — every path she takes through the UI reports success; the omission is invisible by construction. This is the story the task explicitly asked for.

### Steps
1. Dana builds the agent at `/repos/acme/infra/agents/new`, trigger kind `github.pull_request`, GitHub access "Open pull requests" (write), `githubActions.comment_on_pr_or_issue: true`.
2. The readiness panel above the form (`ReadinessVerdict`, built from `GET /api/background-agents/readiness?repoOwner=acme&repoName=infra&permission=write`) shows **all checks ready**, including the "Repo allowlist" row. That row's `detail` text ("Dispatch is limited to N configured repositories.") is genuinely accurate about the *policy's existence* — but `getBackgroundAgentReadiness()` only checks `policy.state === "wildcard" || policy.state === "list"` (`readiness.ts`). It never checks whether `acme/infra` specifically is one of the listed entries. A `list` state with zero relevant entries reads exactly as ready as a `list` state that covers every repo she owns.
3. The client merges in a second, repo-specific `repoAccess` check (GitHub App installation + permission, `background-agent-readiness.ts`) — also green, because the App *is* installed on `acme/infra` with write access. That check has nothing to do with `BACKGROUND_AGENTS_ALLOWED_REPOS`.
4. Dana saves, then clicks **Enable**, saves again. Status pill flips to "Enabled."
5. She skips "Run a test" — she already trusts the all-green readiness panel and wants to see it work on a real PR.
6. A teammate opens a real PR against `acme/infra`. GitHub delivers a `pull_request` webhook to `/api/github/webhook`. The handler calls `dispatchBackgroundTriggerEvent`.
7. Inside the dispatcher, `getBackgroundAgentRepoAccess("acme", "infra")` resolves to `{ allowed: false, reason: "repo_not_allowlisted" }` — this check runs **before** `listMatchingTriggersForEvent` is even called (`dispatcher.ts` lines ~219-240). The function returns immediately: `matched: 0, created: 0, runIds: []`. No trigger row is touched. No run row is ever inserted.
8. The only trace of the refusal is a `console.info` from `warnBackgroundAgentRepoPolicyRefused` (chosen over `console.warn` specifically because `repo_not_allowlisted` is treated as routine, not alarming) and the `skipReason` field embedded in the webhook handler's HTTP response body — which goes back to GitHub's webhook delivery log, a surface Dana as a product user never opens.
9. On `/repos/acme/infra/agents`, the agent card still reads **"Never run"** (`deriveCardStatus` in `agent-card.tsx`) — indistinguishable from an agent that's simply never been triggered yet. The `AgentScheduleCard` that *would* show a `lastSkipReason` banner only renders for `schedule.cron` triggers (`scheduleTrigger = agent.triggers.find(t => t.kind === "schedule.cron")`); a `github.pull_request` trigger has no equivalent surface at all.
10. Two more PRs land over the following week. Same silent refusal each time.

### Variations
- If Dana had clicked **Run a test** at any point, `dispatchManualBackgroundAgentTest` runs the *same* `getBackgroundAgentRepoAccess` check and — unlike the real dispatch path — surfaces it plainly: the inline test alert reads *"This repository isn't allowlisted for background agents — check Background agent settings."* (`manual-test-feedback.ts`). The gap isn't that the system can't explain itself; it's that the explanation only fires on the path she didn't take.
- The codebase's own dispatcher.ts carries a comment describing this exact failure mode as a real production incident: "One production trigger was refused weekly from 2026-07-06 for six weeks without surfacing anywhere an operator looks" — that incident was about the *scheduled sweep's* cron response omitting `skipped` entries (since fixed by adding the `skipped` field to `BackgroundDispatchResult`), a narrower but related gap. The event-triggered path in this story has no equivalent fix; it never records a per-trigger skip reason at all.
- Loop-bound triggers (`match.trigger.loopId`) and the `webhook.error` path *do* call `recordTriggerSkipReason` on refusal — so the gap is specific to agent-bound `github.*` triggers on the primary GitHub-webhook dispatch path.

### Edge Cases
- **What Dana is thinking**: after a week of silence she assumes either (a) no Terraform PRs happened to open, or (b) the agent is just slow/queued somewhere. She has no error, no failed run, no red status to investigate — nothing prompts her to doubt the allowlist specifically, because the allowlist is the one thing every UI she looked at told her was fine.
- If she eventually clicks **Run a test** out of general curiosity, she gets the correct, actionable message immediately — the fix is one click away the whole time, she just never had a reason to take it.
- An operator who *does* have log access sees the `background-agent.dispatch.repo-policy-refused` structured log line with `policyState`, `reason`, `repoOwner`, `repoName` — full diagnostic detail exists, just not where Dana looks.

---

## STORY-604: Manual Test Console as the Sanity Check

**Type**: medium
**Topic**: Background Agents
**Persona**: Priya (from STORY-601), now wanting proof her new agent actually works before trusting it on real traffic.
**Goal**: Run a manual test and watch it execute inline without leaving the builder.
**Preconditions**: Agent saved (has an id), at least one enabled trigger.
**Ideal path**: 1 — "Run a test" sits directly in the action bar next to Save; it's the obvious next step after saving (`agent-spec-editor.tsx`).

### Steps
1. Priya clicks **Run a test** → button becomes "Starting test…" (`aria-busy`), a status line reads "Starting the manual test and waiting for the first run event…".
2. `POST /api/background-agents/{id}/test` → `dispatchManualBackgroundAgentTest`. Since her agent is currently disabled (new agents start off), the response is `{ matched: 0, created: 0, skipReason: "agent_disabled" }` (checked *before* any trigger match, specifically because "#743: a disabled agent must never run, even via the manual Test button").
3. The test alert renders: *"This agent is disabled — enable it above, then run the test again."* (`manualTestSkipMessages.agent_disabled`).
4. Priya flips **Enabled**, clicks **Save** again, then **Run a test** once more.
5. This time a run is created (`runIds: [runId]`) → `RunTestConsole` mounts inline below the action bar, polling via `useBackgroundRunPolling(runId)`.
6. Console header shows a live status indicator (spinner while `queued`/`running`, green check on `succeeded`, red X on `failed`/`cancelled`, plain text on `skipped`) plus an "Open full run" link to `/background-runs/{runId}`.
7. Body streams console-style lines: `[HH:MM:SS] <status> <eventName> <summary>`, newest at the bottom (API returns newest-first; the console reverses it).
8. Run reaches `succeeded`; polling stops (`TERMINAL_STATUSES = new Set(["succeeded","failed","skipped","cancelled"])`).

### Variations
- On the **automation surface** (`/automations/new`), "Run a test" is additionally gated on `persistedEnabled` — the copy explicitly says *"Enable and save this Automation before testing."* and warns: *"Manual tests use the real dispatcher and configured GitHub permissions. They can create configured GitHub mutations such as comments, branches, commits, pull requests, approvals, or merges."* This is not a sandboxed dry run — it is a real dispatch with real side effects.
- Zero enabled triggers → `skipReason: "no_enabled_trigger"` → *"This agent has no enabled trigger to test — add or enable one first."*
- Repo not allowlisted → same three allowlist skip messages as STORY-603, but here they're the correct outcome for the path taken.

### Edge Cases
- The console polls indefinitely while `isActive` is true; if the run truly hangs (e.g. sandbox never starts), there's no client-side timeout — only "Open full run" lets her escape to the fuller run-detail page.

---

## STORY-605: Editing — Write-Access Auto-Coercion and the Vanishing Description

**Type**: medium
**Topic**: Background Agents
**Persona**: Priya, six weeks later, deciding her PR-summary agent should also be allowed to open pull requests itself for a "auto-fix trivial lint" side mission.
**Goal**: Turn on `open_pull_request` for an existing read-only agent, then later reconsider and dial it back.
**Preconditions**: Existing agent from STORY-601, currently read-only (`contents: read`, `pullRequests: read`).
**Ideal path**: 1 — she edits the live agent directly rather than recreating it.

### Steps
1. Priya opens `/repos/priya-org/widgets/agents/{id}/edit`. `AgentEditForm` calls `buildFormFromAgent(agent)`, which restores `permissionContents`/`permissionPullRequests` from **what was actually saved** — not re-derived from `githubActions` — specifically so "downgraded agents [don't] silently re-escalat[e] when reopened" (comment in `agent-spec.ts`).
2. In **GitHub actions**, she flips the `open_pull_request` switch on.
3. `handleActionsPanelChange` detects `hasAnyWriteAction(next.githubActions)` is now true and auto-sets `permissionContents`/`permissionPullRequests` to `"write"` on the `GitHubToolCard` — she never touched that card directly, but it visibly flips from "Read-only" to "Open pull requests".
4. She saves — `PATCH /api/background-agents/{id}` — `buildAgentPayload` independently floors `contents`/`pullRequests` to `write` server-side too (`requiresWrite` check), so even if the client state were stale the write couldn't ship as read-only.
5. Save redirects her to the detail page (`router.push(detailHref)`) — unlike the create flow, edit does not stay on the page.
6. Weeks later she reopens edit, turns `open_pull_request` back off. The `GitHubToolCard` does **not** auto-revert to read-only (the coercion only fires on the enable transition) — she must manually click "Read-only" herself if she wants to downgrade.

### Variations
- The `initialGoal` prop passed into edit mode is `agent.description ?? ""` — the DB's `description` column. `AgentSpecEditor`'s lazy `useState` initializer merges it into `instructions` **once**: `` `${initialGoal}\n\n${initialInstructions}`.trim() `` — but only if `initialInstructions` doesn't already start with it. Since her first save already prepended the goal into instructions, every subsequent edit sees `initialInstructions.startsWith(initialGoal)` as true and skips the merge — meaning the standalone `description` field is written once at creation, then never touched, read, or shown as a distinct field again anywhere in this UI.

### Edge Cases
- There is no field anywhere in `AgentSpecEditor` labeled "Description" — it only ever appears as the invisible `initialGoal` plumbing. A user who expects to edit a short agent description independently of the long instructions blob has no such control.

---

## STORY-606: A Trigger Kind With No Condition Fields

**Type**: short
**Topic**: Background Agents
**Persona**: Tomasz, who wants an agent that reacts specifically to a pull request being *approved*, not just any review activity.
**Goal**: Configure a `github.pull_request_review` trigger scoped to `reviewState: approved`.
**Preconditions**: On the new-agent builder, "When should it run?" step.

### Steps
1. Tomasz selects **"A pull request is reviewed"** (`github.pull_request_review`) from the trigger dropdown.
2. Clicks **"Refine when it runs"** to expand `EventTriggerConditions`.
3. Nothing renders. `event-trigger-conditions.tsx` has explicit branches for `github.pull_request`, `github.issue`, `github.deployment_status`, and `github.check_suite` — then falls through to `return null` for anything else, including `github.pull_request_review`.
4. This is despite `fieldsForTrigger("github.pull_request_review")` in `agent-spec.ts` returning `{"actions", "statuses", "actors", "ignoreActors"}`, and `conditionFieldLabel("statuses", "github.pull_request_review")` being defined to return the friendly label **"Review state"** — the data model and label vocabulary both anticipate this UI, it's just never wired up.
5. Tomasz has no way, in this builder, to scope the trigger to `approved` vs. `changes_requested` vs. `commented`. His only option is to accept every review event and filter inside the agent's own instructions text.

### Variations
- None found — `formatTriggerLabel` for this kind (`formatPrReviewLabel`) *does* correctly render a saved condition's first `severities`/`actions` entry if one somehow got set (e.g. via direct API call, bypassing this UI) — so the backend and label layers are fully capable; only the editing surface is missing.

### Edge Cases
- If Tomasz sets the condition via a raw `PATCH /api/background-agents/{id}` call (API surface, not this UI), the value persists and displays correctly on the detail page's trigger card — the gap is specifically in the builder's condition editor, not in storage or matching.

---

## STORY-607: Scheduling and Watching a Cron Trigger

**Type**: medium
**Topic**: Background Agents
**Persona**: Renata, who wants a weekly "release notes" agent (the **Release Notes Agent** template, `triggerKind: "schedule.cron"`) rather than an event-reactive one.
**Goal**: Configure a Monday-morning schedule and confirm it's actually firing.
**Preconditions**: On the new-agent builder with the Release Notes Agent template selected.

### Steps
1. Trigger kind is pre-set to `schedule.cron`; `SchedulePicker` mounts with a **Simple | Cron** segmented toggle (`schedule-picker.tsx`).
2. In **Simple** mode, Renata picks "Weekly", toggles **Mon**, sets time-of-day 09:00. A footer line shows the composed cron string live: `cron: 0 9 * * 1 · times in UTC`, plus a `SchedulePreview` of upcoming fire times.
3. She saves; the trigger is created with `schedule: "0 9 * * 1"`.
4. On `/repos/.../agents`, her `AgentCard` renders an `AgentScheduleCard` beneath the trigger badges. Before the first fire, it shows **Last run: Never**, **Next run:** the computed next Monday 09:00 UTC.
5. The scheduled sweep (`/api/background-agents/cron`, bearer `BACKGROUND_AGENTS_CRON_SECRET` or `CRON_SECRET`) fires Monday, matches the trigger via `listEnabledScheduleTriggers` + `scheduleMatchesNow`, and dispatches a run. `AgentScheduleCard` now shows the real **Last run** timestamp and the newly computed **Next run**.

### Variations
- If the repo allowlist doesn't cover this repo, the sweep still calls `recordTriggerSkipReason` on this specific trigger row — and because this *is* a `schedule.cron` trigger, `AgentScheduleCard` **does** render the amber "Last invocation skipped" banner with the raw reason string. This is the one trigger kind where the allowlist refusal from STORY-603 is actually visible in the product UI.
- If she hits her `runBudgetPerTarget` (unlikely for a schedule trigger with no `prNumber`, since `isRunBudgetExhausted` short-circuits `if (event.prNumber == null) return false`) — budget exhaustion in practice only applies to PR-scoped triggers, not cron.

### Edge Cases
- Times are UTC only — the picker prints "Time of day (UTC)" and "cron: … · times in UTC" but there's no timezone selector; Renata has to do the UTC conversion herself if she's thinking in local time.

---

## STORY-608: Finding the Webhook URL for a `webhook.error` Trigger

**Type**: short
**Topic**: Background Agents
**Persona**: Kwame, an SRE who wants an agent that reacts when his external error-monitoring tool reports a spike, using the `webhook.error` trigger kind.
**Goal**: Get the actual callable webhook URL to paste into his monitoring tool's alert-webhook config.
**Preconditions**: Agent created at `/repos/acme/api/agents/{id}` with a `webhook.error` trigger, `BACKGROUND_AGENTS_WEBHOOK_SECRET` configured.

### Steps
1. Kwame builds the agent, selects **"An error is reported (webhook)"** as trigger kind, saves.
2. On the agent detail page (`/repos/acme/api/agents/{id}`), the Trigger section shows the `webhook.error` badge and label "On error webhook" — but **no URL, no public id, no copy button**. `[agentId]/page.tsx` renders `trigger.kind`, `readableLabel`, conditions, and schedule — it has no branch for `trigger.webhookPublicId` at all.
3. He checks the edit page — same gap; `AgentSpecEditor`/`GithubActionsPanel`/`EventTriggerConditions` have no webhook-URL rendering either.
4. He finally finds it at **Settings → Background agents** (`/settings/background-agents`, a cross-repo global list, `background-agents-section.tsx`): each agent row with a `webhook.error` trigger shows a read-only `Input` containing `/api/background-agents/webhook/{webhookPublicId}` plus a copy-icon button that flips to a checkmark on copy.
5. He copies it, prepends his own origin, and configures his monitoring tool to `POST` there with header `x-open-agents-signature` (HMAC over the raw body using `BACKGROUND_AGENTS_WEBHOOK_SECRET`, verified by `verifyBackgroundWebhookSignature`) and a JSON body whose only required field is `externalId` (optional: `repoOwner`, `repoName`, `severity`, `title`, `message`, `url`, `actor`, `occurredAt`).

### Variations
- None found for *where* the URL lives — it is exclusively a Settings-surface affordance, never a repo- or automation-scoped one.

### Edge Cases
- If `BACKGROUND_AGENTS_WEBHOOK_SECRET` isn't set at all, the endpoint itself 500s with `errorKind: "internal_error"` before even checking the signature — a config gap that shows up as a 500 to Kwame's monitoring tool, not as a friendly in-product message.
- A bad/missing signature is a 401 `unauthorized`; malformed JSON is a 400 `invalid_request`; both are silent to the Open Agents UI since no run row is ever created for a rejected delivery.

---

## STORY-609: Composio Tool Grants and the "Next Run" Preflight

**Type**: medium
**Topic**: Background Agents
**Persona**: Ana, who wants her agent to post a Slack message summarizing what it did, in addition to commenting on GitHub.
**Goal**: Grant the agent a Composio Slack toolkit and confirm it'll actually work on the next run before waiting for a live trigger.
**Preconditions**: Composio configured (`COMPOSIO_API_KEY`), agent exists.

### Steps
1. In **Tools → Other tools**, Ana searches and selects the Slack toolkit via `ComposioOtherToolsSection` (wraps `ComposioToolkitPicker`, `source: "connected"`) → `composioToolkitSlugs` now includes `"slack"`.
2. She saves. The agent detail page's **"Next run: tool availability"** section (`AgentToolPreflightPanel`) fetches `GET /api/background-agents/{id}/tool-preflight` and renders one row per configured slug.
3. Row shows `slack` with a status chip. `computeAgentToolPreflight` is a genuine dry run — it never creates a Composio session or mints a token, only reading `applyRepoToolkitPolicy` (repo allow/deny) and `connectedAccounts.list` (status metadata), the exact same shared resolvers the real background-run path uses.
4. If she hasn't connected a Slack account yet, the chip reads **"Not connected"** with a **Connect** link to `/settings/composio`.
5. She connects, returns, the panel (or a manual retry click) shows **"Ready"** (emerald chip).

### Variations
- **"Blocked by repo policy"** (amber) — the repo's own toolkit allow/deny list blocks this slug; row text distinguishes "not in the repository's allowlist" vs. "on the repository's denylist" (`policyReasonCopy`).
- **"Auth expired"** (red) — a previously-connected account whose token lapsed; action link says **Reconnect**.
- **"Composio unreachable"** — `COMPOSIO_API_KEY` missing or the API call threw; a banner across the whole panel reads *"Composio unreachable — predicted status could not be confirmed for any toolkit below."* with a **Retry** button; every row's chip also shows this state individually.
- No toolkits configured at all → the whole section collapses to *"No tools configured for this agent."*

### Edge Cases
- A `NO_AUTH`-metadata toolkit (per Composio, e.g. some public-data toolkits) with zero connected accounts still predicts **"Ready"**, not "Not connected" — `toolkitRequiresAuth` is consulted specifically so this dry run never diverges from what the real run will do.
- This panel predicts the *next* run's tool availability; it says nothing about whether a trigger will actually fire (see STORY-603 — a fully "Ready" toolkit panel gives no signal about allowlist refusal upstream of it).

---

## STORY-610: Building a Merge-Capable Agent With Fine-Grained Actions

**Type**: medium
**Topic**: Background Agents
**Persona**: Sofia, a tech lead who wants an agent that reviews dependency-bump PRs and merges them itself, but only when CI is green, and only on a specific low-risk repo — not wherever the trigger happens to fire from.
**Goal**: Configure `merge_pull_request` with the CI-green gate, restrict write scope, and pick an explicit model.
**Preconditions**: Agent exists on `acme/deps-bot`.

### Steps
1. In **GitHub actions**, Sofia's `GithubActionsPanel` lists all seven toggles: `open_pull_request`, `comment_on_pr_or_issue` (both on by default), then `approve_pull_request`, `request_changes`, `merge_pull_request`, `push`, `delete_branch` — each of the latter five carries risk copy: *"Off by default; enable deliberately."*
2. She flips `merge_pull_request` on. Directly beneath it, nested with a dashed border, a **"Require CI green before merging"** sub-toggle appears — enabled and defaulting **on** (`requireCiGreenForMerge: true`), described as *"Blocks merge_pull_request unless the latest checks succeeded."* Before she enables the parent toggle, this row is visibly greyed out (`opacity-50`) and its own switch is disabled — it can't be independently configured while merge is off.
3. Under **Write scope**, she switches from "This repo" to **"Specific repos"** — a repo-combobox list appears (`GitHubRepositoryCombobox`, `allowFreeform`), she adds `acme/deps-bot` explicitly (up to 50 entries allowed, `MAX_SPECIFIC_REPOS`).
4. Under **Model**, she opens the `ModelCombobox` and picks an explicit model instead of "Use default model" — `modelId` is set to a gateway `provider/model` id.
5. Saves. `hasAnyWriteAction` sees `merge_pull_request` is true, so contents/pullRequests are floored to `write` regardless of what the `GitHubToolCard` showed.

### Variations
- If she later disables `merge_pull_request`, the CI-green sub-toggle greys back out but keeps its last value (`requireCiGreenForMerge` is not reset) — it just becomes inert until merge is re-enabled.
- Choosing "All repos" for write scope skips the repo-list UI entirely — a single select with no further confirmation step, letting a single agent's write actions target anything its GitHub App installation reaches.

### Edge Cases
- If a real run later hits a merge attempt while `requireCiGreenForMerge` is true and checks haven't passed, the run fails with `errorKind: "checks_failed"` — surfaced on the run detail page as *"Required checks did not pass for this run's changes."* with guidance *"Review the failing checks, fix them, then retry the run."*

---

## STORY-611: The Invisible Ping-Pong Backstop

**Type**: short
**Topic**: Background Agents
**Persona**: Yusuf, debugging why his "reviewer" agent stopped commenting on a very active, long-lived PR after a burst of back-and-forth commits.
**Goal**: Understand why the agent went quiet on this one PR specifically while still running fine elsewhere.
**Preconditions**: Agent enabled on `github.pull_request` with `synchronize` in its action conditions, PR #482 has had 11 pushes in 24 hours.

### Steps
1. Every `synchronize` event on PR #482 re-triggers the agent. `isRunBudgetExhausted` (`dispatcher.ts`) counts recent runs for the exact `(agentId, repoOwner, repoName, prNumber: 482)` target over a rolling 24-hour window via `countRecentRunsForTarget`.
2. On the 11th trigger, `recentRuns (10) >= runBudgetPerTarget (10, the schema default — see STORY-601)` → the run is refused *before creation*: no run row, so this can't be surfaced via `recordBackgroundAgentEvent` (which requires a `runId`).
3. Instead, `recordTriggerSkipReason` writes a specific, actually well-worded string to the trigger row: `budget exhausted: 10/10 runs in 24h for PR #482` — plus a structured `console.warn` with `eventName: "background-agent.run.budget_exhausted"`.
4. Because this trigger is `github.pull_request`, not `schedule.cron`, the same UI gap from STORY-603 applies: `AgentScheduleCard` — the only component that ever renders `lastSkipReason` — doesn't mount for this trigger kind. The skip reason is written to a column nobody's UI reads.
5. Yusuf sees only that the agent's "Never run" status on the card is now stale (last real run was hours ago), with no failed run, no error, and PR #482 keeps accumulating pushes with no new agent comments.

### Variations
- `runBudgetPerTarget` itself is not visible or editable anywhere in the create/edit UI (confirmed by grepping every non-test file under the agents/automations builder tree) — Yusuf cannot even go raise the limit from the product; he'd need direct API access (`PATCH` with `runBudgetPerTarget` in the update schema).

### Edge Cases
- The 24-hour window is rolling, so as older runs age out, the agent will resume commenting on the same PR automatically once the count drops back under budget — with no notification when that happens either.

---

## STORY-612: Watching a Live Run — Proof Strip and the SSE That Isn't

**Type**: medium
**Topic**: Background Agents
**Persona**: Ben, checking on an in-flight run he just kicked off via "Run now" on an agent card.
**Goal**: Watch the run progress in near-real-time and understand what it actually did once finished.
**Preconditions**: A run in `queued` or `running` status, `NEXT_PUBLIC_ENABLE_BACKGROUND_RUN_SSE` unset (the default).

### Steps
1. Ben lands on `/background-runs/{runId}`. `isSseEnabled()` reads `NEXT_PUBLIC_ENABLE_BACKGROUND_RUN_SSE` — unset, so it's `false`.
2. Because SSE is disabled, the page falls back to `useSWR` against `GET /api/background-agent-runs/{runId}` with `refreshInterval: (latest) => latest.run.status === "queued" || "running" ? 2000 : 0` — a plain 2-second poll, not a stream.
3. No `streamStatusLabel` is ever shown (it's gated on `sseEnabled && isLive`), so Ben sees the page quietly refresh every 2 seconds with no indicator distinguishing "live" from "polling" — he perceives it as live because the numbers move, but there's no `EventSource` connection open at all.
4. The `RunMetadataTable` proof strip updates each poll: `status`, `definition` (`v{definitionVersion} · {definitionHash prefix}` or "Legacy"), `snapshot source`, `trigger`, `repository`, `ref` (sha/ref/branch fallback chain), `sandbox`, `permissions` (derived from `agent.permissions.github`), `checks`, `output`, `duration`, and — only if any event payload contains a cost-like field — `cost`.
5. Run finishes; polling stops (`refreshInterval` returns 0 once status leaves queued/running). The **Live Timeline** section stops advancing, `RunSummarySection` renders `run.resultSummary` if present, and the **Outputs** sidebar lists recorded action outputs by `kind` + status pill.

### Variations
- With `NEXT_PUBLIC_ENABLE_BACKGROUND_RUN_SSE=1`, `useBackgroundRunEventSource` opens a real `EventSource`; `streamStatusLabel` then shows one of "Connecting to live stream…", "Live streaming", "Reconnecting…", "Stream ended" — a genuinely different, and more honest, UX from the polling fallback.
- If the terminal SSE refresh (`onSseTerminal`) fails to fetch the final state, a status message reads *"Final evidence refresh failed. Last known evidence is shown."* rather than silently going stale.
- Canonical (`/runs/background-agent/[runId]`, `variant="canonical"`) vs. legacy (`/background-runs/[runId]`) render the identical `nativeDetail` block inside a different shell — same underlying data.

### Edge Cases
- The **Debug** metadata table (Run ID, Request ID, Workflow Run, Idempotency Key, Source, External Event, Trigger Target) is always visible, not gated behind any "advanced" disclosure — every run detail view is effectively an operator view by default.

---

## STORY-613: Two Front Doors, One Agent

**Type**: short
**Topic**: Background Agents
**Persona**: Chidi, who first discovered his team's agents through the global **Automations** nav item, then later navigated to the same repo directly.
**Goal**: Understand whether `/automations` and a repo's `/agents` tab show the same thing or different things.
**Preconditions**: At least one background agent exists on a repo Chidi has access to.

### Steps
1. From `/automations`, Chidi finds the agent and opens it at `/automations/background-agent/{agentId}`.
2. From `/repos/{owner}/{repo}/agents`, he finds the same agent and opens it at `/repos/{owner}/{repo}/agents/{agentId}`.
3. Both routes render the literal same component, `AgentDetailContent` (imported directly by `automations/background-agent/[agentId]/page.tsx` from `app/repos/[owner]/[repo]/agents/[agentId]/page.tsx`), differing only by a `surface: "legacy" | "automation"` prop that changes some copy ("agent" vs. "Automation") and back-link targets.
4. Editing from either surface reaches the same `AgentEditForm`/`AgentSpecEditor`, PATCHing the same `/api/background-agents/{agentId}` row — there is exactly one underlying record no matter which door he used.
5. Chidi wants to **delete** the agent. Neither detail page (legacy or automation surface) nor either edit page has a delete control. He eventually finds **Delete** only on `/settings/background-agents` (`background-agents-section.tsx`), behind a confirmation dialog naming the agent.

### Variations
- Creation has the same duplication: `/repos/{owner}/{repo}/agents/new` and `/automations/new?repoOwner=&repoName=` both render `NewAgentBuilder`, differing only in `surface` and in `/automations/new` requiring an explicit repo pick first via `AutomationRepositoryPicker` before the builder even mounts.
- The automation surface additionally gates **Enable** behind readiness (`enableBlocked = surface === "automation" && !persistedEnabled && (!createdAgentId || !readinessReady)`) — the legacy repo-scoped surface lets you flip Enabled freely regardless of readiness state, so the *same underlying agent* can be toggled with different friction depending on which door was used to reach it.

### Edge Cases
- Because deletion lives only in Settings, a user who only ever discovered agents through a repo page (as in STORY-601) may not know deletion is possible at all until they go looking specifically for it.

---

## STORY-614: End-to-End — Template to Production Run

**Type**: long
**Topic**: Background Agents
**Persona**: Grace, onboarding background agents for her team's repo for the first time, wants to go from zero to a proven, working automation in one sitting.
**Goal**: Create the "Failing Checks Fixer" template agent, verify it with a manual test, enable it, and watch it handle a real event.
**Preconditions**: `BACKGROUND_AGENTS_ENABLED=true`, repo allowlisted, GitHub App installed with write access, Composio not required for this agent.

### Steps
1. `/repos/grace-co/service/agents` → **New agent** → picks **Failing Checks Fixer** (`triggerKind: "github.pull_request"`) from `TemplatePicker`.
2. Readiness panel above the form: all rows green, including the repo-specific `repoAccess` row.
3. Reviews the pre-filled instructions, sets **Advanced → Verification command** to `bun --bun run ci` (the check the agent runs before opening a PR).
4. Leaves GitHub access at the template's derived default — the template's `githubActions` include `open_pull_request: true`, so `templateRequiresWrite` is true and `initialAccessLevel` starts at `"write"`.
5. Saves disabled → toast "Agent created successfully." → stays on page, **Run a test** now enabled.
6. Clicks **Run a test** → `RunTestConsole` mounts, cycles `queued → running`, streams events like `background-agent.trigger.received`, `background-agent.check.completed`, eventually `succeeded`.
7. Opens **"Open full run"** → `/background-runs/{runId}` → confirms the proof strip: `status: succeeded`, `checks: succeeded` (or the check's actual status), `output` line naming a recorded output kind, `duration` computed from started/finished timestamps, and the **Outputs** panel showing a PR link if one was opened.
8. Satisfied, returns to the builder, flips **Enabled**, saves again — status pill now "Enabled".
9. A teammate's PR later fails CI on a real `synchronize` event. GitHub's webhook reaches `/api/github/webhook`, `dispatchBackgroundTriggerEvent` matches the trigger (repo *is* allowlisted this time), creates a run, starts the workflow.
10. Grace watches it land in `/repos/grace-co/service/agents`'s "Recent runs" peek (shows latest 5 across the whole repo, agent name resolved via `agentNameById`), then opens the agent detail page's own "Recent runs" section (scoped to this one agent, up to 20) to confirm the fix PR it opened.

### Variations
- If the verification command fails, the run ends with `errorKind: "checks_failed"` instead of a fix PR — visible immediately in both the inline test console and the run detail's `RunErrorBanner`.
- Grace could equally have done all of this from `/automations/new` with `surface="automation"` — identical mechanics, different chrome (STORY-613).

### Edge Cases
- If she'd forgotten to configure the verification command, the check step still records an event: `background-agent.check.completed` with `status: "skipped"` and summary "No check command configured." — a *skipped check* on an otherwise successful run, not a failure.

---

## STORY-615: Pause, Resume, and Reading a Failed Run

**Type**: short
**Topic**: Background Agents
**Persona**: Hassan, whose enabled agent just failed and needs to be paused while he investigates, without losing its configuration.
**Goal**: Pause the agent and understand exactly why the last run failed.
**Preconditions**: Enabled agent with a `failed` latest run.

### Steps
1. On the agent card, `deriveCardStatus` shows **"Failed"** (amber/red pill logic: `latestRun.status === "failed" || "cancelled"` → `"failed"` card status), with the run's `errorKind` printed inline: e.g. `permission_missing` — and if an `errorMessage` exists, appended after a colon.
2. Hassan clicks **Pause** (`Button` toggles via `PATCH /api/background-agents/{id}` with `{status: "disabled"}`) → `router.refresh()` → card status flips to **"Paused"**.
3. He clicks **View run** to open `/background-runs/{runId}` → `RunErrorBanner` renders `getBackgroundRunErrorCopy("permission_missing")`: *"The agent doesn't have write access to this repository."* / *"Connect GitHub or ask a repository admin to grant write access."* with an **Open GitHub settings** action link to `/settings/connections`.
4. He fixes the repo permission, returns, clicks **Resume** (same PATCH, `status: "enabled"`).

### Variations
- Other known `errorKind`s Hassan might see instead, each with dedicated plain-language copy (`error-copy.ts`): `installation_missing` ("no GitHub App installation was found"), `sandbox_unavailable` ("execution sandbox couldn't be started" — retry), `agent_stalled` ("stopped making progress after its recovery attempts" — work is preserved, not discarded), `token_budget_exceeded` ("reached its configured token safety limit"), `webhook_signature_invalid`, `model_resolution_failed`.
- An **unknown** errorKind (one not in `ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS`) still renders honestly: *"Something went wrong that we don't have specific guidance for yet."* rather than a blank or misleading banner — with the raw kind string preserved in a details disclosure.
- Run statuses in general across the lifecycle: `queued → running → succeeded | failed | skipped | cancelled` (`backgroundAgentRunStatuses`, `types.ts`). A `skipped` *run* (as opposed to a skipped *event*, e.g. `duplicate_event`) renders in `RunTestConsole` and `AgentCard`/run-detail status pills without the red/green styling of failed/succeeded — plain muted text.

### Edge Cases
- Pausing does not cancel an in-flight `running` run — it only prevents *future* triggers from starting new ones. Hassan's already-running failing run, if one were active, would continue to its natural conclusion.

---

## STORY-616: A CI-Gated Trigger — `check_suite`

**Type**: medium
**Topic**: Background Agents
**Persona**: Wei, who wants an agent that posts a comment specifically when CI finishes failing on `main`, distinct from reacting to every PR event.
**Goal**: Configure a `github.check_suite` trigger scoped to failures on the `main` branch.
**Preconditions**: New agent builder, repo with GitHub Actions or another check-suite-reporting CI.

### Steps
1. Wei selects **"CI checks finish (check_suite)"** (`github.check_suite`) as trigger kind.
2. Expands "Refine when it runs" → `EventTriggerConditions` renders a `github.check_suite`-specific branch: **Branches** (labelled "The check suite's head branch.") and **Conclusion** (labelled "Check suite conclusions: success, failure") — this trigger kind *is* one of the four with condition UI wired up (unlike STORY-606's `pull_request_review` gap).
3. Sets Branches to `main`, Conclusion to `failure`.
4. Internally, `buildConditions` routes the "Conclusion" field's value into `conditions.actions` (not `conditions.severities`) — the normalizer maps a check_suite's `conclusion` to `event.action`, and the matcher checks `conditions.actions` against it — the UI label ("Conclusion") and the storage key (`actions`) intentionally diverge; `buildFormFromAgent` restores it correctly on reopen via the same `statusDrivenByActions` mapping.
5. Saves. Trigger badge on the detail page reads `github.check_suite` with human label built by `formatCheckSuiteLabel`: *"On CI checks failure on main"*.
6. Webhook handler ignores `check_suite` deliveries whose `action !== "completed"` before even normalizing them (`requested`/`rerequested` are silently dropped with `{ok: true, ignored: true}`), since only a finished check suite has a `conclusion` worth acting on.

### Variations
- If Wei also wants this agent to merge automatically once its own review comment resolves cleanly, he'd combine this with the `merge_pull_request` + CI-green setup from STORY-610 — though `requireCiGreenForMerge`'s own check is independent of *this* trigger's condition matching; they're two separate gates that happen to both reference CI state.

### Edge Cases
- `github.deployment_status` has the identical "label says one thing, storage key says another" pattern (`conditionSeverities` UI field → `conditions.actions` storage, since deployment state also maps to `event.action`) — the same subtlety Wei hit here recurs for anyone configuring a deployment trigger.
