# 07 — Observability

Status: planned. Sibling docs: `00-overview.md`, `01-product-and-ux.md`,
`02-api-contract-and-networking.md`, `03-architecture.md`, `04-auth.md`,
`05-streaming-chat-engine.md`, `06-testing-strategy.md`, `08-ci-cd-release.md`,
`09-step-by-step-build-guide.md`. Source research:
`docs/plans/ios-app/research/25-ios-observability.md` and
`docs/plans/ios-app/research/10-process-rules.md`. House rule being honored:
`docs/process/observability-discipline.md`.

Canonical stack (restated, not re-decided): Xcode 26.x, Swift 6.2 strict
concurrency, SwiftUI-only with `@Observable` MVVM, minimum iOS 26.0 / iPadOS
26.0, GRDB for persistence, XcodeGen, swift-openapi-generator 1.12.2 with
URLSession transport and `ClientMiddleware` auth headers, Swift Testing,
swift-snapshot-testing 1.18.x, thin XCUITest smoke suite, GitHub Actions
`macos-26`, TestFlight via App Store Connect API keys.

---

## 1. How the house observability discipline maps to iOS

`docs/process/observability-discipline.md` requires every decision, launch,
mutation, or completion claim to leave inspectable evidence. The iOS app
cannot grep production server logs from a device, so the same contract maps
onto client-side primitives:

| House requirement (`observability-discipline.md`) | iOS implementation in this plan |
|---|---|
| 1. User-visible status text | Connection / stream / sync state machines with stable copy keys (section 12; copy owned by `01-product-and-ux.md`) |
| 2. Structured workflow or chat data parts | Rendered from the AI SDK UI Message Stream parts (`05-streaming-chat-engine.md`); never synthesized client-side |
| 3. Tool output metadata | Displayed from stream parts; logged as counts/types only (section 7 content policy) |
| 4. Sandbox/profile/runtime attribution | The app surfaces server-provided attribution fields verbatim (`x-workflow-run-id`, `x-verified-build-run-id`, session events) — never infers them |
| 5. Logs or run records | OSLog (subsystem + 6 categories) plus an app-owned redacted JSONL ring buffer (sections 3–5, 10) |
| 6. Screenshots/browser/service evidence | Simulator screenshots + `xcrun simctl ... log` captures in PRs (`06-testing-strategy.md`, `10-process-rules.md` §E.5) |
| 7. Final answer verification notes | "Completion" in UI is backed by the persisted message refetch (`GET /api/sessions/{sessionId}/chats/{chatId}/messages`) and session events, not by "the stream ended" (anti-transcript-as-proof rule) |

The seven required questions from the discipline doc become a per-slice
checklist in section 14. Every iOS feature issue must fill the
`Observability and user feedback` template section using the vocabulary in
this document (event names, error kinds, copy keys) — "Add logs." is a
rejected answer per `docs/process/feature-ticket-format.md`.

---

## 2. Ownership: the `OpenAgentsObservability` package

All observability code lives in one local SPM package so it is testable
without the app target and importable by every other package.

```
ios/Packages/OpenAgentsObservability/
  Package.swift
  Sources/OpenAgentsObservability/
    AppLog.swift                  # Logger instances, subsystem constant
    LogEvent.swift                # structured event emitter (OSLog + ring buffer)
    LogCategory.swift             # the 6-category enum
    APIErrorKind.swift            # re-exported typealias; canonical enum in OpenAgentsAPI (02)
    Redactor.swift                # Swift port of apps/web/lib/harness/redaction.ts
    RingBufferLog.swift           # bounded JSONL ring buffer (notice+)
    OSLogStoreReader.swift        # OSLogStore export for diagnostics
    CorrelationMiddleware.swift   # ClientMiddleware: x-request-id inject + echo capture
    StreamMetricsRecorder.swift   # per-stream health metrics (TTFB/TTFT/gaps)
    MetricKitSubscriber.swift     # MXMetricManagerSubscriber
    DiagnosticBundle.swift        # ios_debug_bundle Codable model
    DiagnosticBundleBuilder.swift # assembles + redacts the bundle
    StatusState.swift             # ConnectionState / StreamState / SyncState enums
  Tests/OpenAgentsObservabilityTests/
    RedactorTests.swift
    LogEventTests.swift
    RingBufferLogTests.swift
    CorrelationMiddlewareTests.swift
    DiagnosticBundleBuilderTests.swift
    StreamMetricsRecorderTests.swift
    Fixtures/redaction-cases.json
```

Package dependencies (declared in `Package.swift`):

- `swift-openapi-runtime` (same pin as `OpenAgentsAPI`, see
  `02-api-contract-and-networking.md`) — needed for `ClientMiddleware`.
- No Sentry, no PostHog inside this package. Vendor SDKs are app-target-only
  dependencies wired in `ios/App/Sources/ObservabilityBootstrap.swift`
  (section 9), so unit tests of logging/redaction never load vendor code.

`OpenAgentsAPI`, `OpenAgentsCore` (data layer per `03-architecture.md`), and
the app target all depend on `OpenAgentsObservability`. The dependency arrow
never points the other way.

---

## 3. OSLog taxonomy

### 3.1 Subsystem

The subsystem is the app bundle identifier, read at runtime so it can never
drift from `ios/App/project.yml`:

```swift
// ios/Packages/OpenAgentsObservability/Sources/OpenAgentsObservability/AppLog.swift
import OSLog

public enum AppLog {
  /// Falls back only in non-bundle contexts (swift test on macOS).
  public static let subsystem = Bundle.main.bundleIdentifier ?? "com.openagents.ios"

  public static let auth   = Logger(subsystem: subsystem, category: "auth")
  public static let api    = Logger(subsystem: subsystem, category: "api")
  public static let stream = Logger(subsystem: subsystem, category: "stream")
  public static let db     = Logger(subsystem: subsystem, category: "db")
  public static let ui     = Logger(subsystem: subsystem, category: "ui")
  public static let bg     = Logger(subsystem: subsystem, category: "bg")
}
```

The canonical bundle identifier is `com.openagents.ios` (defined in
`03-architecture.md` / `ios/App/project.yml`; if that doc pins a different
value, all grep recipes in section 11 substitute it — code needs no change).

### 3.2 Categories (exactly six)

