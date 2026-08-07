# iOS Observability Research Brief

Research brief for the native iOS (Swift/SwiftUI) app plan for open-agents. Covers OSLog,
MetricKit, crash/analytics SDK selection, privacy manifests, network/SSE observability, and
an in-app diagnostics-export design that mirrors this repo's observability discipline and
diagnostic-bundle conventions. Written June 2026.

---

## 0. House rules the iOS app must mirror (from this repo)

Read these first; every iOS recommendation below is shaped to match them.

### 0.1 Observability discipline (`docs/process/observability-discipline.md`)

- Core rule (lines 7-20): any action that decides, launches work, mutates code, runs a
  sandbox, or claims completion must leave **inspectable evidence** — user-visible status,
  structured data parts, tool metadata, runtime attribution, logs/run records, screenshots,
  and final verification notes.
- Required questions before non-trivial behavior (lines 22-34) include: which actor did the
  work, what is the live status, what proves completion, what failure mode is likely and how
  the UI surfaces it, and **which sensitive values must not be shown** (line 34).
- "Do not treat a coordinator transcript as proof" (lines 52-54) — completion must be backed
  by events, tool outputs, gates, or persisted state. The iOS analog: the app must surface
  backend-persisted evidence (session events, run records) rather than inferring success from
  a stream having ended.

### 0.2 Diagnostic bundles (`docs/process/diagnostic-bundles.md`)

- Chat debug bundle endpoint:
  `GET /api/sessions/:sessionId/chats/:chatId/debug-bundle` (lines 8-15), owner-authenticated,
  JSON by default, `?format=markdown` or `Accept: text/markdown` for Markdown.
- `POST` to the same path mints a **signed, short-lived read-only URL** (max 24h TTL,
  optional `{"ttlMinutes": 60}` body) scoped to the exact session+chat (lines 17-31).
- Bundle contents (lines 33-41): session/chat metadata, bounded transcript + summarized tool
  activity, managed-runtime profile runs, workflow run metadata, service records, browser run
  summaries, **redacted session events**.
- Redaction rules (lines 43-48): redact token-shaped strings and sensitive keys, bound
  transcript text per message, omit raw log tails/artifacts. "Triage, not forensics."

### 0.3 Backend implementation facts (actual code)

- **Request-ID contract** — `apps/web/lib/harness/request-id.ts:1-16`:
  - Safe pattern: `/^[A-Za-z0-9._:/=-]{8,128}$/` (line 1).
  - `getRequestId(headers)` honors an incoming `x-request-id` header if it matches the safe
    pattern, otherwise generates `crypto.randomUUID()` (lines 9-16).
  - The chat API **echoes the request id back** on streaming responses:
    `apps/web/app/api/chat/route.ts:225` and `:375` set `"x-request-id": requestId` on the
    `createUIMessageStreamResponse` headers (alongside `x-workflow-run-id` at :374 and
    `x-verified-build-run-id` at :224), and error JSON bodies include `requestId` with an
    `X-Request-ID` response header (route.ts:229-236).
  - Webhook/cron routes read `req.headers.get("x-request-id")` for attribution
    (`app/api/background-agents/webhook/[publicId]/route.ts:64`,
    `app/api/background-agents/cron/route.ts:29`, `app/api/github/webhook/route.ts:204,232`).
  - **Conclusion: the iOS client should generate and send `x-request-id` on every API call**
    (UUID satisfies the safe pattern) — the backend will adopt it and stamp it into
    workflow runs and session events. This is already wired; no backend change needed.
- **Structured session events** — `apps/web/lib/observability/events.ts:17-36` and the
  `session_events` table (`apps/web/lib/db/schema.ts:635-720`): every event has
  `source` (enum: chat | workflow | managed_runtime | sandbox | harness | service | browser |
  github | system), `actorType` (user | coordinator | worker | sandbox | harness | browser |
  github | workflow | system), `eventName`, `status` (started | running | succeeded | failed |
  blocked | skipped | info), optional `requestId`, run/sandbox/service attribution columns, a
  **redacted** JSONB payload, and `redactionStatus` (not_required | passed | failed | blocked).
  Payloads pass through `redactSessionEventPayload` → `redactHarnessPayload` before insert
  (events.ts:46-58, :94).
