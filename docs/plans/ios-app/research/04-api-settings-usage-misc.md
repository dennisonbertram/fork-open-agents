# API Ground Truth: Settings, Preferences, Profiles, Usage, Sharing, Composio, Workflows

Research brief for the native iOS app plan. All paths relative to repo root
`/Users/dennison/develop/open-agents`. Verified against actual code on branch
`feat/agents-phase6-authored-tools` (June 2026). Line numbers cited as `path:line`.

---

## 0. Cross-cutting: Auth and conventions

- **Every authenticated route uses cookie-based better-auth sessions.** Two helpers:
  - `requireAuthenticatedUser()` (`apps/web/app/api/sessions/_lib/session-context.ts:65`) → `{ ok, userId }` or a ready-made `401 {"error":"Not authenticated"}` Response.
  - `getServerSession()` (`apps/web/lib/session/get-server-session.ts:17`) — reads request headers, first checks a **test-auth cookie** (`getTestAuthSessionFromCookieHeader`, gated by `OPEN_AGENTS_ENABLE_TEST_AUTH`), then falls back to `auth.api.getSession()` (better-auth). Session shape: `{ created, authProvider: "vercel", user: { id, username, email?, avatar, name? } }`.
  - **There is no bearer-token / API-key auth path anywhere in these routes.** An iOS client must carry the better-auth session cookie (or a new auth mechanism must be added).
- **Error convention:** JSON `{ "error": string }` with status 400/401/403/404/409/410/500/502/503. Some add `details` (Zod `error.flatten()`).
- **Mutating routes parse JSON bodies — including DELETE.** Several DELETE endpoints require a JSON body (`/api/settings/skills`, `/api/settings/composio`, `/api/settings/model-variants`, `/api/inference-profiles`). iOS URLSession supports bodies on DELETE, but this is a non-RESTful quirk to plan for.
- Ownership scoping is always `userId` from the session; there is no admin/cross-user access in these routes.

---

## 1. `/api/settings/preferences` — user preferences

File: `apps/web/app/api/settings/preferences/route.ts`

### GET (route.ts:30)
- Auth: cookie session; 401 otherwise.
- Response: `{ preferences: UserPreferencesData }`.

### PATCH (route.ts:40)
- Body (all optional, manual per-field validation, each invalid field → 400 with field-specific message):

| Key | Type | Validation |
|---|---|---|
| `defaultModelId` | string | any string (route.ts:88) |
| `defaultSubagentModelId` | string \| null | (route.ts:98) |
| `defaultInferenceProfileId` | string \| null | (route.ts:111) |
| `defaultSandboxType` | `"vercel"` only | (route.ts:55) |
| `defaultManagedRuntimeProfileId` | string | must pass `isManagedRuntimeProfileId` — **built-in profiles only**, user-saved runtime profiles are rejected (route.ts:66; `packages/sandbox/managed-runtime-profiles.ts:172`) |
| `defaultDiffMode` | `"unified"` \| `"split"` | (route.ts:77) |
| `autoCommitPush`, `autoCreatePr`, `alertsEnabled`, `alertSoundEnabled`, `publicUsageEnabled` | boolean | (route.ts:124–187) |
| `globalSkillRefs` | `{source: "owner/repo", skillName: string}[]` | `globalSkillRefsSchema` — regex-validated + case-insensitive dedupe (`apps/web/lib/skills/global-skill-refs.ts:6–42`) |
| `enabledModelIds` | string[] | (route.ts:202) |

- Response: `{ preferences }` (full updated object). 500 on DB failure.
- Note: `modelVariants` and `composioAgentDefaults` are part of preferences but are NOT settable here (managed via `/api/settings/model-variants` and `/api/settings/composio` respectively).

### UserPreferencesData shape + defaults
`apps/web/lib/db/user-preferences.ts:24–58`; DB table `user_preferences` at `apps/web/lib/db/schema.ts:1497` (one row per user, unique `user_id`):

