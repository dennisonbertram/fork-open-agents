# UX Journeys — Runs & Automations: Cross-Surface Monitoring, Filtering, Attention Triage & Recovery

> Grounded against `apps/web/app/runs/**`, `apps/web/app/automations/**`,
> `apps/web/app/api/runs/route.ts`, `apps/web/app/api/automations/route.ts`,
> `apps/web/lib/runs/**`, and `apps/web/lib/automations/**`. Every filter name,
> state/outcome/health value, and attention-reason string below is copied from
> `lib/runs/types.ts`, `lib/runs/status.ts`, `lib/runs/query.ts`, and
> `lib/automations/types.ts` — not invented.
>
> **Verified scope note**: `/runs` and `/api/runs` only ever load
> `background_agent` and `agent_loop` runs (`lib/runs/list.ts`,
> `sourceOrder = ["background_agent", "agent_loop"]`). `chat_workflow` has a
> `NormalizedRun` adapter (`adaptChatWorkflowRun`) but its only caller is
> `lib/account-coordinator/snapshot.ts` — interactive chat runs never appear
> on `/runs`. Treat "unified feed across chat_workflow | background_agent |
> agent_loop" (the discovery doc's Feature Map line) as a shared-contract
> claim, not a claim about what `/runs` renders.

## STORY-801: From "something's wrong" to the evidence for a failed automation run

**Type**: long
**Persona**: Priya, who owns a `background_agent` that auto-fixes lint failures on `acme/webapp`. A teammate pings her that the bot hasn't opened a PR in a day.
**Goal**: Find out whether the automation actually failed, and get the exact evidence (request ID, sandbox, workflow run) to escalate or debug.
**Preconditions**: Priya is signed in; she owns a `background_agent` automation against `acme/webapp` with at least one run whose native status is `failed`.
**Ideal path**: 4 — `/runs` → click "Needs attention" → filter by repository → click "View evidence" on the failed row. Health and outcome are visible on the list row without opening anything, but the *why* (the `attentionReasons` string) only renders on the detail page, so a 4th step is unavoidable if she wants the literal reason, not just the color of the badge.
**Alternate paths**: She could instead start at `/automations`, find the agent card, and follow its "Latest run" link if the failing run happens to be the latest one (STORY-814). She could also already have the run's canonical URL bookmarked. See STORY-802 for the full inventory of equivalent detail pages for this same run.

### Steps
1. Priya opens `/runs`. → The primary rail highlights "Runs"; the page loads all `background_agent` and `agent_loop` runs, most recent first, with view tabs All / Active / Needs attention / Completed.
2. She clicks "Needs attention" (`?view=attention`). → The list re-fetches; server-side, this includes any run whose native status is `failed`/`cancelled`, any `agent_loop` run `paused`/`stalled`, and any `queued`/`running` run whose `updatedAt` is more than 6 hours old.
3. In the Repository field she searches the `GitHubRepositoryCombobox` for `acme/webapp`, then clicks "Apply filters". → URL becomes `/runs?view=attention&repoOwner=acme&repoName=webapp`; the list narrows to attention-worthy runs in that repo.
4. She finds the row tagged "Background agent · Single-step" with a `Failed` outcome badge and a red `Needs attention` health badge, and clicks "View evidence". → She lands on `/runs/background-agent/{runId}`, the canonical detail page.
5. On the detail page's evidence table she reads `Attention: failed`, `Native status: failed`, and the `Request ID` / `Workflow Run` / `Sandbox` rows (copyable). → She now has the exact identifiers to hand to an on-call engineer or search logs with.

### Variations
- If the run is an `agent_loop` run instead, step 4 lands on `/runs/loop/{runId}` and the evidence table's "Evidence source" row reads "Loop graph, steps, events, and watchdog decisions" instead of "Background agent events and outputs".
- If Priya skips the repository filter, she sees attention-worthy runs across every repo she has automations in, sorted by `createdAt` descending.

