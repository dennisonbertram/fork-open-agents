# 06 — Testing Strategy

Status: planning document for the native iOS app workstream. Part of the plan set:
`00-overview.md`, `01-product-and-ux.md`, `02-api-contract-and-networking.md`,
`03-architecture.md`, `04-auth.md`, `05-streaming-chat-engine.md`,
`06-testing-strategy.md` (this document), `07-observability.md`,
`08-ci-cd-release.md`, `09-step-by-step-build-guide.md`.

This document defines how the iOS app is tested so that every slice complies with
`docs/process/behavior-tdd.md`, `docs/process/regression-discipline.md`, and
`docs/process/development-workflow.md`. It restates the canonical stack and never
re-decides it: Xcode 26.x, Swift 6.2 with strict concurrency, SwiftUI-only with
`@Observable` MVVM, minimum deployment iOS 26.0 / iPadOS 26.0, GRDB persistence,
XcodeGen, swift-openapi-generator 1.12.2, Swift Testing for unit tests,
swift-snapshot-testing 1.18.x, a thin XCUITest smoke suite, GitHub Actions
`macos-26` runners.

Package and target names below follow `03-architecture.md`. If a name in that
document differs, `03-architecture.md` wins and every command here substitutes the
name 1:1.

---

## 1. Governing rules (restated, not re-decided)

These rules from the repo's process docs apply verbatim to Swift code:

1. **Name the protected path first.** Every behavior-changing issue states one
   user/operator journey (section 2 catalog) in its `User/operator path protected`
   field before any test or code is written (`docs/process/behavior-tdd.md`).
2. **Red before green.** Write or identify the failing test, run the exact red
   command, record the output, commit `test(red): TASK-<issue> ...` on the work
   branch, then make the smallest green change and commit it separately
   (`docs/process/behavior-tdd.md`; commit conventions observed in `git log`).
3. **Deterministic tests before live services.** The proof ladder is: pure
   unit/contract test → integration with deterministic mocks → local simulator
   smoke → TestFlight smoke. Live servers and live LLM streams are canaries, never
   the primary regression suite (`docs/process/development-workflow.md`).
4. **Bugs become deterministic regressions.** A bug found on a device, in
   TestFlight, or against production must be converted to the closest
   deterministic local test before the fix merges
   (`docs/process/regression-discipline.md`).
5. **Do not normalize a red suite.** Record the baseline failure count and never
   increase it (`docs/process/development-workflow.md`).
6. **Durable lessons go to `docs/agents/lessons-learned.md`.**

The web-side gate `bun --bun run ci` cannot see Swift files (it globs
`**/*.test.ts(x)` via `scripts/test-isolated.ts`). Therefore:

- iOS-only slices run the **iOS gate** (section 11) and may state in the issue's
  Definition of done that `bun --bun run ci` is satisfied vacuously plus the iOS
  gate output.
- Slices that touch anything under `apps/web/` (every contract-expansion or auth
  endpoint slice) run **both** `bun --bun run ci` and the iOS gate.
- `git diff --check` applies to all slices unchanged.

---

## 2. Protected paths catalog for iOS

Every iOS feature or bug issue must name one of these (or add a new one to this
list in the same PR). These are the journeys the test pyramid exists to protect.

| ID | Protected path | Primary proof layer |
|----|----------------|---------------------|
| P1 | A user can sign in with Vercel OAuth (or Sign in with Apple) and the session survives app relaunch | Unit (token store) + XCUITest seam + manual TestFlight smoke |
| P2 | A signed-in user sees their session list and can open a session | Contract fixtures + snapshot + XCUITest smoke |
| P3 | A user can send a chat message and watch the assistant reply stream token-by-token | SSE fixture replay through the stream reducer + XCUITest smoke |
| P4 | A stream interrupted by backgrounding/network loss resumes and replays without duplicated or lost parts | SSE fixture replay (disconnect fixtures) + integration test |
| P5 | Tool calls, reasoning parts, file diffs, and data parts render correctly in the transcript | Fixture-driven reducer tests + snapshot tests |
| P6 | A user can create a session against a selected repository and the sandbox status is visible | Contract tests (server) + unit tests (view model) |
| P7 | Settings (model, runtime profile, preferences) persist across relaunch | Unit (GRDB + API round-trip with stubbed transport) |
| P8 | A user can delete their account from the app (App Store guideline 5.1.1(v)) | Server route test + contract test + unit test |
| P9 | Offline or degraded network shows cached sessions/transcripts with explicit staleness, never a blank crash | GRDB unit tests + snapshot of offline states |
| P10 | The generated API client stays in sync with `apps/web/openapi.json` | OpenAPI drift check (see `02-api-contract-and-networking.md`) |

---

## 3. The iOS test pyramid

| Layer | Framework | Where it lives | Runs on | When it runs |
|-------|-----------|----------------|---------|--------------|
| 1. Unit | Swift Testing (`import Testing`) | `ios/Packages/<Pkg>/Tests/<Pkg>Tests/` | macOS host (`swift test`) for UI-free packages; iOS simulator via `xcodebuild` for the rest | Every PR (blocking) |
| 2. Contract / fixture replay | Swift Testing + recorded fixtures | `ios/Packages/OpenAgentsAPI/Tests/`, `ios/Packages/OpenAgentsCore/Tests/` | macOS host | Every PR (blocking) |
| 3. Snapshot | swift-snapshot-testing 1.18.x on Swift Testing | `ios/App` target `OpenAgentsSnapshotTests` | Pinned iOS simulator | Every PR (blocking) |
| 4. UI smoke | XCUITest (XCTest) | `ios/App` target `OpenAgentsUITests` | Pinned iOS simulator | Nightly + release lane (non-blocking on PRs initially) |
| 5. Server-side | `bun:test` | `apps/web/app/api/**/route.test.ts`, `apps/web/tests/contract/` | ubuntu (existing `lint-and-typecheck` CI) | Every PR touching `apps/web/` (blocking) |
| 6. Live canaries | Contract suite vs running server; manual device smoke | `apps/web/tests/contract/` with `CONTRACT_BASE_URL`; TestFlight checklist | Local dev server / preview / device | Pre-release, never the only protection |

