# Research Brief 22: Consuming the Vercel AI SDK UI-Message SSE Stream from Swift

Scope: everything an iOS (Swift/SwiftUI) plan author needs to consume the open-agents chat stream — the exact wire protocol as shipped by THIS repo (ai@6.0.168), the message-reconstruction state machine, resume/reconnect semantics, Swift SSE consumption mechanics, library recommendation, UI batching patterns, and the JSON decoding strategy.

Verified against the actually installed package: `node_modules/.bun/ai@6.0.168+3c5d820c62823f0b/node_modules/ai` (catalog pin `"ai": "^6.0.165"` at `/Users/dennison/develop/open-agents/package.json:10`). All `dist/` line refs below are into that installed `ai` package. This is AI SDK **v6** — the protocol is the "UI message stream" introduced in v5 and carried forward in v6 with additions (`tool-approval-request`, `tool-output-denied`, `abort`, `message-metadata`).

---

## 1. Repo ground truth: the endpoints an iOS client talks to

### POST `/api/chat` — start a turn, returns the SSE stream

`/Users/dennison/develop/open-agents/apps/web/app/api/chat/route.ts:88-378`.

- Request body (`apps/web/app/api/chat/_lib/request.ts:3-35`): `{ messages: WebAgentUIMessage[], sessionId: string, chatId: string, workflowId?, inputValues?, workflowSchema?, workflowSchemaVersion? }`. `sessionId` and `chatId` are **required** (400 otherwise, `request.ts:74-90`). Note the AI SDK's default web transport sends `id`/`trigger`/`messageId` fields too (`dist/index.mjs:12784-12791`) — the server ignores them; the iOS client only needs the fields above.
- Auth: better-auth session cookie; unauthenticated → 401. Also BotID check → 403 (`route.ts:97-100`).
- Success: `createUIMessageStreamResponse(...)` SSE body with extra headers `x-workflow-run-id` and `x-request-id` (`route.ts:371-377`). The agent runs as a **durable Vercel Workflow** server-side (`start(runAgentWorkflow, ...)`, `route.ts:307`), so client disconnects do NOT stop generation.
- Concurrency: if a workflow is already running for the chat, the POST **resumes** the existing stream (same SSE response shape, header `x-workflow-run-id`) or returns **409** (`route.ts:143-162`, `395-437`).
- Verified-build branch: some messages get routed to a harness; the response is then a short synthetic stream containing a `data-verified-build` part + text + finish (`route.ts:52-86`), with header `x-verified-build-run-id` (`route.ts:217-227`).
- Other errors: 422/403/409 JSON bodies for workflow-input validation (`route.ts:269-296`), 400 archived session (`route.ts:136-138`).

### GET `/api/chat/[chatId]/stream` — resume an active stream

`/Users/dennison/develop/open-agents/apps/web/app/api/chat/[chatId]/stream/route.ts:17-66`.

- **204 No Content** when there is no active stream (or the workflow finished/was cancelled/failed — the server lazily clears the stale `activeStreamId`).
- Otherwise: the same SSE response (`createUIMessageStreamResponse`) attached to the running workflow's readable.
- **Replay semantics: the workflow readable replays already-emitted chunks from the beginning of the run.** Evidence: the web hook deliberately computes `resume` only once on mount because re-triggering `resumeStream()` would "replay recent chunks on top of the live stream, causing visible jank" (`apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-session-chat-runtime.ts:181-187`). The iOS reducer must therefore rebuild the in-flight assistant message **from scratch** on resume (see §5).
- This matches the AI SDK's client convention: `HttpChatTransport.reconnectToStream()` GETs `${api}/${chatId}/stream`, treats 204 as "nothing to resume" (returns null, no error), throws on non-OK (`dist/index.mjs:12814-12852`). Docs: [Resume Streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams) (the docs note multiple clients can attach to the same stream simultaneously).

### Persisted history fallback

`GET /api/sessions/[sessionId]/chats/[chatId]/messages` exists (`apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/route.ts`) — after a 204 on the resume probe, refetch persisted messages instead of trusting locally accumulated partial state.

### Stop semantics

There is no "stop generation" via closing the socket — aborting the HTTP request is only a disconnect; the durable workflow keeps running (web client wraps this in `AbortableChatTransport`, `apps/web/lib/abortable-chat-transport.ts:20-55`). A real stop requires the app's cancel endpoint (out of scope here; the web app cancels via workflow APIs).

