# Research Brief: State-of-the-Art Native iOS App Architecture (June 2026)

**Scope:** External research for a new native Swift/SwiftUI iPhone+iPad app for open-agents (streaming AI-agent chat + developer-tool surfaces: diffs, sessions, repos, settings, background agents).
**Date:** 2026-06-09. **Author:** research subagent. Facts verified against primary sources where possible; uncertainty is flagged inline.

**One grounding fact from this repo:** the web backend streams chat via the Vercel AI SDK v5 **UI message stream over SSE** (`createUIMessageStream` / `UIMessageChunk` in `apps/web/app/api/chat/route.ts` and `apps/web/app/api/chat/[chatId]/stream/route.ts`). The iOS client will therefore consume a high-frequency SSE token stream — this drives several recommendations below (streaming state isolation, throttling, AsyncSequence-first networking).

---

## 0. Executive recommendations (TL;DR)

| Decision | Recommendation |
|---|---|
| Toolchain | Xcode 26.x, Swift 6.2+ (Swift 6 language mode). **Mandatory anyway:** since April 28, 2026, App Store uploads must be built with Xcode 26 / iOS 26 SDK. |
| Concurrency settings | Approachable Concurrency ON, Default Actor Isolation = `MainActor`, strict concurrency = complete. `@concurrent` only for explicit off-main work. |
| Min deployment target | **iOS 26.0** for v1 (see §2.4 rationale; conservative alternative is iOS 18.0 at meaningful extra cost). This is a judgment call the plan author must ratify. |
| UI framework | SwiftUI-only. `@Observable` (Observation framework) everywhere; no `ObservableObject` in new code. |
| Navigation | `TabView` root + per-tab `NavigationStack` driven by router models (`@Observable` + typed route enums); `NavigationSplitView` for iPad sidebar/detail. |
| Design system | Adopt Liquid Glass natively (free with iOS 26 SDK rebuild); use `glassEffect`/`GlassEffectContainer` sparingly for custom chrome; layered app icon via Icon Composer. Do **not** set `UIDesignRequiresCompatibility`. |
| Architecture | **MV/MVVM with `@Observable` models + environment DI, layered via packages** (not TCA). Discipline: feature "store" objects, unidirectional-ish flow, isolated hot streaming state. |
| Modularization | One local SPM **umbrella package** with many targets (Models, APIClient, DesignSystem, feature targets, AppFeature); app target is a thin shell. |
| Persistence (offline cache) | **GRDB 7.x** (SQLite). Not SwiftData. Plain files only for trivial prefs/snapshots. |
| Project file | **Checked-in minimal `.xcodeproj` using Xcode 16+ buildable folders (synchronized groups)**, nearly all code in the SPM package. XcodeGen as fallback if project-file churn becomes a problem. Not Tuist. |
| CI | GitHub Actions macOS runners + `xcodebuild` (fastlane optional for signing/TestFlight). Separate workflow from the Bun/Turbo web CI. |

---

## 1. Swift 6.x: what a new app should adopt

### 1.1 Current state (June 2026)

