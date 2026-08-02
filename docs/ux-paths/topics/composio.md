# UX Paths — Composio tool connections & repo policy

Routes covered (all verified against `apps/web/app/api/**`):

- `POST /api/composio/connect`
- `GET /api/composio/connected-accounts`
- `GET /api/composio/status`
- `GET /api/composio/toolkits`
- `GET|POST|PATCH|DELETE /api/settings/composio`
- `GET|PATCH /api/settings/repositories/[repoOwner]/[repoName]/composio`
- `PATCH /api/sessions/[sessionId]/chats/[chatId]` (composioSelection)
- `POST /api/sessions/[sessionId]/chats`, `POST /api/sessions` (default profile applied at creation)
- `POST /api/sessions/[sessionId]/chats/[chatId]/fork` (selection carried over)
- `GET|PATCH /api/settings/agents` (per-role composioProfileId / composioToolkitSlugs)
- `GET /api/background-agents/[agentId]/tool-preflight`

Known duplication (do not resolve silently):

- **Composio config status** is returned by `GET /api/composio/status` *and* embedded as `status` in `GET /api/settings/composio`. Both call `connectedAccounts.list` for the live check.
- **Repo policy + profile options** are returned by `GET /api/settings/composio?repoOwner=&repoName=` *and* `GET /api/settings/repositories/{owner}/{repo}/composio` — same `listComposioProfileOptionsForRepository` payload, second one just adds `repoOwner`/`repoName` echo.
- **Profile list** appears in `GET /api/settings/composio` (`profiles`) and inside every repo-scoped GET/PATCH response (`profiles`).
- **Per-agent toolkit assignment** exists twice: profile-based (`/api/settings/composio` defaults + repo `agentDefaults`) and row-based (`/api/settings/agents` `composioProfileId` + `composioToolkitSlugs`).
- **Connection state** is available from `GET /api/composio/connected-accounts` and indirectly from `GET /api/composio/status?live=1`.

Auth: every route here uses `requireAuthenticatedUser()` → **401 `{error:"Not authenticated"}`** when the session cookie is missing.

---

## STORY-composio-01: First look at tool integrations

**Type**: short
**Persona**: New user opening Settings → Tools for the first time
**Goal**: Find out whether Composio is configured on this deployment and what can be connected
**Preconditions**: Authenticated session cookie; no profiles created yet
**Ideal path**: 2 — one status/config read and one catalog read. Today's `GET /api/settings/composio` already bundles status + profiles + defaults, so 2 is achievable.
**Alternate paths**: `GET /api/composio/status` duplicates the `status` field of `GET /api/settings/composio`; `?live=1` additionally proves the API key works.

### Steps
1. `GET /api/settings/composio` → expect 200 `{status,profiles:[],profileOptions,repositorySettings:null,defaults}`
2. `GET /api/composio/toolkits` → expect 200 `{toolkits:[{slug:"gmail",name:"Gmail",...},{slug:"linear",...},...]}` (route sets `revalidate = 3600`)

### Variations
- `GET /api/composio/status?live=1` → 200 `{status:{...configured}}`; with no `COMPOSIO_API_KEY` the SDK error mentioning `COMPOSIO_API_KEY` maps to the *disabled* status, any other error to *unavailable* — both still **200**.

### Edge Cases
- No cookie on any of the above → **401** `{error:"Not authenticated"}`.
- Composio catalog fetch fails → `GET /api/composio/toolkits` returns **502** `{error:"<redacted message>"}` (the only Composio route that 502s on catalog failure besides repo PATCH).
- Composio unconfigured → `GET /api/composio/connected-accounts` returns **200** `{accounts:[]}` with **no** `unavailable` flag; an SDK failure returns **200** `{accounts:[],unavailable:true}`. Never 500.

---

## STORY-composio-02: Connect a Gmail account via managed OAuth

**Type**: short
**Persona**: Solo developer wiring Gmail into their agent
**Goal**: Get a redirect URL, complete OAuth, confirm the account shows connected
**Preconditions**: `COMPOSIO_API_KEY` configured (STORY-01 shows `status` configured)
**Ideal path**: 2 — mint link, then verify connection. (OAuth itself happens in the browser, outside the API.)
**Alternate paths**: `authConfigId` instead of `toolkitSlug` on the same route is the advanced escape hatch — same endpoint, two mutually-sufficient inputs.

