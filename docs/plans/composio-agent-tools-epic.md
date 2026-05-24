# Epic: Composio Tool Access For Open Agents

Prepared: 2026-05-24
Status: planning, not ready for implementation
GitHub issue: https://github.com/dennisonbertram/fork-open-agents/issues/8

## Executive Summary

Open Agents should support Composio as an optional external action plane for the
top-level agent first, then for selected subagents after the safety model is
proven. Users should be able to connect third-party accounts in settings,
choose a bounded tool profile from the chat bar, and control which agent roles
may use those profiles.

The important design constraint is that Composio is not "just another local
tool." It owns third-party OAuth credentials, connected accounts, remote
execution, tool logs, and session state. Open Agents should own product state:
which user enabled which profile, which chat selected it, which agent role may
use it, what Composio session was used, and what user/operator evidence proves
the tool path worked.

The recommended first implementation path is:

1. add Composio configuration/status and live smoke coverage;
2. add data-model support for user tool profiles, per-agent defaults, per-chat
   selection, and Composio session reuse;
3. inject Composio tools only into the main agent when explicitly selected;
4. add settings and chat-bar UI;
5. then extend to subagents behind explicit per-agent settings.

## Why This Matters

Open Agents already controls code, shell, browser, GitHub, Vercel Sandbox, and
durable workflow state. Composio can add user-authorized actions across Gmail,
Slack, Linear, Notion, Jira, GitHub, Google Workspace, and other services
without building every integration directly.

The product outcome is a user who can say:

> "Find the Linear issue, check the Slack thread, update the GitHub PR, and
> draft the customer email."

and have Open Agents use the right external services under the user's
connected accounts, with visible scope and audit evidence.

## User/Operator Path Protected

A signed-in user can configure Composio once, select a bounded tool profile in a
chat, and let the top-level Open Agent call external-service tools while:

- credentials remain outside Open Agents;
- tool access is explicit and reversible;
- missing connections produce a connect/setup path instead of a confusing model
  failure;
- each workflow records which profile, toolkits, connected accounts, Composio
  session, and tool calls were used;
- subagents cannot inherit external tools unless settings explicitly grant them.

## Key Research Findings

Current Composio docs and local Agent University research agree on these
integration facts:

- Use `@composio/core`, not legacy `composio-core` or `ComposioToolSet`.
- Use `@composio/vercel` for AI SDK-compatible tools.
- Create a session with `composio.create(userId, options)`.
- Persist the Composio session ID and reuse it with `composio.use(sessionId)`
  for multi-turn conversations.
- Restrict sessions with `toolkits`, `authConfigs`, and `connectedAccounts`.
- For Vercel AI SDK, retrieve tools with `session.tools()` and pass them as
  `tools`.
- Composio has two auth layers: project API key for Open Agents -> Composio,
  and end-user connected accounts for Composio -> third-party apps.
- Connected accounts stay in Composio. Open Agents should store IDs and status,
  not third-party credentials.
- Sessions/meta-tools are better than preloading direct tool schemas for this
  chat product because toolkit catalogs are large and dynamic.

Relevant repo facts:

- Main agent call options are assembled in `apps/web/app/workflows/chat.ts`.
- `packages/agent/open-agent.ts` already supports dynamic `settings.tools`
  inside `prepareCall`.
- Existing user defaults live in `user_preferences`.
- Existing chat state lives in `chats`.
- Workflow/session events already provide a place for operator evidence.
- Tool rendering has a default renderer for unknown AI SDK tool parts, so
  Composio can render generically first.

## System Design

### Source Of Truth

Before this epic:

- Open Agents DB owns user preferences, chat/session state, model selection,
  runtime mode, skills, sandbox state, and workflow evidence.
- External integrations are mostly first-party: GitHub/Vercel OAuth and GitHub
  App records live in Open Agents tables.

After this epic:

- Open Agents DB owns Composio enablement, profile definitions, agent-role
  defaults, chat selected profile, Composio session IDs, config hashes, and
  observability metadata.
- Composio owns connected accounts, OAuth tokens, auth configs, tool execution,
  Composio session internals, and remote logs.
- The workflow resolves the selected profile into a Composio session and passes
  the resulting AI SDK tools into the agent call.

### Tool Access Model

