# Chat API & Streaming Wire Protocol — Ground Truth for the iOS Client

Research brief for the native iOS app plan. All paths are relative to repo root
`/Users/dennison/develop/open-agents` unless absolute. Citations are `path:line`.
Current as of branch `feat/agents-phase6-authored-tools`, June 2026.

---

## 0. TL;DR for the plan author

- The streaming protocol is the **Vercel AI SDK v6 "UI Message Stream"** — plain **SSE**
  (`text/event-stream`), one JSON chunk per `data:` line, terminated by `data: [DONE]`.
  Installed `ai` package version: **6.0.168** (catalog pin `^6.0.165`,
  `package.json:10`); client uses `@ai-sdk/react` `^3.0.167`.
- POST `/api/chat` does **not** stream from the model directly. It starts a **durable
  Vercel Workflow** (`workflow` package v4.2.4, `apps/web/package.json:79`) and pipes the
  workflow run's readable stream back as the HTTP response. The run id is returned in the
  **`x-workflow-run-id`** response header and stored on the chat row as
  `chats.active_stream_id`.
- Streams are **resumable**: `GET /api/chat/{chatId}/stream` re-attaches to the running
  workflow and **replays every chunk from the beginning** (no `startIndex` is used —
  `apps/web/app/api/chat/[chatId]/stream/route.ts:56-60`), then continues live. `204 No
  Content` means "nothing to resume".
- A chat turn requires the client to POST the **entire UIMessage history** each time
  (like `useChat` does). Server persists the latest user message and re-converts the full
  history to model messages every turn.
- Messages are persisted as **whole `UIMessage` JSON objects** (id/role/parts/metadata) in
  the `chat_messages.parts` jsonb column; `GET .../chats/{chatId}` returns
  `messages.map(row => row.parts)` — i.e., the wire shape **is** the persisted shape
  (`apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.ts:71`).
- Two interactive behaviors the iOS client MUST implement to be functional:
  1. **`ask_user_question` client-side tool** — the workflow pauses with the tool part in
     `input-available`; the client supplies the output locally and re-POSTs `/api/chat`
     with the assistant message (now containing the tool output) as the last message.
  2. **Auto-resubmit after tool results** — replicate `shouldAutoSubmit`
     (`apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-chat-runtime.ts:57-90`).
- Auth for every route below is the **better-auth session cookie** (Vercel OAuth sign-in);
  there is no token/Bearer API auth today. `getServerSession`
  (`apps/web/lib/session/get-server-session.ts:17-47`) also honors a test-auth cookie when
  `OPEN_AGENTS_ENABLE_TEST_AUTH` is set. **An iOS app must either hold the better-auth
  cookie or a new auth mechanism must be built.** (Open question §10.)

---

## 1. Data model: session → chats → messages

- `sessions` table (`apps/web/lib/db/schema.ts:257-343`): owns repo info
  (`repoOwner/repoName/branch/cloneUrl`), `sandboxState` jsonb (null = "sandbox-free"
  plain chat session), `runtimeMode` (`classic` | `managed_runtime`), lifecycle fields,
  `status` (`running|completed|failed|archived`), PR info, cached diff.
- `chats` table (`apps/web/lib/db/schema.ts:345-368`): `id`, `sessionId` (FK, cascade),
  `title`, `modelId` (default `anthropic/claude-haiku-4.5`), `inferenceProfileId`,
  `composioSelection` jsonb, **`activeStreamId`** (workflow run id while streaming),
  `lastAssistantMessageAt`, timestamps.
- `chat_messages` table (`apps/web/lib/db/schema.ts:744-755`): `id` (PK, message id),
  `chatId` (FK cascade), `role` (`user` | `assistant` — **no system/tool rows**),
  `parts` jsonb = the **full UIMessage object**, `createdAt`. Ordered by
  `createdAt, id` (`apps/web/lib/db/sessions.ts:731-736`).
- `shares` (`schema.ts:731-742`): one share id per chat (unique on chatId).
- `chat_reads` (`schema.ts:757-774`): per-user unread tracking (PK userId+chatId).

Creating a session (`POST /api/sessions`,
`apps/web/app/api/sessions/route.ts:171-430`) **always creates an initial chat** via
`createSessionWithInitialChat` (`route.ts:369-410`); a chat is never orphaned. Creating
additional chats happens via `POST /api/sessions/{sessionId}/chats`.

Session creation request (plain TS interface, not Zod —
`apps/web/app/api/sessions/route.ts:34-46`):

```ts
{ title?, repoOwner?, repoName?, branch?, cloneUrl?, isNewBranch?,
  sandboxType?: "vercel", managedRuntimeProfileId?, autoCommitPush?,
  autoCreatePr?, vercelProject?: VercelProjectSelection | null }
```