```ts
{
  defaultModelId: string,                  // default APP_DEFAULT_MODEL_ID; DB column default "anthropic/claude-haiku-4.5"
  defaultSubagentModelId: string | null,   // null = same as defaultModelId
  defaultInferenceProfileId: string | null,// FK inference_profiles, on delete set null
  defaultSandboxType: "vercel",            // legacy "hybrid" normalized to "vercel" (user-preferences.ts:63)
  defaultManagedRuntimeProfileId: string,  // default "web-bun-agent-browser"
  defaultDiffMode: "unified" | "split",    // default "unified"
  autoCommitPush: boolean,                 // default false
  autoCreatePr: boolean,                   // default false
  alertsEnabled: boolean,                  // default true
  alertSoundEnabled: boolean,              // default true
  publicUsageEnabled: boolean,             // default false — gates public /u/[username] profile
  globalSkillRefs: GlobalSkillRef[],       // default []
  modelVariants: ModelVariant[],           // default []
  enabledModelIds: string[],               // default [] (= UI shows curated default model set)
  composioAgentDefaults: ComposioAgentDefaults, // see §4; default all-null profiles, main.allowChatOverride=true
}
```
GET auto-creates nothing; `getUserPreferences` returns normalized defaults when no row exists (user-preferences.ts:150). First PATCH inserts the row.

---

## 2. `/api/settings/agents` — agent roster (Phase 4/6 work, current branch)

File: `apps/web/app/api/settings/agents/route.ts`; schema mapper `agents-api-mapper.ts`; DB `agents` table `apps/web/lib/db/schema.ts:1552`.

Four canonical roles: `"main" | "explorer" | "executor" | "design"` (route.ts:14). One `scope="user_default"` row max per (userId, role) — unique index `agents_user_role_scope_idx` (schema.ts:1620).

### GET (route.ts:34)
- Returns all four roles in order; roles with no DB row come back with all-null fields ("inherit defaults"):
```ts
{ agents: Array<{
    role: "main"|"explorer"|"executor"|"design",
    modelId: string | null,
    composioToolkitSlugs: string[],
    composioProfileId: string | null,
    instructions: string | null,
    managedRuntimeProfileId: string | null,
}> }
```

### PATCH (route.ts:78)
- Body (`agentPatchSchema`, **strict** — unknown keys → 400, `agents-api-mapper.ts:16`):
  `{ role (required), modelId?, composioToolkitSlugs?, composioProfileId?, instructions?, managedRuntimeProfileId? }` — nullable fields use `null` = reset to inherited.
- Upserts the `user_default` row (`upsertUserDefaultAgent`, `apps/web/lib/db/agents.ts:83` — `onConflictDoUpdate` on (userId, role, scope)). **Caution: the upsert overwrites ALL five patch fields with `patch.x ?? null` — omitting a field resets it**, this is a full-row replace, not a merge (db/agents.ts:101–105).
- Response: `{ agent: AgentSettingsRow }`. Errors: 400 invalid JSON / invalid body (with `details`).

### DELETE (route.ts:121)
- Body `{ role }`. Deletes the user_default row (reset to inherited). Response `{ ok: true }`.

### Resolution semantics (how settings take effect)
`apps/web/lib/agents/resolve-agent.ts:129` — `resolveAgentForRole` resolution order: **session > repo > user_default > synthetic fallback from userPreferences**. Synthetic fallback (resolve-agent.ts:156): modelId = `defaultSubagentModelId ?? defaultModelId` for sub-roles, `defaultModelId` for main; instructions null (built-in prompt); `toolAuthoringEnabled: false`.

