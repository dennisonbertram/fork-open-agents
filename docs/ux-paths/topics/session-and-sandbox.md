# UX Paths — Session lifecycle & sandbox provisioning

Routes covered here are the session CRUD surface (`/api/sessions*`), the sandbox
lifecycle surface (`/api/sandbox*`), and the on-demand attach route
(`/api/sessions/[sessionId]/sandbox`), plus the session-scoped surfaces that
depend on a live sandbox (`files`, `diff`, `git/status`, `dev-server`,
`code-editor`, `sandbox-services`, `observability`, `skills`).

**Curl setup for every story below** (from `docs/ux-paths/discovery.md`):
start the server with `OPEN_AGENTS_ENABLE_TEST_AUTH=1`, then

```
curl -c cookies.txt "$BASE/api/dev/managed-runtime-demo"     # sets open_agents_test_user_id
curl -b cookies.txt  "$BASE/api/auth/info"                   # sanity check
```

and replay `-b cookies.txt` on every subsequent call. `$BASE` is
`http://localhost:3000` unless `PORT` is overridden.

**Redundancy / duplicate-data notes (global to this topic)**

- Sandbox liveness is reported by **three** routes with overlapping payloads:
  `GET /api/sandbox/status` (`status: active|no_sandbox` + `lifecycle`),
  `GET /api/sandbox/reconnect` (`status: connected|expired|not_found|no_sandbox`
  + the same `lifecycle` block), and `GET /api/sessions/[sessionId]` (raw
  `sandboxState`, `lifecycleState`, `sandboxExpiresAt`). `status` and
  `reconnect` return a byte-identical `lifecycle` sub-object.
- **Pausing a sandbox has two routes**: `DELETE /api/sandbox` and
  `POST /api/sandbox/snapshot`. Both `connectSandbox(...).stop()` and clear
  `sandboxState`; the only differences are that `DELETE` returns
  `{success:true}` / `{success:true,alreadyStopped:true}` and does not bump
  `lifecycleVersion`, while `POST /snapshot` returns `{snapshotId,createdAt}`,
  bumps `lifecycleVersion`, and is rate-limit-free.
- **Creating/resuming a sandbox has two routes**: `POST /api/sandbox`
  (create-or-resume by name, does the repo clone) and
  `PUT /api/sandbox/snapshot` (resume-only). For a hibernated named sandbox
  both reach "running".
- **Attaching a sandbox to a no-repo session has two routes**:
  `POST /api/sessions/[sessionId]/sandbox` (DB-only flag flip to
  `provisioning`) and `POST /api/sandbox` with that `sessionId` (actually
  creates the VM). The former is a UI intent marker only.
- `sessionId` is passed in the **body** for `/api/sandbox`, `/api/sandbox/extend`,
  `/api/sandbox/activity`, `/api/sandbox/snapshot`, but in the **query string**
  for `/api/sandbox/status` and `/api/sandbox/reconnect` — inconsistent.
- Ownership failures return **403 `{"error":"Forbidden"}`** across this topic
  (`requireOwnedSession` and the inline checks in `sessions/[sessionId]` and
  `sessions/[sessionId]/sandbox`), not 404. Missing session is **404
  `{"error":"Session not found"}`**.

---

## STORY-session-and-sandbox-01: Start a scratch chat session with no repo

**Type**: short
**Persona**: A developer opening the app to ask a quick question, no repo attached.
**Goal**: Get a session + initial chat id to talk to, without paying sandbox provisioning cost.
**Preconditions**: Authenticated cookie only (test-auth cookie from setup).
**Ideal path**: 1 call — `POST /api/sessions` already returns both the session and its initial chat, so no follow-up read is required.
**Alternate paths**: none found for creation. Reading the result back is duplicated by `GET /api/sessions` (list) and `GET /api/sessions/{id}` (single).

