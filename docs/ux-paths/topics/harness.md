# Topic: Verified Build harness (`/api/harness/*` + `/api/chat` routing hook)

All routes verified by reading `apps/web/app/api/harness/**` and
`apps/web/lib/harness/**` + `apps/web/lib/verified-build/**`.

Cross-cutting facts every story depends on:

- Auth: `requireAuthenticatedUser()` → **401** `{error:"Not authenticated"}` when signed out.
- Session/chat ownership (`requireOwnedSessionChat`): missing session → **404** "Session not found";
  session owned by someone else → **403** "Forbidden"; missing/mismatched chat → **404** "Chat not found".
- Run ownership (`requireHarnessRunAccess`): unknown or foreign runId → **404**
  `{error:{code:"not_found",message:"Verified Build run not found",request_id}}`.
- Harness disabled (`HARNESS_ENABLED != "true"`) on any run-scoped route → **503** `harness_disabled`.
  `GET /api/harness/ready` instead returns **200** `{enabled:false,requestId}`.
- Product surface flag `OPEN_AGENTS_EXPOSE_VERIFIED_BUILD` gates only **POST** `/api/harness/runs`
  (→ **404** `product_surface_disabled`) and the `/api/chat` auto-routing branch. `GET /api/harness/runs`
  is NOT flag-gated.
- Every harness response carries an `X-Request-ID` header; send your own with `X-Request-ID:` to correlate.
- Bad harness config → **500** `harness_config_invalid`; upstream harness error → passthrough status with
  the upstream code; anything else → **500** `harness_internal_error`.

Local curl assumption: `-b cookies.txt` carries a better-auth session; `$BASE=http://localhost:3000`.

---

## STORY-harness-01: Check whether Verified Build is even switched on

**Type**: short
**Persona**: Operator doing a pre-flight check before a demo
**Goal**: Know if the harness is reachable before telling a user to start a run
**Preconditions**: none — `/api/harness/ready` is fully public
**Ideal path**: 1 call — readiness is a single unauthenticated probe and it already reports both the enabled flag and upstream reachability.
**Alternate paths**: none found for readiness itself. Indirect signals of the same state leak from any run-scoped route as a `503 harness_disabled`, and from `POST /api/harness/runs` as `404 product_surface_disabled` — three different status codes for "this feature is off".

### Steps
1. `GET /api/harness/ready` — no body, no cookie → expect `200` with either `{"enabled":false,"requestId":"..."}` (harness off) or the upstream readiness object (harness on), plus header `X-Request-ID`.

### Variations
- Send `X-Request-ID: preflight-2026-08-02-01` and confirm the same id echoes in the response header and, when disabled, in `requestId`.
- Poll it every 30s during an upstream restart to watch it flip from failing to ready.

### Edge Cases
- Auth failure: n/a — route never calls `requireAuthenticatedUser`; a signed-out curl still gets `200`.
- Upstream unreachable / timeout (`HARNESS_REQUEST_TIMEOUT_MS`, default 15000): `HarnessClientError` → the upstream status is passed through by `errorToHarnessResponse`.
- `HARNESS_ENABLED=true` but `HARNESS_BASE_URL` missing or containing a path/credentials: `HarnessConfigError` → **500** `harness_config_invalid`.

---

## STORY-harness-02: Start a Verified Build run explicitly for a chat

**Type**: short
**Persona**: Developer who wants the gated build path instead of plain chat
**Goal**: Get a `verifiedBuildRun` queued against an existing session + chat
**Preconditions**: A session and a chat owned by the caller (created via the session/chat stories); at least one persisted user message whose id you pass as `latestUserMessageId`; `OPEN_AGENTS_EXPOSE_VERIFIED_BUILD=true` and `HARNESS_ENABLED=true`.
**Ideal path**: 2 calls — one to read the chat's latest message id, one to start. It would be 1 if the start route could resolve "latest user message" itself, which it already half-does inside `/api/chat`.
**Alternate paths**: **`POST /api/chat`** starts the *same* run via `startVerifiedBuildRun` when `classifyVerifiedBuildTask` sees mutation words and the surface flag is on — returning `x-verified-build-run-id` instead of `{run}`. Two distinct entry points, two response shapes, one underlying record. Redundancy signal.