---

## 2. Exact wire format (as emitted by ai@6.0.168)

From `JsonToSseTransformStream` (`dist/index.mjs:5002-5015`) and `UI_MESSAGE_STREAM_HEADERS` (`dist/index.mjs:5018-5024`):

- Every chunk is one SSE event: `data: ${JSON.stringify(chunk)}\n\n` — a single `data:` line, JSON payload, blank-line terminated. **No `event:`, `id:`, or `retry:` fields are ever emitted.**
- Stream termination: a final `data: [DONE]\n\n` is enqueued on flush. The official client ignores it (`@ai-sdk/provider-utils dist/index.mjs:2291-2293` — `if (data === "[DONE]") return;`) and treats EOF as end.
- Response headers:
  - `content-type: text/event-stream`
  - `cache-control: no-cache`
  - `connection: keep-alive`
  - `x-vercel-ai-ui-message-stream: v1` (protocol marker — assert this on the iOS side before parsing)
  - `x-accel-buffering: no`
- The official client parses with a spec-compliant SSE parser (`eventsource-parser`) then JSON-decodes each `data` payload against the chunk schema (`parseJsonEventStream`, provider-utils `dist/index.mjs:2284-2298`; wired in `DefaultChatTransport.processResponseStream`, ai `dist/index.mjs:12860-12878`).
- **No heartbeat/ping comments are emitted by `JsonToSseTransformStream`** (the docs marketing line "keep-alive through ping" notwithstanding — I found no ping in the v6 server code). Idle gaps of minutes are possible while a tool (e.g. a long bash command in the sandbox) executes. Plan timeouts accordingly (§6). Still, per SSE spec, tolerate and skip `:` comment lines defensively (infrastructure may inject them).

Official protocol docs: [Stream Protocols — AI SDK UI](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) (documents the SSE format, the `x-vercel-ai-ui-message-stream: v1` header requirement, each part type with JSON examples, and the `data: [DONE]` terminator).

---

## 3. Complete chunk-type catalog (ai@6.0.168)

Authoritative union from the installed `UIMessageChunk` type / `uiMessageChunkSchema` (`dist/index.d.ts:2027-2152` and `2160-2270`). Discriminator is the string field `type`. Fields marked `?` are optional. `ProviderMetadata` is an arbitrary JSON object; ignore or store opaquely.

| `type` | Fields | Notes |
|---|---|---|
| `start` | `messageId?: string`, `messageMetadata?: <metadata>` | New assistant message; sets the message id |
| `start-step` | — | Push a `step-start` part (visual step boundary) |
| `text-start` | `id: string`, `providerMetadata?` | Opens a text block keyed by `id` |
| `text-delta` | `id: string`, `delta: string`, `providerMetadata?` | Append `delta` to text block `id` |
| `text-end` | `id: string`, `providerMetadata?` | Close text block `id` |
| `reasoning-start` | `id: string`, `providerMetadata?` | Same start/delta/end pattern as text |
| `reasoning-delta` | `id: string`, `delta: string`, `providerMetadata?` | |
| `reasoning-end` | `id: string`, `providerMetadata?` | |
| `tool-input-start` | `toolCallId: string`, `toolName: string`, `providerExecuted?: bool`, `dynamic?: bool`, `title?: string`, `providerMetadata?` | Tool call begins; input will stream |
| `tool-input-delta` | `toolCallId: string`, `inputTextDelta: string` | Raw JSON-text fragment of the input |
| `tool-input-available` | `toolCallId`, `toolName`, `input: <any JSON>`, `providerExecuted?`, `dynamic?`, `title?`, `providerMetadata?` | Final parsed input |
| `tool-input-error` | `toolCallId`, `toolName`, `input`, `errorText: string`, + same optionals | Input failed validation |
| `tool-approval-request` | `approvalId: string`, `toolCallId: string` | v6 human-in-the-loop gate |
| `tool-output-available` | `toolCallId`, `output: <any JSON>`, `providerExecuted?`, `dynamic?`, `preliminary?: bool` , `providerMetadata?` | `preliminary: true` = partial output, more coming |
| `tool-output-error` | `toolCallId`, `errorText: string`, `providerExecuted?`, `dynamic?`, `providerMetadata?` | |
| `tool-output-denied` | `toolCallId` | Approval was denied |
| `source-url` | `sourceId`, `url`, `title?`, `providerMetadata?` | |
| `source-document` | `sourceId`, `mediaType`, `title`, `filename?`, `providerMetadata?` | |
| `file` | `url: string`, `mediaType: string`, `providerMetadata?` | |
| `data-${string}` | `data: <any JSON>`, `id?: string`, `transient?: bool` | App-defined typed parts (see below) |
| `finish-step` | — | Closes a step; resets open text/reasoning blocks |
| `finish` | `finishReason?: "stop"\|"length"\|"content-filter"\|"tool-calls"\|"error"\|"other"`, `messageMetadata?` | End of the assistant message |
| `abort` | `reason?: string` | Stream aborted server-side |
| `message-metadata` | `messageMetadata: <metadata>` | Mid-stream metadata merge |
| `error` | `errorText: string` | Surfaced as an error callback, NOT message content |

