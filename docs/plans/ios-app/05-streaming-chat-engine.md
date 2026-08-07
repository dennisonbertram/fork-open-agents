# 05 — Streaming Chat Engine

The streaming chat engine is the heart of the iOS app: a Swift reimplementation of the
Vercel AI SDK v6 "UI Message Stream" client (`useChat` + `DefaultChatTransport`
equivalents), built for the exact server behavior of this repo (`ai@6.0.168` on the
server, durable Vercel Workflow runs, full-replay resume).

Canonical stack (restated from `00-overview.md`, never re-decided here): Xcode 26.x,
Swift 6.2 strict concurrency, SwiftUI-only with `@Observable` MVVM, iOS 26.0 minimum,
GRDB for persistence, Swift Testing for unit tests, swift-snapshot-testing 1.18.x.

Source-of-truth research briefs: `docs/plans/ios-app/research/01-api-chat-and-streaming.md`,
`docs/plans/ios-app/research/22-swift-sse-and-stream-protocol.md`,
`docs/plans/ios-app/research/11-web-client-consumption-patterns.md`.

Cross-references: endpoint/auth plumbing in `02-api-contract-and-networking.md` and
`04-auth.md`; package layout in `03-architecture.md`; test infrastructure in
`06-testing-strategy.md`; signposts/metrics in `07-observability.md`; build order in
`09-step-by-step-build-guide.md`.

Code in this document lives in the local SPM package **`ios/Packages/ChatEngine`**
(library target `ChatEngine`, test target `ChatEngineTests`). `03-architecture.md` owns
the final package graph; this document owns the ChatEngine internals. `ChatEngine` is a
UI-free target: no SwiftUI imports, `nonisolated` default isolation, everything
`Sendable`. The `@MainActor @Observable` `ChatStore` that views read lives in the
feature layer and consumes ChatEngine snapshots.

---

## 1. Wire protocol (exact)

### 1.1 Endpoints

| Endpoint | Method | Purpose | Server file |
|---|---|---|---|
| `/api/chat` | POST | Start (or implicitly resume) an agent turn; returns SSE | `apps/web/app/api/chat/route.ts` |
| `/api/chat/{chatId}/stream` | GET | Resume the active stream (full replay); `204` = nothing active | `apps/web/app/api/chat/[chatId]/stream/route.ts` |
| `/api/chat/{chatId}/stop` | POST | Cancel the running workflow, persisting a client snapshot | `apps/web/app/api/chat/[chatId]/stop/route.ts` |
| `/api/sessions/{sessionId}/chats/{chatId}` | GET | Canonical message history (`ChatRefreshResponse`) | `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.ts` |

The server runs the agent as a **durable Vercel Workflow**. Disconnecting the HTTP
stream never stops generation; only the stop endpoint does. The workflow run id is
returned in the `x-workflow-run-id` response header and mirrored in
`chats.activeStreamId` server-side.

### 1.2 SSE framing

Producer: `createUIMessageStreamResponse` from `ai@6.0.168`. The format is strictly:

- One event per chunk: a single `data: <compact JSON>` line followed by one blank line.
- **No `event:`, `id:`, or `retry:` fields are ever emitted.** There is no
  `Last-Event-ID` mechanism; all resumption is the app-level GET endpoint (§2).
- The stream ends with the literal terminator `data: [DONE]` followed by a blank line,
  then EOF. Treat `[DONE]` as advisory; EOF is the real end-of-stream signal.
- **No heartbeats/pings are emitted.** Idle gaps of minutes are legitimate while a
  sandbox tool (long `bash` command) runs. Timeout policy in §3.1.
- Defensive parsing: skip empty lines and lines starting with `:` (SSE comments) —
  infrastructure may inject them even though the app server does not.

Wire example:

```
data: {"type":"start","messageId":"aBcD1234eFgH5678"}

data: {"type":"text-delta","id":"text-1","delta":"Hello"}

data: [DONE]

```

### 1.3 Response headers

On every `200` from POST `/api/chat` and GET `/api/chat/{chatId}/stream`:

```
content-type: text/event-stream
cache-control: no-cache
connection: keep-alive
x-vercel-ai-ui-message-stream: v1
x-accel-buffering: no
x-workflow-run-id: <runId>      ← POST /api/chat (incl. resume-via-POST) only
x-request-id: <id>              ← POST /api/chat only
x-verified-build-run-id: <id>   ← only when the turn is diverted to Verified Build
```

The client MUST assert `x-vercel-ai-ui-message-stream == "v1"` before parsing a `200`
body from these two endpoints; a missing header is `ChatStreamError.protocolViolation`
(§3.5). Store `x-workflow-run-id` on the in-flight turn for observability
(`07-observability.md`).

### 1.4 Complete chunk-type union

Authoritative union: `UIMessageChunk` / `uiMessageChunkSchema` in `ai@6.0.168`.
Discriminator is the string field `type`. Decode each `data:` payload independently;
**unknown `type` values decode to `.unknown(type:)` and are skipped — never throw**
(the server team can add chunk and `data-*` types at any time). One JSON example per
type, exactly as this server emits them:

| # | `type` | Example (one `data:` payload) |
|---|---|---|
| 1 | `start` | `{"type":"start","messageId":"aBcD1234eFgH5678"}` |
| 2 | `start-step` | `{"type":"start-step"}` |
| 3 | `text-start` | `{"type":"text-start","id":"text-1"}` |
| 4 | `text-delta` | `{"type":"text-delta","id":"text-1","delta":"Hello, I will start by"}` |
| 5 | `text-end` | `{"type":"text-end","id":"text-1"}` |
| 6 | `reasoning-start` | `{"type":"reasoning-start","id":"reasoning-1","providerMetadata":{"anthropic":{"signature":"Eo8…"}}}` |
| 7 | `reasoning-delta` | `{"type":"reasoning-delta","id":"reasoning-1","delta":"The user wants me to"}` |
| 8 | `reasoning-end` | `{"type":"reasoning-end","id":"reasoning-1"}` |
| 9 | `tool-input-start` | `{"type":"tool-input-start","toolCallId":"call_abc123","toolName":"bash"}` |
| 10 | `tool-input-delta` | `{"type":"tool-input-delta","toolCallId":"call_abc123","inputTextDelta":"{\"command\":\"ls -la\"}"}` |
| 11 | `tool-input-available` | `{"type":"tool-input-available","toolCallId":"call_abc123","toolName":"bash","input":{"command":"ls -la"}}` |
| 12 | `tool-input-error` | `{"type":"tool-input-error","toolCallId":"call_abc123","toolName":"bash","input":{"command":42},"errorText":"Invalid input: expected string"}` |
| 13 | `tool-approval-request` | `{"type":"tool-approval-request","approvalId":"appr_1","toolCallId":"call_abc123"}` |
| 14 | `tool-output-available` | `{"type":"tool-output-available","toolCallId":"call_abc123","output":{"stdout":"README.md\n","stderr":"","exitCode":0}}` |
| 15 | `tool-output-available` (preliminary, `task` tool) | `{"type":"tool-output-available","toolCallId":"call_task1","output":{"pending":{"name":"grep","input":{"pattern":"TODO"}},"toolCallCount":3,"startedAt":1760000000000},"preliminary":true}` |
| 16 | `tool-output-error` | `{"type":"tool-output-error","toolCallId":"call_abc123","errorText":"Command timed out after 120s"}` |
| 17 | `tool-output-denied` | `{"type":"tool-output-denied","toolCallId":"call_abc123"}` |
| 18 | `source-url` | `{"type":"source-url","sourceId":"src-1","url":"https://example.com/doc","title":"Example doc"}` |
| 19 | `source-document` | `{"type":"source-document","sourceId":"src-2","mediaType":"application/pdf","title":"Spec","filename":"spec.pdf"}` |
| 20 | `file` | `{"type":"file","url":"data:image/png;base64,iVBORw0…","mediaType":"image/png"}` |
| 21 | `data-*` (open family) | see per-name examples below |
| 22 | `message-metadata` | `{"type":"message-metadata","messageMetadata":{"modelId":"anthropic/claude-haiku-4.5","inferenceRoute":"gateway","lastStepUsage":{"inputTokens":1042,"outputTokens":212,"totalTokens":1254},"lastStepCost":0.0031,"totalMessageCost":0.0031,"lastStepFinishReason":"tool-calls"}}` |
| 23 | `finish-step` | `{"type":"finish-step"}` |
| 24 | `finish` | `{"type":"finish","finishReason":"stop"}` |
| 25 | `error` | `{"type":"error","errorText":"Rate limit exceeded for model anthropic/claude-haiku-4.5"}` |
| 26 | `abort` | `{"type":"abort"}` — defined by the SDK; **never emitted by this server**. Decode it; treat like EOF-without-finish. |

