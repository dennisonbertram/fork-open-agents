# UX Paths — Settings, preferences, inference profiles, skills, agents

Scope: `/api/settings/**`, `/api/inference-profiles/**`, `/api/agents/tool-entries`,
plus the read-only endpoints these flows depend on (`/api/models`,
`/api/sessions/[sessionId]/skills`).

**Auth for all stories**: run the server with `OPEN_AGENTS_ENABLE_TEST_AUTH=1`, call
`GET /api/dev/managed-runtime-demo` once, capture `Set-Cookie:
open_agents_test_user_id=dev-managed-runtime-user`, and replay that cookie on every
request below. Every route in this topic returns **401 `{"error":"Not authenticated"}`**
without it (routes using `requireAuthenticatedUser` also return 401).

---

## STORY-settings-01: First-run preference tour

**Type**: short
**Persona**: New user opening Settings for the first time
**Goal**: See what defaults are in effect and change the diff view to split
**Preconditions**: Authenticated test cookie only. No prior story needed.
**Ideal path**: 2 — one read of preferences, one write. A well-designed API returns the
full preference document on GET and accepts a sparse PATCH.
**Alternate paths**: `defaultModelId` / `defaultInferenceProfileId` can also be changed
per-chat via `PATCH /api/sessions/[sessionId]/chats/[chatId]` (chat-scoped override of
the same fields — redundancy signal). `autoCommitPush` / `autoCreatePr` also exist on
`PATCH /api/settings/repositories/[repoOwner]/[repoName]` as per-repo overrides of the
same two account-level flags.

### Steps
1. `GET /api/settings/preferences` → expect 200 `{preferences:{defaultModelId,defaultSubagentModelId,defaultInferenceProfileId,defaultSandboxType,defaultManagedRuntimeProfileId,defaultDiffMode,autoCommitPush,autoCreatePr,alertsEnabled,alertSoundEnabled,publicUsageEnabled,globalSkillRefs,enabledModelIds,modelSystemPrompts}}`
2. `PATCH /api/settings/preferences` — body: `{"defaultDiffMode":"split","alertSoundEnabled":false}` → expect 200 `{preferences}` with `defaultDiffMode:"split"`
3. `GET /api/settings/preferences` → expect 200, changes persisted

### Variations
- Toggle `publicUsageEnabled:true` to opt the account into the public usage leaderboard.
- Set `autoCommitPush:true` and `autoCreatePr:true` together in one PATCH.

### Edge Cases
- No cookie → **401** `{"error":"Not authenticated"}`
- Body is not JSON (`--data 'not-json'`) → **400** `{"error":"Invalid JSON body"}`
- `{"defaultDiffMode":"side-by-side"}` → **400** `{"error":"Invalid diff mode"}`
- `{"defaultSandboxType":"fly"}` → **400** `{"error":"Invalid sandbox type"}` (only `"vercel"` is accepted)
- `{"autoCommitPush":"yes"}` → **400** `{"error":"Invalid autoCommitPush value"}`
- `{"defaultModelId":123}` → **400** `{"error":"Invalid defaultModelId"}`

---

## STORY-settings-02: Pick the default model and trim the model picker

**Type**: short
**Persona**: Cost-conscious developer
**Goal**: Default new chats to a cheap model and hide models they never use
**Preconditions**: None.
**Ideal path**: 2 — list the catalog, then one PATCH carrying both `defaultModelId` and
`enabledModelIds`.
**Alternate paths**: `GET /api/models` is the only catalog source, but the *effective*
model for a chat is also readable from `GET /api/sessions/[sessionId]/chats/[chatId]`,
and `GET /api/settings/agents` returns a per-role `modelId` that overrides this default
for subagent roles — three places that answer "which model will run".

### Steps
1. `GET /api/models` (no auth required) → expect 200 `{models:[{id,name,contextWindow,...}]}`
2. `PATCH /api/settings/preferences` — body: `{"defaultModelId":"anthropic/claude-haiku-4.5","defaultSubagentModelId":"anthropic/claude-haiku-4.5","enabledModelIds":["anthropic/claude-haiku-4.5","anthropic/claude-opus-4.6"]}` → expect 200 `{preferences}`
3. `GET /api/settings/preferences` → expect 200 with `enabledModelIds` length 2