Rationale (from `docs/plans/ios-app/research/24-ios-testing-and-ci.md`): XCUITest
is slow and 10x-priced on macOS minutes; the streaming layer is the highest-risk
code and is fully testable deterministically below the UI. Invest in layers 1–3,
keep layer 4 thin (the single smoke scenario in section 7 plus at most a handful
of additions later).

---

## 4. Layer 1 — Swift Testing unit tests

### 4.1 Framework and conventions

- Framework: **Swift Testing** (ships in the Xcode 26 toolchain; no package
  dependency). XCTest is used **only** for XCUITest (section 7). Never mix
  `XCTAssert` inside `@Test` functions or `#expect` inside `XCTestCase`.
- Imports: `import Testing` plus `@testable import <TargetName>`.
- Tests run **in parallel by default**. Any suite touching shared mutable state
  (Keychain, a GRDB file on disk, a fixed-port mock server, `UserDefaults`)
  must be annotated `.serialized` or isolate its state (temp-dir DB per test,
  port 0 servers).
- Streaming tests must carry `.timeLimit(.minutes(1))` so a hung stream fails
  fast instead of stalling CI.

### 4.2 File and naming conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Test file | `<TypeUnderTest>Tests.swift` in `Tests/<TargetName>Tests/` mirroring the source folder structure | `ios/Packages/OpenAgentsCore/Tests/OpenAgentsCoreTests/Streaming/StreamReducerTests.swift` |
| Suite | `@Suite("<TypeUnderTest>")` struct named `<TypeUnderTest>Tests` | `@Suite("StreamReducer") struct StreamReducerTests` |
| Test function | lowerCamelCase behavior sentence; display name optional but preferred | `@Test("text-delta chunks append to the active message") func textDeltaAppends()` |
| Fixture-driven test | parameterized `@Test(arguments:)` over the fixture list | section 5.4 |
| Regression test | section 13 naming | `Regressions/StreamReducerRegressionTests.swift` |

### 4.3 Tag taxonomy

Define once in a shared test-support target
(`ios/Packages/OpenAgentsTestSupport/Sources/OpenAgentsTestSupport/Tags.swift`):

```swift
import Testing

public extension Tag {
  @Tag static var smoke: Self
  @Tag static var network: Self
  @Tag static var snapshot: Self
  @Tag static var regression: Self
  @Tag static var fixtureReplay: Self
}
```

Tags are used for grouping in Xcode test plans and `.xcresult` triage. CLI
filtering uses `--filter <name-regex>` (tag-based CLI filtering is not assumed).

`OpenAgentsTestSupport` also hosts: the `StubURLProtocol` (section 5.2), the SSE
fixture loader/replayer (section 5.4), GRDB temp-database helpers, and fixed
`Date`/locale providers for determinism.

### 4.4 Where unit tests live, per package

| Package | Test target | Host-runnable (`swift test`)? | What is unit-tested here |
|---------|-------------|-------------------------------|--------------------------|
| `ios/Packages/OpenAgentsCore` | `OpenAgentsCoreTests` | Yes (pure Foundation) | Stream reducer (`UIMessageChunk` → transcript state), message/part models, session state machines, diff models, date/format helpers |
| `ios/Packages/OpenAgentsAPI` | `OpenAgentsAPITests` | Yes | Auth `ClientMiddleware` (bearer header injection, `set-auth-token` rotation capture), SSE byte parser, retry/backoff policy, error mapping. Generated client code is exercised via fixtures (section 5.3), never unit-tested line-by-line |
| `ios/Packages/OpenAgentsPersistence` | `OpenAgentsPersistenceTests` | Yes (GRDB runs on macOS) | Schema migrations, `SessionCache`/`TranscriptCache` round-trips, cache eviction, "nuke and re-sync" escape hatch |
| `ios/Packages/OpenAgentsDesignSystem` | `OpenAgentsDesignSystemTests` | No (SwiftUI/iOS traits) — runs via `xcodebuild` | Token/value logic only; visual coverage is snapshots (section 6) |
| `ios/Packages/OpenAgentsFeatures` (or per-feature packages per `03-architecture.md`) | `OpenAgentsFeaturesTests` | No — runs via `xcodebuild` | `@Observable` view models with stubbed API/persistence dependencies: loading/empty/error transitions, action handling, navigation route emission |
| `ios/App` app target | `OpenAgentsTests` | No — runs via `xcodebuild` | Composition root wiring only (DI graph builds, deep-link routing). Keep minimal; logic belongs in packages |

Rule of placement: **a test lives in the smallest package that owns the
behavior.** If a test needs two feature packages, the behavior probably belongs
in `OpenAgentsCore` — move it.

### 4.5 Commands

Host-runnable packages (fast inner loop, no simulator):

```bash
swift test --package-path ios/Packages/OpenAgentsCore
swift test --package-path ios/Packages/OpenAgentsAPI
swift test --package-path ios/Packages/OpenAgentsPersistence

# Single suite / single test (red-state proof):
swift test --package-path ios/Packages/OpenAgentsCore \
  --filter "StreamReducerTests"
swift test --package-path ios/Packages/OpenAgentsCore \
  --filter "StreamReducerTests/textDeltaAppends"
```

Everything (all package test targets + app test targets, on the pinned
simulator). The XcodeGen-generated project is not committed; generate it first:

```bash
xcodegen generate --spec ios/App/project.yml --project ios/App
xcodebuild test \
  -project ios/App/OpenAgents.xcodeproj \
  -scheme OpenAgents \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0' \
  -resultBundlePath TestResults \
  -skipMacroValidation -skipPackagePluginValidation \
  -enableCodeCoverage YES

# Filter to one target / suite / test:
#   -only-testing:OpenAgentsFeaturesTests
#   -only-testing:OpenAgentsSnapshotTests/ChatTranscriptSnapshotTests
#   -only-testing:OpenAgentsUITests/SmokeTests/signedInUserCanSendMessageAndSeeStreamedReply
```

The `OpenAgents` scheme's Test action (declared in `ios/App/project.yml`) must
include every package test target plus `OpenAgentsTests` and
`OpenAgentsSnapshotTests`, and exclude `OpenAgentsUITests` (UI tests run via the
separate `OpenAgentsUITests` scheme; see `08-ci-cd-release.md`).

Simulator availability check (run once per machine/runner; exact device names on
the `macos-26` runner image must be read from its readme and pinned in
`08-ci-cd-release.md`):