| Category | Scope |
|---|---|
| `auth` | Sign-in (Vercel OAuth via ASWebAuthenticationSession, Sign in with Apple), bearer token rotation/persistence (Keychain), sign-out, account deletion (`04-auth.md`) |
| `api` | Every non-streaming REST call through the generated `OpenAgentsAPI` client: request/response summaries, retries, decode failures, URLSession task metrics |
| `stream` | The chat SSE engine (`05-streaming-chat-engine.md`): connect, first byte/event, chunk flow, stall watchdog, disconnect/resume |
| `db` | GRDB: open, migrations, writes, cache resets, sync application |
| `ui` | Screen lifecycle, user actions, error presentation, diagnostics export, debug console |
| `bg` | BGTaskScheduler tasks, background refresh, push notification registration/receipt, scenePhase transitions |

Do not add categories. New behavior maps into one of these six; if it cannot,
that is a plan-change PR against this document, not an ad-hoc `Logger`.

### 3.3 Level semantics (persistence-aware)

| Level | Persistence (unified log) | Ring buffer (section 10.1) | Use for |
|---|---|---|---|
| `debug` | Not persisted; visible only while streaming | No | Chunk-level SSE noise, request-started lines, per-task URLSession metrics |
| `info` | Memory-buffered; persisted only inside a captured sysdiagnose | No | Screen views, idle ticks, sync row counts |
| `notice` | Persisted to disk (storage-limited) | Yes | Everything a diagnostic bundle must contain: lifecycle transitions, request summaries, stream state changes |
| `error` | Always persisted | Yes | Failed requests, decode failures, write failures |
| `fault` | Always persisted | Yes | Invariant violations: Keychain persist failure, DB migration failure, redaction engine failure |

Hard rule: **anything that must appear in an exported diagnostic bundle is
logged at `notice` or above.** `debug`/`info` are not reliably retrievable
after the fact (`OSLogStore` gives no cross-launch contract).

### 3.4 The structured event emitter

All events go through one helper that (a) formats a single-line
`key=value` message using the **server's snake_case vocabulary** from
`apps/web/lib/harness/logger.ts` (`event`, `request_id`, `session_id`,
`chat_id`, `method`, `path`, `status`, `duration_ms`, `error_code`), (b)
applies OSLog privacy annotations per section 7, and (c) tees `notice+`
events into the ring buffer **after** passing through `Redactor`.

```swift
// LogEvent.swift (signature; implementation in 09-step-by-step-build-guide.md)
public enum LogLevel: String, Sendable { case debug, info, notice, error, fault }

public struct LogEvent: Sendable, Codable {
  public let event: String                 // stable snake_case name from section 4
  public let category: LogCategory         // one of the six
  public let level: LogLevel
  public let fields: [String: LogFieldValue] // String|Int|Double|Bool, snake_case keys
  public let at: Date
}

public protocol EventLogging: Sendable {
  func log(_ event: LogEvent)
}
```

Production conformance `AppEventLogger` writes OSLog + ring buffer. Tests
inject a recording fake (see `06-testing-strategy.md`). View models and
clients never call `Logger` directly — only `EventLogging`.

---

## 4. Event vocabulary

Event names are stable API. Renaming one is a breaking change to debug
recipes and must update this document. Field names are snake_case. Field
values follow section 7 redaction rules. `request_id`, `session_id`,
`chat_id`, `workflow_run_id` are included whenever in scope.

### 4.1 `auth`

| Event | Level | Fields |
|---|---|---|
| `auth_signin_started` | notice | `flow` (`vercel_oauth` \| `apple`), `request_id` |
| `auth_signin_succeeded` | notice | `flow`, `duration_ms` |
| `auth_signin_cancelled` | notice | `flow` |
| `auth_signin_failed` | error | `flow`, `error_kind`, `duration_ms` |
| `auth_token_rotated` | notice | `source` (`set_auth_token_header`) — never the token |
| `auth_token_persist_failed` | fault | `keychain_status` (OSStatus int), `error_kind=auth_keychain_failed` |
| `auth_session_expired` | notice | `request_id` (the request whose 401 triggered it) |
| `auth_signout` | notice | `reason` (`user` \| `server_401` \| `account_deleted`) |
| `auth_account_deletion_started` | notice | `request_id` |
| `auth_account_deletion_succeeded` | notice | `request_id`, `duration_ms` |
| `auth_account_deletion_failed` | error | `request_id`, `error_kind`, `status` |

### 4.2 `api`

| Event | Level | Fields |
|---|---|---|
| `api_request_started` | debug | `request_id`, `method`, `path` |
| `api_request_finished` | notice | `request_id`, `method`, `path`, `status`, `duration_ms` |
| `api_request_failed` | error | `request_id`, `method`, `path`, `status` (0 if no response), `error_kind`, `duration_ms` |
| `api_decode_failed` | error | `request_id`, `path`, `type_name` (generated type), `error_kind=decode_failed` |
| `api_retry_scheduled` | notice | `request_id`, `attempt`, `delay_ms`, `error_kind` |
| `api_rate_limited` | notice | `request_id`, `path`, `retry_after_s` |
| `api_task_metrics` | debug | `request_id`, `dns_ms`, `connect_ms`, `tls_ms`, `ttfb_ms` (from `URLSessionTaskMetrics`) |

`path` is the route template (`/api/sessions/{sessionId}/chats/{chatId}`),
not the concrete URL — concrete path params are already covered by
`session_id`/`chat_id` fields, and query strings are never logged.

### 4.3 `stream`

| Event | Level | Fields |
|---|---|---|
| `stream_connect_started` | notice | `request_id`, `session_id`, `chat_id`, `mode` (`post` \| `resume`) |
| `stream_connected` | notice | `request_id`, `chat_id`, `status`, `workflow_run_id`, `first_byte_ms` |
| `stream_protocol_violation` | error | `request_id`, `chat_id`, `reason` (`missing_v1_header` \| `bad_json_line` \| `unexpected_part`), `error_kind=stream_protocol_violation` |
| `stream_first_event` | notice | `request_id`, `chat_id`, `first_event_ms` (time-to-first-token; also an `mxSignpost`, section 8.3) |
| `stream_event` | debug | `chat_id`, `part_type` (e.g. `text-delta`, `tool-output-available`), `bytes` |
| `stream_idle` | info | `chat_id`, `idle_ms` (emitted each 60 s with no chunks while connected — long tool runs are normal, see `05-streaming-chat-engine.md`: the server emits no heartbeats) |
| `stream_stalled` | notice | `chat_id`, `idle_ms`, `threshold_ms` (watchdog fired; UI flips to `status.stream.waiting`) |
| `stream_error_part` | error | `request_id`, `chat_id`, `error_text` (redacted via `Redactor`, truncated to 200 chars) — server sent `{"type":"error"}` |
| `stream_finished` | notice | `request_id`, `chat_id`, `finish_reason`, `events_total`, `bytes_total`, `duration_ms`, `gap_p95_ms` |
| `stream_disconnected` | notice | `chat_id`, `reason` (`server_close` \| `network_lost` \| `backgrounded` \| `stalled` \| `user_cancel`), `duration_ms`, `events_total` |
| `stream_resume_attempt` | notice | `chat_id`, `attempt`, `backoff_ms` |
| `stream_resume_result` | notice | `chat_id`, `outcome` (`replayed` \| `no_active_stream_204` \| `failed`), `error_kind` (only when `failed`) |

