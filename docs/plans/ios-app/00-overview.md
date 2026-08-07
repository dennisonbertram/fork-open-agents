# 00 — iOS App Epic Overview

Status: PLANNING (no app code exists yet; this document set is the build plan)
Epic: TBD (GitHub epic issue on `dennisonbertram/fork-open-agents` — create per the process
section below, then replace this line and the matching line in `docs/plans/ios-app/README.md`)

This is the entry-point document for the native Swift iOS app (iPhone + iPad) that becomes a
first-class client of the `apps/web` API. Sibling docs `01-product-and-ux.md` through
`09-step-by-step-build-guide.md` expand each area; the research briefs under
`docs/plans/ios-app/research/` are the ground-truth source material. Nothing in this document
re-decides the canonical stack — see "Canonical versions" and the decision log.

---

## 1. Vision

Open Agents users run cloud agents that edit real repositories, open real PRs, and take minutes
to finish. Today the only client is a desktop-shaped web app. The iOS app makes the product's
single best surface — watching a live agent run (streamed reasoning, tool cards, diffs, cost) —
native, glanceable, and pocketable, and turns the product's natural mobile moments into
first-class interactions:

- **Monitor**: watch a streaming run with tool-call cards and elapsed time, anywhere.
- **Unblock**: answer `AskUserQuestion` prompts and approve/deny edit requests the moment the
  agent is blocked, instead of hours later at a desk.
- **Ship**: check PR readiness, watch checks go green, and Squash & Archive from the phone.
- **Start**: pick a repo, dictate a request by voice, and let the agent work.
- **Read**: cached transcripts and diffs survive sandbox hibernation, backgrounding, and the
  subway.

The app is a *client*, not a fork of the product: it consumes the same API the web app consumes,
holds no business logic the server does not already own, and treats the checked-in OpenAPI
contract (`apps/web/openapi.json`) plus the AI SDK v6 UI Message Stream as its only two
interfaces to the backend.

## 2. Why native iOS (not responsive web, not React Native)

1. **Stream recovery is the mobile common case, not the edge case.** iOS suspends apps on
   backgrounding constantly. The product already has resumable streams server-side
   (`GET /api/chat/[chatId]/stream` replays from chunk 0); a native `URLSession`-based
   `AsyncSequence` client with an explicit reducer is the reliable way to rebuild in-flight
   assistant messages on every foreground (research brief `22-swift-sse-and-stream-protocol.md`).
   Mobile Safari tabs get killed silently; a PWA cannot make this dependable.
2. **Decision-shaped interactions need native affordances.** Approvals, question replies, and
   merge confirmations are short and latency-sensitive. Native gets us Keychain-held sessions
   that survive relaunch, Face ID gating, haptics, share-sheet integration, and (post-1.0)
   APNs push, Live Activities, and widgets — none of which the web app has today (the web's
   only notification is a tab-local toast + sound, `apps/web/hooks/use-background-chat-notifications.tsx`).
3. **The run-watching surface deserves 120 Hz.** Tool cards, token streaming, and diff
   rendering are high-frequency UI updates. SwiftUI with isolated streaming state renders this
   without jank; the web workspace is a single 5,076-line client component
   (`apps/web/components/session-chat-content.tsx`) that was never designed for a phone.
4. **Offline reading is a product requirement on mobile.** The server already caches diffs into
   `sessions.cachedDiff` for the web's offline-diff banner; GRDB generalizes that pattern to
   transcripts, session lists, and run timelines locally.
5. **Forcing the API contract to grow is a strategic win for the whole product.** The OpenAPI
   spec covers 6 of ~118 routes and has zero consumers in the web UI (research brief
   `08-openapi-contract-state.md` §5). Building a generated-client iOS app makes the contract
   real, typed, and regression-gated for every future client.

React Native / Expo is rejected because the differentiating features (Liquid Glass UI, strict
Swift 6.2 concurrency around the SSE hot path, App Intents, Live Activities, GRDB) are exactly
the places where a bridge costs the most, and the team's process (behavior-first TDD with
deterministic fixtures) maps cleanly onto Swift Testing.

## 3. Goals

1. Ship an iPhone + iPad app to the App Store that covers: sign-in, session inbox, live
   streaming chat with resume, composer (text, voice, attachments), approvals
   (`AskUserQuestion`, edit approval), unified diff review, commit/push, PR create/status/merge,
   background-run monitoring, share-link reading, core settings, and usage glances.
2. Make the server a real multi-client platform: bearer-token auth for native clients, Sign in
   with Apple, account deletion, and an expanded OpenAPI contract with drift gates on both
   sides (web CI regenerates and compares the spec; iOS CI regenerates and compares the Swift
   client).
3. Keep the repo's engineering discipline intact for Swift: feature-ticket issues,
   behavior-first TDD with red/green commits, regression tests for every bug, a single iOS CI
   gate command, and observability evidence (OSLog subsystems + simulator screenshots) for
   every slice.
4. Reproduce — and improve on — the web's most-loved surface: the in-flight agent run display
   ("Pondered · 26s · 2 tool calls · 1 file changed"), with the top-20 web UX lessons from
   research brief `09-web-ux-inventory.md` §B treated as requirements, not suggestions.

## 4. Non-goals (explicit)

These are out of scope for v1.0. Do not design, stub, or scaffold them.

