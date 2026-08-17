# UX Paths: Workspace Settings & Configuration

Generated from `docs/ux-paths/browser/discovery.md` plus direct reads of
`apps/web/app/settings/**` and `apps/web/app/api/settings/**`,
`apps/web/app/api/inference-profiles/**`. Settings is a two-level shell
(`apps/web/app/settings/layout.tsx`, `settings-nav.tsx`) with four nav groups
defined in `apps/web/app/settings/nav-items.ts`:

- **Account** — Profile, Preferences, Connections, Usage
- **Workspace** — Chat roles, Models, Composio, MCP servers, Skills, Repository settings
- **Advanced** — Runtime profiles, Learnings, Leaderboard
- **Admin** — Admin (admin only; group hidden entirely for non-admins)

## STORY-1001: New teammate tunes Preferences end to end

**Type**: long
**Topic**: Workspace Settings & Configuration
**Persona**: Priya, a new hire on her first day, wants every new chat to behave the way she likes before she touches a real repo.
**Goal**: Set theme, default runtime profile, diff mode, git automation, notifications, a public usage profile, and a global skill — all from one page.
**Preconditions**: Signed in, at least one runtime profile exists (built-in profiles always exist server-side), `username` set on the account.
**Ideal path**: 1 — Preferences is the single page built for this; nothing else covers appearance, notifications, or sharing in one place.
**Alternate paths**: Default model is set on `/settings/models`, not here (Preferences only controls sandbox, runtime profile, and diff mode). Default runtime profile set here is overridden per-repository on `/settings/repositories/[owner]/[repo]` and per-Chat-role on `/settings/agents`, both of which fall back to this value when left blank ("Inherit default" / "Inherited" tag).

### Steps
1. Open `/settings/preferences` → page loads with six sections: Appearance, Defaults for new chats, Git automation, Notifications, Sharing & privacy, Skills.
2. Change **Theme** (Appearance) from System to Dark → applies immediately in this browser only; helper text says it "doesn't follow you to other devices."
3. Open **Default runtime profile** (Defaults for new chats) → dropdown groups options under "Built-in" and "Yours" headings (`groupRuntimeProfileOptions`); pick one → saved via `updatePreferences`, description text updates below.
4. Note **Default sandbox** renders as a static read-only row labeled "Only available option" (Vercel) instead of a dropdown, since `shouldCollapseSingleOption` collapses single-option pickers.
5. Change **Default diff mode** to Split.
6. Turn on **Auto commit & push** (Git automation) → **Auto create PR** switch becomes enabled (it was disabled with helper text "Available once Auto commit & push is on.").
7. Turn on **Public usage profile** (Sharing & privacy) → a read-only URL field appears at `/u/<username>`; click **Copy URL** → button label flips to "Copied" for 1.5s.
8. In **Skills**, add a global skill: enter Repository source `vercel/ai` and Skill name `ai-sdk`, click **Add** → the ref appears in a list with a trash icon; refresh confirms it persisted via `PATCH /api/settings/preferences`.

### Variations
- Turning **Auto commit & push** back off while **Auto create PR** is on: the UI does not auto-disable PR creation on this page (only the per-repository page enforces that invariant server-side per field) — worth confirming the value doesn't end up in an inconsistent state after reload.
- Removing a global skill ref via its trash icon removes it immediately (optimistic via `updatePreferences`).

