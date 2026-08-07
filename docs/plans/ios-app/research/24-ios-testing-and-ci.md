# Research Brief 24: Testing + CI/CD for a Serious SwiftUI App (2026)

External research brief for the open-agents native iOS app plan. Researched June 2026 via web-grounded search. This brief covers: Swift Testing vs XCTest, snapshot testing, XCUITest strategy, HTTP+SSE client testing, GitHub Actions for iOS, TestFlight delivery, and code signing in CI. Confidence levels are marked where sources were thin.

---

## 0. Version-naming correction that affects the whole plan

The task prompt referenced "Xcode 17.x" — **Xcode 17 does not exist**. At WWDC 2025 Apple jumped version numbers to year-based naming: after **Xcode 16.4** came **Xcode 26**, aligned with **iOS 26 / iPadOS 26 / macOS 26 (Tahoe)** ([Create with Swift WWDC25 roundup](https://www.createwithswift.com/wwdc-2025-whats-new-for-the-apple-community/), [Povio WWDC25 dev summary](https://povio.com/blog/wwdc-2025-updates-for-apple-developers), Swift forums ["What's New in Testing — Swift 6.2 / Xcode 26"](https://forums.swift.org/t/whats-new-in-testing-swift-6-2-xcode-26/80688)). As of June 2026 the current toolchain is **Xcode 26.x with Swift 6.2 and the iOS 26 SDK**; iOS 26 also introduced the "Liquid Glass" visual redesign, which matters for snapshot testing (section 2.4). *Confidence: high on the 16.4 → 26 jump and Swift 6.2 pairing (multiple corroborating sources + GitHub changelog naming `macos-26` runners); the precise latest 26.x point release in June 2026 is unverified — pin whatever the chosen runner image documents.*

Plan implication: write "Xcode 26.x" everywhere the plan would have said "Xcode 17"; minimum deployment target decisions should be framed against iOS 18 (released 2024 — actually iOS 18 shipped with Xcode 16) vs iOS 26.

---

## 1. Swift Testing vs XCTest

### Recommendation
**Default to Swift Testing for all unit/integration tests; keep XCTest only where it is mandatory (XCUITest UI automation, performance/XCTMetric tests).** This is Apple's explicit positioning and the consensus practice in 2026.

### Ground truth
- Swift Testing ships **in the toolchain** with Xcode 16+ / Swift 6+; no package dependency needed ([developer.apple.com/xcode/swift-testing](https://developer.apple.com/xcode/swift-testing/), [Swift Package Index entry](https://swiftpackageindex.com/swiftlang/swift-testing)).
- **XCTest is not deprecated.** Apple supports side-by-side use in the same target — even the same file — for incremental migration ([Use Your Loaf migration guide](https://useyourloaf.com/blog/migrating-xctest-to-swift-testing/), [Apple Xcode page](https://developer.apple.com/xcode/)). Do not mix frameworks *within one test* (no `XCTAssert` inside `@Test`, no `#expect` inside `XCTestCase`).
- **XCTest is still required for:**
  - **UI automation** — `XCUIApplication`/`XCUIElement`/XCUIAutomation have no Swift Testing equivalent ([Apple Xcode page](https://developer.apple.com/xcode/)).
  - **Performance tests** — `measure(metrics:)`/`XCTMetric` are XCTest-only ([Use Your Loaf](https://useyourloaf.com/blog/migrating-xctest-to-swift-testing/)).
- **Parallelism:** Swift Testing runs test functions **in parallel by default, in-process, via Swift concurrency** (works even on physical devices). XCTest parallelism is opt-in and multi-process/multi-simulator ([WWDC24 "Go further with Swift Testing"](https://developer.apple.com/videos/play/wwdc2024/10195/), [Swift forums on serial/parallel](https://forums.swift.org/t/running-tests-serially-or-in-parallel/72935)). Consequence: any test touching shared mutable state (singletons, UserDefaults, Keychain, a shared mock server port) needs `.serialized` or proper isolation.
- **Traits** (apply recursively to nested suites): `.serialized`, `.timeLimit(...)` (CI hang protection), `.enabled(if:)`/`.disabled(...)` (conditional skip, e.g. skip-on-CI), `.bug(...)`, and custom **tags** for cross-suite grouping/filtering (e.g. `.tags(.smoke)`) ([WWDC24 session](https://developer.apple.com/videos/play/wwdc2024/10195/), [viesure overview](https://viesure.io/modern-swift-unit-testing/developer/)).
- **Parameterized tests** (`@Test(arguments:)`) auto-expand into one test case per argument — a major win for testing API decoders/SSE event parsing against many fixtures ([WWDC24](https://developer.apple.com/videos/play/wwdc2024/10195/)).
- **Swift 6.2 / Xcode 26 additions:**
  - **Attachments**: attach strings, Data, Codable values, files, and (on Apple platforms) **images/screenshots** to test results; they surface in `.xcresult` and on-disk for CLI runs ([swift-evolution testing/0014 image attachments](https://github.com/swiftlang/swift-evolution/blob/main/proposals/testing/0014-image-attachments-in-swift-testing-apple-platforms.md), [dev.to Xcode 26 attachments writeup](https://dev.to/arshtechpro/xcode-26-swift-testing-attachments-2lcf)).
  - **Exit tests** (`#expect(processExitsWith:)`) for testing crash/fatalError paths — *confidence: medium; this is in the Swift 6.2 testing release thread ([forums.swift.org](https://forums.swift.org/t/whats-new-in-testing-swift-6-2-xcode-26/80688)) but one verification pass could not independently confirm the exact API name. Note exit tests run on macOS/Linux hosts, not iOS simulators — treat as nice-to-have, not load-bearing.*
  - An interoperability pitch ("Targeted Interoperability between Swift Testing and XCTest") is in flight ([forums.swift.org](https://forums.swift.org/t/pitch-targeted-interoperability-between-swift-testing-and-xctest/82505)) — direction of travel is more bridging, not XCTest removal.
- **WWDC 2025** shipped a session on UI automation with richer per-test artifacts (screenshots/video, improved recording) — [WWDC25 session 344](https://developer.apple.com/videos/play/wwdc2025/344/). UI automation itself remains XCTest/XCUIAutomation-based.

### Practical layout for this app
- `AppTests` target: Swift Testing only (`import Testing`), parallel by default; tag taxonomy like `.smoke`, `.network`, `.snapshot`.
- `AppUITests` target: XCTest/XCUITest (small; see section 3).
- Use `.serialized` on suites that hit a shared local mock server or Keychain; use `.timeLimit` on SSE/streaming tests so a hung stream fails fast instead of stalling CI.

---

## 2. Snapshot testing (pointfreeco/swift-snapshot-testing)

### State of the library
- **De-facto standard; actively maintained; current stable line ~1.18.x** (1.18.7–1.18.9 cited) ([GitHub repo](https://github.com/pointfreeco/swift-snapshot-testing), [Swift Package Index](https://swiftpackageindex.com/pointfreeco/swift-snapshot-testing)).
- **Swift Testing support since 1.17.0**: the old global `isRecording`/`diffTool` are deprecated; configuration is now the **`.record` value with four modes** — `.all`, `.missing`, `.never` (use in CI), `.failed` — applied via a Swift Testing **trait per test/suite** or scoped with **`withSnapshotTesting(record:diffTool:)`** ([Point-Free announcement](https://www.pointfree.co/blog/posts/146-swift-testing-support-for-snapshottesting)).
- SwiftUI views snapshot via `UIHostingController` under the hood: `assertSnapshot(of: view, as: .image(layout: .device(config: .iPhone13)))`; `precision`/`perceptualPrecision` parameters tolerate sub-pixel drift.

### CI pitfalls (the part that bites everyone)
1. **Snapshots are environment-specific artifacts.** They differ across simulator device model, OS version, and CPU architecture (font rasterization/anti-aliasing). **Pin one canonical device + OS for recording AND CI** and encode it in the `xcodebuild -destination` string ([classmethod SwiftUI snapshot guide](https://dev.classmethod.jp/en/articles/swift-snapshot-testing/)).
2. **Pin the simulator runtime explicitly in CI.** GitHub images carry only up to ~3 simulator runtimes per image and rotate them ([GitHub changelog, July 2025 Xcode support policy](https://github.blog/changelog/2025-07-11-upcoming-changes-to-macos-hosted-runners-macos-latest-migration-and-xcode-support-policy-updates/)); a runtime can be installed with `xcodebuild -downloadPlatform iOS -buildVersion <ver>` if missing ([fastlane issue showing the pattern](https://github.com/fastlane/fastlane/issues/29481)). A runner-image bump silently changing the default runtime is the #1 cause of mass snapshot failure.
3. **Architecture:** GitHub standard macOS runners are Apple Silicon (arm64) since macos-14; if all devs are on Apple Silicon too, arch drift is mostly gone. Do not mix Intel (`macos-26-intel`, `*-large`) and arm64 baselines.
4. **iOS 26 Liquid Glass caveat:** GPU-level Liquid Glass effects are **not fully rendered in `UIHostingController` image snapshots**, so snapshots verify layout/structure, not final visual chrome ([classmethod guide](https://dev.classmethod.jp/en/articles/swift-snapshot-testing/)). Don't promise pixel-faithful design QA from snapshots on iOS 26.
5. **Determinism hygiene:** inject fixed dates/locale/dynamic-type, mock async images, disable animations; test sheet *content* as its own view (modals aren't captured).
6. **Commit `__Snapshots__` to git** (CI fails on every test otherwise). On CI systems where source paths differ (e.g. Xcode Cloud), snapshots must be bundled as test resources — not an issue on GitHub Actions where the checkout layout matches local.
7. **Recording policy:** CI runs with `.record(.never)` so retries can't silently rewrite baselines; local re-record via an env-gated `.all`/`.missing` ([Point-Free blog](https://www.pointfree.co/blog/posts/146-swift-testing-support-for-snapshottesting)).

### Verdict for v1
Use swift-snapshot-testing for key screens (chat transcript states, diff viewer, session list, settings) on **one pinned device/OS** (e.g. latest iPhone Pro sim on a pinned iOS 26.x runtime). Budget for re-recording when the pinned runtime is deliberately bumped (once or twice a year).

---

## 3. UI testing (XCUITest) — how much for v1

### Consensus strategy
**Thin smoke suite for v1 (roughly 5–15 tests), heavy investment in unit + snapshot + view-model tests instead.** XCUITest is slow (simulator boot + app launch + real interaction; minutes per flow; 30+ minute suites are common unoptimized), flaky, and expensive on 10x-priced macOS minutes; full suites pay off only after the UI stabilizes ([Bitrise XCUITest guide](https://bitrise.io/guides/xcuitest), [pragmatic SwiftUI testing](https://betterprogramming.pub/swiftui-testing-a-pragmatic-approach-aeb832107fe7), [maestro.dev XCTest best practices](https://maestro.dev/insights/xctest-best-practices-ios-testing)).

For this app a sensible v1 smoke set: launch + auth-stubbed sign-in, open a session and see streamed messages render (against a local mock server), send a message, open the diff view, open settings. Everything else lives below the UI layer.

### Discipline that must be designed in from day one
- **`accessibilityIdentifier` on every element a test touches**, defined in a shared enum visible to app + UI-test targets (e.g. `A11yID.Chat.composerField`), named by screen+role, never by display text/index ([Bitrise guide](https://bitrise.io/guides/xcuitest), [identifier patterns](https://ayaakl.wordpress.com/2020/04/19/making-your-ios-app-accessible-for-ui-tests-ayas-cookbook-about-ios-accessibility-identifiers/)). Bonus: this doubles as real accessibility groundwork.
- **Page/Screen Object pattern**: one object per screen encapsulating queries + waits; tests read as behavior ([swiftwithmajid page objects](https://swiftwithmajid.com/2021/03/24/ui-testing-using-page-object-pattern-in-swift/), [REI engineering](https://engineering.rei.com/mobile/xcuitest-page-object-models.html)).
- **Flakiness mitigation**: `waitForExistence(timeout:)`/predicate expectations, never `sleep`; launch arguments (`--uitesting`) that disable animations (`UIView.setAnimationsEnabled(false)`), seed deterministic state, point networking at a local mock, reset persistence per launch ([trinhngocthuyen on flaky UI tests](https://trinhngocthuyen.com/posts/tech/dealing-with-flaky-ui-tests/), [kobiton techniques](https://kobiton.com/mobile-testing-guide/mobile-test-automation/advanced-xcuitest-techniques-network-mocking-screenshot-testing-animations/)).
- **Artifacts**: keep `.xcresult` (screenshots + video per test as of Xcode 26 tooling, [WWDC25 session 344](https://developer.apple.com/videos/play/wwdc2025/344/)) uploaded `if: always()`.
- **Test plan repetitions / retry-on-failure** are available; use retries as a flake *detector* (nightly), not a permanent crutch.
- `xcodebuild build-for-testing` + `test-without-building` is mature and the standard way to build once and fan out shards; native parallel-destination testing is also mature ([Bitrise guide](https://bitrise.io/guides/xcuitest)). For a v1-sized smoke suite, sharding is unnecessary — one simulator destination is fine.

---

## 4. Contract/integration testing the HTTP + SSE client

The open-agents backend speaks JSON REST + SSE streams (chat/agent output), so the iOS client's streaming layer is the highest-risk networking code. Three-tier strategy:

### Tier 1 — Unit: `URLProtocol` stubbing (recommended default)
- Inject a `URLSession` whose `URLSessionConfiguration.protocolClasses = [StubProtocol.self]` (use `.ephemeral`, never `URLSession.shared` in the client).
- **Streaming works through `URLProtocol`**: after `client?.urlProtocol(self, didReceive: response, ...)` (with `Content-Type: text/event-stream`), call **`client?.urlProtocol(self, didLoad: chunkData)` multiple times** with optional inter-chunk delays, then `urlProtocolDidFinishLoading`. `URLSession.bytes(for:)` / `AsyncBytes.lines` surfaces these incrementally, so SSE parsing, partial-event buffering, cancellation, and reconnect/backoff logic are all unit-testable in-process and deterministically. No chunked-transfer framing needed — `URLProtocol` emits raw body bytes post-headers. (Pattern corroborated by Perplexity-aggregated practice; see also reference SSE clients [launchdarkly/swift-eventsource](https://github.com/launchdarkly/swift-eventsource) and [mattt/EventSource](https://github.com/mattt/EventSource) whose test suites use similar techniques.)
- *Caveat to spike early (confidence: medium): verify on the target OS that URLSession does not coalesce small `didLoad` chunks before delivery to `AsyncBytes` — write one proof test asserting two events arrive as two separate parser emissions with a delay between them.*

### Tier 2 — Integration: tiny real HTTP server in-test
- **FlyingFox** ([github.com/swhitty/FlyingFox](https://github.com/swhitty/FlyingFox)) — the lightest, async/await-native, test-focused embedded HTTP server; trivially started on port 0 in `setUp`/suite init, supports streamed response bodies for SSE. Best fit for a client-only team.
- **Hummingbird 2.x** ([github.com/hummingbird-project/hummingbird](https://github.com/hummingbird-project/hummingbird), [Hummingbird 2 announcement](https://forums.swift.org/t/hummingbird-2/74535)) — SwiftNIO-based, structured-concurrency rewrite, small core, very well maintained; more ceremony than FlyingFox but more robust. Pick this if the mock needs realistic routing/middleware.
- **Vapor** is overkill for a mock; **Swifter/Embassy** are legacy (pre-concurrency, sporadic maintenance); **raw swift-nio** is unnecessary hand-rolling.
- Recommendation: **FlyingFox** for in-test SSE/REST mock; mark those suites `.serialized` or use per-suite random ports to coexist with Swift Testing parallelism.

### Tier 3 — Fixtures: replay recorded SSE streams
- Store raw SSE wire bodies as text fixtures (`Tests/.../Fixtures/*.sse.txt`), recorded from the real open-agents API (the repo's own SSE endpoints can generate these). Split on blank-line event boundaries (`\n\n`) into chunks and replay through either the `URLProtocol` stub or the FlyingFox handler with ~10ms inter-chunk delays.
- Build fixtures for edge cases: comment/keep-alive lines, multi-line `data:`, malformed events, mid-event disconnect, server-close vs client-cancel. Parameterized Swift Testing (`@Test(arguments:)`) pairs perfectly with a fixture directory.
- This is the de-facto pattern; there is no dominant off-the-shelf "SSE VCR" package for Swift — plan to write the (small) replay helper in-house.

---

## 5. GitHub Actions for iOS

### Runners (June 2026)
- Labels: `macos-14`, `macos-15` (both arm64), **`macos-26`** (arm64, GA Feb 26 2026, [GitHub changelog](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/)), **`macos-26-intel`** (x64). **`macos-latest` → macOS 15** since Aug–Sep 2025 ([changelog](https://github.blog/changelog/2025-07-11-upcoming-changes-to-macos-hosted-runners-macos-latest-migration-and-xcode-support-policy-updates/)); macOS 13 retired Dec 2025. Larger runners: `macos-1x-large` (Intel), `macos-1x-xlarge` / `macos-26-xlarge` (M-series) ([larger runners docs](https://docs.github.com/en/actions/reference/runners/larger-runners)).
- **Xcode preinstall**: each image's authoritative list is its `runner-images` readme (e.g. `macos-26-Readme.md` → "Xcode" table; [community pointer](https://github.com/orgs/community/discussions/28272)). Policy: all "bare-bones" Xcode versions kept, but **max ~3 simulator runtimes per image** ([changelog](https://github.blog/changelog/2025-07-11-upcoming-changes-to-macos-hosted-runners-macos-latest-migration-and-xcode-support-policy-updates/)). Expect macos-26 to carry Xcode 26.x line and macos-15 to carry Xcode 16.x (+ possibly early 26.x); *exact versions unverified — check the readme when pinning, and assert with `xcodebuild -version` in the workflow.*
- **Building with the iOS 26 SDK requires Xcode 26, which requires macOS 15+ runner images in practice — use `macos-26` (or `macos-15` if it carries the needed Xcode 26.x) for the PR gate.**

### Cost
- **Public repos: standard hosted runners are free** ([changelog Jan 1 2026](https://github.blog/changelog/2026-01-01-reduced-pricing-for-github-hosted-runners-usage/)). For private repos, prices were **reduced Jan 1 2026**: Linux $0.006/min, Windows $0.010/min, **macOS standard $0.062/min** (previously $0.008/$0.016/$0.08 — i.e. macOS is still ~10x Linux) ([changelog](https://github.blog/changelog/2026-01-01-reduced-pricing-for-github-hosted-runners-usage/), [SamExpert pricing analysis](https://samexpert.com/github-actions-pricing-backlash-2026/)). **macOS xlarge (M2 Pro): $0.16/min** ([changelog](https://github.blog/changelog/2025-07-16-github-actions-now-offers-m2-pro-powered-hosted-runners-in-public-preview/)); larger runners are always billed, even on public repos. The announced $0.002/min self-hosted fee was walked back ([SamExpert](https://samexpert.com/github-actions-pricing-backlash-2026/)). Practical math: a 15-min PR gate on standard macOS ≈ $0.93/run private, $0 public.

### Workflow shape (canonical PR gate)
```yaml
jobs:
  test:
    runs-on: macos-26
    steps:
      - uses: actions/checkout@v4
      - uses: maxim-lobanov/setup-xcode@v1        # pin Xcode
        with: { xcode-version: '26.0' }            # or sudo xcode-select -s /Applications/Xcode_26.x.app
      - uses: actions/cache@v4                     # SPM cache
        with:
          path: |
            ~/Library/Developer/Xcode/DerivedData/**/SourcePackages
          key: ${{ runner.os }}-spm-${{ hashFiles('**/Package.resolved') }}
          restore-keys: ${{ runner.os }}-spm-
      - name: Test
        run: |
          set -o pipefail
          xcodebuild test \
            -scheme OpenAgents \
            -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0' \
            -resultBundlePath TestResults \
            -skipMacroValidation -skipPackagePluginValidation \
            -enableCodeCoverage YES
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: TestResults.xcresult, path: TestResults.xcresult, retention-days: 7 }
```
Notes: pin the **destination OS version explicitly** (snapshot stability, section 2); `-skipMacroValidation` is needed once any dependency ships Swift macros (practitioner knowledge, *confidence: high*); cache `SourcePackages` rather than all of DerivedData (smaller, no stale build products); `if: always()` so failing runs still ship the `.xcresult` ([xcodebuild-on-Actions walkthroughs](https://vmois.dev/xcode-github-actions/), [setup-xcode](https://github.com/marketplace/actions/xcode-select-version)). The exact simulator device name available on the image ("iPhone 17 Pro" et al.) must be read from the runner image readme — *unverified placeholder*.
- Xcode selection: `maxim-lobanov/setup-xcode` (most common) or raw `xcode-select`; the `xcodes` CLI is for self-hosted machines, not needed on hosted runners.
- **Typical PR-gate wall time, midsize SwiftUI app**: ~10–25 min cold, **8–15 min with SPM caching and no UI tests**; larger runners cut 30–50% (community-derived, no official benchmark; [Bitrise data point: 30 min UI suite → 8–10 min with 4-way parallelism](https://bitrise.io/guides/xcuitest)). Keep UI smoke tests in a separate non-blocking or nightly job initially.

### fastlane vs raw xcodebuild
- **fastlane is alive and actively maintained in 2026** and still the most common wrapper ([fastlane repo/discussions](https://github.com/fastlane/fastlane/discussions/21347)). But for **one app on GitHub Actions**, the leaner 2026 stack is **raw `xcodebuild` + Apple's official actions** (`apple-actions/*`), avoiding the Ruby/bundler dependency entirely. Adopt fastlane later only if lane complexity (screenshots, metadata, multiple targets) demands it.

---

## 6. TestFlight delivery from CI (the 2026-correct answer)

### What is dead vs alive
- **`xcrun altool` is dead for notarization** (service stopped accepting it Nov 1 2023, [Apple TN3147](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)) and is **legacy/do-not-use for App Store uploads** in new pipelines (Apple no longer documents it for new workflows; community consensus, [fastlane discussion](https://github.com/fastlane/fastlane/discussions/21347)).
- **`xcrun notarytool` is NOT the upload successor** — it is macOS notarization only ([TN3147](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)). **`xcrun iTMSTransporter`** still exists but is legacy plumbing; don't build on it.
- **The successor is the App Store Connect API (key-based: .p8 + Key ID + Issuer ID)**, consumed via one of three supported paths below.

### Three supported upload paths (pick one)
1. **Apple-native CLI (recommended, zero extra deps):** `xcodebuild archive` → `xcodebuild -exportArchive -exportOptionsPlist` with **`method: app-store-connect`** (the renamed successor of `app-store`) and **`destination: upload`** (xcodebuild uploads directly — no .ipa shuffling), authenticated with **`-allowProvisioningUpdates -authenticationKeyPath <key.p8> -authenticationKeyID <KEYID> -authenticationKeyIssuerID <ISSUER>`**. This is Apple's password-free CI model. *(Flow corroborated by [step-by-step GH Actions guide](https://dev.to/aleksandr_ilinskiy/how-to-deploy-your-ios-app-to-testflight-with-github-actions-step-by-step-4l1d); the `app-store-connect`/`destination: upload` plist keys are from `xcodebuild -help` as of Xcode 15.4+ — confidence: high.)*
2. **Apple's official GitHub Action:** export an .ipa (`destination: export`) then [`apple-actions/upload-testflight-build@v1`](https://github.com/Apple-Actions/upload-testflight-build/blob/main/action.yml) with `app-path`, `issuer-id`, `api-key-id`, `api-private-key` secrets ([Apple-Actions org](https://github.com/Apple-Actions), [marketplace](https://github.com/marketplace/actions/upload-app-to-testflight)). Apple's own org also ships `apple-actions/import-codesign-certs` for keychain setup.
3. **fastlane:** `app_store_connect_api_key(...)` + `pilot` / `upload_to_testflight` — still fully supported and API-key based; the right choice if fastlane is already in the stack.

### Secrets needed in GitHub
`APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, the `.p8` private key content; key created in App Store Connect → Users and Access → Integrations, role **App Manager** (minimum for build upload/management) ([appcircle ASC key docs](https://docs.appcircle.io/account/my-organization/security/credentials/adding-an-app-store-connect-api-key)).

---

## 7. Code signing in CI

### Options ranked for a small team shipping one app
1. **Apple/GitHub-documented manual import (recommended for v1):** base64-encode the **Apple Distribution** `.p12` + `.mobileprovision` into GitHub secrets; workflow creates a **temporary keychain**, imports both, builds with manual signing. This is GitHub's officially documented pattern and the lowest-tooling option ([Andrew Hoog walkthrough of the GitHub-docs flow](https://www.andrewhoog.com/posts/how-to-build-an-ios-app-with-github-actions-2023/); canonical doc: GitHub "Installing an Apple certificate on macOS runners for Xcode development"). Cost: someone owns the annual cert renewal (Apple Distribution certs last 1 year) and profile updates on capability changes. `apple-actions/import-codesign-certs` packages the keychain steps.
2. **fastlane match (readonly in CI):** encrypted git/S3 repo as single source of truth for certs+profiles ([fastlane.tools/match](https://fastlane.tools/match/), [Bitrise match guide](https://bitrise.io/blog/post/use-case-fastlane-and-fastlane-match)). Best once fastlane is in the stack or when >1 app / >2 devs; otherwise extra moving parts.
3. **Cloud signing (`xcodebuild -allowProvisioningUpdates` + ASC API key):** xcodebuild creates/fetches the cloud-managed Apple Distribution cert and profiles at export time. **Gotcha:** the *archive* step still needs a signing identity present on the ephemeral runner, so cloud signing usually rides on top of option 1/2 rather than replacing it; failures are opaque ([fastlane cloud-signing discussion](https://github.com/fastlane/fastlane/discussions/19973)). Good hybrid: manual keychain for archive, `-allowProvisioningUpdates` + API key for export/upload so profiles never need manual refresh.
4. **Xcode Cloud** handles signing fully automatically but means leaving GitHub Actions for the build lane; not recommended given this repo's GitHub-centric CI culture.

**Recommendation:** start with (1) + the API-key-authenticated export/upload from section 6 path 1; revisit match only when team/app count grows.

---

## 8. Recommended CI shape for the open-agents iOS app (synthesis)

- **PR gate (blocking, target <15 min):** `macos-26` standard runner; pinned Xcode 26.x + pinned iOS 26.x simulator; Swift Testing unit/integration suite (URLProtocol SSE tests, FlyingFox integration tests, snapshot tests `.record(.never)`); `xcodebuild test -resultBundlePath`; SPM cache keyed on `Package.resolved`; upload `.xcresult` always.
- **Nightly / pre-release (non-blocking):** XCUITest smoke suite against local mock server; test-plan repetitions to surface flakes.
- **Release lane (tag- or manually-triggered):** temp-keychain signing → `xcodebuild archive` → `-exportArchive` `method: app-store-connect`, `destination: upload` with ASC API key (or `apple-actions/upload-testflight-build`).
- Mirror the repo's existing discipline: failing-test-first (the repo's Behavior-First TDD process), `.xcresult` as the observability artifact, and a regression-fixture directory for recorded SSE streams sourced from the real backend.

---

## Open questions / unverified items

1. Exact Xcode 26.x point versions and simulator device names preinstalled on the `macos-26` image at plan-execution time — must be read from `runner-images` `macos-26-Readme.md` and pinned then.
2. Whether `#expect(processExitsWith:)` (exit tests) shipped exactly under that name in Swift 6.2 — medium confidence; irrelevant to iOS-simulator suites either way.
3. URLProtocol chunk-delivery granularity to `URLSession.AsyncBytes` on iOS 26 (possible internal coalescing of tiny chunks) — needs a 1-hour spike test before committing the SSE unit-test architecture.
4. Whether the open-agents backend's SSE framing (header names, event types, heartbeat cadence) is stable enough to freeze as fixtures now — depends on the API-contract brief from the codebase-mapping agents.
5. Private vs public repo decision for the iOS app determines whether macOS minutes cost ~$0.93/PR-run or $0 — owner decision.
6. The minimum iOS deployment target (iOS 17/18 vs 26) affects which simulator runtimes CI must install beyond the image defaults (older runtimes need explicit `-downloadPlatform` installs and slow the job).