### Edge Cases
- The list row itself never shows the `attentionReasons` array (`blocked`, `cancelled`, `failed`, `failed_steps`, `stale`, `stalled`, `unknown_status`, `waiting_on_user`) — `RunDimensions` in `runs-list.tsx` renders only `state`, `outcome`, and `health`. A run whose health is `needs_attention` because it's `failed` looks visually identical, at the list level, to one that's `needs_attention` for being `stale` (both get the same red badge text "Needs attention"). The specific reason is detail-page-only.
- If the automation that produced the run has since been deleted, the row's automation name still renders (adapters fall back to `"Deleted automation"` or `"{name} (deleted)"`), and clicking it still works — deletion doesn't break the evidence trail.

---

## STORY-802: The same run, five different URLs

**Type**: long
**Persona**: Marcus, an on-call engineer who gets a Slack link mid-incident and needs to know whether the link he was sent is "the real page" or a duplicate.
**Goal**: Understand whether every URL a teammate might share for one automation run shows the same evidence, or whether some are stale/different.
**Preconditions**: A `background_agent` run with id `run_abc` exists, belonging to agent `agent_123` in `acme/webapp`.
**Ideal path**: 1 — any single URL below already renders full evidence; the "path" here isn't a multi-step task, it's confirming the URLs are equivalent. Documented as a redundancy audit, not a task to shorten.
**Alternate paths**: None found that reach *different* data — all five below are confirmed by source to reach the same underlying run row.

### Steps
1. Marcus opens `/runs/background-agent/run_abc` (canonical route, `app/runs/background-agent/[runId]/page.tsx`). → Renders `<BackgroundRunDetail variant="canonical">`, wrapped in `RunDetailShell`. Primary nav highlights **Runs**.
2. He opens `/background-runs/run_abc` (legacy route, `app/background-runs/[runId]/page.tsx`) instead. → Renders the exact same `BackgroundRunDetail` component (default `variant="legacy"`, its own header, no `RunDetailShell` wrapper) with identical run data. Primary nav *also* highlights **Runs** (`getActiveWorkspaceNavigationItem` matches `segments[0] === "background-runs"`).
3. He opens `/repos/acme/webapp/agents/agent_123` (the repo-scoped agent page). → Shows the agent's config plus a "Recent runs" list; `run_abc`'s row links to `canonicalRunDetailUrl("background_agent", "run_abc")` = `/runs/background-agent/run_abc` (step 1's URL). Primary nav highlights **Automations** (`isLegacyRepoAutomation`, `repoCompatibilitySurface === "agents"`) — even though this page is showing runs.
4. He opens `/automations/background-agent/agent_123` (automations detail route). → Shows the same agent's config and run history (`agentRuns = runs.filter(r => r.agentId === agent.id)`), same underlying rows as step 3.
5. He opens `/runs?automationId=agent_123&automationSource=background_agent`. → The unified list, filtered down to just this agent's runs — `run_abc` appears as a row whose "View evidence" link is, again, step 1's URL.

### Variations
- For an `agent_loop` run the equivalent five surfaces are: `/runs/loop/{runId}` (canonical), `/loops/{loopId}/runs/{runId}` (legacy, same `RunDetail` component, nav highlights **Runs** via `isLegacyLoopRun`), `/loops/{loopId}` (run-history list, nav highlights **Automations**), `/automations/agent-loop/{loopId}` (same `LoopDetail` component with `surface="automation"`, nav highlights **Automations**), and `/runs?automationId={loopId}&automationSource=agent_loop`.
- Clicking a run's automation name *from the `/runs` list row* does **not** go to the automation detail page at all — `automationHref` in `runs-list.tsx` builds a link back to `/runs?automationSource=...&automationId=...` (step 5's URL shape), not to `/automations/...`. To reach the automation's own configuration page from a run, the user has to go through the detail page's `automation.href` instead (which for `background_agent` points to `/repos/{owner}/{repo}/agents/{agentId}`, and for `agent_loop` points to `/automations/agent-loop/{loopId}` on canonical or `/loops/{loopId}` on legacy).

