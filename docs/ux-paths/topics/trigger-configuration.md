# UX Stories: Trigger Configuration for Loops

**Feature area:** Agent Loops — cross-page flow between loop detail and
background-agent trigger creation.

**Grounding:** `apps/web/app/loops/[loopId]/loop-detail.tsx:335-368`,
`apps/web/app/settings/background-agents-section.tsx`,
`apps/web/lib/background-agents/agent-spec.ts`,
`apps/web/lib/db/schema.ts:956-1015`.

---

## STORY-001: First-time user discovers triggers exist

**Type**: short
**Persona**: Priya, a backend engineer who just created her first loop and
wants it to run automatically on every pull request.
**Goal**: Understand how to make the loop fire when a PR is opened.
**Preconditions**: Loop "fix-pr-style" (`loopId: abc123`) exists with
`status: active`. No triggers attached. User is on `/loops/abc123`.

### Steps

1. Priya scrolls the right sidebar on the loop detail page and sees a
   "Triggers" section. It reads: "No triggers configured. Manage triggers in
   Background agents settings." → She clicks the underlined "Background agents
   settings" link (`loop-detail.tsx:343-348`).
2. Browser navigates to `/settings/background-agents`. The page title reads
   "Background agents" with a create form already open above the Agents list.
   Priya expects to be on a triggers-specific page; instead she's looking at a
   general create form for a *Background agent*, not a loop trigger. → She
   pauses, unsure whether this is the right place.
3. She inspects the create form. She doesn't see any field to associate this
   agent/trigger with her loop "fix-pr-style". → Priya fills out the form as
   a standalone background agent because there is no loop-binding affordance.

### Variations

- User is on mobile: the sidebar section may be below the fold, requiring
  significant scrolling before the trigger state is discovered.
- User has multiple loops: the link still leads to `/settings/background-agents`
  with no context about which loop they came from.

### Edge Cases

- If `BACKGROUND_AGENTS_ENABLED` is not set to `true`, the readiness section
  on `/settings/background-agents` shows a failing check, blocking the user
  before they can create anything.

### UX Friction Observed

- `loop-detail.tsx:344` — The link href is `/settings/background-agents`, a
  global page, with no `?loopId=abc123` query parameter or pre-selection. The
  user arrives with zero context about which loop they wanted to attach to.
- `background-agents-section.tsx:433-619` — The create form has no "Loop"
  field whatsoever; creating an agent here creates an `agentId`-bound trigger,
  not a `loopId`-bound trigger. The two concepts are architecturally distinct
  (`schema.ts:960-966`) but the UI treats them as the same surface.

---

## STORY-002: Setting up a cron trigger for a loop (happy path via API)

**Type**: medium
**Persona**: Marcus, a platform engineer comfortable with APIs, who wants the
loop "nightly-lint" (`loopId: def456`) to run every night at midnight UTC.
**Goal**: Attach a `schedule.cron` trigger that fires the loop on a schedule.
**Preconditions**: Loop exists with `status: active`. User knows the loop ID.
No existing triggers.

### Steps

1. Marcus opens `/loops/def456`. The Triggers section sidebar shows: "No
   triggers configured. Manage triggers in Background agents settings." He
   clicks the link. → Arrives at `/settings/background-agents`.
2. He sees the create form defaulting to Trigger = "Pull request". He changes
   the Trigger dropdown to "Schedule" (`triggerLabels["schedule.cron"]`,
   `agent-spec.ts:91-98`). → A new "Schedule" input appears
   (`background-agents-section.tsx:525-540`), placeholder `@hourly`.
3. He types `0 0 * * *` into the Schedule field. He fills Name = "Nightly lint
   cron", Owner = `acme`, Repo = `platform`, Instructions = "Run lint and
   typecheck." He leaves Output mode as "None". → The "Create" button
   becomes enabled because `isStepValid(form, "test")` passes
   (`agent-spec.ts:328-335`).