### Edge Cases
- Adding a duplicate `source`/`skillName` pair (case-insensitive) shows inline error "That global skill has already been added" and does not call the API.
- Runtime profiles fetch failure (`GET /api/settings/runtime-profiles` errors) shows "Failed to load runtime profiles." with a **Retry** button instead of silently falling back to an empty list (regression guard for #1092).
- **Alert sound** row only renders while **Alerts** is on; turning Alerts off hides the sub-row entirely rather than disabling it.

---

## STORY-1002: Connect GitHub across multiple orgs, one needing admin approval

**Type**: long
**Topic**: Workspace Settings & Configuration
**Persona**: Marcus, an engineer whose personal GitHub account and two org memberships (one he admins, one he doesn't) all need the Open Agents GitHub App.
**Goal**: Get the App installed everywhere he needs repo access, and understand why one org is stuck pending.
**Preconditions**: GitHub OAuth account linked (`hasGitHub` true) but the App isn't installed on either org yet.
**Ideal path**: 1 — `/settings/connections` is the only surface that lists personal + every org's install status side by side.
**Alternate paths**: A repo's own settings page (`/settings/repositories/[owner]/[repo]`) shows a one-line "Connected"/"Reconnect required"/"Not connected" summary with a "Connect GitHub" link back to this page — it does not duplicate the org list.

### Steps
1. Open `/settings/connections` → **GitHub** card shows the linked user avatar/login and a status dropdown ("Connected" with a green dot).
2. Click the collapsed "Installed in 0/3 accounts" row (auto-expanded already, since `shouldAutoExpandOrgs` expands whenever coverage is incomplete) → see personal account + 2 orgs listed, each with an `InstallBadge` icon (Ban = No Repository Access for all three).
3. Click **Install** next to the personal account → redirects to `/api/github/app/install?next=/settings/connections`; complete the GitHub install flow and select "All repositories."
4. Return to `/settings/connections` → toast "GitHub App installed" ("Repository access is now configured for the selected account."); the personal row's badge flips to a green Globe icon with tooltip "All Repositories."
5. Click **Install** for the org he admins → selects "Only select repositories" on GitHub → badge becomes amber `ListFilter` ("Select Repositories").
6. Click **Install** for the org he does not admin → GitHub itself requires an admin approval → returns with `?github=request_sent` → toast "Installation request sent" ("An admin needs to approve the installation.").

### Variations
- If the same round trip returns with `?github=pending_sync&missing_installation_id=1`, the toast reads "No new installation detected" ("The app may already be installed. Check the list below.") instead of a generic "pending" message — this is a distinct code path from a plain `pending_sync`.
- Clicking an already-installed org row (not the Install button) opens the GitHub App configuration page in a new tab via `installationUrl`, rather than re-running install.

### Edge Cases
- `?github=link_failed` → toast error "Failed to connect GitHub account" ("Please try again.").
- `?github=app_not_configured` → toast error "GitHub App not configured" ("Contact the administrator.") — an operator-config gap, not a user error.
- `?github=invalid_state` → toast error "Callback expired" ("Please start the installation again.") — stale OAuth state.
- All accounts installed collapses the expandable row back closed on next load (`shouldAutoExpandOrgs` returns false once coverage is complete), so a fully-connected user doesn't see org clutter by default.

---

## STORY-1003: GitHub connection degrades quietly, then needs reconnect

**Type**: short
**Topic**: Workspace Settings & Configuration
**Persona**: An existing user whose GitHub OAuth token silently expired.
**Goal**: Understand why repo actions are failing and fix the connection from Settings.
**Preconditions**: GitHub previously connected; token now expired or the background connection check fails.
**Ideal path**: 1 — `/settings/connections` is the only place with a "Re-authenticate" action.
**Alternate paths**: none found — the reconnect banner only appears here (a transient auth-check failure elsewhere in the app does not sign the user out, per the discovery doc's Auth nuance, so this page is where the fix actually lives).

### Steps
1. Open `/settings/connections` with a token-expired account → the status button shows an amber dot labeled "Reconnect" instead of green "Connected"; a line reads "Your GitHub connection has been disconnected."
2. Click the dropdown → options are "Re-authenticate" and "Disconnect" (no "Manage on GitHub" link, since that requires a working connection).
3. Click **Re-authenticate** → if the failure reason is `installations_missing`, redirects straight to `/api/github/app/install?reconnect=1`; otherwise calls `linkSocial({ provider: "github" })` to redo GitHub OAuth.
4. On success, the card returns to green "Connected" and the org list re-renders.

### Variations
- If only the background **status check** fails (`sync_degraded`) rather than a real disconnect, the label reads "Unverified" (amber) instead of "Reconnect," and the dropdown offers **Retry connection check** in addition to Re-authenticate/Disconnect — retrying just re-runs the check rather than a full OAuth round trip.

### Edge Cases
- Clicking **Disconnect** opens a confirm dialog ("Disconnect GitHub?"); confirming calls `unlinkGitHub()`, revalidates `/api/auth/info`, and shows toast "GitHub disconnected" — or an error toast with the server's specific reason if the unlink call fails.

---

## STORY-1004: Check usage, activity, and rank — Usage nav item redirects to Profile

**Type**: medium
**Topic**: Workspace Settings & Configuration
**Persona**: Dana wants to see how many tokens and how much estimated cost her account has burned this month, and where she ranks on the team leaderboard.
**Goal**: Review token/cost totals, a contribution chart, per-repository breakdown, and her leaderboard position.
**Preconditions**: Account has usage history (sessions with tool calls / tokens).
**Ideal path**: 2 — she clicks "Usage" in the nav (Account group) expecting a usage page; it is a hard redirect to `/settings/profile`, which is the actual page with all the usage data. Landing there directly would be one step shorter, but "Usage" is the discoverable nav label.
**Alternate paths**: `/settings/leaderboard` shows the same rank number in a full ranked table; the Profile page's rank badge and the Leaderboard page revalidate the same SWR key (`LEADERBOARD_RANK_SWR_KEY`) so the two never disagree.

### Steps
1. Click **Usage** in the Account nav group → `apps/web/app/settings/usage/page.tsx` immediately `redirect("/settings/profile")` — the URL bar now shows `/settings/profile`, and the sidebar highlights "Profile," not "Usage" (there is no separate "Usage" nav highlight state).
2. On Profile, review the left sidebar: Total tokens, Estimated cost (with a priced-token-ratio detail line), Messages, Tool calls, and a "Top repositories" list (top 3 by session count / lines changed).
3. Scroll the contribution chart (last ~9 months of daily activity) and drag-select a date range → chart re-queries `/api/usage?from=...&to=...`, and the "Activity" heading swaps to "Activity for <range> · Clear."
4. Below the chart: three ranked lists — Agent split (Main vs Subagents), Top models, Code churn (lines added/removed/total changed) — followed by the Insights section (tracked PRs, merge rate, largest turn, avg tokens/turn, tool calls/turn, cache hit ratio).
5. Open `/settings/leaderboard` separately → filter by Today / 7 days / All time; "Your rank: #N of M" appears above the table when the signed-in user is present in that range's rows.

### Variations
- A brand-new account with zero usage sees "No agent activity yet — start a chat to see usage." instead of the ranked-list grid, but the contribution chart and identity card still render.

### Edge Cases
- `/api/usage` failing shows "Failed to load usage data." on Profile and "Failed to load leaderboard data." on the Leaderboard page — independent SWR calls, independent failure copy.
- If the domain has no leaderboard configured at all (`domainLeaderboard === null`), Leaderboard renders `LeaderboardEmptyState reason="no-domain"` rather than an empty table.

---

## STORY-1005: BYO-key inference profile — create, test, manage its models, then a bad key

**Type**: long
**Topic**: Workspace Settings & Configuration
**Persona**: Yuki has her own Anthropic API key and wants Open Agents to bill her directly for some sessions instead of the shared AI Gateway.
**Goal**: Add the key as an Inference Profile, verify it works, choose which of its models show up in pickers, then see what happens when a key is wrong.
**Preconditions**: On `/settings/models`, no existing inference profiles.
**Ideal path**: 1 — Inference Profiles is the only place to store user-paid provider credentials; nothing else on the Models page substitutes.
**Alternate paths**: none found for *creating* a profile. But once created, which of its models are enabled for pickers can be edited from two places that write the same preference field: the profile card's own **Models** button (opens `ModelManagerDialog` scoped to that profile), and the page-wide **"Models shown in pickers"** list further down the same `/settings/models` page (`EnabledModelsSection`, filterable by "Inference source" = this profile). Both write `preferences.enabledModelIds`.

### Steps
1. Open `/settings/models` → click **New Profile** in the Inference Profiles section.
2. Fill Name "Personal Anthropic," leave Provider as Anthropic, leave Base URL blank (helper text: "Empty uses Anthropic"), enter a valid API key → **Create**.
3. Card appears showing "Anthropic key ending ****1234," status "Untested."
4. Click **Test** → `POST /api/inference-profiles/{id}/test` calls the provider with a live "OK" prompt; on success the card updates to "Verified <timestamp>" (green check) and, if models were discovered, records "Profile test passed. Discovered N models."
5. Click **Models** on the card (badge shows `enabledCount/modelCount`) → `ModelManagerDialog` opens scoped to only this profile's models; deselect one, save → dialog closes on save start (`closeOnSaveStart`).
6. Scroll to **Models shown in pickers** further down the page, set Inference source filter to this profile's name → the same model list appears with the same selection state, confirming both editors share one preference.
7. Toggle the profile's **Enabled** switch off → the Models button and Test button both disable; description on hover explains "Enable this profile before choosing its models."

### Variations
- Editing an existing profile leaves the API Key field blank with placeholder "Leave blank to keep current key" — submitting without retyping it keeps the stored key.
- Provider = OpenAI-compatible requires a Base URL; leaving it blank blocks submit with "Base URL is required for OpenAI-compatible endpoints."

### Edge Cases (bad key)
1. Create a second profile "Broken key" with an intentionally invalid API key, same Anthropic provider.
2. Click **Test** → the live `generateText` call to Anthropic fails; the profile's status becomes "Failed <timestamp>" (red X icon), and `profile.lastTestMessage` renders inline next to the status.
3. Delete confirmation for either profile uses a native `window.confirm("Delete this inference profile?")`, not a styled dialog — confirming calls `DELETE /api/inference-profiles/{id}` and removes the card.
4. If the stored key itself cannot be decrypted server-side (`InferenceProfileResolutionError`, e.g. an encryption-key rotation), Test returns a distinct message telling the user to re-enter the key (`INFERENCE_PROFILE_REENTER_KEY_MESSAGE`) rather than a generic provider error — re-testing without editing the key will fail the same way every time until the key is re-entered via Edit.
5. Testing a profile with zero discoverable models and no fallback test model available returns 400 "Could not discover a model from this inference profile."

---

## STORY-1006: Set the default model, subagent model, and a per-model system prompt

**Type**: medium
**Topic**: Workspace Settings & Configuration
**Persona**: A power user standardizing which model new chats start with, and a different (cheaper) model for explorer/executor subagents.
**Goal**: Change the default chat model, set a distinct subagent model, and pin a custom system prompt to one model.
**Preconditions**: `/settings/models`, at least one gateway model plus an enabled inference-profile model available.
**Ideal path**: 1 — Model preferences is the top section of `/settings/models`, purpose-built for exactly this.
**Alternate paths**: The default model set here is only the *default* — it can be overridden per Chat role on `/settings/agents` ("Inherit default" sentinel falls back to this value), and per session/chat in the composer's own model selector (per the app-wide discovery map). A Model Variant created further down this same page also becomes selectable here, tagged "variant."

### Steps
1. On `/settings/models`, open **Default model** combobox → pick a model; saved via `updatePreferences({ defaultModelId })`.
2. Open **Subagent model** combobox → first option is "Same as main model" (`auto`); pick a distinct cheaper model instead.
3. In **Models shown in pickers**, search "haiku," filter by provider, sort by "Cost low-high," and toggle a few models off — "Clear all" is disabled once only one model remains selected (can't clear below 1).
4. Note the count line: "Showing N of M models" vs "Showing all M models" when the enabled-set is empty (empty set means "show everything," per `getEffectiveEnabledModelIdSet`).
5. In **Custom system prompts**, pick a model via combobox, type a prompt, watch the character counter (`draftPrompt.length / MODEL_SYSTEM_PROMPT_MAX_LENGTH`) → **Save** enables only once the draft differs from the saved value and is under the limit.
6. Saved prompts appear as a clickable list below the textarea, each tagged "prompt" — clicking one loads it back into the editor.

### Variations
- **Reset** clears the prompt for the currently selected model (disabled until a prompt exists for it) rather than deleting the picker selection.

### Edge Cases
- Exceeding `MODEL_SYSTEM_PROMPT_MAX_LENGTH` turns the counter red and disables Save even if the content otherwise differs from the saved value.
- Toggling the last remaining enabled model off is blocked entirely (button disabled) — the picker can never reach zero enabled models via the checkbox rows.

---

## STORY-1007: Create a Model Variant with invalid JSON, then fix it

**Type**: short
**Topic**: Workspace Settings & Configuration
**Persona**: An engineer who wants a named "Claude Adaptive Thinking" preset (a base model plus provider-specific options) reusable across chats without retyping JSON each time.
**Goal**: Create a model variant, hit a validation error, fix it, and confirm it shows up as a selectable model elsewhere.
**Preconditions**: `/settings/models`, at least one base model available.
**Ideal path**: 1 — Model Variants is a dedicated section on the same page; no other surface creates variants.
**Alternate paths**: Once created, the variant appears as a normal option (with an "isVariant" / "variant" badge) in the Default model picker (STORY-1006), the Subagent model picker, per-Chat-role model picker (`/settings/agents`), and the model system prompt picker — one variant, five places it can be selected.

### Steps
1. Click **New Variant** → dialog opens with Name, Base Model (searchable combobox), and a Provider Options textarea prefilled `{}`.
2. Enter Name "Claude Adaptive Thinking," pick a base model, type malformed JSON in Provider Options (e.g. trailing comma) → click **Create Variant** → inline error "Provider options must be valid JSON"; dialog stays open.
3. Fix the JSON to `{"reasoningEffort": "medium"}` → **Create Variant** succeeds; card appears showing the base model name and "1 option" with a hover tooltip showing the key/value.
4. Click the pencil icon to edit → change the option value → **Save Changes**.
5. Click the trash icon → native `window.confirm("Delete this model variant?")` → confirm removes it.

### Variations
- Provider Options accepting a JSON array or primitive (not an object) is rejected with "Provider options must be a JSON object" even though it's syntactically valid JSON.

### Edge Cases
- Built-in variants (`isBuiltInVariant(variant.id)`) render a static "Built-in" badge instead of edit/delete icons — they cannot be modified from this UI at all.

---

## STORY-1008: Build a Composio tool profile and set it as the Main role's default

**Type**: medium
**Topic**: Workspace Settings & Configuration
**Persona**: An admin wants every new Session's Main role to start with Gmail and Linear already connected, without every teammate reconfiguring it.
**Goal**: Connect toolkits, bundle them into a named Tool profile, and set it as Main's default with Session override allowed.
**Preconditions**: `/settings/composio`, Composio configured and available (`status.configured && status.available`).
**Ideal path**: 1 — Composio settings is the only place Tool profiles and Chat-role defaults are configured.
**Alternate paths**: Per-repository tool access (`/settings/repositories/[owner]/[repo]`, "Tool access" group) uses the exact same `ComposioWorkspaceSettingsPanel` component as the in-session workspace settings panel — meaning tool access can be edited from Composio settings (profile-level), repository settings (repo-level block/allow), or live inside an active chat session, and the three do not all edit the same field (profiles vs. per-repo policy vs. per-session override).

### Steps
1. Open `/settings/composio` → the top `ReadinessVerdict` shows current status with a manual **Refresh** action.
2. In **Connect tools**, search and connect Gmail via `ComposioToolCatalog` → it stays pinned there once connected.
3. In **Tool profiles**, click **New profile** → an inline editor expands at the bottom of the list (not a modal); type Name "Support triage," pick toolkits via `ComposioToolkitPicker` → hint "Select at least one tool to save this profile" disappears once one is picked.
4. Expand **Advanced** (closed by default) → toggle **Workbench** (include Composio hosted workbench tools) and **In-chat connection tools** (`allowInChatConnectionManagement` — lets agents create connection links mid-run) → optionally paste toolkit=auth_config_id / toolkit=connected_account_id lines for a specific account.
5. Click **Save** → toast "Profile created"; row collapses back to the list showing a logo strip + tool-name text + "N tools" count.
6. In **Chat role defaults**, set Main's profile Select to "Support triage" → toast "Chat role default updated." Leave **Session override** on so an individual Session can still swap tools for itself without changing the saved default.
7. Note the tip banner "set a default profile for Main so new Sessions start with tools" disappears once Main has a default assigned.

### Variations
- Editing an existing profile row expands the same inline editor in place (row → editor → Save/Cancel/Delete), rather than opening a separate "new" form.

### Edge Cases
- **New profile** button is disabled entirely when `isComposioAvailable` is false (Composio not configured or unavailable) — there is no way to start creating a profile until that resolves.
- Deleting a profile that's currently a Chat role default removes it from the profile list; the Select for that role would need re-picking on next view (verify what its value renders as when the referenced profile no longer exists).

---

## STORY-1009: Bring your own Composio auth config

**Type**: short
**Topic**: Workspace Settings & Configuration
**Persona**: An engineer whose org already has its own OAuth app registered in Composio and wants sessions to use that app's credentials instead of Composio's shared connection.
**Goal**: Paste an existing Auth config ID and generate a connection link.
**Preconditions**: `/settings/composio`, Composio available, an Auth config ID already created in the Composio dashboard.
**Ideal path**: 1 — this is the only in-app flow for pasting a pre-existing auth config ID.
**Alternate paths**: none found — connecting via a *toolkit picker* (STORY-1008's "Connect tools" catalog) uses Composio's shared auth instead; this section is explicitly demoted as "(advanced)" for the bring-your-own case.

### Steps
1. On `/settings/composio`, scroll to **Use your own login credentials (advanced)** ("Skip Composio's shared connection and authenticate this app with your own account instead.").
2. Click **Advanced — bring your own auth config** disclosure → reveals Auth config ID, Alias (optional), and a **Connect** button.
3. Paste the Auth config ID (`ac_...`) from the Composio dashboard link provided inline, type an alias "work-gmail" → **Connect** is disabled until the Auth config ID is non-empty.
4. Click **Connect** → `POST /api/composio/connect` returns a `redirectUrl`; a link "Open Composio connection link" appears below the form.
5. Click it (opens in a new tab) → complete the OAuth flow on Composio's side.

### Edge Cases
- If Composio isn't available, both the Auth config ID and Alias inputs and the Connect button are disabled.
- A failed connect call surfaces its message inline via `actionError` at the bottom of the whole Composio page, not scoped to this subsection.

---

## STORY-1010: Register an MCP server, edit its headers, then discover tools aren't wired into chat yet

**Type**: short
**Topic**: Workspace Settings & Configuration
**Persona**: An engineer with an internal MCP tool server wants its tools available to agents.
**Goal**: Register the server with an auth header, confirm it saved, then learn the current limitation.
**Preconditions**: `/settings/mcp`, at least one internal MCP server URL and bearer token in hand.
**Ideal path**: 1 — MCP servers is the only registration surface.
**Alternate paths**: none found.

### Steps
1. Open `/settings/mcp` → empty state: "Register an MCP server to bring its tools to your agents." plus a smaller line "Tools become available in chats in an upcoming update." linking to a GitHub tracking issue.
2. Click **Add server** → inline editor (not a dialog) with Name, URL, Transport (HTTP Streamable or SSE), and an Auth headers list.
3. Enter Name "internal-tools," URL `https://mcp.example.com/mcp`, add a header row (`Authorization` / `Bearer ...`, value masked as a password field) → **Register** is disabled until Name and URL are both non-empty.
4. Click **Register** → `POST /api/settings/mcp-servers`; toast "Server registered"; row collapses showing name, host, an HTTP badge, and "1 header" badge.
5. Click the pencil icon to re-expand → header rows are pre-filled as `[key, ""]` (values are write-only) with a note "Header values are write-only; re-enter to replace." Change nothing and Save → since `headersModified` is false, headers are omitted from the PATCH entirely so the stored secret is not overwritten with blanks.
6. Toggle the row's **Enabled** switch off → `PATCH` with `{ enabled: false }`, no confirmation needed.

### Variations
- Submitting an invalid URL returns 400 with field errors; the URL input shows the server's specific message inline rather than a generic toast.

### Edge Cases
- Deleting uses an inline two-step confirm (trash icon → "Confirm" / "Cancel" text buttons in place, no modal) rather than a dialog.
- Despite successful registration, the empty-state copy is explicit that tool invocation in chats is not yet live ("in an upcoming update") — a user who registers a server and then goes looking for its tools in a chat's tool picker will not find them; this is a known, documented gap rather than a bug to report.

---

## STORY-1011: Author a skill by hand, then AI-generate a draft

**Type**: long
**Topic**: Workspace Settings & Configuration
**Persona**: A teammate wants a reusable `/code-review` instruction her agents can run like a tool, and separately wants AI's help drafting a second one she hasn't thought through yet.
**Goal**: Create one skill manually, generate a second with AI, review/edit the draft, and manage invocation options for both.
**Preconditions**: `/settings/skills`.
**Ideal path**: 1 — this is the only surface for locally-authored, AI-draftable skills.
**Alternate paths**: **Global skills** (a completely different mechanism, configured on `/settings/preferences` under the "Skills" group) reference a skill by name from an external GitHub repo (`owner/repo` + skill name) and are loaded into every new session — they are not edited or listed here, and a repo-defined skill with the same name wins over a global one. Do not confuse the two: this page's skills are locally authored text; Preferences' global skills are pointers to skills defined in someone else's repo.

### Steps
1. Open `/settings/skills` → empty state (`Empty` component): "No skills yet" / "Create a reusable instruction your agents can run, or let AI draft one for you." with a **New skill** button.
2. Click **New skill** → dialog opens; fill Name (auto-slugified on blur via `slugifySkillName`), Description, and Instructions (Markdown) manually → **Create skill**.
3. Card appears as `/code-review` with description, no "AI draft" chip (source stays "manual"), and chips for any non-default invocation settings.
4. Click **New skill** again → this time, type a prompt in the **Generate with AI** panel: "Review a React component for accessibility issues and suggest fixes" → click **Generate draft**.
5. `POST /api/settings/skills/generate` returns `{ skill: { name, description, body } }` → Description and Instructions fields populate; Name only fills if it was still empty; `source` flips to "generated"; toast "Draft generated. Review and tweak before saving."
6. Edit the generated Instructions slightly, then toggle **Invocable with /slash** off and **Model can invoke automatically** stays on → **Create skill**.
7. New card shows an "AI draft" chip (Sparkles icon) and a "No /slash" chip.
8. Toggle either skill's enabled Switch off → dims the card (opacity) and disables it for new chats; toggle back on.

### Variations
- Editing an existing skill reopens the same dialog pre-filled from `EditableSkill`, including its recorded `source` ("manual" vs "generated") — editing a generated skill's body by hand does not revert its source back to "manual."

### Edge Cases
- Generate failing (network error or non-2xx) shows a toast "Couldn't generate a draft. Try again." and leaves all fields untouched — no partial overwrite.
- Submitting with an invalid slug, empty description, or empty body blocks with an inline error before any network call (`skillNameSchema` validation client-side).
- Deleting a skill uses `window.confirm('Delete the "/<name>" skill?')` — native browser confirm, not a styled dialog, unlike Composio/runtime-profile deletes which use styled confirmations.

---

## STORY-1012: Customize Main's model and tools, leave Explorer inheriting defaults

**Type**: long
**Topic**: Workspace Settings & Configuration
**Persona**: A team lead wants the Main chat role to use a stronger model with GitHub write permissions, while Explorer/Executor/Design stay on inherited defaults to keep costs down.
**Goal**: Override Main's model, instructions, external tools, GitHub permissions, and runtime profile; leave the other three roles alone; reset Main back to defaults later.
**Preconditions**: `/settings/agents` ("Chat roles" in the nav), four role cards: Main, Explorer, Executor, Design.
**Ideal path**: 1 — Chat roles is the only per-role override surface (the page's own description clarifies: "Webhook and scheduled coding work lives in Automations" — background agents configure their own model/tools separately, not through this page).
**Alternate paths**: Model is also chosen at three other layers that this page's "Inherit default" sentinel falls back through: the account-wide default model (`/settings/preferences` → actually `/settings/models`), a Model Variant (STORY-1007), and the chat composer's own per-message model selector (which can further override a role's setting for a single turn, per the app-wide chat loop). Runtime profile similarly falls back to the Preferences default, and can also be overridden per-repository (STORY-1013).

### Steps
1. Open `/settings/agents` → four `SettingsSection` cards, each showing a collapsed summary grid: Model, External tools, Instructions (Built-in/Custom), Runtime (with "Custom" badges where overridden).
2. On the **Main** card (subtitle "Session coordinator"), click **Edit** → inline editor expands below the summary.
3. Change **Model** from "Inherit default" to a specific model.
4. In **External tools**, pick two connected Composio toolkits (help text: "Built-in file editing & commands are always on.").
5. Type custom **Instructions**, or expand to the full-screen editor via the expand affordance for a longer prompt.
6. Because this is the Main role only, GitHub permission toggles are visible (githubToolsEnabled, toolAuthoringEnabled) — these fields do not appear on Explorer/Executor/Design's editors at all.
7. Set **Runtime profile** to a specific saved profile instead of "Inherit default."
8. Click **Save** → `PATCH /api/settings/agents` with `{ role: "main", ... }`; toast "Main role updated."; editor collapses; summary grid now shows "Custom" badges on Model, Runtime, and Instructions.
9. Leave Explorer's card collapsed and untouched — its Model cell reads "Inherits Main" specifically (not "Default"), a distinct label from the other three roles' plain "Default."

### Variations
- Clicking **Reset to default** inside an expanded editor calls `DELETE /api/settings/agents` with `{ role }`, shows toast "<Role> role reset to defaults.", and collapses the card back to inherited values — separate from Cancel, which discards unsaved edits without resetting anything server-side.

### Edge Cases
- The External tools cell reads a distinct "None assigned" label/hint (`EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL/HINT`) rather than a bare "None" when a role truly has zero tools, versus inheriting the parent's tools.
- Explorer's "Inherits Main" model label is specific to that role — Executor and Design do not inherit from Main, they inherit the account default, so confirm their collapsed label reads differently before assuming all three non-Main roles behave the same.

---

## STORY-1013: Override a repository's git automation and runtime, then reset everything

**Type**: long
**Topic**: Workspace Settings & Configuration
**Persona**: A maintainer wants one specific repo to always full-clone, run on a bigger sandbox, and skip auto-PR — different from every other repo's defaults — then later decides to undo all of it at once.
**Goal**: Override several per-repo fields, confirm the "Inherited" tags disappear and "Custom" state persists, then reset to defaults with a typed confirmation.
**Preconditions**: `/settings/repositories/[owner]/[repo]` for a repo the user has access to; GitHub connected.
**Ideal path**: 1 — per-repository overrides only exist on this page.
**Alternate paths**: Auto-commit & push / Auto-create PR have global defaults on `/settings/preferences` (STORY-1001) that this page overrides per-repo; Runtime mode/profile has a global default on `/settings/models`-adjacent Preferences page and a per-Chat-role override (STORY-1012) — three layers for the same effective setting, resolved in that precedence. Tool access at the bottom of this page is the exact same `ComposioWorkspaceSettingsPanel` used live inside an active session's workspace settings panel.

### Steps
1. Open the repo's settings page → **General** group: read-only `owner/repo` identity, Default branch input (placeholder shows the resolved/inherited value when unset), "Always create new branch" switch (each field shows an "Inherited" tag until touched).
2. In **Clone & runtime**, toggle **Full clone** on → switch flips immediately (autosaved onChange, not onBlur), "Inherited" tag disappears and a reset (↺) icon appears beside it.
3. Toggle **Prewarm sandbox** on.
4. Change **Runtime mode** to "Managed runtime" → **Runtime profile** select becomes relevant; pick a specific profile.
5. Change **vCPUs** via its select.
6. In **Git automation**, turn **Auto-commit and push** off while **Auto-create PR** was already on → the UI enforces the invariant client-side: turning off auto-commit also flips auto-create-pr off in the same PATCH, since "Auto-create PR cannot be true when Auto-commit & push is false."
7. In **Integrations**, confirm GitHub shows "Connected" (or a "Connect GitHub" link to `/settings/connections` if not), Vercel shows the linked project name or a "Link Vercel project" link, and Composio shows a "Manage tools" link to the Composio settings page.
8. In **Tool access**, use the embedded panel to block one connected toolkit for this repo specifically.
9. In **Danger zone**, type the exact `owner/repo` string into the confirm input (button stays disabled until it matches exactly) → click **Reset to defaults** → `DELETE` clears every override; every field's "Inherited" tag returns and local state re-seeds to null.

### Variations
- Default branch input saves onBlur (not on every keystroke), while every Switch/Select field autosaves immediately onChange — a mixed save-timing pattern worth exercising deliberately (type a branch name, then navigate away without blurring, and confirm whether it persisted).

### Edge Cases
- Attempting to enable Auto-create PR while Auto-commit & push is off: the switch itself is disabled (`aria-disabled`) rather than allowing the click and rejecting server-side.
- The read-only "Tool access for this repository" summary chips (shown when `toolStatuses` is non-empty) are informational only — the actual edit controls live in the separate "Tool access" group below; a user trying to click a summary chip to edit it will find nothing happens.

---

## STORY-1014: Clone a built-in runtime profile and delete a profile that's the current default

**Type**: medium
**Topic**: Workspace Settings & Configuration
**Persona**: An engineer wants a variant of the built-in "Bun + Playwright" profile with one extra setup command, without hand-typing every field from scratch.
**Goal**: Clone a built-in profile into an editable copy, adjust its commands, save it, then delete a different profile that happens to be the account's current Preferences default.
**Preconditions**: `/settings/runtime-profiles`; at least one built-in profile exists (always true) and one user-created profile already set as the Preferences default.
**Ideal path**: 1 — cloning and full CRUD only exist here.
**Alternate paths**: Once saved, the new profile becomes selectable as the account default on `/settings/preferences`, as a per-repository override (STORY-1013), and as a per-Chat-role override (STORY-1012) — three separate places consume what's created here, but none of them can create or edit a profile themselves.

### Steps
1. Open `/settings/runtime-profiles` → two sections: **Your profiles** (editable, or an empty-state CTA if none exist yet) and **Built-in profiles** (read-only reference, expandable to show setup/verification commands).
2. Expand a built-in profile row → see its description, numbered setup and verification commands, and expected tools.
3. Click **Clone** on that row → a **New profile** form opens pre-filled with `"<name> (copy)"` and all the built-in's commands/tools/ports copied in (`builtInProfileToFormState`).
4. Add a second setup command via **Add command**, fill Label/ID/Description/shell command, leave **Required** on (a failing required command blocks the profile in tests and live sessions).
5. Click **Create profile** → validated client-side first (`validateCreateForm`); on success, toast "Profile created," new row appears at the top of "Your profiles."
6. Separately, click into an existing user profile that is the account's current Preferences default, click **Delete** → `DeleteProfileDialog` warns specifically: "This is your current Preferences default — deleting it will leave your default profile unset until you choose another one."
7. Confirm **Delete profile** → toast "Profile deleted"; row disappears.

### Variations
- Cloning a second built-in profile while the clone form is already open and unsaved remounts the form via a bumped `cloneNonce` key, discarding the first clone's in-progress edits without a warning (documented as a P2 fix for "otherwise Clone appears to do nothing" — confirm no silent data loss warning is shown to the user).

### Edge Cases
- Saving with required fields empty shows both an inline error banner and a footer hint ("Fix the field above" / "Fix N fields above") and keeps **Save**/**Create profile** disabled — validation blocks the button rather than allowing a failed submit.
- A `Required` command toggle turned off still runs; only a failing *required* command blocks the profile — an optional command can fail silently by design.

---

## STORY-1015: Enable the learnings agent for a repo and triage its feed

**Type**: medium
**Topic**: Workspace Settings & Configuration
**Persona**: A maintainer wants durable gotchas extracted from merged PRs so future agents don't repeat the same mistakes in this repo.
**Goal**: Enable extraction for one repository, review what it found, override a confidence label, and archive an outdated learning.
**Preconditions**: `/settings/learnings`; GitHub connected with access to the target repo.
**Ideal path**: 1 — Learnings has no other configuration surface.
**Alternate paths**: none found — this is a single-page, single-repo-at-a-time flow ("Enable extraction for one repository at a time").

### Steps
1. Open `/settings/learnings` → **Repository agent** section defaults to "Choose a repository" verdict, Enable switch disabled until a repo is entered.
2. Type Owner and Repository into the two inputs → `GET /api/learnings?repoOwner=...&repoName=...` fires; the `ReadinessVerdict` block updates with a status/headline/detail and a manual refresh button.
3. Toggle **Enable** → `POST /api/learnings` with `{ enabled: true }`; toast "Learnings agent enabled."
4. **Learning feed** section: if empty, shows "No learnings yet - enable the agent for a repo and they'll appear after the next pull request." with a duplicate **Enable learnings agent** CTA inline.
5. Once learnings exist, a caption reads "AI-derived - confidence labels are guidance only; verify each learning through its evidence." above the table.
6. Click a row to open the **Learning detail sheet** → review the pattern text and its evidence; click a feedback control ("Helpful"/"Not helpful") → toast "Feedback noted" either way (logged via `console.info`, not persisted to a visible score).
7. From the table, override one learning's confidence label directly → `PATCH /api/learnings/{id}` with `{ confidence }`; toast "Confidence updated."
8. Archive an outdated learning → `PATCH` with `{ status: "archived" }`; toast "Learning archived"; if that learning was open in the detail sheet, the sheet closes automatically.

### Variations
- The toggle is disabled whenever the verdict's `errorKind` is `event_subscription_missing` (`canToggleAgent`) — a configuration gap upstream of user control, distinct from simply "no repo chosen yet."

### Edge Cases
- Feed fetch failing shows "Failed to load learnings." with a **Retry** button, independent of the Repository agent verdict card's own error state (`feed_request_failed`).
- Feedback submission ("Helpful"/"Not helpful") shows the identical toast text "Feedback noted" for both — there is no visible distinction in the UI between a positive and negative vote landing.

---

## STORY-1016: Non-admin hits /settings/admin directly

**Type**: short
**Topic**: Workspace Settings & Configuration
**Persona**: A regular team member who found `/settings/admin` in a shared link or browser history and opens it out of curiosity.
**Goal**: (Unintentional) — see what happens when a non-privileged user reaches an admin-only route.
**Preconditions**: Signed in, `isAdmin: false`.
**Ideal path**: 0 — there is no intended path; the Admin group in `settings-nav.tsx` is filtered out entirely for non-admins (`visibleNavGroups`), so this can only be reached by typing/pasting the URL.
**Alternate paths**: none found — no nav link, no redirect target, ever surfaces this URL to a non-admin.

### Steps
1. Confirm the left nav has no "Admin" group at all for this account (only Account/Workspace/Advanced sections render).
2. Manually navigate to `/settings/admin` → page returns HTTP 200 (not a 404) and renders normally inside the settings shell (header "Admin" / "Operator tools for managing tokens and access across the workspace." still shows from route metadata).
3. Below the header, `AdminContent` renders `AdminAccessGate` instead of the Danger Zone: a centered icon (ShieldAlert), "Admin tools," and "This area is for workspace admins. You don't have access — that's expected for most people."
4. Click **Back to settings** → returns to `/settings/profile`.

### Variations
- An actual admin visiting the same URL instead sees the real `AdminContent`: a "Danger zone" section with **Revoke all Vercel tokens** (invalidates every user session, redirects the current admin to `/` after 1.5s once done) and **Revoke all GitHub tokens** — both gated behind their own confirm dialogs, with toasts reporting exact counts revoked/deleted.

### Edge Cases
- Because the gate is client-rendered (`useSession()`-driven, not a server redirect), a non-admin briefly sees the page shell before the gate swaps in — confirm there's no flash of real admin controls during that window, since the discovery doc calls this "defense-in-depth" on top of the hidden nav link, not the only protection.