### Steps
1. `GET /api/sessions/{sessionId}/chats/{chatId}/messages` → expect `200`, take the last `role:"user"` message `id`.
2. `POST /api/harness/runs` — body:
   ```json
   {"sessionId":"ses_9f2c41","chatId":"cht_18ab77","latestUserMessageId":"msg_5d0e2a",
    "intentSummary":"Add rate limiting to the /api/harness/runs POST route",
    "selectionReason":"user_requested_verified_build","mode":"verified_build"}
   ```
   → expect `202` `{"run":{id,sessionId,chatId,harnessRunId,mode:"verified_build",status:"queued",tenantId,projectId,actorId,intentSummary,selectionReason,lastEventId:null,planApprovalState,pendingApprovalKind,finalReportArtifactId,goNoGo,createdAt,updatedAt}}` + `X-Request-ID`.

### Variations
- Omit `mode` — the zod schema defaults it to `"verified_build"`.
- `"mode":"investigation"` for a read-only run.
- Omit `intentSummary` and `selectionReason` — both optional.

### Edge Cases
- Signed out → **401**.
- `OPEN_AGENTS_EXPOSE_VERIFIED_BUILD` unset → **404** `product_surface_disabled` (checked *before* body parsing).
- Malformed JSON body → **400** `invalid_request` "Invalid JSON body".
- `"mode":"managed"` or missing `chatId` → **400** `invalid_request` "Invalid Verified Build run request".
- `intentSummary` > 1000 chars or `selectionReason` > 500 chars → **400** `invalid_request`.
- Someone else's `sessionId` → **403** "Forbidden"; unknown `sessionId` → **404** "Session not found"; `chatId` belonging to a different session → **404** "Chat not found".
- Surface flag on but `HARNESS_ENABLED` off → **503** `harness_disabled`.
- Upstream refuses the start → **502**/upstream status via `errorToHarnessResponse`.

---

## STORY-harness-03: Chat message auto-routes into Verified Build

**Type**: short
**Persona**: Developer who just types a request in chat and does not know the harness exists
**Goal**: Have a code-changing request intercepted and turned into a gated run rather than a free-form agent stream
**Preconditions**: Owned session + chat with no `activeStreamId`; surface flag and `HARNESS_ENABLED` on; `HARNESS_ALLOWED_DIRECT_MODE` off (otherwise direct chat wins).
**Ideal path**: 2 calls — send the message, then read back the created run. The run snapshot is only exposed via a header on the chat response, so a second call is unavoidable today.
**Alternate paths**: **`POST /api/harness/runs`** (STORY-02) reaches the identical state deliberately. Also note the run can then be read from **either** `GET /api/harness/runs?sessionId&chatId` **or** `GET /api/harness/runs/{runId}` — same `run` object from two endpoints.

### Steps
1. `POST /api/chat` — body:
   ```json
   {"sessionId":"ses_9f2c41","chatId":"cht_18ab77",
    "messages":[{"id":"msg_7c33e1","role":"user",
      "parts":[{"type":"text","text":"Fix the null deref in lib/harness/events.ts and add a regression test"}]}]}
   ```
   → expect `200` `text/event-stream` UI-message stream containing the "routed to Verified Build" notice, headers `x-verified-build-run-id: vbr_...` and `x-request-id`.
2. `GET /api/harness/runs?sessionId=ses_9f2c41&chatId=cht_18ab77` → expect `200` `{run:{...,status:"queued"},events:[]}` where `run.id` equals the header value.

### Variations
- Text `"Explain how the harness SSE replay works, no code"` matches `CHAT_PATTERNS` → no run created, normal workflow stream with `x-workflow-run-id`.
- Text `"Investigate why SSE events stop replaying after reconnect"` → `mode:"investigation"`, `selectionReason:"read_only_investigation"`.
- Turn `HARNESS_ENABLED` off and resend the mutation text → `direct_chat` (reason `harness_disabled`), plain workflow stream.

### Edge Cases
- Signed out → **401** from `/api/chat`'s own auth guard.
- Chat already has an `activeStreamId` that is still live → **409** `{"error":"Another workflow is already running for this chat"}` — the harness branch is never reached.
- Messages array with no `role:"user"` entry but classified as mutating → **400** `{"error":"A user message is required"}`.
- `startVerifiedBuildRun` throws → **502** `{"error":"Verified Build could not be started","requestId"}` with `X-Request-ID`.

---

## STORY-harness-04: Watch a run live over SSE, disconnect, and replay