Field-level notes:

- `start`: `messageId?` (sets/overwrites the assistant message id), `messageMetadata?`.
- `finish`: `finishReason?` ∈ `stop | length | content-filter | tool-calls | error | other`.
  **This server always sends `"stop"`**, even after stop/maxSteps — do not branch on it.
- All `text-*`/`reasoning-*` chunks may carry `providerMetadata` (opaque JSON; store as
  `JSONValue`, never interpret).
- All `tool-*` chunks may carry `providerExecuted?: Bool`, `dynamic?: Bool`,
  `title?: String`. `dynamic: true` means Composio/runtime-registered tool → the part
  type is `dynamic-tool` instead of `tool-<name>`.
- `data-*`: `data: <any JSON>`, `id?: String`, `transient?: Bool`. `transient: true`
  chunks are **never stored in the message** — they fire a status callback only.

**`data-*` examples this app emits** (payload types in `apps/web/app/types.ts`):

```json
{"type":"data-workspace-status","id":"workspace-status","transient":true,"data":{"status":"setting-up","message":"Starting the sandbox...","title":"Preparing sandbox workspace","logLines":["Session: ses_123"],"logUpdatedAt":"2026-06-10T14:03:21.000Z"}}
```

```json
{"type":"data-commit","id":"aBcD1234eFgH5678:commit","data":{"status":"pending"}}
```

```json
{"type":"data-commit","id":"aBcD1234eFgH5678:commit","data":{"status":"success","committed":true,"pushed":true,"commitMessage":"fix: handle empty input","commitSha":"9f8e7d6","url":"https://github.com/o/r/commit/9f8e7d6"}}
```

```json
{"type":"data-pr","id":"aBcD1234eFgH5678:pr","data":{"status":"success","created":true,"prNumber":42,"url":"https://github.com/o/r/pull/42"}}
```

```json
{"type":"data-snippet","id":"snippet-1","data":{"content":"const x = 1;\n","filename":"snippet.ts"}}
```

```json
{"type":"data-verified-build","id":"c0ffee:verified-build","data":{"status":"accepted","runId":"vb_123","harnessRunId":"hr_456","mode":"verified_build","reason":"build-affecting change","requestId":"req_789"}}
```

```json
{"type":"data-runtime-proof","id":"aBcD1234eFgH5678:runtime-proof","data":{"status":"completed","runtimeMode":"managed_runtime","workflowRunId":"wf_1","sandboxName":"sbx-a1","profile":{"id":"node-22","version":"3","displayName":"Node 22","profileRunId":"mrr_9"},"workerEvidence":{"total":2,"completed":2,"failed":0,"running":0,"latest":null},"coordinatorDirectToolUse":{"observed":false,"count":0,"toolTypes":[],"toolLabels":[],"warning":null},"evidence":["worker completed"],"serviceEvidence":{"total":0,"running":0,"failed":0,"latest":null},"browserEvidence":{"total":0,"passed":0,"failed":0,"latest":null},"limitations":[]}}
```

Note the **stable-id update pattern**: `data-commit` / `data-pr` / `data-runtime-proof`
are sent first with `{"status":"pending"}` (or partial data) and then **re-sent with the
same `id`** to resolve. The reducer must replace-by-id, not append (§4.2 rule D).
`data-workspace-status` reuses id `workspace-status` for every progress update and is
always transient.

### 1.5 Tool-part state machine

Tool parts (both `tool-<name>` and `dynamic-tool`) carry a `state` field that the
reducer advances as chunks arrive:

```
input-streaming ──▶ input-available ──▶ output-available        (terminal)
                          │        └──▶ output-error            (terminal)
                          ▼
                 approval-requested ──▶ approval-responded ──▶ output-available
                                                          └──▶ output-denied  (terminal)
```

| Chunk received | Resulting part state | Part fields set |
|---|---|---|
| `tool-input-start` | `input-streaming` | `toolCallId`, `toolName`, empty accumulator |
| `tool-input-delta` | `input-streaming` | append `inputTextDelta` to raw-input accumulator |
| `tool-input-available` | `input-available` | `input` (parsed JSON) |
| `tool-input-error` | `output-error` | `input` (or `rawInput`), `errorText` |
| `tool-approval-request` | `approval-requested` | `approval: {id: approvalId}` |
| local approval response | `approval-responded` | `approval: {id, approved, reason?}` |
| `tool-output-available` (`preliminary: true`) | stays `output-available` but updatable | `output`, `preliminary: true` |
| `tool-output-available` (final) | `output-available` | `output`, clears `preliminary` |
| `tool-output-error` | `output-error` | `errorText` |
| `tool-output-denied` | `output-denied` | — |

Terminal states for auto-resubmit purposes (§5.4): `output-available` (non-preliminary),
`output-error`, `approval-responded`. **Not** terminal: `input-available` — that is the
pause state for client-side tools (`ask_user_question`). A part still in
`input-streaming`/`input-available` when the stream closes renders as "interrupted".

The approval states exist in the type system and the server's pause logic, but no
current chat-path tool requests approvals — implement the states in the reducer and
render gracefully; do not build approval UI in v1 (flagged in `01-product-and-ux.md`).

### 1.6 Message and part model

The wire shape **is** the persisted shape: `chat_messages.parts` stores the entire
`UIMessage` object, and GET history returns it verbatim. One Swift model serves the
stream reducer, the history decoder, and GRDB:

```swift
struct UIMessage: Codable, Sendable, Identifiable, Equatable {
  var id: String
  var role: Role                    // "system" | "user" | "assistant" (DB only has user/assistant)
  var metadata: JSONValue?          // WebAgentMessageMetadata — decode leniently, all fields optional
  var parts: [UIMessagePart]
}
```

`UIMessagePart` is an enum over these part types (every one is required to faithfully
render history fetched from the server):