### Steps
1. `POST /api/composio/connect` — body: `{"toolkitSlug":"gmail","alias":"work-gmail","callbackUrl":"http://localhost:3000/settings/tools?connected=gmail"}` → expect 200 `{id:"ca_...",redirectUrl:"https://backend.composio.dev/api/v3/.../oauth"}`
2. (browser completes OAuth out of band)
3. `GET /api/composio/connected-accounts` → expect 200 `{accounts:[{id:"ca_...",toolkitSlug:"gmail",status:"ACTIVE",...}]}`

### Variations
- Advanced custom OAuth app: `POST /api/composio/connect` — body `{"authConfigId":"ac_01hzq9custom","alias":"gmail-corp"}` → 200 same shape (skips `resolveManagedAuthConfigId`).

### Edge Cases
- Body `{}` (neither field) → **400** `{error:"Invalid Composio connect payload"}` (zod `.refine`).
- Non-JSON body → **400** `{error:"Invalid JSON body"}`.
- `{"toolkitSlug":"gmail","callbackUrl":"not-a-url"}` → **400** invalid payload (`z.url()`).
- `alias` longer than 80 chars → **400** invalid payload.
- Unknown toolkit slug (`"gmial"`) → SDK throws; route returns **400** with the SDK message, not 404.
- No cookie → **401**.

---

## STORY-composio-03: Create a reusable tool profile

**Type**: short
**Persona**: Developer grouping Gmail + Linear into one "Support triage" profile
**Goal**: Persist a named profile the agents can be pointed at
**Preconditions**: STORY-02 connected accounts exist
**Ideal path**: 2 — create, then read back. A well-designed POST already returns the created profile (it does, 201), so the read-back is only for the caller's list view.
**Alternate paths**: profile also comes back inside `GET /api/settings/repositories/{owner}/{repo}/composio` (`profiles`).

### Steps
1. `POST /api/settings/composio` — body: `{"name":"Support triage","toolkitSlugs":["gmail","linear"],"connectedAccountIdsByToolkit":{"gmail":["ca_01hzq9gmail"],"linear":["ca_01hzq9linear"]},"workbenchEnabled":true,"allowInChatConnectionManagement":false}` → expect **201** `{profile:{id,userId,name,toolkitSlugs,...,createdAt,updatedAt}}`
2. `GET /api/settings/composio` → expect 200 with the new profile in `profiles` and in `profileOptions`

### Variations
- Minimal body `{"name":"Scratch"}` — all other fields have zod defaults (`toolkitSlugs:[]`, `workbenchEnabled:false`).

### Edge Cases
- `{"name":""}` → **400** `{error:"Invalid Composio profile"}`.
- `{"name":"<81 chars>"}` → **400** invalid profile.
- Second profile with the same name → **409** `{error:"A profile with that name already exists."}` (postgres `23505` walked through `error.cause`).
- Domain error containing "at least one toolkit" → **400** with that exact message surfaced.
- No cookie → **401**.

---

## STORY-composio-04: Edit and delete a profile

**Type**: short
**Persona**: Developer pruning an unused profile
**Goal**: Rename one profile, delete another
**Preconditions**: STORY-03 profile exists
**Ideal path**: 2 — one PATCH, one DELETE. Both are on the same collection route keyed by a body `profileId` rather than a path param.
**Alternate paths**: none found (no `/api/settings/composio/[profileId]` route exists — id travels in the body, including for DELETE).

### Steps
1. `PATCH /api/settings/composio` — body: `{"profileId":"<profile-id>","profile":{"name":"Support triage (EU)","workbenchEnabled":false}}` → expect 200 `{profile:{...}}`
2. `DELETE /api/settings/composio` — body: `{"profileId":"<other-profile-id>"}` → expect 200 `{success:true}`

### Variations
- Combined write: `{"defaults":{"main":{"defaultProfileId":"<id>","allowChatOverride":true}},"profileId":"<id>","profile":{"name":"Support triage v2"}}` → 200 `{defaults,profile}` (both keys present).

### Edge Cases
- `PATCH` with `{}` → **400** `{error:"At least one update is required"}`.
- `PATCH` with `{"profileId":"missing-id","profile":{"name":"X"}}` → **404** `{error:"Profile not found"}`.
- `PATCH` with an unknown key inside `profile` → **400** `{error:"Invalid Composio settings payload"}` (patch schema is `.strict()`).
- `PATCH` renaming to an existing name → **409**.
- `DELETE` `{"profileId":"missing-id"}` → **404** `{error:"Profile not found"}`; `{}` → **400** `{error:"Invalid profile id"}`.
- Another user's profile id → **404** (queries are user-scoped), not 403.