```bash
xcrun simctl list devices available | grep "iPhone 17 Pro" \
  || xcodebuild -downloadPlatform iOS
```

---

## 5. Layer 2 — Contract tests: fixtures through the reducer and the generated client

This layer is the deterministic stand-in for the live server. It has three parts.

### 5.1 What is being protected

- The **SSE wire protocol**: AI SDK v6 UI Message Stream (`data: {json}` lines,
  `data: [DONE]` terminator, `x-vercel-ai-ui-message-stream: v1` header,
  resumable replay from chunk 0). Exact chunk types and framing are specified in
  `05-streaming-chat-engine.md` and
  `docs/plans/ios-app/research/22-swift-sse-and-stream-protocol.md`.
- The **JSON shapes** of every REST route the app calls, as decoded by the
  generated client in `ios/Packages/OpenAgentsAPI` (generation pipeline and
  drift check are specified in `02-api-contract-and-networking.md`).

### 5.2 `StubURLProtocol` (unit tier)

All networking unit tests inject a `URLSession` built from
`URLSessionConfiguration.ephemeral` with
`configuration.protocolClasses = [StubURLProtocol.self]`. Never use
`URLSession.shared` in `OpenAgentsAPI` — the session is always injected.

`StubURLProtocol` (in `OpenAgentsTestSupport`) supports chunked delivery for
SSE: respond with headers (`Content-Type: text/event-stream`,
`x-vercel-ai-ui-message-stream: v1`), then call
`client?.urlProtocol(self, didLoad: chunkData)` once per chunk with a
configurable inter-chunk delay (default 10 ms), then
`urlProtocolDidFinishLoading`. `URLSession.bytes(for:)` surfaces these
incrementally, which makes partial-event buffering, cancellation, and
reconnect/backoff all unit-testable in-process.

**Mandatory spike test (write this first, in the first networking issue):**

```swift
@Test("two SSE events delivered as two chunks arrive as two parser emissions",
      .timeLimit(.minutes(1)))
func chunkBoundariesAreNotCoalesced() async throws { /* ... */ }
```

This proves URLSession does not coalesce small `didLoad` chunks before
delivery to `AsyncBytes` on the iOS 26 SDK (flagged medium-confidence in
research brief 24). If it fails, the SSE parser tests switch to the FlyingFox
tier below and the result is recorded in `docs/agents/lessons-learned.md`.

### 5.3 In-process HTTP server (integration tier)

For tests that must exercise the **generated client end-to-end over real HTTP**
(URL building, headers, middleware, status-code mapping), use
**FlyingFox** (`https://github.com/swhitty/FlyingFox`) started on **port 0** per
suite. Pin an exact version in
`ios/Packages/OpenAgentsTestSupport/Package.swift` at adoption time (check the
latest release tag on GitHub; record it in the committed `Package.resolved`).
FlyingFox is a **test-only dependency** — it must never appear in an app-target
dependency graph.

Suites using FlyingFox are `.serialized` only if they share a server instance;
prefer one server per suite on port 0 so parallelism is preserved.

### 5.4 Fixture replay

Fixture layout (committed to git):

```
ios/Fixtures/
  sse/
    chat-simple-text.sse.txt          # one user msg -> short assistant text
    chat-tool-call.sse.txt            # tool call + result parts
    chat-reasoning.sse.txt            # reasoning parts
    chat-file-diff.sse.txt            # data parts carrying diff payloads
    chat-multiline-data.sse.txt       # multi-line `data:` event
    chat-keepalive-comments.sse.txt   # `:` comment/heartbeat lines
    chat-malformed-event.sse.txt      # garbage line mid-stream
    chat-disconnect-midstream.sse.txt # truncated, no [DONE]
    chat-resume-replay.sse.txt        # full replay-from-chunk-0 of an interrupted stream
  json/
    sessions-list.json                # GET /api/sessions
    sessions-list.meta.json
    session-detail.json
    models-list.json
    settings-preferences.json
    ...one pair per route the app consumes (full route list in 02-api-contract-and-networking.md)
```

Both `OpenAgentsCore` and `OpenAgentsAPI` test targets declare
`ios/Fixtures` as a test resource (SPM `resources: [.copy("../../Fixtures")]`
or a symlinked `Fixtures` folder per target — `03-architecture.md` fixes the
mechanism) and load via `Bundle.module`.

Replay tests are parameterized:

```swift
@Suite("Stream reducer fixture replay", .tags(.fixtureReplay))
struct StreamReducerFixtureTests {
  @Test("fixture replays to a stable final transcript",
        arguments: SSEFixture.allCases)
  func replayProducesExpectedTranscript(fixture: SSEFixture) async throws {
    let chunks = try fixture.wireChunks() // split on \n\n event boundaries
    var reducer = StreamReducer()
    for chunk in chunks { try reducer.consume(chunk) }
    let expected = try fixture.expectedTranscript() // sibling .expected.json
    #expect(reducer.transcript == expected)
  }
}
```

Each `*.sse.txt` fixture has a sibling `*.expected.json` containing the final
reduced transcript. When a fixture is added, its expected file is written by a
one-off recording run and **reviewed by hand** before commit (it is the
assertion, not a snapshot that silently regenerates).

The same JSON fixtures are decoded through the **generated** OpenAPI client
types in `OpenAgentsAPITests` (served via `StubURLProtocol` or FlyingFox), so a
server schema change that breaks decoding fails this layer before any UI work.

### 5.5 Fixture recording, sanitizing, and refresh

**Recording.** Script: `ios/Scripts/record-fixtures.sh`. Preconditions: a local
web server running (`bun run web`, default `http://localhost:3000`; use the port
you actually started) with test auth enabled (`NODE_ENV=development` enables it,
or set `OPEN_AGENTS_ENABLE_TEST_AUTH=1`). The dev test-auth cookie is defined in
`apps/web/lib/session/test-auth.ts`:
cookie name `open_agents_test_user_id`, required value
`dev-managed-runtime-user`.

```bash
BASE_URL="${BASE_URL:-http://localhost:3000}"
COOKIE="open_agents_test_user_id=dev-managed-runtime-user"

# JSON route example:
curl -sS -H "cookie: $COOKIE" "$BASE_URL/api/sessions" \
  | jq . > ios/Fixtures/json/sessions-list.json

# SSE route example (POST /api/chat; body shape per research brief 01):
curl -sS -N --no-buffer -X POST "$BASE_URL/api/chat" \
  -H "cookie: $COOKIE" -H "content-type: application/json" \
  -d @ios/Scripts/fixtures/chat-simple-text.request.json \
  > ios/Fixtures/sse/chat-simple-text.sse.txt
```

