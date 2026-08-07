---
title: "Epic: Native iOS app (iPhone + iPad) for Open Agents"
labels: epic, type:feature, ios
---

## Vision

Ship a native Swift iOS app (iPhone + iPad) that is a **first-class client of the `apps/web` API** — not a fork of the product. Open Agents users run cloud agents that edit real repositories, open real PRs, and take minutes to finish; today the only client is a desktop-shaped web app. The iOS app makes the product's single best surface — watching a live agent run (streamed reasoning, tool cards, diffs, cost) — native, glanceable, and pocketable, and turns the product's natural mobile moments into first-class interactions:

- **Monitor**: watch a streaming run with tool-call cards and elapsed time, anywhere.
- **Unblock**: answer `AskUserQuestion` prompts and approve/deny edit requests the moment the agent is blocked, instead of hours later at a desk.
- **Ship**: check PR readiness, watch checks go green, and Squash & Archive from the phone.
- **Start**: pick a repo, dictate a request by voice, and let the agent work.
- **Read**: cached transcripts and diffs survive sandbox hibernation, backgrounding, and the subway.

The app holds no business logic the server does not already own. Its only two interfaces to the backend are the checked-in OpenAPI contract (`apps/web/openapi.json`) and the AI SDK v6 UI Message Stream. The app lives at `ios/` in this monorepo (`ios/App` XcodeGen project + app target, `ios/Packages/*` local SPM packages, including the checked-in generated client `ios/Packages/OpenAgentsAPI` with a CI drift check). Full plan: `docs/plans/ios-app/README.md`.

## Why this matters

- **Stream recovery is the mobile common case, not the edge case.** iOS suspends apps on backgrounding constantly. The server already has resumable streams (`GET /api/chat/[chatId]/stream` replays from chunk 0); a native `URLSession` SSE client with an explicit rebuild-from-scratch reducer is the only dependable way to recover in-flight runs. Mobile Safari tabs get killed silently; a PWA cannot make this reliable.
- **Decision-shaped interactions need native affordances.** Approvals, question replies, and merge confirmations are short and latency-sensitive. Native gets Keychain-held sessions that survive relaunch, Face ID gating, haptics, and share-sheet integration — none of which the web app has today.
- **The run-watching surface deserves 60–120 Hz.** Tool cards, token streaming, and diff rendering are high-frequency UI; the web workspace is a single 5,076-line client component (`apps/web/components/session-chat-content.tsx`) that was never designed for a phone.
- **Offline reading is a product requirement on mobile.** The server already caches diffs (`sessions.cachedDiff`); GRDB generalizes that pattern to transcripts, session lists, and run timelines.
- **Forcing the API contract to grow is a strategic win for the whole product.** The OpenAPI spec covers 6 of ~118 routes and has zero consumers today. Building a generated-client iOS app makes the contract real, typed, and regression-gated for every future client.

## Scope

### In scope (v1.0)

- **Server enablers (web-side, land first):** better-auth `bearer()` + one-time-token plugins with deep-link handoff routes under `apps/web/app/api/native-auth/*`; Sign in with Apple (App Store guideline 4.8); native sign-out and in-app account deletion (guideline 5.1.1(v)); OpenAPI contract expansion from 6 paths / 10 operations to the full iOS-consumed surface (~94 operations across six batches) with Swift-codegen-safe spec hygiene; BotID exemption for bearer-authenticated clients; `usage_events.source` extended with `"ios"`; AASA universal links; a shipped-binary contract-compat lane in web CI.
- **iOS app v1 surface:** Vercel OAuth + Sign in with Apple sign-in with Keychain token custody; cache-first session inbox and new-session flow; offline-readable transcripts rendering every persisted message part type; live streaming chat with deterministic resume after backgrounding; composer with attachments, drafts, and voice dictation; `AskUserQuestion` and edit-approval interactions; per-chat model picker and chat management; sandbox lifecycle with one-tap Resume; files browser, unified diff (with cached-offline fallback), commit & push, full PR lifecycle (create, checks, merge, Squash & Archive); repos tab and dashboard; background-run monitoring; share links and the public shared-chat viewer; settings subset, account management with in-app deletion, and usage glances; observability hardening (structured events, diagnostics export, MetricKit/Sentry/PostHog); accessibility to AX5 and first-class iPad; TestFlight lanes from CI and the App Store 1.0 submission.
- **Engineering substrate:** `ios/` scaffold (XcodeGen + 16 local SPM packages), checked-in generated OpenAPI client with two-sided drift gates, swift-format gate, one-command `./ios/Scripts/ci.sh`, path-filtered `macos-26` CI, shared test-support package, recorded SSE fixture catalog, snapshot baselines, thin XCUITest smoke, nightly workflow.