- **Structured JSON logging** — `apps/web/lib/harness/logger.ts:6-23`: snake_case keys
  (`event`, `request_id`, `session_id`, `chat_id`, `harness_run_id`, `method`, `path`,
  `status`, `duration_ms`, `error_code`, …), single-line JSON, payload redacted before
  emission (logger.ts:40-44). The iOS log-event vocabulary should reuse these key names so
  client and server logs join on `request_id`/`session_id`/`chat_id`.
- **Redaction engine** — `apps/web/lib/harness/redaction.ts:1-17`: sensitive-key regex
  (`authorization|cookie|token|secret|password|api[_-]?key|private[_-]?key|credential`),
  `Bearer …` masking, token-shaped pattern (`sk-…`, `ghp_/gho_/ghu_/ghs_/ghr_…`, `xox…`),
  `FOO_TOKEN=value` env-assignment masking, URL credential/query/hash stripping, and an
  artifact-content key set (`content`, `stdout`, `stderr`, `body`, …) that is replaced
  wholesale. **An iOS diagnostics exporter should port this exact rule set to Swift.**
- **Signed diagnostic tokens** — `apps/web/lib/observability/diagnostic-token.ts:1-36`:
  HMAC-SHA256 over a base64url payload `{v:1, sid, cid, exp}`, max TTL 24h, keyed by
  `BETTER_AUTH_SECRET`. The iOS app can call the existing POST endpoint to mint these — useful
  for "share a debug link with support" without exporting device data.
- **No PostHog / no analytics SDK in the web app today.** `grep -ri posthog` finds nothing in
  `apps/web` source or package.json. PostHog exists only as Claude-Code tooling plugins in the
  developer environment. So the iOS app would be the **first product surface** wiring PostHog
  (or any analytics) — there is no existing PostHog project key/conventions in-repo to inherit.
  (Marking this explicitly because the task prompt assumed otherwise.)

---

## 1. os.Logger / OSLog

### 1.1 Subsystems and categories

Apple's convention (WWDC20 "Explore logging in Swift", WWDC23 "Debug with structured
logging"): subsystem = reverse-DNS bundle identifier; category = component/feature name; one
`Logger` per major component.

- WWDC20: https://developer.apple.com/videos/play/wwdc2020/10168/
- WWDC23: https://developer.apple.com/videos/play/wwdc2023/10226/

Proposed taxonomy for this app (categories deliberately mirror the backend `source` enum in
`schema.ts:648-660` so cross-correlation is mechanical):

```swift
import OSLog

extension Logger {
  private static let subsystem = Bundle.main.bundleIdentifier! // e.g. "com.<org>.openagents"

  static let auth      = Logger(subsystem: subsystem, category: "auth")
  static let api       = Logger(subsystem: subsystem, category: "api")        // REST calls
  static let stream    = Logger(subsystem: subsystem, category: "stream")     // SSE/chat streams
  static let chat      = Logger(subsystem: subsystem, category: "chat")
  static let workflow  = Logger(subsystem: subsystem, category: "workflow")
  static let sessions  = Logger(subsystem: subsystem, category: "sessions")
  static let diff      = Logger(subsystem: subsystem, category: "diff")
  static let push      = Logger(subsystem: subsystem, category: "push")
  static let diag      = Logger(subsystem: subsystem, category: "diagnostics")
  static let ui        = Logger(subsystem: subsystem, category: "ui")
}
```

Log-level → persistence semantics (WWDC20):

- `debug` — not persisted; visible only while streaming/debugging. Use for chunk-level SSE noise.
- `info` — memory-buffered; persisted only when captured by a log collection (e.g. during
  sysdiagnose). Use for request/response summaries.
- `notice` (default) — persisted to disk up to a storage limit. Use for lifecycle/state
  transitions you need post-hoc (stream started/resumed/stalled, run finished).
- `error` / `fault` — always persisted. Use for failed requests, decode failures, invariant
  violations.