4. He clicks "Create". The form submits to `POST /api/background-agents` with
   an `agentId`-bound trigger — **not** a `loopId`-bound trigger. A new
   background agent named "Nightly lint cron" appears in the Agents list. →
   Marcus navigates back to `/loops/def456`. The Triggers section still shows
   "No triggers configured." His schedule agent exists but does not point to
   the loop.
5. Marcus realizes the gap: background agents created via the UI use `agentId`,
   not `loopId`. The only way to create a `loopId`-bound trigger is via direct
   database access or a future API that does not exist yet
   (`/api/agent-loops/[loopId]/triggers` is absent from the route tree). →
   Marcus either accepts that the agent runs its own instructions (not the
   loop) or files a support request.

### Variations

- User uses cron shorthand: `@daily` — `validateSchedule` in
  `schedule-presets.ts` must accept it for `isStepValid` to pass on the
  "conditions" step (`agent-spec.ts:319-321`).
- User enters invalid cron `0 0 * *` (missing field) — form submit stays
  disabled; no error message is shown explaining what's wrong beyond
  the disabled state.

### Edge Cases

- Schedule field is left blank when trigger kind is `schedule.cron`:
  `isStepValid(form, "conditions")` returns false, the Create button is
  disabled, and no error label appears inline.
- User wants `@monthly` cron but the shorthand isn't recognized: depends on
  `validateSchedule` implementation in `schedule-presets.ts`.

### UX Friction Observed

- `background-agents-section.tsx:605` — The Create button is disabled silently
  when the schedule field is invalid. No inline validation message tells the
  user what went wrong.
- `background-agents-form.ts:9-23` — `loopId` is absent from `FormState`.
  There is no way to bind a new background agent to a loop through this UI.
- `agent-spec.ts:100-107` — `flowSteps` labels ("Trigger", "Conditions",
  "Instructions", "Permissions", "Outputs", "Test") are rendered as decorative
  pills at the top of the form (`background-agents-section.tsx:422-430`) but
  are not clickable steps — they provide no navigation, creating a false mental
  model of a multi-step wizard.

---

## STORY-003: Attaching a PR trigger to a loop (discovering the architectural gap)

**Type**: long
**Persona**: Camille, a staff engineer who read the docs and understands loops
and background agents are separate systems. She wants PRs opened against
`acme/api` to fire her "review-pr" loop (`loopId: ghi789`).
**Goal**: Create a `github.pull_request` trigger that fires loop `ghi789`
when a PR is opened or reopened against `main`.
**Preconditions**: Loop "review-pr" is `active`. No triggers. GitHub App is
installed on `acme/api`. User is authenticated.

### Steps

1. Camille opens `/loops/ghi789`. She reads the Triggers sidebar: "No
   triggers configured. Manage triggers in Background agents settings." She
   notes the text says "Background agents settings" — not "Loop triggers" — and
   opens it in a new tab. → `/settings/background-agents` loads.
2. She sees the Readiness section showing all checks green (feature enabled,
   repo allowed). → She proceeds to the create form.
3. She sets: Name = "PR review trigger", Trigger = "Pull request" (default),
   Owner = `acme`, Repo = `api`, Actions = `opened, reopened`, Branches =
   `main`. She writes minimal instructions: "Run the review-pr loop." →
   She doesn't see a "Loop" picker anywhere in the form.
4. She clicks Create. → A background agent is created at
   `POST /api/background-agents` with `agentId` set, `loopId` null. It appears
   in the Agents list as "PR review trigger" with a "Pull request" trigger
   badge.
5. She returns to `/loops/ghi789`. The Triggers sidebar still reads "No
   triggers configured." She refreshes — still empty. → Camille begins
   debugging. She checks the browser network tab and sees `GET
   /api/agent-loops/ghi789` returns `{ triggers: [] }` because
   `listTriggersForLoop` queries by `loopId` (`store.ts:755-756`) and the
   trigger she created has `loopId: null`.