### Out of scope (v1.0)

Per `docs/plans/ios-app/00-overview.md` section 4 — do not design, stub, or scaffold:

- In-browser code editor (`/codespace/[sessionId]`) — web-only.
- Managed-runtime profile authoring/editing UI — iOS only renders runtime status.
- Verified Build forensics (Workcells/Trace/Ops) — operator console.
- Composio profile configuration — iOS respects per-chat selections made elsewhere.
- Background-agent authoring (triggers, cron, conditions) — monitoring + enable/disable toggles only.
- Split (side-by-side) diffs — unified-only, matching web mobile behavior.
- APNs push, Live Activities, widgets, App Intents — no server push infrastructure exists; post-1.0 epic. v1 uses foreground polling + in-app alerts.
- Offline writes (queued mutations) — offline is read-only in v1.
- Android, macOS (Catalyst/native), visionOS.
- Web feature parity, leaderboard, public profiles, skills authoring, model-variant JSON editing.

## Current state

- **No iOS code exists.** The web app is the product's only client; this epic's planning doc set under `docs/plans/ios-app/` (00–08 plus 17 research briefs) is the build plan.
- **OpenAPI contract:** `apps/web/lib/api/openapi-spec.ts` documents 6 paths / 10 operations of ~118 routes, with zero runtime consumers. Drift gates already exist and work (`apps/web/scripts/check-openapi.ts`, the committed `apps/web/openapi.json` and `apps/web/lib/api/openapi-types.ts`). Three mutation responses are untyped (`additionalProperties: {}`), `additionalProperties: false` breaks Swift codegen, and no `components.schemas`, `securitySchemes`, or `format: date-time` exist yet.
- **Auth:** better-auth 1.6.5 runs cookie-only with no plugins enabled (`apps/web/lib/auth/config.ts`); sign-in is Vercel OAuth, repo access is the GitHub App. The bearer plugin, deep-link handoff, Sign in with Apple, and account deletion are all net-new server surface. A dev test-auth path exists (`OPEN_AGENTS_ENABLE_TEST_AUTH=1` + `open_agents_test_user_id` cookie).
- **Streaming:** chat is the Vercel AI SDK v6 UI Message Stream over SSE (`data: {json}` lines, `data: [DONE]` terminator, `x-vercel-ai-ui-message-stream: v1` header), server pin `ai@6.0.168`, with resumable streams that replay from chunk 0. The stream is not OpenAPI-expressible; the iOS client hand-builds exactly this surface plus the auth handshake.
- **BotID** gates several POST routes (`/api/chat`, `/api/sessions`, `/api/sandbox`, and others); its behavior for bearer-authenticated non-browser traffic is unresolved and is a named workstream (M1-07).
- **Process:** the repo's discipline (feature tickets, behavior-first TDD with red commits, regression discipline, formatting gate, observability evidence) carries over to Swift unchanged; the iOS analog of `bun --bun run ci` is the single gate command `./ios/Scripts/ci.sh`. All GitHub writes target the fork — never `vercel-labs/open-agents`.

## Key design questions

All settled — recorded in the decision log (`docs/plans/ios-app/00-overview.md` sections 6 and 10). Implementers cite these instead of re-litigating.