**Rule for the export feature (section 6): anything that must appear in a diagnostic bundle
must be logged at `notice` or above**, or duplicated into an app-owned ring buffer, because
`debug`/`info` are not reliably retrievable later.

### 1.2 Privacy redaction

- Interpolated values are **private (redacted) by default**; scalars are not. Mark values
  explicitly: `\(value, privacy: .public)` only after deliberate review.
- Use **equivalence-preserving hashing** for identifiers you need to correlate without
  exposing: `\(token, privacy: .private(mask: .hash))` — same input yields same hash across
  log lines, raw value never stored. Docs:
  https://developer.apple.com/documentation/os/oslogprivacy
- Redaction happens at **write time and is irreversible** — you cannot recover `<private>`
  values later, which is exactly the property the house redaction rules want.
- Alignment with repo rules: anything matching the backend's sensitive-key pattern
  (`redaction.ts:1-2`) — auth cookies, GitHub tokens, Vercel OAuth tokens, API keys — must
  never be interpolated `.public`. `requestId`, `sessionId`, `chatId`, `workflowRunId`,
  event names, statuses, and durations are safe `.public` (they're already first-class
  columns in `session_events`). Repo names/branches: default `.private(mask: .hash)`; user
  may opt into plain logging via a "verbose diagnostics" setting.

Example matching the backend log vocabulary (`logger.ts:6-23`):

```swift
Logger.api.notice("api_request_finished path=\(path, privacy: .public) status=\(status) duration_ms=\(ms) request_id=\(requestId, privacy: .public)")
```

### 1.3 Retrieving logs from users

Two channels; ship both:

1. **In-app OSLogStore export** (primary support flow; feeds section 6).
   - `OSLogStore(scope: .currentProcessIdentifier)` is the **only scope available to
     sandboxed iOS apps** (`.system` is macOS-only). Docs:
     https://developer.apple.com/documentation/oslog/oslogstore
   - It returns entries from the unified log store filtered to the current process. In
     practice it can include entries from earlier in the current boot session that survived
     pruning, but Apple gives **no contract for cross-launch retrieval** — design as if you
     only get "recent logs from this process," primarily `notice`+ levels.
   - Pattern: `store.getEntries(at: store.position(date: ...), matching: NSPredicate(format: "subsystem == %@", subsystem))`,
     map `OSLogEntryLog` → `{date, category, level, composedMessage}`. Worked example:
     https://useyourloaf.com/blog/fetching-oslog-messages-in-swift/
   - **Mitigation for the cross-launch gap**: keep a small app-owned JSONL ring buffer
     (e.g. last 2,000 `notice`+ events, size-capped, in Application Support, excluded from
     iCloud backup) written through the same redaction layer. This is what guarantees a
     crash-on-launch is still debuggable from the next session's export.
2. **sysdiagnose** (escalation path for system-level issues: push delivery, background kills,
   network stack). User triggers via hardware-button chord, retrieves from
   Settings → Privacy & Security → Analytics, AirDrops the multi-hundred-MB archive. Contains
   the full `.logarchive` including your subsystem. Apple profile/log instructions:
   https://developer.apple.com/bug-reporting/profiles-and-logs/
   Document this in a support runbook, not in-app.

---

## 2. MetricKit — free system telemetry

Framework docs: https://developer.apple.com/documentation/metrickit • WWDC20 "What's new in
MetricKit": https://developer.apple.com/videos/play/wwdc2020/10081/

Integration is ~30 lines: conform to `MXMetricManagerSubscriber`, `MXMetricManager.shared.add(self)`,
implement `didReceive(_: [MXMetricPayload])` and `didReceive(_: [MXDiagnosticPayload])`, POST the
built-in JSON representations to a backend collector.

What it gives for free:

- **`MXMetricPayload`** (daily aggregates): `applicationLaunchMetrics` (cold/resume launch
  histograms, "launch to first draw"), `applicationResponsivenessMetrics` (hang-time
  histogram), `applicationExitMetrics` (counts by exit reason: crash, watchdog, memory-limit,
  background-task-expiration — **the only reliable OOM/jetsam signal available to apps**),
  `memoryMetrics` (peak/average suspended footprint), `cpuMetrics`, `diskIOMetrics`,
  `networkTransferMetrics`, `animationMetrics` (scroll hitch rate), `signpostMetrics`.