### Edge Cases
- Nothing here redirects. All five/six URLs per source are live, independently rendered routes (`legacy-run-pages.test.ts` asserts the legacy pages still exist "while canonical routes are additive"). A user who bookmarks the legacy URL keeps working indefinitely; there's no forcing function toward the canonical one.
- The two nav-highlight rules disagree with each other in a way a careful user could notice: `/loops/{loopId}/runs/{runId}` (a *run*) highlights **Runs**, but `/repos/{owner}/{repo}/agents/{agentId}` (also showing *runs*, in a "Recent runs" list) highlights **Automations**. There's no single rule for "does this page show run history" driving the nav.

---

## STORY-803: A run says "Running" for hours — is it actually working?

**Type**: short
**Persona**: Dana, checking on an overnight `agent_loop` automation before a demo.
**Goal**: Decide, without paging anyone, whether the automation is still making progress or silently stuck.
**Preconditions**: An `agent_loop` run has native status `running`, and its `updatedAt` timestamp is more than 6 hours old (`DEFAULT_RUN_STALE_AFTER_MS`).
**Ideal path**: 2 — `/runs?view=attention` already surfaces it (the DB-side `loopViewCondition` for `attention` includes `queued`/`running` rows with `updatedAt` older than the 6-hour threshold), then open the detail page for the word "stale" itself. Two steps get her the badge; the word "stale" specifically costs a third.
**Alternate paths**: `view=active` also shows it (state is still `running`), with no attention signal at all — a user who only checks "Active" never learns anything is wrong.

### Steps
1. Dana opens `/runs?view=attention`. → The row appears with state badge `Running` (unchanged) and a red `Needs attention` health badge — `normalizeRunStatus`'s `activeStatus()` sets `health: "needs_attention"` for a stale active run but leaves `state` as `running`.
2. She clicks "View evidence" (`/runs/loop/{runId}`). → The evidence table shows `State: running`, `Outcome: —` (still null — the run hasn't finished, staleness isn't an outcome), and `Attention: stale`.
3. She checks `Updated` in the header timestamps row. → It's hours old, confirming the backend genuinely stopped writing to this run — not just a slow poll.

### Variations
- If instead this is a `background_agent` run, the same 6-hour-stale logic and `Attention: stale` label apply (`adaptBackgroundAgentRun` also calls `isStale`), but the detail page additionally shows an SSE-driven "Live streaming" / "Connecting to live stream…" label whenever `run.status` is `queued` or `running` (`background-run-detail.tsx`, `isLive = status === "queued" || status === "running"`). That label reflects **stream connectivity**, not backend progress — a genuinely stalled sandbox can still show "Live streaming" if the SSE channel itself is up, directly contradicting the `Attention: stale` row two lines above it.
- On `/runs`, the "Live updates paused after ten minutes" polling notice (`use-runs-list.ts`, `POLL_DEADLINE_MS`) can appear at the same time — if Dana leaves the tab open past 10 minutes of continuous polling, the list itself stops refreshing, on top of the run itself being stale.

### Edge Cases
- Nothing on the `/runs` list row itself ever prints the word "stale" — only state (`Running`) and health (`Needs attention`) badges. A user who doesn't open the detail page cannot distinguish "stale" from "failed" from "cancelled" — every one of those renders the same badge shape, just with different text and, for `stale` specifically, the same badge text ("Running"/"Needs attention") as a genuinely active-but-slow run that hasn't crossed 6 hours yet would never show.

---

## STORY-804: Narrowing the flood with repository and trigger filters

