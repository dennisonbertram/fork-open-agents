# UX Paths — Managed runtime profiles

Scope: the AI-draft → sandbox-test → approve → reuse loop for managed runtime
profiles, plus the account-scoped (`/api/settings/runtime-profiles`) twin of the
same resource.

**Auth for curl runs**: start the server with `OPEN_AGENTS_ENABLE_TEST_AUTH=1`,
call `GET /api/dev/managed-runtime-demo`, capture `Set-Cookie:
open_agents_test_user_id=dev-managed-runtime-user`, replay it on every call
below. Every route in this topic returns `401 {"error":"Not authenticated"}`
without it.

**Status codes observed in the route code** (`apps/web/app/api/sessions/[sessionId]/managed-runtime/**`):

- unauthenticated → `401`
- session id that does not exist → `404 {"error":"Session not found"}`
- session owned by another user → `403 {"error":"Forbidden"}`
- draft/profile id not found → `404 {"error":"Profile draft not found"}` / `{"error":"Profile not found"}`
- malformed JSON → `400 {"error":"Invalid JSON body"}`
- schema failure → `400 {"error":"Invalid managed runtime profile ..."}`
- **no sandbox attached on either `/test` route → `400 "Resume the sandbox before testing managed runtime profile(s)…"`** — note this is 400, not 409, because `requireOwnedSessionWithSandboxGuard` defaults `sandboxErrorStatus` to 400 and neither test route overrides it. The 409 path is only reached when `connectSandbox` throws a sandbox-unavailable error mid-run.
- sandbox exec blows up (non-unavailable) → `500` with a persisted `needs_changes` / failed draft in the body.

**Duplicate-data signals** (recorded, not resolved):

- Profile *listing* exists twice: `GET /api/sessions/[sessionId]/managed-runtime/profiles` (built-in + session-saved) and `GET /api/settings/runtime-profiles` (built-in + user-default). Both return the same built-in profiles with the same `toProfileOption` shape, differing only in the `source` value (`"session"` vs `"user_default"`).
- Profile *mutation* exists twice with near-identical Zod schemas: `PATCH|DELETE /api/sessions/[sessionId]/managed-runtime/profiles/[profileId]` and `PATCH|DELETE /api/settings/runtime-profiles/[profileId]`. `commandSchema` + `updateProfileSchema` are literally duplicated in both files.
- Test evidence (`testStatus`, `testedAt`, `lastTestScope`, `testResults`) is returned by four endpoints: the profiles list, the profile detail GET, the profile `/test` POST, and again inside `GET /api/sessions/[sessionId]/observability` (profile runs section).
- The default profile id is settable from three places: `POST /api/sessions` body, `PATCH /api/sessions/[sessionId]`, and `PATCH /api/settings/preferences` (`defaultManagedRuntimeProfileId`).

---

## STORY-managed-runtime-01: See what runtimes are available before starting work

**Type**: short
**Persona**: Developer opening a new managed-runtime session for a Bun web app
**Goal**: Find out which runtime profiles exist and which one the session is on
**Preconditions**: Test-auth cookie captured; the demo session `managed-runtime-demo-session` exists (created by the demo endpoint).
**Ideal path**: 2 — one call to seed/authenticate, one to list profiles. The list already carries every field the picker renders.
**Alternate paths**: `GET /api/settings/runtime-profiles` returns the same built-in profiles under `source: "user_default"`/`"built_in"`; `GET /api/sessions/[sessionId]` exposes the session's currently selected `managedRuntimeProfileId`.