Notable: omitting repoOwner/repoName creates a **sandbox-free** session
(`sandboxState: null`, `route.ts:394-395`) where the agent only has chat-safe tools.
Rate limit: 10/min per user (`route.ts:182-189`). Errors: 401, 403 (bot or Vercel token),
400 (validation; many specific messages), 500.

---

## 2. Route-by-route reference

All JSON error bodies are `{ "error": string }` unless noted. Auth = better-auth session
cookie; 401 `{"error":"Not authenticated"}` when missing
(`apps/web/app/api/chat/_lib/chat-context.ts:73-88`). Ownership checks return
404 `Session not found` / 403 `Forbidden` (or custom message) / 404 `Chat not found`
(`chat-context.ts:90-141`).

### 2.1 `POST /api/chat` — start (or resume) an agent turn

File: `apps/web/app/api/chat/route.ts:88-378`.

**Request body** (plain interface cast, **no Zod validation** —
`apps/web/app/api/chat/_lib/request.ts:3-35`):

```jsonc
{
  // What DefaultChatTransport sends automatically:
  "id": "<chatId>",                  // ignored by server
  "messages": [ /* FULL UIMessage[] history, see §5 */ ],
  "trigger": "submit-message",       // ignored by server
  "messageId": "...",                // ignored by server
  // Injected by the web client's transport body() fn (use-session-chat-runtime.ts:117-130):
  "sessionId": "<sessionId>",        // REQUIRED
  "chatId": "<chatId>",              // REQUIRED
  "context": { "contextLimit": 200000 },  // sent by web client but NOT read server-side
  // Named-workflow runs only (#46):
  "workflowId": "...", "inputValues": {...}, "workflowSchema": {...}, "workflowSchemaVersion": "..."
}
```

**Flow** (`route.ts:88-378`):
1. 401 if unauthenticated; 403 `{"error":"Access denied"}` if BotID says bot
   (`route.ts:97-100`).
2. 400 `Invalid JSON body`; 400 `sessionId and chatId are required`
   (`request.ts:72-90`).
3. Ownership check → 404/403/404. 400 `Session is archived` (`route.ts:136-138`).
4. **Reconnect guard**: if `chat.activeStreamId` points to a `running|pending` workflow,
   the POST does NOT start a new run — it returns the **existing** run's stream
   (full replay) with `x-workflow-run-id` header (`route.ts:143-162`, resolution logic
   `route.ts:395-437`). If the slot is contested: **409**
   `{"error":"Another workflow is already running for this chat"}`.
5. Persists the latest user message (insert-only, sets chat title from first message,
   truncated at 80 chars — `route.ts:439-485`) and any assistant message carrying
   client-side tool results (`_lib/persist-tool-results.ts:19-62`).
6. **Verified-build classifier** may divert the turn (`route.ts:170-237`): instead of the
   agent workflow it starts a harness run and returns a short synthetic stream (see §4.6)
   with headers `x-verified-build-run-id` and `x-request-id`; failure → **502**
   `{"error":"Verified Build could not be started","requestId"}`.
7. Named workflows: validation gate → **422**
   `{"error":"Workflow input validation failed","errorKind":"workflow_input_invalid","fieldErrors":{...}}`,
   **403** `workflow_input_unauthorized`, **409** `workflow_version_mismatch`
   (`route.ts:259-304`).
8. Starts the durable workflow `runAgentWorkflow` with `maxSteps: 500`
   (`route.ts:307-318`), claims `activeStreamId` (409 on conflict, `route.ts:351-365`),
   and returns the SSE response with headers `x-workflow-run-id`, `x-request-id`
   (`route.ts:367-377`).

**Response**: `200` SSE stream (§3/§4). Honors inbound `x-request-id` if it matches
`/^[A-Za-z0-9._:/=-]{8,128}$/` (`apps/web/lib/harness/request-id.ts:1-16`).

### 2.2 `GET /api/chat/{chatId}/stream` — resume

File: `apps/web/app/api/chat/[chatId]/stream/route.ts:17-66`. Auth errors here are
**plain text**, not JSON (`format: "text"`, line 18).

- `204 No Content` when `chat.activeStreamId` is null, when the run is
  `completed|cancelled|failed` (clears the stale id), or when the run lookup throws.
- Otherwise `200` SSE: `run.getReadable()` with **no `startIndex`** — the client receives
  a **full replay of all chunks emitted so far**, then live chunks. (The workflow SDK
  supports `?startIndex=` + `x-workflow-stream-tail-index`; this app does not use it —
  potential iOS optimization, see §10.)
- This is the endpoint the web client wires into
  `prepareReconnectToStreamRequest: ({id}) => ({api: \`/api/chat/${id}/stream\`})`
  where `id` = chatId (`use-session-chat-runtime.ts:131-133`).