### This app's `data-*` parts and metadata

`/Users/dennison/develop/open-agents/apps/web/app/types.ts:155-162` defines the data part payloads the iOS app must render: `data-commit` (`WebAgentCommitData`, types.ts:40-48), `data-pr` (types.ts:50-59), `data-snippet` (types.ts:61-64), `data-workspace-status` (types.ts:66-72, re-sent repeatedly with the same `id` to update setup progress + log lines), `data-verified-build` (types.ts:74-81), `data-runtime-proof` (types.ts:83-153). Message metadata is `WebAgentMessageMetadata` (types.ts:21-37): model id, inference route/profile, per-step + total usage and gateway cost, finish reasons. All optional — decode leniently.

Unknown `type` values **must not** crash the decoder (forward compatibility — the server team can add chunk and data types any time). Decode to an `.unknown(type:)` case and skip.

---

## 4. Reducer semantics: rebuilding a `UIMessage` from chunks

The reference state machine is `processUIMessageStream` (`dist/index.mjs:5282-5800`) plus `createStreamingUIMessageState` (`dist/index.mjs:5266-5281`). The iOS app must reimplement this. Key rules:

1. **State**: one in-flight assistant message + `activeTextParts: [id: TextPart]` + `activeReasoningParts: [id: ReasoningPart]` + `partialToolCalls: [toolCallId: accumulated input text]`.
2. **Continuation**: if the last existing message is `role == "assistant"`, the stream *continues* that message (parts get appended to it); otherwise a fresh assistant message is created (`dist/index.mjs:5266-5281`). `start.messageId` overwrites the message id (`5736-5745`). After the stream, the UI replaces the last message when ids match, else appends (`dist/index.mjs:13190-13202`).
3. **Text**: `text-start` pushes a new text part (`state: "streaming"`) and registers it by `id`; `text-delta` appends to that part's `text` (the official client **throws** if no matching start was seen — `5428-5446`; iOS should be more lenient: synthesize a part); `text-end` marks `state: "done"` and unregisters.
4. **Reasoning**: identical pattern (`5457-5530`).
5. **Tools**: parts are keyed by `toolCallId` and live in the parts array as `tool-<toolName>` (or `dynamic-tool`) parts with a `state` progression: `input-streaming` → `input-available` → (`approval-requested` →) `output-available` / `output-error` / `output-denied`. `tool-input-delta` accumulates raw JSON text; the web client runs `parsePartialJson` on every delta to render partial args — on iOS it is fine to accumulate the raw string and only JSON-parse at `tool-input-available` (cheaper; render the raw text while streaming). `tool-output-available` with `preliminary: true` updates output but keeps the part updatable (`5668-5697`). Updates mutate the existing part in place; if no part exists yet one is pushed (`updateToolPart`, `5310-5352`).
6. **`data-*`**: if the chunk has an `id` and a part with the same `type`+`id` exists, **replace its `data`** (this is how `data-workspace-status` progress updates work); else append a new part. `transient: true` chunks are never stored in the message — they only fire a callback (`5766-5799`).
7. **Steps**: `start-step` appends a `{type:"step-start"}` part; `finish-step` clears `activeTextParts`/`activeReasoningParts` (so a new step's text opens a new visual block) (`5727-5735`).
8. **Metadata**: `start`/`finish`/`message-metadata` deep-merge `messageMetadata` into `message.metadata` (`5736-5763`).
9. **`error`**: route to an error handler/banner; do not append message content (`5764-5766`).
10. Tool chunks for *client-executed* tools also drive an `onToolCall` callback in the SDK — irrelevant for iOS v1 (all tools execute server-side in the sandbox; `providerExecuted`/server tools just stream through as parts).

---

## 5. Reconnection strategy for iOS

What the web client does (precedent worth copying):

- On mount with a known `activeStreamId`, probe `GET /api/chat/{chatId}/stream`; 204 → nothing running (`use-session-chat-runtime.ts:113-142, 181-199`).
- Errors mid-stream (the comment literally names iOS Safari's "Load failed") trigger auto-recovery: stop the local fetch, then `resumeStream()` (`use-session-chat-runtime.ts:200-250`).
- A reactive fallback probes the resume endpoint when the chat ends with an unanswered user message (`use-session-chat-runtime.ts:280-345`).

Recommended iOS design:

1. **Clean-finish detection**: a turn is complete when the reducer saw `finish` (and/or `data: [DONE]` / EOF after it). EOF *without* `finish` = dirty disconnect → schedule reconnect.
2. **Reconnect = GET resume endpoint**, never re-POST (re-POST with the same messages while a run is active happens to resume in this repo, but 409 is also possible; GET is the contract). Backoff: exponential with jitter, e.g. 0.5s → 1s → 2s → max ~15s, reset after a successful connection that lives > ~60s (mirrors LaunchDarkly's `backoffResetThreshold` idea).
3. **Replay handling (critical)**: because this server replays the run's chunks from the start (§1), on every resume **discard the locally accumulated partial assistant message for the in-flight turn and rebuild from chunk 0**. Do not run the replayed stream on top of existing partial state — the official continuation rule (§4.2) would duplicate text parts (the exact "jank" the web hook avoids). Match messages by the `start.messageId`: when the rebuilt message's id equals the last local message's id, replace it wholesale.
4. **204 on resume** → the run finished while disconnected → refetch persisted messages (`GET /api/sessions/{sessionId}/chats/{chatId}/messages`) to get the canonical final state.
5. **Foreground/background**: reconnect on `scenePhase == .active` whenever a turn was in flight; also observe `NWPathMonitor` for network-change reconnects.
6. There is no `Last-Event-ID`/SSE-`retry:` mechanism in this protocol — all resumption is the app-level GET endpoint.

---

## 6. Swift SSE consumption mechanics

### Parsing with `URLSession.bytes(for:)`

`URLSession.shared.bytes(for: request)` (iOS 15+) returns `(URLSession.AsyncBytes, URLResponse)` once headers arrive; the body is consumed incrementally as an `AsyncSequence` ([WWDC21 "Use async/await with URLSession"](https://developer.apple.com/videos/play/wwdc2021/10095/)). Two viable parse levels:

- **Line level** (sufficient for THIS protocol): `for try await line in bytes.lines { ... }`. `AsyncLineSequence` buffers across arbitrary chunk boundaries and recognizes LF/CR/CRLF, so a JSON payload split across TCP segments is reassembled for free. Because the AI SDK only ever emits single-line `data:` events, you do not need blank-line event reassembly: for each line, if it has the prefix `data:`, trim one optional leading space, then handle `[DONE]` or JSON-decode. Skip empty lines and lines starting with `:` (comments). Caveat: `.lines` drops the blank lines that delimit SSE events, so this shortcut is only correct while the protocol stays one-`data:`-line-per-event — which `JsonToSseTransformStream` guarantees today (§2). Example of this pattern in the wild: [Streaming messages from ChatGPT using Swift AsyncSequence](https://zachwaugh.com/posts/streaming-messages-chatgpt-swift-asyncsequence).
- **Spec-compliant level** (robust to future multi-line events/comments/CR endings): feed bytes into a real SSE parser (see §7) — e.g. `mattt/EventSource`'s `Parser` actor or its `bytes.events` AsyncSequence extension.

Always check the `URLResponse` first: require `httpResponse.statusCode == 200` and (recommended) `x-vercel-ai-ui-message-stream == "v1"`; handle 204 (resume), 401, 409, and JSON error bodies before iterating bytes.

### Timeouts

Apple's semantics ([URLSessionConfiguration quick guide](https://useyourloaf.com/blog/urlsessionconfiguration-quick-guide/), [SwiftLee on reachability/timeouts](https://www.avanderlee.com/swift/optimizing-network-reachability/)):

- `timeoutIntervalForRequest` (default **60s**) is an **idle** timer — it resets every time bytes arrive. Dangerous here: the agent stream can legitimately go silent for minutes while a sandbox bash command runs (no ping chunks, §2). Use a dedicated `URLSessionConfiguration` for streaming with `timeoutIntervalForRequest` raised to ~300–600s.
- `timeoutIntervalForResource` (default **7 days**) caps the whole transfer — leave high (agent turns can run very long; the repo's workflow allows up to 500 steps, `route.ts:316`).
- Set `waitsForConnectivity = true` for the initial connect; keep a separate, normal-timeout session for plain REST calls.
- Belt-and-braces liveness: an app-level watchdog (e.g. if no chunk for N minutes, probe the resume endpoint with a fresh connection) instead of relying on the idle timer.

### Foreground/background lifecycle

- Networking continues while the app is **running** in the background, but iOS **suspends** most apps shortly after backgrounding, and on current systems socket resources are reclaimed as soon as the app is suspended — the stream dies ([Apple Developer Forums: SSE stream in background, Quinn's answer referencing TN2277](https://developer.apple.com/forums/thread/117150), [WebSocket background thread](https://developer.apple.com/forums/thread/716118)).
- `UIApplication.beginBackgroundTask` buys roughly **30 seconds** (up to ~3 min historically; treat 30s as the budget) of continued execution — use it to drain in-flight chunks and persist reducer state, not to keep streaming ([WWDC19 Advances in App Background Execution](https://developer.apple.com/videos/play/wwdc2019/707/), [Swift forums discussion](https://forums.swift.org/t/how-do-i-make-a-network-call-that-is-longer-than-30-seconds/75445)).
- `URLSessionConfiguration.background` is **not** an option for SSE: background sessions hand transfers to `nsurlsessiond` as download/upload tasks and do not deliver streamed bytes to your process incrementally ([Apple forums on background URLSession behavior](https://developer.apple.com/forums/thread/773557)).
- Correct model for this product: the server is durable (workflow keeps running), so backgrounding is harmless — cancel/let-die the stream on suspension, then on foreground probe `GET /api/chat/{chatId}/stream` and rebuild (§5). Push notifications (APNs) are the only real "notify me when the agent finishes while I'm away" mechanism — flag as a separate feature.

---

## 7. Library vs hand-rolling — recommendation

| Option | Verdict |
|---|---|
| [launchdarkly/swift-eventsource](https://github.com/launchdarkly/swift-eventsource) (LDSwiftEventSource, v3.3.0) | Mature, battle-tested (powers the LaunchDarkly SDK), built-in backoff+jitter+`backoffResetThreshold`, honors 204-stops-retries. **Not recommended here**: delegate/callback API (not async/await), and its automatic reconnection replays the *same original request* with `Last-Event-ID` — wrong for our POST-then-GET-resume protocol (re-POSTing `/api/chat` on retry could 409 or double-submit). You'd disable its core feature. |
| [mattt/EventSource](https://github.com/mattt/EventSource) (v1.4+) | Modern Swift-6, spec-compliant, exposes exactly the right seam: an `EventSource.Parser` actor you can feed bytes, plus a `bytes.events` AsyncSequence over `URLSession.AsyncBytes`, while **you** own the request and the reconnect policy. Handles LF/CR/CRLF, BOM, multi-line `data`, comments. **Recommended if taking a dependency.** |
| Hand-roll | Entirely reasonable: the protocol is single-line `data:` JSON + `[DONE]` (§2). ~50 lines over `bytes.lines` with prefix matching and a `[DONE]` check. Zero dependencies, but you accept the (currently theoretical) risk of future multi-line events. |

**Recommendation**: hand-roll the line-level parser inside a small `ChatStreamClient` actor, but structure it so the parse step is swappable; if the team prefers a dependency, use `mattt/EventSource`'s parser. Avoid LDSwiftEventSource. In all cases implement reconnection yourself per §5 — no SSE library knows about the GET-resume + full-replay contract.

---

## 8. Incremental message UI off the main thread

Pipeline (mirrors the SDK's serialized `jobExecutor` + the web app's 75ms throttle):

```
URLSession.AsyncBytes ──lines──▶ parse ──▶ UIMessageChunk
        (background)                          │
                                   ChatStreamReducer (actor)
                                   mutates ChatTurnState
                                              │  (coalesced)
                                   AsyncStream<MessageSnapshot>
                                              │
                              @MainActor @Observable ChatStore
                                              │
                                          SwiftUI views
```

- **Reduce off-main**: run the chunk reducer in an `actor` (or a dedicated `Task` consuming an `AsyncStream<UIMessageChunk>`); chunks arrive at LLM token rate (tens–hundreds/s) and must never hit SwiftUI one-by-one.
- **Batch UI flushes**: publish immutable snapshots of the in-flight message to the main actor at a fixed cadence — the web app uses **75 ms** (`CHAT_UI_UPDATE_THROTTLE_MS`, `use-session-chat-runtime.ts:29,195`; passed as `experimental_throttle`), which is a good starting point (13 fps perceived typing is smooth; avoids 120 Hz ProMotion invalidation thrash). Implementation: in the reducer, mark `dirty = true` per chunk; a timer task (`Task { while ... { try await Task.sleep(for: .milliseconds(75)); if dirty { await MainActor.run { store.apply(snapshot) } } } }`) drains; flush immediately on terminal chunks (`finish`, `error`, `abort`).
- **Store design**: `@MainActor @Observable final class ChatStore` holding `var messages: [Message]` of value-type messages. Only the last (streaming) message changes during a turn; replace just that element so SwiftUI's `@Observable` access tracking limits invalidation to views reading the streaming message. Give each part a stable identity (`text` block id, `toolCallId`, `data` part id) so `ForEach` doesn't recreate rows.
- **Text rendering cost**: re-parse Markdown/AttributedString only on the 75 ms flush, not per delta; consider rendering only the trailing paragraph as "live" and freezing earlier paragraphs once a `text-end`/`finish-step` arrives.
- The SDK serializes reducer jobs to avoid races (`SerialJobExecutor`, `dist/index.mjs:13184-13189`); an `actor` gives Swift this for free.

---

## 9. Decoding the discriminated union in Swift

Decode on the `type` field with a custom `init(from:)`; keep arbitrary-JSON fields (`input`, `output`, `data`) as a recursive `JSONValue`; never throw on unknown types:

```swift
enum JSONValue: Codable, Sendable { // recursive any-JSON
  case string(String), number(Double), bool(Bool), null
  case array([JSONValue]), object([String: JSONValue])
  // init(from:): try each container type in turn
}

enum UIMessageChunk: Sendable {
  case start(messageId: String?, metadata: JSONValue?)
  case startStep, finishStep
  case textStart(id: String), textDelta(id: String, delta: String), textEnd(id: String)
  case reasoningStart(id: String), reasoningDelta(id: String, delta: String), reasoningEnd(id: String)
  case toolInputStart(toolCallId: String, toolName: String, dynamic: Bool?, title: String?)
  case toolInputDelta(toolCallId: String, inputTextDelta: String)
  case toolInputAvailable(toolCallId: String, toolName: String, input: JSONValue)
  case toolInputError(toolCallId: String, toolName: String, errorText: String)
  case toolApprovalRequest(approvalId: String, toolCallId: String)
  case toolOutputAvailable(toolCallId: String, output: JSONValue, preliminary: Bool?)
  case toolOutputError(toolCallId: String, errorText: String)
  case toolOutputDenied(toolCallId: String)
  case sourceUrl(sourceId: String, url: String, title: String?)
  case sourceDocument(sourceId: String, mediaType: String, title: String)
  case file(url: String, mediaType: String)
  case data(name: String, id: String?, data: JSONValue, transient: Bool?) // type == "data-<name>"
  case finish(finishReason: String?, metadata: JSONValue?)
  case abort(reason: String?)
  case messageMetadata(JSONValue)
  case error(errorText: String)
  case unknown(type: String) // forward compatibility — NEVER throw
}

extension UIMessageChunk: Decodable {
  private enum CodingKeys: String, CodingKey { case type /* + per-case keys */ }
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let type = try c.decode(String.self, forKey: .type)
    switch type {
    case "text-delta": /* decode id + delta */ ...
    // ... one case per literal ...
    default:
      if type.hasPrefix("data-") { /* decode id?/data/transient; name = String(type.dropFirst(5)) */ }
      else { self = .unknown(type: type) }
    }
  }
}
```

Notes:

- Strongly-typed payloads for this app's known data parts (`data-commit`, `data-pr`, `data-workspace-status`, `data-snippet`, `data-verified-build`, `data-runtime-proof` — §3) and known tool outputs can be decoded in a **second stage** (`JSONValue → concrete struct`, or re-decode the raw `Data` slice per name) so one malformed payload degrades to a generic rendering instead of killing the stream. The fields of these payloads are typed but evolve; keep every field optional.
- `finishReason` and tool `state` as raw strings + computed enums (again forward-compatible).
- Decode each SSE `data` payload independently; on a single-chunk decode failure, log + skip rather than aborting the stream (the official client throws on schema mismatch — `dist/index.mjs:12869-12873` — but for a mobile client resilience beats strictness).
- Tool naming for parts: part type is `"tool-" + toolName` (or `dynamic-tool`); persisted messages fetched over REST use the same part shapes, so share the model types between the stream reducer and the history decoder.

---

## 10. Open questions / risks

1. **Does Vercel's edge/network layer inject SSE comments or split events?** Not observed in code; the parser should tolerate comment lines and rely only on `data:` prefix matching. Low risk.
2. **Exact replay window of `run.getReadable()`** (Vercel Workflow): code comments prove replay of prior chunks happens, but whether it is always from chunk 0 vs a recent window is not verifiable in this repo. Mitigation (§5.3 rebuild-from-scratch + reconcile by message id) is correct in either case, but verify against a live long run during implementation.
3. **Auth transport for iOS**: better-auth session cookie vs a token scheme for native clients is decided elsewhere; this brief assumes the stream requests carry whatever credential the auth workstream picks (cookie jar on the streaming `URLSession` works today).
4. **`tool-approval-request` flow**: the chunk exists in the protocol; whether open-agents' server emits it (and what the approval POST endpoint is) needs confirmation from the agent-tools brief before building UI for it.
5. **Idle-gap upper bound**: how long can the stream legitimately stay silent (longest sandbox command)? Determines the streaming session's `timeoutIntervalForRequest` and the watchdog threshold. Suggest measuring; 600s is a defensible default.
6. **APNs for completed runs while suspended** is the real answer to backgrounding; out of scope here but should exist on the roadmap.

## Sources

- Repo: files cited inline above (chat route, stream route, request lib, types, runtime hook, abortable transport) and installed `ai@6.0.168` + `@ai-sdk/provider-utils@4.0.23` dist sources.
- [AI SDK — Stream Protocols (UI message stream)](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [AI SDK — Resume Streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
- [Vercel blog — AI SDK 5 (SSE protocol switch, tool input streaming)](https://vercel.com/blog/ai-sdk-5)
- [WWDC21 — Use async/await with URLSession](https://developer.apple.com/videos/play/wwdc2021/10095/)
- [Zach Waugh — Streaming ChatGPT with Swift AsyncSequence](https://zachwaugh.com/posts/streaming-messages-chatgpt-swift-asyncsequence)
- [Use Your Loaf — URLSessionConfiguration quick guide (timeout semantics)](https://useyourloaf.com/blog/urlsessionconfiguration-quick-guide/)
- [SwiftLee — Optimizing for network reachability (timeoutIntervalForRequest vs Resource)](https://www.avanderlee.com/swift/optimizing-network-reachability/)
- [Apple Developer Forums — SSE stream when app goes to background (TN2277 guidance)](https://developer.apple.com/forums/thread/117150)
- [Apple Developer Forums — keep WebSocket alive in background](https://developer.apple.com/forums/thread/716118)
- [Apple Developer Forums — background URLSession behavior](https://developer.apple.com/forums/thread/773557)
- [WWDC19 — Advances in App Background Execution](https://developer.apple.com/videos/play/wwdc2019/707/)
- [launchdarkly/swift-eventsource](https://github.com/launchdarkly/swift-eventsource) and [release notes](https://github.com/launchdarkly/swift-eventsource/releases)
- [mattt/EventSource](https://github.com/mattt/EventSource)
- [MDN — Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