- **`MXDiagnosticPayload`**: `MXCrashDiagnostic` (exception type/code, termination reason,
  unsymbolicated `MXCallStackTree`), `MXHangDiagnostic` (main-thread stacks + hang duration),
  `MXCPUExceptionDiagnostic`, `MXDiskWriteExceptionDiagnostic`, `MXAppLaunchDiagnostic`.
  Since iOS 15, diagnostic payloads can be delivered **promptly after the event** (often on
  next launch), not just in the daily window; Apple still says do not rely on a schedule.
- **`MXSignpostMetric` / `mxSignpost`** — custom aggregated metrics: wrap key flows
  (time-to-first-token of a chat stream, session list load, diff render) with
  `mxSignpost(.begin/.end, log: MXMetricManager.makeLogHandle(category:), name:)` and the
  system aggregates duration histograms into the daily payload.
  https://developer.apple.com/documentation/metrickit/mxsignpost(_:dso:log:name:signpostid:_:_:)

Limitations (why a crash SDK is still needed):

- Only devices opted into sharing analytics with developers; a sample, not a census.
- Call stacks are **unsymbolicated**; you'd need your own dSYM pipeline to read them.
- Aggregated/anonymous — no user/session/request correlation, no breadcrumbs.
- Not real-time enough for alerting; effectively useless in Simulator.

**Recommendation**: subscribe from day one, forward raw payload JSON to a tiny authenticated
collector endpoint (or to Sentry, which ingests MetricKit payloads natively — see §3), and
treat MetricKit as the source of truth for launch/hang/exit-reason KPIs per the discipline's
"OS-verified evidence beats self-reports" spirit. Sentry MetricKit integration docs:
https://docs.sentry.io/platforms/apple/guides/ios/configuration/metric-kit/

---

## 3. Crash reporting + analytics stack

### 3.1 Candidates (state as of mid-2026)

**Sentry (sentry-cocoa)** — https://docs.sentry.io/platforms/apple/guides/ios/

- Mature native crash capture (Mach exceptions, signals, NSExceptions), plus **watchdog
  termination detection, app-hang detection, and MetricKit ingestion** — categories PostHog
  does not cover.
- Performance/tracing: automatic URLSession instrumentation; propagates **`sentry-trace` +
  `baggage`** headers to configurable `tracePropagationTargets` for client→backend
  distributed tracing. https://docs.sentry.io/platforms/apple/guides/ios/tracing/trace-propagation/
- Self-serve symbolication via `sentry-cli` dSYM upload (CI step), optional
  `--include-sources` for source context.
- Ships its own `PrivacyInfo.xcprivacy` (since 8.21.0); declares diagnostics-category data
  only. https://docs.sentry.io/platforms/apple/data-management/apple-privacy-manifest/
- Explicit SwiftUI support (view-rendering instrumentation). Free dev tier; Team plan from
  ~$26/mo.

**Firebase Crashlytics** — free, excellent crash grouping, but: no distributed-trace header
convention to your own backend, pulls in FirebaseCore (larger privacy-manifest surface, more
Google data categories), no product analytics unless you also adopt Google Analytics. Ruled
out: adds a third vendor while solving only the crash slice.

**PostHog (posthog-ios)** — https://posthog.com/docs/libraries/ios

- Product analytics, feature flags, experiments, surveys: mature/GA.
- **Session replay for native iOS: GA** (SDK ≥3.19.2 GA changelog entry; replay docs require
  ≥3.6.0, tutorial ≥3.8.3) with SwiftUI masking (`postHogMask()`, default masking of
  text/images). https://posthog.com/docs/session-replay/installation/ios •
  https://posthog.com/docs/session-replay/privacy
- **Error tracking on iOS now exists** (SDK ≥3.56.0): `errorTrackingConfig.autoCapture = true`
  captures Mach exceptions, POSIX signals, uncaught NSExceptions; crashes persisted to disk
  and sent as `$exception` (level fatal) on next launch; dSYM upload supported for
  symbolication. https://posthog.com/docs/error-tracking/installation/ios