### Variations
- Send `{"defaultSubagentModelId":null}` to clear the subagent override and inherit the main default.
- Add a per-model system prompt: `{"modelSystemPrompts":{"anthropic/claude-opus-4.6":"Prefer small diffs. Always run the test suite before proposing a commit."}}`

### Edge Cases
- `{"defaultSubagentModelId":42}` → **400** `{"error":"Invalid defaultSubagentModelId"}`
- `{"defaultInferenceProfileId":7}` → **400** `{"error":"Invalid defaultInferenceProfileId"}`
- `{"modelSystemPrompts":{"anthropic/claude-opus-4.6":123}}` → **400** (fails `modelSystemPromptsSchema`)
- `GET /api/models` while the AI Gateway is unreachable → **500**

---

## STORY-settings-03: Bring your own inference endpoint end to end

**Type**: medium
**Persona**: Developer with a ZAI/GLM API key who wants to route agent traffic through it
**Goal**: Register a BYO endpoint, verify it works, and make it the account default
**Preconditions**: A real (or stub) OpenAI-compatible endpoint reachable from the server.
**Ideal path**: 4 — create, test, set default, confirm. Model discovery happens
automatically inside POST, so no separate "list models" call is needed.
**Alternate paths**: none found for creating a profile. But the *selected* profile is
readable from three places: `GET /api/inference-profiles`, `GET
/api/settings/preferences` (`defaultInferenceProfileId`), and per-chat via `PATCH
/api/sessions/[sessionId]/chats/[chatId]` (`inferenceProfileId`). Spend attribution is
returned both by `GET /api/inference-profiles/usage` and by the `/api/usage*` family.

### Steps
1. `GET /api/inference-profiles` → expect 200 `{profiles:[]}`
2. `POST /api/inference-profiles` — body: `{"name":"ZAI GLM","provider":"openai_compatible","baseUrl":"https://api.z.ai/api/paas/v4","apiKey":"zai-sk-9f3c2b7e41d84a05b6d1","enabled":true}` → expect **201** `{profile:{id,name,provider,baseUrl,keyLast4,keyFingerprint,status:"untested",enabled,models:[...]}}` — note the raw key is never echoed back
3. `POST /api/inference-profiles/{profileId}/test` — body: `{"modelId":"glm-4.6"}` → expect 200 `{profile,result:{status:"passed"|"failed",message}}`
4. `PATCH /api/settings/preferences` — body: `{"defaultInferenceProfileId":"{profileId}"}` → expect 200 `{preferences}`
5. `GET /api/inference-profiles/usage` → expect 200 `{usage:[{profileId,...}]}`

### Variations
- Rotate the key: `PATCH /api/inference-profiles` body `{"profileId":"{id}","apiKey":"zai-sk-1c7e5a90d3b64f28ae02"}` → 200, `keyLast4` changes.
- Temporarily disable without deleting: `PATCH` body `{"profileId":"{id}","enabled":false}` → 200.
- Anthropic-direct profile: `{"name":"Anthropic direct","provider":"anthropic","apiKey":"sk-ant-api03-Kd82..."}` (no `baseUrl` needed).

### Edge Cases
- `POST` with `{"name":"ZAI GLM","provider":"openai_compatible","apiKey":"zai-sk-..."}` (no baseUrl) → **400** `{"error":"OpenAI-compatible profiles require a base URL."}`
- `POST` with `{"baseUrl":"not-a-url",...}` → **400** `{"error":"Base URL must be a valid HTTP URL."}`
- `POST` a second profile named `"ZAI GLM"` → **400** `{"error":"An inference profile with that name already exists."}` (unique-violation mapped to 400, not 409 — inconsistent with `/api/settings/skills`, which returns 409 for the same class of conflict)
- `POST` with `{}` → **400** `{"error":"Invalid inference profile payload"}`
- `PATCH` with only `{"profileId":"{id}"}` → **400** `{"error":"Invalid inference profile payload"}` (schema requires at least one changed field)
- `PATCH`/`DELETE` with a profileId owned by nobody → **404** `{"error":"Inference profile not found"}`
- `POST /api/inference-profiles/does-not-exist/test` → **404**
- `POST /api/inference-profiles/{id}/test` after the stored key can no longer be decrypted → 200 with `result.status:"failed"` and the re-enter-key message