### Steps
1. `GET /api/dev/managed-runtime-demo` → expect 200 demo payload + `Set-Cookie: open_agents_test_user_id`
2. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profiles` → expect 200 `{profiles:[{id:"web-bun-agent-browser",version,displayName:"Web app with Bun and browser checks",setupCommandCount:4,verificationCommandCount:2,source:"built_in",...}]}`

### Variations
- `GET /api/dev/managed-runtime-demo?profileId=web-bun-agent-browser` seeds the session already pinned to that profile.
- Compare against `GET /api/settings/runtime-profiles` and confirm the built-in entries match field-for-field.

### Edge Cases
- No cookie → `401 {"error":"Not authenticated"}`
- `GET /api/sessions/does-not-exist/managed-runtime/profiles` → `404 {"error":"Session not found"}`
- Session owned by another user → `403 {"error":"Forbidden"}`
- `GET /api/dev/managed-runtime-demo` with `OPEN_AGENTS_ENABLE_TEST_AUTH` unset → `404 {"error":"Not found"}`

---

## STORY-managed-runtime-02: Agent drafts a profile and the user reads it back

**Type**: short
**Persona**: Developer whose repo needs pnpm + Playwright instead of the built-in Bun profile
**Goal**: Persist the agent's `setup_managed_runtime_profile` tool call as a reviewable draft
**Preconditions**: STORY-01 (auth + session).
**Ideal path**: 2 — upsert the draft, read it back. The POST already returns the snapshot, so the GET is only for a separate reader.
**Alternate paths**: `GET .../profile-drafts?chatId=...` lists the same snapshot; none found for creating a draft other than this POST.

### Steps
1. `POST /api/sessions/managed-runtime-demo-session/managed-runtime/profile-drafts` — body:
   ```json
   {
     "chatId": "managed-runtime-demo-chat",
     "toolCallId": "call_9f2b1c7a4e",
     "input": {
       "goal": "The repo uses pnpm workspaces and Playwright; the built-in Bun profile fails at install.",
       "repoSignals": ["pnpm-lock.yaml", "playwright.config.ts", "package.json scripts.test:e2e"],
       "draft": {
         "displayName": "pnpm web app with Playwright",
         "description": "Installs pnpm deps and Playwright browsers, then verifies both toolchains.",
         "setupCommands": [
           {"id":"install-pnpm","label":"Install pnpm","description":"Enable corepack pnpm","command":"corepack enable && corepack prepare pnpm@9.12.0 --activate","timeoutMs":120000},
           {"id":"install-deps","label":"Install dependencies","description":"Install workspace dependencies","command":"pnpm install --frozen-lockfile","timeoutMs":300000},
           {"id":"install-browsers","label":"Install Playwright browsers","description":"Chromium only","command":"pnpm exec playwright install --with-deps chromium","timeoutMs":300000,"required":false}
         ],
         "verificationCommands": [
           {"id":"verify-pnpm","label":"Verify pnpm","description":"pnpm on PATH","command":"pnpm --version"},
           {"id":"verify-playwright","label":"Verify Playwright","description":"CLI responds","command":"pnpm exec playwright --version","required":false}
         ],
         "expectedTools": ["pnpm", "node"],
         "optionalTools": ["playwright"],
         "defaultPorts": [3000]
       },
       "questionsForUser": ["Should Playwright browsers install on every sandbox boot, or only on demand?"]
     }
   }
   ```
   → expect 200 `{draft:{id,status:"pending",profileDraft:{...},testResults:[],testedAt:null}}`
2. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profile-drafts/{draftId}` → expect 200 `{draft}` identical to step 1

### Variations
- Omit `chatId` — the route falls back to `requireOwnedSession` instead of `requireOwnedSessionChat` and still succeeds.
- Re-POST the same `toolCallId` with an edited `draft` → upsert, same draft id, updated body.

### Edge Cases
- Body missing `toolCallId` → `400 {"error":"Invalid managed runtime profile draft"}`
- `setupCommands: []` (schema requires min 1) → `400 {"error":"Invalid managed runtime profile draft"}`
- Non-JSON body → `400 {"error":"Invalid JSON body"}`
- `chatId` belonging to someone else's chat → `403 {"error":"Forbidden"}` (or `404` if the chat is absent)
- `GET .../profile-drafts/draft_missing` → `404 {"error":"Profile draft not found"}`

---

## STORY-managed-runtime-03: Test the draft in the live sandbox before approving