**Type**: medium
**Persona**: Developer following a build run in a terminal
**Goal**: Stream events, survive a dropped connection, and not lose or double-count events
**Preconditions**: A queued run from STORY-02 or STORY-03.
**Ideal path**: 3 calls — snapshot, stream, resume-stream. Resume needs no extra bookkeeping call because the server remembers `lastEventId` on the run row.
**Alternate paths**: Polling `GET /api/harness/runs/{runId}` (which returns the persisted `events[]`) reaches the same information without SSE — a second, complete path to the event history. `GET /api/harness/runs?sessionId&chatId` returns the same `events[]` for the *latest* run. Three ways to read the same events.

### Steps
1. `GET /api/harness/runs/{runId}` → expect `200` `{run,harnessRun,events:[]}` (`harnessRun` is the live upstream status object).
2. `GET /api/harness/runs/{runId}/events` — `Accept: text/event-stream` → expect `200` `text/event-stream`, `Cache-Control: no-store`; each block is `id: <harnessEventId>` / `event: <name>` / `data: {...}` and is persisted server-side as it passes through.
3. Kill the curl mid-stream (simulate network drop).
4. `GET /api/harness/runs/{runId}/events` with header `Last-Event-ID: evt_00042` → expect `200` stream resuming after event 42, replay capped at `HARNESS_SSE_REPLAY_LIMIT` (default 100).
5. `GET /api/harness/runs/{runId}` → expect `200` with `events[]` now containing everything streamed, `run.lastEventId:"evt_..."`, `run.lastEventName` set.

### Variations
- Use `?after_event_id=evt_00042` instead of the header — same precedence chain is `Last-Event-ID` → query → stored `run.lastEventId`.
- Reconnect with neither → server falls back to the stored `lastEventId`, so a naive client still resumes rather than replaying from zero.

### Edge Cases
- Signed out → **401** before any stream opens.
- Foreign/unknown runId → **404** `not_found`.
- `HARNESS_ENABLED` off → **503** `harness_disabled` (JSON, not a stream).
- Upstream returns a bodyless response → thrown "Harness event stream did not include a body" → **500** `harness_internal_error`.
- Upstream stream errors mid-flight → the HTTP response is already `200`; the failure surfaces as a stream error plus a `verified_build.sse.failed` log, not a status code. Clients that only check status will miss it.

---

## STORY-harness-05: Approve a pending gate and let the run continue

**Type**: medium
**Persona**: Reviewer who owns the go/no-go decision
**Goal**: Unblock a run sitting at `pending_approval`
**Preconditions**: A run from STORY-02 that has reached a pending approval (`run.pendingApprovalKind` set, or upstream `pending_approvals` non-empty).
**Ideal path**: 3 calls — read snapshot to learn the pending kind, approve, re-read. Cannot be 2: the approval `kind` is not knowable without a read, and the route re-fetches upstream status itself anyway.
**Alternate paths**: **`POST /api/harness/runs/{runId}/repair`** with `{"approvalKind":"plan"}` also targets an approval kind and proxies to the harness — an overlapping second way to act on the same gate. The pending kind is discoverable from `GET /api/harness/runs/{runId}` (`run.pendingApprovalKind` **and** `harnessRun.pending_approvals` **and** `harnessRun.pending_approval_details[].approval_kind`) — three representations of one fact in one payload.

### Steps
1. `GET /api/harness/runs/{runId}` → expect `200`, `run.status:"pending_approval"`, `run.pendingApprovalKind:"plan"`.
2. `POST /api/harness/runs/{runId}/approve` — body:
   ```json
   {"kind":"plan","approved":true,"note":"Plan looks right; scope limited to lib/harness/events.ts"}
   ```
   → expect `200` with the proxied harness response body.
3. `GET /api/harness/runs/{runId}/events` (or re-`GET` the snapshot) → expect the run to move past the gate; `run.planApprovalState` updated.

### Variations
- `{"kind":"plan","approved":false,"note":"Scope is too broad, split it"}` — a rejection is still an approve-route call.
- Omit `approved` — zod defaults it to `true`. A body of `{"kind":"plan"}` therefore *approves*; there is no way to accidentally-safely no-op.
- Omit `note` — optional, max 1000 chars.

### Edge Cases
- Signed out → **401**; foreign run → **404**.
- Malformed JSON → **400** `invalid_request` "Invalid JSON body".
- Missing `kind`, empty `kind`, or `kind` > 120 chars → **400** `invalid_request` "Invalid approval request".
- **Conflict**: `kind` not in the union of local `pendingApprovalKind` + upstream `pending_approvals` + `pending_approval_details[].approval_kind` → **400** `invalid_request` "Approval kind is not pending for this run". Note this is a 400, not a 409, for what is really a state conflict.
- Approving the same kind twice → second call fails the same 400 pending check once upstream clears it.
- `HARNESS_ENABLED` off → **503**.