### Fields in DB but NOT exposed via the settings API
The `agents` table (schema.ts:1552–1627) also has `inferenceProfileId`, `skillRefs`, `builtinToolNames`, `toolAuthoringEnabled` (Phase 6, #242 — off by default), plus `scope`/`sessionId`/`repoOwner`/`repoName` for repo/session-scoped rows. **There is currently no API to set `toolAuthoringEnabled` or create repo/session-scoped agent rows** — only `user_default` writes through this endpoint.

---

## 3. `/api/agents/tool-entries` — agent-authored tool approval queue (Phase 6, #242)

File: `apps/web/app/api/agents/tool-entries/route.ts`; DB `agent_tool_entries` (schema.ts:1635); lib `apps/web/lib/db/agent-tool-entries.ts`.

- **GET** `?agentId=<id>` (route.ts:17) — required query param else 400. Returns `{ entries: AgentToolEntry[] }`, owner-scoped. Entry shape: `{ id, agentId, userId, provider: "composio", toolkitSlug, status: "proposed"|"approved"|"rejected", createdByChatId, createdByRunId, createdAt, approvedAt }`.
- **POST** (route.ts:48) — body `{ action: "approve"|"reject", entryId }` (Zod). Approve sets status+`approvedAt` and **appends the toolkit slug to the agent's `composioToolkitSlugs`** (makes it live, `agent-tool-entries.ts:83–132`); reject only flips status. 404 `{"error":"Tool entry not found or not owned by you"}` when not owned. Success: `{ ok: true, action }`.
- Entries are created server-side by agents when `toolAuthoringEnabled=true` (`createProposedToolEntry`, agent-tool-entries.ts:27) — proposals are off-by-default and never live until owner approval.

---

## 4. Composio APIs

Composio is the external tool-connection provider. Server config: single platform `COMPOSIO_API_KEY` env (`apps/web/lib/composio/config.ts:35`); per-user identity is `open_agents_user_<userId>` (`apps/web/lib/composio/user-id.ts:1`).

`ComposioServiceStatus` (config.ts:15): `{ configured: bool, available: bool, reason: "missing_api_key"|"ok"|"invalid_api_key"|"unreachable", message: string }`.

### 4.1 `/api/composio/status` — GET (`apps/web/app/api/composio/status/route.ts:19`)
- Optional `?live=1` performs a live `connectedAccounts.list` probe. Response: `{ status: ComposioServiceStatus }`. Never errors (degrades to disabled/unavailable status).

### 4.2 `/api/composio/toolkits` — GET (`apps/web/app/api/composio/toolkits/route.ts:64`)
- Platform-level catalog; `export const revalidate = 3600` (1h cache, route.ts:62).
- Response: `{ toolkits: Array<{ slug, name, description|null, logo|null, categories: string[], managedAuth: boolean, noAuth: boolean }> }` sorted by name. Empty list when unconfigured; **502** `{error}` on Composio API failure.
- `managedAuth: true` = Composio-managed OAuth → one-click "Connect" works; `noAuth: true` = no account needed.

### 4.3 `/api/composio/connect` — POST (`apps/web/app/api/composio/connect/route.ts:26`)
- Body: `{ toolkitSlug?, authConfigId?, alias?, callbackUrl? }` — at least one of toolkitSlug/authConfigId required (Zod refine, route.ts:15–24).
- Flow: toolkitSlug → `resolveManagedAuthConfigId` (creates/reuses a Composio-managed auth config) → `client.connectedAccounts.link(composioUserId, authConfigId, {alias?, callbackUrl?})`.
- Response: `{ id, redirectUrl }` — **the client must open `redirectUrl` in a browser to complete the OAuth dance on Composio's side**, then the account shows up in connected-accounts. `callbackUrl` is passthrough, so iOS could supply a universal link / custom scheme for return. 400 with error message on failure.

### 4.4 `/api/composio/connected-accounts` — GET (`apps/web/app/api/composio/connected-accounts/route.ts:58`)
- Response: `{ accounts: Array<{ id, toolkitSlug, status, alias|null }> }` — only `ACTIVE` accounts requested. Best-effort: returns `{accounts: []}` on any error or when unconfigured (never 500).

### 4.5 `/api/settings/composio` — Composio tool profiles + agent defaults
File: `apps/web/app/api/settings/composio/route.ts`. Types: `apps/web/lib/composio/types.ts`. DB: `composio_tool_profiles` (schema.ts:1379), defaults stored in `user_preferences.composioAgentDefaults` (schema.ts:1537).

- **GET** (route.ts:67) — optional `?repoOwner=&repoName=`. Response:
  ```ts
  {
    status: ComposioServiceStatus,         // live probe (lists connected accounts)
    profiles: ComposioToolProfile[],       // raw rows owned by user
    profileOptions: (ComposioToolProfile & { available: boolean, disabledReason: string|null })[], // repo policy applied
    repositorySettings: RepositoryComposioSettings | null,
    defaults: ComposioAgentDefaults,
  }
  ```
- **POST** (route.ts:96) — create profile. Body `composioToolProfileInputSchema` (types.ts:75): `{ name (1–80), toolkitSlugs: string[], authConfigIdsByToolkit: Record<string,string|null>, connectedAccountIdsByToolkit: Record<string,string[]>, workbenchEnabled: bool, allowInChatConnectionManagement: bool }`. Normalization requires ≥1 valid toolkit slug (`normalizeComposioToolProfileValues`, types.ts:230 throws → 400). Slugs normalized lowercase `^[a-z0-9][a-z0-9_-]{0,79}$`, deduped; auth/account maps filtered to listed toolkits. 201 `{ profile }`.
- **PATCH** (route.ts:129) — body `{ defaults?, profileId? + profile? }` (`updateComposioSettingsSchema`, route.ts:26). At least one update required else 400. `defaults` updates `ComposioAgentDefaults`; `profileId`+`profile` (strict patch schema) updates a profile (404 if not found). Response echoes `{ defaults?, profile? }`.
- **DELETE** (route.ts:181) — body `{ profileId }`. 404 if not found; `{ success: true }`.

**ComposioAgentDefaults** (types.ts:12): `Record<"main"|"explorer"|"executor"|"design", { defaultProfileId: string|null, allowChatOverride: boolean }>`. Defaults: all profileIds null; only `main.allowChatOverride = true` (types.ts:50).

**Profile shape** (DB row): `{ id, userId, name, toolkitSlugs, authConfigIdsByToolkit, connectedAccountIdsByToolkit, workbenchEnabled, allowInChatConnectionManagement, createdAt, updatedAt }`; unique (userId, name).

### 4.6 `/api/settings/repositories/[repoOwner]/[repoName]/composio` — per-repo Composio policy
File: `apps/web/app/api/settings/repositories/[repoOwner]/[repoName]/composio/route.ts`. DB `repository_composio_settings` (schema.ts:1450), unique (userId, repoOwner, repoName); **owner/name normalized to lowercase** (`apps/web/lib/db/composio.ts:39`).

- **GET** (route.ts:34) — `{ profiles, profileOptions, repositorySettings|null, repoOwner, repoName }` (URL-decoded params).
- **PATCH** (route.ts:58) — body `repositoryComposioSettingsInputSchema` (types.ts:126, strict):
  ```ts
  { inheritGlobalDefaults: bool = true,
    allowedProfileIds: string[] = [],     // ALLOWLIST: empty = all profiles allowed; non-empty = only listed
    blockedToolkitSlugs: string[] = [],   // any profile containing a blocked toolkit is unavailable
    agentDefaults: Partial<ComposioAgentDefaults> = {} }
  ```
  Validates every `allowedProfileIds` entry against the user's own profiles → 400 `"Repository Composio settings reference unknown profiles"` (route.ts:90–98). Upserts; returns the same shape as GET.
- **Allowlist semantics** (`applyRepositoryComposioPolicy`, `apps/web/lib/db/composio.ts:224–263`): profile unavailable with reason `"Blocked by repository policy."` when allowlist non-empty and profile not in it; `"Blocked toolkit for this repository: <slug>."` when any of its toolkits is blocked. `isComposioProfileAllowedForRepository` (db/composio.ts:294) enforces this at chat-time too.
- Note: there is **no** top-level `/api/settings/repositories` list route — only this per-repo composio subresource. (The repo allowlist for *background agents* is a separate subsystem, not in scope here.)

---

## 5. `/api/settings/model-variants` — model variants (saved provider-option presets)

File: `apps/web/app/api/settings/model-variants/route.ts`. Stored inside `user_preferences.modelVariants` JSONB. Schema: `apps/web/lib/model-variants.ts`.

- **ModelVariant**: `{ id: "variant:<nanoid>" (built-ins "variant:builtin:*"), name (1–80), baseModelId: "provider/model", providerOptions: Record<string, JsonValue> }` (model-variants.ts:40).
- **GET** (route.ts:40) → `{ modelVariants: ModelVariant[] }` = built-ins first + user variants (`getAllVariants`, model-variants.ts:186). Built-ins currently: `GPT-5.4 (XHigh)` and `Claude Opus 4.6 (High)` (model-variants.ts:162).
- **POST** (route.ts:52) — `{ name, baseModelId, providerOptions = {} }`; providerOptions serialized size limit **16 KB** → 400 (route.ts:19,70). Returns full updated list. Known race: read-modify-write, concurrent updates can drop (route.ts:75 comment).
- **PATCH** (route.ts:97) — `{ id, name?, baseModelId?, providerOptions? }` (≥1 field). Built-in variants → **403** (route.ts:115). 404 if not found.
- **DELETE** (route.ts:159) — `{ id }`. Built-ins → 403; 404 if not present. All respond `{ modelVariants: [...] }`.
- Selection: chat model pickers send `variant:*` ids; `resolveModelSelection` maps to baseModelId + providerOptions (model-variants.ts:129). OpenAI variants always get `store: false` injected (model-variants.ts:84).

---

## 6. `/api/settings/runtime-profiles` — managed runtime profiles

Files: `apps/web/app/api/settings/runtime-profiles/route.ts`, `[profileId]/route.ts`. DB `managed_runtime_saved_profiles` (schema.ts:511). Built-ins from `packages/sandbox/managed-runtime-profiles.ts` (single built-in: `web-bun-agent-browser`, the default).

- **GET** (route.ts:120) → `{ profiles: RuntimeProfileOption[] }` — user `user_default` saved profiles first, then built-ins. Option shape (route.ts:40):
  `{ id, version, displayName, description, setupCommandCount, verificationCommandCount, expectedTools[], optionalTools[], defaultPorts[], source: "built_in"|"user_default", testStatus?: "untested"|"passed"|"failed", testedAt?: string|null }` (testStatus/testedAt only for user profiles; derivation route.ts:84–95).
- **POST** (route.ts:149) — create. Body `createOrUpdateProfileSchema` (route.ts:22): `{ displayName, description, setupCommands[≥1], verificationCommands[≥1], expectedTools=[], optionalTools=[], defaultPorts=[] }`; command = `{ id, label, description, command, timeoutMs?, required? }` (route.ts:13). 201 `{ profile }`.
- **PATCH `/[profileId]`** ([profileId]/route.ts:37) — same full-body schema (not a partial patch); 404 if not owned/found. Returns `{ profile }` (full `toManagedRuntimeProfile` projection — includes full command lists, unlike the list option).
- **DELETE `/[profileId]`** ([profileId]/route.ts:85) — 404 or `{ deletedProfileId }`.
- **Gotcha:** prefs `defaultManagedRuntimeProfileId` only accepts built-in ids (§1), so user-saved profiles are selectable per-session/agent but not as the global default.

---

## 7. `/api/settings/skills` (+ `/generate`) — user-authored skills

Files: `apps/web/app/api/settings/skills/route.ts`, `generate/route.ts`. DB `user_skills` (schema.ts:219). Validation `apps/web/lib/skills/skill-types.ts`.

- **Skill row:** `{ id, name (kebab-case 2–64, reserved: "model","resume","new"), description (≤1024), body (markdown ≤100k), enabled (default true), disableModelInvocation (default false), userInvocable (default true), allowedTools: string[] (≤50), source: "manual"|"generated", createdAt, updatedAt }`; unique (userId, name). Enabled skills are materialized to `~/.agents/skills/<name>/SKILL.md` in the sandbox (schema.ts:214 comment).
- **GET** → `{ skills }`. **POST** (`createUserSkillInputSchema`) → 201 `{ skill }`; **409** on name conflict (`SkillNameConflictError`, route.ts:54). **PATCH** (`{ id, ...partial }`) → `{ skill }`, 404/409. **DELETE** (`{ id }`) → `{ success: true }`, 404. All 400 on invalid payload with first Zod issue message.
- **POST `/generate`** (generate/route.ts:26) — AI-drafts a skill. Auth + **bot protection** (`checkBotProtection` → 403 "Access denied") + **rate limit 10/min/user** (429 with `Retry-After` header; `apps/web/lib/rate-limit.ts:81`). Body `{ prompt: 1–4000 chars }`. Uses `gateway("anthropic/claude-haiku-4.5")` structured output; `maxDuration = 60` (generate/route.ts:16). Response `{ skill: { name (slugified), description, body } }` — a draft only, client must then POST `/api/settings/skills` to save. 502 on generation failure, 500 unexpected.

---

## 8. `/api/inference-profiles` (+ `/test`) — BYOK inference profiles

Files: `apps/web/app/api/inference-profiles/route.ts`, `[profileId]/test/route.ts`. DB `inference_profiles` (schema.ts:179). Types `apps/web/lib/inference/types.ts`.

**Yes, this is BYOK** — user-supplied Anthropic API keys (only provider enum value is `"anthropic"`, types.ts:3). Keys are encrypted at rest with `ENCRYPTION_KEY ?? BETTER_AUTH_SECRET` (`apps/web/lib/inference/encryption.ts:32`); API responses only ever expose `SafeInferenceProfile` — **the key never round-trips**, only `keyLast4` + `keyFingerprint`.

- **SafeInferenceProfile** (types.ts:76): `{ id, name, provider: "anthropic", baseUrl|null, keyLast4, keyFingerprint, status: "untested"|"verified"|"failed", lastTestedAt|null, lastTestMessage|null, enabled, createdAt, updatedAt }`.
- **GET** → `{ profiles: SafeInferenceProfile[] }` (newest first).
- **POST** — `{ name (1–80), provider: "anthropic" (default), baseUrl?: http(s) URL|null, apiKey (1–4096), enabled = true }`. 201 `{ profile }`. Errors mapped to friendly strings: duplicate name → "An inference profile with that name already exists."; bad URL → "Base URL must be a valid Anthropic-compatible HTTP URL." (route.ts:18–27), always status 400.
- **PATCH** — `{ profileId, name?, baseUrl?, apiKey?, enabled? }` (≥1). Re-entering `apiKey` resets status to `untested` and clears test fields (`apps/web/lib/db/inference-profiles.ts:164–169`). 404 if not found.
- **DELETE** — `{ profileId }` → `{ success: true }` / 404.
- **POST `/api/inference-profiles/[profileId]/test`** (test/route.ts:28) — body optional `{ modelId? }` (default `anthropic/claude-haiku-4.5`; must map to an Anthropic direct model else 400). Sends a 16-token "Reply with only OK" through the user's key/baseUrl. **Always returns 200** with `{ profile: SafeInferenceProfile, result: { status: "passed"|"failed", message } }` — failure is data, not an HTTP error. Persists status as `verified`/`failed`.
- Usage attribution: chat runs record `inferenceRoute: "gateway"|"user"` + `inferenceProfileId` on usage events (§9), so BYOK traffic is distinguishable.

---

## 9. `/api/usage` (+ `/rank`) — usage history, insights, leaderboard

Files: `apps/web/app/api/usage/route.ts`, `rank/route.ts`, `_lib/query-range.ts`. DB `usage_events` (schema.ts:1659). Libs: `apps/web/lib/db/usage.ts`, `usage-insights.ts`, `usage-domain-leaderboard.ts`, `apps/web/lib/usage/*`.

### Usage event shape (one row per assistant turn, append-only)
schema.ts:1659: `{ id, userId, source: "web" (only enum value!), agentType: "main"|"subagent", provider|null, modelId|null, inferenceRoute: "gateway"|"user"|null, inferenceProfileId|null, inputTokens, cachedInputTokens, outputTokens, toolCallCount, createdAt }`. Written by `recordUsage` (`lib/db/usage.ts:11`) — tool calls inferred from UIMessage parts when not passed.
**iOS implication:** `source` enum is only `"web"` — a native client generating chat turns would need a schema migration/new enum value for attribution.

### GET `/api/usage` (route.ts:12)
- Auth via `getSessionFromReq` (cookie). Optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` — both-or-neither, validated calendar dates, `from <= to` (`lib/usage/date-range.ts:100`); else 400. Default lookback **280 days** (lib/db/usage.ts:87).
- Response: `{ usage: DailyUsage[], insights: UsageInsights, domainLeaderboard: UsageDomainLeaderboard|null }`.
  - `DailyUsage` (lib/db/usage.ts:56): per (date, source, agentType, provider, modelId) sums of input/cached/output tokens; `messageCount` = count of main-agent turns; `toolCallCount`.
  - `UsageInsights` (`lib/usage/types.ts:49`): `{ lookbackDays, pr: { trackedPrCount, sessionsWithPrCount, openPrCount, mergedPrCount, closedPrCount, mergeRate }, efficiency: { mainAssistantTurnCount, averageTokensPerMainTurn, largestMainTurnTokens, toolCallsPerMainTurn, cacheReadRatio }, code: { linesAdded, linesRemoved, totalLinesChanged }, topRepositories: { repoOwner, repoName, sessionCount, trackedPrCount, linesAdded, linesRemoved, totalLinesChanged }[] }`. PR/code data comes from joined `sessions` rows (usage-insights.ts:107).
  - `domainLeaderboard`: `{ domain, rows: { userId, username, name, avatarUrl, totalTokens, mostUsedModelId, mostUsedModelTokens }[] }` or null. **Eligibility is hardcoded: only `vercel.com` email domains** (`lib/usage/leaderboard-domain.ts:16` `VERIFIED_USAGE_LEADERBOARD_DOMAINS`); personal domains always excluded.

### GET `/api/usage/rank` (rank/route.ts:16)
- Today-only (UTC) rank in the user's domain leaderboard. Response `{ rank, total, domain }` or **JSON `null` body** (200) when ineligible/no usage. 401/500 otherwise.

### Public usage profile (related)
`publicUsageEnabled` pref gates the public server-rendered page `/u/[username]` (alias of `/[username]`, `apps/web/app/u/[username]/page.tsx:1`); data via `getPublicUsageProfile` (`apps/web/lib/db/public-usage-profile.ts:259`) → `{ status: "ok"|"disabled"|"not_found" }`. Supports `?date=` with grammar `30d` presets or `YYYY-MM-DD..YYYY-MM-DD` (`parsePublicUsageDate`, date-range.ts:154). Includes totals, agent main/sub split, top models, top repos, full insights, daily activity, and an OG image route at `/u/[username]/og`. **There is no public JSON API for this — page only.** An iOS share/preview feature would link to the web page or need a new endpoint.

---

## 10. Sharing — `/api/shared/[shareId]/*` and share creation

DB `shares` table (schema.ts:731): `{ id (nanoid 12), chatId (unique — one share per chat), createdAt, updatedAt }`. Sharing is **chat-scoped**.

### Creation/management (authenticated, owner-only)
`apps/web/app/api/sessions/[sessionId]/chats/[chatId]/share/route.ts`:
- **GET** → `{ shareId: string|null }` (route.ts:20).
- **POST** → creates if absent, idempotent → `{ shareId }` (route.ts:45; `nanoid(12)` at :68).
- **DELETE** → revokes → `{ success: true }` (route.ts:83).
- Ownership via `requireOwnedSessionChat` → 404 session/chat not found, 403 not owner.
- Old session-level `/api/sessions/[sessionId]/share` POST/DELETE returns **410 Gone** with a pointer to the chat-scoped route (`share/route.ts:5`).

### Public consumption (NO auth — anyone with shareId)
- **Page** `/shared/[shareId]` (`apps/web/app/shared/[shareId]/page.tsx`) — server-rendered read-only chat with OG/twitter images. Env-file tool content is redacted (`redact-shared-env-content.ts` — read/write/edit on `.env*` paths replaced with placeholder lines, recursing into task subagent parts).
- **GET `/api/shared/[shareId]/status`** (status/route.ts:12) — public; `{ isStreaming: boolean }` (true when chat has an `activeStreamId`); 404 `{error:"Not found"}` for bad share.
- **GET `/api/shared/[shareId]/markdown`** (markdown/route.ts:150) — public; returns the whole chat as **plain text/markdown** (content-type `text/markdown` when `Accept: text/markdown`, else `text/plain`; `Vary: Accept`). Format: YAML frontmatter (`session_name`, `repo`, `branch`, `pr_url`, `pr_number`, `created_at`) then `## User` / `## Assistant` sections, with `<!-- tool_activity: duration=… tool_calls=… -->` comments and `<snippet filename="…">` blocks; env content redacted. 404 as plain text body `"Not found\n"`.

---

## 11. `/api/workflows/catalog` — workflow catalog (read-only; no root /api/workflows route)

File: `apps/web/app/api/workflows/catalog/route.ts`. Catalog source `apps/web/lib/workflows/catalog.ts:265`.

- **GET** (route.ts:90) — auth required. Response `{ workflows: Array<{ id, name, version, description, capabilities: string[], proofLevel: string, available: boolean, disabledReason: string|null }> }`. Internal fields (`enabled`, `inputSchemaRef`) deliberately omitted (route.ts:74).
- Error: 503 `{ errorKind: "catalog_unavailable", message }` (typed `WorkflowCatalogErrorResponse`, route.ts:43).
- **Current catalog: 4 entries, ALL `enabled: false`** ("the managed workflow runtime that executes this workflow has not shipped"): `verified-build` (level-3), `deep-research` (level-1), `runtime-profile-validation` (level-2), `release-smoke` (level-3) (catalog.ts:204–272). `available` mirrors `enabled`, so every entry returns `available: false` with `disabledReason: "Workflow is currently disabled"`.
- **There is no `/api/workflows` (run-creation/list) route** — only `catalog`. Workflow *runs* tables exist in the DB but are driven by other subsystems.

---

## 12. Settings UI surface map (what an iOS settings area must cover)

`apps/web/app/settings/` sections (nav in `nav-items.ts`): profile, accounts (GitHub/Vercel connections), models (incl. enabledModelIds + inference profiles + model variants), preferences, agents (roster), skills, runtime-profiles, composio, connections, background-agents, usage, leaderboard, admin. The APIs above back: preferences, agents, skills, runtime-profiles, composio, models/variants/inference-profiles, usage, leaderboard.

---

## 13. Uncertainties / explicitly marked

- `checkBotProtection` (Vercel BotID) behavior for non-browser native clients on `/api/settings/skills/generate` is unverified — a native iOS call may be classified as a bot (403). Needs a live test.
- `resolveManagedAuthConfigId` internals (`lib/composio/managed-auth-config.ts`) were not fully read; behavior summarized from the connect route comment (managed OAuth via `connectedAccounts.link`).
- Whether better-auth exposes a mobile-friendly token flow (bearer plugin) in this app was not investigated here (auth is another research area); these routes themselves are cookie-only.