**Type**: medium
**Persona**: Cautious developer who won't approve a runtime she hasn't seen run
**Goal**: Execute the draft's verification (then setup+verification) commands in the session sandbox and read the evidence
**Preconditions**: STORY-02 draft exists; the session has a live `sandboxState` (the demo endpoint provisions one).
**Ideal path**: 3 — verify-only test, full setup+verify test, list to confirm the badge. Two test calls are inherent: `verify` and `setup_and_verify` are genuinely different scopes.
**Alternate paths**: none found — a draft can only be executed through this route. (Once approved, `POST .../profiles/[profileId]/test` runs the same command loop against the saved copy — duplicated logic, two routes.)

### Steps
1. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profile-drafts/{draftId}` → expect 200 `{draft:{status:"pending"}}`
2. `POST /api/sessions/managed-runtime-demo-session/managed-runtime/profile-drafts/{draftId}/test` — body: `{"mode":"verify"}` → expect 200 `{draft:{status:"tested"|"needs_changes",testResults:[{commandId:"verify-pnpm",status,exitCode,stdout,stderr}],testScope:"verify",testedAt}}`
3. `POST .../profile-drafts/{draftId}/test` — body: `{"mode":"setup_and_verify"}` → expect 200 with observations for setup commands first, then verification commands
4. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profile-drafts?chatId=managed-runtime-demo-chat&limit=5` → expect 200 `{drafts:[{lastTestScope:"setup_and_verify"}]}`
5. `GET /api/sessions/managed-runtime-demo-session/observability?chatId=managed-runtime-demo-chat` → expect 200 aggregate containing the same profile-run evidence (duplicate surface)

### Variations
- Empty body with no `content-type: application/json` → mode defaults to `"verify"`.
- A draft whose first *required* command fails: the loop breaks immediately, so `testResults.length` is less than the command count and the response carries `errorKind:"verification_failed"` (or `"setup_command_failed"`) plus `nextAction`.
- A failing command marked `"required": false` does not stop the run and does not set `failureMessage`.

### Edge Cases
- Session with no sandbox attached → `400 {"error":"Resume the sandbox before testing managed runtime profile drafts."}`
- Sandbox goes away mid-run (`connectSandbox` throws an unavailable error) → `409 {"error":"Sandbox is unavailable. Please resume sandbox."}` and the session is marked hibernated
- Other exec failure → `500 {"error":"Failed to test managed runtime profile draft", draft:{status:"needs_changes",errorKind:"setup_exec_error",nextAction}}`
- `{"mode":"validate"}` → `400 {"error":"Invalid managed runtime profile test mode"}`
- Unknown draft id → `404 {"error":"Profile draft not found"}`

---

## STORY-managed-runtime-04: Multi-turn draft → revise → re-test → approve

**Type**: long
**Persona**: Developer pair-working with the agent over several chat turns
**Goal**: Land a working profile through a full revise/approve conversation, ending with the profile applied to the session
**Preconditions**: STORY-01 (auth + session + sandbox).
**Ideal path**: 8 — draft, test, revise, re-draft, re-test, approve, confirm on session, confirm in list. The revise round-trip is the genuine cost; everything else is one call per state change.
**Alternate paths**: approval also happens implicitly through the chat stream's tool-output persistence; the account-scoped equivalent of the final saved profile is `POST /api/settings/runtime-profiles` (creates the same row shape as a `user_default`).