---

## STORY-composio-05: Set per-agent-role defaults

**Type**: medium
**Persona**: Team lead deciding which sub-agents may use external tools
**Goal**: Main agent gets the support profile and may be overridden per chat; explorer/executor/design get nothing
**Preconditions**: STORY-03 profile exists
**Ideal path**: 2 — one defaults PATCH (all four roles in one body), one read-back.
**Alternate paths**: `PATCH /api/settings/agents` also stores `composioProfileId`/`composioToolkitSlugs` per role — a second, row-based mechanism for the same intent. Recorded as redundancy.

### Steps
1. `PATCH /api/settings/composio` — body: `{"defaults":{"main":{"defaultProfileId":"<profile-id>","allowChatOverride":true},"explorer":{"defaultProfileId":null,"allowChatOverride":false},"executor":{"defaultProfileId":null,"allowChatOverride":false},"design":{"defaultProfileId":null,"allowChatOverride":false}}}` → expect 200 `{defaults:{main:{...},explorer:{...},executor:{...},design:{...}}}`
2. `GET /api/settings/composio` → expect 200, `defaults.main.defaultProfileId` equals the profile id
3. `GET /api/settings/agents` → expect 200 `{agents:[{role:"main",composioProfileId:null,composioToolkitSlugs:[],...}, ...four rows]}` — note this second surface is still empty, proving the two mechanisms are independent
4. `PATCH /api/settings/agents` — body: `{"role":"executor","composioToolkitSlugs":["linear"]}` → expect 200 `{agent:{role:"executor",composioToolkitSlugs:["linear"],...}}`
5. `GET /api/settings/agents` → expect 200 with the executor row populated

### Variations
- Roles may be patched one at a time: `{"defaults":{"main":{"defaultProfileId":null,"allowChatOverride":false}}}` → 200 (partial object allowed).

### Edge Cases
- `{"defaults":{"researcher":{...}}}` → **400** `{error:"Invalid Composio settings payload"}` (defaults schema is `.strict()`; only main/explorer/executor/design).
- `{"defaults":{"main":{"defaultProfileId":""}}}` → **400** (`z.string().min(1).nullable()`).
- `PATCH /api/settings/agents` with `{"role":"analyst"}` → **400** `{error:"Invalid request body",details:{...}}`.
- No cookie → **401** on both routes.

---

## STORY-composio-06: Lock a repository down to one profile and block a toolkit

**Type**: medium
**Persona**: Repo owner applying tool governance before letting agents run on `acme/payments-api`
**Goal**: Only the vetted profile is selectable on this repo, and Gmail is pre-emptively blocked
**Preconditions**: STORY-03 profile exists; STORY-05 defaults set
**Ideal path**: 2 — read current repo policy, write the new one (PATCH returns the full recomputed policy).
**Alternate paths**: `GET /api/settings/composio?repoOwner=acme&repoName=payments-api` returns the identical `profileOptions`/`repositorySettings` payload — duplicate read path.

### Steps
1. `GET /api/settings/repositories/acme/payments-api/composio` → expect 200 `{profiles,profileOptions,repositorySettings:null,repoOwner:"acme",repoName:"payments-api"}`
2. `PATCH /api/settings/repositories/acme/payments-api/composio` — body: `{"inheritGlobalDefaults":false,"allowedProfileIds":["<profile-id>"],"blockedToolkitSlugs":["gmail"],"agentDefaults":{"main":{"defaultProfileId":"<profile-id>","allowChatOverride":false}},"selectedToolkitSlugs":["linear"]}` → expect 200 `{profiles,profileOptions,repositorySettings:{inheritGlobalDefaults:false,allowedProfileIds:[...],blockedToolkitSlugs:["gmail"],agentDefaults:{...},selectedToolkitSlugs:["linear"]},repoOwner,repoName}`
3. `GET /api/settings/composio?repoOwner=acme&repoName=payments-api` → expect 200 with the *same* `repositorySettings` — confirms the duplicate read surface agrees