---

## STORY-harness-06: Cancel a run that is going the wrong way

**Type**: short
**Persona**: Developer who spotted the run editing the wrong package
**Goal**: Stop the run and confirm the local record reflects it
**Preconditions**: A running (non-terminal) run.
**Ideal path**: 2 calls — cancel, then confirm. Confirmation is separate because the cancel response is the raw proxied harness body, not a run snapshot.
**Alternate paths**: none found — `/cancel` is the only cancellation route for harness runs (`/api/sessions/.../stop` cancels workflow runs, a different subsystem).

### Steps
1. `POST /api/harness/runs/{runId}/cancel` — body: `{"reason":"Targeting the wrong package; restarting with a narrower prompt"}` → expect `200` proxied harness body.
2. `GET /api/harness/runs/{runId}` → expect `200` with `run.status:"cancellation_requested"` (written only *after* the upstream call succeeds — a failed upstream leaves the local row untouched, by design).

### Variations
- Send with `Content-Length: 0` and no body → route substitutes `{}` and cancels with no reason.
- Send `null` body → `.catch(() => null)` then `?? {}` → still a valid cancel.

### Edge Cases
- Signed out → **401**; unknown run → **404**.
- `{"reason": 12345}` or a reason > 500 chars → **400** `invalid_request` "Invalid cancellation request".
- Cancelling an already-terminal run → whatever the upstream returns, passed through (commonly 409 upstream → 409 here).
- Upstream 5xx during cancel → error passthrough and the local row is deliberately **not** moved to `cancellation_requested`.

---

## STORY-harness-07: Diagnose a failed run and repair from a capsule

**Type**: medium
**Persona**: Developer whose verified build failed at the test gate
**Goal**: Read the failure capsule, then relaunch the failed step
**Preconditions**: A run in a failed state with at least one capsule.
**Ideal path**: 3 calls — capsules, repair, confirm. Trace/audit are optional depth.
**Alternate paths**: Repair accepts **either** `capsuleId` **or** `approvalKind`, so the same route serves two different recovery models. Cancel + restart via `POST /api/harness/runs` is a coarser alternate route to a working run.

### Steps
1. `GET /api/harness/runs/{runId}/capsules` → expect `200` proxied capsule list; note `id` of the failing capsule, e.g. `cap_test_gate_3`.
2. `GET /api/harness/runs/{runId}/trace` → expect `200` proxied trace to see which step produced it.
3. `POST /api/harness/runs/{runId}/repair` — body: `{"capsuleId":"cap_test_gate_3","note":"Flaky timer in events.test.ts; rerun the gate"}` → expect `200` proxied repair acknowledgement.
4. `GET /api/harness/runs/{runId}` → expect `200` with the run back in a running state.

### Variations
- `{"approvalKind":"verification","note":"Re-request verification approval"}` instead of a capsule id.
- Both fields together — accepted by the schema; the whole parsed object is forwarded upstream, so precedence is upstream's problem, not the app's.

### Edge Cases
- Signed out → **401**; foreign run → **404**.
- `{}` or `{"note":"please retry"}` (neither `capsuleId` nor `approvalKind`) → **400** `invalid_request` "Repair requires a failure capsule or approval kind".
- Malformed JSON → **400** "Invalid JSON body".
- `{"capsuleId":""}` → **400** (min length 1).
- Unknown `capsuleId` → upstream 404 passed through as **404**.
- Note that unlike `/approve`, repair does **not** validate `approvalKind` against pending kinds — an unpending kind reaches the harness.

---

## STORY-harness-08: Collect the evidence pack after a successful run

**Type**: medium
**Persona**: Release operator assembling proof for a PR description
**Goal**: Pull artifacts, the final report, the audit trail, and an export plan
**Preconditions**: A succeeded run with `run.finalReportArtifactId` set.
**Ideal path**: 4 calls — artifacts list, final report artifact, audit, export plan. Could be 1 if there were a bundled "evidence" endpoint; there isn't.
**Alternate paths**: `GET /api/harness/runs/{runId}/artifacts` (list) and `GET /api/harness/artifacts/{artifactId}?runId=` (single) both return artifact data — the list is the discovery path, the singular is the fetch path, and they overlap for small artifacts. The final report artifact id is also already on the run snapshot, so step 1 is skippable when you only want the report.