**Metadata.** SSE comment lines (leading `:`) are legal SSE; prepend three to
every recorded SSE fixture (they double as parser test input):

```
: recorded-at=2026-06-10
: route=POST /api/chat
: server-commit=<git rev-parse HEAD of apps/web at record time>
```

JSON fixtures get a sibling `<name>.meta.json` with the same three fields.

**Sanitizing — checklist before any fixture is committed:**

- [ ] No `set-cookie`, `authorization`, or `set-auth-token` header values
      captured (fixtures are bodies only; never commit raw header dumps).
- [ ] No bearer tokens, API keys, or `ghs_`/`gho_`/`vc_`-prefixed strings
      (grep: `grep -rEn "ghs_|gho_|vc_|Bearer " ios/Fixtures/` returns nothing).
- [ ] User identity fields replaced with the test-auth user
      (`dev-managed-runtime-user`) or obvious placeholders; no real emails.
- [ ] Repository names/URLs are test repos, not private real ones.
- [ ] Prompt/transcript content is synthetic (recorded from scripted prompts,
      never from real working sessions).

Run `ios/Scripts/sanitize-fixtures.sh` (jq/sed passes implementing the greps
above) and review the diff manually.

**Refresh policy.** Re-record a fixture only when one of these happens, and
always in its own commit titled `test(fixtures): re-record <name> — <reason>`:

1. The UI message stream protocol version changes (header
   `x-vercel-ai-ui-message-stream` ≠ `v1`).
2. `apps/web/openapi.json` changes a schema covered by the fixture (the drift
   check in `02-api-contract-and-networking.md` flags this).
3. The server route's behavior intentionally changed and the corresponding
   server-side test changed in the same PR.

Never re-record to "fix" a failing iOS test without one of the three reasons —
that converts a real regression into silent acceptance.

---

## 6. Layer 3 — Snapshot tests (swift-snapshot-testing 1.18.x)

### 6.1 Setup

Dependency, declared in `ios/App/project.yml` for the `OpenAgentsSnapshotTests`
target (and only there — never in app or package release graphs):

```yaml
packages:
  SnapshotTesting:
    url: https://github.com/pointfreeco/swift-snapshot-testing
    from: 1.18.7   # stays within 1.18.x; committed Package.resolved is the pin
```

Snapshot tests use Swift Testing with the library's trait API (available since
1.17.0; the old global `isRecording`/`diffTool` are deprecated — do not use
them). All snapshot suites are `@MainActor` (UIHostingController requirement).

```swift
import SnapshotTesting
import Testing
@testable import OpenAgentsFeatures

@MainActor
@Suite("Chat transcript snapshots", .tags(.snapshot), .snapshots(record: .missing))
struct ChatTranscriptSnapshotTests {
  @Test func streamingStateLight() {
    let view = ChatTranscriptView(model: .fixtureStreaming)
    assertSnapshot(of: view, as: .image(layout: .device(config: .iPhone13Pro)))
  }
}
```

### 6.2 Record / verify workflow

| Situation | What you do |
|-----------|-------------|
| New snapshot test | Default trait `.snapshots(record: .missing)` writes the missing reference on first local run; the test passes; commit the new `__Snapshots__` PNGs with the test |
| Intentional UI change | Run once with `SNAPSHOT_TESTING_RECORD=all` env var set on the test action (`SNAPSHOT_TESTING_RECORD=all xcodebuild test ... -only-testing:OpenAgentsSnapshotTests/<Suite>`), review every changed PNG in the git diff, commit |
| CI | Always `SNAPSHOT_TESTING_RECORD=never` (set in the workflow env; see `08-ci-cd-release.md`) so a retry can never silently rewrite baselines |
| Unexplained failure | Do NOT re-record. Download the `.xcresult` artifact, inspect the attached diff images, find the regression |

### 6.3 Layout / variant matrix

Snapshot layouts are **pinned `ViewImageConfig` containers**, deliberately
decoupled from the CI simulator device (they only fix size + traits, which is
what makes them deterministic):

| Variant suffix | Config | Why |
|----------------|--------|-----|
| (none, canonical) | `.device(config: .iPhone13Pro)` (390×844), light, Dynamic Type `.large` | Baseline phone layout |
| `dark` | same + `traits: UITraitCollection(userInterfaceStyle: .dark)` | Dark-mode regressions |
| `ax3` | same + `traits: UITraitCollection(preferredContentSizeCategory: .accessibilityExtraLarge)` | Dynamic Type AX3 — catches truncation/overlap |
| `ipad` | `.device(config: .iPadPro11)` (834×1194) | iPad layout (multicolumn per `01-product-and-ux.md`) |

Naming: `assertSnapshot(of: view, as: ..., named: "dark")` etc. Every screen in
the required set gets the canonical variant; `dark` and `ax3` are required for
the chat transcript and session list; `ipad` is required for any screen with an
iPad-specific layout.

Required screens for v1 (states come from the fixtures in section 5.4 and the
state inventory in `01-product-and-ux.md`):

- Chat transcript: empty, streaming text, tool-call part, reasoning part,
  diff part, error state
- Session list: loading, populated, empty, offline/stale (P9)
- Settings: populated
- Sign-in screen: signed-out

### 6.4 Determinism hygiene (checklist for every snapshot suite)

- [ ] Fixed `Date`s injected via the test-support clock; no `Date()` in fixtures.
- [ ] Locale/timezone fixed (`en_US`, `UTC`) via trait injection on the hosting
      environment.
- [ ] No live `AsyncImage`/network: image sources stubbed.
- [ ] Animations irrelevant (static view values; never snapshot mid-animation).
- [ ] Sheet/modal content snapshotted as its own root view (modals are not
      captured through the presenting view).
- [ ] Liquid Glass caveat acknowledged: GPU-level glass effects do not render
      fully in `UIHostingController` image snapshots — snapshots verify layout
      and structure, not final visual chrome. Visual chrome QA is the manual
      TestFlight checklist in `08-ci-cd-release.md`.

### 6.5 Storage and review policy