6. Camille searches the codebase and finds `backgroundAgentTriggers.loopId`
   exists in the schema (`schema.ts:966`) but the settings UI form has no field
   for it (`background-agents-section.tsx:433-619` — no loopId input). She
   discovers there is no `/api/agent-loops/[loopId]/triggers` route either. →
   She concludes the `loopId` FK path is only usable via raw SQL or a future
   API endpoint, not the current UI.
7. Camille's workaround: she edits the background agent's instructions to say
   "You are a proxy for loop ghi789 — call the loop run API." This is manual,
   error-prone, and defeats the purpose of having a loop.

### Variations

- User adds label filter `bug` to the PR trigger: the "Labels" condition field
  appears for `github.pull_request` (`fieldsForTrigger`, `agent-spec.ts:229`).
  This is correctly scoped but still creates an `agentId`-bound trigger.
- User tries to edit the created agent's trigger to add a loopId: the edit
  form (`startEditing` → `buildFormFromAgent`) also has no loopId field
  (`background-agents-section.tsx:264-268`).

### Edge Cases

- If the loop is in `draft` status when the trigger eventually fires (future
  fix), the dispatcher would check `loop.status` and skip the run — but the
  user has no indication of this on the trigger configuration page.
- Two users set up agents pointing to the same loop id in instructions: the
  system would run two background agents, not one loop run.

### UX Friction Observed

- `loop-detail.tsx:341-349` — Empty triggers state copy says "Manage triggers
  in Background agents settings" but the linked page cannot create
  `loopId`-bound triggers. The user is sent on an impossible journey.
- `background-agents-section.tsx:433-619` — No `loopId` field means the UI
  cannot express the database-level relationship. The schema (`schema.ts:960-
  966`) supports it but the form does not.
- `apps/web/app/api/agent-loops/[loopId]/` — Only `route.ts` and `runs/`
  exist. There is no `triggers/route.ts`. The trigger management API surface
  for loops is absent.

---

## STORY-004: User edits an existing trigger's schedule from the settings page

**Type**: short
**Persona**: Diego, a DevOps engineer who set up a cron-based background agent
and wants to change its schedule from hourly to every 6 hours.
**Goal**: Update `schedule` from `@hourly` to `0 */6 * * *` on an existing
agent.
**Preconditions**: Background agent "Hourly health check" with a
`schedule.cron` trigger exists and appears in the Agents list on
`/settings/background-agents`.

### Steps