### Steps
1. `POST /api/sessions` — body: `{"title":"Explain our auth flow"}` → expect `200` `{session:{id,title,status:"running",sandboxState:null,lifecycleState:null,lifecycleVersion:0,...},chat:{id,title:"New chat",modelId}}`
2. `GET /api/sessions/{sessionId}` → expect `200` `{session:{...,sandboxState:null}}`
3. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"no_sandbox","hasSnapshot":false,"lifecycleVersion":0,"lifecycle":{"state":null,...}}`

### Variations
- Omit `title` → server picks a random unused city name (`getRandomCityName`); assert `session.title` is non-empty.
- `{"title":"...","runtimeMode":"managed_runtime"}` → `session.runtimeMode === "managed_runtime"` with no sandbox yet.

### Edge Cases
- Auth failure: same POST with no cookie → `401 {"error":"Not authenticated"}`.
- Validation failure: body `{"sandboxType":"fly"}` → `400 {"error":"Invalid sandbox type"}`.
- Validation failure: body `{"runtimeMode":"turbo"}` → `400 {"error":"Invalid runtime mode"}`.
- Validation failure: body `{"managedRuntimeProfileId":{"a":1}}` → `400 {"error":"Invalid managed runtime profile","errorKind":"profile_not_found"}`.
- Validation failure: malformed JSON body → `400 {"error":"Invalid JSON body"}`.
- Rate limit: 11 creates inside 60s → the 11th returns the rate-limit response (limit 10/60s, key `sessions-create:{userId}`).

---

## STORY-session-and-sandbox-02: Create a repo-backed session and provision its sandbox

**Type**: medium
**Persona**: Developer starting work on `acme-labs/checkout-service`.
**Goal**: A running sandbox with the repo cloned on a working branch.
**Preconditions**: GitHub App installed for `acme-labs` and the repo accessible (`verifyRepoAccess` must pass, else the sandbox call 403s).
**Ideal path**: 2 calls — `POST /api/sessions` (repo-backed, sets `lifecycleState:"provisioning"`) then `POST /api/sandbox` to materialize the VM. The split exists because session creation only kicks a prewarm workflow; the VM is created by the client.
**Alternate paths**: after the session exists, `PUT /api/sandbox/snapshot` also reaches a running sandbox — but only once a resumable `sandboxName` exists, so it is not usable for the very first provision (returns `404 sandbox_resume_state_missing`).

### Steps
1. `POST /api/sessions` — body: `{"title":"Fix stale cart totals","repoOwner":"acme-labs","repoName":"checkout-service","cloneUrl":"https://github.com/acme-labs/checkout-service","branch":"main","isNewBranch":true}` → expect `200` `{session:{id,repoOwner,repoName,branch:"db/3f9a1c72",sandboxState:{"type":"vercel"},lifecycleState:"provisioning"},chat:{id}}`
2. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"no_sandbox","lifecycle":{"state":"provisioning"}}` (DB says provisioning, no runtime state yet)
3. `POST /api/sandbox` — body: `{"sessionId":"{sessionId}","repoUrl":"https://github.com/acme-labs/checkout-service","branch":"db/3f9a1c72","isNewBranch":true}` → expect `200` `{createdAt,timeout,currentBranch:"db/3f9a1c72","mode":"vercel","timing":{"readyMs":<n>}}`
4. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"active","hasSnapshot":false,"lifecycleVersion":1,"lifecycle":{"state":"active","sandboxExpiresAt":<future ms>}}`
5. `GET /api/sessions/{sessionId}/git/status` → expect `200` `{status:{branch:"db/3f9a1c72",...}}`
6. `GET /api/sessions/{sessionId}/files` → expect `200` `{files:[...]}` (tracked + untracked)
7. `GET /api/sessions/{sessionId}/observability?limit=50` → expect `200` aggregate containing session events for the sandbox attach/create.

### Variations
- `"isNewBranch":false` with `"branch":"main"` → step 3 returns `currentBranch:"main"`.
- `"fullClone":true` → same responses, longer `timing.readyMs`.
- Repeat step 3 verbatim while the sandbox is active → returns immediately with `timing.readyMs: 0` and `mode` echoing the stored `sandboxState.type` (idempotent short-circuit via `isSandboxActive`).

### Edge Cases
- Auth failure: step 3 with no cookie → `401 {"error":"Not authenticated"}`.
- Not found: step 3 with `"sessionId":"sess_does_not_exist"` → `404 {"error":"Session not found"}`.
- Ownership: step 3 with another user's sessionId → `403 {"error":"Forbidden"}`.
- Validation failure: step 3 body without `sessionId` → `400 {"error":"Missing sessionId"}`.
- Validation failure: step 3 with `"repoUrl":"git@github.com:acme-labs/checkout-service.git"` → `400 {"error":"Invalid GitHub repository URL"}` (only HTTPS GitHub URLs parse).
- Authorization failure: step 3 with a repo the installation cannot read → `403 {"error":"<repo access message>"}`.
- Validation failure at step 1: `{"repoOwner":"acme-labs","repoName":"checkout-service","cloneUrl":"https://github.com/other/repo"}` → `400 {"error":"Clone URL must match repository owner and name"}`.
- Validation failure at step 1: `{"repoOwner":"acme labs"}` → `400 {"error":"Invalid repository owner"}`.
- Rate limit: 21 `POST /api/sandbox` in 60s → rate-limited (limit 20/60s).

---

## STORY-session-and-sandbox-03: Pause a sandbox and resume it later

**Type**: medium
**Persona**: Developer stepping away for lunch mid-task.
**Goal**: Stop paying for a running VM, then come back to the same workspace.
**Preconditions**: An active repo-backed sandbox from STORY-02.
**Ideal path**: 2 calls — one pause, one resume. Everything else in this story is verification the UI happens to poll.
**Alternate paths**: `DELETE /api/sandbox` with `{"sessionId":...}` performs the same stop-and-clear as `POST /api/sandbox/snapshot`; `POST /api/sandbox` also brings a hibernated named sandbox back up instead of `PUT /api/sandbox/snapshot`.

### Steps
1. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"active","lifecycle":{"state":"active"}}`
2. `POST /api/sandbox/snapshot` — body: `{"sessionId":"{sessionId}"}` → expect `200` `{"snapshotId":"session-{sessionId}","createdAt":<ms>,"requestId":"..."}` with header `X-Request-ID`
3. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"no_sandbox","hasSnapshot":true,"lifecycle":{"state":"hibernated"}}` and `lifecycleVersion` incremented by 1 vs step 1
4. `GET /api/sandbox/reconnect?sessionId={sessionId}` → expect `200` `{"status":"no_sandbox","hasSnapshot":true,...}`
5. `PUT /api/sandbox/snapshot` — body: `{"sessionId":"{sessionId}"}` → expect `200` `{"success":true,"restoredFrom":"session-{sessionId}","sandboxName":"session-{sessionId}","sandboxId":"..."}`
6. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"active","lifecycle":{"state":"active"}}`
7. `GET /api/sessions/{sessionId}/git/status` → expect `200`, branch unchanged from before the pause (proves workspace persistence)