---

## STORY-settings-04: Delete an inference profile that is currently the default

**Type**: short
**Persona**: Developer whose trial API key expired
**Goal**: Remove the profile and confirm nothing still points at it
**Preconditions**: STORY-settings-03 completed (profile exists and is the account default).
**Ideal path**: 2 — clear the preference, delete the profile. An ideal API would cascade
on delete; here the caller must unset the preference itself.
**Alternate paths**: none found.

### Steps
1. `PATCH /api/settings/preferences` — body: `{"defaultInferenceProfileId":null}` → expect 200
2. `DELETE /api/inference-profiles` — body: `{"profileId":"{profileId}"}` → expect 200 `{"success":true}`
3. `GET /api/inference-profiles` → expect 200 `{profiles:[]}`

### Variations
- Delete *without* step 1 first, then `GET /api/settings/preferences` to observe whether `defaultInferenceProfileId` is left dangling — worth asserting.

### Edge Cases
- `DELETE` with `{}` → **400** `{"error":"Invalid inference profile payload"}`
- `DELETE` twice with the same id → second call **404** `{"error":"Inference profile not found"}`

---

## STORY-settings-05: Author, refine, and retire a Skill

**Type**: medium
**Persona**: Team lead codifying the repo's review checklist as a reusable Skill
**Goal**: Create a Skill, restrict its tools, enable it globally, then delete it
**Preconditions**: None.
**Ideal path**: 4 — create, update, wire into preferences, delete.
**Alternate paths**: Skills surface from **two** different endpoints — `GET
/api/settings/skills` (user-authored rows in the DB) and `GET
/api/sessions/[sessionId]/skills` (Skills discovered inside a running sandbox). Same
concept, different source of truth; a caller wanting "all skills available to this chat"
must call both.

### Steps
1. `GET /api/settings/skills` → expect 200 `{skills:[]}`
2. `POST /api/settings/skills` — body: `{"name":"pr-review-checklist","description":"Run our PR review checklist: migrations, error handling, test coverage, and rollback notes.","body":"# PR review checklist\n\n1. Does the diff include a generated migration when schema.ts changed?\n2. Are new API routes owner-scoped?\n3. Is there a failing-first test for each behavior change?\n4. State the rollback path.","enabled":true,"userInvocable":true,"disableModelInvocation":false,"allowedTools":["read_file","bash","grep"],"source":"manual"}` → expect **201** `{skill:{id,name,description,body,enabled,allowedTools,source,...}}`
3. `PATCH /api/settings/skills` — body: `{"id":"{skillId}","description":"Run our PR review checklist, including deploy and rollback impact.","allowedTools":["read_file","grep"]}` → expect 200 `{skill}`
4. `PATCH /api/settings/preferences` — body: `{"globalSkillRefs":[{"type":"user","id":"{skillId}"}]}` → expect 200 `{preferences}` (shape validated by `globalSkillRefsSchema`)
5. `PATCH /api/settings/skills` — body: `{"id":"{skillId}","enabled":false}` → expect 200
6. `DELETE /api/settings/skills` — body: `{"id":"{skillId}"}` → expect 200 `{"success":true}`

### Variations
- Model-only skill: `{"userInvocable":false,"disableModelInvocation":false,...}`.
- Human-only skill: `{"disableModelInvocation":true}`.

