# iOS App Build Plan — Index

Epic: TBD

Plan for a native Swift iOS app (iPhone + iPad) that is a first-class client of the `apps/web`
API. The app will live at `ios/` in this monorepo (`ios/App` XcodeGen project + app target,
`ios/Packages/*` local SPM packages, including the checked-in generated client
`ios/Packages/OpenAgentsAPI`). The canonical stack and all settled decisions are in
`00-overview.md` §6 and §10 — no other doc re-decides them.

## Plan documents

| Doc | One-line description |
|---|---|
| `00-overview.md` | Epic overview: vision, goals/non-goals, success criteria, canonical versions table, milestones M0–M8, top-10 risks, decision log, process mapping. Start here. |
| `01-product-and-ux.md` | Product spec and UX: screens, flows, navigation map, states (empty/loading/error/stale), copy rules, and the web UX lessons treated as requirements. |
| `02-api-contract-and-networking.md` | Server contract-expansion workstream (`apps/web/lib/api/openapi-spec.ts` → `apps/web/openapi.json`), spec hygiene, swift-openapi-generator 1.12.2 setup, drift checks, networking layer. |
| `03-architecture.md` | App architecture: `ios/` layout, XcodeGen `project.yml`, SPM package graph, `@Observable` MVVM rules, GRDB schema/migrations, dependency injection, exact package pins. |
| `04-auth.md` | Auth: better-auth `bearer()` plugin enablement, `ASWebAuthenticationSession` deep-link flow (`openagents://`), Keychain storage, token rotation middleware, Sign in with Apple, account deletion. |
| `05-streaming-chat-engine.md` | The AI SDK v6 UI Message Stream client: SSE parsing, chunk vocabulary, message-reconstruction reducer, resume/replay-from-chunk-0 handling, stop semantics, fixtures. |
| `06-testing-strategy.md` | Testing: Swift Testing unit/integration layers, recorded-fixture strategy, swift-snapshot-testing 1.18.x, thin XCUITest smoke, behavior-first TDD translation for Swift. |
| `07-observability.md` | Client observability: OSLog subsystem/category scheme, structured events with correlation IDs, redaction rules for device logs, crash/MetricKit pipeline, debug recipes. |
| `08-ci-cd-release.md` | CI/CD: `ios/scripts/ci.sh` gate, `.github/workflows/ios-ci.yml` on `macos-26`, signing via App Store Connect API keys, TestFlight lanes, App Store submission checklist. |
| `09-step-by-step-build-guide.md` | The executable build guide: milestone-by-milestone, issue-by-issue steps with exact commands, file paths, and acceptance checks for a weak implementer model. |

## Research briefs (`research/`) — ground truth, read-only

| Brief | One-line description |
|---|---|
| `research/01-api-chat-and-streaming.md` | `/api/chat` + resume endpoints, request/response shapes, stream lifecycle as shipped. |
| `research/02-api-sessions-sandbox-git.md` | Sessions/chats/messages, sandbox lifecycle, files/diff, and git/PR route inventory. |
| `research/03-api-repos-github-vercel.md` | GitHub installations/repos/branches and Vercel project-link API surfaces. |
| `research/04-api-settings-usage-misc.md` | Settings, preferences, models, usage, transcribe, shares, and miscellaneous routes. |
| `research/05-api-background-agents-harness-workflows.md` | Background agents/runs, harness, and workflow API surfaces. |
| `research/06-auth-for-native-clients.md` | better-auth 1.6.5 ground truth and the native-client auth options (bearer, trusted origins, SIWA). |
| `research/07-data-model.md` | All 40 DB tables, canonical client-facing types, serialization conventions (text IDs, ISO-8601, lenient enums). |
| `research/08-openapi-contract-state.md` | The OpenAPI pipeline today: 6 paths, drift gates, contract tests, and what full coverage requires. |
| `research/09-web-ux-inventory.md` | Every web capability with mobile priority, top-20 UX lessons, desktop-ish vs mobile-shining flows. |
| `research/10-process-rules.md` | The repo's engineering process contract and what must be adapted for an iOS sub-project. |
| `research/11-web-client-consumption-patterns.md` | How the web client actually calls the API (polling cadences, optimistic updates, error handling). |
| `research/20-swift-app-architecture.md` | 2026 state-of-the-art SwiftUI architecture research (concurrency, modularization, persistence). |
| `research/21-swift-openapi-generator.md` | swift-openapi-generator capabilities, configuration, and pitfalls. |
| `research/22-swift-sse-and-stream-protocol.md` | The exact `ai@6.0.168` wire protocol and Swift SSE consumption mechanics. |
| `research/23-ios-auth-patterns.md` | `ASWebAuthenticationSession`, Keychain, and token-handling patterns on iOS. |
| `research/24-ios-testing-and-ci.md` | Swift Testing vs XCTest, snapshot testing, GitHub Actions macOS runners, TestFlight delivery. |
| `research/25-ios-observability.md` | OSLog, MetricKit, crash reporting, and client telemetry options. |
| `research/26-design-research.md` | iOS 26 / Liquid Glass design language research and visual direction. |

## Recommended reading order (implementer)

1. `00-overview.md` — vision, canonical stack, milestones, decision log, process rules. Mandatory.
2. `01-product-and-ux.md` — what the screens are and how they must behave.
3. `03-architecture.md` — where code goes and how it is structured.
4. `02-api-contract-and-networking.md` — how the app talks to the server (read before any networking work).
5. `04-auth.md` and `05-streaming-chat-engine.md` — the two hand-built surfaces; read before M2/M4 work respectively.
6. `06-testing-strategy.md` and `07-observability.md` — read before writing the first test or log line.
7. `08-ci-cd-release.md` — read before touching CI or release lanes.
8. `09-step-by-step-build-guide.md` — then execute it, milestone by milestone.

Research briefs are consulted on demand from the cross-references inside each plan doc; do not
start there.