### Steps
1. `POST /api/sessions/managed-runtime-demo-session/managed-runtime/profile-drafts` — body: `{"chatId":"managed-runtime-demo-chat","toolCallId":"call_turn1_a1","input":{...draft with "pnpm install --frozen-lockfile"...}}` → expect 200 `{draft:{id,status:"pending"}}`
2. `POST .../profile-drafts/{draftId}/test` — body: `{"mode":"setup_and_verify"}` → expect 200 with `status:"needs_changes"` (lockfile mismatch), `errorKind:"setup_command_failed"`
3. `PATCH .../profile-drafts/{draftId}` — body: `{"output":{"decision":"revise","instructions":"Drop --frozen-lockfile and add a node version check before install."}}` → expect 200 `{draft:{status:"revise"|"needs_changes"}}` with **no** `savedProfileId`
4. `POST .../profile-drafts` — body: same `toolCallId` `call_turn1_a1`, revised `input.draft` (`"pnpm install"`, extra `verify-node` command) → expect 200 upserted draft, same id
5. `POST .../profile-drafts/{draftId}/test` — body: `{"mode":"setup_and_verify"}` → expect 200 `{draft:{status:"tested",testFailureMessage:null,testScope:"setup_and_verify"}}`
6. `GET .../profile-drafts/{draftId}` → expect 200 evidence readable by a second reviewer
7. `PATCH .../profile-drafts/{draftId}` — body: `{"output":{"decision":"approved","notes":"Verified on the current sandbox; setup ran clean."}}` → expect 200 `{draft:{status:"approved"},savedProfileId,appliedToSessionId:"managed-runtime-demo-session"}`
8. `GET .../managed-runtime/profiles` → expect 200 with the new profile first, `source:"session"`, `testStatus:"passed"`, `lastTestScope:"setup_and_verify"`
9. `GET .../managed-runtime/profiles/{savedProfileId}` → expect 200 `{profile,testEvidence|sourceDraft}` — evidence is inherited from the source draft when the saved copy has none
10. `GET /api/sessions/managed-runtime-demo-session` → expect 200 session with `managedRuntimeProfileId` = `savedProfileId`

### Variations
- Decision `"discarded"` at step 7: `{"output":{"decision":"discarded","reason":"Switching this repo back to Bun."}}` → 200, no `savedProfileId`, nothing applied to the session.
- Approve *without* a passing test using `{"output":{"decision":"approved"},"forceApproved":true}` → 200; the draft records the override so the UI can label it "Approved without passing test".

### Edge Cases
- `{"output":{"decision":"revise"}}` with no `instructions` → `400 {"error":"Invalid managed runtime profile draft update"}` (discriminated union requires it)
- `{"output":{"decision":"maybe"}}` → `400 {"error":"Invalid managed runtime profile draft update"}`
- PATCH on an unknown draft id → `404 {"error":"Profile draft not found"}`
- PATCH while unauthenticated → `401`

---

## STORY-managed-runtime-05: Edit a saved session profile and re-earn its badge

**Type**: medium
**Persona**: Developer bumping the pinned pnpm version after an upstream release
**Goal**: Update the saved profile's commands and get a fresh passing test
**Preconditions**: STORY-04 produced `savedProfileId`.
**Ideal path**: 3 — read, patch, re-test. The re-test is required because editing clears the badge (`isEditedProfile` → `testStatus:"untested"`).
**Alternate paths**: `PATCH /api/settings/runtime-profiles/[profileId]` performs the identical update against the account-scoped copy with a duplicated schema.