### Variations
- Replace step 2 with `DELETE /api/sandbox` body `{"sessionId":"{sessionId}"}` → `200 {"success":true}`; note `lifecycleVersion` is **not** bumped on this path.
- Replace step 5 with `POST /api/sandbox` body `{"sessionId":"{sessionId}"}` (no repoUrl) → `200 {createdAt,timeout,mode:"vercel",timing}`; resumes the named sandbox.
- Call `PUT /api/sandbox/snapshot` twice → second returns `200 {"success":true,"alreadyRunning":true,...}`.

### Edge Cases
- Auth failure: step 2 without cookie → `401 {"error":"Not authenticated"}`.
- Conflict/state: `POST /api/sandbox/snapshot` on a session that never had a sandbox → `409 {"error":"Sandbox not initialized","errorKind":"sandbox_not_initialized"}` (sandbox guard `canOperateOnSandbox`).
- Not found: `PUT /api/sandbox/snapshot` on a no-repo session with no `sandboxName` and no `snapshotUrl` → `404 {"error":"No sandbox available for resume","errorKind":"sandbox_resume_state_missing","retryable":false}`.
- Not found (upstream deleted VM): `PUT /api/sandbox/snapshot` when the named sandbox no longer exists upstream → `404 {"error":"Saved sandbox is no longer available. Create a new sandbox.","errorKind":"sandbox_resume_unavailable","retryable":false}` and the session flips to `hibernated` with resume state cleared.
- Provider failure: transient upstream error on resume → `500 {"error":"Sandbox resume failed. Try again.","errorKind":"sandbox_resume_failed","retryable":true}`.
- Provider failure on pause → `500 {"error":"Sandbox pause failed. Try again.","errorKind":"sandbox_pause_failed","retryable":true}`.
- Validation failure: `PUT /api/sandbox/snapshot` body `{}` → `400 {"error":"Missing sessionId"}`.
- Idempotency: `DELETE /api/sandbox` on an already-stopped session → `200 {"success":true,"alreadyStopped":true}`.

---

## STORY-session-and-sandbox-04: Keep a long-running session alive (heartbeat + extend)

**Type**: short
**Persona**: Developer watching a slow test suite run inside the sandbox.
**Goal**: Prevent inactivity hibernation and push out the hard expiry.
**Preconditions**: Active sandbox (STORY-02).
**Ideal path**: 2 calls — one heartbeat to reset the inactivity clock, one extend to move `expiresAt`. They are genuinely different clocks (`hibernateAfter` vs `sandboxExpiresAt`), so neither subsumes the other.
**Alternate paths**: none found — `activity` and `extend` are the only writers of these two fields from the API surface (the lifecycle workflow also writes them internally).

### Steps
1. `GET /api/sandbox/status?sessionId={sessionId}` → record `lifecycle.hibernateAfter` and `lifecycle.sandboxExpiresAt`
2. `POST /api/sandbox/activity` — body: `{"sessionId":"{sessionId}"}` → expect `200 {"success":true}`
3. `GET /api/sandbox/status?sessionId={sessionId}` → `lifecycle.hibernateAfter` is later than in step 1; `sandboxExpiresAt` unchanged
4. `POST /api/sandbox/extend` — body: `{"sessionId":"{sessionId}"}` → expect `200 {"success":true,"expiresAt":<ms>,"extendedBy":<EXTEND_TIMEOUT_DURATION_MS>}`
5. `GET /api/sandbox/status?sessionId={sessionId}` → `lifecycle.sandboxExpiresAt` later than step 1; `lifecycleVersion` incremented

### Variations
- Heartbeat a hibernated session → `200 {"success":false,"reason":"not-active"}` (note: **200, not 409** — a soft failure the client must inspect the body for).

### Edge Cases
- Auth failure: either POST without cookie → `401 {"error":"Not authenticated"}`.
- Not found: `{"sessionId":"sess_missing"}` → `404 {"error":"Session not found"}`.
- Ownership: another user's session → `403 {"error":"Forbidden"}`.
- Validation failure: `POST /api/sandbox/extend` body `{}` → `400 {"error":"Missing sessionId"}`; malformed JSON → `400 {"error":"Invalid JSON body"}`.
- State failure: `POST /api/sandbox/extend` when the sandbox is not active → `409 {"error":"Sandbox not initialized","errorKind":"sandbox_not_initialized"}` (guard `isSandboxActive`).
- Provider failure: extend throws upstream → `500 {"error":"Failed to extend sandbox timeout"}`.
- Rate limit: 4 extends in 60s → the 4th is rate-limited (limit **3**/60s — much tighter than the other sandbox routes).