1. **Native Swift, responsive web, or React Native?** Decided: native Swift. Stream recovery across iOS suspension, Keychain/Face ID/haptics affordances, high-frequency streaming UI, and offline reading are exactly where a PWA or bridge costs the most.
2. **UI architecture — TCA or vanilla?** Decided: SwiftUI-only with `@Observable` MVVM; TCA rejected. Plain observable models plus typed routers give the same separation with zero skeleton-wide dependencies, and weak AI implementers handle vanilla MVVM far more reliably than reducer/dependency macros.
3. **Persistence — SwiftData or GRDB?** Decided: GRDB 7.x. Explicit SQL migrations, fast bulk upserts, `ValueObservation`, and zero-setup in-memory test databases; SwiftData fights Swift 6 strict concurrency and the deterministic tests this repo's process demands.
4. **Hand-rolled networking or a generated client?** Decided: swift-openapi-generator 1.12.2 with URLSession transport and a `ClientMiddleware` auth header. Hand-rolled clients drift silently; codegen converts server-side API drift into a red CI check. Hand-written code is reserved for the two surfaces the spec cannot express (the SSE chat stream and the auth handshake).
5. **Generated code checked in or build-time plugin?** Decided: checked in at `ios/Packages/OpenAgentsAPI` with a CI drift check. Contract changes become reviewable PR diffs and builds stay hermetic, mirroring the committed `apps/web/lib/api/openapi-types.ts` precedent.
6. **Minimum deployment target?** Decided: iOS 26.0 / iPadOS 26.0 (Xcode 26.x, Swift 6.2 strict concurrency, Liquid Glass native). The audience is developers who track current iOS; one design language and no `#available` forests, and lowering a floor later is the cheap, reversible direction.
7. **Monorepo or separate repo?** Decided: `ios/` in this monorepo. The plan's strongest guarantee — a spec change and the regenerated Swift client land in the same atomic PR or CI is red — is only cheap in one repository.
8. **Project file format?** Decided: XcodeGen (`ios/App/project.yml` committed; `.xcodeproj` generated and git-ignored). Declarative, diffable YAML instead of a merge-conflict-prone `project.pbxproj` that weak implementers corrupt and humans review badly.
9. **Native API auth?** Decided: better-auth `bearer()` plugin with `set-auth-token` header rotation, expo-style deep-link handoff via `ASWebAuthenticationSession`, `trustedOrigins` including `"openagents://"`, plus Sign in with Apple (guideline 4.8) and in-app account deletion (guideline 5.1.1(v)). Cookie scraping is fragile and the App Store guidelines are hard gates, so the server work lands first as M0.
10. **Chat transport?** Decided: a hand-built SSE client and a pure `ChatTurnState` reducer for the AI SDK v6 UI Message Stream that rebuilds the in-flight message from scratch on every resume replay. Replay-from-chunk-0 semantics make naive append duplicate content, and backgrounding makes resume the common case on iOS.
11. **Notifications in v1?** Decided: foreground polling + in-app alerts; APNs, Live Activities, and widgets are post-1.0. No server push infrastructure exists (no device-token table, no fan-out), and building it would block the entire release on net-new backend.
12. **Testing stack?** Decided: Swift Testing for unit/integration, swift-snapshot-testing 1.18.x, recorded server fixtures as the primary regression suite, and a thin XCTest-based XCUITest smoke. Deterministic fixture replay protects the protected paths; live servers are canaries, never the regression suite.

## Phased plan

Fourteen milestones, 60 PR-sized sub-issues. The keys below (M0–M13) are the canonical milestone breakdown for this epic and supersede the coarser M0–M8 sketch in `docs/plans/ios-app/00-overview.md` section 8. Server enablers (M0, M1) land as normal web PRs into `develop` before any Swift work depends on them; every iOS milestone exits with `./ios/Scripts/ci.sh` green.

### M0 — Server enablers: native auth

Goal: make `apps/web` a bearer-token multi-client auth platform — bearer/OTT plugins, deep-link handoff routes, Sign in with Apple, native sign-out, and in-app account deletion — landed as red-first web PRs into `develop` before any Swift work depends on them.

- [ ] **M0-01** — Enable better-auth bearer + one-time-token plugins with native deep-link handoff routes
- [ ] **M0-02** — Sign in with Apple provider (App Store guideline 4.8)
- [ ] **M0-03** — Native sign-out route and in-app account deletion (guideline 5.1.1(v))

### M1 — Server enablers: OpenAPI contract expansion