### Steps
1. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profiles/{savedProfileId}` → expect 200 `{profile,testEvidence:{status:"passed"}}`
2. `PATCH .../managed-runtime/profiles/{savedProfileId}` — body:
   ```json
   {
     "displayName": "pnpm web app with Playwright",
     "description": "Installs pnpm 9.15 deps and Playwright chromium, then verifies both toolchains.",
     "setupCommands": [
       {"id":"install-pnpm","label":"Install pnpm","description":"Enable corepack pnpm 9.15","command":"corepack enable && corepack prepare pnpm@9.15.0 --activate","timeoutMs":120000},
       {"id":"install-deps","label":"Install dependencies","description":"Install workspace dependencies","command":"pnpm install","timeoutMs":300000}
     ],
     "verificationCommands": [
       {"id":"verify-pnpm","label":"Verify pnpm","description":"pnpm on PATH","command":"pnpm --version"}
     ],
     "expectedTools": ["pnpm","node"],
     "optionalTools": ["playwright"],
     "defaultPorts": [3000]
   }
   ```
   → expect 200 detail with the new commands
3. `GET .../managed-runtime/profiles` → expect 200 with this profile now `testStatus:"untested"`, `testedAt:null`, `lastTestScope:null`
4. `POST .../managed-runtime/profiles/{savedProfileId}/test` — body: `{"mode":"setup_and_verify"}` → expect 200 `{profile,testEvidence:{status:"passed",testScope:"setup_and_verify",testResults:[...]}}`
5. `GET .../managed-runtime/profiles` → expect 200 with `testStatus:"passed"` restored

### Variations
- Patch only the description (all fields still required by the schema — it is a full replace, not a partial patch).
- Run step 4 with `{"mode":"verify"}` → `testScope:"verify"`, which the UI renders as "Verified on current sandbox — setup not tested" rather than a full green badge.

### Edge Cases
- `verificationCommands: []` → `400 {"error":"Invalid managed runtime profile"}`
- `defaultPorts: [0]` (must be positive int) → `400 {"error":"Invalid managed runtime profile"}`
- `timeoutMs: -1` → `400 {"error":"Invalid managed runtime profile"}`
- PATCH a built-in id (`web-bun-agent-browser`, not a saved row) → `404 {"error":"Profile not found"}`
- Malformed JSON → `400 {"error":"Invalid JSON body"}`

---

## STORY-managed-runtime-06: Test a profile with no sandbox, then after resuming

**Type**: short
**Persona**: Developer returning to a session that hibernated overnight
**Goal**: Understand why the test button fails and recover
**Preconditions**: A session whose `sandboxState` is empty/cleared, plus a saved profile.
**Ideal path**: 3 — attempt, attach sandbox, retry. The failed attempt is the discovery step a well-designed UI would pre-empt, but the API needs it.
**Alternate paths**: `POST /api/sessions/[sessionId]/sandbox` (attach on-demand sandbox) is the only recovery route for no-repo sessions; repo sessions resume via the session lifecycle routes.

### Steps
1. `POST /api/sessions/{hibernatedSessionId}/managed-runtime/profiles/{savedProfileId}/test` — body: `{"mode":"verify"}` → expect `400 {"error":"Resume the sandbox before testing managed runtime profiles."}`
2. `POST /api/sessions/{hibernatedSessionId}/sandbox` → expect 200 `{session}` with a fresh `sandboxState`
3. `POST /api/sessions/{hibernatedSessionId}/managed-runtime/profiles/{savedProfileId}/test` — body: `{"mode":"setup_and_verify"}` → expect 200 `{profile,testEvidence}`

### Variations
- Same three steps against a *draft*: `POST .../profile-drafts/{draftId}/test` returns the draft-specific message "Resume the sandbox before testing managed runtime profile drafts."
- `DELETE /api/sessions/{sessionId}/sandbox` clears a failed provisional attach before retrying step 2.

### Edge Cases
- Sandbox dies between step 2 and step 3 → `409 {"error":"Sandbox is unavailable. Please resume sandbox."}`
- Unauthenticated → `401` (auth is checked before the sandbox guard)
- Unknown session → `404 {"error":"Session not found"}`

---

## STORY-managed-runtime-07: Delete a session profile and fall back to the built-in

**Type**: short
**Persona**: Developer abandoning a custom runtime after the repo moved back to Bun
**Goal**: Remove the saved profile and confirm affected sessions fall back safely
**Preconditions**: STORY-04 produced `savedProfileId` and pinned it to the session.
**Ideal path**: 2 — delete, confirm. The delete response already names the fallback and the reset count.
**Alternate paths**: `DELETE /api/settings/runtime-profiles/[profileId]` does the same for account-scoped profiles and returns `{deletedProfileId,preferenceReset}` instead of `{deletedProfileId,fallbackProfileId,sessionsReset}` — same operation, two response shapes.

### Steps
1. `DELETE /api/sessions/managed-runtime-demo-session/managed-runtime/profiles/{savedProfileId}` → expect 200 `{deletedProfileId,fallbackProfileId:"web-bun-agent-browser",sessionsReset:1}`
2. `GET /api/sessions/managed-runtime-demo-session` → expect 200 with `managedRuntimeProfileId:"web-bun-agent-browser"`
3. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profiles` → expect 200 with only `source:"built_in"` entries