### Variations
- `"selectedToolkitSlugs": null` means "never configured" (GitHub tools default-on at resolution) — distinct from `[]` which is an explicit empty choice.
- Repo names with dots/dashes are URL-decoded by the route (`decodeURIComponent`), e.g. `/api/settings/repositories/acme/payments.api/composio`.

### Edge Cases
- `blockedToolkitSlugs:["gmial"]` (typo) → **400** `{error:"Repository Composio settings reference unrecognized toolkit slugs: gmial"}` — validated against the full catalog, not connected accounts.
- `allowedProfileIds:["prf_not_mine"]` → **400** `{error:"Repository Composio settings reference unknown profiles"}`.
- Catalog lookup itself fails while `blockedToolkitSlugs` is non-empty → **502** `{error:"Could not validate blocked toolkits: <redacted>"}`.
- Composio unconfigured → catalog is treated as empty/permissive, so any block slug saves with **200**. (Behavior difference worth flagging in QA.)
- Unknown key in body → **400** `{error:"Invalid repository Composio settings"}` (`.strict()`).
- Empty `repoOwner` after decode (e.g. `/api/settings/repositories/%20/x/composio`) → **400** `{error:"Invalid repository"}`.
- Non-JSON body → **400** `{error:"Invalid JSON body"}`. No cookie → **401**.

---

## STORY-composio-07: Chat-level profile selection is refused by repo policy

**Type**: medium
**Persona**: Developer trying to use a non-vetted profile inside a chat on a governed repo
**Goal**: Confirm the repo allowlist actually blocks the selection at chat level
**Preconditions**: STORY-06 policy on `acme/payments-api`; a second profile that is NOT in `allowedProfileIds`; an existing session on that repo
**Ideal path**: 3 — create the session, attempt the disallowed selection (rejected), apply the allowed one.
**Alternate paths**: the same `composioSelection` field is also written implicitly at `POST /api/sessions` and `POST /api/sessions/[sessionId]/chats`, where the *default* profile is silently dropped if repo policy disallows it (no error surfaced) — a third write path with different failure semantics.

### Steps
1. `POST /api/sessions` — body: `{"repoOwner":"acme","repoName":"payments-api","title":"Tool policy check"}` → expect 200/201 `{session:{id,...},chat:{id,composioSelection:{mainProfileId:null|<allowed-id>}}}` — the default profile is applied only when `isComposioProfileAllowedForRepository` allows it
2. `PATCH /api/sessions/<sessionId>/chats/<chatId>` — body: `{"composioSelection":{"mainProfileId":"<disallowed-profile-id>"}}` → expect **400** `{error:"<policy reason>"}` (falls back to `"Selected Composio profile is blocked by repository policy"`)
3. `PATCH /api/sessions/<sessionId>/chats/<chatId>` — body: `{"composioSelection":{"mainProfileId":"<allowed-profile-id>"}}` → expect 200 `{chat:{...,composioSelection:{mainProfileId:"<allowed-profile-id>"}}}`
4. `GET /api/sessions/<sessionId>/chats/<chatId>` → expect 200 `{chat:{composioSelection:{...}}}`

### Variations
- Direct toolkit bypass: `{"composioSelection":{"mainProfileId":null,"directToolkitSlugs":["linear"]}}` → 200. Note: policy check only runs when `mainProfileId` is set, so `directToolkitSlugs` is **not** checked against `blockedToolkitSlugs` at this route.
- Per-agent override: `{"composioSelection":{"mainProfileId":"<allowed-id>","agentProfileOverrides":{"executor":null}}}` → 200.

### Edge Cases
- `{"composioSelection":{"mainProfileId":123}}` → **400** `{error:"Invalid composioSelection"}`.
- `{"composioSelection":{"unknownKey":true}}` → **400** invalid composioSelection (`.strict()`).
- `{}` → **400** `{error:"At least one field is required"}`.
- Chat id belonging to another user's session → **404** from `requireOwnedSessionChat`.
- No cookie → **401**.

---

## STORY-composio-08: Fork a chat and confirm the tool selection carries

**Type**: short
**Persona**: Developer branching a conversation without losing tool wiring
**Goal**: Verify the forked chat inherits `composioSelection`
**Preconditions**: STORY-07 step 3 (chat has an allowed profile selected)
**Ideal path**: 2 — fork, read back.
**Alternate paths**: none found.