---

## STORY-session-and-sandbox-05: Attach a sandbox on demand to an existing no-repo chat

**Type**: medium
**Persona**: Developer who started a scratch chat (STORY-01) and now wants to actually run commands.
**Goal**: Turn a sandbox-free session into one with a live VM.
**Preconditions**: A no-repo session from STORY-01 (`sandboxState: null`).
**Ideal path**: 1 call — `POST /api/sandbox` alone creates the VM and writes `sandboxState`; the separate `POST /api/sessions/{id}/sandbox` intent-marker call is a UI artifact, not a requirement.
**Alternate paths**: `POST /api/sessions/[sessionId]/sandbox` and `POST /api/sandbox` both leave the session with a non-null `sandboxState` — the first is DB-only (`provisioning`), the second is real. Two routes, one apparent goal.

### Steps
1. `POST /api/sessions/{sessionId}/sandbox` — body: none → expect `200` `{session:{sandboxState:{"type":"vercel"},lifecycleState:"provisioning",lifecycleVersion:1}}`
2. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"no_sandbox","lifecycle":{"state":"provisioning"}}`
3. `POST /api/sandbox` — body: `{"sessionId":"{sessionId}"}` (no `repoUrl`) → expect `200` `{createdAt,timeout,"mode":"vercel","timing":{"readyMs":<n>}}`; note `currentBranch` is absent for no-repo sandboxes
4. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"active","lifecycle":{"state":"active"}}`
5. `POST /api/sessions/{sessionId}/dev-server` → expect `404` `{error:...}` on an empty workspace (no detectable package) — or `200 {packagePath,port,url,logPath}` if one exists
6. `GET /api/sessions/{sessionId}/observability` → expect `200`, feed contains a `session.sandbox.attached` event from step 1

### Variations
- Call step 1 twice → second is idempotent, returns the current session unchanged and emits **no** second event.
- Recovery path: if step 3 fails client-side, `DELETE /api/sessions/{sessionId}/sandbox` → `200 {session:{sandboxState:null,lifecycleState:null}}` and emits `session.sandbox.attach_failed`.
- `DELETE /api/sessions/{sessionId}/sandbox` on a session that is **not** in `provisioning` → `200` with the session returned unchanged (silent no-op, not an error).

### Edge Cases
- Auth failure: step 1 without cookie → `401 {"error":"Not authenticated"}`.
- Not found: `POST /api/sessions/sess_missing/sandbox` → `404 {"error":"Session not found"}`.
- Ownership: another user's session → `403 {"error":"Forbidden"}`.
- DB failure: update returns nothing → `500 {"error":"Failed to update session"}`.

---

## STORY-session-and-sandbox-06: Recover a session whose sandbox died upstream