- Reference images live in `__Snapshots__/` directories next to the test files
  and are **committed to git**. Expected scale: low-hundreds of PNGs, single-MB
  total — acceptable without LFS; revisit if `ios/` exceeds ~50 MB of snapshots.
- PR review of snapshot changes is mandatory: GitHub renders PNG diffs; the PR
  description must state *why* baselines changed. A PR that re-records
  baselines with no UI-change rationale is rejected.
- Snapshots are environment-pinned artifacts: one canonical recording
  environment = the CI environment = **Apple Silicon, pinned Xcode 26.x, pinned
  iOS 26.0 simulator runtime** (exact pins live in `08-ci-cd-release.md`). If a
  local machine produces diffs CI does not, trust CI and record on a matching
  runtime (`xcodebuild -downloadPlatform iOS -buildVersion <ver>` to install).
- Deliberate runtime bumps (expected once or twice a year) re-record ALL
  baselines in one dedicated PR titled
  `chore(ios): re-record snapshots for iOS <ver> runtime` with no other changes.

---

## 7. Layer 4 — the thin XCUITest smoke

One scenario for v1. It is the executable form of protected paths P1–P3 and the
iOS analog of the web repo's authenticated local UI smoke.

### 7.1 Test seam (designed into the app from day one)

The app target reads these launch-environment keys **only in DEBUG builds**
(compiled out of release via `#if DEBUG`):

| Key | Effect |
|-----|--------|
| `OPENAGENTS_UITEST=1` | Disables animations (`UIView.setAnimationsEnabled(false)`), uses an in-memory GRDB database, uses an in-memory token store instead of Keychain |
| `OPENAGENTS_API_BASE_URL` | Overrides the API base URL (points at the in-test mock server) |
| `OPENAGENTS_TEST_BEARER_TOKEN` | Seeds the in-memory token store → app launches in signed-in state, skipping ASWebAuthenticationSession entirely (the OAuth flow itself is covered by unit tests in `04-auth.md` plus the manual TestFlight checklist) |

### 7.2 Accessibility identifiers

Single source of truth: `ios/App/Sources/Support/A11yID.swift`, compiled into
**both** the app target and `OpenAgentsUITests` (listed in both targets'
sources in `ios/App/project.yml`). Never query by display text or index.

```swift
public enum A11yID {
  public enum SessionList {
    public static let root = "session-list.root"
    public static func row(_ sessionId: String) -> String { "session-list.row.\(sessionId)" }
  }
  public enum Chat {
    public static let transcript = "chat.transcript"
    public static let composerField = "chat.composer-field"
    public static let sendButton = "chat.send-button"
    public static func assistantMessage(_ index: Int) -> String { "chat.message.assistant.\(index)" }
  }
}
```

Every element a UI test touches gets
`.accessibilityIdentifier(A11yID...)` at the point the view is built.

### 7.3 The exact smoke scenario

File: `ios/App/UITests/SmokeTests.swift`, class `SmokeTests: XCTestCase`,
page objects in `ios/App/UITests/Screens/` (one object per screen wrapping
queries + waits).

Flow (test method `testSignedInUserCanSendMessageAndSeeStreamedReply`):

1. **Arrange:** start FlyingFox in the test-runner process on port 0. Register
   handlers: `GET /api/sessions` → `ios/Fixtures/json/sessions-list.json`
   (contains exactly one session with a known id, e.g. `sess-uitest-1`);
   `GET` session detail/messages routes → corresponding JSON fixtures;
   `POST /api/chat` → streams `ios/Fixtures/sse/chat-simple-text.sse.txt`
   line-grouped on `\n\n` boundaries with 25 ms inter-chunk delay,
   `Content-Type: text/event-stream`, `x-vercel-ai-ui-message-stream: v1`.
2. **Launch** with the seam:

   ```swift
   let app = XCUIApplication()
   app.launchEnvironment = [
     "OPENAGENTS_UITEST": "1",
     "OPENAGENTS_API_BASE_URL": "http://127.0.0.1:\(server.port)",
     "OPENAGENTS_TEST_BEARER_TOKEN": "uitest-token",
   ]
   app.launch()
   ```

3. **Assert signed-in state:** session list visible —
   `app.otherElements[A11yID.SessionList.root].waitForExistence(timeout: 10)`.
4. **Open session:** tap `A11yID.SessionList.row("sess-uitest-1")`; assert
   `A11yID.Chat.transcript` exists.
5. **Send message:** tap `A11yID.Chat.composerField`, type `"hello"`, tap
   `A11yID.Chat.sendButton`. Assert the mock server received `POST /api/chat`
   (server records requests; expose `server.receivedRequests`).
6. **See streamed reply:** wait (predicate expectation, timeout 15 s) until
   `app.staticTexts[A11yID.Chat.assistantMessage(0)].label` contains the final
   sentence from the fixture's expected transcript. Optionally assert an
   intermediate partial render exists before the final one (proves streaming,
   not batch render).

### 7.4 Flake rules (hard requirements)

- `waitForExistence(timeout:)` / `XCTNSPredicateExpectation` only. **`sleep` is
  banned** in `ios/App/UITests/` (enforced by grep in the iOS gate script:
  `grep -rn "sleep(" ios/App/UITests/ && exit 1 || true`).
- Animations disabled via the seam; fresh in-memory state per launch.
- The smoke runs on PRs as a **non-blocking** job initially and as a
  **blocking** step in the nightly and release lanes (`08-ci-cd-release.md`).
  It becomes PR-blocking after 20 consecutive green nightly runs.
- Nightly runs use `-test-iterations 3 -retry-tests-on-failure` as a **flake
  detector**; PR/release runs use no retries.

Run locally:

```bash
xcodegen generate --spec ios/App/project.yml --project ios/App
xcodebuild test \
  -project ios/App/OpenAgents.xcodeproj \
  -scheme OpenAgentsUITests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0' \
  -resultBundlePath UITestResults
```

---

## 8. Layer 5 — server-side tests for every new endpoint

The plan adds server work (see `02-api-contract-and-networking.md` and
`04-auth.md`): better-auth `bearer()` plugin, Sign in with Apple, account
deletion, mobile deep-link callback handling, and OpenAPI contract expansion in
`apps/web/lib/api/openapi-spec.ts`. **Every such slice is a normal web slice**
and follows the existing repo discipline exactly. No new infrastructure.