### Edge Cases
- `POST` with `{"name":"PR Review","...}` → **400** `{"error":"Use lowercase letters, numbers, and single hyphens (e.g. code-review)"}`
- `POST` with `{"name":"model",...}` → **400** `{"error":"That name is reserved. Pick a different one."}` (also `resume`, `new`)
- `POST` with `{"name":"x",...}` → **400** `{"error":"Name must be at least 2 characters"}`
- `POST` a second skill named `pr-review-checklist` → **409** (`SkillNameConflictError`)
- `PATCH` renaming skill B onto skill A's name → **409**
- `PATCH` with an unknown `id` → **404** `{"error":"Skill not found"}`
- `DELETE` with `{}` → **400** `{"error":"Invalid skill payload"}`
- `body` longer than 100,000 chars → **400** `{"error":"Instructions must be 100000 characters or fewer"}`
- `allowedTools` with 51 entries → **400** `{"error":"Too many allowed tools"}`

---

## STORY-settings-06: Draft a Skill with AI, then save the edited draft

**Type**: short
**Persona**: Developer who wants a Skill but doesn't want to write SKILL.md by hand
**Goal**: Generate a draft, tweak the name, and persist it
**Preconditions**: AI Gateway credentials configured on the server.
**Ideal path**: 2 — generate returns an unsaved draft; POST saves it. The two-step split
is deliberate (the user reviews before saving).
**Alternate paths**: none found — generation is only exposed at `/api/settings/skills/generate`.

### Steps
1. `POST /api/settings/skills/generate` — body: `{"prompt":"A skill that audits a Next.js route handler for missing owner scoping and missing zod validation, and reports findings as a checklist."}` → expect 200 `{skill:{name,description,body}}` (name already slugified; no `id` — it is not persisted)
2. `POST /api/settings/skills` — body: the returned draft plus `{"source":"generated","enabled":true}` → expect **201** `{skill}`
3. `GET /api/settings/skills` → expect 200 with the new skill present

### Variations
- Re-generate with a sharper prompt and save only the second draft.

### Edge Cases
- `POST /api/settings/skills/generate` with `{"prompt":""}` → **400** `{"error":"Describe what the skill should do first."}`
- Prompt over `SKILL_GENERATION_REQUEST_MAX_LENGTH` → **400** (same message)
- 11 generate calls inside 60s → **429** (rate limit: 10/min keyed on user id)
- Bot-protection trip → **403** `{"error":"Access denied"}`
- Model returns nothing usable → **502** `{"error":"Couldn't generate a draft. Try again."}`
- Saving a generated draft whose slug already exists → **409**

---

## STORY-settings-07: Configure the four agent roles

**Type**: medium
**Persona**: Power user tuning main/explorer/executor/design agents
**Goal**: Give each role its own model and instructions, enable GitHub tools on main only, then reset one role
**Preconditions**: None. Step 4 assumes a Composio profile exists (see STORY-settings-08) if `composioProfileId` is set.
**Ideal path**: 5 — one read plus one PATCH per role. There is no bulk-upsert, so four
writes are unavoidable with the current API.
**Alternate paths**: `managedRuntimeProfileId` is settable in **three** places — here
(per role), `PATCH /api/settings/preferences` (`defaultManagedRuntimeProfileId`), and
`PATCH /api/settings/repositories/[owner]/[repo]` (per repo). `modelId` similarly appears
here, in preferences, and per-chat.

### Steps
1. `GET /api/settings/agents` → expect 200 `{agents:[{role:"main",...},{role:"explorer",...},{role:"executor",...},{role:"design",...}]}` — always four rows, all-null where nothing is set
2. `PATCH /api/settings/agents` — body: `{"role":"main","modelId":"anthropic/claude-opus-4.6","instructions":"Plan before editing. Name the protected path for every behavior change.","githubToolsEnabled":true}` → expect 200 `{agent}`
3. `PATCH /api/settings/agents` — body: `{"role":"explorer","modelId":"anthropic/claude-haiku-4.5","instructions":"Read-only. Report file paths and line numbers, never edit."}` → expect 200
4. `PATCH /api/settings/agents` — body: `{"role":"executor","modelId":"anthropic/claude-haiku-4.5","composioToolkitSlugs":["github","linear"],"toolAuthoringEnabled":true}` → expect 200
5. `PATCH /api/settings/agents` — body: `{"role":"design","managedRuntimeProfileId":"node-web-default"}` → expect 200
6. `GET /api/settings/agents` → expect 200 with all four rows populated
7. `DELETE /api/settings/agents` — body: `{"role":"design"}` → expect 200 `{"ok":true}`
8. `GET /api/settings/agents` → expect the `design` row back to all-null (inherited)