**Type**: medium
**Persona**: Developer returning to a tab left open overnight.
**Goal**: Detect that the VM is gone and get back to a working state.
**Preconditions**: A session whose stored `sandboxState` points at an expired/destroyed VM (produced by letting STORY-02's sandbox pass `sandboxExpiresAt`, or by deleting it upstream).
**Ideal path**: 2 calls — one `reconnect` probe that also self-heals the DB, then one create/resume. The probe doubles as the repair, which is why it is not 3.
**Alternate paths**: `GET /api/sandbox/status` also detects the dead sandbox and kicks the lifecycle workflow in the background, but does **not** return `errorKind` and does not clear state synchronously — same signal, weaker contract.

### Steps
1. `GET /api/sessions/{sessionId}` → expect `200`, `session.sandboxState` still populated, `lifecycleState` possibly `"active"` (stale)
2. `GET /api/sandbox/reconnect?sessionId={sessionId}` → expect `200` `{"status":"expired","hasSnapshot":true,"errorKind":"sandbox_unavailable","requestId":"...","lifecycle":{"state":"hibernated","sandboxExpiresAt":null}}`
3. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"no_sandbox","hasSnapshot":true,"lifecycle":{"state":"hibernated"}}` (state repaired by step 2)
4. `PUT /api/sandbox/snapshot` — body: `{"sessionId":"{sessionId}"}` → expect either `200 {"success":true,"restoredFrom":"session-{sessionId}",...}` or `404 {"errorKind":"sandbox_resume_unavailable"}` if the named VM is truly gone
5. On the `404` branch: `POST /api/sandbox` — body: `{"sessionId":"{sessionId}","repoUrl":"https://github.com/acme-labs/checkout-service","branch":"main"}` → expect `200` fresh sandbox
6. `GET /api/sandbox/reconnect?sessionId={sessionId}` → expect `200` `{"status":"connected","expiresAt":<future ms>}`

### Variations
- Healthy session, DB fast path: reconnect when `lifecycleState==="active"` and both `sandboxExpiresAt` and `state.expiresAt` are in the future → `200 {"status":"connected"}` with no upstream probe (log `path:"db-fast"`).
- Transient upstream error (not a "sandbox unavailable" error): → `200 {"status":"connected","warningKind":"sandbox_reconnect_transient"}` with `expiresAt` omitted when the stored value is already in the past.
- Failed-lifecycle recovery: a session with `lifecycleState:"failed"` but live runtime state → `GET /api/sandbox/status` flips it back to `"active"` and returns `{"status":"active"}`.

### Edge Cases
- Auth failure: reconnect without cookie → `401 {"error":"Not authenticated"}`.
- Validation failure: `GET /api/sandbox/reconnect` with no `sessionId` query param → `400 {"error":"Missing sessionId"}`.
- Not found: `?sessionId=sess_missing` → `404 {"error":"Session not found"}`.
- Ownership: another user's session → `403 {"error":"Forbidden"}`.
- No sandbox at all: reconnect on a no-repo session → `200 {"status":"no_sandbox","hasSnapshot":false}` (a 200, not a 404).

---

## STORY-session-and-sandbox-07: Archive a finished session, then bring it back

**Type**: medium
**Persona**: Developer wrapping up a shipped task and later reopening it for a follow-up fix.
**Goal**: Clear the session from the active list (and stop its VM), then reactivate it.
**Preconditions**: An active repo-backed session with a running sandbox (STORY-02).
**Ideal path**: 2 calls — `PATCH status:"archived"` (which stops the sandbox as a side effect) and `PATCH status:"running"`.
**Alternate paths**: none found for archive itself. Stopping the VM without archiving is reachable via `DELETE /api/sandbox` or `POST /api/sandbox/snapshot` (see the global note).

### Steps
1. `GET /api/sessions?status=active` → expect `200` `{sessions:[...],archivedCount:N}` including this session
2. `PATCH /api/sessions/{sessionId}` — body: `{"status":"archived"}` → expect `200` `{session:{status:"archived",lifecycleState:"archived"}}` (sandbox stop is scheduled in the background via `after`)
3. `GET /api/sessions?status=archived&limit=20&offset=0` → expect `200` `{sessions:[...],archivedCount:N+1,pagination:{limit:20,offset:0,hasMore:<bool>,nextOffset:<n>}}`
4. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200` `{"status":"no_sandbox","lifecycle":{"state":"archived"|"hibernated"}}`
5. `PATCH /api/sessions/{sessionId}` — body: `{"status":"running"}` → expect `200` `{session:{status:"running",lifecycleState:null,lifecycleError:null}}`
6. `PUT /api/sandbox/snapshot` — body: `{"sessionId":"{sessionId}"}` → expect `200 {"success":true,...}` (or the documented `404` resume errors)
7. `GET /api/sessions?status=active` → session is back in the list

### Variations
- `PATCH {"title":"Cart totals — shipped"}` → `200` with the new title, no lifecycle change.
- `PATCH {"status":"completed"}` → `200`, session marked done but **not** archived and the sandbox is left running.
- `PATCH {"prNumber":482,"prStatus":"open","linesAdded":118,"linesRemoved":34}` → `200` with those fields persisted.
- `PATCH {"runtimeMode":"managed_runtime","managedRuntimeProfileId":"node-22"}` → `200` when the profile id resolves.

### Edge Cases
- Auth failure: `PATCH` without cookie → `401 {"error":"Not authenticated"}`.
- Not found: `PATCH /api/sessions/sess_missing` → `404 {"error":"Session not found"}`.
- Ownership: another user's session → `403 {"error":"Forbidden"}`.
- **Conflict**: unarchive (step 5) while the background pause has not finished — no `snapshotUrl` yet and runtime `sandboxState` still present → `409 {"error":"Sandbox is still being paused for this archived session. Please try unarchiving again in a few seconds."}`
- Validation failure: `{"runtimeMode":"managed"}` → `400 {"error":"Invalid runtime mode"}`.
- Validation failure: `{"managedRuntimeProfileId":"prof_nonexistent"}` → `400 {"error":"Invalid managed runtime profile"}`.
- Validation failure: `{"inferenceProfileId":"prof_disabled"}` (exists but `enabled:false`) → `400 {"error":"Invalid inference profile"}`.
- Validation failure: malformed JSON → `400 {"error":"Invalid JSON body"}`.
- Listing validation: `GET /api/sessions?status=deleted` → `400 {"error":"Invalid status filter"}`; `?status=archived&limit=abc` → `400 {"error":"Invalid archived limit"}`; `?status=archived&offset=-1` → `400 {"error":"Invalid archived offset"}`.

---

## STORY-session-and-sandbox-08: Delete a session outright

**Type**: short
**Persona**: Developer cleaning up an experiment they don't want kept.
**Goal**: Remove the session and its chats.
**Preconditions**: Any owned session, ideally with the sandbox already stopped (STORY-03).
**Ideal path**: 1 call — `DELETE /api/sessions/{id}`.
**Alternate paths**: none found; archiving (STORY-07) is the non-destructive sibling.