### 8.1 Route unit tests (colocated, mandatory)

Pattern: a `route.test.ts` file **next to the route**, using `bun:test` with
`mock.module` for collaborators and plain `Request` objects against the
exported handler. Copy the structure of
`apps/web/app/api/sessions/route.test.ts` (mocks
`@/lib/session/get-server-session`, `@/lib/botid`, `@/lib/rate-limit`, builds
`new Request(url, ...)`, asserts status + JSON body).

| New surface | Test file to create |
|-------------|---------------------|
| Bearer-token session resolution on existing routes | extend the owning route's existing `route.test.ts` + a focused test beside the auth helper it changes (e.g. `apps/web/lib/auth/bearer.test.ts`) |
| Sign in with Apple provider wiring | `apps/web/lib/auth/config.test.ts` (or extend the existing auth config test if one exists at implementation time) |
| Account deletion route | `apps/web/app/api/account/route.test.ts` (exact route path fixed in `04-auth.md`; the test file is always `route.test.ts` beside the `route.ts`) |
| OpenAPI spec expansion | `apps/web/lib/api/openapi-spec.test.ts` — extend the existing colocated test with assertions for every newly documented path/schema |

Red/green commands:

```bash
# Red proof for one route:
bun test apps/web/app/api/account/route.test.ts
# Adjacent suite (the owning folder):
bun test apps/web/app/api/account
# Full repo gate (required for every apps/web change):
bun --bun run ci
```

`bun --bun run ci` runs `bun run check && bun run typecheck &&
bun run test:isolated && bun run --cwd apps/web db:check`
(root `package.json`); `test:isolated` executes each `*.test.ts` file in its
own process, so route tests must not depend on cross-file state.

### 8.2 HTTP contract tests (real server, mandatory for new endpoints)

Location: `apps/web/tests/contract/`, using the existing shared client
`apps/web/tests/contract/_client.ts`. These run against a real server using the
dev test-auth cookie and **skip automatically when `CONTRACT_BASE_URL` is
unset**, so `bun run ci` stays green.

New files to add alongside the existing `auth.test.ts`, `reads.test.ts`,
`git-routes.test.ts`, `skills-crud.test.ts`:

- `apps/web/tests/contract/auth-bearer.test.ts` — bearer token issued via the
  `set-auth-token` header is accepted on a protected read; rotated token
  replaces the old one; an expired/garbage token gets 401.
- `apps/web/tests/contract/account-deletion.test.ts` — deletion route gated by
  auth; correct status codes (use a dedicated throwaway test user mechanism per
  `04-auth.md`; never the shared `dev-managed-runtime-user` for destructive
  asserts — read-only shape checks if isolation is not yet available, with the
  destructive path covered at the route-unit layer).

Run:

```bash
# Server: bun run web (with OPEN_AGENTS_ENABLE_TEST_AUTH=1 if not NODE_ENV=development)
CONTRACT_BASE_URL=http://localhost:3000 bun run test:contract
```

### 8.3 OpenAPI contract gates

Every endpoint the iOS app consumes must be documented in
`apps/web/lib/api/openapi-spec.ts` (the contract-expansion workstream in
`02-api-contract-and-networking.md`). Per slice:

```bash
bun run --cwd apps/web openapi:generate   # regenerate apps/web/openapi.json
bun run --cwd apps/web openapi:check      # must stay green (scripts/check-openapi.ts)
```

The committed Swift client in `ios/Packages/OpenAgentsAPI` has a CI drift check
against `apps/web/openapi.json` (defined in `02-api-contract-and-networking.md`);
a server PR that changes the spec without regenerating the Swift client fails
that check.

### 8.4 Compatibility constraint the iOS app imposes on server tests

A shipped app binary is the analog of an old deployment: **the server must stay
compatible with the API shapes consumed by app versions in the field.** Any
server PR that changes a response schema consumed by iOS must (a) be additive,
or (b) include a dated deprecation note in the PR's
`## Deploy / Migration Notes`, and the iOS fixture for that route is re-recorded
in the same PR (section 5.5 reason 3).

---

## 9. The red-first workflow, per issue

This is `docs/process/behavior-tdd.md` instantiated for iOS. Every
feature/bug issue's `Tests to add first` and `TDD audit trail` sections are
filled with these exact elements.

### 9.1 Mapping table

| behavior-tdd.md element | iOS instantiation |
|--------------------------|-------------------|
| Protected path named | One P-id from section 2, written into the issue |
| Smallest unit/contract test | Swift Testing test in the owning package (section 4.4 placement rule) |
| Expected red command | `swift test --package-path ios/Packages/<Pkg> --filter "<Suite>/<test>"` for host-runnable packages; otherwise `xcodebuild test ... -only-testing:<Target>/<Suite>/<test>` (full command in section 4.5) |
| Expected red reason | One sentence: which assertion fails and why (e.g. "`#expect(reducer.transcript == expected)` fails because tool-call chunks are dropped") |
| Behavior/integration proof | Fixture-replay test (section 5.4), snapshot test (section 6), or — for P1–P3 UI-visible work — the XCUITest smoke step it extends |
| Red commit | `test(red): TASK-<issue#> failing <area> tests for <behavior>` |
| Green commit | `feat(ios): <behavior> (#<issue#>)` or `fix(ios): ... (#<issue#>)` |
| Adjacent suite | The whole test target owning the touched module (e.g. `swift test --package-path ios/Packages/OpenAgentsCore`) |
| Repo-level check | The iOS gate (section 11) + `git diff --check`; plus `bun --bun run ci` when `apps/web/` was touched |

### 9.2 Exact procedure (what a weak model executes)

1. Read the issue. Copy the `Expected red command` from its
   `Tests to add first` section.
2. Write only the test file(s). Run the red command. **Verify the output shows
   the new test failing for the stated reason** — not a compile error in
   unrelated code, not a missing fixture. If the failure reason differs from
   the issue's `Expected red reason`, stop and fix the test until it matches.