**Type**: medium
**Persona**: Priya again, now checking every GitHub-triggered automation across all her repos before end of day.
**Goal**: See only runs triggered by GitHub events (not schedules or manual runs), without losing the repository she's already filtered to.
**Preconditions**: Priya has automations across more than one repository, some GitHub-triggered, some scheduled.
**Ideal path**: 2 — pick the repository via the combobox, pick "GitHub" from the Trigger source select, click "Apply filters". Both filters live in the same form and submit together.
**Alternate paths**: She could arrive at a trigger-scoped view indirectly by clicking a run row's trigger link, which sets `triggerSource`/`triggerKind`/`triggerId` via `hrefWith` without going through the form at all.

### Steps
1. On `/runs`, Priya types into the Repository field (a `GitHubRepositoryCombobox` with `allowFreeform`). → It sets hidden inputs `repoOwner` / `repoName`.
2. She opens the "Trigger source" select and picks `GitHub`. → Options are exactly `Any trigger` / `GitHub` / `Schedule` / `Webhook` / `Manual` — `triggerSource` in the query accepts only `github | schedule | webhook | manual`.
3. She clicks "Apply filters". → Browser navigates to `/runs?view=all&repoOwner=...&repoName=...&triggerSource=github` (the current `view` is preserved via a hidden input so filtering doesn't reset her tab).
4. The list re-renders with only matching rows; each row's trigger chip is a link (`triggerHref`) back to a further-narrowed URL adding `triggerKind`/`triggerId` if the row has them.

### Variations
- If she instead wants to clear everything, the "Clear" button removes `repoOwner`, `repoName`, `automationSource`, `automationId`, `triggerSource`, `triggerKind`, `triggerId` in one click but leaves `view` alone.
- `automationSource`/`automationId`/`triggerKind`/`triggerId` have no visible form controls at all — they only enter the URL by clicking a row's automation/trigger chip (per STORY-802's "clicking automation name filters, it doesn't navigate" finding) and are carried forward as hidden inputs so a subsequent "Apply filters" click doesn't silently drop them.

### Edge Cases
- Providing `repoOwner` without `repoName` (or vice versa) fails validation server-side (`rawQuerySchema.superRefine`) — but the UI form always sets both together from the combobox, so a user can't produce this through the form; it would require hand-editing the URL.

---

## STORY-805: An automation with an invalid definition

**Type**: medium
**Persona**: Priya, after a teammate edited an agent loop's step config directly via the API and left it in a bad state.
**Goal**: Find out which automation is broken and get to the fix.
**Preconditions**: At least one `agent_loop` (or `background_agent`) has a stored definition that fails validation on read.
**Ideal path**: 2 — `/automations` already flags it inline; click "Edit" on the flagged card.
**Alternate paths**: The amber source-status banner at the top of `/automations` also names the affected source generally, but doesn't identify which specific automation — she still has to scan cards for the "Needs attention" pill.

### Steps
1. Priya opens `/automations`. → Below the filter form, an amber `role="status"` banner reads: "{Single-step|Multi-step} automations include {N} configuration{s} that could not be fully read" (source status `partial`, `errorKind: automation_definition_invalid`).
2. She scans the card list for a red "Needs attention" pill next to the kind/status pills. → That card has `configurationHealth: "invalid"`.
3. She clicks "Edit" on that card (`item.editUrl`, e.g. `/automations/agent-loop/{loopId}/edit`). → She's on the builder/edit surface to fix the broken definition.

### Variations
- If the automation is a `background_agent`, "Edit" goes to `/automations/background-agent/{agentId}/edit` instead.
- The card's other fields degrade gracefully around the invalid definition: `Steps` shows the last-known `stepCount` or `"Unknown"`; `Verification` shows `"Unknown"` when `configuredStepCount` is `null`.

### Edge Cases
- `configurationHealth: "invalid"` and `latestRun` are independent — an automation can have a perfectly healthy latest run (`outcome: succeeded`) while its *current* definition is invalid (edited after that run executed), or vice versa. The card doesn't warn the user which one they're looking at; she has to read both the pill and the "Latest run" line separately.

---

## STORY-806: One automation source is down