### Steps
1. `POST /api/sessions/<sessionId>/chats/<chatId>/fork` — body: `{"title":"Fork: policy check"}` → expect 200 `{chat:{id:"<new-chat-id>",composioSelection:{mainProfileId:"<allowed-profile-id>"}}}`
2. `GET /api/sessions/<sessionId>/chats/<new-chat-id>` → expect 200, `composioSelection` identical to the source chat

### Edge Cases
- Fork of a chat in someone else's session → **404**.
- No cookie → **401**.

---

## STORY-composio-09: Background agent tool preflight before a scheduled run

**Type**: medium
**Persona**: Operator about to enable a nightly background agent that emails a digest
**Goal**: Predict, without running anything, whether the agent's toolkits will actually be available under repo policy
**Preconditions**: A background agent exists on `acme/payments-api` with `composioToolkitSlugs:["gmail","linear"]`; STORY-06 blocked `gmail` on that repo
**Ideal path**: 2 — read the agent, run preflight. Preflight is a pure GET with no session minted.
**Alternate paths**: repo policy can also be inferred manually by combining `GET /api/settings/repositories/.../composio` with `GET /api/composio/connected-accounts` — the preflight route exists to collapse that.

### Steps
1. `GET /api/background-agents` → expect 200 `{agents:[{id:"<agentId>",repoOwner:"acme",repoName:"payments-api",composioToolkitSlugs:["gmail","linear"],...}]}`
2. `GET /api/background-agents/<agentId>/tool-preflight` → expect 200 `{toolkits:[{slug:"gmail",available:false,reason:"blocked_by_repo_policy"|...},{slug:"linear",available:true,...}]}`
3. `PATCH /api/settings/repositories/acme/payments-api/composio` — body: `{"inheritGlobalDefaults":false,"allowedProfileIds":["<profile-id>"],"blockedToolkitSlugs":[],"agentDefaults":{},"selectedToolkitSlugs":["gmail","linear"]}` → expect 200 (unblocks gmail)
4. `GET /api/background-agents/<agentId>/tool-preflight` → expect 200 with `gmail` now predicted available (or `composio_unreachable` if the SDK is down)

### Edge Cases
- Agent with no toolkits configured → **200** `{toolkits:[]}` (short-circuit, no Composio call).
- Unknown or other-user agent id → **404** `{error:"Background agent not found"}`.
- Preflight computation throws (e.g. policy DB read fails) → **500** `{error:"Failed to compute tool preflight."}` plus an `agent_tool_preflight.request_failed` warn log.
- No cookie → **401**.

---

## STORY-composio-10: Composio is down — every surface degrades honestly

**Type**: medium
**Persona**: Support engineer diagnosing "my tools disappeared"
**Goal**: Distinguish "genuinely no connections" from "couldn't check right now" across every read surface
**Preconditions**: `COMPOSIO_API_KEY` set but the Composio API unreachable (network blocked / bad key)
**Ideal path**: 1 — one status endpoint should answer this. Today it takes 4 calls because status, accounts, catalog and settings each degrade differently.
**Alternate paths**: `GET /api/composio/status?live=1` and `GET /api/settings/composio` both perform the same live `connectedAccounts.list` probe.

### Steps
1. `GET /api/composio/status?live=1` → expect **200** `{status:{...unavailable, reason/message redacted}}` (never 5xx)
2. `GET /api/composio/connected-accounts` → expect **200** `{accounts:[],unavailable:true}` — the flag is the whole point of this story
3. `GET /api/composio/toolkits` → expect **502** `{error:"<redacted catalog error>"}`
4. `GET /api/settings/composio` → expect **200** with `status` unavailable but `profiles`/`defaults` still served from the database
5. `PATCH /api/settings/repositories/acme/payments-api/composio` — body: `{"inheritGlobalDefaults":true,"allowedProfileIds":[],"blockedToolkitSlugs":["gmail"],"agentDefaults":{},"selectedToolkitSlugs":null}` → expect **502** `{error:"Could not validate blocked toolkits: ..."}`
6. `PATCH /api/settings/repositories/acme/payments-api/composio` — body: same but `"blockedToolkitSlugs":[]` → expect **200** (catalog is only consulted when a denylist is present)