3. Paste the failing output (last ~20 lines) into the issue's `TDD audit
   trail` section.
4. Commit: `git add <test files and fixtures only>` then
   `git commit -m "test(red): TASK-<n> failing <area> tests for <behavior>"`.
5. Implement the smallest change. Re-run the red command — now green.
6. Run the adjacent suite command from the issue. Run the iOS gate
   (section 11) and `git diff --check`.
7. Commit: `git commit -m "feat(ios): <behavior> (#<n>)"`.
8. Push the branch (`feat/<slug>` branched from `origin/develop`) and open the
   PR into `develop` with the `## Test Evidence` section filled: red command +
   output, red commit SHA, green command + output, green commit SHA, adjacent
   suite result, gate result.

### 9.3 Red state in CI

The red commit lives in branch history as the audit trail; CI runs on the PR
head, which is green. The iOS CI job (defined in `08-ci-cd-release.md`) does
**not** need to observe red — the local red output pasted into the issue plus
the `test(red):` commit SHA is the proof, exactly as the web side does it. If
red and green cannot be separated into commits (rare; e.g. a pure-refactor
slice), the issue's TDD audit trail must say why, using the template's built-in
escape hatch.

### 9.4 Worked example (the shape every issue follows)

Issue: `feat: render tool-call parts in the chat transcript` (protected path
P5).

- Tests first:
  - `ios/Packages/OpenAgentsCore/Tests/OpenAgentsCoreTests/Streaming/StreamReducerToolCallTests.swift`
    asserting `chat-tool-call.sse.txt` reduces to a transcript containing a
    `toolCall` part with the fixture's tool name and arguments.
  - Red command:
    `swift test --package-path ios/Packages/OpenAgentsCore --filter "StreamReducerToolCallTests"`
  - Snapshot test
    `ChatTranscriptSnapshotTests/toolCallState` (red command:
    `xcodebuild test ... -only-testing:OpenAgentsSnapshotTests/ChatTranscriptSnapshotTests/toolCallState`
    — red because the reference image is intentionally absent and CI mode is
    `never`; locally it records under `.missing` after the reducer is green).
- Commits: `test(red): TASK-310 failing tool-call reducer tests` →
  `feat(ios): render tool-call parts in transcript (#310)`.
- Adjacent suite: `swift test --package-path ios/Packages/OpenAgentsCore`.
- Gate: `ios/Scripts/ci-gate.sh` + `git diff --check`.

---

## 10. Coverage expectations per package

Coverage is measured from the `xcodebuild test -enableCodeCoverage YES` result
bundle:

```bash
xcrun xccov view --report --json TestResults.xcresult > coverage.json
ios/Scripts/check-coverage.sh coverage.json   # compares against the table below
```

| Target | Line-coverage floor | Notes |
|--------|--------------------:|-------|
| `OpenAgentsCore` | 90% | The stream reducer and message models are the app's riskiest logic; fixture replay should get this nearly free |
| `OpenAgentsAPI` (hand-written sources) | 85% | Middleware, SSE transport, error mapping. **Generated code under `Sources/Generated/` is excluded** from the calculation (filter by path in `check-coverage.sh`) |
| `OpenAgentsPersistence` | 80% | Migrations + cache round-trips |
| `OpenAgentsFeatures` (view models) | 70% | View bodies excluded where measurable; snapshots carry the view layer |
| `OpenAgentsDesignSystem` | no numeric floor | Covered by snapshots; numeric line coverage of SwiftUI bodies is noise |
| `ios/App` app target | no numeric floor | Composition root only |

Enforcement: **advisory** (job prints the table, never fails) until the
streaming milestone in `09-step-by-step-build-guide.md` is complete; then
`check-coverage.sh` exits non-zero under floor and the iOS gate fails. Floors
only ratchet up, never down, without a PR that edits this document with a
rationale.

Coverage is a tripwire, not a goal: a PR that adds assertion-free tests to hit
a number violates the spirit and gets rejected in review.

---

## 11. The iOS gate (the `bun run ci` analog)

One script, `ios/Scripts/ci-gate.sh`, runnable locally and in CI (workflow
wiring in `08-ci-cd-release.md`), mirroring the web gate's shape
(format/lint → typecheck/build → tests → contract check):

```bash
#!/usr/bin/env bash
set -euo pipefail
# 1. Format/lint (Swift analog of `bun run check`; tool pins in 08-ci-cd-release.md)
swiftformat --lint ios
swiftlint --strict --config ios/.swiftlint.yml
# 2. Fast host-runnable package tests
swift test --package-path ios/Packages/OpenAgentsCore
swift test --package-path ios/Packages/OpenAgentsAPI
swift test --package-path ios/Packages/OpenAgentsPersistence
# 3. Generate project + full simulator suite (units + snapshots; NOT UI tests)
xcodegen generate --spec ios/App/project.yml --project ios/App
SNAPSHOT_TESTING_RECORD=never xcodebuild test \
  -project ios/App/OpenAgents.xcodeproj \
  -scheme OpenAgents \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0' \
  -resultBundlePath TestResults \
  -skipMacroValidation -skipPackagePluginValidation \
  -enableCodeCoverage YES
# 4. Contract drift: committed Swift client matches apps/web/openapi.json
ios/Scripts/check-openapi-drift.sh   # defined in 02-api-contract-and-networking.md
# 5. Coverage report (advisory until enforcement milestone; see section 10)
xcrun xccov view --report --json TestResults.xcresult > coverage.json
ios/Scripts/check-coverage.sh coverage.json
# 6. Hygiene
git diff --check
grep -rn "sleep(" ios/App/UITests/ && { echo "sleep() banned in UI tests"; exit 1; } || true
```

This script is the answer to "run the repo-level check" for every iOS issue.
`docs/process/formatting-gate.md` semantics apply: a red formatter/linter is a
failing verification — fix and re-run, or document an explicitly user-approved
deferral.

---

## 12. Flake policy

Definitions and actions:

| Event | Required action |
|-------|-----------------|
| A test fails on CI, passes on re-run with no code change | It is a flake. File a `bug-regression` issue the same day, titled `fix: flaky test <Target>/<Suite>/<test>`, labeled `type:bug` + `type:regression`, with the `.xcresult` artifact link as evidence |
| Quarantine | In the same day, land a one-line PR adding `.disabled("flaky — see #<issue>")` to the test (Swift Testing trait) so the suite stays trustworthy. A quarantined test is a red suite member — it does not count as coverage |
| Quarantine budget | Maximum 10 working days disabled. After that the test is either fixed (regression workflow, section 13) or deleted with a written rationale in the issue — silent permanent quarantine is forbidden |
| Detection | Nightly job runs the simulator suite + UI smoke with `-test-iterations 3 -retry-tests-on-failure`; any test that needed a retry is reported as flaky even though the job stayed green |
| PR gate | **No retries ever** on the PR-blocking jobs. Retries hide real races |