### Steps
1. `DELETE /api/sandbox` — body: `{"sessionId":"{sessionId}"}` → expect `200 {"success":true}` (or `{"success":true,"alreadyStopped":true}`)
2. `DELETE /api/sessions/{sessionId}` → expect `200 {"success":true}`
3. `GET /api/sessions/{sessionId}` → expect `404 {"error":"Session not found"}`
4. `GET /api/sandbox/status?sessionId={sessionId}` → expect `404 {"error":"Session not found"}`

### Variations
- Delete without stopping the sandbox first (skip step 1) → still `200`; note the route does **not** stop the VM, so this is a resource-leak path worth flagging.

### Edge Cases
- Auth failure: `DELETE` without cookie → `401 {"error":"Not authenticated"}`.
- Not found: deleting twice → second call `404 {"error":"Session not found"}`.
- Ownership: another user's session → `403 {"error":"Forbidden"}`.

---

## STORY-session-and-sandbox-09: Full working day — provision, work, pause, resume, ship, archive

**Type**: long
**Persona**: Developer doing a complete task on `acme-labs/checkout-service`.
**Goal**: Exercise the whole session+sandbox state machine end to end alongside the surfaces that depend on a live sandbox.
**Preconditions**: GitHub App installed for `acme-labs`; repo readable.
**Ideal path**: ~12 calls — create, provision, inspect, work, pause, resume, commit, PR, archive. The rest below are polls the UI performs that a well-designed API would collapse into one status resource.
**Alternate paths**: pause via `DELETE /api/sandbox` instead of step 12; resume via `POST /api/sandbox` instead of step 14; liveness via `GET /api/sandbox/status` instead of `GET /api/sandbox/reconnect`.

### Steps
1. `POST /api/sessions` — body: `{"title":"Cart totals rounding","repoOwner":"acme-labs","repoName":"checkout-service","cloneUrl":"https://github.com/acme-labs/checkout-service","branch":"main","isNewBranch":true,"autoCommitPush":false,"autoCreatePr":false}` → `200 {session:{id,branch},chat:{id}}`
2. `POST /api/sandbox` — body: `{"sessionId":"{sessionId}","repoUrl":"https://github.com/acme-labs/checkout-service","branch":"{session.branch}","isNewBranch":true}` → `200 {createdAt,timeout,currentBranch,mode:"vercel",timing}`
3. `GET /api/sandbox/status?sessionId={sessionId}` → `200 {"status":"active"}`
4. `GET /api/sessions/{sessionId}/files` → `200 {files:[...]}`
5. `GET /api/sessions/{sessionId}/files/content?path=src/cart/totals.ts` → `200 {path,content,size}`
6. `GET /api/sessions/{sessionId}/skills` → `200 {skills:[...]}`
7. `POST /api/sandbox/activity` — body: `{"sessionId":"{sessionId}"}` → `200 {"success":true}`
8. `POST /api/sessions/{sessionId}/sandbox-services` → `200 {service:{id,status}}` (managed dev server; requires `runtimeMode:"managed_runtime"`)
9. `GET /api/sessions/{sessionId}/sandbox-services/{serviceId}/logs?lines=200` → `200 text/plain`
10. `GET /api/sessions/{sessionId}/diff` → `200 DiffResponse`
11. `POST /api/sandbox/extend` — body: `{"sessionId":"{sessionId}"}` → `200 {"success":true,"expiresAt","extendedBy"}`
12. `POST /api/sandbox/snapshot` — body: `{"sessionId":"{sessionId}"}` → `200 {"snapshotId","createdAt","requestId"}` (lunch break)
13. `GET /api/sandbox/reconnect?sessionId={sessionId}` → `200 {"status":"no_sandbox","hasSnapshot":true}`
14. `PUT /api/sandbox/snapshot` — body: `{"sessionId":"{sessionId}"}` → `200 {"success":true,"restoredFrom","sandboxName"}`
15. `GET /api/sandbox/reconnect?sessionId={sessionId}` → `200 {"status":"connected","expiresAt":<future>}`
16. `GET /api/sessions/{sessionId}/diff` → `200`, same changes present as step 10 (workspace survived the pause)
17. `POST /api/sessions/{sessionId}/generate-commit-message` → `200 {"message":"fix(cart): round line totals before summing"}`
18. `POST /api/sessions/{sessionId}/git/commit` — body: `{"message":"fix(cart): round line totals before summing"}` → `200` commit result
19. `POST /api/sessions/{sessionId}/git/pr` — body: `{"title":"Fix cart totals rounding","body":"Rounds each line total before summation.","baseBranch":"main"}` → `200` PR result
20. `GET /api/sessions/{sessionId}/git/pr/readiness` → `200` merge-readiness result
21. `PATCH /api/sessions/{sessionId}` — body: `{"prNumber":482,"prStatus":"open","status":"completed"}` → `200 {session:{status:"completed",prNumber:482}}`
22. `GET /api/sessions/{sessionId}/observability?limit=100` → `200` aggregate with sandbox lifecycle + service + workflow events
23. `PATCH /api/sessions/{sessionId}` — body: `{"status":"archived"}` → `200 {session:{status:"archived",lifecycleState:"archived"}}`
24. `GET /api/sandbox/status?sessionId={sessionId}` → `200 {"status":"no_sandbox"}`
25. `GET /api/sessions?status=archived` → `200`, session present in the archived list