### Variations
- Clear a single field instead of the whole row: `{"role":"main","instructions":null}`.
- Turn tool authoring back off: `{"role":"executor","toolAuthoringEnabled":false}`.

### Edge Cases
- `{"role":"reviewer",...}` → **400** `{"error":"Invalid request body",details:{...}}` (enum is main/explorer/executor/design)
- `{"role":"main","temperature":0.2}` → **400** — schema is `.strict()`, unknown keys rejected
- `{"role":"main","modelId":""}` → **400** (`min(1)`)
- `DELETE` with `{}` → **400**
- `DELETE` a role that has no row → **200** `{"ok":true}` (idempotent, no 404)
- No cookie → **401**

---

## STORY-settings-08: Multi-turn tool-authoring approval loop

**Type**: long
**Persona**: Operator supervising an executor agent that proposes new Composio tools
**Goal**: Enable tool authoring, let the agent propose tools across a chat, then approve one and reject another
**Preconditions**: Composio configured (`GET /api/composio/status` reports configured); a
session + chat exists; STORY-settings-07 step 4 enabled `toolAuthoringEnabled` on the
executor role. This is the multi-turn story for this topic — several chat turns, tool
calls, and human approvals.
**Ideal path**: 8 — status check, profile create, role enable, two chat turns, list
pending entries, approve, reject. The extra polling calls below exist because the API has
no push channel for "a tool was proposed".
**Alternate paths**: Composio state is exposed by **four** endpoints —
`GET /api/composio/status`, `GET /api/composio/connected-accounts`,
`GET /api/settings/composio` (profiles + defaults), and
`GET /api/settings/repositories/[owner]/[repo]/composio` (repo policy). All four are
needed to answer "can this agent call this toolkit right now".

### Steps
1. `GET /api/composio/status?live=1` → expect 200 `{status:{configured,...}}`
2. `GET /api/composio/toolkits` → expect 200 `{toolkits:[...]}` (or **502** when the catalog fetch fails)
3. `POST /api/settings/composio` — body: `{"name":"Issue tracker tools","toolkitSlugs":["linear","github"]}` → expect **201** `{profile:{id,...}}`
4. `PATCH /api/settings/composio` — body: `{"defaults":{"profileId":"{profileId}"}}` → expect 200 `{defaults}`
5. `PATCH /api/settings/agents` — body: `{"role":"executor","composioProfileId":"{profileId}","toolAuthoringEnabled":true}` → expect 200 `{agent}`
6. `POST /api/sessions/{sessionId}/chats/{chatId}/messages` — body: `{"message":{"role":"user","parts":[{"type":"text","text":"Find the Linear issue for the failing deploy and propose a tool we can reuse for this lookup."}]}}` → expect 200 `text/event-stream`; drain the stream (turn 1)
7. `POST /api/sessions/{sessionId}/chats/{chatId}/messages` — body: `{"message":{"role":"user","parts":[{"type":"text","text":"Also propose a tool that posts a status comment back on the PR."}]}}` → expect 200 SSE (turn 2)
8. `GET /api/agents/tool-entries?agentId={agentId}` → expect 200 `{entries:[{id,status:"proposed",...},...]}`
9. `POST /api/agents/tool-entries` — body: `{"action":"approve","entryId":"{entryA}"}` → expect 200 `{ok:true,action:"approve"}`
10. `POST /api/agents/tool-entries` — body: `{"action":"reject","entryId":"{entryB}"}` → expect 200 `{ok:true,action:"reject"}`
11. `GET /api/agents/tool-entries?agentId={agentId}` → expect 200 with updated statuses
12. `POST /api/sessions/{sessionId}/chats/{chatId}/messages` — body: `{"message":{"role":"user","parts":[{"type":"text","text":"Use the approved lookup tool and summarize the issue."}]}}` → expect 200 SSE (turn 3, now with the approved tool available)