1. Diego navigates to `/settings/background-agents`. He finds "Hourly health
   check" in the Agents list and clicks "Edit" (`background-agents-section.tsx
   :706-710`). → The create/edit form populates via `buildFormFromAgent`,
   heading changes to "Edit agent".
2. The Schedule input shows `@hourly` (restored from the trigger row). He
   clears it and types `0 */6 * * *`. → The field updates.
3. He clicks "Save". → `PATCH /api/background-agents/{agentId}` fires.
   The form resets to defaults and a success message "Background agent
   updated." appears. The Agents list re-fetches.
4. Diego confirms the trigger badge still shows "Schedule" and the schedule
   value updated. → Success.

### Variations

- User clears the schedule entirely and tries to save: `isStepValid` fails on
  "conditions" step, Save button stays disabled.
- User switches the trigger kind from "Schedule" to "Pull request" while
  editing: the Schedule field disappears (`background-agents-section.tsx:525`
  conditionally renders only when `form.triggerKind === "schedule.cron"`), and
  the stale `form.schedule` value is reset to `""` (`agent-spec.ts:472-474`).

### Edge Cases

- Agent has multiple triggers (schema allows up to 10 via
  `createBackgroundAgentSchema`, `types.ts:106-119`): `buildFormFromAgent`
  reads only `trigger = agent.triggers[0]` (`agent-spec.ts:339`), so triggers
  beyond index 0 are silently dropped on edit-save.

### UX Friction Observed

- `agent-spec.ts:339` — `buildFormFromAgent` reads only the first trigger.
  Editing any agent with multiple triggers will destroy all but the first on
  save.
- `background-agents-section.tsx:300-305` — Success message "Background agent
  updated." gives no confirmation of which specific field changed or what the
  new schedule value is.

---

## STORY-005: User disables a loop trigger without deleting it

**Type**: short
**Persona**: Fatima, a product engineer who wants to pause automatic PR
reviews during a freeze week without losing the trigger configuration.
**Goal**: Disable a `github.pull_request` background agent so no new runs
fire during the freeze, then re-enable it after.
**Preconditions**: Background agent "PR auto-review" with status `enabled`
appears in the Agents list.

### Steps

1. Fatima opens `/settings/background-agents` and clicks "Edit" on "PR
   auto-review". → Form loads with the Enabled toggle set to on.
2. She flips the "Enabled" toggle to off (`background-agents-section.tsx
   :489-497`). → Toggle visually turns off; `form.enabled` becomes false.
3. She clicks "Save". → `PATCH /api/background-agents/{agentId}` sends
   `{ status: "disabled" }`. The Agents list refreshes and the StatusPill
   shows "disabled" (grey badge, `background-agents-section.tsx:201-219`).
4. The following week Fatima edits again, re-enables the toggle, and saves. →
   Agent returns to `status: "enabled"`.

### Variations

- User wants to disable only one trigger on a multi-trigger agent: no
  per-trigger enable/disable is available in the UI. The whole agent must be
  disabled or the trigger deleted.

### Edge Cases

- A run already queued before disabling: it will still execute because the
  dispatcher checks status at dispatch time, not on dequeue. The disabled
  state prevents future matches only.
- Loop-bound trigger status: because loop-bound triggers (`loopId` set) are
  not surfaced in the Agents list (`store.ts:245-247`), Fatima has no way to
  disable a loop-bound trigger from the UI even if one existed.

### UX Friction Observed

- `background-agents-section.tsx:201-219` — StatusPill for a disabled agent
  falls into the default grey case (no explicit "disabled" color match). The
  badge text says "disabled" in grey, which is easy to miss in a long list.
- `loop-detail.tsx:357` — On the loop detail page, trigger StatusPill uses the
  same `StatusPill` component and shows the raw `trigger.status` value
  ("enabled"/"disabled") in lowercase. If a loop-bound trigger were disabled,
  the user would see a grey pill with no affordance to re-enable it from this
  page.

---

## STORY-006: User checks run history after a PR trigger fires

**Type**: medium
**Persona**: James, a team lead who configured a "PR auto-review" background
agent and wants to verify it ran on a specific PR opened today.
**Goal**: Find the background run for PR #47 and confirm it succeeded.
**Preconditions**: Background agent "PR auto-review" with `github.pull_request`
trigger is enabled. PR #47 was opened on `acme/api` within the last hour.

### Steps

1. James opens `/settings/background-agents`. He scrolls past the create form
   and the Agents list to the "Run history" section
   (`background-agents-section.tsx:778-851`). → Last 8 runs are listed
   (`/api/background-agent-runs?limit=8`).
2. He sees a row showing: "Pull request" (trigger label from
   `triggerLabels[run.triggerKind]`), a green "succeeded" pill, and
   `acme/api · PR #47` with a date. → He clicks "Details".
3. Browser navigates to `/background-runs/{runId}`. → Run detail page shows
   the full execution trace.