### Variations
- Replace step 8/9 with the classic pair: `POST /api/sessions/{sessionId}/dev-server` then `GET /api/sessions/{sessionId}/dev-server?lines=200` — a second, near-duplicate dev-server surface (classic vs managed_runtime).
- Add `POST /api/sessions/{sessionId}/code-editor` → `200 {url,port}` and `GET .../code-editor` → `200 {running,url,port}`, then `DELETE .../code-editor` → `200 {stopped:true}`.
- Add `GET /api/sessions/{sessionId}/diff/patch` → `200 text/x-diff` attachment, and `GET .../diff/cached` → `200 {data,cachedAt,isStale:true}`.

### Edge Cases
- Sandbox-dependent routes while hibernated (between steps 12 and 14): `GET /api/sessions/{sessionId}/diff` → `409`; `GET /api/sessions/{sessionId}/files` → `409`; `GET /api/sessions/{sessionId}/skills` → `409`.
- `POST /api/sessions/{sessionId}/sandbox-services` on a `runtimeMode:"classic"` session → `409` (managed-runtime-only surface).
- `POST /api/sessions/{sessionId}/code-editor` when code-server is already running → `409`.
- `GET /api/sessions/{sessionId}/files/content?path=` (empty) → `400`; a path that does not exist → `404`; a file over the size cap → `413`.
- Ownership on any session-scoped route → `403 {"error":"Forbidden"}`; unknown session → `404 {"error":"Session not found"}`; no cookie → `401 {"error":"Not authenticated"}`.

---

## STORY-session-and-sandbox-10: Multi-turn chat that drives sandbox state (message → tool run → approval → follow-up)

**Type**: long
**Persona**: Developer pair-working with the agent over several turns in one session.
**Goal**: Hold a real conversation whose tool calls execute in the sandbox, keeping the VM alive across turns and inspecting what the agent did.
**Preconditions**: Repo-backed session with active sandbox (STORY-02). `sessionId` and `chatId` from that story.
**Ideal path**: ~8 calls for three conversational turns — each turn is one `POST /api/chat` plus one state read; the extra heartbeat/status polls are client bookkeeping the server could infer.
**Alternate paths**: reconnecting to an in-flight response is possible via `GET /api/chat/{chatId}/stream` **or** by re-issuing `POST /api/chat` with the same messages (which reconnects to the existing workflow run rather than starting a new one). Transcript state is readable from both `GET /api/sessions/{sessionId}/chats/{chatId}` and the `/api/chat` stream itself.

### Steps
1. `GET /api/sessions/{sessionId}/chats` → expect `200` `{chats:[{id,title}],defaultModelId}`
2. `POST /api/sandbox/activity` — body: `{"sessionId":"{sessionId}"}` → `200 {"success":true}` (user focused the composer)
3. **Turn 1** — `POST /api/chat` — body: `{"sessionId":"{sessionId}","chatId":"{chatId}","messages":[{"id":"msg_01","role":"user","parts":[{"type":"text","text":"Find where cart line totals are summed and show me the function."}]}]}` → expect `200` UI-message stream (`text/event-stream`-style chunks) with response header `x-workflow-run-id`
4. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect `200` `ChatRefreshResponse` containing the assistant reply and its `read_file`/`bash` tool parts
5. `GET /api/sessions/{sessionId}/observability?chatId={chatId}&limit=50` → expect `200`, feed shows the workflow run and per-step rows
6. **Turn 2** — `POST /api/chat` — body: same shape, `messages` now includes the turn-1 exchange plus `{"id":"msg_03","role":"user","parts":[{"type":"text","text":"Round each line to 2 decimals before summing, then run the cart tests."}]}` → `200` stream; the agent edits files and runs tests in the sandbox
7. While the stream is open, from a second shell: `GET /api/chat/{chatId}/stream` → expect `200` reconnection to the same UI-message stream (or `204` if the run already finished)
8. `GET /api/sessions/{sessionId}/diff` → expect `200` `DiffResponse` with the agent's edits to `src/cart/totals.ts`
9. **Approval turn** — if the run gated on a managed-runtime profile draft: `GET /api/sessions/{sessionId}/managed-runtime/profile-drafts?chatId={chatId}` → `200 {drafts:[{id,input}]}`, then `PATCH /api/sessions/{sessionId}/managed-runtime/profile-drafts/{draftId}` — body: `{"output":{"approved":true}}` → `200 {draft,savedProfileId,appliedToSessionId}`
10. `POST /api/sandbox/extend` — body: `{"sessionId":"{sessionId}"}` → `200 {"success":true,"expiresAt","extendedBy"}` (long turn about to run)
11. **Turn 3** — `POST /api/chat` — body: messages plus `{"id":"msg_05","role":"user","parts":[{"type":"text","text":"Tests pass — write a commit message and stop there."}]}` → `200` stream
12. `POST /api/chat/{chatId}/stop` — body: `{}` → expect `200 {"success":true}` (user interrupts mid-answer; clears `chat.activeStreamId` under a CAS guard)
13. `GET /api/sessions/{sessionId}/chats/{chatId}` → expect `200`, transcript ends with the partial assistant message
14. `POST /api/sessions/{sessionId}/chats/{chatId}/read` → `200 {"success":true}`
15. `GET /api/sandbox/status?sessionId={sessionId}` → expect `200 {"status":"active"}` — the sandbox stayed up across all three turns