**Type**: short
**Persona**: Priya, opening `/automations` during a partial outage.
**Goal**: Understand whether her multi-step automations are actually gone or just temporarily unreadable.
**Preconditions**: The `agent_loop` source loader throws (source status `failed`, `errorKind: source_unavailable`) while `background_agent` still loads fine.
**Ideal path**: 1 — the banner is on the page load, no navigation needed.
**Alternate paths**: none found — this is a passive read, not a task with alternate routes.

### Steps
1. Priya opens `/automations`. → An amber banner reads "Multi-step automations are temporarily unavailable." Her single-step automations still list normally underneath.
2. She retries the page later. → If `agent_loop` recovers, the banner disappears and multi-step cards reappear; nothing was lost — this is a read failure, not a data-loss event.

### Variations
- If *both* sources fail, `allUnavailable` becomes true and the whole list is replaced by a red section: "Automations could not be loaded" / "The definition sources are unavailable. Retry this page; no configuration was changed."

### Edge Cases
- A `partial` status (invalid items present) and a `failed` status (source unreachable) both count toward `hasBlockingSourceGap`, which changes the empty-state copy and CTA label to "Retry automations" even if the *filtered* result set is genuinely just empty for an unrelated reason (e.g. a real "no automations in this repo").

---

## STORY-807: Multi-step automations are disabled in this deployment

**Type**: short
**Persona**: An operator on a deployment where `AGENT_LOOPS_ENABLED` is off.
**Goal**: Understand why they can't create a multi-step automation, without filing a bug report.
**Preconditions**: `agent_loop` source status is `disabled` (`errorKind: feature_disabled`).
**Ideal path**: 1 — the page tells her directly.
**Alternate paths**: none found.

### Steps
1. She opens `/automations`. → The "Multi-step" header button is replaced with a disabled-looking, `aria-disabled="true"` chip reading "Multi-step unavailable" instead of a working link.
2. The amber notice banner reads: "Multi-step automations are disabled in this deployment. Single-step automations remain available." → She now knows this is deployment configuration, not an error on her account.

### Variations
- Single-step (`background_agent`) automation creation and the "New automation" primary button remain fully functional regardless of this flag.