Use **tool profiles** rather than raw toolkit toggles in the chat bar.

A profile is a named, bounded policy:

```ts
type ComposioToolProfile = {
  id: string;
  userId: string;
  name: string;
  toolkitSlugs: string[];
  authConfigIdsByToolkit: Record<string, string | null>;
  connectedAccountIdsByToolkit: Record<string, string[]>;
  workbenchEnabled: boolean;
  allowInChatConnectionManagement: boolean;
  createdAt: Date;
  updatedAt: Date;
};
```

Initial defaults:

- `Off` is always available and is the default.
- Profiles are user-created or settings-created.
- `workbenchEnabled` defaults to `false`.
- `allowInChatConnectionManagement` defaults to `false`.
- Profiles should be allowlists, not denylists.

### Per-Agent Settings Model

Per-agent settings should exist from the start, even if only `main` is enforced
in the first implementation slice.

```ts
type ComposioAgentKey = "main" | "explorer" | "executor" | "design";

type ComposioAgentDefaults = Record<
  ComposioAgentKey,
  {
    defaultProfileId: string | null;
    allowChatOverride: boolean;
  }
>;
```

Recommended default policy:

| Agent | Default | Rationale |
| --- | --- | --- |
| `main` | user-selected profile | Main agent coordinates user intent and should own external actions first. |
| `explorer` | off | Exploration can leak external context or spend calls unexpectedly. |
| `executor` | off | Executor should focus on repo/sandbox work unless explicitly granted. |
| `design` | off | Design work rarely needs third-party action by default. |

Subagent rollout should require explicit profile assignment per role. Do not
implicitly pass the main-agent profile into delegated workers.

### Per-Chat Runtime Selection

The chat bar selector should write a per-chat selection, not just pass
transient request body state. This makes refresh, resume, and multi-step
workflow execution consistent.

Suggested state:

```ts
type ChatComposioSelection = {
  mainProfileId: string | null;
  agentProfileOverrides?: Partial<Record<ComposioAgentKey, string | null>>;
};
```

The selected profile applies to future turns. A running workflow should keep
the selection resolved at workflow start.

### Composio Session Reuse

Persist Composio sessions per chat + agent role + config hash.

```ts
type ComposioAgentSession = {
  id: string;
  userId: string;
  chatId: string;
  agentKey: ComposioAgentKey;
  profileId: string;
  configHash: string;
  composioSessionId: string;
  lastUsedAt: Date;
  createdAt: Date;
};
```

Rules:

- Reuse an existing row when `chatId`, `agentKey`, `profileId`, and
  `configHash` match.
- Create a new Composio session when the profile's toolkit/auth/account config
  changes.
- Store only Composio IDs and display status locally.
- Never store third-party OAuth tokens or API keys.

This matters because the existing Open Agents workflow runs one AI SDK model
step at a time. If every outer loop step creates a new Composio session,
Composio's meta-tool memory can be lost mid-turn.

### Workflow Integration Point

The clean integration point is before `runAgentStep` calls `webAgent.stream`.

1. `runAgentWorkflow` resolves runtime and model settings.
2. It also resolves Composio tool settings for the chat and `main` agent.
3. It creates/uses the Composio session.
4. It obtains AI SDK tools via `session.tools()`.
5. It passes those tools into `webAgent.stream({ options, tools })`.
6. `openAgent.prepareCall` merges Open Agent tools and Composio tools according
   to runtime/tool policy.

The `managed_runtime` coordinator policy needs a deliberate decision. Initial
recommendation: allow Composio only in `classic` mode until managed-runtime
coordinator rules explicitly account for external actions.

### UX Model

Settings:

- Show whether `COMPOSIO_API_KEY` is configured.
- Show reachable/unreachable status without exposing the key.
- Let users create named profiles.
- Let users connect/reconnect supported toolkits.
- Let users select per-agent defaults.
- Show connection status per toolkit/account: connected, missing,
  reconnect required, unknown.

Chat bar:

- Add a compact `Tools` selector near the model selector.
- Options:
  - `Off`
  - user profile names, e.g. `GitHub`, `Gmail + Calendar`
  - `Manage...` linking to settings
- Disabled states:
  - Composio unavailable
  - no profiles configured
  - selected profile has missing required connections
  - chat is archived or streaming