### Variations
- Delete a profile no session references → `sessionsReset: 0`.

### Edge Cases
- Delete the same id twice → second call `404 {"error":"Profile not found"}`
- Delete a built-in id → `404 {"error":"Profile not found"}`
- Delete while unauthenticated → `401`
- Delete on someone else's session → `403 {"error":"Forbidden"}`

---

## STORY-managed-runtime-08: Promote a runtime to an account-wide default

**Type**: medium
**Persona**: Developer who wants every new session on her pnpm runtime
**Goal**: Create a user-default profile and make it the account default for new sessions
**Preconditions**: Test-auth cookie.
**Ideal path**: 3 — create, set preference, create a session to prove it. Listing is optional confirmation.
**Alternate paths**: the same effective result is reachable per-session via `POST /api/sessions` with `managedRuntimeProfileId`, or per-repo via repo defaults on `PATCH /api/settings/repositories/[repoOwner]/[repoName]`. Three write surfaces set the same field.

### Steps
1. `POST /api/settings/runtime-profiles` — body:
   ```json
   {
     "displayName": "pnpm monorepo default",
     "description": "Corepack pnpm plus a typecheck verification for all my repos.",
     "setupCommands": [
       {"id":"enable-corepack","label":"Enable corepack","description":"Activate pnpm 9.15","command":"corepack enable && corepack prepare pnpm@9.15.0 --activate","timeoutMs":120000},
       {"id":"install","label":"Install dependencies","description":"Workspace install","command":"pnpm install","timeoutMs":300000}
     ],
     "verificationCommands": [
       {"id":"verify-pnpm","label":"Verify pnpm","description":"pnpm on PATH","command":"pnpm --version"},
       {"id":"verify-typecheck","label":"Typecheck","description":"Repo typechecks","command":"pnpm run typecheck","required":false,"timeoutMs":300000}
     ],
     "expectedTools": ["pnpm","node"],
     "optionalTools": ["turbo"],
     "defaultPorts": [3000,5173]
   }
   ```
   → expect `201 {profile:{id,source:"user_default",testStatus:"untested",testedAt:null}}`
2. `GET /api/settings/runtime-profiles` → expect 200 `{profiles:[{source:"user_default"},...builtIns]}`
3. `PATCH /api/settings/preferences` — body: `{"defaultManagedRuntimeProfileId":"{profileId}"}` → expect 200 updated preferences
4. `POST /api/sessions` — body: `{"title":"pnpm monorepo work","runtimeMode":"managed_runtime"}` → expect 200/201 session whose `managedRuntimeProfileId` resolves to the user-default profile
5. `GET /api/sessions/{newSessionId}/managed-runtime/profiles` → expect 200; note the account-scoped profile does **not** appear here (this list only merges built-ins with *session*-scoped saved profiles) — a real inconsistency between the two listing endpoints

### Variations
- `PATCH /api/settings/preferences` with a built-in id (`"web-bun-agent-browser"`) → 200, since `isKnownManagedRuntimeProfileReference` accepts built-ins.
- `PATCH /api/settings/runtime-profiles/{profileId}` to rename the default afterwards → 200.

### Edge Cases
- `POST /api/settings/runtime-profiles` with `setupCommands: []` → `400 {"error":"Invalid managed runtime profile"}`
- `PATCH /api/settings/preferences` with `{"defaultManagedRuntimeProfileId":"nope-not-real"}` → `400 {"error":"Invalid managed runtime profile"}`
- `PATCH /api/settings/runtime-profiles/unknown-id` → `404 {"error":"Profile not found"}` (checked *before* body parsing, so a malformed body on an unknown id still returns 404)
- Unauthenticated on any of the above → `401`

---

## STORY-managed-runtime-09: Switch a running session between classic and managed runtime