### 2.3 `POST /api/chat/{chatId}/stop`

File: `apps/web/app/api/chat/[chatId]/stop/route.ts:17-119`.

- Body (optional): `{ "assistantMessage": <UIMessage with role:"assistant"> }` — a
  client snapshot of the in-progress assistant message, persisted **insert-only** before
  cancellation so mid-step output is not lost (`route.ts:39-48,81-97`).
- Cancels the workflow run (`run.cancel()`), CAS-clears `activeStreamId`.
- Responses: `200 {"success":true}` (also when there was nothing to stop);
  `500 {"error":"Failed to cancel workflow run"}`.
- Server-side: each agent step runs a stop monitor polling run status every 150 ms; on
  `cancelled` it aborts the in-flight model stream (`apps/web/app/workflows/chat.ts:2510-2546`).
  **No `abort` chunk is ever emitted**; the stream just ends (client notices fetch abort
  or stream close). The web client also calls `chatInstance.stop()` + aborts its own
  fetches via a custom `AbortableChatTransport`
  (`apps/web/lib/abortable-chat-transport.ts:19-54`,
  `use-session-chat-runtime.ts:161-179`).

### 2.4 `GET|POST /api/sessions/{sessionId}/chats`

File: `apps/web/app/api/sessions/[sessionId]/chats/route.ts`.

- **GET** → `200 { chats: ChatSummary[], defaultModelId: string }` where `ChatSummary` =
  full chat row + `hasUnread: boolean` + `isStreaming: boolean` (computed
  `activeStreamId IS NOT NULL`) (`apps/web/lib/db/sessions.ts:365-408`).
- **POST** body `{ id?: string }` (client may supply the chat id; idempotent). Existing id
  in the same session → `200 { chat }` (existing row); id used by another session →
  `409 {"error":"Chat ID conflict"}`; otherwise creates with title `"New chat"`, the
  user's `defaultModelId`, session/preference inference profile, and Composio defaults
  → `200 { chat }` (`route.ts:41-113`).

### 2.5 `GET|PATCH|DELETE /api/sessions/{sessionId}/chats/{chatId}`

File: `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.ts`.

- **GET** → `ChatRefreshResponse` (`route.ts:30-73`):

```jsonc
{
  "chat": { "id", "modelId", "inferenceProfileId", "composioSelection", "activeStreamId" },
  "isStreaming": true,            // activeStreamId !== null
  "messages": [ /* UIMessage[] — row.parts verbatim, ordered createdAt,id */ ]
}
```

- **PATCH** body `{ title?, modelId?, inferenceProfileId?: string|null, composioSelection? }`
  → `200 { chat }`. Errors: 400 `Invalid JSON body` / `At least one field is required` /
  `Invalid composioSelection` / Composio-policy message / `Invalid inferenceProfileId` /
  `User inference profiles currently support Anthropic models only`;
  404 `Inference profile not found`; 404 `Chat not found` (`route.ts:75-216`).
- **DELETE** → `200 {"success":true}`; 400
  `{"error":"Cannot delete the only chat in a session"}` (`route.ts:218-245`).

### 2.6 `POST /api/sessions/{sessionId}/chats/{chatId}/messages`

File: `.../messages/route.ts:32-83`. Persist an **assistant** message snapshot
(used for client-side tool results when not going through POST /api/chat). Body
`{ message: UIMessage }` with `role:"assistant"`. Responses: `200
{"success":true,"status":"inserted"|"updated"}`; 400 invalid; **409**
`{"error":"Message ID already belongs to a different chat or role"}` (scoped upsert,
`apps/web/lib/db/sessions.ts:682-714`).

### 2.7 `DELETE /api/sessions/{sessionId}/chats/{chatId}/messages/{messageId}`

File: `.../messages/[messageId]/route.ts:15-72`. Deletes a **user** message and everything
after it (regenerate/edit flows). Responses: `200 {"success":true,
"deletedMessageIds": string[]}`; **409**
`{"error":"Cannot delete messages while a response is streaming"}` (only if run is
actually `running|pending`; stale ids are auto-cleared); 404 `Message not found`;
400 `Only user messages can be deleted`.

### 2.8 `POST /api/sessions/{sessionId}/chats/{chatId}/fork`

File: `.../fork/route.ts:20-93`. Body `{ messageId: string, id?: string }`.
`messageId` must be an **assistant** message; copies all messages up to and including it
into a new chat (new random message UUIDs, `id` patched inside the cloned UIMessage JSON
— `apps/web/lib/db/sessions.ts:552-633`), titled `Fork of <source title>`, inheriting
modelId/inferenceProfileId/composioSelection, and marks it read. Responses:
`200 { chat }`; 400 `A messageId is required` / `Invalid chat id`;
409 `Chat ID conflict`; 404 `Message not found`; 400 `Only assistant messages can be forked`.