| Part `type` | Fields | Notes |
|---|---|---|
| `text` | `text`, `state?: "streaming"\|"done"`, `providerMetadata?` | |
| `reasoning` | `text`, `state?`, `providerMetadata?` | render collapsed |
| `step-start` | — | step boundary marker |
| `file` | `mediaType`, `filename?`, `url` | `url` may be a `data:` URL (user image attachments) |
| `source-url` | `sourceId`, `url`, `title?` | |
| `source-document` | `sourceId`, `mediaType`, `title`, `filename?` | |
| `dynamic-tool` | `toolName`, `toolCallId`, `state`, `input?`, `rawInput?`, `output?`, `errorText?`, `preliminary?`, `approval?` | Composio/MCP tools |
| `tool-<NAME>` | `toolCallId`, `state`, `input?`, `rawInput?`, `output?`, `errorText?`, `preliminary?`, `providerExecuted?`, `callProviderMetadata?`, `approval?` | static tools, below |
| `data-commit`, `data-pr`, `data-snippet`, `data-verified-build`, `data-runtime-proof` | `id?`, `data` | typed payloads, §1.4; decode payload fields all-optional |
| unknown | raw `type` + opaque JSON | render as generic chip; never drop from the array (round-trip safety, §5.1) |

Static tool names (registry `packages/agent/open-agent.ts`): `todo_write`, `read`,
`write`, `edit`, `grep`, `glob`, `bash`, `task`, `ask_user_question`,
`setup_managed_runtime_profile`, `skill`, `web_fetch`, plus policy-gated
`propose_composio_tool`. Decode `tool-<anything>` generically by splitting the prefix —
do not hardcode an exhaustive enum of tool names.

`data-workspace-status` is transient-only and never appears in persisted messages.

### 1.7 Canonical full-turn chunk sequence

A normal 2-step agent turn (text → tool call → tool result → text):

```
start (messageId=M)
start-step
reasoning-start/delta…/reasoning-end
text-start/delta…/text-end
tool-input-start → tool-input-delta… → tool-input-available   (call_1)
message-metadata
finish-step
start-step
tool-output-available (call_1)            ← output arrives in the NEXT step's stream
text-start/delta…/text-end
message-metadata
finish-step
data-commit (pending) → data-commit (resolved)     ← post-loop git data parts
data-pr (pending) → data-pr (resolved|skipped)
finish (finishReason=stop)
[DONE]
```

Special sequences the engine must also handle:

- **Setup errors** (sandbox/auth/model failures before output): a synthetic short text
  message with text block id `"setup-error"`, then `finish`. Looks like a normal
  assistant message; no special casing needed.
- **In-band model errors**: `{"type":"error","errorText":…}` → error banner state, not
  message content; stream may still end with `finish`.
- **Verified Build divert** (POST response only): `start`, `data-verified-build`,
  one text block, `finish`, `[DONE]` — plus `x-verified-build-run-id` header.
- **Client-tool pause**: turn ends (`finish` + `[DONE]`) with a `tool-ask_user_question`
  part still in `input-available` — see §5.5.
- **Stop**: no `abort` chunk; the stream just closes. EOF-without-`finish` =
  stopped-or-disconnected; reconcile via §2.4.

---

## 2. Resume semantics

### 2.1 The contract

`GET /api/chat/{chatId}/stream`:

- **`200` + SSE**: the workflow's readable **replays every chunk from index 0**, then
  continues live. The server passes no `startIndex`; there is no partial replay.
- **`204 No Content`**: nothing active (no run, or run `completed|cancelled|failed`).
- Auth errors on this route are **plain text**, not JSON (401/403/404).

Consequence — the cardinal rule of this engine:

> **On every resume, REBUILD message state from scratch. Never append replayed chunks
> onto existing partial state.**