### Variations
- Repo-scope the profile first: `PATCH /api/settings/repositories/acme/checkout/composio` with an allow-list, then confirm the executor still sees the toolkit.
- Reject both entries and confirm turn 3 reports the tool is unavailable.

### Edge Cases
- `GET /api/agents/tool-entries` with no `agentId` → **400** `{"error":"Missing required query param: agentId"}`
- `POST /api/agents/tool-entries` with `{"action":"archive","entryId":"x"}` → **400** `{"error":"Invalid request body",details:{...}}`
- Approving an entry owned by another user → **404** `{"error":"Tool entry not found or not owned by you"}`
- `POST /api/settings/composio` with a duplicate profile name → **409**
- `PATCH /api/settings/composio` with an unknown `profileId` → **404**
- All tool-entry routes with no cookie → **401**

---

## STORY-settings-09: Custom model variant with provider options

**Type**: medium
**Persona**: Developer who wants a high-thinking-budget preset of Opus
**Goal**: Create a named variant, use it as the default, then delete it
**Preconditions**: None.
**Ideal path**: 3 — list, create, set default.
**Alternate paths**: variants and base models are returned by two different endpoints —
`GET /api/settings/model-variants` (built-in + custom) and `GET /api/models` (gateway
catalog). Both answer "what can I pick".

### Steps
1. `GET /api/settings/model-variants` → expect 200 `{modelVariants:[...]}` (built-ins included)
2. `POST /api/settings/model-variants` — body: `{"name":"Opus deep thinking","baseModelId":"anthropic/claude-opus-4.6","providerOptions":{"anthropic":{"thinking":{"type":"enabled","budgetTokens":16000}}}}` → expect 200 `{modelVariants}` including the new row
3. `PATCH /api/settings/model-variants` — body: `{"id":"{variantId}","name":"Opus deep thinking (16k)"}` → expect 200 `{modelVariants}`
4. `PATCH /api/settings/preferences` — body: `{"defaultModelId":"{variantId}"}` → expect 200
5. `DELETE /api/settings/model-variants` — body: `{"id":"{variantId}"}` → expect 200 `{modelVariants}`

### Variations
- Change only `providerOptions` on an existing variant.

### Edge Cases
- `PATCH` with only `{"id":"{variantId}"}` → **400** `{"error":"At least one field to update is required"}`
- `PATCH`/`DELETE` on a built-in variant id → **403**
- `PATCH`/`DELETE` on an unknown id → **404**
- `POST` with `{"baseModelId":"claude-opus"}` (no provider prefix) → **400**
- Persistence failure → **500**

---

## STORY-settings-10: MCP server registration lifecycle

**Type**: medium
**Persona**: Developer connecting an internal MCP tool server
**Goal**: Register a server with auth headers, toggle transport, disable it, delete it
**Preconditions**: None.
**Ideal path**: 3 — create, verify by list, delete. Steps below add the realistic
edit-in-place turns.
**Alternate paths**: none found — MCP servers are only exposed under
`/api/settings/mcp-servers`.

### Steps
1. `GET /api/settings/mcp-servers` → expect 200 `{servers:[]}`
2. `POST /api/settings/mcp-servers` — body: `{"name":"Internal docs MCP","url":"https://mcp.acme-internal.dev/sse","transport":"sse","headers":{"Authorization":"Bearer acme_mcp_5f21c8d0"}}` → expect **201** `{server:{id,name,url,transport,enabled,...}}`
3. `PATCH /api/settings/mcp-servers/{serverId}` — body: `{"enabled":false}` → expect 200 `{server}` with `transport` still `"sse"` (regression: omitting transport must not reset it to `"http"`)
4. `PATCH /api/settings/mcp-servers/{serverId}` — body: `{"headers":null}` → expect 200, all headers cleared
5. `PATCH /api/settings/mcp-servers/{serverId}` — body: `{"name":"Internal docs MCP (staging)","enabled":true}` → expect 200
6. `DELETE /api/settings/mcp-servers/{serverId}` → expect 200 `{"ok":true}`