### Edge Cases
- Missing `COMPOSIO_API_KEY` entirely: step 1 returns the *disabled* status (error message contains `COMPOSIO_API_KEY`); step 2 returns `{accounts:[]}` with **no** `unavailable` flag; step 5 returns **200** because the catalog is treated as empty/permissive.
- Error messages must be redacted (`redactComposioErrorMessage`) — assert no API key substring leaks into any 502 body.
- No cookie → **401** on all six calls.

---

## STORY-composio-11: End-to-end governed rollout, multi-turn chat with tool approvals

**Type**: long
**Persona**: Platform owner onboarding a repo to external tools, then actually driving an agent through several turns with those tools
**Goal**: Connect two toolkits, build two profiles, govern the repo, wire agent roles, run a real multi-turn chat that uses the tools, then tighten policy mid-flight and see the chat selection reconciled
**Preconditions**: Authenticated user with GitHub repo `acme/payments-api` already linked; `COMPOSIO_API_KEY` configured
**Ideal path**: ~16 — connect x2, profiles x2, defaults, repo policy, session, three chat turns, mid-flight policy change, re-selection, verification. The actual walk below is longer mostly because status/policy data must be re-read from several duplicate surfaces.
**Alternate paths**: steps 8 and 20 read the same policy from two different routes; the agent-role wiring in step 7 duplicates the profile defaults from step 6.

### Steps
1. `GET /api/composio/status?live=1` → expect 200 `{status:{configured...}}`
2. `GET /api/composio/toolkits` → expect 200 `{toolkits:[...]}` containing slugs `gmail` and `linear`
3. `POST /api/composio/connect` — body: `{"toolkitSlug":"linear","alias":"acme-linear"}` → expect 200 `{id,redirectUrl}`
4. `POST /api/composio/connect` — body: `{"toolkitSlug":"gmail","alias":"acme-support-inbox"}` → expect 200 `{id,redirectUrl}`
5. `GET /api/composio/connected-accounts` → expect 200 `{accounts:[{toolkitSlug:"linear",...},{toolkitSlug:"gmail",...}]}`
6. `POST /api/settings/composio` — body: `{"name":"Issue triage","toolkitSlugs":["linear"],"connectedAccountIdsByToolkit":{"linear":["ca_01hzq9linear"]},"workbenchEnabled":true}` → expect **201** `{profile:{id:"<triage-id>"}}`
7. `POST /api/settings/composio` — body: `{"name":"Inbox + issues","toolkitSlugs":["gmail","linear"],"connectedAccountIdsByToolkit":{"gmail":["ca_01hzq9gmail"],"linear":["ca_01hzq9linear"]},"allowInChatConnectionManagement":true}` → expect **201** `{profile:{id:"<inbox-id>"}}`
8. `PATCH /api/settings/composio` — body: `{"defaults":{"main":{"defaultProfileId":"<inbox-id>","allowChatOverride":true},"executor":{"defaultProfileId":"<triage-id>","allowChatOverride":false}}}` → expect 200 `{defaults:{...}}`
9. `PATCH /api/settings/agents` — body: `{"role":"explorer","composioToolkitSlugs":[]}` → expect 200 `{agent:{role:"explorer",composioToolkitSlugs:[]}}`
10. `GET /api/settings/repositories/acme/payments-api/composio` → expect 200 `{repositorySettings:null,profileOptions:[both profiles]}`
11. `PATCH /api/settings/repositories/acme/payments-api/composio` — body: `{"inheritGlobalDefaults":true,"allowedProfileIds":["<inbox-id>","<triage-id>"],"blockedToolkitSlugs":[],"agentDefaults":{"main":{"defaultProfileId":"<inbox-id>","allowChatOverride":true}},"selectedToolkitSlugs":["gmail","linear"]}` → expect 200 with `repositorySettings` populated
12. `POST /api/sessions` — body: `{"repoOwner":"acme","repoName":"payments-api","title":"Triage Monday backlog"}` → expect 200/201 `{session:{id},chat:{id,composioSelection:{mainProfileId:"<inbox-id>"}}}` (default applied because policy allows it)
13. `POST /api/sessions/<sessionId>/chats/<chatId>/messages` — body: `{"message":{"role":"user","parts":[{"type":"text","text":"List the open Linear issues labelled 'billing' from the last week."}]}}` → expect 200 SSE stream containing Composio tool-call parts for the `linear` toolkit
14. `POST /api/sessions/<sessionId>/chats/<chatId>/messages` — body: `{"message":{"role":"user","parts":[{"type":"text","text":"Draft a reply to the customer email about invoice 4471 and show me the draft before sending."}]}}` → expect 200 SSE stream with a `gmail` tool call and a draft in the assistant output (human-in-the-loop: nothing is sent)
15. `GET /api/sessions/<sessionId>/chats/<chatId>` → expect 200 `{chat:{composioSelection:{mainProfileId:"<inbox-id>"}}}`
16. Policy tightens: `PATCH /api/settings/repositories/acme/payments-api/composio` — body: `{"inheritGlobalDefaults":true,"allowedProfileIds":["<triage-id>"],"blockedToolkitSlugs":["gmail"],"agentDefaults":{},"selectedToolkitSlugs":["linear"]}` → expect 200 (gmail now blocked, inbox profile no longer allowed)
17. `PATCH /api/sessions/<sessionId>/chats/<chatId>` — body: `{"composioSelection":{"mainProfileId":"<inbox-id>"}}` → expect **400** `{error:"<policy reason>"}`
18. `PATCH /api/sessions/<sessionId>/chats/<chatId>` — body: `{"composioSelection":{"mainProfileId":"<triage-id>"}}` → expect 200 `{chat:{composioSelection:{mainProfileId:"<triage-id>"}}}`
19. `POST /api/sessions/<sessionId>/chats/<chatId>/messages` — body: `{"message":{"role":"user","parts":[{"type":"text","text":"Now just close the duplicate Linear issues you found earlier."}]}}` → expect 200 SSE stream with `linear` tool calls only, no `gmail` tools offered
20. `GET /api/settings/composio?repoOwner=acme&repoName=payments-api` → expect 200 whose `repositorySettings` matches step 16 (duplicate read surface agrees)
21. `POST /api/sessions/<sessionId>/chats/<chatId>/fork` — body: `{"title":"Follow-up triage"}` → expect 200 `{chat:{composioSelection:{mainProfileId:"<triage-id>"}}}`
22. `DELETE /api/settings/composio` — body: `{"profileId":"<inbox-id>"}` → expect 200 `{success:true}`
23. `GET /api/settings/repositories/acme/payments-api/composio` → expect 200 with `<inbox-id>` gone from `profiles` and `profileOptions`