### Steps
1. `GET /api/harness/runs/{runId}` → expect `200`; read `run.finalReportArtifactId` and `run.goNoGo`.
2. `GET /api/harness/runs/{runId}/artifacts` → expect `200` proxied artifact list.
3. `GET /api/harness/artifacts/{artifactId}?runId={runId}` → expect `200` proxied single artifact (auth is scoped through `runId`, not the artifact itself).
4. `GET /api/harness/runs/{runId}/audit` → expect `200` proxied audit trail.
5. `GET /api/harness/runs/{runId}/trace/export-plan` → expect `200` proxied export plan.

### Variations
- Fetch the final report directly with the id from step 1, skipping step 2.
- Repeat step 3 for each artifact id from step 2 to mirror an entire run's outputs locally.

### Edge Cases
- Signed out → **401** on every one of these.
- `GET /api/harness/artifacts/{artifactId}` with **no** `runId` query param → **400** `invalid_request` "runId is required to scope artifact access".
- `runId` that exists but belongs to another user → **404** `not_found` — and this is the only ownership check, so an artifact id from a *different* run of *yours* still resolves; the `runId` scoping is authorization, not correlation.
- Unknown `artifactId` → upstream **404** passthrough.
- `HARNESS_ENABLED` off → **503** on all five.

---

## STORY-harness-09: Inspect a workcell referenced by run events

**Type**: short
**Persona**: Platform engineer debugging where a run actually executed
**Goal**: Resolve a workcell id seen in the event stream to its detail record
**Preconditions**: Authenticated user; a workcell id from a run event payload; `HARNESS_ENABLED=true`.
**Ideal path**: 2 calls — read events to get the id, fetch the workcell.
**Alternate paths**: none found — this is the only workcell route. Note it is *not* run-scoped: any authenticated user can read any workcell id, unlike every other harness route which enforces run ownership.

### Steps
1. `GET /api/harness/runs/{runId}` → expect `200`; find a workcell id inside `events[].eventPayload`, e.g. `wc_us-east_07`.
2. `GET /api/harness/workcells/wc_us-east_07` → expect `200` proxied workcell detail.

### Variations
- Call step 2 with a workcell id learned from the SSE stream instead of the persisted snapshot.

### Edge Cases
- Signed out → **401**.
- `HARNESS_ENABLED` off → **503** `harness_disabled`.
- Unknown workcell id → upstream **404** passthrough.
- Another tenant's workcell id → resolved against the *config* tenant (`config.tenantId`, `config.defaultProjectId`), not the run's tenant, so cross-tenant behavior is upstream's call, not the app's.

---

## STORY-harness-10: Full multi-turn build — chat, gates, failure, repair, evidence

**Type**: long
**Persona**: Developer shipping a real change through the gated path start to finish
**Goal**: Take one plain-English request all the way to an approved, evidenced, succeeded run
**Preconditions**: Owned session + chat; surface flag and harness enabled; direct mode off.
**Ideal path**: ~12 calls for the happy multi-gate path (start, stream, 2 approvals with a read each, capsule read, repair, re-stream, final snapshot, artifacts, audit). The extra reads exist because approvals and repairs return raw proxied bodies rather than the updated run snapshot — every mutation costs a follow-up read.
**Alternate paths**: The whole thing can be driven without `/api/chat` by starting at `POST /api/harness/runs`; and the entire event history can be obtained by polling `GET /api/harness/runs/{runId}` instead of using SSE.

### Steps
1. `POST /api/sessions` — body: `{"repoUrl":"https://github.com/dennisonbertram/open-agents","title":"Harness rate limiting"}` → expect `200`/`201` `{session}`.
2. `POST /api/sessions/{sessionId}/chats` — body: `{"title":"Rate limit harness run starts"}` → expect `200` `{chat}`.
3. `POST /api/chat` — body:
   ```json
   {"sessionId":"{sessionId}","chatId":"{chatId}",
    "messages":[{"id":"msg_a1","role":"user",
      "parts":[{"type":"text","text":"Add a per-user rate limit to POST /api/harness/runs and cover it with a test"}]}]}
   ```
   → expect `200` SSE with header `x-verified-build-run-id`.