### Variations
- Local dev server: `{"name":"Local MCP","url":"http://localhost:8931/mcp","transport":"http"}` → 201 (localhost http is explicitly allowed).

### Edge Cases
- `POST` with `{"url":"http://mcp.acme-internal.dev/sse"}` → **400** "URL must use https:// (or http://localhost / http://127.0.0.1 for local servers)"
- `POST` with `{"url":"ftp://x"}` or a non-URL → **400** "Must be a valid URL"
- `POST` with 11 headers → **400** "At most 10 headers allowed"
- `POST` with a duplicate `name` → **409** "A server with that name already exists."
- `PATCH` with `{"enabled":true,"bogusField":"x"}` → **400** (schema is `.strict()`)
- `PATCH` renaming onto an existing name → **409**
- `PATCH`/`DELETE` an unknown `serverId` → **404**

---

## STORY-settings-11: Custom managed-runtime profile as an account default

**Type**: medium
**Persona**: Platform engineer standardizing the toolchain for a Rust repo
**Goal**: Create a reusable runtime profile, make it the account default, then delete it and see the preference reset
**Preconditions**: None for creation. The deletion response reports whether the
preference was reset.
**Ideal path**: 3 — create, set as default, confirm.
**Alternate paths**: **Direct duplicate** — the same saved profiles are also managed
through the session-scoped family `GET/PATCH/DELETE
/api/sessions/[sessionId]/managed-runtime/profiles[/[profileId]]`, backed by the same
`managedRuntimeSavedProfiles` table and the same `updateProfileSchema`. Two full CRUD
surfaces for one resource. Testing a profile is only possible on the session-scoped route
(`POST /api/sessions/[sessionId]/managed-runtime/profiles/[profileId]/test`), so a user
who created the profile from Settings must open a session to verify it.

### Steps
1. `GET /api/settings/runtime-profiles` → expect 200 `{profiles:[{id,source:"built_in",...}]}`
2. `POST /api/settings/runtime-profiles` — body: `{"displayName":"Rust + wasm toolchain","description":"Rust stable with wasm32 target and cargo-nextest for the checkout service.","setupCommands":[{"id":"install-rust","label":"Install Rust","description":"Install the stable toolchain","command":"curl --proto '=https' -sSf https://sh.rustup.rs | sh -s -- -y","timeoutMs":300000,"required":true},{"id":"add-wasm","label":"Add wasm target","description":"Add the wasm32 compile target","command":"rustup target add wasm32-unknown-unknown"}],"verificationCommands":[{"id":"cargo-version","label":"cargo --version","description":"Confirm cargo is on PATH","command":"cargo --version"}],"expectedTools":["cargo","rustc"],"optionalTools":["cargo-nextest"],"defaultPorts":[3000,8080]}` → expect **201** `{profile:{id,source:"user_default",setupCommandCount:2,verificationCommandCount:1,...}}`
3. `PATCH /api/settings/runtime-profiles/{profileId}` — body: `{"displayName":"Rust + wasm toolchain v2","description":"...","setupCommands":[...],"verificationCommands":[...]}` → expect 200 `{profile}`
4. `PATCH /api/settings/preferences` — body: `{"defaultManagedRuntimeProfileId":"{profileId}"}` → expect 200 `{preferences}`
5. `GET /api/sessions/{sessionId}/managed-runtime/profiles` → expect 200 `{profiles}` — the same profile visible through the second surface
6. `DELETE /api/settings/runtime-profiles/{profileId}` → expect 200 `{deletedProfileId,preferenceReset:true}`
7. `GET /api/settings/preferences` → expect `defaultManagedRuntimeProfileId` no longer pointing at the deleted profile

### Variations
- Set the profile per-repo instead of account-wide: `PATCH /api/settings/repositories/acme/checkout` with `{"runtimeMode":"managed_runtime","managedRuntimeProfileId":"{profileId}"}`.