- Swift 6 language mode (data-race safety as compile errors) shipped 2024; **Swift 6.2 + Xcode 26** is the current mainstream toolchain. Apple's framing for new code is "start main-actor-first, enable strict checking" ([Adopting Swift 6](https://developer.apple.com/documentation/swift/adoptingswift6)).
- **Approachable Concurrency** (Swift 6.2 / Xcode 26) is the umbrella for a set of settings that make single-threaded-by-default code the norm ([Donny Wals](https://www.donnywals.com/what-is-approachable-concurrency-in-xcode-26/), [InfoQ](https://www.infoq.com/news/2025/08/swift62-approachable-concurrency/), [avanderlee](https://www.avanderlee.com/concurrency/approachable-concurrency-in-swift-6-2-a-clear-guide/)):
  - **Default Actor Isolation = MainActor** ([SE-0466](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md)): unannotated code in a module is implicitly `@MainActor`. This is the new-project default in Xcode 26 app templates.
  - **`nonisolated(nonsending)` by default** ([SE-0461](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md)): `nonisolated async` functions run on the *caller's* actor instead of hopping to the global executor; the **`@concurrent`** attribute explicitly opts a function back onto the concurrent thread pool.
  - **Isolated conformances inference** ([SE-0470](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0470-isolated-conformances.md)) and several usability flags (InferSendableFromCaptures, etc.).
- Net effect: a SwiftUI app can be written almost entirely as ordinary-looking code that is statically main-actor-isolated; you mark the rare CPU-heavy or I/O-parsing functions `@concurrent` (e.g., SSE chunk parsing, diff rendering, syntax highlighting).

### 1.2 What to adopt

1. **Swift 6 language mode + strict concurrency = complete** for every target, from day one. A greenfield app has no migration burden; retrofitting later is the expensive path.
2. **Approachable Concurrency ON, Default Actor Isolation = MainActor** for app/feature/UI targets. For pure infrastructure targets (`APIClient`, `PersistenceClient`), consider `nonisolated` default isolation per target — SPM lets you set `defaultIsolation(MainActor.self)` (or nil) per target via `swiftSettings` (Swift tools 6.2; see [Use Your Loaf](https://useyourloaf.com/blog/approachable-concurrency-in-swift-packages/)). Caveat: package defaults do **not** mirror Xcode target defaults automatically — set the flags explicitly in `Package.swift`.
3. **Actors:** use sparingly. A dedicated actor is right for genuinely shared mutable state off the main actor (e.g., a token-stream accumulator, an SQLite write coordinator — though GRDB provides its own). Most "managers" should just be `@MainActor @Observable` classes.
4. **Typed throws ([SE-0413](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0413-typed-throws.md), shipped Swift 6.0):** use at narrow API boundaries where the error set is a real contract (e.g., `APIClient` returning `throws(APIError)` so the UI can switch exhaustively on auth-expired vs network vs server error). Do **not** type-throw everywhere; ecosystem/generics edge cases still lag the proposal's ideal ([Donny Wals on typed-throws API design](https://www.donnywals.com/designing-apis-with-typed-throws-in-swift/), [open issues](https://github.com/swiftlang/swift/issues/75430)).
5. **AsyncSequence-first networking:** `URLSession.bytes(for:)` + a hand-rolled SSE line parser feeding an `AsyncThrowingStream<UIMessageChunk, Error>` is the canonical 2026 pattern for the AI SDK stream; it composes with task cancellation (user leaves the chat → `Task` cancelled → URLSession request torn down).

### 1.3 Pitfalls

- Mixing MainActor-default modules with nonisolated-default modules creates confusing diagnostics at the seams; document per-target isolation in the package manifest.
- Third-party SDKs that predate Swift 6 may need `@preconcurrency import`. Keep the dependency count low (this plan needs very few: GRDB, maybe swift-dependencies, maybe a Markdown renderer).

---

## 2. SwiftUI in the iOS 18/26 era

### 2.1 Observation: `@Observable`, not `ObservableObject`

- `@Observable` (Observation framework, iOS 17+) is the default for all new SwiftUI state: type-level macro, property-level dependency tracking (only views reading a changed property re-render), lower overhead than Combine-based `ObservableObject` ([WWDC23 Discover Observation](https://developer.apple.com/videos/play/wwdc2023/10149/)).
- Companion wrappers: `@State` for view-local, `@Bindable` for two-way bindings into an `@Observable`, `@Environment(MyModel.self)` for injection.
- **iOS 26 addition:** `Observations` AsyncSequence ([SE-0475](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0475-observed.md)) — `for await` over transactional snapshots of observable state from non-UI contexts (sync engines, analytics). Additive, not required for views; iOS 26+ only.
- `ObservableObject` is legacy-only (Combine interop). A new app should have zero.
- Known footgun: a parent view that reads a broad `@Observable` property (e.g., the whole `messages` array) re-renders whenever it changes; push reads down into row subviews ([Swift forums on re-render granularity](https://forums.swift.org/t/understanding-when-swiftui-re-renders-an-observable/77876)).

### 2.2 Navigation patterns (iPhone + iPad adaptive)

Consensus 2026 pattern:

- **Root:** `TabView` for top-level areas (e.g., Sessions, Repos, Background Agents, Settings). On iOS 26 the tab bar is floating Liquid Glass automatically; `tabBarMinimizeBehavior(.onScrollDown)` and `TabViewBottomAccessory` (mini-player-style persistent control — potentially great for a "running agent" status strip) are available. iPadOS 26's `TabView` automatically adapts between tab bar and sidebar representations.
- **Per-tab `NavigationStack`** with a typed route enum + `@Observable` router holding the path (`NavigationStack(path:)` + `navigationDestination(for:)`). This gives programmatic deep links (push notification → open session N), state restoration, and testable navigation.
- **iPad:** `NavigationSplitView` (sidebar = session list, detail = chat) where a 2-column layout is genuinely better; it collapses to a stack on compact widths automatically. A workable approach for this app: Sessions tab uses `NavigationSplitView` internally; everything shares the same route model so iPhone gets a stack and iPad gets sidebar/detail.
- **Search:** `searchable` on the stack/split view (bottom-aligned on iPhone in iOS 26) or `Tab(role: .search)`.

### 2.3 Liquid Glass (iOS 26 design system)

What adopting it means in practice ([Apple: Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), [Apple newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/), [createwithswift.com](https://www.createwithswift.com/exploring-a-new-visual-language-liquid-glass/)):

- **Free on rebuild:** building with the iOS 26 SDK automatically restyles all standard chrome — nav bars, toolbars, tab bars, sheets (now inset/concentric), alerts, popovers, sidebars, standard buttons. No code needed.
- **Custom surfaces:** `.glassEffect(_:in:)` (e.g., `.glassEffect(.regular.tint(.blue).interactive(), in: .rect(cornerRadius: 16))`), `GlassEffectContainer` to group/merge/morph multiple glass shapes (also a performance requirement when several glass views are near each other), `glassEffectID(_:in:)` + `@Namespace` for morph transitions, `buttonStyle(.glass)` / `.glassProminent`.
- **Toolbars:** items auto-group on glass; `ToolbarSpacer` separates logical groups; remove custom bar backgrounds/tints so content scrolls under the glass.
- **Design rules:** glass is for the floating control layer, not content; never stack glass on glass; the system honors Reduce Transparency/Motion automatically. For a chat app: message list = plain content; composer/input bar and agent-status accessory = glass.
- **App icon:** layered Icon Composer artwork (default/dark/clear/tinted variants); flat pre-rendered icons look wrong on iOS 26.
- **Opt-out (`UIDesignRequiresCompatibility = YES`)** exists but is explicitly temporary — Apple states it stops being honored in the release *after* iOS 26 (i.e., this year's WWDC cycle). A new app must not use it.
- **Forcing function (verified):** since **April 28, 2026**, all App Store Connect uploads must be built with Xcode 26 + the OS 26 SDKs ([Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)). So Liquid Glass adoption on iOS 26 devices is unavoidable; the only question is whether you also maintain a pre-26 appearance for older OSes.

### 2.4 Minimum deployment target (with market data)

Adoption data, June 2026:

- **Apple official (measured Feb 12, 2026):** iOS 26 on **66% of all iPhones**, **74% of iPhones introduced in the last 4 years** ([MacRumors summary of Apple's stats](https://www.macrumors.com/2026/02/13/apple-shares-ios-26-adoption-stats/), [Apple developer support](https://developer.apple.com/support/)). Adoption has grown since February.
- **TelemetryDeck (end of May 2026, opt-in app analytics — skews to indie/newer apps):** iOS 26 ≈ **83.8%**, iOS 18 ≈ **12.4%**, older ≈ **3.8%** ([TelemetryDeck major versions](https://telemetrydeck.com/survey/apple/iOS/majorSystemVersions/)).
- **StatCounter (May 2026, web traffic):** iOS 26.x ≈ 66% combined, iOS 18.x ≈ 17% combined ([StatCounter](https://gs.statcounter.com/ios-version-market-share/)).

Recommendation: **iOS 26.0 minimum** for this app's v1. Rationale:

1. The audience is developers running AI coding agents — heavily skewed to current-OS devices; TelemetryDeck-style populations (~84% on iOS 26 already) are the closer proxy than the all-iPhones number.
2. There is no existing user base to strand; by realistic ship date (Q4 2026), iOS 26 adoption among active devices will be ~90% and iOS 27 will be shipping.
3. The cost of iOS 18 support is real: every Liquid Glass API (`glassEffect`, `GlassEffectContainer`, `tabBarMinimizeBehavior`, `TabViewBottomAccessory`, `Tab(role:)`), SE-0475 `Observations`, and the iOS 26 `TabView` adaptivity needs `#available` forks plus a maintained pre-26 visual design — effectively two design systems for a v1.
4. General-audience guidance in 2026 is still "iOS 18 floor" ([plusqa 2026 stats guidance](https://www.plusqa.com/post/2026-ios-and-android-statistics)) — this brief deliberately departs from it for a developer-tool app. **If the plan author wants maximum reach instead, iOS 18.0 is the defensible conservative floor (~96% of devices); do not go lower than 18.**

*Uncertainty: the iOS-26-minimum call trades ~10-15% of potential devices today for substantial build simplicity; it should be ratified as an explicit product decision.*

*Note: WWDC 2026 is expected this month (June 2026); iOS 27 SDK announcements may shift specifics (e.g., the compatibility-flag sunset becomes concrete). Nothing in this brief depends on WWDC26 content, but the plan should anticipate an Xcode 27 bump within a year.*

---

## 3. Architecture choice: MV/MVVM + `@Observable` vs TCA

### 3.1 Landscape (2026)

- Apple prescribes no architecture; the community default has settled on **lightweight MVVM/"MV" with `@Observable` state objects + SwiftUI environment DI**, with Clean-ish layering (domain/data separated from presentation) for larger apps ([Swift forums: Apple-recommended architecture](https://forums.swift.org/t/what-is-the-architecture-officially-recommended-by-apple-for-swiftui-applications/44930), [2026 mobile architecture overview](https://softaims.com/blog/mobile-app-architecture-patterns-2026)).
- **TCA** is mature and actively maintained — **1.26.0 released 2026-06-09** (verified via GitHub releases, [pointfreeco/swift-composable-architecture](https://github.com/pointfreeco/swift-composable-architecture)); still 1.x, fully integrated with `@Observable` (`@ObservableState`), with the separate [swift-navigation](https://github.com/pointfreeco/swift-navigation), [swift-dependencies](https://github.com/pointfreeco/swift-dependencies), and [swift-sharing](https://github.com/pointfreeco/swift-sharing) libraries.

### 3.2 TCA tradeoffs for a streaming chat app

Pros: exhaustive reducer tests, explicit effect lifecycle/cancellation (nice for "user cancels a running agent stream"), strong composition.
Cons (the deciding ones here):

- **Action overhead on hot paths:** token streaming at 20-100 events/sec means either action spam through the store (each a full reducer pass + observation diff) or batching workarounds that reintroduce the local-mutable-buffer pattern TCA was supposed to replace.
- **Learning curve + ceremony:** State/Action/Reducer per feature; slower onboarding for contributors who know SwiftUI but not TCA.
- **Macro build-time cost:** TCA's macros measurably inflate clean/incremental builds in multi-feature apps.
- No community consensus that TCA is the right tool *specifically* for chat-stream UIs; teams report both success and "too heavy for append-only UI."

### 3.3 Recommendation

**Vanilla layered MV/MVVM on `@Observable`** with these disciplines (this captures most of TCA's value at a fraction of the cost):

1. **One `@Observable` "store" class per feature** (e.g., `SessionListStore`, `ChatStore`, `DiffStore`), `@MainActor` by default, exposing read-only state + intent methods (`send(_ message:)`, `cancelRun()`). Views never call clients directly.
2. **Protocol-based clients injected via SwiftUI Environment** (`@Environment(\.apiClient)`) or, if the team prefers, [swift-dependencies](https://github.com/pointfreeco/swift-dependencies) standalone (it works fine without TCA) for test overrides.
3. **Streaming state isolation (the critical pattern):**
   - Completed messages live in an array of value-type models with stable IDs; rows render via `ForEach` of narrow `MessageRow` subviews.
   - The in-flight assistant message is a *separate* `@Observable` object (`StreamingMessageModel`) with its own text buffer; only the active row observes it — token updates never invalidate the transcript list ([SwiftUI re-render mechanics](https://forums.swift.org/t/understanding-when-swiftui-re-renders-an-observable/77876)).
   - **Throttle/coalesce:** accumulate chunks off-main (`@concurrent` parser) and publish to the observable buffer every ~50-100 ms, not per token. This is universal advice regardless of architecture.
   - On stream completion, fold the buffer into the immutable transcript and reset.
4. **Typed route enums + router models** for navigation (testable, deep-linkable; see §2.2).
5. Keep domain logic (message reduction from `UIMessageChunk`s, diff models, session state machines) in **UI-free package targets** so it's unit-testable without SwiftUI.

Revisit TCA only if a subsystem develops genuinely gnarly state (e.g., the background-agents approval flows) — TCA can be adopted per-feature later; the reverse migration is the painful one.

---

## 4. Modularization: local SPM packages

### 4.1 Recommended layout

One **local umbrella package** (e.g., `ios/OpenAgentsKit/Package.swift`) with many targets, app target as a thin shell ([nimblehq modular SwiftUI guide](https://nimblehq.co/blog/modern-approach-modularize-ios-swiftui-spm), [sarunw](https://sarunw.com/posts/how-to-modularize-existing-ios-projects-using-swift-package/), [holyswift](https://holyswift.app/introduction-to-swiftui-modularisation-with-spm/)):

```
ios/
  OpenAgents.xcodeproj          # thin shell: app target + entitlements + icon
  OpenAgents/                   # @main App, scene wiring only
  OpenAgentsKit/
    Package.swift               # swift-tools 6.2, per-target swiftSettings
    Sources/
      Models/                   # pure value types, zero deps
      APIClient/                # URLSession + SSE/UIMessageChunk parsing; depends: Models
      Persistence/              # GRDB cache; depends: Models
      DesignSystem/             # tokens, glass components, shared views
      ChatFeature/              # depends: Models, APIClient, Persistence, DesignSystem
      SessionsFeature/          # ditto
      ReposFeature/ SettingsFeature/ BackgroundAgentsFeature/
      AppFeature/               # composition root: tabs, routers, DI wiring
    Tests/  (one test target per source target)
```

Dependency rule: base (Models, DesignSystem) ← infrastructure (APIClient, Persistence) ← features ← AppFeature. SPM hard-fails on cycles, which *enforces* the layering — cross-feature types must sink into Models (or a small `FeatureContracts` target of protocols).

### 4.2 Benefits

- Incremental + parallel builds per module; unchanged modules come from cache. Teams consistently report large CI and inner-loop wins vs a monolithic app target.
- Per-target test bundles → fast focused `swift test`/`xcodebuild test` runs.
- Per-target `swiftSettings` → concurrency posture per layer (MainActor-default features, nonisolated infrastructure; §1.2).
- The `.pbxproj` stays nearly empty (file lists live in `Package.swift` glob land), which mostly dissolves the merge-conflict problem (§6).

### 4.3 Pitfalls

- **Resources:** declare `resources: [.process("Resources")]` per target and load via `Bundle.module`; forgetting the declaration fails at runtime, not compile time. Keep shared assets in DesignSystem.
- **Previews:** Xcode Previews inside SPM targets work but are flakier than in app targets; mitigate with preview-only fixture data per feature target and (if needed) a tiny preview-host app. Plan for it; don't let it surprise the team.
- **Umbrella vs many packages:** one umbrella package is the right on-ramp for a single app; split into independent packages only if cross-app reuse appears. Many `Package.swift` files = boilerplate without benefit here.
- Package defaults don't inherit Xcode project settings — Swift version/isolation flags must be restated in the manifest ([Use Your Loaf](https://useyourloaf.com/blog/approachable-concurrency-in-swift-packages/)).

---

## 5. Persistence for the offline cache

Context: the server is the source of truth (sessions/chats in Postgres). The iOS need is an **offline read cache + fast cold-start** for session lists and chat transcripts, plus small client state. That's "real database, modest schema."

### 5.1 Options assessed

- **SwiftData:** best ergonomics (`@Model`, `@Query`), but the 2024-2026 record is shaky: slower than Core Data/SQLite under load, ~2x Core Data memory in some workloads, iOS 18-era regressions and instability reported by multiple experienced developers, incomplete predicates/batch ops ([fatbobman: key considerations](https://fatbobman.com/en/posts/key-considerations-before-using-swiftdata/), [Michael Tsai: Returning to Core Data](https://mjtsai.com/blog/2024/10/16/returning-to-core-data/), [Emerge Tools benchmark](https://www.emergetools.com/blog/posts/swiftdata-vs-realm-performance-comparison)). *Uncertainty: iOS 26-era SwiftData may have improved; I found no authoritative 2026 source establishing it is now reliable for large transcript workloads.*
- **GRDB 7:** **v7.11.0 released 2026-06-01** (verified via GitHub) — mature, very actively maintained, Swift 6/strict-concurrency-ready, async/await APIs, `ValueObservation` for reactive reads, FTS for transcript search, robust migrations ([groue/GRDB.swift](https://github.com/groue/GRDB.swift)). SwiftUI companion [GRDBQuery](https://github.com/groue/GRDBQuery) exists (0.11.0, Mar 2025 — note: a year without a release; plain `ValueObservation` + `@Observable` stores works fine without it).
- **Point-Free SQLiteData / StructuredQueries:** **1.6.5 released 2026-06-09** (verified) — a credible SwiftData-shaped API over SQLite, now past its 2025 beta caveats ([Point-Free announcement](https://www.pointfree.co/blog/posts/181-a-swiftdata-alternative-with-sqlite-cloudkit-public-beta), [pointfreeco/sqlite-data](https://github.com/pointfreeco/sqlite-data)). Viable, but younger and more opinionated than GRDB (it builds on GRDB-adjacent SQLite usage; CloudKit sync features irrelevant here).
- **Core Data:** reliable but legacy-ergonomics; no reason to choose it for a greenfield Swift 6 app when GRDB exists.
- **Plain JSON files:** fine for tiny things (last-selected repo, draft message snapshots) — wrong for transcripts (no pagination/indexes/partial updates, corruption risk on crash mid-write).

### 5.2 Recommendation

**GRDB 7** behind a `Persistence` target with a small repository-style API (`SessionCache`, `TranscriptCache`). Reasons: proven reliability for exactly this workload, Swift 6 clean, FTS search over transcripts is nearly free, pagination for long transcripts, and it keeps the cache schema decoupled from server types (store the raw message JSON + indexed columns for list rendering). Use `ValueObservation` → `@Observable` store bridging for live UI updates. Treat the cache as disposable (versioned schema, "nuke and re-sync" as the migration escape hatch).

---

## 6. Xcode project generation + CI (monorepo subdirectory)

### 6.1 Options (status verified June 2026)

- **Plain checked-in `.xcodeproj` + Xcode 16+ buildable folders:** `PBXFileSystemSynchronizedRootGroup` makes groups reference folders; file adds/moves/deletes no longer touch the `.pbxproj`, eliminating the dominant class of merge conflicts ([Tuist blog on git conflicts](https://tuist.dev/blog/2025/03/21/git-conflicts), [how synchronized groups work](https://pepicrft.me/blog/how-synchronized-groups-work-at-the-pbxproj-level/), [case study removing 66k pbxproj lines](https://blog.makwanbk.com/how-one-new-xcode-feature-helped-my-work-project-eliminate-66k-lines-of-code)). Combined with the SPM umbrella package (§4) the project file is tiny and nearly static.
- **XcodeGen:** v2.45.4 (2026-04-14, verified) — maintained, community-run; YAML → generated (uncommitted) `.xcodeproj`. Proven in monorepos (DoorDash et al.). Adds a generation step locally + in CI.
- **Tuist:** v4.198.x (releasing near-daily, verified) — Swift-DSL project engine with paid cloud (binary cache, registry, analytics). Powerful, but a heavy toolchain layer + soft vendor coupling; aimed at many-module/many-app orgs.

### 6.2 Recommendation

For one app in a subdirectory of this monorepo with a small team: **check in a minimal `.xcodeproj` that uses buildable folders, and keep ~all code in the local SPM package.** Rationale: zero extra tooling for contributors and CI; the SPM manifest already serves as "project-as-code" for everything that matters (targets, deps, flags); the residual `.pbxproj` surface (app target settings, entitlements, icon) changes rarely. Escalate to **XcodeGen** only if project-file conflicts actually materialize; Tuist is overkill at this scale (its cache pays off at tens of modules/large teams).

### 6.3 CI

- **GitHub Actions macOS runners** (this repo already lives on GitHub Actions): a separate `ios.yml` workflow gated on `ios/**` paths, running `xcodebuild build test` against the package + app scheme. Standard practice pairs it with **fastlane** (`match` for signing, `upload_to_testflight`) once distribution starts ([fastlane GitHub Actions guide](https://docs.fastlane.tools/best-practices/continuous-integration/github/)); for PR CI, plain `xcodebuild` (or `swift test` on the package targets where UI isn't needed) is enough and cheaper.
- macOS runners bill at ~10x Linux minutes; keep the iOS job path-filtered and split "package unit tests" (fast) from "full app build + simulator tests" (slow, maybe merge-queue/nightly only).
- *Uncertainty:* exact GitHub-hosted image with Xcode 26 (macos-15 vs a newer image label in June 2026) — verify the runner image's available Xcode versions when writing the workflow; Xcode version should be pinned via `xcode-select`/`setup-xcode` action.
- **Xcode Cloud** is the alternative (Apple-hosted, TestFlight-native, simpler signing) but is poorly suited to a monorepo with non-iOS CI orchestration and is configured largely outside version control. Reasonable later for release/TestFlight automation; not recommended as the primary PR CI.

---

## 7. Source list (primary ones)

- Apple: [Adopting Swift 6 / strict concurrency](https://developer.apple.com/documentation/swift/adoptingswift6) · [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) · [Upcoming requirements (Xcode 26 SDK mandate, verified)](https://developer.apple.com/news/upcoming-requirements/) · [WWDC23 Observation](https://developer.apple.com/videos/play/wwdc2023/10149/)
- Swift Evolution: [SE-0413 typed throws](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0413-typed-throws.md) · [SE-0461 nonisolated(nonsending)](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md) · [SE-0466 default actor isolation](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md) · [SE-0470 isolated conformances](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0470-isolated-conformances.md) · [SE-0475 Observations](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0475-observed.md)
- Concurrency guides: [Donny Wals — Approachable Concurrency](https://www.donnywals.com/what-is-approachable-concurrency-in-xcode-26/) · [avanderlee](https://www.avanderlee.com/concurrency/approachable-concurrency-in-swift-6-2-a-clear-guide/) · [Use Your Loaf — packages](https://useyourloaf.com/blog/approachable-concurrency-in-swift-packages/) · [InfoQ Swift 6.2](https://www.infoq.com/news/2025/08/swift62-approachable-concurrency/)
- Adoption data: [MacRumors — Apple iOS 26 adoption stats (Feb 2026)](https://www.macrumors.com/2026/02/13/apple-shares-ios-26-adoption-stats/) · [TelemetryDeck iOS major versions](https://telemetrydeck.com/survey/apple/iOS/majorSystemVersions/) · [StatCounter](https://gs.statcounter.com/ios-version-market-share/)
- Liquid Glass: [createwithswift.com](https://www.createwithswift.com/exploring-a-new-visual-language-liquid-glass/) · [Apple newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- Architecture: [Swift forums — Apple-recommended architecture](https://forums.swift.org/t/what-is-the-architecture-officially-recommended-by-apple-for-swiftui-applications/44930) · [re-render mechanics](https://forums.swift.org/t/understanding-when-swiftui-re-renders-an-observable/77876) · [TCA](https://github.com/pointfreeco/swift-composable-architecture) (1.26.0 verified) · [swift-dependencies](https://github.com/pointfreeco/swift-dependencies)
- Modularization: [nimblehq](https://nimblehq.co/blog/modern-approach-modularize-ios-swiftui-spm) · [sarunw](https://sarunw.com/posts/how-to-modularize-existing-ios-projects-using-swift-package/) · [holyswift](https://holyswift.app/introduction-to-swiftui-modularisation-with-spm/)
- Persistence: [GRDB.swift](https://github.com/groue/GRDB.swift) (7.11.0 verified) · [GRDBQuery](https://github.com/groue/GRDBQuery) · [fatbobman on SwiftData](https://fatbobman.com/en/posts/key-considerations-before-using-swiftdata/) · [mjtsai — Returning to Core Data](https://mjtsai.com/blog/2024/10/16/returning-to-core-data/) · [Emerge benchmark](https://www.emergetools.com/blog/posts/swiftdata-vs-realm-performance-comparison) · [Point-Free SQLiteData](https://www.pointfree.co/blog/posts/181-a-swiftdata-alternative-with-sqlite-cloudkit-public-beta) (1.6.5 verified)
- Project/CI: [Tuist — git conflicts & options](https://tuist.dev/blog/2025/03/21/git-conflicts) · [synchronized groups internals](https://pepicrft.me/blog/how-synchronized-groups-work-at-the-pbxproj-level/) · [66k-line pbxproj case study](https://blog.makwanbk.com/how-one-new-xcode-feature-helped-my-work-project-eliminate-66k-lines-of-code) · [XcodeGen](https://github.com/yonaskolb/XcodeGen) (2.45.4 verified) · [Tuist](https://github.com/tuist/tuist) (4.198.x verified) · [fastlane + GitHub Actions](https://docs.fastlane.tools/best-practices/continuous-integration/github/)

## 8. Uncertainties (explicit)

1. **iOS 26 minimum target** is a judgment call (drops ~10-15% of today's devices for a developer-skewed audience); product owner must ratify. iOS 18 is the conservative alternative at the cost of dual design-system maintenance.
2. **WWDC 2026 (this month)** may announce iOS 27/Xcode 27 changes (incl. the concrete sunset of `UIDesignRequiresCompatibility`); re-check after the keynote.
3. **SwiftData's iOS 26-era reliability** may be better than the 2024-2025 record cited; no authoritative 2026 source found either way. The GRDB recommendation does not hinge on it.
4. Exact **GitHub-hosted runner image** carrying Xcode 26.x in June 2026 was not verified; pin Xcode version explicitly in the workflow.
5. Some secondary claims (TCA macro build-time impact magnitude, SPM preview flakiness severity) are community-consensus level, not benchmarked sources.
6. The Perplexity-sourced TabViewBottomAccessory/tabBarMinimizeBehavior API names were cross-confirmed against Apple's Adopting Liquid Glass doc fetch; treat exact signatures as to-verify-in-Xcode.