- Documented limitations of PostHog crash capture (from that page): system frames (UIKit,
  Foundation) are **not symbolicated** (open issue); Swift crashes surface as `SIGTRAP`
  **without the actual error message** (open issue); **no watchdog-termination, OOM, or
  hang capture**; not available on watchOS/visionOS.
- Offline event queueing to disk with flush-on-reconnect is built in; App Groups support for
  sharing analytics with extensions/widgets.

### 3.2 Recommended stack: Sentry for crashes/tracing + PostHog for product analytics

Justification:

1. **Crash fidelity.** This app's riskiest failure modes are long-lived SSE streams, large
   diff rendering, and background fetch — i.e. hangs, watchdog kills, and memory-limit exits
   at least as much as hard crashes. Sentry detects watchdog terminations and app hangs and
   ingests MetricKit diagnostics; PostHog's iOS error tracking captures none of those and
   still mangles Swift fatal-error messages (SIGTRAP issue). Filing a bug as "regression with
   evidence" (per house regression discipline) requires the real stack and termination
   reason.
2. **End-to-end tracing fits the house request-id contract.** Sentry's `sentry-trace`/
   `baggage` propagation plus our own `x-request-id` (already honored at
   `lib/harness/request-id.ts:9-16`) ties a slow mobile chat send to the exact workflow run
   row. Backend Sentry adoption is optional — `x-request-id` alone joins client traces to
   `session_events.request_id` and harness logs without touching the server.
3. **PostHog is still the right analytics layer.** The team's tooling orbit is already
   PostHog-centric (developer plugins, future web instrumentation would land there), and
   PostHog's flags/replay/analytics are GA on iOS. Using PostHog for *product* questions and
   Sentry for *stability* questions keeps each tool on its strength.
4. **Both ship privacy manifests and declare diagnostics/analytics-only categories**, keeping
   the nutrition label to "Data Not Used to Track" (§4).

PostHog-only fallback (acceptable if one-vendor simplicity wins): enable
`errorTrackingConfig.autoCapture`, add MetricKit subscription to backfill hang/exit-reason
data into PostHog as custom events, and accept degraded Swift crash messages + no watchdog
detection. Revisit when PostHog closes the SIGTRAP/system-symbolication issues. **Do not**
run Sentry crash capture and PostHog `autoCapture` simultaneously — two in-process crash
handlers (signal/Mach handler chaining) is a classic source of lost or corrupted reports;
pick exactly one crash-capturing SDK.

Configuration guardrails (both SDKs):

- Identify users by the opaque better-auth user id only — never email/name in `identify()`
  or Sentry user context beyond id.
- Scrub request/response bodies; Sentry `beforeSend` + PostHog property sanitizer should run
  a Swift port of `redactHarnessPayload` (same regexes as `redaction.ts:1-7`).
- Session replay: start with replay **off** or sampled at a low rate; this app renders user
  source code and tokens on screen — default masking must be verified screen-by-screen
  (mask diff views, env-var settings, API-key fields) before raising the sample rate.
- Respect a user-facing "Share diagnostics & analytics" toggle (PostHog `optOut()`, Sentry
  `options.enabled=false` at next launch); store the choice locally and surface it in
  Settings, mirroring the discipline's "which sensitive values must not be shown" question.

---

## 4. Privacy manifests + App Store nutrition labels

Apple docs:

- Privacy manifest files: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Required-reason APIs: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- Adopting privacy manifests (WWDC23): https://developer.apple.com/videos/play/wwdc2023/10060/

Enforced since May 1, 2024: App Store Connect rejects builds that use required-reason APIs
without declarations, or that include listed third-party SDKs without a bundled manifest +
signature.

What the app's own `PrivacyInfo.xcprivacy` must contain:

- `NSPrivacyTracking = false`, `NSPrivacyTrackingDomains = []` (no ATT prompt needed — we do
  no cross-app tracking).