### Variations
- Fork the conversation at turn 2: `POST /api/sessions/{sessionId}/chats/{chatId}/fork` — body: `{"messageId":"msg_03"}` → `201/200 {chat:{id}}`, then continue with `POST /api/chat` against the new `chatId` in the **same** session and sandbox.
- Roll back a turn: `DELETE /api/sessions/{sessionId}/chats/{chatId}/messages/msg_03` → `200 {success:true,deletedMessageIds:[...]}` (deletes the user message and everything after it), then re-send turn 2 with different wording.
- Second chat in the same session: `POST /api/sessions/{sessionId}/chats` — body: `{}` → `200 {chat:{id}}`; both chats share one sandbox.

### Edge Cases
- Auth failure: `POST /api/chat` without cookie → `401 {"error":"Not authenticated"}`.
- Ownership: `POST /api/chat` with a `chatId` belonging to another session/user → `403`.
- Validation failure: `POST /api/chat` with `messages: []` or a missing `chatId` → `400`.
- Conflict: `POST /api/chat` while a run for that chat is already active and non-reconnectable → `409`.
- Unprocessable: `POST /api/chat` with a `workflowId` whose `inputValues` fail `validateWorkflowInputs` → `422`.
- Upstream failure: workflow start fails → `502`.
- Stop with no active run: `POST /api/chat/{chatId}/stop` → `200 {"success":true}` (idempotent, no 404).
- Stream with no active run: `GET /api/chat/{chatId}/stream` → `204` (no body).
- Sandbox died mid-conversation: `GET /api/sessions/{sessionId}/diff` → `409`; recover via STORY-06 before the next turn.

---

## STORY-session-and-sandbox-11: Session list & status polling loop (what the dashboard actually does)

**Type**: short
**Persona**: The web client's polling layer, exercised directly.
**Goal**: Confirm the three overlapping status surfaces agree, and quantify the redundancy.
**Preconditions**: At least one active session (STORY-02) and one archived session (STORY-07).
**Ideal path**: 1 call — a single sessions list that embedded lifecycle state would remove the need for per-session status polls entirely.
**Alternate paths**: this story exists *because* the same data is reachable three ways — `GET /api/sandbox/status`, `GET /api/sandbox/reconnect`, and `GET /api/sessions/{sessionId}` all report sandbox liveness/expiry, and `GET /api/sessions?status=archived` duplicates `archivedCount` already returned by `?status=active`.

### Steps
1. `GET /api/sessions` → expect `200` `{sessions:[...]}` (no `archivedCount` on the unfiltered branch)
2. `GET /api/sessions?status=active` → expect `200` `{sessions:[...],archivedCount:N}`
3. `GET /api/sessions?status=archived&limit=50&offset=0` → expect `200` `{sessions,archivedCount:N,pagination:{limit:50,offset:0,hasMore,nextOffset}}`
4. `GET /api/sandbox/status?sessionId={activeSessionId}` → `200 {"status":"active","hasSnapshot":false,"lifecycleVersion":<n>,"lifecycle":{...}}`
5. `GET /api/sandbox/reconnect?sessionId={activeSessionId}` → `200 {"status":"connected","hasSnapshot":false,"expiresAt":<ms>,"requestId":"...","lifecycle":{...}}` — assert the `lifecycle` object is identical to step 4's
6. `GET /api/sessions/{activeSessionId}` → `200 {session:{sandboxState:{...,expiresAt},lifecycleState:"active",sandboxExpiresAt}}` — a third representation of the same facts

### Variations
- `?status=archived&limit=200` → clamped to 100 (`MAX_ARCHIVED_SESSIONS_LIMIT`); response `pagination.limit` is `100`.
- `?status=archived&limit=0` → clamped up to 1; `pagination.limit` is `1`.
- Page through with `offset=pagination.nextOffset` until `hasMore:false`.

### Edge Cases
- Auth failure: `GET /api/sessions` without cookie → `401 {"error":"Not authenticated"}`.
- Validation failure: `?status=paused` → `400 {"error":"Invalid status filter"}`.
- Validation failure: `?status=archived&limit=1.5` → `400 {"error":"Invalid archived limit"}` (regex requires digits only).
- Validation failure: `?status=archived&offset=x` → `400 {"error":"Invalid archived offset"}`.
- Not found: `GET /api/sandbox/status?sessionId=sess_missing` → `404 {"error":"Session not found"}`.
- Missing param: `GET /api/sandbox/status` with no query → `400 {"error":"Missing sessionId"}`.