### 2.9 `POST /api/sessions/{sessionId}/chats/{chatId}/read`

File: `.../read/route.ts:11-30`. No body. Upserts `chat_reads.lastReadAt = now` →
`200 {"success":true}`.

### 2.10 `GET|POST|DELETE /api/sessions/{sessionId}/chats/{chatId}/share`

File: `.../share/route.ts`. GET → `200 { shareId: string|null }`. POST → creates (or
returns existing) 12-char nanoid → `200 { shareId }`, 500 on race failure. DELETE →
`200 {"success":true}`. Public consumption: page `/shared/{shareId}`
(`apps/web/app/shared/[shareId]/page.tsx`), plus unauthenticated APIs
`GET /api/shared/{shareId}/markdown` and `GET /api/shared/{shareId}/status`.

### 2.11 `GET|POST /api/sessions/{sessionId}/chats/{chatId}/debug-bundle`

File: `.../debug-bundle/route.ts:109-174`. GET returns a diagnostic bundle (JSON, or
markdown with `?format=markdown` / `Accept: text/markdown`); `?eventLimit=` bounded 1-500
(default 200). Alternative auth: signed `?token=` (401 `Invalid or expired diagnostic
token`). POST body `{ ttlMinutes?: number }` (1–1440, default 60) → `200 { url, token,
expiresAt, redaction: {...} }`.

### 2.12 `POST /api/generate-title`

File: `apps/web/app/api/generate-title/route.ts:43-91`. Zod:
`z.object({ message: z.string().trim().min(1) })` (`route.ts:39-41`). Generates a ≤5-word
session title with `anthropic/claude-haiku-4.5` via gateway. Responses: `200 { title }`
(≤60 chars); 401; 403 bot; 429 (rate limit 10/min); 400; 500
`{"error":"Failed to generate title"}`. NOTE: **chat** titles are set automatically from
the first user message (80-char truncation) inside POST /api/chat
(`apps/web/app/api/chat/route.ts:462-481`); this endpoint is for **session** titles.

### 2.13 `POST /api/transcribe`

File: `apps/web/app/api/transcribe/route.ts:12-81`. Body
`{ audio: string /* base64 */, mimeType?: string /* unused */ }`. ElevenLabs `scribe_v1`
via `experimental_transcribe` (English-hinted, single speaker). Responses: `200 { text }`;
401; 403; 429 (5/min); 400 `Missing required field: audio`; **413** if base64 > 10 MiB;
500 `{"error":"Transcription failed"}`.

---

## 3. The SSE wire format (exact)

Producer: `createUIMessageStreamResponse` (ai 6.0.168 —
`apps/web/node_modules/ai/dist/index.js:5081-5125`).

**Response headers** (`index.js:5097-5104`):

```
content-type: text/event-stream
cache-control: no-cache
connection: keep-alive
x-vercel-ai-ui-message-stream: v1
x-accel-buffering: no
x-workflow-run-id: <runId>        ← app-specific, POST /api/chat & resume-via-POST only
x-request-id: <id>                ← app-specific
```

**Body**: each chunk is one SSE event, `data: <compact JSON>` followed by a blank line;
the stream ends with the literal terminator (`index.js:5085-5093`):

```
data: {"type":"start","messageId":"abc123"}

data: {"type":"text-delta","id":"abc123:text","delta":"Hello"}

data: [DONE]

```

There are **no SSE `event:`/`id:` fields** — only `data:` lines. An iOS client needs a
plain SSE parser + JSON decoding per line, switching on `chunk.type`.

---

## 4. Stream chunk vocabulary (what the server actually sends)

Authoritative chunk schema: `uiMessageChunkSchema` in ai 6.0.168
(`apps/web/node_modules/ai/dist/index.js:5146-5310`). All chunks the iOS client can
receive, with fields (optional marked `?`):