- `NSPrivacyCollectedDataTypes`:
  - Diagnostics → Crash Data (purpose: App Functionality), linked=true if Sentry user id set.
  - Diagnostics → Performance Data (App Functionality/Analytics).
  - Usage Data → Product Interaction (Analytics) for PostHog events.
  - Identifiers → User ID (App Functionality, Analytics) — better-auth user id used in
    `identify()`.
  - Add "Other User Content" review if session replay is ever enabled un-sampled (replay can
    capture screen content).
- `NSPrivacyAccessedAPITypes` for the app's own code, typical needs:
  - `NSPrivacyAccessedAPICategoryUserDefaults` → reason `CA92.1` (app's own settings).
  - `NSPrivacyAccessedAPICategoryFileTimestamp` → `C617.1` if the diagnostics ring buffer
    inspects file dates.
  - `NSPrivacyAccessedAPICategorySystemBootTime` → `35F9.1` if computing uptime for SSE
    stall metrics (prefer `ContinuousClock`/`mach_continuous_time` wrappers that don't, to
    avoid the declaration).

SDK status: **sentry-cocoa bundles its manifest since 8.21.0** (diagnostics categories,
required-reason APIs declared); **posthog-ios bundles a manifest as well — verify the exact
`NSPrivacyCollectedDataTypes` entries in the pinned SDK version's `PrivacyInfo.xcprivacy`
during implementation** (their docs don't enumerate it; inspect the package checkout).
Xcode's Archive → "Generate Privacy Report" merges app+SDK manifests; the report is the
ground truth for filling the App Store Connect nutrition-label questionnaire, and the
questionnaire answers must match the merged manifests. Expected label: "Data Not Used to
Track"; Diagnostics + Usage Data + Identifiers listed, linked to identity, no Tracking
section.

Note: if PostHog/Sentry SDKs are statically linked, Xcode may not pick up their bundled
manifests automatically — use the SDK-provided manifest snippets at the app level in that
case (Sentry documents this explicitly).

---

## 5. Network-level observability

### 5.1 Request-ID propagation (REST)

Convention (zero backend change required):

- iOS networking layer generates `requestId = UUID().uuidString` per request (matches
  `SAFE_REQUEST_ID_PATTERN`, request-id.ts:1), sends it as `x-request-id`, logs
  `api_request_started`/`api_request_finished` at `notice` with
  `request_id`, `method`, `path`, `status`, `duration_ms` — the exact snake_case vocabulary
  of `HarnessLogEvent` (logger.ts:6-23).
- Read the **echoed** `x-request-id` plus `x-workflow-run-id` / `x-verified-build-run-id`
  response headers (chat route.ts:223-226, :373-376) and attach them to the in-app run
  status UI ("evidence" per discipline §core-rule) and to breadcrumbs.
- Keep `x-request-id` as the primary correlation key; optionally also let Sentry attach
  `sentry-trace`/`baggage` (restrict `tracePropagationTargets` to the open-agents API host
  only, so third-party hosts never see trace headers). If the backend later adopts OTel,
  W3C `traceparent` can be added without breaking the `x-request-id` join.
- Capture `URLSessionTaskMetrics` (via `urlSession(_:task:didFinishCollecting:)`) for
  DNS/connect/TLS/TTFB phase timing on slow requests.
  https://developer.apple.com/documentation/foundation/urlsessiontaskmetrics

### 5.2 SSE stream health (chat streaming)

The chat endpoint streams AI SDK UI-message chunks (`createUIMessageStreamResponse`,
route.ts:371-377) and supports resumption via the chat's `activeStreamId`
(route.ts:143-149, plus `app/api/chat/[chatId]/stream/route.ts` for reattach). The iOS
client will consume this with `URLSession.bytes(for:)` or a data-delegate parser. Per-stream
metrics to record (names align with house snake_case):

- `stream_connect_started` / `stream_first_byte_ms` / `stream_first_event_ms`
  (time-to-first-token is the headline UX metric — also wrap it in an `mxSignpost`).
- `stream_event_gap_ms` (p95 inter-chunk gap), `stream_bytes_total`, `stream_events_total`.
- `stream_stalled` — watchdog timer keyed on last-activity timestamp; threshold ~2-3x the
  server keepalive interval; on fire: log `notice`, surface "reconnecting…" status in UI
  (user-visible status is required evidence), cancel + resume.
- `stream_disconnect` with `reason` (server_close | network_lost | backgrounded | stalled |
  user_cancel) and `duration_ms`; `stream_resume_attempt`/`stream_resume_result` with the
  workflow run id — resumption goes through the dedicated stream route rather than
  `Last-Event-ID` (the AI SDK protocol manages its own resume cursor server-side).

Known URLSession pitfalls to engineer around:

- `timeoutIntervalForRequest` is an **idle timer between received bytes** — a quiet SSE
  stream (no keepalives) will be killed at the default 60s. Either confirm the backend's
  keepalive cadence or raise the per-request timeout for stream requests specifically.
- `waitsForConnectivity` holds tasks in "waiting" indefinitely; if enabled, instrument
  `taskIsWaitingForConnectivity` so waiting time isn't misread as server latency. Prefer an
  explicit reconnect state machine with exponential backoff for streams.
- Backgrounding suspends the process and drops the socket (`NSURLErrorNetworkConnectionLost`
  is *normal*, not exceptional — categorize, count, auto-resume on foreground). Background
  `URLSession` does not support streaming bodies usefully; on `scenePhase == .background`
  log an intentional `stream_disconnect reason=backgrounded` and resume on activation.
- Count `network_connection_lost` separately from genuine server errors so crash/error
  dashboards aren't polluted by expected mobile-network churn.

### 5.3 What gets sent where

- OSLog: everything (developer/local + diagnostics export).
- PostHog: product events (screen views, chat_sent, run_completed, settings_changed) +
  sampled stream-health metrics as event properties.
- Sentry: errors, stalled-stream events above threshold, breadcrumbs of recent
  `api_request_finished` lines (redacted), MetricKit payloads.

---

## 6. In-app "Export Diagnostics" — mirroring the chat debug bundle

Design an iOS diagnostic bundle that is the client-side sibling of
`buildChatDebugBundle` (`apps/web/lib/observability/chat-debug-bundle.ts:39-95`):

```jsonc
{
  "bundle": { "kind": "ios_debug_bundle", "version": 1, "generatedAt": "...",
              "redaction": { "status": "passed", "notes": [] } },
  "app":    { "version": "1.2.0", "build": "345", "bundleId": "...",
              "os": "iOS 19.x", "device": "iPhone17,2", "locale": "en_US" },
  "account": { "userId": "<opaque id>", "authState": "signedIn" },
  "settings": { /* non-sensitive prefs only; never tokens */ },
  "network": { "apiHost": "...", "recentRequests": [
      { "request_id": "...", "method": "POST", "path": "/api/chat",
        "status": 200, "duration_ms": 812, "at": "..." } ] },
  "streams": [ { "chat_id": "...", "workflow_run_id": "...", "request_id": "...",
                 "first_event_ms": 410, "events_total": 182,
                 "disconnects": [{ "reason": "network_lost", "at": "..." }] } ],
  "logs":   [ /* OSLogStore entries (subsystem-filtered, notice+) merged with the
                 app-owned ring buffer; bounded e.g. 4000 chars/entry, 2000 entries,
                 matching MAX_TEXT_CHARS=4000 in chat-debug-bundle.ts:21 */ ],
  "metrics": { "lastMetricKitSummary": { /* launch p50/p95, hang rate, exit reasons */ } }
}
```

Behavioral requirements, each mapped to the house rule it satisfies:

1. **Bounded** — cap entries and per-entry text (mirror `MAX_TEXT_CHARS = 4000`,
   chat-debug-bundle.ts:21, and the `[TRUNCATED]` suffix convention at :100-104).
2. **Redacted at assembly time** — run every string through the Swift port of
   `redactHarnessValue` before serialization; set `redaction.status` and refuse export
   (status `blocked`) if the redactor throws, mirroring `redactionStatus` enum
   (schema.ts:708-712).
3. **Omit raw bodies/artifacts** — like the server bundle omits log tails and artifact
   contents (diagnostic-bundles.md:43-48), never include request/response bodies, diff
   contents, or chat text in the client bundle; include ids + counts + statuses only. The
   server-side chat debug bundle already covers transcript content — the share-link flow
   (next point) is the sanctioned channel for that.
4. **Pairs with the server bundle** — the export UI for a specific chat should offer
   "Include server-side debug link," which calls
   `POST /api/sessions/:id/chats/:id/debug-bundle` with the user's session to mint the
   signed ≤24h URL (diagnostic-token.ts:5-13) and embeds that URL in the export. Support
   then has both halves joined by `request_id`/`chat_id`.
5. **Delivery** — write the JSON (optionally also a Markdown rendering, matching the server
   bundle's `?format=markdown` duality) to a temp file and present
   `ShareLink`/`UIActivityViewController`. No automatic upload — explicit user action only,
   consistent with "owner-authenticated, triage-scoped" bundle philosophy.
6. **Self-evidencing** — the export action itself logs a `diag` category `notice` event and
   (if analytics consented) a `diagnostics_exported` PostHog event, so support can confirm
   the bundle's provenance — "actions leave inspectable evidence."

---

## 7. Open questions / decisions for the plan author

(Also listed in structured output.)

1. Sentry+PostHog (recommended) vs PostHog-only — cost vs crash fidelity; exactly one crash
   handler either way.
2. Does the backend need a MetricKit/metrics collector endpoint, or is Sentry's MetricKit
   ingestion sufficient (no new backend surface)?
3. What is the chat SSE keepalive cadence in production (affects stall threshold +
   `timeoutIntervalForRequest`)? Needs a measurement, not an assumption.
4. Session replay: enabled at launch (low sample, masked) or deferred until a screen-by-screen
   masking audit of diff/settings/token views is done?
5. Should the iOS `x-request-id` carry a recognizable prefix (e.g. `ios.<uuid>` — pattern
   allows dots) so backend logs can attribute mobile traffic without a new header?
6. Verify posthog-ios's bundled `PrivacyInfo.xcprivacy` contents at the pinned version, and
   re-check PostHog's SIGTRAP/system-symbolication issues before committing to the fallback.
7. Who owns the dSYM upload CI step (fastlane lane vs Xcode Cloud post-action) — needed for
   both Sentry and PostHog symbolication.

## 8. Source URLs

- Apple OSLog/Logger: https://developer.apple.com/documentation/os/logger •
  https://developer.apple.com/documentation/oslog/oslogstore •
  https://developer.apple.com/documentation/os/oslogprivacy
- WWDC: https://developer.apple.com/videos/play/wwdc2020/10168/ (Explore logging in Swift) •
  https://developer.apple.com/videos/play/wwdc2023/10226/ (Debug with structured logging) •
  https://developer.apple.com/videos/play/wwdc2020/10081/ (What's new in MetricKit) •
  https://developer.apple.com/videos/play/wwdc2023/10060/ (privacy manifests)
- MetricKit: https://developer.apple.com/documentation/metrickit •
  https://developer.apple.com/documentation/metrickit/mxdiagnosticpayload
- Sysdiagnose: https://developer.apple.com/bug-reporting/profiles-and-logs/
- Sentry iOS: https://docs.sentry.io/platforms/apple/guides/ios/ •
  trace propagation: https://docs.sentry.io/platforms/apple/guides/ios/tracing/trace-propagation/ •
  privacy manifest: https://docs.sentry.io/platforms/apple/data-management/apple-privacy-manifest/ •
  MetricKit integration: https://docs.sentry.io/platforms/apple/guides/ios/configuration/metric-kit/
- PostHog iOS: https://posthog.com/docs/libraries/ios •
  error tracking: https://posthog.com/docs/error-tracking/installation/ios •
  replay: https://posthog.com/docs/session-replay/installation/ios •
  replay privacy/masking: https://posthog.com/docs/session-replay/privacy •
  changelog: https://github.com/PostHog/posthog-ios/blob/main/CHANGELOG.md
- Privacy manifests: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files •
  https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- URLSession metrics: https://developer.apple.com/documentation/foundation/urlsessiontaskmetrics
- OSLogStore example: https://useyourloaf.com/blog/fetching-oslog-messages-in-swift/
- SSE practice: https://hpbn.co/server-sent-events-sse/ • https://ably.com/topic/server-sent-events