`reason=network_lost` (`NSURLErrorNetworkConnectionLost`) is **expected
mobile churn** — it is `notice`, never `error`, and is counted separately so
error dashboards are not polluted (research brief §5.2).

### 4.4 `db`

| Event | Level | Fields |
|---|---|---|
| `db_opened` | notice | `schema_version`, `duration_ms` |
| `db_migration_started` | notice | `from_version`, `to_version` |
| `db_migration_finished` | notice | `to_version`, `duration_ms` |
| `db_migration_failed` | fault | `from_version`, `to_version`, `error_kind=db_migration_failed` |
| `db_write_failed` | error | `entity` (table name), `op` (`insert` \| `update` \| `delete`), `error_kind=db_write_failed` |
| `db_sync_applied` | info | `entity`, `rows`, `duration_ms` (server fetch persisted into GRDB) |
| `db_cache_reset` | notice | `reason` (`corruption` \| `user_signout` \| `schema_mismatch`) |

### 4.5 `ui`

| Event | Level | Fields |
|---|---|---|
| `ui_screen_appeared` | info | `screen` (stable id: `sessions_list`, `chat`, `diff`, `settings`, `repo_picker`, `debug_console` — full registry in `01-product-and-ux.md`), `session_id`/`chat_id` when applicable |
| `ui_action` | info | `action` (stable id, e.g. `chat_send`, `stream_cancel`, `session_archive`), `screen` |
| `ui_error_presented` | notice | `error_kind`, `screen`, `copy_key` (section 12) |
| `ui_diagnostics_exported` | notice | `bundle_version`, `log_entries`, `included_server_link` (bool) |
| `ui_debug_console_opened` | notice | `build_kind` (`debug` \| `testflight`) |

### 4.6 `bg`

| Event | Level | Fields |
|---|---|---|
| `bg_app_backgrounded` | info | `streams_active` (count) |
| `bg_app_foregrounded` | info | `background_s` |
| `bg_task_scheduled` | info | `task_id` (BGTaskScheduler identifier), `earliest_s` |
| `bg_task_started` | notice | `task_id` |
| `bg_task_finished` | notice | `task_id`, `outcome` (`completed` \| `failed`), `duration_ms` |
| `bg_task_expired` | notice | `task_id`, `duration_ms` |
| `bg_refresh_result` | notice | `sessions_updated`, `duration_ms`, `error_kind` (on failure) |
| `push_registered` | notice | `token_hash` (SHA-256 hex of device token; never the token) |
| `push_register_failed` | error | `error_kind` |
| `push_received` | notice | `kind` (payload type id), `chat_id` when present |
| `metrickit_payload_received` | notice | `kind` (`metric` \| `diagnostic`), `payload_count` (section 8.2) |

---

## 5. Correlation IDs (aligned with the server)

### 5.1 What the server already supports (verified, zero backend change)

- `apps/web/lib/harness/request-id.ts` — `getRequestId(headers)` honors an
  incoming `x-request-id` header matching `/^[A-Za-z0-9._:/=-]{8,128}$/`,
  else generates a UUID.
- `apps/web/app/api/chat/route.ts` echoes correlation headers on streaming
  responses: `x-request-id` (lines 225, 375), `x-workflow-run-id` (152, 374),
  `x-verified-build-run-id` (224). Error JSON bodies include `requestId`.
- `apps/web/lib/observability/events.ts` persists `requestId`,
  `workflowRunId`, `sandboxName`, etc. on `session_events` rows.
- `apps/web/lib/harness/logger.ts` emits single-line JSON with `request_id`,
  `session_id`, `chat_id` keys when `HARNESS_LOG_JSON=true`.

### 5.2 Client requestId format (decision)