4. `GET /api/harness/runs?sessionId={sessionId}&chatId={chatId}` → expect `200` `{run:{status:"queued",mode:"verified_build"},events:[]}`.
5. `GET /api/harness/runs/{runId}/events` → expect `200` SSE; consume until a `pending_approval` event; note `Last-Event-ID`.
6. `GET /api/harness/runs/{runId}` → expect `200`, `run.pendingApprovalKind:"plan"`.
7. `POST /api/harness/runs/{runId}/approve` — body: `{"kind":"plan","approved":true,"note":"Scope limited to the runs route and its test"}` → expect `200`.
8. `GET /api/harness/runs/{runId}/events` with `Last-Event-ID: {id from step 5}` → expect `200` SSE resuming; run proceeds to a failing test gate.
9. `GET /api/harness/runs/{runId}/capsules` → expect `200`; note `cap_test_gate_1`.
10. `GET /api/harness/runs/{runId}/trace` → expect `200`.
11. `POST /api/harness/runs/{runId}/repair` — body: `{"capsuleId":"cap_test_gate_1","note":"Limiter window was 1s not 60s; rerun gate"}` → expect `200`.
12. `GET /api/harness/runs/{runId}/events` with the newest `Last-Event-ID` → expect `200` SSE through to a second gate.
13. `GET /api/harness/runs/{runId}` → expect `200`, `run.pendingApprovalKind:"verification"`.
14. `POST /api/harness/runs/{runId}/approve` — body: `{"kind":"verification","approved":true,"note":"Test now proves the 60s window"}` → expect `200`.
15. `GET /api/harness/runs/{runId}` → expect `200`, `run.status:"succeeded"`, `run.goNoGo:"go"`, `run.finalReportArtifactId` set.
16. `GET /api/harness/runs/{runId}/artifacts` → expect `200`.
17. `GET /api/harness/artifacts/{finalReportArtifactId}?runId={runId}` → expect `200`.
18. `GET /api/harness/runs/{runId}/audit` → expect `200`.
19. `GET /api/harness/runs/{runId}/trace/export-plan` → expect `200`.

### Variations
- Abandon mid-flight at step 12 with `POST /api/harness/runs/{runId}/cancel` `{"reason":"Requirements changed"}` → `200`, then step 13 shows `cancellation_requested`.
- Skip step 3 and start at `POST /api/harness/runs` with an explicit `latestUserMessageId` for a scripted, deterministic run.
- Re-run the whole flow with `"mode":"investigation"` to get a read-only variant that produces a report but no code gates.

### Edge Cases
- Sending a *second* `POST /api/chat` while the first stream is live → **409** "Another workflow is already running for this chat".
- Approving `"kind":"verification"` at step 7 (before it is pending) → **400** "Approval kind is not pending for this run".
- Repairing at step 11 with `{}` → **400** "Repair requires a failure capsule or approval kind".
- Any step after `HARNESS_ENABLED` is flipped off mid-run → **503** `harness_disabled`, including the SSE route.
- Session deleted mid-run, then `GET /api/harness/runs?sessionId=...` → **404** "Session not found"; but `GET /api/harness/runs/{runId}` still works because it looks the run up directly by owner. Inconsistent reachability for the same record.
- Cookie dropped on any step → **401**.

---

## Cross-story redundancy notes

1. **Two ways to start a run**: `POST /api/harness/runs` (explicit, `202 {run}`) and `POST /api/chat` (implicit via `classifyVerifiedBuildTask`, `200` SSE + `x-verified-build-run-id` header). Same DB record, different contracts.
2. **Three ways to read run events**: SSE `/events`, `GET /api/harness/runs/{runId}` (`events[]`), `GET /api/harness/runs?sessionId&chatId` (`events[]` for the latest run).
3. **Two ways to read the run snapshot**: by id and by session+chat. The by-id path survives session deletion; the by-session path does not.
4. **Pending approval kind appears three times in one payload**: `run.pendingApprovalKind`, `harnessRun.pending_approvals[]`, `harnessRun.pending_approval_details[].approval_kind` — and `collectPendingApprovalKinds` unions all three, so they are known to disagree.
5. **Two routes act on an approval gate**: `/approve` (validated against pending kinds) and `/repair` with `approvalKind` (not validated).
6. **Artifact data from two routes**: `/runs/{runId}/artifacts` and `/artifacts/{artifactId}?runId=`.
7. **"Feature is off" has three status codes**: `200 {enabled:false}` (ready), `404 product_surface_disabled` (POST runs), `503 harness_disabled` (everything run-scoped).
8. **State conflicts return 400, not 409** — the not-pending approval check is the clearest example.