Goal: grow `apps/web/openapi.json` from 6 paths / 10 operations to the full iOS-consumed surface with Swift-codegen-safe hygiene, one PR-sized batch at a time, keeping `openapi:check`, the spec unit test, and `bun --bun run ci` green and regenerating both committed artifacts in every PR.

- [ ] **M1-01** — Batch A — OpenAPI spec hygiene for Swift codegen
- [ ] **M1-02** — Batch B — sessions and chats paths
- [ ] **M1-03** — Batch C — sandbox lifecycle paths
- [ ] **M1-04** — Batch D — files, diff, and remaining git paths
- [ ] **M1-05** — Batch E — settings, models, usage, transcribe, and title paths
- [ ] **M1-06** — Batch F — GitHub, repos, Vercel, background agents, shares, and auth-info paths
- [ ] **M1-07** — BotID native-client exemption and usage_events.source 'ios'

### M2 — iOS foundation: scaffold, codegen, CI

Goal: stand up the `ios/` tree: XcodeGen project plus the 16-package skeleton, the checked-in generated OpenAPI client with drift scripts, the swift-format gate and one-command ios CI script, the path-filtered GitHub Actions gate, and the shared test-support package — with the monorepo isolation exit test green in both directions.

- [ ] **M2-01** — ios/ scaffold: XcodeGen project, app target, and 16-package skeleton
- [ ] **M2-02** — OpenAgentsAPI generated client package with drift scripts
- [ ] **M2-03** — Formatting gate, ios CI workflow, and monorepo isolation exit test
- [ ] **M2-04** — OpenAgentsTestSupport package and test plans

### M3 — Networking layer and typed facades

Goal: a middleware-driven API client with one error taxonomy, class-based timeout/retry policy, environment switching, and OpenAgentsCore domain models plus facades covering every generated-client endpoint a v1 screen consumes.

- [ ] **M3-01** — APIClient networking core: sessions, middleware chain, errors, environments, RawHTTPClient
- [ ] **M3-02** — Domain models + facades: sessions, chats, sandbox, files, diff, git
- [ ] **M3-03** — Domain models + facades: settings, models, usage, GitHub, repos, background agents, shares

### M4 — iOS auth: sign-in, token custody, lifecycle

Goal: P1 protected path — sign-in (Vercel OAuth and Sign in with Apple) lands a bearer token in the Keychain that survives relaunch, rotates transparently, signs out cleanly, and never appears in a log.

- [ ] **M4-01** — KeychainTokenStore and Vercel OAuth sign-in flow
- [ ] **M4-02** — Native Sign in with Apple flow
- [ ] **M4-03** — AuthController state machine, bootstrap, 401 handling, sign-out, dev test-auth

### M5 — Design system and app shell

Goal: tokens and chrome exist; the app boots into signed-out onboarding or the four-tab shell with typed routing, deep links, and destination-preserving sign-in gates.

- [ ] **M5-01** — DesignSystem package: tokens, components, contrast tests, snapshots
- [ ] **M5-02** — AppShell composition root: tabs, typed router, deep links, scene-phase hooks
- [ ] **M5-03** — Onboarding screens: Welcome, auth progress, sign-in gate, Connect GitHub

### M6 — Read-only core: persistence, inbox, transcripts

Goal: P2/P9 — a cache-first session inbox, session creation, and offline-readable transcripts that render every persisted message part type from GRDB before the network answers.

- [ ] **M6-01** — PersistenceKit: GRDB schema v1, caches, nuke, pruning
- [ ] **M6-02** — Sessions inbox (SCR-10) with cache-first rendering and polling
- [ ] **M6-03** — New Session flow (SCR-11): repo picker, branch picker, error matrix
- [ ] **M6-04** — Chat history models, GRDB message cache, read receipts
- [ ] **M6-05** — Read-only transcript: markdown, code blocks, reasoning, chat shell
- [ ] **M6-06** — Tool rows, data-part chips, and message badges

### M7 — Streaming chat engine

Goal: T3/U3/U4 — a deterministic, fixture-proven SSE engine: decode every ai@6.0.168 chunk type, reduce to messages off-main, resume by rebuilding from scratch, and render the live run at 60 fps with zero duplicated or lost content.