| type | fields |
|---|---|
| `start` | `messageId?`, `messageMetadata?` |
| `start-step` | — |
| `text-start` | `id`, `providerMetadata?` |
| `text-delta` | `id`, `delta`, `providerMetadata?` |
| `text-end` | `id`, `providerMetadata?` |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | `id`, (`delta`), `providerMetadata?` |
| `tool-input-start` | `toolCallId`, `toolName`, `providerExecuted?`, `dynamic?`, `title?` |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` |
| `tool-input-available` | `toolCallId`, `toolName`, `input`, `providerExecuted?`, `dynamic?`, `title?` |
| `tool-input-error` | `toolCallId`, `toolName`, `input`, `errorText`, … |
| `tool-approval-request` | `approvalId`, `toolCallId` |
| `tool-output-available` | `toolCallId`, `output`, `preliminary?`, `dynamic?`, … |
| `tool-output-error` | `toolCallId`, `errorText`, … |
| `tool-output-denied` | `toolCallId` |
| `source-url` | `sourceId`, `url`, `title?` |
| `source-document` | `sourceId`, `mediaType`, `title`, `filename?` |
| `file` | `url`, `mediaType` |
| `data-*` | `id?`, `data`, `transient?` (any `type` starting with `data-`) |
| `message-metadata` | `messageMetadata` |
| `finish-step` | — |
| `finish` | `finishReason?` (`stop\|length\|content-filter\|tool-calls\|error\|other`), `messageMetadata?` |
| `error` | `errorText` |
| `abort` | `reason?` (defined by SDK; **never emitted by this app**) |

### 4.1 Lifecycle of a normal agent turn

Chunks are produced by the durable workflow `runAgentWorkflow`
(`apps/web/app/workflows/chat.ts:1161-2009`) and written to the run's writable:

1. `{"type":"start","messageId":"<assistantId>"}` — sent once by the first workflow step
   (`apps/web/app/workflows/chat-sandbox-runtime.ts:217-224`, called at `:679`).
   `assistantId` = `generateId()` (or the id of the trailing assistant message when
   resuming a tool loop, `chat.ts:1228-1229`). **All step output accumulates into this
   single assistant message.**
2. Zero or more transient workspace-status data chunks while the sandbox boots
   (`chat-sandbox-runtime.ts:203-215`):
   ```json
   {"type":"data-workspace-status","id":"workspace-status","transient":true,
    "data":{"status":"setting-up","message":"Starting the sandbox...","title":"Preparing sandbox workspace","logLines":["Session: ..."],"logUpdatedAt":"2026-06-09T..."}}
   ```
   `transient: true` ⇒ not added to message parts; surface in UI only (web routes it to a
   status store via `onData`, `use-session-chat-runtime.ts:144-148`).
3. Per agent step (loop at `chat.ts:1450-1537`), the model stream is forwarded via
   `result.toUIMessageStream({ sendStart:false, sendFinish:false, ... })`
   (`chat.ts:2204-2259`) — so each step contributes `start-step`, then
   text/reasoning/tool chunks, then `message-metadata` (emitted with the metadata
   returned by the `messageMetadata` callback on `finish-step`, `chat.ts:2214-2251`),
   then `finish-step`. Multi-step turns therefore contain multiple
   `start-step`/`finish-step` pairs **inside one message** (rendered as `step-start`
   parts, §5).
4. Post-finish data parts (non-transient, persisted; each has a stable id):
   - `data-commit` id `<assistantId>:commit` — first `{"data":{"status":"pending"}}`,
     then resolved (`chat.ts:1591-1600,1625-1629`); data shape `WebAgentCommitData`
     (`apps/web/app/types.ts:41-49`).
   - `data-pr` id `<assistantId>:pr` — pending → resolved/skipped
     (`chat.ts:1686-1697,1722-1726,1767-1797`); shape `WebAgentPrData`
     (`types.ts:51-60`).
   - `data-runtime-proof` id `<assistantId>:runtime-proof` (managed-runtime sessions
     only, `chat.ts:1812-1839`); shape `WebAgentRuntimeProofData` (`types.ts:84-153`).
5. `{"type":"finish","finishReason":"stop"}` (always `"stop"`, even after abort/maxSteps —
   `chat-post-finish.ts:497-507`), then stream close → SSE `data: [DONE]`.

### 4.2 Error signaling in-stream

- Model/stream errors inside a step surface as `{"type":"error","errorText":"<message>"}`
  via the `onError` mapping (`chat.ts:2209-2213`). The AI SDK client treats this as a
  chat-level error state.
- Setup failures (sandbox, auth, model resolution, decrypt errors…) before any output:
  the workflow synthesizes a plain-text assistant reply — `text-start`/`text-delta`/
  `text-end` with id `"setup-error"` and a user-facing message
  (`chat.ts:1853-1861, 2558-2568`; message mapping `chat.ts:502-562`), persists it, then
  `finish`. So setup errors look like a normal short assistant message.
- HTTP-level errors only occur before the stream starts (status codes in §2.1).

### 4.3 Tool-call chunk sequence (example, `bash`)

```
data: {"type":"tool-input-start","toolCallId":"call_1","toolName":"bash"}
data: {"type":"tool-input-delta","toolCallId":"call_1","inputTextDelta":"{\"command\":\"ls"}
data: {"type":"tool-input-delta","toolCallId":"call_1","inputTextDelta":" -la\"}"}
data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"bash","input":{"command":"ls -la"}}
data: {"type":"tool-output-available","toolCallId":"call_1","output":{...}}
```

The `task` tool (subagents) is an async-generator tool: it **yields** progress objects,
producing repeated `tool-output-available` chunks with `preliminary: true` and a final one
without it. Output shape (`packages/agent/tools/task.ts:60-68`):
`{ pending?: {name,input}, toolCallCount?, startedAt?, modelId?, runtime?: {mode:"managed_runtime", workerType, profileId?...}, final?: ModelMessage[], usage? }`.

Composio tools (added per-step, `chat.ts:2114-2200`) stream with `dynamic: true` and
arbitrary `toolName`s → they become `dynamic-tool` parts client-side.

### 4.4 Resume replay semantics

`run.getReadable()` (both in POST-reconnect and GET /stream) replays the workflow's
entire chunk history from index 0, then continues. The AI SDK reconstructs message state
by reprocessing chunks; an iOS client must do the same (idempotent application keyed on
part ids/toolCallIds), or track its own high-water mark. The chat is "done" when `finish`
+ `[DONE]` arrive or the GET returns 204.

### 4.5 What the web client does (reference behavior)

`use-session-chat-runtime.ts`:
- `useChat` + `DefaultChatTransport` subclass; POST body augmentation (§2.1); reconnect
  endpoint mapping (§2.2); 75 ms UI update throttle (`:29,195`).
- `resume: true` on mount when SSR said `activeStreamId != null` (`:185-196`).
- **Resume probing**: if mounted without a known active stream but the last message is a
  user message, probe `GET /stream` at 0 / 1 s / 2.5 s / 5.5 s / 10 s (`:296-354`) —
  covers the race where the workflow self-claims `activeStreamId` slightly after POST.
- Auto-resubmit (`sendAutomaticallyWhen`) when all non-provider-executed tool parts in the
  last step are terminal (`output-available` / `output-error` / `approval-responded`)
  (`:57-90`). The workflow deliberately **stops looping** when a tool part is left in
  `input-available` or `approval-requested` (`shouldPauseForToolInteraction`,
  `apps/web/app/workflows/chat.ts:109-114`) — the client supplies the result and re-POSTs.

### 4.6 Verified-build synthetic stream (POST /api/chat divert path)

`apps/web/app/api/chat/route.ts:52-86` — exact chunks:

```
data: {"type":"start","messageId":"<uuid>"}
data: {"type":"data-verified-build","id":"<uuid>:verified-build","data":{"status":"...","runId":"...","harnessRunId":"...","mode":"verified_build","reason":"...","requestId":"..."}}
data: {"type":"text-start","id":"<uuid>:text"}
data: {"type":"text-delta","id":"<uuid>:text","delta":"I'm routing this through Verified Build..."}
data: {"type":"text-end","id":"<uuid>:text"}
data: {"type":"finish","finishReason":"stop"}
data: [DONE]
```

---

## 5. The persisted/returned UIMessage shape (part type system)

A message (wire == DB) is:

```ts
type WebAgentUIMessage = {
  id: string;
  role: "system" | "user" | "assistant";   // DB only stores user/assistant
  metadata?: WebAgentMessageMetadata;       // §6
  parts: WebAgentUIMessagePart[];
}
```

(`apps/web/app/types.ts:167-171`; generic from ai 6.0.168
`apps/web/node_modules/ai/dist/index.d.ts:1660-1980`.)

**Part types**:

- `{ type: "text", text, state?: "streaming"|"done", providerMetadata? }`
- `{ type: "reasoning", text, state?, providerMetadata? }`
- `{ type: "step-start" }` — step boundary (from `start-step` chunks)
- `{ type: "file", mediaType, filename?, url }` — `url` may be a data URL; user messages
  with attachments carry these
- `{ type: "source-url" | "source-document", ... }`
- `{ type: "dynamic-tool", toolName, toolCallId, state, input, output?, errorText?, ... }`
  — Composio/runtime-registered tools
- `{ type: "tool-<NAME>", toolCallId, state, input, output?, errorText?, rawInput?,
   preliminary?, providerExecuted?, callProviderMetadata?, approval? }` for each static
  tool NAME (registry `packages/agent/open-agent.ts:119-132`):
  `todo_write, read, write, edit, grep, glob, bash, task, ask_user_question,
  setup_managed_runtime_profile, skill, web_fetch` — plus gated
  `propose_composio_tool` (`open-agent.ts:226-237`). Sandbox-free chats only use
  `todo_write, ask_user_question, skill, web_fetch` (`open-agent.ts:153-158`);
  managed-runtime coordinator uses `todo_write, task, ask_user_question,
  setup_managed_runtime_profile, skill, web_fetch` (`open-agent.ts:138-145`).
- `data-*` parts (typed map `WebAgentDataParts`, `apps/web/app/types.ts:155-162`):
  `data-commit`, `data-pr`, `data-snippet` (`{content, filename}` — attached by the web
  client to **user** messages for pasted code; converted to text for the model at
  `chat.ts:144-153`), `data-workspace-status` (transient only — never persisted),
  `data-verified-build`, `data-runtime-proof`.

**Tool part state machine** (ai 6.0.168, `index.d.ts:1790-1870`):

```
input-streaming → input-available → output-available
                                  ↘ output-error