### Variations
- Skip step 16 and instead block only the toolkit (`blockedToolkitSlugs:["gmail"]`, `allowedProfileIds` unchanged): step 17 may still return 200 because the chat PATCH policy check is profile-based, not toolkit-based. Worth asserting explicitly.

### Edge Cases
- Step 11 with `blockedToolkitSlugs:["slak"]` → **400** naming the unrecognized slug.
- Step 22 repeated → **404** `{error:"Profile not found"}`.
- Step 17 with a profile id owned by another user → **400** policy rejection (not 403/404), because the allow-check runs before ownership surfaces.
- Session cookie dropped mid-walk → **401** on every subsequent call.

---

## STORY-composio-12: Repo policy with no Composio profiles at all

**Type**: short
**Persona**: Repo owner who wants to explicitly disable external tools for a sensitive repo
**Goal**: Save a policy that allows nothing, without having created any profile
**Preconditions**: Authenticated; zero profiles
**Ideal path**: 1 — a single PATCH should express "no external tools here".
**Alternate paths**: same state is also reachable by leaving `selectedToolkitSlugs:[]` while `allowedProfileIds:[]` — two encodings of "nothing allowed" on the same body.

### Steps
1. `PATCH /api/settings/repositories/acme/secrets-vault/composio` — body: `{"inheritGlobalDefaults":false,"allowedProfileIds":[],"blockedToolkitSlugs":[],"agentDefaults":{},"selectedToolkitSlugs":[]}` → expect 200 `{repositorySettings:{inheritGlobalDefaults:false,allowedProfileIds:[],selectedToolkitSlugs:[]},profileOptions:[],repoOwner:"acme",repoName:"secrets-vault"}`
2. `GET /api/settings/repositories/acme/secrets-vault/composio` → expect 200 with the same `repositorySettings`

### Edge Cases
- `selectedToolkitSlugs` omitted → defaults to `null` ("never configured", GitHub tools default-on) which is **not** the same as `[]`. Assert the distinction round-trips.
- `{"inheritGlobalDefaults":"false"}` (string) → **400** `{error:"Invalid repository Composio settings"}`.
- No cookie → **401**.