- [ ] **M7-01** — SSE line parser, lenient chunk decoder, recorded fixture catalog
- [ ] **M7-02** — ChatTurnState reducer with golden and replay-idempotence tests
- [ ] **M7-03** — ChatStreamClient actor: connect, resume probe, stop semantics, error mapping
- [ ] **M7-04** — ChatRuntime, registry, send flow, and GRDB write points
- [ ] **M7-05** — Resume, reconnect, and app-lifecycle reconciliation (U4)
- [ ] **M7-06** — Run-watching UI: streaming render, scroll rules, stop, status strip, perf budget

### M8 — Interaction: composer, approvals, chat management

Goal: U5 — compose with attachments and voice, answer AskUserQuestion prompts and edit approvals in two taps or fewer, switch models per chat, and manage chats and messages without ever stranding the composer.

- [ ] **M8-01** — Composer: anatomy, attachments, drafts, queued sends, S1 liftoff
- [ ] **M8-02** — Voice dictation via /api/transcribe
- [ ] **M8-03** — AskUserQuestion morph and edit-approval cards (U5)
- [ ] **M8-04** — Model picker, run options, and session info sheets (SCR-13/14/15)
- [ ] **M8-05** — Message actions: copy, share, fork, edit & resend

### M9 — Ship code: sandbox, files, diff, commit, PR

Goal: U6/U7 — review diffs (including cached offline), commit and push, open and merge PRs, and resume paused workspaces with one tap — every sandbox-dependent surface degrades to cached content plus a Resume CTA, never a blank screen.

- [ ] **M9-01** — Workspace status row and sandbox lifecycle surface
- [ ] **M9-02** — Git panel container, Files browser, and File Viewer (SCR-16a/16b)
- [ ] **M9-03** — Diff tab with cached-offline fallback (SCR-16c)
- [ ] **M9-04** — Commit & Push with base-branch guard (SCR-16d)
- [ ] **M9-05** — PR surface: create, checks, merge, Squash & Archive, fix hand-backs (SCR-16e)

### M10 — Monitoring and secondary surfaces

Goal: the remaining v1 surfaces: repos tab, background-agent monitoring, share links and the public viewer, the settings subset with in-app alerts, account management with deletion, and usage glances.

- [ ] **M10-01** — Repos tab: list and failure-isolated repo dashboard (SCR-20/21)
- [ ] **M10-02** — Agents tab: run feed, agent detail, run detail with proof grid (SCR-30/31/32)
- [ ] **M10-03** — Sharing: share-link sheet and public shared-chat viewer (SCR-17/50)
- [ ] **M10-04** — Settings core, preferences, default model, App Lock, in-app alerts (SCR-40/42/44/46)
- [ ] **M10-05** — Account surfaces: profile, connections, delete account (SCR-41/43/47)
- [ ] **M10-06** — Usage screen with heatmap and rank (SCR-45)

### M11 — Observability hardening

Goal: discipline-grade client observability: structured redacted events with server-joinable correlation IDs, a bounded diagnostics pipeline with in-app export, and the crash/metrics/analytics stack measuring the U9 crash-free criterion.

- [ ] **M11-01** — Structured event emitter, correlation IDs, and Redactor port
- [ ] **M11-02** — Ring buffer, debug console, and diagnostic bundle export
- [ ] **M11-03** — MetricKit, Sentry, PostHog, consent, and signposts

### M12 — Polish, accessibility, iPad, UI smoke

Goal: U8-grade accessibility, restraint-audited motion and haptics, a first-class iPad experience at every window size, and the machine-executable XCUITest smoke that locks P1-P3.

- [ ] **M12-01** — Accessibility pass and motion/haptics restraint audit
- [ ] **M12-02** — iPad: split view, inspector, keyboard shortcuts, pointer, window-size matrix
- [ ] **M12-03** — XCUITest smoke suite and nightly workflow

### M13 — Release: TestFlight and App Store

Goal: TestFlight internal and external lanes proven from CI with cloud-managed signing, server-side release compatibility (universal links + shipped-binary contract lane), and a compliant App Store 1.0 submission.