### Edge Cases
- `POST` with `{"setupCommands":[]}` → **400** (`min(1)`)
- `POST` with a command missing `description` → **400**
- `POST` with `{"defaultPorts":[0]}` → **400** (positive int required)
- `PATCH`/`DELETE` on a built-in profile id or an unowned id → **404**
- `PATCH /api/settings/preferences` with `{"defaultManagedRuntimeProfileId":"deleted-profile"}` → **400** `{"error":"Invalid managed runtime profile","errorKind":"profile_not_found","nextAction":"This profile no longer exists. Choose another profile or recreate it."}`

---

## STORY-settings-12: Per-repo overrides and reset to inherited

**Type**: medium
**Persona**: Developer with one heavyweight monorepo and several small repos
**Goal**: Override sandbox size, clone depth, and auto-PR for one repo only, then reset it
**Preconditions**: Account preferences already set (STORY-settings-01/02) so the
resolved-vs-raw distinction is observable.
**Ideal path**: 3 — read resolved+raw, patch overrides, reset. GET already returns both
layers in one call, which is the right shape.
**Alternate paths**: `autoCommitPush`, `autoCreatePr`, and `managedRuntimeProfileId`
each also live on `PATCH /api/settings/preferences` (account layer); `runtimeMode` and
profile selection are additionally visible from `GET /api/repos/[owner]/[repo]/dashboard`.

### Steps
1. `GET /api/settings/repositories/acme/checkout` → expect 200 `{resolved:{...},raw:{...}}` — `raw` fields null where inherited
2. `PATCH /api/settings/repositories/acme/checkout` — body: `{"fullClone":true,"vcpus":8,"prewarmEnabled":true,"autoCreatePr":false,"defaultBranch":"develop","isNewBranch":true}` → expect 200 `{resolved,raw}`
3. `PATCH /api/settings/repositories/acme/checkout` — body: `{"runtimeMode":"managed_runtime","managedRuntimeProfileId":"node-web-default"}` → expect 200
4. `GET /api/settings/repositories/acme/checkout` → expect `resolved` reflecting overrides, `raw` showing only the six/eight set fields
5. `PATCH /api/settings/repositories/acme/checkout` — body: `{"vcpus":null}` → expect 200, `vcpus` back to inherited in `resolved`
6. `DELETE /api/settings/repositories/acme/checkout` → expect 200 `{resolved,raw}` with every `raw` field null

### Variations
- Repo-scoped Composio policy in the same visit: `GET` then `PATCH /api/settings/repositories/acme/checkout/composio` with allow/block lists → 200 `RepositoryComposioSettingsResponse`.

### Edge Cases
- `{"runtimeMode":"turbo"}` → **400** (enum is `classic` | `managed_runtime`)
- `{"vcpus":0}` or `{"vcpus":-2}` → **400** (positive int)
- `{"defaultBranch":""}` → **400** (`min(1)`)
- A repo with no settings row yet → **200** with all-null `raw` (not 404)
- `PATCH .../composio` when the Composio API is unreachable → **502**
- No cookie → **401**

---

## Cross-story redundancy notes

- **Model selection** is writable at four layers: preferences (`defaultModelId`), agent role (`/api/settings/agents`), chat (`PATCH /api/sessions/[sessionId]/chats/[chatId]`), and background agents/loops (`modelId` in their create schemas). No single endpoint reports the effective winner.
- **Managed runtime profiles** have two complete CRUD surfaces: `/api/settings/runtime-profiles*` and `/api/sessions/[sessionId]/managed-runtime/profiles*`. Only the session-scoped one can run a test.
- **Skills** come from two sources with the same name: `/api/settings/skills` (DB rows) and `/api/sessions/[sessionId]/skills` (sandbox discovery).
- **Composio state** is split across `/api/composio/status`, `/api/composio/connected-accounts`, `/api/settings/composio`, and `/api/settings/repositories/[owner]/[repo]/composio`.
- **Conflict-status inconsistency**: duplicate-name conflicts return **409** on skills and MCP servers, but **400** on inference profiles.
- **Not-found inconsistency**: unowned resources return **404** almost everywhere in this topic (existence-leak avoidance), except built-in model variants, which return **403**.