### Edge Cases
- The `Type` filter select still lists "Multi-step" as an option even when the source is disabled; selecting it and applying filters correctly returns zero automations (there's no separate "this filter is currently non-functional" messaging beyond the header notice already shown).

---

## STORY-808: A loop run is paused by the watchdog, not by a person

**Type**: medium
**Persona**: Priya, seeing an `agent_loop` run sit at `waiting` and needing to know whether *she* needs to act or the system already decided something.
**Goal**: Tell the difference between an operator-paused run and a watchdog-paused run before deciding whether to resume it.
**Preconditions**: An `agent_loop` run has native status `paused`, reached via the watchdog issuing a `pause` decision (not a manual pause).
**Ideal path**: 2 — `/runs?view=attention` (or `active`, since `waiting` counts as active client-side) surfaces it with attention reason `waiting_on_user`; open the detail page for the watchdog-specific banner.
**Alternate paths**: She could go directly to `/loops/{loopId}` and read the loop's own "Stalled-runs summary" widget, which surfaces piled-up stuck runs above the fold without going through `/runs` at all.

### Steps
1. Priya opens `/runs?view=attention`. → The row shows state `Waiting` and a `Warning`-styled health badge (native status `paused` is in `WAITING_STATUSES`, mapping to `health: "warning"`, `attentionReasons: ["waiting_on_user"]`).
2. She clicks "View evidence" (`/runs/loop/{runId}` or the legacy `/loops/{loopId}/runs/{runId}` — both render the same component). → Below the run actions, if the latest *decided* watchdog row's decision was `pause`, an amber `PausedDiagnosisBanner` explicitly reads that the watchdog paused this run — distinguishing it from an operator-initiated pause, which shows no such banner.
3. She decides whether to resume, based on whether the watchdog's stated reason still applies.

### Variations
- If the watchdog's latest row is still `pending`/`running` (in-flight), the banner instead reads "Watchdog is analyzing this run…" — a third, distinct state beyond "paused by watchdog" and "paused by operator".
- If the most recent *decided* watchdog row's decision was `retry` or `skip` and the run is paused anyway, no banner shows at all — the code deliberately avoids false-attributing an operator's later manual pause to the watchdog.

### Edge Cases
- None of this — the watchdog attribution, the "analyzing" state — appears on `/runs` itself. The list row only ever shows `Waiting` + `Warning`; distinguishing "watchdog paused this" from "a person paused this" is exclusively a detail-page capability.

---

## STORY-809: A loop "succeeded" but a step inside it failed

**Type**: medium
**Persona**: Priya, glancing at `/runs?view=completed` and trusting the green-looking rows too quickly.
**Goal**: Notice that a `succeeded` run isn't unconditionally clean, and find out which step actually failed.
**Preconditions**: An `agent_loop` run has native status `completed`, but at least one of its step runs has status `failed` (`failedStepCount > 0`).
**Ideal path**: 3 — `view=attention` (not `completed`) is what actually catches this; open the row; open Steps in the detail timeline. Discovery here depends on picking the right tab in the first place.
**Alternate paths**: She could browse `view=completed` and miss it entirely, since the outcome badge still reads `Succeeded`.

### Steps
1. Priya opens `/runs?view=attention`. → The `loopViewCondition` for `attention` includes any `completed` run whose step-runs table has a `failed` row via a `EXISTS` subquery — so it appears here even though its outcome is a success.
2. The row shows outcome badge `Succeeded` *and* a `Warning` health badge simultaneously (`normalizeRunStatus`: explicit success with `failedStepCount > 0` → `health: "warning"`, `attentionReasons: ["failed_steps"]`). → This combination — succeeded outcome, warning health — only happens for this one attention reason.
3. She opens the detail page and scrolls to the step/graph timeline to find which specific step is marked failed. → The evidence table's `Attention` row literally reads `failed steps`.

### Variations
- If she instead filters `view=completed`, the same run appears, but nothing on that tab hints a step failed — she'd have to open every "completed" run's detail page to catch this class of problem, which doesn't scale.

### Edge Cases
- `failedStepCount` is computed as a live `COUNT(*)` subquery against `agentLoopStepRuns` at query time (`store.ts`), not a stored/cached value — so this classification can change between two page loads of the same run if step-run rows are still being written (a race that's more theoretical than practical, since the parent run is already `completed`).

---

## STORY-810: Both run sources are down at once

**Type**: short
**Persona**: Priya, opening `/runs` during a database blip.
**Goal**: Understand this is a temporary outage, not "all automations vanished".
**Preconditions**: Both the `background_agent` and `agent_loop` loaders throw inside `listAutomationRuns`.
**Ideal path**: 1 — the page states it plainly; retrying without touching filters is the documented recovery.
**Alternate paths**: none found.

### Steps
1. Priya opens `/runs`. → `GET /api/runs` returns HTTP 503 (`allSourcesFailed: true`); the page shows a red `role="alert"` box: "Could not load run history" / "Both run sources are unavailable. Retry this page; no configuration was changed."
2. She reloads. → If the outage cleared, the normal list renders; if not, the same alert reappears — there's no partial/cached fallback shown.

### Variations
- none found — this is the fully-degraded terminal state; there's no worse state than `allSourcesFailed`.

### Edge Cases
- The distinct "loading" skeleton (three pulsing bars) only shows while `isLoading && !response` — since SWR keeps the last good `error.data` around, a *second* failed request after a first success can show the stale-but-real list underneath instead of the full-page alert, depending on timing. The all-failed alert is reserved for the case with no prior data at all.

---

## STORY-811: One source degrades mid-session — pagination quietly stops

**Type**: medium
**Persona**: Priya, scrolling through a long attention-tab list when `agent_loop` (but not `background_agent`) starts failing.
**Goal**: Notice that "Load more" isn't just slow — it's paused, and know why.
**Preconditions**: She's on `/runs` with more results than fit one page; partway through, one source starts failing on refresh (5s polling is active because at least one run is `queued`/`running`).
**Ideal path**: 1 — the banner text explains it inline the moment the partial failure is polled in; no extra navigation needed.
**Alternate paths**: none found.

### Steps
1. While Priya is scrolled partway down `/runs`, the next SWR poll returns a response with `sourceStatus` containing one `status: "failed"` entry and one `status: "ok"` entry (`hasPartialFailure` true, `allSourcesFailed` false). → An amber banner appears above the list: "Some run history is unavailable. Healthy sources remain visible; pagination is paused until all sources recover."
2. She clicks "Load more" anyway. → `nextCursor` is `undefined` whenever `hasFailure` is true (`list.ts`: `!hasFailure && merged.length > limit`) — the button doesn't render at all once a partial failure is in the current response, so there's nothing to click; the runs she can already see remain visible and interactive.
3. The failing source recovers on a later poll. → `hasPartialFailure` clears, the banner disappears, and `nextCursor` reappears if there are in fact more rows.

### Variations
- The banner's wording is identical regardless of which of the two sources (`background_agent` or `agent_loop`) is the one failing — it never names the affected source, unlike the equivalent `/automations` banners which do name "Single-step" or "Multi-step" specifically.

### Edge Cases
- Rows already loaded from the healthy source stay fully visible and clickable during the degraded window — a partial failure never hides good data, it only prevents fetching *more* of it.

---

## STORY-812: A run's status doesn't match anything the app recognizes

**Type**: short
**Persona**: Priya, after a schema/enum change ships and an old or out-of-band-written row has a native status the classifier has never seen.
**Goal**: Notice the run is in an ambiguous state rather than assuming it's a normal warning.
**Preconditions**: A run's `nativeStatus` doesn't match any branch in `normalizeRunStatus` (e.g., a `background_agent` row with a status value that's only valid for a different source, or a genuinely unrecognized string).
**Ideal path**: 2 — `view=attention` still catches it (health `!== "ok"` is satisfied), then the detail page's `Attention: unknown status` row makes it explicit.
**Alternate paths**: none found — there is no filter specifically for `unknown_status`.

### Steps
1. Priya opens `/runs?view=attention`. → The row shows state badge `Unknown` and health badge `Unknown`, styled with the same amber/warning classes as a real `Warning` health (`RunDimensions`'s conditional only special-cases `needs_attention` for the red/destructive styling; `unknown` falls through to the amber branch).
2. She opens the detail page. → `Attention: unknown status` (`words("unknown_status")`), `Native status:` shows the literal unrecognized string exactly as stored, and `Outcome:` also reads `Unknown` — nothing here is treated as a failure, but nothing confirms success either.

### Variations
- Because the amber styling is shared between real `warning` health and `unknown` health, a fast visual scan of the list can't tell "this is a known, mild issue" apart from "the app has no idea what this run's status means" — only the badge *text* differs.

### Edge Cases
- This path requires either a data/migration bug or a source starting to emit a new native-status string before the classifier is updated for it — the code comments in `status.ts` (the `#1241`/`#1247`/`#1288` notes) describe exactly this happening three times before: a widened status enum silently degrading to `unknown` until a branch was added. It is a real, previously-hit failure mode, not a hypothetical one.

---

## STORY-813: "Load more" on a repository-filtered loop view returns fewer rows than expected

**Type**: medium
**Persona**: Priya, filtering `/runs` to `agent_loop` runs in one repository and paging through a long history.
**Goal**: Get a complete picture of that repository's loop run history without missing runs.
**Preconditions**: `automationSource=agent_loop` plus a `repoOwner`/`repoName` filter; some of the candidate `agentLoopRuns` rows have a deleted/renamed parent loop, so their repository comes from a frozen JSON snapshot (`executionSnapshot`) rather than the live `agentLoops` table.
**Ideal path**: N/A — there's no shorter path than repeatedly clicking "Load more"; this story documents a known limitation, not a task to optimize.
**Alternate paths**: none found.

### Steps
1. Priya applies `repoOwner`/`repoName` plus `automationSource=agent_loop`. → `createLoopRunLoader` in `store.ts` queries a broader SQL candidate set (matching either the live `agentLoops.repoOwner/repoName` or the JSON path `executionSnapshot #>> '{repository,owner}'`), bounded by `LIMIT query.limit + 1`, and *then* re-filters in JavaScript against the frozen, hash-verified evidence.
2. If several of the SQL-matched rows get filtered out in the JS pass (their live-table repo didn't actually match, or their frozen snapshot did), the page she sees can come back shorter than the limit even though more matching rows exist further down.
3. She clicks "Load more". → The cursor is still deterministic (based on `createdAt`/`id` of the last *returned* row), so continuing to page eventually surfaces the rest — it just takes more clicks than the apparent row count would suggest.

### Variations
- This under-fill risk is specific to `agent_loop` with a repository filter; the `background_agent` loader filters entirely in SQL and has no equivalent gap.

### Edge Cases
- The code comment in `store.ts` is explicit about the tradeoff: "corrupt JSON is never trusted for inclusion or display... corrupt candidates can under-fill a page; the cursor remains deterministic and a later page can still be requested." This is a documented, accepted limitation, not an accidental bug — but it's invisible from the UI, which shows no "there may be more just below what's visible" hint beyond the generic "Load more" button.

---

## STORY-814: Starting from Automations instead of Runs

**Type**: long
**Persona**: Priya, who thinks of her work in terms of "automations I own" first and only cares about individual runs when one misbehaves.
**Goal**: Go from her automations list straight to the evidence for the one that just failed, without detouring through `/runs` at all.
**Preconditions**: An automation (either kind) exists whose `latestRun.outcome` is `failed`.
**Ideal path**: 2 — `/automations` → click the "Latest run" link on the card. This is *shorter* than the `/runs`-first path in STORY-801 precisely because she doesn't need to filter a cross-automation feed down to one automation first; the tradeoff is she only sees the *latest* run this way, not run history.
**Alternate paths**: She could open the automation's detail page (`item.detailUrl`) and find the same run in its own run-history list; both `/automations/background-agent/{agentId}` and `/automations/agent-loop/{loopId}` embed one.

### Steps
1. Priya opens `/automations` (default, unfiltered). → Cards list every automation with a `Latest run` field in the stats grid.
2. On the automation she cares about, the `Latest run` field reads the outcome or state (`item.latestRun.outcome ?? item.latestRun.state`, e.g. `failed`) as a link. → She clicks it.
3. `item.latestRun.detailUrl` is already the canonical run URL (`/runs/background-agent/{runId}` or `/runs/loop/{runId}`, built the same way `lib/runs/adapters.ts` builds every other run's `detailUrl`). → She lands directly on the same evidence page STORY-801 reaches in step 4, having skipped `/runs` entirely.

### Variations
- If the automation's *latest* run isn't the one that's broken (an older run failed, but the newest one succeeded), this shortcut doesn't help — she has to fall back to the automation's detail page's full run-history list, or to `/runs?automationId=...&automationSource=...`.
- Compare hop counts honestly: this path is 2 steps because it starts already scoped to one automation. STORY-801's 4-step path starts from "something is wrong somewhere" with no automation identified yet — the two aren't solving the same problem, even though they end at the same kind of page.

### Edge Cases
- The `Latest run` field shows `"No runs yet"` (plain text, not a link) when `item.latestRun` is `null` — an automation that's never executed has no evidence to jump to, which is correct but means this shortcut simply isn't available for freshly created automations.