| Non-goal | Why |
|---|---|
| In-browser code editor (`/codespace/[sessionId]`) | Full VS Code on a phone is pointless; web-only surface. |
| Managed-runtime profile authoring/editing UI | Dense operator console; web-only. iOS only *renders* runtime status the API returns. |
| Verified Build forensics (Workcells/Trace/Ops tabs) | Operator console. The single plan-approval action MAY appear post-1.0. |
| Composio profile configuration | Copy-paste-heavy (`ac_…`/`ca_…` IDs); web-only. iOS respects per-chat selections made elsewhere. |
| Background-agent authoring (triggers, cron, conditions) | Desktop-ish and mid-redesign (web issues #224/#229). iOS gets run *monitoring* + enable/disable toggles only. |
| Split (side-by-side) diffs | Web already forces unified on mobile; iOS is unified-only. |
| APNs push, Live Activities, widgets, App Intents | No server push infrastructure exists (no device-token table, no fan-out). Post-1.0 epic; v1 uses foreground polling + in-app alerts. |
| Offline *writes* (queued mutations while offline) | Offline is read-only in v1: cached transcripts/diffs/inbox. Mutations require connectivity. |
| Android, macOS (Catalyst/native), visionOS | iPhone + iPad only. |
| Web feature parity | The app covers the mobile-fit flows in research brief `09-web-ux-inventory.md` §C; everything else links out to the web. |
| Leaderboard, public profiles, skills authoring, model-variant JSON editing | Secondary/power web surfaces; defer. |

## 5. Success criteria

### UX-level

| # | Criterion | Measured how |
|---|---|---|
| U1 | A signed-out user completes Vercel OAuth sign-in (or Sign in with Apple) in under 60 seconds and the session survives app relaunch and device reboot | XCUITest smoke + manual TestFlight verification |
| U2 | Cold launch to interactive session inbox in under 2 seconds on iPhone (cached data renders immediately, network refresh follows) | Instruments / signpost measurement in CI perf lane |
| U3 | A live agent run renders streamed text, reasoning blocks, and tool cards with status transitions (pending → success/error) within 200 ms of chunk arrival | Snapshot + unit tests on the reducer; manual smoke |
| U4 | Backgrounding the app mid-stream and foregrounding it resumes the stream (or refetches persisted messages on 204) with zero duplicated or lost text | Deterministic reducer test with replay-from-chunk-0 fixtures; protected-path regression |
| U5 | An `AskUserQuestion` or edit-approval prompt can be answered in ≤ 2 taps from the chat screen | XCUITest smoke |
| U6 | A user can commit, open a PR, watch checks, and squash-merge entirely from the phone | Behavior test against contract fixtures + TestFlight smoke against the dev deployment |
| U7 | Returning to a hibernated sandbox shows cached transcript + cached diff with an amber stale banner and a one-tap Resume CTA — never a blank screen | Snapshot tests for stale states; regression test |
| U8 | Every disabled control states *why* it is disabled (the web's `runtimeToolsDisabledReason` pattern); no bare unlabeled icon buttons for critical actions | Design review checklist in `01-product-and-ux.md` |
| U9 | Crash-free sessions ≥ 99.5% across the TestFlight beta before App Store submission | MetricKit/crash pipeline per `07-observability.md` |

### Technical

| # | Criterion | Measured how |
|---|---|---|
| T1 | One iOS gate command (`ios/scripts/ci.sh`) runs format-lint → project generation → build → unit tests → generated-client drift check, locally and in CI, and is green on `develop` at all times | `.github/workflows/ios-ci.yml` |
| T2 | `ios/Packages/OpenAgentsAPI` regenerates byte-identical from the committed `apps/web/openapi.json`; drift fails CI on both the web side (`apps/web/scripts/check-openapi.ts`) and the iOS side | CI drift checks |
| T3 | The SSE decoder decodes every chunk type emitted by `ai@6.0.168` (`text-delta`, `tool-input-*`, `tool-output-*`, `reasoning-*`, `data-*`, `message-metadata`, `abort`, `[DONE]`, …) against recorded fixtures, with unknown-type tolerance | Parameterized Swift Testing suite in `05-streaming-chat-engine.md` |
| T4 | All Postgres-derived enums decode leniently (unknown-case fallback) and all timestamps decode as ISO-8601 UTC with fractional seconds | Decoder unit tests per research brief `07-data-model.md` conventions |
| T5 | Every behavior-changing slice has a red-first test commit (`test(red): …`) and a regression test for every bug, per `docs/process/behavior-tdd.md` and `docs/process/regression-discipline.md` | PR review + TDD audit trail sections |
| T6 | iOS-only changes leave `bun --bun run ci` green (web tooling ignores `ios/`), and web contract changes leave the iOS drift check red until the client is regenerated | M1 exit test, then continuous |
| T7 | TestFlight builds upload from CI using App Store Connect API keys with no local-machine signing steps | `08-ci-cd-release.md` pipeline run |
| T8 | Server keeps backward compatibility with shipped app binaries: additive-only changes to spec-covered paths, verified by running the previous release's contract fixtures in web CI | Contract-compat lane defined in `02-api-contract-and-networking.md` |

## 6. Canonical versions

This table restates the canonical stack. It is settled. No sibling doc, issue, or implementer
re-opens these choices; the decision log (§10) records why.

| Area | Canonical choice |
|---|---|
| IDE / toolchain | Xcode 26.x (iOS 26 SDK) |
| Language | Swift 6.2, Swift 6 language mode, strict concurrency = complete |
| UI framework | SwiftUI-only; `@Observable` MVVM (TCA rejected) |
| Minimum deployment | iOS 26.0 / iPadOS 26.0 (Liquid Glass native; no `UIDesignRequiresCompatibility`) |
| Local persistence | GRDB 7.x (SQLite) — SwiftData rejected |
| Project file | XcodeGen (`ios/App/project.yml` checked in; `.xcodeproj` generated, git-ignored) |
| API client | swift-openapi-generator 1.12.2, `URLSession` transport (swift-openapi-urlsession), auth via `ClientMiddleware` injecting `Authorization: Bearer` |
| Generated code policy | Generated Swift client **checked in** at `ios/Packages/OpenAgentsAPI` with a CI drift check (build-time generation rejected) |
| Unit tests | Swift Testing (ships in the Xcode 26 toolchain; no package dependency) |
| Snapshot tests | swift-snapshot-testing 1.18.x |
| UI automation | Thin XCUITest smoke suite (XCTest-based; UI automation has no Swift Testing equivalent) |
| CI | GitHub Actions `macos-26` runners, pinned Xcode 26.x via `xcode-select` |
| Delivery | TestFlight uploads via App Store Connect API keys (no local signing) |
| Server contract | `apps/web/openapi.json` (OpenAPI 3.0.3), generated by `bun run --cwd apps/web openapi:generate`, drift-gated by `apps/web/scripts/check-openapi.ts` |
| Chat streaming | Vercel AI SDK v6 UI Message Stream over SSE (`data: {json}` lines, `data: [DONE]` terminator, `x-vercel-ai-ui-message-stream: v1` response header, resumable streams that replay from chunk 0); server pin `ai@6.0.168` |
| Auth | better-auth 1.6.5 + `bearer()` plugin (`set-auth-token` header rotation); expo-style deep-link handoff via `ASWebAuthenticationSession`; `trustedOrigins` including `"openagents://"`; Sign in with Apple (App Store guideline 4.8); account-deletion path (guideline 5.1.1(v)) |

Where this table says "x" (Xcode 26.x, GRDB 7.x, swift-snapshot-testing 1.18.x), the exact point
release is pinned in `03-architecture.md` (package pins) and `08-ci-cd-release.md` (runner/Xcode
pins) and recorded in `ios/App/project.yml` / `Package.swift` files — one pin, referenced
everywhere, never duplicated as prose.

## 7. Target users

1. **The operator on the go** (primary). An existing Open Agents user — a developer who already
   runs agents on their repos from the web app — away from the desk. Wants: glanceable run
   status, instant unblock (answer the agent's question, approve the edit), sandbox resume,
   "did my PR go green?". Tolerance for configuration UI: zero.
2. **The PR shipper.** Same person, different moment: a run finished, checks are green, they
   want to read the diff (skim on iPhone, real review on iPad), squash-merge, and archive
   without opening a laptop.
3. **The starter.** Has an idea in transit: pick a repo, dictate the request by voice
   (`/api/transcribe` or native dictation), start the session, pocket the phone.
4. **The share-link reader** (signed-out). Recipients already open `/shared/[shareId]` links on
   phones today (web story STORY-127). Universal links should open these in-app with a
   read-only view and a sign-in path that preserves the destination (web UX lesson B12).

The app is not aimed at first-contact acquisition: onboarding (GitHub App install, org
approval, Vercel project linking) stays on the web; the app links out for it.

## 8. Feature scope by milestone

Server enablers come first because nothing native can ship without them; App Store release is
last. Each milestone is a set of PR-sized feature-slice issues (see §11); the per-issue
breakdown with exact commands lives in `09-step-by-step-build-guide.md`. Milestones M2+ each
end with the iOS gate green and a recorded simulator smoke.

### M0 — Server enablers (web-side work, no Swift)

The two prerequisite workstreams. Both land as normal web PRs into `develop` with contract
tests, before or in parallel with M1.

- **Native auth** (detail in `04-auth.md`): enable the better-auth `bearer()` plugin in
  `apps/web/lib/auth/config.ts` (`set-auth-token` response-header rotation); add
  `"openagents://"` to trusted origins (env-var path: `BETTER_AUTH_TRUSTED_ORIGINS`); expo-style
  deep-link callback handoff for `ASWebAuthenticationSession`; Sign in with Apple as a
  better-auth social provider (App Store guideline 4.8); an account-deletion endpoint + flow
  (guideline 5.1.1(v)).
- **Contract expansion** (detail in `02-api-contract-and-networking.md`): extend
  `apps/web/lib/api/openapi-spec.ts` from 6 paths / 10 operations to the iOS-consumed surface
  (sessions CRUD, chats, messages, diff + cached diff, files, remaining git routes, sandbox
  status/resume, settings/preferences, models, usage, github installations + repos,
  background agents + runs, transcribe, shares). Spec hygiene in the same workstream: hoist
  shared shapes into `components.schemas` with `$ref`; strip `additionalProperties: false`
  where it breaks Swift codegen; add `format: date-time` to timestamp fields; replace the three
  `additionalProperties: {}` untyped mutation responses (commit / open-PR / merge results) with
  real shapes; declare `securitySchemes` (bearer); document a 401 on every operation (already
  test-enforced). Every change keeps `bun run --cwd apps/web openapi:check` (i.e.
  `apps/web/scripts/check-openapi.ts`) green and regenerates `apps/web/openapi.json` +
  `apps/web/lib/api/openapi-types.ts` in the same PR.

### M1 — iOS foundation (no user-visible features)

- `ios/` scaffold: `ios/App` (XcodeGen `project.yml` + thin app target), `ios/Packages/*` local
  SPM packages per `03-architecture.md` (at minimum `OpenAgentsAPI`, `OpenAgentsCore`,
  `OpenAgentsUI`).
- `ios/Packages/OpenAgentsAPI`: swift-openapi-generator 1.12.2 run **offline** against the
  committed `apps/web/openapi.json`; generated sources checked in; regeneration script + CI
  drift check.
- Formatting gate for Swift (swiftformat + swiftlint, pinned, wrapped by the single gate
  script `ios/scripts/ci.sh`); confirm web tooling (`ultracite`, `turbo`, `scripts/test-isolated.ts`
  glob) ignores `ios/` and the iOS gate ignores TS.
- `.github/workflows/ios-ci.yml` on `macos-26`, path-filtered to `ios/**` and
  `apps/web/openapi.json`; advisory at first (see §11.5).
- Exit test for T6: an iOS-only commit leaves `bun --bun run ci` green; a spec change without
  client regeneration turns `ios-ci` red.

### M2 — Auth + app shell

- `ASWebAuthenticationSession` sign-in (Vercel OAuth via better-auth, deep-link return on
  `openagents://`), bearer token captured from `set-auth-token`, stored in Keychain, injected by
  the `ClientMiddleware`, rotation handled transparently.
- Sign out (revokes server session), signed-out states, deep-link "sign in to view this" with
  destination preserved (web UX lesson B12 — no silent bounce).
- App shell: `TabView` root + per-tab `NavigationStack`; `NavigationSplitView` on iPad.
- Protected path: "sign-in survives app relaunch (Keychain) and token rotation".

### M3 — Read-only core (inbox + transcripts + cache)

- Session inbox from `GET /api/sessions` (`SessionWithUnread` shape: unread/streaming
  indicators, PR status icons, Active/Archive, repo grouping), rename, archive/unarchive.
- Chat transcript rendering from persisted messages
  (`GET /api/sessions/[sessionId]/chats/[chatId]` → `WebAgentUIMessage[]`): text, reasoning,
  tool parts, `data-commit` / `data-pr` / `data-snippet` / `data-workspace-status` parts,
  cost/duration/model badges.
- GRDB cache: sessions, chats, messages; cold launch renders from cache then refreshes (U2).
- Read receipts (`POST …/chats/[chatId]/read`).

### M4 — Live streaming engine

- SSE client (`URLSession.bytes(for:)` → line parser → `AsyncThrowingStream` of decoded
  chunks), the message-reconstruction reducer, and resume: on foreground, probe
  `GET /api/chat/[chatId]/stream`; on 200 rebuild the in-flight message **from scratch**
  (replay-from-chunk-0 semantics); on 204 refetch persisted messages. Full spec in
  `05-streaming-chat-engine.md`.
- Run-watching UI: streaming text, collapsible tool cards with pending → success/error states,
  tool-call summary bar, elapsed timer from the first second (web UX lesson B8), stop button
  (`POST /api/chat` stop path — disconnect alone does not stop the durable workflow).
- Protected path: "a user can open a streaming chat, background the app, return, and watch the
  same run continue with no duplicated or lost content" (U4).

### M5 — Interaction (composer + approvals)

- Composer: text, send, attachments (image picker + paste), voice dictation, slash-command and
  `@`-file affordances where cheap. Do **not** reproduce the web's 7-control toolbar (web issue
  #221); model/tools/runtime fold into a settings sheet.
- `AskUserQuestion` inline answer UI (composer morphs; answer auto-continues the run) and
  edit-approval Approve/Deny on tool cards (U5).
- Per-chat model switcher (curated list first — web UX lesson B17 — full list behind search);
  new chat in an existing session; session creation via repo picker + branch picker (the full
  create flow with auto-commit/PR overrides stays minimal; advanced options link to web).

### M6 — Ship code (diff + git + PR)

- Unified diff viewer with per-file +/- counts, staged badges; cached-diff offline fallback
  with amber stale banner and Resume CTA (U7); diff scope toggle (uncommitted vs branch).
- Commit & Push (optional message + AI-generate), base-branch guard ("On base branch — create a
  new branch first"), branch-safety copy (web UX lesson B10).
- PR: create (AI title/body, draft option), status header, checks list with readiness polling,
  merge panel (squash/merge/rebase, delete-branch toggle), Squash & Archive, close & archive,
  "Fix errors"/"Fix conflicts" hand-back-to-agent actions.
- Sandbox lifecycle as a first-class status surface: provisioning/active/hibernated/restoring
  badges, one-tap resume (`PUT /api/sandbox/snapshot` path), disabled-with-reason everywhere.

### M7 — Monitoring & secondary surfaces

- Background-run monitoring: run list + `/background-runs/[runId]`-equivalent detail (proof
  grid, polled timeline, outputs with Open links, debug IDs) — the single best mobile-fit
  read surface in the product; agent enable/disable toggles (no authoring).
- Share links: create/copy/revoke per chat; read `/shared/[shareId]` in-app via universal link,
  signed-out capable; markdown export to the share sheet.
- Settings subset: default model, diff default, auto-commit/auto-PR toggles, alerts; account
  screen (profile, sign out, delete account).
- Usage glances (`GET /api/usage` aggregates).
- In-app completion alerts via foreground polling (the `alertsEnabled` preference); APNs is
  post-1.0 (§4).

### M8 — Release readiness + App Store (last)

- Observability hardening per `07-observability.md` (OSLog subsystems, MetricKit/crash
  pipeline, redaction audit: no tokens/prompt content in OSLog).
- TestFlight beta (internal → external) from CI; beta exit = U1–U9 verified and crash-free ≥
  99.5%.
- App Store submission prep: Sign in with Apple live (4.8), in-app account deletion (5.1.1(v)),
  privacy nutrition labels, App Privacy report, screenshots, review notes with a demo account,
  universal-links AASA file served by `apps/web`.
- Submission, review-rejection triage loop, 1.0 release. Full pipeline in `08-ci-cd-release.md`.

## 9. Top 10 risks and mitigations

| # | Risk | Concrete mitigation |
|---|---|---|
| 1 | **Native auth is new server surface.** better-auth 1.6.5 runs cookie-only today (no plugins enabled); the bearer plugin, deep-link handoff, and Sign in with Apple are all net-new and sit on the highest-risk path (auth). | M0 lands them as separate web PRs with contract tests (401 matrix, token rotation round-trip) before any Swift depends on them; dev/preview testing uses the existing test-auth path (`OPEN_AGENTS_ENABLE_TEST_AUTH=1` + `open_agents_test_user_id` cookie) so iOS integration tests never need live OAuth; `04-auth.md` defines a fallback (cookie-session capture from `ASWebAuthenticationSession`) if bearer rotation misbehaves. |
| 2 | **iOS is the OpenAPI contract's first real consumer.** 6 of ~118 paths covered, zero web consumers, three untyped mutation responses — contract bugs are guaranteed. | Contract expansion is M0, not an afterthought; every added path ships with a runtime contract test in `apps/web/tests/contract/` (`bun run test:contract`); the three untyped responses are tightened before codegen; both drift gates (T2) make spec/client divergence a CI failure, not a runtime surprise. |
| 3 | **The chat stream is not OpenAPI-expressible.** The hand-built Swift SSE decoder must match the `ai@6.0.168` chunk vocabulary exactly, including v6 additions (`tool-approval-request`, `tool-output-denied`, `abort`, `message-metadata`). | `05-streaming-chat-engine.md` enumerates every chunk type with recorded fixtures captured from the real server; parameterized Swift Testing decode tests per type; unknown-chunk tolerance is a hard requirement; a fixture-refresh script re-records against the dev deployment so server `ai` upgrades surface as fixture diffs. |
| 4 | **Resume-replay semantics × iOS backgrounding.** Resume replays from chunk 0; naive append duplicates content; backgrounding makes this the *common* case. | The reducer rebuilds the in-flight message from scratch on every resume (never appends across reconnects); 204 → refetch persisted messages; U4 is a named protected path with a deterministic regression test using replay fixtures; manual smoke on every milestone exit. |
| 5 | **Minimum iOS 26.0 shrinks the install base.** Users on iOS 18/25-era devices cannot install. | Accepted consciously (decision log §10.6): the audience is developers (fast OS adopters) and the floor buys Liquid Glass + Swift 6.2 defaults with zero compatibility code. Mitigation: App Store Connect OS-version analytics reviewed at TestFlight beta; *lowering* a deployment target later is cheap, raising it is a breaking change — so starting high is the reversible direction. |
| 6 | **App Store review rejection.** Guideline 4.8 (third-party login requires an equivalent privacy-preserving option) and 5.1.1(v) (account deletion in-app) are hard gates; agent-generated code/content may draw reviewer questions. | Sign in with Apple and account deletion are scheduled in M0/M8 as explicit slices, not bolt-ons; `08-ci-cd-release.md` carries a pre-submission checklist (4.8, 5.1.1(v), privacy labels, demo account with seeded data, review notes explaining the developer-tool use case); first submission targets a buffer of ≥ 2 review round-trips before any announced date. |
| 7 | **macOS CI is slow, expensive, and signing is fragile.** `macos-26` runners cost 10× Linux minutes; certificate/profile management breaks pipelines. | Path-filtered workflow (only `ios/**` + `apps/web/openapi.json` trigger it); simulator-only unprovisioned builds for PR CI (no signing); signing exists only in the TestFlight lane using App Store Connect API keys stored as GitHub secrets; Xcode version pinned in one place; the gate stays advisory until M1 proves runtime/cost, then becomes required (§11.5). |
| 8 | **Shipped binaries freeze the API.** An app version in the field is the analog of an old deployment that can never be rolled forward; careless web refactors break it. | T8: additive-only policy for spec-covered paths, enforced by keeping the previous release's contract fixtures running in web CI; lenient decoding on the client (unknown enum cases, optional new fields) per research brief `07-data-model.md`; server-side kill-switch convention (minimum-supported-app-version response) defined in `02-api-contract-and-networking.md` as the honest "rollback lever" since App Store rollback is fix-forward only. |
| 9 | **Monorepo tooling collision.** Web CI globs (`scripts/test-isolated.ts` runs every `**/*.test.ts`), `ultracite`, and `turbo` could choke on `ios/`, or iOS churn could slow web CI. | M1 exit test (T6) proves both directions: iOS-only commit → web CI green and unaffected; explicit ignore entries for `ios/` in `.oxlintrc.json`/turbo config where needed; iOS workflow path-filtered so web-only commits never spin a Mac runner. |
| 10 | **Sandbox hibernation makes the happy path stale.** Sandboxes hibernate after ~30 min idle; a phone user almost always returns to a paused sandbox, where naive UI shows errors or blanks. | Repo-wide iOS rule (from web UX lesson B14): every sandbox-dependent surface has a cached rendering + stale banner + one-tap Resume CTA; GRDB caches transcripts, diffs, and inbox; "Sandbox not initialized"-class errors are mapped to a designed state, never a raw error string; U7 is a named protected path. |

## 10. Decision log

Each entry: the decision (canonical, settled), the rejected alternative, and the rationale.
Implementers cite these instead of re-litigating.

### 10.1 SwiftUI-only — rejected: UIKit (or UIKit-hosted hybrid)

SwiftUI on iOS 26 covers every surface this app needs — streaming lists, navigation stacks and
split views, sheets, context menus — and is the only first-class path to Liquid Glass
(`glassEffect`, automatic chrome adoption). The app's hardest rendering problem (high-frequency
token streaming) is solved by `@Observable`-granular invalidation and isolating hot streaming
state in dedicated models, not by dropping to UIKit. A UIKit or hybrid codebase would double
the design-system surface, exclude most of the iOS 26 design language for free, and add a
skills/testing split (XCUITest + view-controller tests) for no measurable gain. The escape
hatch (`UIViewRepresentable`) remains available for any single component that proves
SwiftUI-hostile (none is anticipated; text rendering of large diffs is the watch item).

### 10.2 @Observable MVVM — rejected: TCA (The Composable Architecture)

TCA offers exhaustive testability and strict unidirectional flow, but at the price of a large
third-party dependency on the app's entire skeleton, a steep onboarding tax for every future
contributor (including weak AI implementers, who handle vanilla MVVM far more reliably than
reducer/dependency macros), slower compile times, and friction against Swift 6.2's
"main-actor-by-default" direction that Apple is optimizing for. The Observation framework plus
plain `@Observable` view models, typed router enums per `NavigationStack`, and environment-based
dependency injection delivers the same separation (views render state; models own logic;
side-effects behind protocol clients) with zero dependencies and idiomatic-Apple ergonomics.
The discipline TCA enforces structurally is enforced here by convention and tests:
`03-architecture.md` defines the model/view/client layering rules, and the streaming reducer —
the one place exhaustive state-machine testing truly matters — is a plain pure function with
parameterized Swift Testing coverage, which is TCA's benefit without TCA.

### 10.3 GRDB — rejected: SwiftData

The cache layer's job is: write API payloads fast (bulk upserts during sync), read them fast
(cold-launch inbox render), migrate schemas predictably across app versions, and stay
debuggable (it is a real SQLite file you can open). GRDB 7.x does exactly this with explicit
SQL-backed migrations, value-type records that map 1:1 onto the API's camelCase/ISO-8601
conventions, `ValueObservation` for SwiftUI-friendly reactive reads, and a decade of production
maturity. SwiftData remains schema-migration-fragile across OS releases, couples persistence to
`@Model` reference semantics that fight Swift 6 strict concurrency at the boundaries, and hides
the underlying store behind Core Data machinery that is hostile to the deterministic tests this
repo's process demands (a GRDB test is an in-memory `DatabaseQueue` with zero setup). Offline
cache bugs are mandatory-regression territory (process brief `10-process-rules.md` §C.2);
GRDB's testability is the deciding factor.

### 10.4 Generated OpenAPI client — rejected: hand-rolled networking layer

A hand-rolled client (URLSession + hand-written Codable models) drifts silently: the server
changes a field, the app decodes `nil`, and the bug ships. The whole point of the repo's
contract system (`apps/web/lib/api/openapi-spec.ts` → `openapi.json` → drift gates) is that
clients are *derived* from the contract; swift-openapi-generator 1.12.2 gives compile-time
breakage the moment the committed spec changes, which converts server-side API drift into a red
CI check instead of a field bug report. Hand-rolled code is reserved for exactly the two
surfaces the spec cannot express — the SSE chat stream (`05-streaming-chat-engine.md`) and the
auth handshake (`04-auth.md`) — and even those reuse the generated types where shapes overlap.
The cost (generator quirks, the M0 spec-hygiene work to make output ergonomic) is paid once and
benefits every future client.

### 10.5 Checked-in generated code — rejected: build-time generation (Xcode plugin)

The swift-openapi-generator build plugin regenerates on every build, which means: every
contributor's build depends on the generator toolchain, build times grow, Xcode plugin
trust-prompts break automation, and — decisive for this repo — the generated API surface is
invisible in PR diffs. Checking the generated client into `ios/Packages/OpenAgentsAPI` makes
every contract change reviewable line-by-line in the PR that regenerates it, keeps builds fast
and hermetic (CI needs no generator unless the spec changed), and mirrors the repo's existing
precedent exactly: `apps/web/lib/api/openapi-types.ts` is generated, committed, and
drift-gated. The drift check (regenerate in CI, fail on diff) removes the classic staleness
risk of committed codegen.

### 10.6 Minimum deployment iOS 26.0 — rejected: iOS 18.0 floor

An iOS 18 floor would roughly double the compatibility surface: dual design language (Liquid
Glass on 26, legacy material on 18), `if #available` forests, two snapshot-test baselines, and
forfeiting Swift 6.2/Xcode 26 idioms that assume the current SDK. The payoff would be reaching
older devices — but this app's audience is developers already running cloud agents, a
population that tracks current iOS within months, and v1 has zero installed base to protect.
App Store uploads have required the iOS 26 SDK since April 2026 regardless, so the toolchain is
fixed either way; only the *floor* is in question. Starting at 26.0 is also the reversible
choice: lowering a deployment target in a later release is routine, raising one strands users.
Beta-period analytics (risk #5) provide the data to revisit — but the plan builds for 26.0.

### 10.7 Monorepo `ios/` — rejected: separate repository

The app's most important dependency is `apps/web/openapi.json`, and the strongest guarantee in
this plan (T2/T8) is "a server contract change and the regenerated Swift client land in the
same atomic PR, or CI is red." That is only cheap in one repository. A separate repo would need
cross-repo version pinning, a spec-publishing pipeline, and bi-directional CI triggers — pure
overhead at this team size — and would also fork the engineering process (issue templates,
labels, branch protection, `docs/process/*`) that section 11 deliberately reuses. The known
monorepo costs are bounded and mitigated: web tooling ignores `ios/` (risk #9), iOS CI is
path-filtered so Mac runners only spin for iOS changes, and `git sparse-checkout` covers anyone
who never touches Swift.

### 10.8 XcodeGen — rejected: checked-in `.xcodeproj`

A checked-in `project.pbxproj` is an opaque, merge-conflict-prone binary-ish artifact that
weak AI implementers corrupt easily and humans review badly. XcodeGen inverts this: the project
is a declarative, diffable YAML (`ios/App/project.yml`), target/setting changes are reviewable
one-liners, and `xcodegen generate` is a deterministic step in both `ios/scripts/ci.sh` and the
developer bootstrap — the same "generated artifact from committed source" philosophy as the
OpenAPI pipeline. The cost (one extra tool, regenerating after `project.yml` edits) is small
and automatable. Xcode 16+ buildable folders shrink pbxproj churn but do not eliminate
target/setting merge conflicts and still leave settings spread across an unreviewable format;
since nearly all code lives in `ios/Packages/*` SPM packages anyway, the generated project is a
thin shell and XcodeGen's determinism wins.

### Supplementary decisions (recorded for completeness, detailed in sibling docs)

| Decision | Rejected alternative | Where argued |
|---|---|---|
| Bearer tokens (`bearer()` plugin) for API auth | Scraping/persisting better-auth cookies from the web flow | `04-auth.md` |
| Hand-built SSE decoder for `/api/chat` | Pretending the generated client can model the stream | `05-streaming-chat-engine.md` |
| Swift Testing for unit/integration; XCTest only for XCUITest | XCTest everywhere | `06-testing-strategy.md` |
| Foreground polling for alerts in v1 | Building APNs infra into v1 | §4 non-goals; post-1.0 epic |

## 11. Mapping onto the repo process

The iOS workstream follows `docs/process/*` exactly, with the adaptations below (derived from
research brief `10-process-rules.md` §E). All GitHub writes target the fork
`dennisonbertram/fork-open-agents` — verify with `git remote -v` before any write; never
`vercel-labs/open-agents`.

### 11.1 Issues: feature-ticket format

- This plan gets **one epic issue** (label `epic`, title `epic: native iOS app`) with the
  observed epic body convention: `## Vision`, `## Why`, `## Scope`,
  `## Current state to build on / reconcile`, `## Key design questions (to resolve in grooming)`,
  `## Phased plan (proposed)` (one phase per milestone M0–M8, each independently shippable),
  `## Definition of done (epic-level)`, plus a footer linking related issues. The epic links to
  `docs/plans/ios-app/README.md`; this doc set links back to the epic (the "Epic: TBD" lines).
- Every milestone decomposes into **feature-slice issues** using
  `.github/ISSUE_TEMPLATE/feature-slice.yml` — all 16 sections filled, no blanks. Issue bodies
  reference repo files by backticked repo-relative path only (no relative markdown links);
  implementers read paths inside the checkout.
- iOS bugs use `.github/ISSUE_TEMPLATE/bug-regression.yml`; open questions that need
  investigation use `research-spike.yml`.
- The issue templates hardcode `bun --bun run ci` in checklists. Until an iOS template variant
  exists, iOS issues keep those lines and explicitly substitute the iOS gate command
  (`ios/scripts/ci.sh`) in the free-text fields, using the templates' own "or document
  approved/pre-existing failures" escape hatch. A `ios-feature-slice.yml` template variant
  (same 16 sections, iOS commands) is proposed as its own M1 slice.
- Labels: `type:feature` / `type:bug` + `type:regression` / `type:research`, plus the status
  workflow labels (`status:grooming` → `status:ready` → `status:in-progress`).

### 11.2 Behavior-first TDD (Swift translation)

Per `docs/process/behavior-tdd.md`, in order, for every behavior-changing slice:

1. **Name the protected path.** The iOS protected-path vocabulary (extend as needed):
   - sign-in/token rotation survives app relaunch (Keychain);
   - session inbox → open chat → live stream renders and resumes after backgrounding;
   - an `AskUserQuestion` / edit-approval can be answered and the run continues;
   - diff renders for a real session, including the cached-offline state;
   - commit → PR → merge round-trips;
   - settings persist; cached content readable offline; sandbox resume is one tap.
2. **Failing test first.** Unit/contract level: Swift Testing in the owning package
   (`swift test --filter SessionStreamReducerTests` inside `ios/Packages/OpenAgentsCore`, or
   `xcodebuild test -scheme OpenAgents -only-testing:OpenAgentsTests/SessionStreamTests` for
   app-target tests). Behavior level: integration test against `URLProtocol` stubs / recorded
   SSE fixtures; XCUITest only for the thin smoke paths.
3. **Confirm RED**; commit `test(red): TASK-<issue> failing tests for <behavior>`.
4. **Smallest green change**; commit `feat(ios): <description> (#<issue>)` (scope `ios`, or a
   finer scope like `ios-auth`/`ios-stream` once established).
5. **Adjacent suite** = the test target owning the touched package; then the full iOS gate.
6. Deterministic-first proof ladder, translated: pure unit/decoder tests → integration with
   `URLProtocol` stubs and recorded fixtures → local simulator smoke against `bun run web` →
   smoke against the dev deployment (`https://open-agents-env-dev-dennisons-projects.vercel.app`)
   → TestFlight. Live servers are canaries, never the primary regression suite.

### 11.3 Regression discipline

Per `docs/process/regression-discipline.md`: every bug fix ships a test that fails without the
fix and passes with it, in the smallest owning suite. Mandatory-regression categories,
translated to iOS: Keychain/token-handling bugs, stream-resume/duplicate-content bugs,
offline-cache and GRDB-migration bugs, background-refresh/retry bugs, approval/mutation
round-trip bugs. Bugs observed on a device against live servers must be converted to
deterministic tests with recorded fixtures (a device repro is never the only protection).
Durable lessons go to `docs/agents/lessons-learned.md`.

### 11.4 Formatting gate

`docs/process/formatting-gate.md` names the web commands; Ultracite/oxfmt does not parse Swift,
so the iOS tree gets its own gate with identical semantics (red formatter = failing
verification; fix and rerun, or document explicit user-approved deferral):

- `swiftformat --lint ios` and `swiftlint --strict` (both pinned; config files
  `ios/.swiftformat`, `ios/.swiftlint.yml`), wrapped — together with `xcodegen generate`,
  build, unit tests, and the OpenAgentsAPI drift check — into the single command
  `ios/scripts/ci.sh` (the iOS analog of `bun --bun run ci`).
- `git diff --check` stays as-is (language-agnostic) and runs on every slice.
- iOS-only slices: run `ios/scripts/ci.sh` + `git diff --check`; `bun --bun run ci` still
  passes vacuously and is run when cheap. Slices touching shared surfaces (anything under
  `apps/web/`, especially `apps/web/lib/api/openapi-spec.ts` / `apps/web/openapi.json`): run
  **both** gates.

### 11.5 Branch, PR, and CI flow

- Branch `feat/<slug>` from `origin/develop`; one issue per branch; PRs target `develop`;
  promote via release PR `develop` → `main`. Sync by merging `origin/develop` (never rebase
  unless asked). Push and open the PR before calling any slice complete; stage only files
  belonging to the slice.
- PR template (`.github/pull_request_template.md`) filled completely. iOS-specific
  substitutions in the `## Preview / Release Safety` section until the template is amended:
  "Vercel Preview URL" → CI build artifact / TestFlight build number; "Agent Browser Preview
  review" → simulator smoke evidence (named simulator via `xcrun simctl`, screenshots, and
  OSLog excerpts via `xcrun simctl spawn booted log stream --predicate 'subsystem == "com.openagents.ios"'`);
  rollback plan for shipped binaries is honestly "fix-forward + server-side compatibility"
  (risk #8).
- CI: web's required check `lint-and-typecheck` is untouched and still gates every PR. The new
  `.github/workflows/ios-ci.yml` (job name `ios-ci`, `runs-on: macos-26`, path-filtered to
  `ios/**` and `apps/web/openapi.json`) runs `ios/scripts/ci.sh`. It starts **advisory**; at M1
  exit, branch protection is updated to add `ios-ci` as a second required check (note: pushing
  workflow files requires `gh auth refresh -s workflow` first).
- Deploy-lane analogy (release runbook translation): per-PR CI simulator build = "preview";
  `develop` merge → TestFlight internal build = "shared dev"; release PR to `main` →
  TestFlight external / App Store = "production". Each records build number + commit SHA +
  smoke result. Details in `08-ci-cd-release.md`.

### 11.6 Observability discipline

Per `docs/process/observability-discipline.md`, mapped to the client (full spec in
`07-observability.md`): OSLog subsystem `com.openagents.ios` with per-module categories as the
"named service"; structured events with stable names, levels, and correlation fields echoed
from API responses (`requestId`, `sessionId`, `chatId`, `workflowRunId`); typed error kinds at
the `APIClient` boundary; redaction rules extended to device logs (never log bearer tokens,
prompt content, or repo file contents — sysdiagnose captures OSLog); debug recipes as
`log show --predicate` one-liners; simulator screenshots as UI evidence. Every feature-slice
issue's `Observability and user feedback` section uses these primitives.

### 11.7 Deploy/migration impact vocabulary (additions for iOS issues)

iOS issues add these impact axes to the `Deploy or migration impact` section: App Store review
risk; OS/Xcode floor changes; provisioning/entitlement changes (Associated Domains, Sign in
with Apple, push later); OAuth redirect/universal-link registration (the Vercel OAuth app and
`apps/web` AASA file must register exact callbacks); and **API backward-compatibility window**
— any web-side change to a spec-covered path must state its effect on shipped app binaries.

---

## Reading map

| You are about to… | Read |
|---|---|
| Understand what to build and for whom | This doc, then `01-product-and-ux.md` |
| Expand the server contract / generate the client | `02-api-contract-and-networking.md` (+ research `08`, `21`) |
| Lay out packages, models, navigation | `03-architecture.md` (+ research `20`, `07`) |
| Implement sign-in / tokens | `04-auth.md` (+ research `06`, `23`) |
| Implement the chat stream | `05-streaming-chat-engine.md` (+ research `01`, `22`) |
| Write or review tests | `06-testing-strategy.md` (+ research `24`) |
| Add logging/telemetry | `07-observability.md` (+ research `25`) |
| Touch CI, signing, TestFlight, App Store | `08-ci-cd-release.md` (+ research `24`) |
| Execute the build end-to-end | `09-step-by-step-build-guide.md` |