- [ ] **M13-01** — Release workflow, cloud signing, and TestFlight lanes
- [ ] **M13-02** — Server release readiness: AASA universal links and shipped-binary contract-compat lane
- [ ] **M13-03** — App Store submission: privacy, metadata, compliance, 1.0 release

## Definition of done

- All 60 sub-issues across M0–M13 are landed per the repo process: red-first test commits, regression tests for every bug, observability evidence on every slice, PRs into `develop` with both gates green where applicable (`bun --bun run ci` for web-touching slices, `./ios/Scripts/ci.sh` for iOS slices).
- The 1.0 app is live on the App Store for iPhone and iPad, compliant with guidelines 4.8 (Sign in with Apple) and 5.1.1(v) (in-app account deletion), with accurate privacy labels.
- UX success criteria U1–U9 from `docs/plans/ios-app/00-overview.md` section 5 are verified during the TestFlight beta, including crash-free sessions ≥ 99.5% before submission.
- Technical criteria T1–T8 hold continuously: one iOS gate command green on `develop`; two-sided contract drift gates (web spec regeneration + Swift client regeneration) red on divergence; every `ai@6.0.168` chunk type decoded against recorded fixtures; lenient enum/timestamp decoding; iOS-only changes leave web CI green and vice versa; TestFlight uploads from CI with zero local signing; the shipped-binary contract-compat lane enforces additive-only changes to spec-covered paths.
- The server is a real multi-client platform: bearer-token auth, Sign in with Apple, native sign-out, in-app account deletion, an expanded `apps/web/openapi.json` covering every generated-client endpoint the app consumes, BotID never blocking bearer-authenticated native traffic, and `usage_events.source` attributing native turns as `"ios"`.
- Every named protected path (P1 sign-in/token custody through P10 codegen drift) has a machine-executable proof: deterministic fixture suites, snapshot baselines, the XCUITest smoke, and the nightly workflow.
- The "Epic: TBD" lines in `docs/plans/ios-app/README.md` and `docs/plans/ios-app/00-overview.md` are replaced with this epic's issue number.

## Plan documents

- `docs/plans/ios-app/README.md`
- `docs/plans/ios-app/00-overview.md`
- `docs/plans/ios-app/01-product-and-ux.md`
- `docs/plans/ios-app/02-api-contract-and-networking.md`
- `docs/plans/ios-app/03-architecture.md`
- `docs/plans/ios-app/04-auth.md`
- `docs/plans/ios-app/05-streaming-chat-engine.md`
- `docs/plans/ios-app/06-testing-strategy.md`
- `docs/plans/ios-app/07-observability.md`
- `docs/plans/ios-app/08-ci-cd-release.md`
- `docs/plans/ios-app/research/01-api-chat-and-streaming.md`
- `docs/plans/ios-app/research/02-api-sessions-sandbox-git.md`
- `docs/plans/ios-app/research/03-api-repos-github-vercel.md`
- `docs/plans/ios-app/research/04-api-settings-usage-misc.md`
- `docs/plans/ios-app/research/05-api-background-agents-harness-workflows.md`
- `docs/plans/ios-app/research/06-auth-for-native-clients.md`
- `docs/plans/ios-app/research/07-data-model.md`
- `docs/plans/ios-app/research/08-openapi-contract-state.md`
- `docs/plans/ios-app/research/09-web-ux-inventory.md`
- `docs/plans/ios-app/research/10-process-rules.md`
- `docs/plans/ios-app/research/11-web-client-consumption-patterns.md`
- `docs/plans/ios-app/research/20-swift-app-architecture.md`
- `docs/plans/ios-app/research/21-swift-openapi-generator.md`
- `docs/plans/ios-app/research/22-swift-sse-and-stream-protocol.md`
- `docs/plans/ios-app/research/23-ios-auth-patterns.md`
- `docs/plans/ios-app/research/24-ios-testing-and-ci.md`
- `docs/plans/ios-app/research/25-ios-observability.md`
- `docs/plans/ios-app/research/26-design-research.md`

Sub-issues are linked via GitHub sub-issue relationships; dependency keys in child issues map to issue numbers.