Appending a replay onto partial state duplicates every text/reasoning part (the exact
"jank" the web client's hook documents avoiding). Implementation:

1. On reconnect, create a **fresh `ChatTurnState`** seeded with the persisted history
   (everything up to, but not including, the in-flight assistant message).
2. Apply all replayed chunks to the fresh state.
3. On the first UI flush after `start` arrives: if `start.messageId` equals the id of
   the last local assistant message, **replace that message wholesale**; otherwise
   append the rebuilt message.
4. Discard the previous partial in-memory state entirely.

This is idempotent regardless of whether the replay window is ever changed server-side
(known open risk; rebuilding is correct either way).

### 2.2 `204` handling

`204` means the run finished (or never existed) while we were away. Local partial state
is stale by construction. Do **not** trust it:

1. GET `/api/sessions/{sessionId}/chats/{chatId}` → `ChatRefreshResponse
   { chat, isStreaming, messages }`.
2. Replace `ChatStore.messages` with `messages` (canonical final state) — but only when
   `isStreaming == false`; if `true`, a new run started: go back to the GET-stream path.
3. Overwrite GRDB rows for the chat (§6.3), preserving local `pending_send`/`failed_send`
   rows whose ids are absent from the server response.

### 2.3 Reconnect triggers

Reconnect (GET `/stream`, never re-POST) whenever a turn might be in flight:

| Trigger | Mechanism | Action |
|---|---|---|
| App returns to foreground | `scenePhase == .active` | if a turn was in flight or last message is `user` → reconnect immediately |
| Network path change | `NWPathMonitor` `status == .satisfied` after unsatisfied | reconnect if turn in flight |
| Mid-stream EOF without `finish` | stream loop ends dirty | backoff reconnect (below) |
| Mid-stream transport error | `URLError` thrown from `AsyncBytes` | backoff reconnect |
| Mount with unanswered user message | last message `role == user`, no known active stream | **probe schedule `0s, 1s, 2.5s, 5.5s, 10s`** (mirrors the web client; covers the race where the workflow claims `activeStreamId` shortly after POST) |
| Watchdog: no chunk for 300 s | app-level timer per active stream | probe GET `/api/sessions/{sessionId}/chats` (`isStreaming`); if `true`, keep waiting; if `false`, treat as `204` path |

Backoff for dirty-disconnect reconnects: `0.5s → 1s → 2s → 4s → 8s → 15s` cap, ±20 %
jitter, counter reset after a connection that stays alive > 60 s. Suppress all
auto-reconnect after an explicit user stop until the next send (`userStopped` flag —
this is the web client's fix for the iOS-Safari "tap stop 3 times" bug; we inherit the
same race natively).

**Never re-POST `/api/chat` as a reconnect strategy.** A re-POST while a run is active
happens to return the existing stream in this repo, but can also `409`, and it re-sends
the entire message history. GET is the contract.

### 2.4 Detecting "done" vs "disconnected"

| Observation | Meaning | Action |
|---|---|---|
| `finish` chunk seen, then EOF/`[DONE]` | clean finish | finalize message (§6), evaluate auto-resubmit (§5.4) |
| EOF without `finish`, `userStopped == true` | user stop | finalize snapshot; no reconnect |
| EOF without `finish`, no user stop | dirty disconnect OR another client stopped the run | backoff reconnect; on `204` → §2.2 refetch reconciles |
| `error` chunk then EOF | turn errored | show banner + Retry (Retry = GET resume, not re-POST) |

### 2.5 Idle timeout

There are **no server heartbeats**. The default `URLSession`
`timeoutIntervalForRequest` of 60 s is an *idle* timer and would kill legitimate
streams while a long sandbox command runs. Policy:

- Dedicated streaming `URLSessionConfiguration` with
  **`timeoutIntervalForRequest = 600`** (chosen from the mandated 300–600 s band;
  the 300 s watchdog in §2.3 fires first and probes cheaply).
- `timeoutIntervalForResource`: leave at default (7 days) — turns can run very long
  (`maxSteps: 500`).
- `waitsForConnectivity = true` for initial connect only.
- Plain REST calls use a separate normal-timeout session (see
  `02-api-contract-and-networking.md`).

### 2.6 Backgrounding

iOS reclaims sockets shortly after suspension; the stream **will** die in background.
The server is durable, so this is harmless by design:

1. On `scenePhase == .background`: call `UIApplication.beginBackgroundTask`, drain
   already-buffered chunks (budget ≤ 5 s), persist the in-flight assistant snapshot to
   GRDB as `partial_stream` (§6.3), cancel the stream task, end the background task.
2. On foreground: §2.3 reconnect.
3. "Notify me when the agent finishes while suspended" is APNs work, out of scope for
   the chat engine (roadmap item in `00-overview.md`).

---

## 3. Swift SSE client design

### 3.1 Shape

```swift
// ios/Packages/ChatEngine/Sources/ChatEngine/ChatStreamClient.swift
actor ChatStreamClient {
  struct Connection {
    let workflowRunId: String?     // x-workflow-run-id, nil on GET resume
    let requestId: String?         // x-request-id
    let chunks: AsyncThrowingStream<UIMessageChunk, Error>
  }

  enum StartResult { case stream(Connection), noActiveStream /* GET 204 */ }

  func postTurn(_ body: ChatRequestBody) async throws -> Connection
  func resume(chatId: String) async throws -> StartResult
  func cancelActiveConnection()    // task cancellation; does NOT stop the server run
}
```

One streaming `URLSessionConfiguration` (`timeoutIntervalForRequest = 600`,
`waitsForConnectivity = true`, `httpAdditionalHeaders` empty — auth is injected by the
shared auth middleware from `04-auth.md`, the same `ClientMiddleware` concept used for
the generated `OpenAgentsAPI` client; the raw streaming path applies the identical
header/cookie logic). The SSE endpoints are **not** routed through the generated
OpenAPI client — swift-openapi-generator 1.12.2's URLSession transport buffers
response bodies unsuitably for indefinite SSE; the hand-rolled client below is the
deliberate exception, documented in `02-api-contract-and-networking.md`.

### 3.2 Line parser

Hand-rolled over `URLSession.bytes(for:)` (decision per research brief 22: the protocol
is single-line `data:` JSON + `[DONE]`; a spec-compliant parser dependency is not
needed, but the parse step is a separate function so `mattt/EventSource`'s parser could
be swapped in later without touching the reducer).

```swift
// ios/Packages/ChatEngine/Sources/ChatEngine/SSELineParser.swift
func parseSSELine(_ line: String) -> SSELineEvent {
  // Order matters; .lines already strips CR/LF/CRLF and reassembles split payloads.
  if line.isEmpty { return .ignore }                 // event delimiter
  if line.hasPrefix(":") { return .ignore }          // SSE comment / infra keep-alive
  guard line.hasPrefix("data:") else { return .ignore }  // no event:/id:/retry: in this protocol
  var payload = line.dropFirst(5)
  if payload.first == " " { payload = payload.dropFirst() }
  if payload == "[DONE]" { return .done }
  return .data(String(payload))
}
```

Consumption loop (inside `ChatStreamClient`):

```swift
let (bytes, response) = try await streamingSession.bytes(for: request)
guard let http = response as? HTTPURLResponse else { throw ChatStreamError.transport(...) }
switch http.statusCode {
case 200:
  guard http.value(forHTTPHeaderField: "x-vercel-ai-ui-message-stream") == "v1" else {
    throw ChatStreamError.protocolViolation
  }
case 204: return .noActiveStream            // GET resume only
default:  throw try await Self.mapHTTPError(http, bytes)   // §3.5; drains small JSON body
}
for try await line in bytes.lines {
  switch parseSSELine(line) {
  case .ignore: continue
  case .done: break          // advisory; loop until EOF anyway
  case .data(let json):
    if let chunk = UIMessageChunk(lenientlyDecoding: Data(json.utf8)) {
      continuation.yield(chunk)
    } // decode failure: log via Logger(subsystem:category:"sse"), increment metric, SKIP — never abort the stream
  }
}
continuation.finish()        // EOF; clean/dirty determination happens in the engine (§2.4)
```

`UIMessageChunk` is the discriminated-union enum from research brief 22 §9 (decode on
`type` with custom `init(from:)`; arbitrary JSON fields — `input`, `output`, `data`,
`providerMetadata`, `messageMetadata` — decode to a recursive `JSONValue`; `data-*`
prefix match; `default:` → `.unknown(type:)`). Copy that sketch verbatim into
`ios/Packages/ChatEngine/Sources/ChatEngine/UIMessageChunk.swift`.

### 3.3 Cancellation

- The stream lives in one `Task`; `cancelActiveConnection()` cancels it.
  `URLSession.AsyncBytes` iteration then throws `CancellationError`/
  `URLError(.cancelled)` — map to `ChatStreamError.cancelled` and do **not** surface an
  error UI.
- **User stop is a different operation from cancellation.** Stop order (replicates the
  web client exactly):
  1. Fire-and-forget POST `/api/chat/{chatId}/stop` with body
     `{"assistantMessage": <current in-flight UIMessage snapshot>}` so the server
     persists partial output before cancelling the workflow.
  2. Set `userStopped = true` (suppresses auto-reconnect until next send).
  3. Cancel the local stream task immediately (UI stop must be instant; do not await
     the POST).
  4. Finalize the local snapshot (§6.3).
- Navigating away from a chat cancels the local task but does **not** POST stop —
  generation continues in background, matching web behavior.

### 3.4 Backpressure

- `URLSession.AsyncBytes` is pull-based: TCP flow control applies if we iterate slowly.
  Chunk handling is cheap (string append / dictionary update), so the reducer consumes
  **inline in the same task** — no intermediate unbounded queue between parser and
  reducer.
- The only buffering seam is reducer → UI: a **latest-value snapshot** (single slot,
  coalescing), never a queue of snapshots. The 75 ms flush (§7) reads the latest
  snapshot; intermediate states are intentionally dropped.
- If the reducer ever becomes slow (pathological 100 MB tool outputs), backpressure
  propagates naturally to the socket. Guard rail: truncate any single tool `output`
  string > 2 MiB for the in-memory render model (keep full JSON for persistence) and
  count it (`07-observability.md`).

### 3.5 Error mapping

```swift
enum ChatStreamError: Error, Sendable {
  case notAuthenticated                       // HTTP 401 (and GET-resume plain-text 401)
  case forbidden(message: String)             // HTTP 403 ("Access denied" = BotID/owner)
  case badRequest(message: String)            // HTTP 400; message from {"error":…}
  case sessionArchived                        // HTTP 400 with error == "Session is archived"
  case notFound                               // HTTP 404 (session/chat)
  case conflict                               // HTTP 409 "Another workflow is already running for this chat"
  case workflowInputInvalid(fieldErrors: [String: [String]])  // HTTP 422
  case verifiedBuildUnavailable(requestId: String?)           // HTTP 502
  case serverError(status: Int)               // other 5xx
  case protocolViolation                      // 200 without x-vercel-ai-ui-message-stream: v1
  case transport(URLError)                    // connectivity; retryable
  case cancelled                              // local task cancellation; silent
}
```

Handling matrix:

| Error | UI | Recovery |
|---|---|---|
| `notAuthenticated` | none (handled globally) | hand to auth layer: attempt bearer refresh, else sign-out → login (`04-auth.md`; mirrors web's global 401 handler) |
| `forbidden`, `badRequest`, `notFound`, `serverError` | inline banner with message | manual Retry; `notFound` also refetches session/chat lists |
| `sessionArchived` | banner "Session is archived" | disable composer |
| `conflict` | none | a run is already active: GET resume and attach; see §5.3 for the optimistic message |
| `workflowInputInvalid` | field errors on workflow form | re-submit |
| `verifiedBuildUnavailable` | banner + requestId | manual retry |
| `protocolViolation` | banner "Unsupported server response" | report metric; manual retry |
| `transport` | subtle "reconnecting…" indicator | backoff reconnect (§2.3) |
| `cancelled` | none | none |
| in-band `error` chunk | banner with `errorText` + Retry | Retry = `clearError` + GET resume (web's "soft" retry) |
| per-chunk decode failure | none | log + skip chunk |

---

## 4. The message-store reducer

### 4.1 State

```swift
// ios/Packages/ChatEngine/Sources/ChatEngine/ChatTurnState.swift
struct ChatTurnState: Sendable {
  var messages: [UIMessage]                       // full transcript incl. in-flight last message
  // streaming registries (cleared by finish-step / finish):
  var activeTextPartIndex: [String: Int]          // text block id → index into last message's parts
  var activeReasoningPartIndex: [String: Int]
  var toolPartIndex: [String: Int]                // toolCallId → part index (persists across steps)
  var partialToolInput: [String: String]          // toolCallId → accumulated raw input JSON text
  var dataPartIndex: [DataPartKey: Int]           // (name, id) → part index, for replace-by-id
  // turn status:
  var sawStart = false
  var sawFinish = false
  var lastErrorText: String?
  mutating func apply(_ chunk: UIMessageChunk)    // pure value-type mutation; the only entry point
}
```

The reducer is a pure value-type `apply` (no I/O, no clocks, no main actor) — this is
what golden tests exercise (§8.3). It runs inside a `ChatTurnEngine` actor that owns the
stream loop, the flush timer, and persistence callouts.

**Continuation rule** (matches the AI SDK exactly): when a turn begins, if the last
message in `messages` has `role == "assistant"`, the stream **continues that message**
(parts append to it) — this is how `ask_user_question` resumption works. Otherwise a new
assistant message is created. `start.messageId`, when present, overwrites the message id.

### 4.2 Chunk → mutation table

Always operating on `messages.last` (the in-flight assistant message):

| Chunk | Mutation |
|---|---|
| `start` | ensure in-flight assistant message exists (continuation rule); set `id = messageId` if present; deep-merge `messageMetadata` into `metadata`; `sawStart = true` |
| `start-step` | append `{type: "step-start"}` part |
| `text-start` | append `text` part `{text: "", state: "streaming"}`; register index under `id` |
| `text-delta` | append `delta` to registered part's `text`. **Lenient rule**: if `id` unregistered (SDK throws here; we must not), synthesize a `text` part and register it |
| `text-end` | set `state: "done"`; unregister `id` |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | identical pattern on `reasoning` parts |
| `tool-input-start` | append tool part (`tool-<toolName>`, or `dynamic-tool` when `dynamic == true`) with `state: "input-streaming"`; register by `toolCallId`; init `partialToolInput[toolCallId] = ""` |
| `tool-input-delta` | append `inputTextDelta` to `partialToolInput[toolCallId]`; expose as `rawInput` for live rendering. **Do not JSON-parse per delta** (web runs `parsePartialJson` each delta; on iOS render the raw text — cheaper, same UX) |
| `tool-input-available` | upsert part (create if no `tool-input-start` was seen): `state: "input-available"`, `input` = parsed JSON; clear accumulator |
| `tool-input-error` | upsert part: `state: "output-error"`, `errorText`, keep `rawInput` |
| `tool-approval-request` | update part by `toolCallId`: `state: "approval-requested"`, `approval = {id: approvalId}` |
| `tool-output-available` | update part: `output` = payload; if `preliminary == true` keep part updatable (state already `output-available`), else final `output-available` and clear `preliminary` |
| `tool-output-error` | update part: `state: "output-error"`, `errorText` |
| `tool-output-denied` | update part: `state: "output-denied"` |
| `source-url` / `source-document` / `file` | append corresponding part verbatim |
| `data-*` with `transient == true` | **do not touch parts**; forward `(name, id, data)` to the transient-data callback (drives the workspace-status banner; cleared per web rules when first assistant content part arrives) |
| `data-*` (rule D) | key = (name, `id`); if `id` present and a part with same type+id exists → **replace its `data` in place**; else append new part and (if `id` present) register in `dataPartIndex` |
| `message-metadata` | deep-merge `messageMetadata` into `metadata` |
| `finish-step` | append nothing; **clear `activeTextPartIndex` and `activeReasoningPartIndex`** (next step's text opens a fresh visual block); keep `toolPartIndex` (outputs arrive in later steps) |
| `finish` | deep-merge `messageMetadata` if present; mark all `state: "streaming"` text/reasoning parts `"done"`; `sawFinish = true` |
| `error` | `lastErrorText = errorText`; never appended as content |
| `abort` | treat as imminent EOF; no mutation |
| `.unknown(type:)` | increment skip metric; no mutation |

### 4.3 Ordering rules

1. Chunks are applied **strictly in arrival order**, single-threaded (the engine actor
   serializes; this is the Swift equivalent of the SDK's `SerialJobExecutor`).
2. Parts append in arrival order; the parts array order is the render order. Never sort.
3. Text/reasoning deltas mutate the registered part in place — interleaved blocks
   (`text-start A`, `text-start B`, deltas for both) are supported by the id registry
   even though this server rarely interleaves.
4. Tool parts are keyed by `toolCallId` **for the whole turn**, not per step: the
   `tool-output-available` for a call started in step N arrives after step N's
   `finish-step` and must find the same part.
5. `data-*` replace-by-id may target a part appended many chunks earlier (pending →
   resolved). Position in the array never changes on replace.
6. Duplicate application must be safe (`replace`, `set`, `merge` semantics — no
   counters, no toggles). This is what makes full-replay resume (§2.1) and
   double-applied fixtures (§8.4) converge.

### 4.4 Quiescence and what the engine does at stream end

On `finish` + EOF (clean):

1. Final flush to `ChatStore` (immediate, not waiting for the 75 ms tick).
2. Persist the final assistant message to GRDB (`synced`, §6.3).
3. Evaluate auto-resubmit (§5.4).
4. If nothing auto-resubmits and a `tool-ask_user_question` part is in
   `input-available` → enter question-wizard mode (§5.5).
5. Clear turn status; status becomes `.ready`.

A note on replays and reasoning: persisted assistant messages are deduped server-side
(`dedupeMessageReasoning`); a live replay can briefly show duplicate reasoning blocks
that disappear after the next history refetch. Accept this (web has the same behavior).

---

## 5. Send-message flow

### 5.1 POST body shape

POST `/api/chat`, `content-type: application/json`. The server requires `sessionId`,
`chatId`, `messages`; it ignores the AI SDK's `id`/`trigger`/`messageId` fields. The iOS
client sends the **minimal contract**:

```json
{
  "sessionId": "<sessionId>",
  "chatId": "<chatId>",
  "messages": [ /* FULL UIMessage[] history, oldest first, ending with the new user message */ ]
}
```

Rules:

- **Full history every time.** The server re-converts the entire history each turn and
  persists only the latest user message (insert-only) plus assistant tool-result
  snapshots. Round-trip every part verbatim — including parts the app doesn't
  understand (`.unknown` parts re-encode their original JSON; this is why the part enum
  keeps raw payloads).
- Do **not** send `context.contextLimit` — the web client sends it but no server code
  reads it.
- **Message ids are client-generated and must be stable**: `UUID().uuidString.lowercased()`.
  The server's insert-only persistence and the 50×100 ms page-load retry are keyed on it.
- There is **no Zod validation on this body** — a malformed `messages` array fails deep
  inside the workflow as a generic setup-error text stream. The client must be strict:
  encode through the typed `UIMessage` model only, never hand-built dictionaries.
- New user message shapes (mirror web):
  - plain: `{"id":"…","role":"user","parts":[{"type":"text","text":"…"}]}`
  - with images: append `{"type":"file","mediaType":"image/jpeg","filename":"photo.jpg","url":"data:image/jpeg;base64,…"}`
    parts (images travel inline as data URLs; client-side downscale to max dimension
    1600 px before encoding, matching web)
  - with pasted-text attachment: append `{"type":"data-snippet","id":"<uuid>","data":{"content":"…","filename":"…"}}`

### 5.2 Happy path

1. Build the user `UIMessage`; **optimistically** append to `ChatStore.messages`;
   status → `.submitted`; write GRDB row `sync_state = 'pending_send'` (§6.3).
2. POST `/api/chat` via `ChatStreamClient.postTurn`.
3. On `200` + `v1` header: status → `.streaming`; store `x-workflow-run-id`; run the
   reducer loop.
4. On the `start` chunk: mark the user GRDB row `synced` (run accepted ⇒ message
   persisted server-side).
5. Stream to completion (§4.4).

If this is the first message of a fresh session, fire POST `/api/generate-title`
`{"message": "<text>"}` in parallel and PATCH the session title with the result —
optimistic title = first 80 chars (mirrors web; details in `01-product-and-ux.md`).

### 5.3 Failure rollback

| Failure | Rollback behavior |
|---|---|
| Transport error / 5xx before any chunk | keep the optimistic message rendered with a **failed badge** + Retry/Delete actions; GRDB row → `failed_send`. Retry re-POSTs the same body (same message id — idempotent server-side). Delete removes the row and the in-memory message and restores the text into the composer |
| `400` / `403` / `404` / `sessionArchived` | same as above, plus the error banner; `sessionArchived` disables the composer |
| `409 conflict` | the new user message was **not** persisted (the reconnect guard runs before persistence). Keep it `failed_send` with badge "Agent is still working"; immediately GET-resume to attach to the active run; offer Retry once the turn completes. Prevent most 409s structurally: **disable send while status is `.streaming` or server `isStreaming` is true** |
| Stream drops mid-turn | not a send failure — the user message was accepted; recovery is §2 |

Never silently drop a user's typed content: rollback always lands the text either in a
retryable failed message or back in the composer.

### 5.4 Auto-resubmit (replicating `shouldAutoSubmit`)

After a clean finish, or after the client supplies a tool output locally:

1. Let `last` = last message. Require `last.role == "assistant"`.
2. Find the final step: parts after the last `step-start` (or all parts if none).
3. Collect tool parts (`tool-*` + `dynamic-tool`) in that slice where
   `providerExecuted != true`.
4. If the set is non-empty **and** every member is terminal
   (`output-available` non-preliminary, `output-error`, `approval-responded`) →
   re-POST `/api/chat` with the full history (last message = that assistant message).
   The server eagerly persists the embedded tool results and resumes the loop with the
   same assistant message id; the new stream **continues the same message**
   (continuation rule §4.1).
5. If any part is `input-available` (e.g. `ask_user_question`) or
   `approval-requested` → do not resubmit; wait for the user.

Guard: max 5 consecutive auto-resubmits without a new user message, then surface a
banner (defends against server/client disagreement loops; web relies on the SDK's
internal equivalent).

### 5.5 `ask_user_question` round trip

1. Detect: last assistant message contains a `tool-ask_user_question` part in state
   `input-available`. Input shape:
   `{"questions":[{"question":"…","header":"≤12 chars","options":[{"label":"…","description":"…"}],"multiSelect":false}]}`
   (1–4 questions, 2–4 options each).
2. The composer morphs into the question wizard (`01-product-and-ux.md` owns the UI).
3. On submit: locally mutate that tool part to `output-available` with output
   `{"answers": {"<question>": "<label>" | ["<label>", …]}}` — or `{"declined": true}`
   on decline. Persist the updated assistant message to GRDB.
4. §5.4 now evaluates true → auto re-POST with the answered assistant message last.
5. Belt-and-braces (device-switch safety): the web also persists such snapshots via
   POST `/api/sessions/{sessionId}/chats/{chatId}/messages` `{"message": <assistant UIMessage>}`;
   iOS does the same fire-and-forget before the re-POST, tolerating `409`
   (`Message ID already belongs to a different chat or role` — drop silently).

### 5.6 Effective status model

The UI status is **not** just the local stream state. Replicate web's `effectiveStatus`
blend:

```
effectiveStatus = userStopped ? .ready
                : localStatus ∈ {submitted, streaming} ? localStatus
                : serverIsStreaming (from chats poll / chat refresh) ? .streaming
                : localError != nil ? .error
                : .ready
```

`serverIsStreaming` comes from GET `/api/sessions/{sessionId}/chats`
(`isStreaming` per chat) — this is how the app shows "agent is working" after relaunch
with no socket attached, and what gates the composer's send/stop button.

---

## 6. Persistence (GRDB)

### 6.1 Principles

- GRDB is a **disposable cache of server truth plus a send-outbox** — never a second
  source of truth for assistant content. Server wins every conflict.
- Store the **full `UIMessage` JSON verbatim** (same bytes we'd POST back), plus a few
  indexed columns for list rendering. Schema versioned; "nuke and re-sync" is the
  migration escape hatch (`03-architecture.md`).
- **Never write per-delta.** Writes happen only at the boundaries below.

### 6.2 Schema (chat slice)

```sql
-- migration v1, table owned by this doc; registered in the Persistence target's migrator
CREATE TABLE chat_message (
  id              TEXT PRIMARY KEY NOT NULL,   -- AI SDK message id
  chat_id         TEXT NOT NULL,
  position        INTEGER NOT NULL,            -- index in the server-returned array
  role            TEXT NOT NULL,               -- 'user' | 'assistant'
  message_json    TEXT NOT NULL,               -- full UIMessage object, verbatim
  sync_state      TEXT NOT NULL DEFAULT 'synced',
                  -- 'synced' | 'pending_send' | 'failed_send' | 'partial_stream'
  updated_at_local TEXT NOT NULL               -- ISO-8601, local clock, debugging only
);
CREATE INDEX idx_chat_message_chat ON chat_message(chat_id, position);
```

Note: the server exposes **no per-message timestamps** (only array order), so
`position` is the ordering column. Re-number on every full refetch.

### 6.3 Write points

| Event | GRDB write |
|---|---|
| GET chat snapshot `200` (open chat, tab-resume refresh, `204` reconcile) | one transaction: delete all `synced`/`partial_stream` rows for the chat; insert server messages as `synced` with fresh `position`; **keep** `pending_send`/`failed_send` rows whose ids are absent from the server set (outbox survives refetch races) |
| user taps send | insert user message `pending_send` |
| `start` chunk received for that POST | update user row → `synced` |
| `finish` chunk (clean stream end) | upsert final assistant message `synced` |
| user supplies client tool output (§5.5) | upsert assistant message `synced` (it is about to be server-persisted by the re-POST) |
| app backgrounds mid-stream | upsert in-flight assistant snapshot `partial_stream` |
| user stop | upsert snapshot `synced` (server persists the same snapshot via the stop body) |
| send fails (§5.3) | update user row → `failed_send` |
| user deletes a failed message | delete row |
| message delete/regenerate (`DELETE …/messages/{messageId}` returns `deletedMessageIds`) | delete those ids |

`partial_stream` rows render with a "resuming…" affordance on cold launch and are always
replaced by the next resume rebuild or refetch. Transient `data-workspace-status`
payloads are **never** persisted. Chat/session list caching is `03-architecture.md`'s
concern; the chat engine touches only `chat_message`.

### 6.4 Read path

On chat open: read GRDB rows ordered by `position` → render instantly → fire GET chat
snapshot → reconcile (replace + re-render if changed) → §2.3 resume probing if the last
message is an unanswered user message or `isStreaming` is true. FTS over
`message_json` for transcript search is a later milestone (schema reserves nothing; FTS5
external-content table can be added in a later migration).

---

## 7. Performance budget

Target: **60 fps sustained on the slowest iOS 26-capable iPhone while streaming**
(16.67 ms/frame; ProMotion devices must simply never regress below 60).

### 7.1 Budget table

| Stage | Where | Budget |
|---|---|---|
| SSE line parse + JSON decode | engine actor (off-main) | ≤ 100 µs/chunk typical; decode never on main |
| Reducer `apply` | engine actor | ≤ 200 µs/chunk (string append + index lookup) |
| Snapshot build (copy-on-write value snapshot of last message + counters) | engine actor | ≤ 1 ms |
| UI flush cadence | timer in engine actor | **75 ms** steady-state (matches web `CHAT_UI_UPDATE_THROTTLE_MS`); immediate flush on `finish` / `error` / first chunk after connect |
| Main-thread work per flush (store mutation + SwiftUI diff + live-tail layout) | main actor | ≤ 8 ms (half a frame) |
| Markdown re-parse | main actor, flush-gated | live tail block only; frozen blocks cached |

Chunk rates are tens to hundreds per second at peak; at 75 ms coalescing the main
thread sees ≤ 14 updates/s regardless of token rate.

### 7.2 Main-thread discipline

- Pipeline: `AsyncBytes (URLSession) → parser → reducer (ChatTurnEngine actor) →
  coalesced snapshot → @MainActor ChatStore → SwiftUI`. **Chunks never touch the main
  actor individually.**
- `ChatStore` is `@MainActor @Observable`; `messages` is an array of value-type
  `UIMessage`. During a turn only the **last element is replaced** per flush, so
  `@Observable` access tracking invalidates only views reading the streaming message.
- Stable identities everywhere: message `id` for rows; part identity = text/reasoning
  block `id`, `toolCallId`, or `(data name, id)` — so `ForEach` never recreates rows
  mid-stream.
- Transcript container: `ScrollView` + `LazyVStack` with per-message row views;
  scroll-to-bottom pinning uses `scrollPosition(_:anchor:)` and disengages when the user
  scrolls up (no programmatic scroll per flush while disengaged).

### 7.3 Incremental text layout strategy

Markdown re-layout of a growing message is the dominant cost. Strategy:

1. Split each assistant `text` part into **frozen blocks** and a **live tail**. A block
   freezes when a complete Markdown block element is closed (blank-line boundary,
   closed code fence) or when `text-end` / `finish-step` arrives.
2. Frozen blocks render from **cached `AttributedString`s** (parsed once, stored
   alongside the snapshot); SwiftUI never re-diffs their content again.
3. The live tail renders as a plain `Text(verbatim:)` (no Markdown parse per flush);
   on freeze it is parsed once and promoted to a frozen block. (Trade-off: raw Markdown
   syntax is briefly visible in the tail; web's Streamdown has the same flash.)
4. Code blocks: no syntax highlighting while `state == "streaming"`; highlight once on
   freeze.
5. Reasoning parts render collapsed by default (header + shimmer) — collapsed content
   costs zero layout until expanded.

### 7.4 Verification

`06-testing-strategy.md` owns the harness; budget checks: an XCTest `measure` (XCTest
is mandatory for metrics) replaying the long-stream fixture (§8.2 #04) through the
reducer asserting throughput ≥ 5 000 chunks/s on CI hardware, and an on-device manual
QA pass with Instruments' Hangs + Core Animation FPS instruments while replaying the
same fixture through the stub transport (`os_signpost` intervals around flush/apply per
`07-observability.md`).

---

## 8. Testability hooks

### 8.1 Recorded stream fixtures — capture procedure

Fixtures are **raw SSE wire bodies** captured from the real API, checked in verbatim
(post-sanitization) so the parser/reducer test against true server bytes.

Location: `ios/Packages/ChatEngine/Tests/ChatEngineTests/Fixtures/`
(declared as `resources: [.process("Fixtures")]` in `Package.swift`, loaded via
`Bundle.module`).

Capture against a local dev server (test-auth path, no OAuth needed):

```bash
# 1. Start the web app (repo root). NODE_ENV=development enables test-auth.
bun run web

# 2. Shell variables
BASE=http://localhost:3000
COOKIE="open_agents_test_user_id=dev-managed-runtime-user"   # TEST_AUTH_COOKIE/TEST_AUTH_USER_ID, apps/web/lib/session/test-auth.ts

# 3. Create a sandbox-free session (omit repoOwner/repoName → chat-safe tools only)
curl -s -X POST "$BASE/api/sessions" \
  -H "content-type: application/json" -H "cookie: $COOKIE" \
  -d '{"title":"fixture-capture"}' | tee /tmp/session.json
SESSION_ID=$(jq -r '.id // .session.id' /tmp/session.json)

# 4. Get the auto-created initial chat id
CHAT_ID=$(curl -s "$BASE/api/sessions/$SESSION_ID/chats" -H "cookie: $COOKIE" | jq -r '.chats[0].id')

# 5. Capture a turn. -N/--no-buffer preserves chunk timing-independent raw bytes.
curl -sN --no-buffer -X POST "$BASE/api/chat" \
  -H "content-type: application/json" -H "cookie: $COOKIE" \
  -D /tmp/headers.txt \
  -d "{\"sessionId\":\"$SESSION_ID\",\"chatId\":\"$CHAT_ID\",\"messages\":[{\"id\":\"fixture-user-0001\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"Reply with exactly one short sentence.\"}]}]}" \
  > 01-plain-text-turn.sse.txt
grep -i "x-vercel-ai-ui-message-stream\|x-workflow-run-id" /tmp/headers.txt   # sanity check

# 6. Capture a resume replay: start a long turn (e.g. ask for a multi-step task),
#    then in a second terminal while it is still streaming:
curl -sN --no-buffer "$BASE/api/chat/$CHAT_ID/stream" -H "cookie: $COOKIE" \
  > 07-resume-replay.sse.txt

# 7. Capture the 204 case after the run finishes (record status only):
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/chat/$CHAT_ID/stream" -H "cookie: $COOKIE"   # expect 204
```

Capture rules:

- If POST `/api/chat` returns `403 {"error":"Access denied"}` locally, BotID is
  enforcing; resolve per `02-api-contract-and-networking.md` (BotID native-client
  exemption workstream) — do not hack around it in fixtures.
- Tool-call fixtures need a repo-backed session (`repoOwner`/`repoName` in step 3) so
  `bash`/`read`/`edit` tools exist; expect multi-minute captures while the sandbox boots
  (the `data-workspace-status` chunks are exactly what we want recorded).
- Sanitize before commit: replace session/chat/user ids with `ses_fixture`,
  `chat_fixture`, etc.; strip any tokens from `data-runtime-proof`/tool outputs. Keep a
  `Fixtures/README.md` documenting the capture date, server git SHA, and the exact
  prompt used, so fixtures can be re-recorded when the contract evolves (CI drift
  guard for the REST contract lives in `02-api-contract-and-networking.md`; SSE fixtures
  are refreshed manually when `ai` is upgraded server-side).
- Once the bearer auth from `04-auth.md` ships, the same captures work against preview
  deployments with `-H "authorization: Bearer $OPEN_AGENTS_TOKEN"` instead of the
  cookie.

### 8.2 Fixture catalog and naming

Naming: `NN-<kebab-scenario>.sse.txt` paired with `NN-<kebab-scenario>.expected.json`
(the golden output, §8.3) and optionally `NN-<kebab-scenario>.history.json` (initial
message history when the turn continues an assistant message).

| # | Fixture | Must contain |
|---|---|---|
| 01 | `01-plain-text-turn.sse.txt` | `start`, one step, one text block, `message-metadata`, `finish`, `[DONE]` |
| 02 | `02-reasoning-and-text.sse.txt` | reasoning block before text, `providerMetadata` present |
| 03 | `03-single-tool-call.sse.txt` | full tool-input streaming sequence + `tool-output-available` in next step (`bash`) |
| 04 | `04-multi-step-long-turn.sse.txt` | ≥ 5 steps, ≥ 2 000 chunks, multiple tools, `data-commit`/`data-pr` pending→resolved — also the perf fixture (§7.4) |
| 05 | `05-ask-user-question-pause.sse.txt` | turn ending with `tool-ask_user_question` in `input-available` |
| 06 | `06-task-subagent-preliminary.sse.txt` | repeated `tool-output-available` with `preliminary: true` then final |
| 07 | `07-resume-replay.sse.txt` | GET-resume capture: full replay then live continuation |
| 08 | `08-error-mid-stream.sse.txt` | in-band `error` chunk |
| 09 | `09-setup-error.sse.txt` | synthetic text block with id `setup-error` |
| 10 | `10-verified-build-divert.sse.txt` | `data-verified-build` synthetic stream |
| 11 | `11-stop-truncated.sse.txt` | EOF without `finish` (capture by stopping from the web UI mid-turn) |
| 12 | `12-workspace-status-transient.sse.txt` | repeated transient `data-workspace-status` updates |
| 13 | `13-dynamic-tool-composio.sse.txt` | `dynamic: true` tool chunks → `dynamic-tool` part |
| 14 | `14-unknown-chunk-types.sse.txt` | **hand-edited**: real fixture plus injected `{"type":"future-thing"}`, `data-new-feature`, an SSE comment line, and one malformed JSON line — exercises leniency |

Hand-edited fixtures are marked `# SYNTHETIC` in `Fixtures/README.md`; all others must
be raw captures.

### 8.3 Reducer golden tests

For each fixture: parse → apply → canonical-JSON-encode the resulting messages →
byte-compare against the committed `.expected.json`. Swift Testing, parameterized:

```swift
// ios/Packages/ChatEngine/Tests/ChatEngineTests/ReducerGoldenTests.swift
import Testing
@testable import ChatEngine

@Test(arguments: try FixtureCatalog.allGolden())   // discovers NN-*.sse.txt in Bundle.module
func reducerGolden(_ fixture: GoldenFixture) throws {
  var state = ChatTurnState(messages: fixture.initialHistory)   // from .history.json, default []
  for chunk in try SSEFixtureLoader.chunks(fixture.sseData) {   // same parseSSELine + decoder as production
    state.apply(chunk)
  }
  let actual = try CanonicalJSON.encode(state.messages)         // JSONEncoder, .sortedKeys, no whitespace
  #expect(actual == fixture.expectedJSON, "Golden mismatch for \(fixture.name)")
}
```

Conventions:

- `CanonicalJSON` uses `JSONEncoder` with `outputFormatting = [.sortedKeys]` so goldens
  are diffable and deterministic.
- Regenerating goldens: `OPEN_AGENTS_RECORD_GOLDENS=1 swift test` writes
  `.expected.json` files instead of asserting (env-gated, mirroring
  swift-snapshot-testing's record modes; CI never sets it).
- **Replay-idempotence test** (the resume invariant): apply fixture 04 to fresh state
  twice in two separate states, and once via "rebuild" (fresh state seeded with the
  final history, replay applied) — all three final JSONs must be byte-equal.
- **Round-trip test**: decode every `.expected.json` through `UIMessage` and re-encode —
  byte-equal (proves history echo-back fidelity for §5.1, including unknown parts).
- Transient-data test: fixture 12 must produce zero `data-workspace-status` parts and
  N callback invocations.
- Parser unit tests (separate file): `data:` with/without space, `[DONE]`, comment
  lines, empty lines, malformed JSON skip, CRLF input, payload split across byte-chunk
  boundaries.

### 8.4 Stream replay harness

For engine-level tests (timing, cancellation, reconnect) the fixtures replay through a
`URLProtocol` stub that serves the `.sse.txt` bytes in randomized 1–64-byte slices with
~10 ms delays, on the streaming `URLSessionConfiguration`. The same stub powers
snapshot tests of transcript states (swift-snapshot-testing 1.18.x, `.record(.never)`
in CI) and the SwiftUI preview catalog. Harness implementation and FlyingFox-based
integration tier live in `06-testing-strategy.md`; the chat engine only guarantees that
`ChatStreamClient` takes an injectable `URLSession`.

---

## 9. Definition of done (engine milestone)

- [ ] `UIMessageChunk` decodes all 26 chunk shapes in §1.4, unknown-safe, with unit tests per shape.
- [ ] `UIMessage`/`UIMessagePart` round-trips every fixture's `.expected.json` byte-identically.
- [ ] SSE parser passes the edge-case suite (§8.3 last bullet).
- [ ] Reducer passes all golden fixtures (01–14) including replay-idempotence.
- [ ] Resume behavior: rebuild-never-append verified against fixture 07; `204` path refetches and reconciles.
- [ ] Send flow with optimistic insert, `pending_send → synced` transition, all rollback rows in §5.3 covered by tests.
- [ ] Auto-resubmit and `ask_user_question` round trip pass an engine-level test using fixtures 03 and 05.
- [ ] Stop flow: snapshot POSTed, local cancel, `userStopped` suppresses reconnect.
- [ ] GRDB write points (§6.3) covered by Persistence tests; no write occurs between flush boundaries during streaming.
- [ ] Perf: fixture 04 reducer throughput ≥ 5 000 chunks/s in the XCTest measure; manual Instruments pass shows no main-thread hang > 100 ms while replaying fixture 04 through the stub UI.
- [ ] Signposts and counters wired per `07-observability.md` (chunks decoded, chunks skipped, flushes, reconnects, decode failures).