Known flake sources to design out up front: shared simulator state (always
in-memory GRDB + fresh launch per UI test), fixed ports (always port 0),
wall-clock time (always injected clocks), Swift Testing parallelism over shared
singletons (`.serialized` or per-test instances).

---

## 13. Regression discipline for iOS bugs

`docs/process/regression-discipline.md` maps as follows. A bug fix is complete
only when the regression test (1) fails without the fix, (2) passes with it,
(3) lives in the smallest suite owning the behavior, (4) feeds a
behavior/integration proof when it crosses a protected path, (5) has a
red/green audit trail on the work branch.

### 13.1 Naming and placement

- File: `Regressions/<Area>RegressionTests.swift` inside the owning package's
  existing test target (placement rule from section 4.4 — e.g. a stream
  truncation bug lands in
  `ios/Packages/OpenAgentsCore/Tests/OpenAgentsCoreTests/Regressions/StreamReducerRegressionTests.swift`).
- Test declaration carries the issue reference via the `.bug` trait and the
  issue number in the display name:

```swift
@Test("#345: reducer drops final text chunk when [DONE] arrives in same packet",
      .tags(.regression),
      .bug("https://github.com/dennisonbertram/fork-open-agents/issues/345"))
func finalChunkBeforeDoneIsKept() async throws { /* ... */ }
```

- Commit naming follows the observed repo convention:
  `test(red): TASK-345 failing regression for <bug>` →
  `fix(ios): <bug> (#345)` → optionally
  `test(regression): TASK-345 regression coverage for <bug>` when extra
  hardening tests land after the fix.

### 13.2 Live bugs become deterministic

A bug observed on a device, in TestFlight, or against the production API must
be reduced to a deterministic local test before the fix merges:

1. If the trigger is server data or a stream shape: **record a fixture** that
   reproduces it (section 5.5), sanitize it, add it to `ios/Fixtures/`, and
   write the regression test as a fixture-replay test.
2. If the trigger is UI state: reproduce as a snapshot or view-model unit test
   with the fixture state.
3. If the trigger is timing/lifecycle (backgrounding, token rotation race):
   reproduce with the injected clock / `StubURLProtocol` delay controls.
4. The original live observation (screenshot, `log show` output per
   `07-observability.md`) goes in the issue as evidence; it is a canary, never
   the only protection.

### 13.3 Mandatory-regression triggers (iOS instantiation)

Regressions are mandatory for: any user-visible bug; Keychain/token handling
bugs; stream resume/duplicate/loss bugs; GRDB cache migration or
data-compatibility bugs; background-refresh/retry bugs; auth/ownership boundary
bugs (e.g. seeing another user's session shape); and any code-review finding
that identifies a real failure mode. Bugs that teach a durable lesson also
update `docs/agents/lessons-learned.md` in the same PR.

---

## 14. Device / OS matrix

iOS 26.0 is the minimum deployment target, so exactly one major OS line is in
support — the matrix is deliberately small and pinned.

| Lane | Device | OS | What runs |
|------|--------|----|-----------|
| PR gate (blocking) | iPhone 17 Pro simulator (pinned name; verify against the `macos-26` runner image readme and `xcrun simctl list devices available` before first wiring, per `08-ci-cd-release.md`) | iOS 26.0 simulator runtime, pinned in the `-destination` string | Full unit + contract + snapshot suite |
| Nightly (non-blocking) | iPhone 17 Pro sim + iPad Pro 13-inch (M4) sim | iOS 26.0 pinned | Full suite + XCUITest smoke + flake detector iterations |
| Release lane (blocking) | iPhone 17 Pro sim | iOS 26.0 pinned | Full suite + XCUITest smoke, then archive/TestFlight (`08-ci-cd-release.md`) |
| Manual pre-TestFlight-external | One physical iPhone on the latest iOS 26.x | latest 26.x | Manual smoke checklist: real OAuth sign-in (P1), live chat stream against the dev deployment, Liquid Glass visual pass (section 6.4 caveat) |

Snapshot layout containers (`.iPhone13Pro`, `.iPadPro11`) are independent of
this matrix (section 6.3) and never change when simulator devices are bumped.
When Apple ships iOS 27, bumping the pinned runtime is one dedicated PR
(snapshot re-record, section 6.5) plus a matrix-table update here.

---

## 15. Per-issue testing checklist (paste into every iOS issue)

```markdown
- [ ] Protected path named (P-id from docs/plans/ios-app/06-testing-strategy.md §2)
- [ ] Smallest failing Swift Testing test written; red command + reason recorded
- [ ] Red output pasted into TDD audit trail; `test(red): TASK-<n> ...` commit pushed
- [ ] Fixture added/updated if the slice touches stream or API shapes (sanitize checklist run)
- [ ] Snapshot variants added for new/changed screens (canonical; dark+ax3 where required)
- [ ] Smallest green change; targeted test green; `feat|fix(ios): ... (#<n>)` commit
- [ ] Adjacent package suite green (`swift test --package-path ios/Packages/<Pkg>`)
- [ ] iOS gate green (`ios/Scripts/ci-gate.sh`) and `git diff --check` clean
- [ ] `bun --bun run ci` green if anything under apps/web/ changed
- [ ] Server slice only: colocated route.test.ts + contract test + openapi:check green
- [ ] Regression test added for any bug (fails-without/passes-with verified)
- [ ] PR into develop with Test Evidence section fully filled
```

---

## 16. Open items owned by sibling documents

- Exact CI workflow YAML, runner pins, Xcode/simulator pin verification steps,
  and required-status-check naming: `08-ci-cd-release.md`.
- The OpenAPI drift-check script contents and the generated-client layout:
  `02-api-contract-and-networking.md`.
- The full SSE chunk-type inventory the fixtures must cover:
  `05-streaming-chat-engine.md`.
- Package names/layout (authoritative): `03-architecture.md`.
- OSLog subsystems and the `log show` debug recipes referenced by the
  regression-evidence rules: `07-observability.md`.
- Milestone at which coverage floors and the PR-blocking UI smoke activate:
  `09-step-by-step-build-guide.md`.
