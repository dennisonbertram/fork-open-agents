# Chat Streaming Audit Scratchpad

## Files Read
- [x] `docs/agents/lessons-learned.md` (full, lines 100-121 for chat/streaming domain)
- [x] `apps/web/app/api/chat/route.ts` (POST handler, 486 lines)
- [x] `apps/web/app/api/chat/[chatId]/stream/route.ts` (GET reconnect endpoint, 66 lines)
- [x] `apps/web/app/api/chat/[chatId]/stop/route.ts` (POST stop endpoint, 119 lines)
- [x] `apps/web/app/api/chat/_lib/chat-context.ts` (authz + owner checks, 174 lines)
- [x] `apps/web/app/api/chat/_lib/persist-tool-results.ts` (tool result persistence, 62 lines)
- [x] `apps/web/app/api/chat/_lib/request.ts` (body parsing, 113 lines)
- [x] `apps/web/app/api/chat/_lib/runtime.ts` (legacy, dead code — not imported anywhere)
- [x] `apps/web/app/workflows/chat.ts` (main workflow, 2863 lines)
- [x] `apps/web/app/workflows/chat-post-finish.ts` (persist, clear, usage, 600 lines)
- [x] `apps/web/lib/chat-streaming-state.ts` (client streaming state helpers, 260 lines)
- [x] `apps/web/lib/chat-instance-manager.ts` (client Chat instance map, 70 lines)
- [x] `apps/web/lib/abortable-chat-transport.ts` (AbortableChatTransport, 54 lines)
- [x] `apps/web/lib/chat-auto-commit.ts` (client-side auto-commit, 113 lines)
- [x] `apps/web/lib/chat-route-cleanup.ts` (route teardown cleanup, 33 lines)
- [x] `apps/web/lib/chat/create-cancelable-readable-stream.ts` (stream cancel wrapper, 91 lines)
- [x] `apps/web/lib/chat/dedupe-message-reasoning.ts` (reasoning dedup, 74 lines)
- [x] `apps/web/lib/chat/sanitize-interrupted-tool-calls.ts` (tool call sanitizer, 87 lines)
- [x] `apps/web/lib/db/sessions.ts` (activeStreamId operations: claim, CAS, unconditional update; lines 440-510, 640-818)
- [x] `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts` (DELETE, 72 lines)

## Key Architecture Understanding

### activeStreamId lifecycle
1. **POST /api/chat** (route.ts): If chat has existing activeStreamId, reconcile it first (reconnect or clear stale). Then start workflow via `start(runAgentWorkflow, ...)`. Then claim activeStreamId via `claimChatActiveStreamId` (idempotent, CAS-based). If claim fails, cancel the workflow and return 409. Return streaming response.
2. **Workflow first step** (chat.ts): call `claimActiveStream` which uses `claimChatActiveStreamId` — idempotent with the handler's claim. If conflict, exit gracefully.
3. **Workflow teardown** (chat-post-finish.ts): `clearActiveStream` uses `compareAndSetChatActiveStreamId(chatId, workflowRunId, null)` — CAS from this workflow's runId to null, with 3 retries.
4. **GET /api/chat/[chatId]/stream** (reconnect): reads activeStreamId from DB, checks workflow status. If terminal, clears to null. If running, returns stream.
5. **POST /api/chat/[chatId]/stop**: persists snapshot, cancels workflow, CAS-clears activeStreamId.
6. **DELETE messages**: checks if activeStreamId points to running workflow; if not, clears it before deleting.

### CAS vs Unconditional Update Gap
The codebase has THREE variants for updating activeStreamId:
- `compareAndSetChatActiveStreamId(chatId, expected, next)` — atomic CAS via WHERE clause. Used in: reconcile function, workflow clear, stop route.
- `claimChatActiveStreamId(chatId, runId)` — atomic claim via `WHERE (null OR eq(runId))`. Used in: POST handler, workflow self-claim.
- `updateChatActiveStreamId(chatId, streamId)` — UNCONDITIONAL set to any value. Used in: stream GET route, messages DELETE route. **PROBLEMATIC**.

### Persistence Flow
- **Request start** (route.ts lines 164-167): `persistLatestUserMessage` + `persistAssistantMessagesWithToolResults` — both read from client-provided messages, handle different latest-message roles. Best-effort, non-blocking.
- **Workflow first step** (chat.ts lines 1389-1392, 486-500): `persistUserMessage` + `persistAssistantMessageWithToolResults` — server-side re-persist for durability if the handler's persist was lost.
- **Workflow completion** (chat.ts lines 1720-1725): `persistAssistantMessage` + `persistSandboxState` — persists completed assistant response.
- **Auto-commit/PR data parts** (chat.ts line 1968): additional persist if git data parts were appended.
- **Runtime proof part** (chat.ts line 2003): additional persist if managed runtime data was appended.

### Lessons Applied (Verified In-Place)
- LL-2 (tool-result persistence): `persistAssistantMessagesWithToolResults` called at request start AND workflow first step. Both use `upsertChatMessageScoped`. CONFIRMED IN PLACE.
- LL-3 (scope-guarded upserts): `upsertChatMessageScoped` checks chatId + role in update WHERE clause. CONFIRMED IN PLACE.
- LL-4 (no pre-registration placeholder): POST handler claims with real run.runId AFTER start(). Workflow self-claims with real workflowRunId from metadata. CONFIRMED IN PLACE.
- LL-5 (server-side auto-commit): auto-commit/PR logic runs inside workflow (chat.ts lines 1740-1965). CONFIRMED IN PLACE.

## Candidate Defects Considered and Rejected
1. **TOCTOU between reconcileExistingActiveStream and start()**: The `claimChatActiveStreamId` at line 351 catches this — if another request claimed the slot between reconcile returning "ready" and the claim call, the claim fails and the handler cancels the workflow. REJECTED — properly handled.
2. **Double workflow start on concurrent POSTs**: reconcileExistingActiveStream detects the first workflow is running and resumes it. REJECTED — properly handled.
3. **activeStreamId not set when handler crashes before claim**: The workflow self-claims as its first step. REJECTED — handled by workflow self-claim.
4. **persistAssistantSnapshot in stop route overwriting server content**: Uses `createChatMessageIfNotExists` (insert-only). If workflow later persists, `upsertChatMessageScoped` updates with fuller content. REJECTED — insert-only design avoids overwrite.
5. **persistLatestUserMessage not scope-guarded**: Uses `createChatMessageIfNotExists` with explicit `chatId` passed. Since UUIDs are unique, cross-chat collision is impossible. REJECTED — UUIDs prevent collision.

## Coverage Gaps
- Client-side chat hooks and components (out of scope — server-side audit only)
- The `_lib/runtime.ts` file is dead code (not imported anywhere)
- The `chat-sandbox-runtime.ts` workflow module (out of scope — sandbox lifecycle, not chat streaming)
- Message rendering and UI components