4. James navigates back (`← ` or browser back) and also wants to check if the
   loop "review-pr" ran as well. He goes to `/loops/ghi789` and checks the
   Runs list. → No entry appears for PR #47 because the background agent run
   was an `agentId`-bound agent, not a loop run. The loop's run list (`GET
   /api/agent-loops/ghi789/runs`) is empty.

### Variations

- More than 8 runs have fired: the run history shows only the 8 most recent.
  There is no "load more" or pagination in the Run history section
  (`background-agents-section.tsx:778-851`).
- Run has an `outputUrl` (e.g., a PR link): an "Output" button appears next to
  "Details" (`background-agents-section.tsx:832-837`).

### Edge Cases

- Run's `triggerKind` is not in `triggerLabels` (schema drift): the fallback
  `run.triggerKind` raw string is displayed (`background-agents-section.tsx
  :814`).
- `errorKind` is set (e.g., `permission_missing`): a red monospace badge
  appears next to the status pill (`background-agents-section.tsx:818-824`).

### UX Friction Observed

- `background-agents-section.tsx:813` — Run history shows `run.source` as a
  raw string ("github", "schedule") without a human label, similar to the loop
  run list (`loop-detail.tsx:95`). Inconsistent with the trigger kind label
  above it.
- Run history limit of 8 with no pagination means users investigating older
  runs must go to `/background-runs` directly (if that route exists) or use
  the API.

---

## STORY-007: User attempts to attach a cron trigger directly from the loop page via the link

**Type**: long
**Persona**: Nadia, a product manager who is not a developer, trying to set
up automatic overnight loop runs without reading documentation.
**Goal**: Make the loop "daily-report" (`loopId: jkl012`) run every night at
8 PM UTC using the link on the loop page.
**Preconditions**: Loop "daily-report" exists and is `active`. No triggers.
User is on `/loops/jkl012`.

### Steps

1. Nadia sees the Triggers section: "No triggers configured. Manage triggers
   in Background agents settings." She clicks the link. → She lands on
   `/settings/background-agents`. The page heading says "Background agents" —
   she expected "Triggers for daily-report".
2. She reads "Readiness" (all green) then the create form above it. She does
   not recognize this as where she should configure a "loop trigger". She
   looks for a dropdown or section labeled "Loop" and finds nothing. → She
   tries the Trigger dropdown and picks "Schedule" thinking this is the right
   kind.
3. She fills: Name = "Evening report", Schedule = `0 20 * * *`, Owner =
   `acme`, Repo = `reports`, Instructions = "Run the daily-report loop." →
   The form does not reject her; the Create button is enabled.
4. She clicks "Create". The agent appears in the Agents list. She copies the
   loop URL from her browser's address bar (`/loops/jkl012`) and pastes it
   into the Instructions field next time, thinking it might help the agent
   "find" the loop. → This has no effect on the system; the agent's
   instructions are passed to an LLM, not a dispatcher.
5. Nadia returns to `/loops/jkl012`. The Triggers sidebar is still empty.
   She hits browser refresh. Still empty. → She gives up and asks an engineer
   for help.

### Variations

- User tries typing the loop ID into the Repo or Name field hoping for
  auto-completion: no completion exists.
- User notices the "Repo" link button on an existing agent in the Agents list
  and clicks it: navigates to `/repos/acme/reports/agents`, which is a
  different page entirely (`background-agents-section.tsx:722-729`).

### Edge Cases

- Loop is in `draft` status: even if a loop-bound trigger were properly created
  and fired, the dispatcher would reject the run because `loop.status !==
  "active"`. The user would need to activate the loop first — but this
  dependency is never surfaced on the trigger creation page.
- User's GitHub App is not installed on `acme/reports`: the `schedule.cron`
  trigger fires by cron, not GitHub webhook, so this does not block the
  schedule agent from running (the cron dispatcher does not check GitHub App
  installation). However, a `github.pull_request` trigger would silently skip
  events from repos without the app installed.

### UX Friction Observed

- `loop-detail.tsx:342-349` — The link text "Background agents settings" does
  not indicate that loop-bound triggers are a separate concept requiring a
  different workflow (or API call) than background agent creation.
- There is no breadcrumb, query-string context, or return link from
  `/settings/background-agents` back to the source loop. Once the user
  navigates away, they lose the loop context entirely.
- `background-agents-section.tsx` — The form flow labels ("Trigger",
  "Conditions", "Instructions", "Permissions", "Outputs", "Test") are passive
  pills with no interactivity (`background-agents-section.tsx:422-430`),
  providing a false wizard affordance that never steps the user through the
  loop-attachment concept.
- `apps/web/app/api/agent-loops/[loopId]/` — No `triggers/route.ts` exists.
  The schema supports `loopId` on `backgroundAgentTriggers` (`schema.ts:966`)
  but no UI or public API endpoint yet exposes the ability to create a
  loop-bound trigger without direct database access.