Every outgoing request carries `x-request-id: ios.<uuid>` where `<uuid>` is a
lowercase UUIDv4 (e.g. `ios.7f9c2ba4-e88f-4a3c-9b1d-1d2c4e5f6a7b`, 40 chars —
inside the server's 8–128 safe pattern, dot allowed). The `ios.` prefix lets
the backend attribute mobile traffic in `session_events.request_id` and
harness logs without any new header (resolves research brief open question 5).

### 5.3 Middleware injection

`CorrelationMiddleware` is a `ClientMiddleware` (swift-openapi-generator
1.12.2 / swift-openapi-runtime) registered on the generated client **after**
the auth middleware from `04-auth.md` (ordering owned by
`02-api-contract-and-networking.md`):

```swift
// CorrelationMiddleware.swift (shape; full source in 09-step-by-step-build-guide.md)
import OpenAPIRuntime
import HTTPTypes

public struct CorrelationMiddleware: ClientMiddleware {
  public func intercept(
    _ request: HTTPRequest, body: HTTPBody?, baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    let requestID = "ios.\(UUID().uuidString.lowercased())"
    request.headerFields[.init("x-request-id")!] = requestID
    let start = ContinuousClock.now
    do {
      let (response, responseBody) = try await next(request, body, baseURL)
      // Log api_request_finished with the ECHOED id when present, else ours.
      let echoed = response.headerFields[.init("x-request-id")!] ?? requestID
      // ... emit LogEvent(event: "api_request_finished", fields: [request_id: echoed, ...])
      return (response, responseBody)
    } catch {
      // ... emit api_request_failed with error_kind mapping (section 6)
      throw error
    }
  }
}
```

The chat stream path does not go through the generated client (it is a raw
`URLSession.bytes(for:)` request, see `05-streaming-chat-engine.md`); the
`ChatStreamClient` sets `x-request-id` itself with the same format and reads
the echoed `x-request-id`, `x-workflow-run-id`, and
`x-verified-build-run-id` response headers, storing them on the in-flight
turn model so the UI can show run attribution ("evidence" per the
discipline's core rule) and every subsequent `stream_*` event carries them.

### 5.4 sessionId / chatId propagation

`session_id` and `chat_id` are not headers — they are path parameters. The
calling layer (repository/view model) passes them into `LogEvent.fields`
explicitly; `CorrelationMiddleware` additionally parses them from route
templates matching `/api/sessions/{sessionId}` and
`/api/sessions/{sessionId}/chats/{chatId}` so request summaries carry them
even when the caller forgets. Joining contract:

| Client log field | Server location |
|---|---|
| `request_id` | `session_events.request_id`; harness JSON log `request_id`; chat response header `x-request-id` |
| `session_id` | `session_events.session_id`; harness JSON log `session_id` |
| `chat_id` | `session_events.chat_id`; harness JSON log `chat_id` |
| `workflow_run_id` | `workflow_runs.id`; `x-workflow-run-id` response header |

---

## 6. Typed error kinds

`error_kind` values are stable strings shared with the API error taxonomy in
`02-api-contract-and-networking.md` (that document owns the Swift
`APIErrorKind` enum inside `OpenAgentsAPI`; this table is the logging
contract and must stay byte-identical). Server-supplied `errorKind` values in
error bodies (e.g. `workflow_input_invalid` from `POST /api/chat`) pass
through verbatim in a separate field `server_error_kind` — the client never
renames server kinds.

| `error_kind` | Trigger |
|---|---|
| `network_offline` | `NWPathMonitor` unsatisfied / `NSURLErrorNotConnectedToInternet` |
| `network_timeout` | `NSURLErrorTimedOut` |
| `network_connection_lost` | `NSURLErrorNetworkConnectionLost` (expected churn; `notice` in stream context) |
| `tls_failed` | `NSURLErrorSecureConnectionFailed` and TLS-family codes |
| `dns_failed` | `NSURLErrorCannotFindHost` / `NSURLErrorDNSLookupFailed` |
| `cancelled` | `CancellationError` / `NSURLErrorCancelled` (user or scene-driven; never an error-level log) |
| `http_unauthorized` | 401 |
| `http_forbidden` | 403 |
| `http_not_found` | 404 |
| `http_conflict` | 409 (e.g. chat-ID conflict, concurrent workflow) |
| `http_payload_too_large` | 413 |
| `http_rate_limited` | 429 |
| `http_server_error` | 500–599 |
| `http_unexpected_status` | any other non-2xx not modeled by the generated client |
| `decode_failed` | generated-client decode error / `DecodingError` |
| `contract_missing_header` | expected echo header absent (e.g. no `x-vercel-ai-ui-message-stream: v1` on a 200 stream response) |
| `stream_protocol_violation` | non-JSON `data:` line, unknown required part shape |
| `stream_stalled` | stall watchdog fired and resume probe also failed |
| `stream_resume_failed` | resume GET non-OK after backoff budget exhausted |
| `stream_server_error_part` | `{"type":"error"}` part received |
| `auth_token_missing` | Keychain read returned nothing when a session was expected |
| `auth_keychain_failed` | Keychain OSStatus failure on read/write |
| `auth_refresh_failed` | bearer rotation/refresh path failed (`04-auth.md`) |
| `auth_signin_cancelled` | `ASWebAuthenticationSessionError.canceledLogin` |
| `auth_session_revoked` | 401 on a previously valid token |
| `db_migration_failed` | GRDB migrator threw |
| `db_corruption` | SQLite `SQLITE_CORRUPT` family |
| `db_write_failed` | other GRDB write error |
| `server_reported` | server error envelope `{ "error": string }` with no specific HTTP mapping needed; `server_error_kind` carries any server `errorKind` |
| `diagnostics_redaction_failed` | `Redactor` threw during bundle assembly; export is **blocked** (section 10.4) |

Mapping lives in one function
(`APIErrorKind.init(urlError:)` / `.init(status:)`) with a Swift Testing
table-driven test (`06-testing-strategy.md`). UI alert copy is selected by
`error_kind` → `copy_key` (section 12), and `ui_error_presented` records
both, so a TestFlight screenshot of an alert is mechanically joinable to logs.

---

## 7. Redaction rules

### 7.1 The Swift `Redactor` (port of the server engine)

`Redactor.swift` ports `apps/web/lib/harness/redaction.ts` exactly. It runs
on (a) every ring-buffer entry, (b) every diagnostic-bundle string, (c)
Sentry `beforeSend`, (d) PostHog property sanitization. Rule set (must match
the TS source; parity cases checked into
`Tests/OpenAgentsObservabilityTests/Fixtures/redaction-cases.json` with each
case commented with the `redaction.ts` line it mirrors):

| Rule | Pattern (from `redaction.ts`) | Replacement |
|---|---|---|
| Sensitive key | key matches `/(authorization|cookie|token|secret|password|api[_-]?key|private[_-]?key|credential)/i` | entire value → `[REDACTED]` |
| Bearer values | `/Bearer\s+[A-Za-z0-9._~+/=-]+/gi` | `Bearer [REDACTED]` |
| Token-shaped strings | `/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g` | `[REDACTED_TOKEN]` |
| Env assignments | `/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|KEY)=([^\s]+)/g` | `NAME=[REDACTED]` |
| URL credentials/query/hash | parseable URL with userinfo, query, or fragment | origin + path only |
| Artifact content keys | key ∈ `{artifact, artifact_content, artifactContent, content, stdout, stderr, body, request_body, response_body}` | `[REDACTED_ARTIFACT_CONTENT]` |
| Unsupported value types | non-Codable scalar | `[REDACTED_UNSUPPORTED_VALUE]` |

`Redactor.redact(_:) throws` — a thrown error marks the consuming artifact's
`redaction.status` as `blocked` (mirrors `session_events.redactionStatus`
enum values `not_required | passed | failed | blocked`).

### 7.2 OSLog privacy annotations

OSLog interpolations are private-by-default; redaction at write time is
irreversible. Policy:

| Value class | Annotation | Examples |
|---|---|---|
| Event names, levels, statuses, counts, durations | `.public` (scalars are public by default) | `status=200`, `duration_ms=812` |
| Correlation ids | `.public` | `request_id`, `session_id`, `chat_id`, `workflow_run_id` (already first-class server columns) |
| Stable enum-ish strings | `.public` | `error_kind`, `reason`, `flow`, `screen`, `part_type`, `path` (route template only) |
| User/repo identity | `.private(mask: .hash)` | better-auth `user_id`, repo full name, branch name, push-token hash input |
| Everything else | default `.private` | any string not in the rows above |
| Forbidden entirely | never interpolated at any level | tokens, cookies, `Authorization`/`set-auth-token` header values, message/prompt text, diff hunks, file contents, tool stdout/stderr, URLs with query strings |

### 7.3 Message and prompt content policy

Chat message text, prompt text, tool inputs/outputs, diff content, and file
contents are **never logged at any level, including `debug`** (debug lines
are still capturable via Console.app and sysdiagnose). Log shape instead:
`part_type`, `bytes`, `events_total`, character counts. The sanctioned
channel for transcript-level debugging is the **server-side** chat debug
bundle (`GET/POST /api/sessions/{sessionId}/chats/{chatId}/debug-bundle`,
already bounded and redacted server-side) — see section 10.4. `Redactor` is
defense-in-depth, not permission to log content.

### 7.4 What is safe at `info` vs `debug`

| | `debug` | `info` | `notice+` |
|---|---|---|---|
| Correlation ids | yes | yes | yes |
| Route templates, statuses, durations | yes | yes | yes |
| Part types / byte counts per chunk | yes | no (volume) | no (volume) |
| Hashed repo/branch/user ids | yes | yes | yes |
| Raw repo/branch names | no | no | no (hash only; a developer can opt into plain values via the debug console's "verbose diagnostics" toggle, DEBUG builds only) |
| Message/prompt/diff/file content | **never** | **never** | **never** |
| Token-shaped or credential values | **never** | **never** | **never** |

---

## 8. MetricKit

### 8.1 Subscription (day one)

```swift
// MetricKitSubscriber.swift
import MetricKit

public final class MetricKitSubscriber: NSObject, MXMetricManagerSubscriber {
  public func register() { MXMetricManager.shared.add(self) }
  public func didReceive(_ payloads: [MXMetricPayload]) { /* section 8.2 */ }
  public func didReceive(_ payloads: [MXDiagnosticPayload]) { /* section 8.2 */ }
}
```

Registered from `ObservabilityBootstrap.start()` in the app target at launch.

What it provides (and what we read):

- `MXMetricPayload` (daily): `applicationLaunchMetrics` (cold-launch and
  launch-to-first-draw histograms), `applicationResponsivenessMetrics`
  (hang-time histogram), `applicationExitMetrics` (**the only reliable
  OOM/jetsam/watchdog exit-reason counts available to apps**),
  `memoryMetrics`, `networkTransferMetrics`, `animationMetrics` (scroll hitch
  rate), `signpostMetrics` (section 8.3).
- `MXDiagnosticPayload`: `MXCrashDiagnostic`, `MXHangDiagnostic`,
  `MXCPUExceptionDiagnostic`, `MXDiskWriteExceptionDiagnostic`,
  `MXAppLaunchDiagnostic` — delivered promptly after the event on iOS 15+,
  unsymbolicated call stacks.

### 8.2 Export destinations (decision: no new backend endpoint)

1. **Sentry ingestion** — set `options.enableMetricKit = true` in the Sentry
   config (section 9.2). Sentry converts MetricKit diagnostics into events
   with symbolication via the uploaded dSYMs. This resolves research brief
   open question 2: no custom collector endpoint is added to `apps/web`.
2. **Local cache for the diagnostic bundle** — on every
   `didReceive(_: [MXMetricPayload])`, write
   `payload.jsonRepresentation()` to
   `Application Support/Diagnostics/metrickit-latest.json` (overwrite; one
   file). `DiagnosticBundleBuilder` summarizes it into the bundle's
   `metrics.lastMetricKitSummary` (launch p50/p95, hang rate, exit-reason
   counts). The raw file is bounded by construction (one day's payload).
3. Each delivery also logs `metrickit_payload_received` (`notice`, category
   `bg`, fields `kind` = `metric` \| `diagnostic` and `payload_count`) — see
   the section 4.6 table.

### 8.3 Custom aggregated metrics via `mxSignpost`

Wrap the three headline flows so the system aggregates duration histograms
into the daily payload (visible in Xcode Organizer and the local cache):

| Signpost name | Begin | End |
|---|---|---|
| `chat_ttft` | chat send accepted (`stream_connect_started`) | first `text-delta`/part received (`stream_first_event`) |
| `session_list_load` | sessions screen fetch start | first render with data |
| `diff_render` | diff payload decoded | diff view laid out |

Use `MXMetricManager.makeLogHandle(category: "signposts")` and
`mxSignpost(.begin/.end, log:, name:)`. These are aggregate-only; the
per-instance values are also logged as fields on the corresponding `notice`
events (`first_event_ms`, `duration_ms`) so individual sessions remain
debuggable.

---

## 9. Crash reporting + analytics (decision)

### 9.1 The decision

**Sentry for crashes/hangs/tracing + PostHog for product analytics.**
Exactly one in-process crash handler: **Sentry**. PostHog's
`errorTrackingConfig.autoCapture` stays **false** permanently (two crash
handlers chaining signal/Mach handlers is a known source of lost reports).

Rationale (from `research/25-ios-observability.md` §3, restated):

1. This app's riskiest failures are long-lived SSE streams, large diff
   rendering, and background fetch — hangs, watchdog kills, and memory-limit
   exits as much as hard crashes. Sentry detects watchdog terminations and
   app hangs and ingests MetricKit; PostHog's iOS error tracking captures
   none of those, leaves system frames unsymbolicated, and surfaces Swift
   fatal errors as bare `SIGTRAP`.
2. Sentry's URLSession instrumentation propagates `sentry-trace`/`baggage`
   restricted to the open-agents API host only
   (`options.tracePropagationTargets = [apiHost]`); our own `x-request-id`
   remains the primary join key to `session_events` and harness logs, so
   backend Sentry adoption is **not** required.
3. PostHog stays on its strength: product analytics, and later feature
   flags/experiments. Note: **no PostHog exists in the web app today** — the
   iOS app is the first product surface; a new PostHog project must be
   created and its write-only API key added to build config.
4. Both SDKs ship privacy manifests declaring diagnostics/analytics-only
   categories, keeping the nutrition label at "Data Not Used to Track."

PostHog **session replay stays OFF at launch** (resolves open question 4):
this app renders user source code, diffs, and settings; replay may only be
enabled after a screen-by-screen masking audit (diff views, env-var settings,
API-key fields) tracked as its own future issue.

### 9.2 Pinned SDKs and configuration

| Dependency | Pin | Added where |
|---|---|---|
| `https://github.com/getsentry/sentry-cocoa` | `.exact("8.49.0")` (bundles `PrivacyInfo.xcprivacy`; ≥ 8.21.0 required for it; bump deliberately via PR) | app target packages in `ios/App/project.yml` |
| `https://github.com/PostHog/posthog-ios` | `.exact("3.56.0")` (first version with error-tracking config we must keep disabled; replay GA) | app target packages in `ios/App/project.yml` |

```swift
// ios/App/Sources/ObservabilityBootstrap.swift (app target only)
import Sentry
import PostHog
import OpenAgentsObservability

enum ObservabilityBootstrap {
  static func start(config: AppConfig, consent: DiagnosticsConsent) {
    guard consent.sharingEnabled else { return }  // section 9.4
    SentrySDK.start { options in
      options.dsn = config.sentryDSN                  // from Config/*.xcconfig; DSN is client-public
      options.environment = config.environmentName    // "debug" | "testflight" | "appstore"
      options.releaseName = "\(config.bundleID)@\(config.version)+\(config.build)"
      options.enableMetricKit = true                   // section 8.2
      options.enableAppHangTracking = true
      options.enableWatchdogTerminationTracking = true
      options.tracesSampleRate = 0.1
      options.tracePropagationTargets = [config.apiHost]  // never third-party hosts
      options.beforeSend = { event in Redactor.scrub(sentryEvent: event) } // section 7.1
    }
    SentrySDK.setUser(User(userId: consent.opaqueUserID))  // better-auth id ONLY; no email/name

    let phConfig = PostHogConfig(apiKey: config.posthogAPIKey, host: config.posthogHost)
    phConfig.sessionReplay = false                       // OFF until masking audit
    phConfig.errorTrackingConfig.autoCapture = false     // Sentry owns crashes
    PostHogSDK.shared.setup(phConfig)
    PostHogSDK.shared.identify(consent.opaqueUserID)     // opaque id only
  }
}
```

`SENTRY_DSN`, `POSTHOG_API_KEY`, `POSTHOG_HOST` live in committed
`ios/App/Config/{Debug,TestFlight,Release}.xcconfig` files (these are
client-public write keys, not secrets — `02-api-contract-and-networking.md`
owns the config file layout). dSYM upload is a CI step owned by
`08-ci-cd-release.md` (`sentry-cli upload-dif` after archive; exact sentry-cli
pin recorded there).

### 9.3 What goes to which sink

| Sink | Receives |
|---|---|
| OSLog + ring buffer | every event in section 4 (developer/local + diagnostics export) |
| Sentry | crashes, hangs, watchdog terminations, MetricKit payloads, `error`/`fault`-level events as breadcrumbs (redacted `api_request_finished` lines as breadcrumb trail), `stream_stalled` above threshold |
| PostHog | product events only: `chat_sent`, `stream_completed` (with `first_event_ms` as a property), `session_created`, `repo_connected`, `settings_changed`, `diagnostics_exported` — names and full registry owned by `01-product-and-ux.md`; properties pass through `Redactor` |

### 9.4 Consent

Settings ("Privacy" group, `01-product-and-ux.md`) exposes one toggle:
**"Share Diagnostics & Analytics"** — default ON, stored in `UserDefaults`
key `diagnostics.sharingEnabled`. OFF calls `PostHogSDK.shared.optOut()`
immediately and disables Sentry at next launch (`guard` in
`ObservabilityBootstrap.start`). OSLog and the ring buffer are unaffected
(on-device only; exported solely by explicit user action, section 10).

---

## 10. In-app debug console and log export

### 10.1 App-owned ring buffer

`OSLogStore` on iOS only supports `.currentProcessIdentifier` scope with no
cross-launch contract, so the bundle cannot rely on it alone (a crash on
launch would otherwise be undebuggable next session). Mitigation:

- `RingBufferLog` — JSONL file at
  `Application Support/Diagnostics/events.ringbuffer.jsonl`, excluded from
  iCloud backup (`URLResourceValues.isExcludedFromBackup = true`).
- Capacity: last **2,000** entries, each capped at **4,000** characters with
  a `[TRUNCATED]` suffix (mirrors `MAX_TEXT_CHARS = 4000` in
  `apps/web/lib/observability/chat-debug-bundle.ts`).
- Receives every `notice`/`error`/`fault` `LogEvent` **after** `Redactor`.
- Actor-isolated writer; flush coalesced (≤ 1 write/s) to keep disk I/O off
  `MXDiskWriteExceptionDiagnostic` radar.

### 10.2 OSLogStore reader

`OSLogStoreReader.collect(since:)` (used by the bundle builder and the debug
console):

```swift
let store = try OSLogStore(scope: .currentProcessIdentifier)
let position = store.position(date: since)            // e.g. last 30 minutes
let entries = try store.getEntries(at: position,
  matching: NSPredicate(format: "subsystem == %@", AppLog.subsystem))
// map OSLogEntryLog -> { date, category, level, composedMessage }
```

Treat results as "recent logs from this process, `notice`+" — the ring
buffer is the durable record.

### 10.3 Debug console UI

- Entry point: Settings → About → tap the version row 5 times (all builds),
  or always-visible row in `DEBUG` builds. Logs `ui_debug_console_opened`.
- Screen `debug_console` (registered in `01-product-and-ux.md`): merged view
  of ring buffer + `OSLogStoreReader` output; filter chips for the six
  categories and a level picker; search field matches `event` and field
  values; rows show `event`, `category`, relative time, and tap-to-expand
  fields.
- Toolbar actions: "Export Diagnostics" (section 10.4) and, for a chat
  opened from the chat screen's context menu, "Create Server Debug Link"
  (section 10.4 step 4).
- `DEBUG`-only extras: "verbose diagnostics" toggle (plain repo/branch names
  per section 7.4), current `apiHost`, last 10 `api_request_finished`
  entries with task metrics.

### 10.4 Diagnostic bundle export (`ios_debug_bundle` v1)

Client-side sibling of the server chat debug bundle. Shape:

```jsonc
{
  "bundle":  { "kind": "ios_debug_bundle", "version": 1, "generatedAt": "<ISO8601>",
               "redaction": { "status": "passed", "notes": [] } },
  "app":     { "version": "1.0.0", "build": "42", "bundleId": "com.openagents.ios",
               "os": "iOS 26.x", "device": "iPhone17,2", "locale": "en_US" },
  "account": { "userId": "<opaque better-auth id>", "authState": "signedIn" },
  "settings": { /* non-sensitive prefs only */ },
  "network": { "apiHost": "...", "recentRequests": [
      { "request_id": "ios.…", "method": "POST", "path": "/api/chat",
        "status": 200, "duration_ms": 812, "at": "…" } ] },
  "streams": [ { "chat_id": "…", "workflow_run_id": "…", "request_id": "ios.…",
                 "first_event_ms": 410, "events_total": 182,
                 "disconnects": [ { "reason": "network_lost", "at": "…" } ] } ],
  "logs":    [ /* ring buffer ∪ OSLogStore, ≤2000 entries, ≤4000 chars each */ ],
  "metrics": { "lastMetricKitSummary": { /* launch p50/p95, hang rate, exit reasons */ } },
  "serverDebugBundleUrl": "https://…(optional, ≤24h signed URL)"
}
```

Behavioral requirements (each maps to a house rule):

1. **Bounded** — entry and per-entry caps as in 10.1; `[TRUNCATED]` suffix.
2. **Redacted at assembly** — every string passes `Redactor`; a redactor
   failure sets `redaction.status = "blocked"` and the export button shows
   `copy_key=error.diagnostics.redaction_blocked` instead of producing a file
   (`error_kind=diagnostics_redaction_failed`).
3. **No content** — never message text, diffs, file contents, or
   request/response bodies; ids + counts + statuses only. Transcript-level
   data lives in the server bundle.
4. **Pairs with the server bundle** — when exporting from a chat context,
   offer "Include server-side debug link": call
   `POST /api/sessions/{sessionId}/chats/{chatId}/debug-bundle` (optional
   body `{"ttlMinutes": 60}`, max TTL 24 h) to mint the signed read-only URL
   (`apps/web/lib/observability/diagnostic-token.ts`) and embed it as
   `serverDebugBundleUrl`. Support then has both halves, joined on
   `request_id`/`chat_id`.
5. **Delivery** — write JSON to a temporary file
   (`openagents-diagnostics-<ISO8601>.json`) and present SwiftUI `ShareLink`.
   No automatic upload, ever.
6. **Self-evidencing** — export logs `ui_diagnostics_exported` (`notice`)
   and, with consent, the `diagnostics_exported` PostHog event.

---

## 11. Grep-able debug recipes

Substitute the bundle id from `ios/App/project.yml` if it differs from
`com.openagents.ios`.

**Live-tail the app on a booted simulator (all categories):**

```bash
xcrun simctl spawn booted log stream --level debug --style compact \
  --predicate 'subsystem == "com.openagents.ios"'
```

**Only the stream engine, errors and above:**

```bash
xcrun simctl spawn booted log stream --style compact \
  --predicate 'subsystem == "com.openagents.ios" AND category == "stream" AND messageType >= error'
```

**Past logs from the simulator (last 30 minutes):**

```bash
xcrun simctl spawn booted log show --last 30m --style compact \
  --predicate 'subsystem == "com.openagents.ios"'
```

**Follow one request end-to-end (client side):**

```bash
xcrun simctl spawn booted log show --last 1h --style compact \
  --predicate 'subsystem == "com.openagents.ios" AND composedMessage CONTAINS "ios.7f9c2ba4"'
```

**Collect from a physical device, then query offline:**

```bash
sudo log collect --device-name "<device name>" --last 1h --output /tmp/openagents.logarchive
log show /tmp/openagents.logarchive --style compact \
  --predicate 'subsystem == "com.openagents.ios" AND category == "stream"'
```

**Console.app filter bar (paste verbatim):**

```
subsystem:com.openagents.ios category:stream
```

**Join with the server (same request):** take `request_id=ios.<uuid>` from
any client line, then:

```bash
# Harness JSON logs (HARNESS_LOG_JSON=true): single-line JSON with request_id key
vercel logs <deployment-url> | grep 'ios.7f9c2ba4-e88f-4a3c-9b1d-1d2c4e5f6a7b'
```

```sql
-- session_events rows stamped with the client-generated id
SELECT event_name, status, source, actor_type, created_at
FROM session_events
WHERE request_id = 'ios.7f9c2ba4-e88f-4a3c-9b1d-1d2c4e5f6a7b'
ORDER BY created_at;
```

**Query an exported bundle:**

```bash
jq '.logs[] | select(.event == "stream_disconnected")' openagents-diagnostics-*.json
jq '.network.recentRequests[] | select(.status >= 400)'  openagents-diagnostics-*.json
```

**Escalation (system-level: push delivery, background kills):** sysdiagnose —
user triggers the hardware-button chord, retrieves the archive from
Settings → Privacy & Security → Analytics & Improvements → Analytics Data,
AirDrops it; the archive's `.logarchive` contains our subsystem. Documented
in the support runbook, not in-app.

---

## 12. User-visible status patterns

Per the discipline's core rule, status is evidence. Three small state
machines live in `StatusState.swift`; the UI binds to them and every
transition emits the matching section-4 event. Copy keys below are the
contract with `01-product-and-ux.md` (which owns final wording and
localization); defaults listed here ship until 01 overrides them.

### 12.1 ConnectionState (app-wide, driven by `NWPathMonitor` + API failures)

| State | Copy key | Default copy | Logged event |
|---|---|---|---|
| `.online` | — (no banner) | — | — |
| `.offline` | `status.connection.offline` | "You're offline. Showing saved data." | `api_request_failed` with `error_kind=network_offline` |
| `.reconnecting` | `status.connection.reconnecting` | "Reconnecting…" | `stream_resume_attempt` / `api_retry_scheduled` |

### 12.2 StreamState (per chat turn, owned by `05-streaming-chat-engine.md`)

| State | Copy key | Default copy | Logged event on entry |
|---|---|---|---|
| `.idle` | — | — | — |
| `.connecting` | `status.stream.connecting` | "Starting…" | `stream_connect_started` |
| `.streaming` | `status.stream.streaming` | "Working…" | `stream_first_event` |
| `.waiting` (connected, no chunks past stall threshold — long tool runs are normal; no server heartbeats exist) | `status.stream.waiting` | "Agent is still working…" | `stream_stalled` |
| `.reconnecting` | `status.stream.reconnecting` | "Connection lost. Reconnecting…" | `stream_disconnected` + `stream_resume_attempt` |
| `.finished` | — (final message rendered; run attribution row shows `workflow_run_id`) | — | `stream_finished` |
| `.failed(errorKind)` | `status.stream.failed` | "Something went wrong. Tap to retry." | `stream_resume_result outcome=failed` or `stream_error_part` |

The chat header also exposes the attribution affordance: tapping the status
row reveals `request_id`, `workflow_run_id`, and (when present)
`x-verified-build-run-id` with copy-to-clipboard — the mobile analog of
"sandbox/profile/runtime attribution" evidence.

### 12.3 SyncState (GRDB cache vs server, per screen)

| State | Copy key | Default copy | Logged event |
|---|---|---|---|
| `.synced` | — | — | `db_sync_applied` |
| `.syncing` | `status.sync.syncing` | "Updating…" | — |
| `.pending` | `status.sync.pending` | "Changes will send when you're back online." | — |
| `.failed(errorKind)` | `status.sync.failed` | "Couldn't update. Pull to retry." | `db_write_failed` / `api_request_failed` |

### 12.4 Error presentation

Every user-facing error alert/banner is rendered from an
`error_kind → copy_key` table (full table owned by `01-product-and-ux.md`,
keys prefixed `error.`, e.g. `error.http_rate_limited` = "You're sending
requests too quickly. Try again in a moment."). Presentation always logs
`ui_error_presented { error_kind, screen, copy_key }` so screenshots in
TestFlight feedback join to logs mechanically.

---

## 13. App Store privacy: manifests and nutrition label

### 13.1 App-owned `ios/App/Resources/PrivacyInfo.xcprivacy`

| Key | Value |
|---|---|
| `NSPrivacyTracking` | `false` |
| `NSPrivacyTrackingDomains` | `[]` (no ATT prompt) |
| `NSPrivacyCollectedDataTypes` | see 13.2 inventory |
| `NSPrivacyAccessedAPITypes` | `NSPrivacyAccessedAPICategoryUserDefaults` → reason `CA92.1` (app's own settings); `NSPrivacyAccessedAPICategoryFileTimestamp` → `C617.1` (ring-buffer file maintenance). Do **not** add `SystemBootTime`: all durations use `ContinuousClock`, which requires no declaration. |

sentry-cocoa (≥ 8.21.0) and posthog-ios bundle their own manifests.
Implementation step: open the pinned posthog-ios 3.56.0 checkout and verify
its `PrivacyInfo.xcprivacy` `NSPrivacyCollectedDataTypes` entries match the
inventory below; if either SDK ends up statically linked, copy its manifest
entries into the app-level manifest (Sentry documents this case).

### 13.2 Nutrition label inventory (App Store Connect questionnaire)

Ground truth: Xcode → Product → Archive → "Generate Privacy Report" (merges
app + SDK manifests). The questionnaire answers must match it. Expected:

| Data type | Collected? | Linked to identity | Tracking | Purpose | Source |
|---|---|---|---|---|---|
| Identifiers → User ID | Yes (opaque better-auth id) | Yes | No | App Functionality, Analytics | Sentry user, PostHog `identify` |
| Diagnostics → Crash Data | Yes | Yes (user id on events) | No | App Functionality | Sentry |
| Diagnostics → Performance Data | Yes | Yes | No | App Functionality, Analytics | Sentry (MetricKit, hangs), signposts |
| Usage Data → Product Interaction | Yes | Yes | No | Analytics | PostHog events |
| Contact Info / Location / Browsing / Purchases / Content | No | — | — | — | message content never leaves the official API path; never logged or sent to vendors |

Label outcome: **"Data Not Used to Track."** If PostHog session replay is
ever enabled (post-masking-audit issue), re-run this inventory and add
"Other User Content" review before submission.

---

## 14. Per-slice observability checklist (Definition of Done input)

Every iOS feature/bug issue (templates per
`docs/process/feature-ticket-format.md`) fills its
`Observability and user feedback` section answering the seven discipline
questions with this document's vocabulary:

- [ ] **User-visible status**: which copy keys (section 12) change or are
      added; what a naive user sees that proves the feature is active.
- [ ] **Structured events**: which section-4 events fire (existing names
      reused; new events added to the tables in this doc in the same PR),
      with level and fields.
- [ ] **Error taxonomy**: which `error_kind` values (section 6) the slice
      can produce; new kinds added to section 6 and to the `APIErrorKind`
      enum in the same PR.
- [ ] **Correlation**: confirms `request_id`/`session_id`/`chat_id`
      (and `workflow_run_id` where applicable) are on every new event.
- [ ] **Redaction**: names which sensitive values the slice touches and the
      boundary that strips them (`Redactor`, OSLog privacy annotation, or
      "never interpolated").
- [ ] **Debug recipes**: at least one section-11-style command an operator
      can run to observe the slice.
- [ ] **Evidence**: simulator screenshot(s) plus a
      `xcrun simctl spawn booted log show` capture of the new events
      attached to the PR (`06-testing-strategy.md` smoke flow).
- [ ] **Tests**: Swift Testing coverage for new event emission paths,
      error-kind mappings, and any new `Redactor` rule (red first, per
      `docs/process/behavior-tdd.md`).

---

## 15. Decision log (research-brief open questions resolved)

| # | Question (from `research/25-ios-observability.md` §7) | Decision |
|---|---|---|
| 1 | Sentry+PostHog vs PostHog-only | Sentry (crashes/hangs/tracing/MetricKit) + PostHog (product analytics); exactly one crash handler = Sentry; PostHog `autoCapture` permanently false |
| 2 | Backend MetricKit collector? | No new backend surface; `options.enableMetricKit = true` on Sentry + local latest-payload cache for the bundle |
| 3 | SSE keepalive cadence | Verified: the server emits **no** heartbeats (`research/22-swift-sse-and-stream-protocol.md`); stall handling = `stream_idle` info ticks at 60 s, `stream_stalled` + `.waiting` UI state, app-level resume probe — thresholds owned by `05-streaming-chat-engine.md` |
| 4 | Session replay at launch? | OFF; requires a screen-by-screen masking audit issue (diff, settings, key fields) before any sample rate > 0 |
| 5 | Recognizable request-id prefix | Yes: `ios.<lowercase-uuidv4>` on every request via `CorrelationMiddleware` |
| 6 | posthog-ios manifest verification | Implementation step in 13.1; pinned 3.56.0; re-check PostHog SIGTRAP/symbolication issues only if the Sentry decision is ever revisited |
| 7 | dSYM upload ownership | CI job in `08-ci-cd-release.md` (sentry-cli after archive, before TestFlight upload; pin recorded there) |

Build-order placement for everything above lives in
`09-step-by-step-build-guide.md`.