**Type**: short
**Persona**: Developer who started in classic mode and now needs managed dev-server previews
**Goal**: Flip the session to managed runtime with a specific profile
**Preconditions**: STORY-01; a saved or built-in profile id.
**Ideal path**: 2 — patch the session, start the managed dev server.
**Alternate paths**: `POST /api/sessions` accepts `runtimeMode` + `managedRuntimeProfileId` at creation; repo defaults and user preferences both feed the same field.

### Steps
1. `PATCH /api/sessions/managed-runtime-demo-session` — body: `{"runtimeMode":"managed_runtime","managedRuntimeProfileId":"web-bun-agent-browser"}` → expect 200 updated session
2. `POST /api/sessions/managed-runtime-demo-session/sandbox-services` → expect 200 `{service:{id,status,url}}`
3. `GET /api/sessions/managed-runtime-demo-session/sandbox-services` → expect 200 `{services:[...]}`
4. `GET /api/sessions/managed-runtime-demo-session/sandbox-services/{serviceId}/logs?lines=100` → expect 200 `text/plain`
5. `DELETE /api/sessions/managed-runtime-demo-session/sandbox-services/{serviceId}` → expect 200 `{service:{status:"stopped"}}`

### Variations
- `PATCH` with `{"runtimeMode":"classic"}` flips back; the profile id stays recorded.

### Edge Cases
- `{"runtimeMode":"turbo"}` → `400 {"error":"Invalid runtime mode"}`
- `{"managedRuntimeProfileId":"profile-that-does-not-exist"}` → `400 {"error":"Invalid managed runtime profile"}`
- `POST .../sandbox-services` on a classic-mode session or with no sandbox → `500` / guard error from the service route
- `DELETE .../sandbox-services/unknown-service` → `404`

---

## STORY-managed-runtime-10: Reviewer audits a profile's evidence across every surface

**Type**: medium
**Persona**: Teammate reviewing whether a runtime profile is actually trustworthy
**Goal**: Cross-check the same test evidence wherever the API exposes it, and spot disagreement
**Preconditions**: STORY-04 (approved profile with draft-inherited evidence) and STORY-05 (edited + re-tested).
**Ideal path**: 1 — the profile detail endpoint alone should be sufficient. It takes 4 today because evidence is duplicated across list, detail, test, and observability.
**Alternate paths**: all four listed below return overlapping evidence; that is the redundancy being audited.

### Steps
1. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profiles/{savedProfileId}` → expect 200 `{profile,testEvidence:{status,testFailureMessage,testResults,testedAt}}` — or `{profile,sourceDraft:{...}}` when the saved copy has no evidence of its own and its version still starts with `draft-`
2. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profiles` → expect 200; the matching entry carries `testStatus`/`testedAt`/`lastTestScope` but **not** `testResults`
3. `GET /api/sessions/managed-runtime-demo-session/managed-runtime/profile-drafts/{draftId}` → expect 200 with the originating draft's `testResults`, which the profile list may be silently inheriting
4. `GET /api/sessions/managed-runtime-demo-session/observability?chatId=managed-runtime-demo-chat&limit=50` → expect 200 aggregate whose profile-runs section repeats the same command observations
5. `POST /api/sessions/managed-runtime-demo-session/managed-runtime/profiles/{savedProfileId}/test` — body: `{"mode":"verify"}` → expect 200 `{testEvidence}` — a fifth rendering of the same data, now authoritative

### Variations
- After an edit (STORY-05 step 2) but before a re-test, step 1 shows no `testEvidence` while step 3 still shows a passing draft — confirm the list reports `untested` (the `isEditedProfile` branch) and not the stale draft pass.

### Edge Cases
- `GET .../profiles/{id}` for a built-in id → `404 {"error":"Profile not found"}` (built-ins have no saved row)
- `GET .../profile-drafts/{deletedDraftId}` after the source draft is gone → `404 {"error":"Profile draft not found"}` while the profile detail still renders inherited evidence
- Unauthenticated on any step → `401`
- Another user's session id → `403 {"error":"Forbidden"}`