input-available → approval-requested → approval-responded → output-available|output-denied
```

Fields per state: `input-streaming` has partial `input`; `input-available` has full
`input`; `output-available` adds `output` (+ `preliminary?: boolean` for generator
tools); `output-error` has `errorText` (+ `rawInput?`); approval states carry
`approval: { id, approved?, reason? }`. Terminal states the auto-submit logic accepts:
`output-available`, `output-error`, `approval-responded`.

**`ask_user_question` contract** (client-side tool — no `execute`,
`packages/agent/tools/ask-user-question.ts`):
- input: `{ questions: [{ question, header (≤12 chars), options: [{label, description}] (2-4), multiSelect }] (1-4) }`
- output the client must produce: `{ answers: Record<question, string | string[]> }` or
  `{ declined: true }`.
- Native flow: render UI, set the tool part to `output-available` with that output, then
  POST `/api/chat` with the full history whose **last message is the assistant message**
  containing the answered tool part. The server eagerly persists it
  (`persist-tool-results.ts:19-62`) and continues the loop (the workflow resumes with the
  same assistant message id, `chat.ts:1228-1254`).

**Reasoning dedupe**: persisted assistant messages run through `dedupeMessageReasoning`
(OpenAI `itemId`-keyed duplicate removal,
`apps/web/lib/chat/dedupe-message-reasoning.ts:38-74`) — replayed streams can briefly
show duplicates that disappear on refetch.

---

## 6. Message metadata

`WebAgentMessageMetadata` (`apps/web/app/types.ts:21-37`) — set on assistant messages,
streamed via `message-metadata` chunks at every `finish-step` and present in persisted
messages:

```ts
{
  selectedModelId?: string;        // UI-level selection id (may include variant/profile)
  modelId?: string;                // resolved gateway model id, e.g. "anthropic/claude-opus-4.6"
  inferenceRoute?: "gateway" | "user";
  inferenceProfileId?, inferenceProfileName?, inferenceProvider?: string;
  lastStepUsage?, totalMessageUsage?: LanguageModelUsage;  // {inputTokens, outputTokens, totalTokens, reasoningTokens?, cachedInputTokens?, inputTokenDetails?...}
  lastStepCost?, totalMessageCost?: number;  // USD, gateway-reported
  lastStepFinishReason?: FinishReason; lastStepRawFinishReason?: string;
  stepFinishReasons?: {finishReason, rawFinishReason?}[];
}
```

There are **no per-message timestamps in the message JSON** — `createdAt` lives on the DB
row and is *not* included in the GET messages response (only `row.parts` is returned).
Chat-level recency comes from `chats.updatedAt` / `lastAssistantMessageAt` via the chat
summaries endpoint. Model selection per turn comes from `chats.modelId` +
user preferences/inference profiles, resolved server-side
(`apps/web/app/workflows/chat.ts:163-345`,
`apps/web/app/api/chat/_lib/model-selection.ts:12-44`); the client never sends a model id
on POST /api/chat — change models via PATCH chat.

---

## 7. Concurrency & ownership invariants

- One active stream per chat, enforced by `chats.activeStreamId` CAS helpers
  (`apps/web/lib/db/sessions.ts:460-510`) + workflow first-step self-claim
  (`chat-post-finish.ts:294-327`). Duplicate POST → resume-or-409.
- Assistant message persistence is `upsertChatMessageScoped` — id collisions across
  chat/role return `conflict` and are dropped (`sessions.ts:682-714`).
- The workflow persists the assistant message: eagerly when tool results arrive, after
  the loop, after git data parts, and on stop (client snapshot, insert-only). On
  device-switch mid-stream another client can GET messages + GET /stream and converge.

---

## 8. Status-code matrix (chat-critical routes)

| Route | 200 | 204 | 4xx | 5xx |
|---|---|---|---|---|
| POST /api/chat | SSE | — | 400 json/ids/archived, 401, 403 bot/owner, 404 session/chat, 409 dup-workflow / wf-version, 422 wf-input | 502 verified-build |
| GET /api/chat/{id}/stream | SSE replay | no active stream | 401/403/404 (plain text) | — |
| POST /api/chat/{id}/stop | `{success:true}` | — | 401, 403, 404 | 500 cancel failed |
| GET sessions/{s}/chats | json | — | 401, 403, 404 | — |
| POST sessions/{s}/chats | `{chat}` | — | 400 id, 401, 403, 404, 409 conflict | — |
| GET chats/{c} | refresh json | — | 401, 403, 404 | — |
| PATCH chats/{c} | `{chat}` | — | 400 (several), 401, 403, 404 | — |
| DELETE chats/{c} | `{success}` | — | 400 last-chat, 401, 403, 404 | — |
| POST …/messages | `{success,status}` | — | 400, 401, 403, 404, 409 scope | — |
| DELETE …/messages/{m} | `{success,deletedMessageIds}` | — | 400 not-user, 401, 403, 404, 409 streaming | — |
| POST …/fork | `{chat}` | — | 400, 401, 403, 404, 409 | — |
| POST …/read | `{success}` | — | 401, 403, 404 | — |
| share GET/POST/DELETE | json | — | 401, 403, 404 | 500 |
| POST /api/generate-title | `{title}` | — | 400, 401, 403, 429 | 500 |
| POST /api/transcribe | `{text}` | — | 400, 401, 403, 413, 429 | 500 |

---

## 9. iOS-specific implementation notes

1. **SSE client**: `URLSession` with a streaming delegate (or `URLSession.bytes(for:)`)
   parsing `data:` lines; decode each as JSON; switch on `type`. Strict-decoding is risky:
   tolerate unknown chunk types and unknown `data-*`/`tool-*` names (forward
   compatibility — the schema uses open `data-*` typing).
2. **Long streams**: workflows can run many minutes (maxSteps 500). iOS will kill the
   socket on backgrounding; the resume path (GET /stream full replay, or POST resume)
   is the designed recovery. Replays are idempotent if you key parts by
   id/toolCallId and text/reasoning segments by their `id`.
3. **Stop**: replicate the web's order — POST stop with the assistant snapshot (so partial
   output persists), cancel the local fetch, and suppress auto-resume until next send
   (`userStoppedRef` pattern, `use-session-chat-runtime.ts:156-179, 208-247`). The
   comments explicitly mention an iOS-Safari "tap stop 3 times" bug this prevents.
4. **History echo**: each POST must include the full UIMessage history (the server
   converts and prunes; it persists only the latest user message + tool-result assistant
   snapshots). Keep client message ids stable (server insert-only logic depends on it).
5. **Rendering scope**: text, reasoning (collapsible), step boundaries, 12+ static tool
   parts, dynamic tools, 5 persisted data-part types, file parts, and the
   `ask_user_question` interactive form are all required to faithfully render existing
   history fetched from GET messages.

---

## 10. Open questions / risks

1. **Auth for native**: every chat route requires the better-auth browser session cookie
   (`apps/web/lib/session/get-server-session.ts`). No PAT/Bearer support exists. The iOS
   plan must decide: embed the OAuth web flow + cookie storage in the app
   (ASWebAuthenticationSession → cookie jar), or build a token-based auth surface.
2. **No Zod on the chat body**: `parseChatRequestBody` is an unchecked cast
   (`_lib/request.ts:58-70`); malformed `messages` fail deep inside the workflow with a
   generic setup-error text stream — iOS client must be strict about what it sends.
3. **Full-replay resume cost**: GET /stream replays the entire chunk history; for very
   long turns this is bandwidth-heavy on mobile. The workflow SDK supports
   `?startIndex=` + `x-workflow-stream-tail-index` (see
   `apps/web/node_modules/workflow/docs/ai/resumable-streams.mdx`), but the app's route
   does not use it (`stream/route.ts:56-60`). Candidate server enhancement for iOS.
4. **`context.contextLimit`** is sent by the web client but never read server-side
   (no consumer outside the client components) — confirm before replicating.
5. **`abort` chunk unused**: stop produces no in-band signal; the iOS client must treat
   stream-close-without-`finish` as "stopped or disconnected" and reconcile via GET
   chat refresh (`isStreaming` flag) — uncertainty: whether a cancelled run's replay ends
   with or without a `finish` chunk (the finally block tries to `sendFinish` even on
   error, `chat.ts:1862-1871`, but a hard cancel may interrupt it).
6. **Approval flow (`approval-requested`/`tool-approval-request`)** exists in the type
   system and pause logic (`chat.ts:113`), but I found no current server tool that
   requests approvals in the chat path; treat as future-proofing, render gracefully.
7. **Per-message timestamps** are not exposed by GET messages (only row order). If the
   iOS UI needs timestamps, a server change or the debug-bundle endpoint is required.