Run-time feedback:

- If Composio is unavailable, keep the chat usable with tools off.
- If selected profile has missing connections, block the send or show an inline
  setup CTA before the workflow starts.
- If a Composio tool call fails, render the tool part generically and include
  `logId` when available for operator debugging.

### Security And Safety

Initial restrictions:

- Server-side only; no Composio project API key in client bundles.
- Composio OAuth/connect links are generated by server routes.
- Workbench disabled initially.
- No in-chat credential entry in v1.
- No global "all toolkits" mode.
- No subagent inheritance by default.
- Redact tool inputs/outputs in shared pages if they look like secrets or
  connection material.

Failure modes to surface:

- `COMPOSIO_API_KEY` missing.
- Composio API unreachable / Cloudflare challenge / 403.
- profile has no toolkits.
- toolkit requires connection.
- connected account expired.
- Composio session creation failed.
- Composio tool execution returned `{ successful: false, error }`.
- Composio provider/tool format incompatible with the installed AI SDK.

## Implementation Slices

### CATS-00: Research Spike And Live No-Auth Smoke

Goal: prove package compatibility and the basic Composio path before schema/UI
work.

In scope:

- Add a private script or test fixture that creates a Composio session for a
  deterministic no-auth toolkit such as Hacker News.
- Confirm `@composio/core@0.10.x`, `@composio/vercel@0.9.x`, and `ai@6` work
  together in this repo.
- Document live evidence and failure shapes.

Out of scope:

- Product UI.
- DB migrations.
- OAuth account linking.

Tests/evidence:

- No-auth smoke command documented.
- Unit test around config parser with key absent/present.
- No secrets logged.

### CATS-01: Server Config, Client Factory, And Status API

Goal: add a safe server-side Composio boundary.

Files likely touched:

- `apps/web/lib/composio/config.ts`
- `apps/web/lib/composio/client.ts`
- `apps/web/lib/composio/errors.ts`
- `apps/web/app/api/composio/status/route.ts`
- `apps/web/.env.example`

Behavior contract:

- Given `COMPOSIO_API_KEY` is unset, settings shows Composio as unavailable and
  chat selectors are disabled.
- Given the key is set but Composio is unreachable, users see a retryable
  service status without key leakage.
- Given the key is set and reachable, users can proceed to profile setup.

Tests to add first:

- Config parser returns disabled when key is absent.
- Status API returns authenticated-only status.
- Status API never returns key material.

### CATS-02: Data Model For Profiles, Defaults, And Session Reuse

Goal: create durable Open Agents state for Composio selection and session reuse.

Preferred schema:

- `composio_tool_profiles`
  - `id`, `user_id`, `name`, `toolkit_slugs`, `auth_config_ids_by_toolkit`,
    `connected_account_ids_by_toolkit`, `workbench_enabled`,
    `allow_in_chat_connection_management`, timestamps.
- `composio_agent_sessions`
  - `id`, `user_id`, `chat_id`, `agent_key`, `profile_id`, `config_hash`,
    `composio_session_id`, timestamps.
- Add JSONB to `user_preferences` for `composio_agent_defaults`.
- Add JSONB to `chats` for `composio_selection`.

Alternative if the team wants fewer tables:

- Store profiles and defaults in `user_preferences` JSONB.
- Store session reuse in a separate table.

Recommendation: use tables for profiles and sessions. Profiles are entities,
not just preferences, and session reuse needs indexes.

Tests to add first:

- Profile schema normalizes empty/invalid toolkit lists.
- Per-agent defaults reject unknown agent keys.
- Session reuse lookup returns the matching session by config hash and misses
  when the profile changes.

Migration impact:

- Requires Drizzle migration.
- Production deploy must run migration before any UI tries to read/write these
  fields.

### CATS-03: Settings UI For Composio Profiles And Connections

Goal: let users configure Composio before using it in chat.

Files likely touched:

- `apps/web/app/settings/layout.tsx`
- `apps/web/app/settings/composio/page.tsx`
- `apps/web/app/settings/composio-section.tsx`
- `apps/web/app/api/settings/composio/*`
- `apps/web/app/api/composio/connect/route.ts`

Behavior contract:

- Users can create/edit/delete a profile.
- Users can add toolkit slugs to a profile.
- Users can start a managed connection flow for a toolkit.
- Users can assign default profiles to agent roles.
- Settings explains that external-account credentials are stored by Composio,
  not Open Agents.

Initial supported toolkit flow:

- Start with manual toolkit slug entry plus server validation.
- Follow-up can add searchable toolkit discovery/autocomplete.

Tests to add first:

- API rejects unauthenticated profile writes.
- API rejects unsafe/empty profile names and invalid toolkit slug payloads.
- API returns connection redirect URL without exposing secret headers.
- Component test covers disabled state when Composio is unavailable.

Browser smoke:

- Open `/settings/composio`.
- Verify unavailable, empty, connected, and profile-created states.

### CATS-04: Main-Agent Composio Tool Injection

Goal: make selected Composio profiles available to the top-level agent.

Files likely touched:

- `apps/web/app/workflows/chat.ts`
- `packages/agent/open-agent.ts`
- `packages/agent/open-agent.test.ts`
- `apps/web/app/workflows/chat.test.ts`
- `apps/web/lib/composio/session.ts`

Behavior contract:

- Given chat tools are off, the agent sees only existing Open Agent tools.
- Given a profile is selected and connections are valid, the agent receives
  existing Open Agent tools plus Composio session tools.
- Given a profile is selected but Composio setup is missing, the workflow fails
  before model invocation with a clear user-visible setup message.
- Given a profile config changes, a new Composio session is created and
  persisted.

Critical invariant:

- Do not create a new Composio session for every outer tool-loop step when the
  profile/config hash is unchanged.

Tests to add first:

- `open-agent.test.ts` proves dynamic tools are preserved/merged in classic
  mode.
- Workflow test proves selected profile leads to `session.tools()` and those
  tools reach `webAgent.stream`.
- Workflow test proves missing Composio config emits setup failure before model
  call.
- Session helper test proves config-hash reuse.

### CATS-05: Chat-Bar Tools Selector

Goal: expose per-chat selection ergonomically.

Files likely touched:

- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
- `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-context.tsx`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.ts`
- new `components/composio-tool-selector-compact.tsx`

Behavior contract:

- The chat input shows a compact `Tools` selector.
- The selector is disabled while a chat is streaming or archived.
- Selecting a profile persists to the chat and affects future sends.
- The selected profile is visible after refresh.
- Missing setup links to `/settings/composio`.

Tests to add first:

- Chat PATCH route persists `composioSelection`.
- Chat page/context initializes selected profile from the server snapshot.
- Selector component renders Off/profile/manage states.

Browser smoke:

- Create/select a profile.
- Open chat, switch tools, refresh, confirm selection persists.
- Send a message with tools off and confirm no Composio status is emitted.

### CATS-06: Observability, Tool Rendering, And Operator Evidence

Goal: make Composio usage auditable and debuggable.

Files likely touched:

- `apps/web/app/workflows/chat.ts`
- `apps/web/components/tool-call/tool-call.tsx`
- `apps/web/lib/observability/events.ts`
- shared-page redaction paths

Events:

- `composio.profile.selected`
- `composio.session.reused`
- `composio.session.created`
- `composio.session.failed`
- `composio.tool.call.started` if observable from AI SDK stream
- `composio.tool.call.finished` with `logId` when available

User-visible status:

- "Composio tools unavailable"
- "Connect Gmail to use this profile"
- "Using Composio profile: GitHub"
- Generic Composio tool renderer shows tool name, status, and safe summary.

Tests to add first:

- Event payload redacts connection secrets.
- Shared page redaction catches Composio tool parts with secret-looking data.
- Tool renderer handles a sample `COMPOSIO_*` tool part.

### CATS-07: Per-Agent And Subagent Tool Access

Goal: extend Composio from main-agent-only to explicit subagent grants.

Files likely touched:

- `packages/agent/tools/task.ts`
- `packages/agent/subagents/*`
- `packages/agent/open-agent.ts`
- `apps/web/app/workflows/chat.ts`
- Composio session helper modules.

Behavior contract:

- Subagents default to no Composio access.
- Settings can grant a profile to `explorer`, `executor`, or `design`.
- `taskTool` receives serializable per-agent Composio policy via
  `experimental_context`.
- Each subagent role uses its own Composio session row keyed by agent role and
  config hash.
- Subagent final output and task status include Composio tool attribution.

Tests to add first:

- `taskTool` does not pass Composio tools unless the subagent role is enabled.
- Enabled subagent role creates/uses role-scoped session.
- Managed runtime coordinator policy still blocks unintended direct coding
  tools while respecting explicit external-tool grants only if approved.

This slice should not be merged until main-agent observability is stable.

### CATS-08: In-Chat Connection Management And Advanced Modes

Goal: optionally let the agent guide connection setup mid-conversation.

Keep this out of v1 unless users clearly need it.

Possible additions:

- Allow `COMPOSIO_MANAGE_CONNECTIONS` in selected profiles.
- Stream a safe connect-link card.
- Pause/resume after connection completion.
- Add direct-execution mode for tightly scoped, pinned tools.
- Add Composio Workbench support for profiles that need remote processing.

Risks:

- In-chat OAuth links can create confusing agent behavior.
- Workbench expands the execution surface.
- Direct tool schemas can bloat context and require toolkit version pinning.

## Epic Issue Body

### Why This Matters

Composio can give Open Agents controlled access to external user services
without building every integration in-house. This unlocks cross-service agent
workflows while keeping third-party credentials in Composio and keeping Open
Agents responsible for explicit profile selection, per-agent permissions, and
operator evidence.

### User/operator Path Protected

A signed-in user configures Composio in settings, selects a bounded tool
profile in the chat bar, and lets the top-level agent use external-service
tools. Operators can see which profile/session/toolkits were active and why a
missing or failed connection blocked a run.

### Behavior Contract

- Given Composio is not configured, when a user opens settings or chat tools,
  then the UI shows Composio unavailable and no model call receives Composio
  tools.
- Given a user creates a profile and connects required accounts, when they
  select that profile in chat and send a message, then the main agent receives
  the selected Composio session tools.
- Given a profile's connection is missing or expired, when the user attempts to
  run with that profile, then the app surfaces a setup path before or at
  workflow start without exposing secrets.
- Given subagent defaults are off, when the main agent delegates a task, then
  the subagent does not receive Composio tools unless explicitly configured.

### Product And Design Spec

- Entry point: `/settings/composio` plus a compact `Tools` selector in the chat
  input bar.
- Primary flow: configure profile -> connect account -> choose profile in chat
  -> run agent -> inspect tool activity/evidence.
- Empty state: Composio not configured, no profiles, no connections.
- Loading state: checking service status, loading profiles, creating connect
  link.
- Error state: missing env key, service unreachable, connection expired,
  profile invalid.
- Permissions: server-side only project key; users can only read/write their
  own profiles, defaults, chat selections, and connection metadata.
- Copy: use "Tools" for chat selection and "Composio profiles" in settings.

### Integration Spec

- Routes/components/API surfaces:
  - `GET /api/composio/status`
  - profile CRUD under `/api/settings/composio`
  - connect route under `/api/composio/connect`
  - chat PATCH support for Composio selection.
- Agent/workflow surfaces:
  - resolve selected profile in workflow;
  - create/use Composio session;
  - pass `session.tools()` into the main agent;
  - later pass role-scoped policy to subagents.
- Data model:
  - profiles table;
  - Composio agent sessions table;
  - user per-agent defaults;
  - chat selection.
- Config:
  - `COMPOSIO_API_KEY`.
- Observability:
  - session created/reused/failed events;
  - selected profile and toolkit slugs;
  - Composio log IDs when available;
  - secret-safe status and redaction.

### In Scope

- Plan and implement Composio as optional, scoped external tool access.
- Main-agent support before subagent support.
- Settings setup and chat-bar selector.
- Per-agent defaults represented in data model.
- Tests, migration, and observability for each slice.

### Out Of Scope

- Replacing GitHub/Vercel first-party integrations.
- Exposing Composio project API key client-side.
- In-chat OAuth in the first main-agent slice.
- Enabling Composio Workbench by default.
- Granting all subagents all profiles.
- Unbounded "all toolkits" mode.

### Research And Context Sources

- Context7: `/composiohq/composio`
- Official docs:
  - `docs/content/docs/providers/vercel.mdx`
  - `docs/content/docs/configuring-sessions.mdx`
  - `docs/content/docs/common-faq.mdx`
  - `docs/content/docs/importing-existing-connections.mdx`
- Local research:
  - `/Users/dennison/develop/agent-university/composio/degrees/01-overview/01-research/research-index.md`
  - `/Users/dennison/develop/agent-university/composio/degrees/01-overview/01-research/mental-model.md`
  - `/Users/dennison/develop/agent-university/composio/degrees/01-overview/05-distillation/before-you-build.md`
- Repo paths:
  - `packages/agent/open-agent.ts`
  - `apps/web/app/workflows/chat.ts`
  - `apps/web/lib/db/schema.ts`
  - `apps/web/app/settings/preferences-section.tsx`
  - `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`

### Agent Todo Checklist

- [ ] Read this epic and current Composio docs before coding.
- [ ] Run a no-auth live smoke or document why live Composio access is blocked.
- [ ] Implement CATS-01 config/status with tests.
- [ ] Implement CATS-02 data model and migration with tests.
- [ ] Implement CATS-03 settings profile/connection UI with API tests and browser smoke.
- [ ] Implement CATS-04 main-agent injection with workflow tests.
- [ ] Implement CATS-05 chat-bar selector with route/component tests and browser smoke.
- [ ] Implement CATS-06 observability/tool rendering/redaction.
- [ ] Only then implement CATS-07 subagent grants.
- [ ] Run targeted tests, `git diff --check`, and `bun --bun run ci` for every slice.

### Tests To Add First

- Config/status API tests for missing/present/unavailable Composio.
- DB normalization tests for profiles/defaults/session reuse.
- Workflow tests for tools-off, tools-on, missing-connection, and session reuse.
- Chat PATCH test for persisting Composio selection.
- Settings API tests for profile CRUD and connect-link creation.
- Tool renderer/redaction tests for Composio tool parts.
- Subagent tests proving no inheritance by default.

### Observability And User Feedback

- User-visible setup status in settings and chat.
- Workflow events for profile selected, session created/reused, and failure.
- Composio `logId` captured from tool results where available.
- No secret values in logs, shared pages, tool summaries, screenshots, or
  session events.

### Deploy Or Migration Impact

- New env var: `COMPOSIO_API_KEY`.
- Drizzle migration required for profile/session/selection state.
- Vercel production must receive the env var before enablement.
- Rollout can be feature-disabled when env key is absent.
- No Composio credentials are migrated into Open Agents.

### Definition Of Done

- [ ] Epic has child implementation issues or tracked slices.
- [ ] Current Composio package compatibility is live-verified.
- [ ] Main-agent support is behind explicit selection.
- [ ] Settings and chat UI expose clear disabled/setup/error states.
- [ ] Per-agent settings exist and default subagents to off.
- [ ] Composio session IDs are reused per chat/agent/config hash.
- [ ] Observability records profile/session/tool evidence without secrets.
- [ ] `bun --bun run ci` passes for each implementation PR.

## Open Decisions

1. Should Composio profiles be user-only or also organization/team-shared later?
2. Which first toolkits should be supported in UI shortcuts: GitHub, Gmail,
   Linear, Slack, Notion?
3. Should initial connection setup use managed Composio auth only, or allow
   custom auth configs from day one?
4. Should `managed_runtime` mode initially forbid Composio or allow it for the
   main coordinator when explicitly selected?
5. Should profile edits affect existing chats immediately, or should chats
   pin profile revisions until changed?

Recommended initial answers:

- user-only profiles;
- shortcut GitHub + Gmail + Linear, with manual slug entry for everything else;
- managed auth only;
- classic mode first, managed runtime after explicit policy review;
- profile edits affect future turns and trigger new Composio session creation
  via config hash.

## Rollout Strategy

Use a shadow-to-enforced rollout:

1. Land config/status and no-auth smoke with no product UI.
2. Land settings data model and profile UI with Composio still disabled in chat.
3. Land main-agent injection behind explicit profile selection.
4. Add observability and redaction hardening.
5. Enable selected production users.
6. Add subagent role grants after main-agent behavior is proven.

Rollback:

- Unset `COMPOSIO_API_KEY` to disable runtime integration.
- Keep profile/chat/session rows; they are inert without config.
- Hide or disable selector when status is unavailable.
- Existing chats should continue using Open Agents native tools.
