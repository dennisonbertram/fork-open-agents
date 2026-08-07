# 09 — Step-by-Step Build Guide

Status: planning document. This is the master start-to-finish execution path for the native
iOS app: milestones, PR-sized issues, and a concrete verification checkpoint after every
milestone. The per-issue scope text is the durable record in
`docs/plans/ios-app/issues/manifest.json`; this guide is how you walk it. Every step must be
executable by a weak AI coding model with no unstated assumptions — ambiguity here is a
defect; fix the guide in the PR that discovers it.

Numbering note: `00-overview.md` §8 sketches coarse milestones M0–M8; this guide and the
issue tree use the finer-grained M0–M13 structure (same work, sliced for PR-sized issues).
On grouping, this guide wins; on technology choices, `00-overview.md` §6/§10 always wins.

Reading order before executing anything: `00-overview.md` (mandatory), then the sibling doc
named in each milestone below, then this guide's milestone section.

---

## 1. Prerequisites — exact machine setup

Complete every item in this section before starting M0. Items marked (iOS) are not needed
until M2; items marked (release) are not needed until M13.

### 1.1 Machine

- Apple silicon Mac (arm64 — matches the `macos-26` CI runners, which matters for snapshot
  baselines).
- macOS 26 (Tahoe) or newer — required to run Xcode 26.x.
- At least 60 GB free disk (Xcode + simulators + SPM caches).

### 1.2 Repo bootstrap (server work — needed for M0)

```bash
# 1. Install Bun (the repo uses Bun exclusively; it installs to ~/.bun/bin)
curl -fsSL https://bun.sh/install | bash
exec $SHELL && bun --version

# 2. Clone the fork (never vercel-labs upstream) and bootstrap
git clone git@github.com:dennisonbertram/fork-open-agents.git open-agents
cd open-agents && ./init.sh     # installs dependencies, sets up env scaffolding

# 3. Helper tools used throughout this guide
brew install jq gh && gh auth login
git remote -v                   # MUST show dennisonbertram/fork-open-agents, not vercel-labs
```

### 1.3 Working local `apps/web` (needed for every integration step)

```bash
# 1. Env: apps/web/.env.local needs at minimum POSTGRES_URL and BETTER_AUTH_SECRET
#    (keys from apps/web/.env.example; values from the operator/Vercel env pull).
bun run --cwd apps/web db:migrate:apply             # 2. apply migrations
bun run web                                         # 3. serves http://localhost:3000
# 4. Health checks (separate terminal):
curl -I http://localhost:3000                       # HTTP 200/307
curl http://localhost:3000/api/auth/info            # JSON (401 envelope is fine signed out)
```

Local test auth (no OAuth required; used for fixture capture and the iOS DEBUG path):
`apps/web/lib/session/test-auth.ts` is active when `NODE_ENV === "development"` or
`OPEN_AGENTS_ENABLE_TEST_AUTH === "1"`. Seed the demo user once, then authenticate any
request with a static cookie:

```bash
curl http://localhost:3000/api/dev/managed-runtime-demo     # seeds the test user
COOKIE="open_agents_test_user_id=dev-managed-runtime-user"
curl -s -H "cookie: $COOKIE" http://localhost:3000/api/sessions | jq .
```

If port 3000 is taken, set an explicit `PORT` and substitute it in every `BASE` below.

### 1.4 Xcode 26.x and simulators (iOS — needed from M2)

```bash
# Option A (preferred — pinnable): xcodes CLI. Option B: Mac App Store (verify 26.x).
brew install xcodesorg/made/xcodes
xcodes install 26.0             # exact version per OA_XCODE_VERSION in ios/Scripts/env.sh
sudo xcode-select -s /Applications/Xcode_26.0.app   # match OA_XCODE_APP in ios/Scripts/env.sh
sudo xcodebuild -license accept && xcodebuild -runFirstLaunch
xcodebuild -version             # must print Xcode 26.0

# Simulator runtime + the two pinned devices
xcodebuild -downloadPlatform iOS -buildVersion 26.0
xcrun simctl list devices available | grep -E "iPhone 17 Pro|iPad Pro 13"
```

The single source of truth for the Xcode/simulator/XcodeGen pins is `ios/Scripts/env.sh`
(created in M2-01/M2-03); once it exists, never hardcode versions — source that file.
XcodeGen 2.45.4 is installed automatically by `ios/Scripts/install-xcodegen.sh` into
`ios/.tools/`. Do not `brew install xcodegen` — Homebrew floats versions.

### 1.5 Apple Developer / App Store Connect (release — staged)

| Needed at | Item |
|---|---|
| M0-02 | Apple Developer account; App ID with Sign in with Apple capability; a `.p8` Sign in with Apple key (Key ID + Team ID) for `apps/web/scripts/generate-apple-client-secret.ts` |
| M13-01 | App ID `com.openagents.app` registered; ASC app record created (note numeric `ASC_APP_ID`); ASC API team key (role App Manager, certificates/profiles access); TestFlight internal group `OpenAgents Internal` (auto-distribute) and external group `OpenAgents Beta` (note `ASC_EXTERNAL_GROUP_ID`); GitHub secrets/variables per `08-ci-cd-release.md` §14 |

Nothing before M0-02 requires an Apple Developer account.

---

## 2. Conventions recap — the per-issue loop

These rules come from `00-overview.md` §11 and `docs/process/*`. Every issue in §3 follows
this exact loop.

### 2.1 Branch and PR flow

```bash
git fetch origin develop
git checkout -b feat/<issue-slug> origin/develop   # one issue per branch
# ... work ...
git push -u origin feat/<issue-slug>
gh pr create --base develop --fill                 # PR into develop, never main directly
```

- Sync by merging `origin/develop` (never rebase unless asked). All GitHub writes target
  `dennisonbertram/fork-open-agents` — verify with `git remote -v`; never write to
  `vercel-labs/open-agents`. Quote bracketed paths in git commands
  (`git add "apps/web/app/tasks/[id]/page.tsx"`).

### 2.2 Red-first TDD (every behavior-changing issue)

1. Name the protected path (each issue's scope text names it).
2. Write the failing test first, in the smallest owning suite.
3. Confirm RED; commit `test(red): TASK-<issue> failing tests for <behavior>`.
4. Smallest green change; commit `feat(ios): <description> (#<issue>)` (or `feat(api):` /
   `feat(auth):` for web-side work).
5. Run the adjacent suite, then the full gate(s) below.

### 2.3 Gates (what "done" requires, per touched tree)

| Touched | Required gate |
|---|---|
| `apps/web/**` (or anything outside `ios/`) | `bun --bun run ci` |
| `ios/**` | `./ios/Scripts/ci.sh` (lint → generate project → unit/snapshot tests → API drift → `git diff --check`) |
| Both trees (e.g. a contract batch + client regen) | Both gates |
| Always | `git diff --check` |

Until M2-03 lands `ios/Scripts/ci.sh`, iOS issues run the explicit commands listed in their
milestone checkpoint instead.

### 2.4 OpenAPI contract rules (binding from M1 onward)

- Never hand-edit `apps/web/openapi.json`; all changes go through `buildOpenApiDocument()`
  in `apps/web/lib/api/openapi-spec.ts`.
- Every spec PR regenerates both committed artifacts (`bun run --cwd apps/web
  openapi:generate` and `openapi:types`), verified by `bun run --cwd apps/web openapi:check`.
- After any spec change lands, regenerate the iOS client with
  `./ios/Scripts/generate-api.sh` and commit the diff (`ios-api-drift` blocks otherwise).

### 2.5 Per-issue definition of done

- [ ] Issue exists on the fork using `.github/ISSUE_TEMPLATE/feature-slice.yml` (or
      `ios-feature-slice.yml` once M2-03 lands), all sections filled.
- [ ] Red commit verifiably red in history; protected-path test green; adjacent suite green.
- [ ] Required gate(s) from §2.3 green; `git diff --check` clean.
- [ ] Observability evidence attached where the issue demands it (curl headers, simulator
      screenshots, `log stream` excerpts).
- [ ] PR opened into `develop`, only the issue's files staged, with a summary of what
      changed and what was verified.

---

## 3. Milestone-by-milestone walkthrough

Execute milestones strictly in order. Within a milestone, respect each issue's `dependsOn`
(listed in `docs/plans/ios-app/issues/manifest.json`); issues without mutual dependencies
may be parallelized. Do not start a milestone until the previous milestone's verification
checkpoint passes.

---

### M0 — Server enablers: native auth

**Why it exists:** Make `apps/web` a bearer-token multi-client auth platform — bearer/OTT
plugins, deep-link handoff routes, Sign in with Apple, native sign-out, and in-app account
deletion — landed as red-first web PRs into `develop` before any Swift work depends on
them. Spec: `04-auth.md`.

**Issues, in order:**

1. **M0-01 — Enable better-auth bearer + one-time-token plugins with native deep-link
   handoff routes** — `04-auth.md` §3.8 tests red-first, then the plugins + `trustedOrigins`
   in `apps/web/lib/auth/config.ts` and the `complete`/`bridge` routes under
   `apps/web/app/api/native-auth/`.
2. **M0-02 — Sign in with Apple provider (App Store guideline 4.8)** — Add the `apple`
   social provider, profile mapper, trusted-provider linking, the client-secret script, and
   the `APPLE_*` env vars in `apps/web/.env.example`.
3. **M0-03 — Native sign-out route and in-app account deletion (guideline 5.1.1(v))** —
   Extract `revoke-vercel-token.ts`, add the bearer-authenticated sign-out route, and enable
   `user.deleteUser` with a `beforeDelete` revocation hook, §3.8 tests 4–5 first.

**VERIFICATION CHECKPOINT — M0.** You should now be able to authenticate every
session-gated API, including SSE, with only an `Authorization: Bearer` header and no
cookies, then sign out and delete the account natively.

```bash
# 1. Server test suites green
bun test apps/web/lib/session/bearer-session.test.ts
bun test apps/web/app/api/native-auth
bun test apps/web/app/api/auth/delete-user.test.ts
bun --bun run ci
# 2. Manual bearer round trip against local web (bun run web running; test user seeded per §1.3)
BASE=http://localhost:3000
COOKIE="open_agents_test_user_id=dev-managed-runtime-user"
curl -s -D - -o /dev/null -H "cookie: $COOKIE" "$BASE/api/native-auth/complete"
#   expect: HTTP/1.1 303 with "location: openagents://auth?ott=<token>"
OTT="<paste the ott value from the location header>"
curl -s -D /tmp/verify-headers.txt -X POST "$BASE/api/auth/one-time-token/verify" \
  -H "content-type: application/json" -d "{\"token\":\"$OTT\"}" | jq .
grep -i '^set-auth-token:' /tmp/verify-headers.txt        # MUST be present
TOKEN="$(grep -i '^set-auth-token:' /tmp/verify-headers.txt | cut -d' ' -f2 | tr -d '\r')"
curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/auth/info" | jq .user.id   # 200, user id
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/auth/one-time-token/verify" \
  -H "content-type: application/json" -d "{\"token\":\"$OTT\"}"   # 400 — OTT is single-use
# 3. SSE bearer proof (create a session+chat first via the cookie path, §1.3)
curl -sN -D - -H "authorization: Bearer $TOKEN" "$BASE/api/chat/<chatId>/stream" | head -5
#   expect: 200 with "x-vercel-ai-ui-message-stream: v1" (or 204 when nothing is streaming)
# 4. Native sign-out kills the session
curl -s -X POST -H "authorization: Bearer $TOKEN" "$BASE/api/native-auth/sign-out" | jq .
curl -s -o /dev/null -w "%{http_code}\n" -H "authorization: Bearer $TOKEN" "$BASE/api/auth/info"  # 401
```

Web cookie sign-in must still work (confirm the normal browser flow at
`http://localhost:3000`). Do not proceed to M1-06/M4 until this checkpoint passes.

---

### M1 — Server enablers: OpenAPI contract expansion

**Why it exists:** Grow `apps/web/openapi.json` from 6 paths / 10 operations to the full
iOS-consumed surface with Swift-codegen-safe hygiene, one PR-sized batch at a time, keeping
`openapi:check`, the spec unit test, and `bun --bun run ci` green and regenerating both
committed artifacts in every PR. Spec: `02-api-contract-and-networking.md` §2.

**Issues, in order (B–F all depend on A and are parallelizable after it):**

1. **M1-01 — Batch A — OpenAPI spec hygiene for Swift codegen** — Implement all five
   codegen blockers inside `buildOpenApiDocument()` (strip `additionalProperties: false`,
   schema registry + `$ref`s, `securitySchemes`, `z.iso.datetime()`, real mutation shapes).
2. **M1-02 — Batch B — sessions and chats paths** — Add the 17 sessions/chats operations
   with extracted `http-schemas.ts` Zod schemas and contract tests in
   `apps/web/tests/contract/`.
3. **M1-03 — Batch C — sandbox lifecycle paths** — Add the 9 sandbox operations, documenting
   epoch-ms lifecycle fields and the 409 sandbox-unavailable envelope.
4. **M1-04 — Batch D — files, diff, and remaining git paths** — Add the 12 files/diff/git
   operations, reusing `apps/web/lib/git/http-schemas.ts`.
5. **M1-05 — Batch E — settings, models, usage, transcribe, and title paths** — Add the 35
   settings/models/usage/misc operations; `/api/models` joins the public allowlist.
6. **M1-06 — Batch F — GitHub, repos, Vercel, background agents, shares, and auth-info
   paths** — Add the 21 Batch-F operations plus `/api/auth/info` and the
   `/api/native-auth/*` routes from M0.
7. **M1-07 — BotID native-client exemption and usage_events.source 'ios'** — Make
   bearer-authenticated traffic pass `checkBotProtection()` on the gated routes, and add the
   Drizzle migration extending `usage_events.source` with `"ios"`.

**VERIFICATION CHECKPOINT — M1.** You should now be able to regenerate a clean,
Swift-codegen-safe spec covering every generated-client endpoint the iOS app consumes.

```bash
# 1. Drift gates and hygiene invariants
bun run --cwd apps/web openapi:check                      # "✓ openapi.json is in sync"
bun test apps/web/lib/api/openapi-spec.test.ts
grep -c '"additionalProperties": false' apps/web/openapi.json    # MUST print 0
# 2. Coverage counts (6 paths / 10 operations before M1)
jq '.paths | length' apps/web/openapi.json                # ≥ 60
jq '[.paths[] | with_entries(select(.key | IN("get","post","put","patch","delete")))
     | length] | add' apps/web/openapi.json               # ≥ 100 operations
jq '.components.schemas | keys | length' apps/web/openapi.json   # ≥ 40 named schemas
jq '.components.securitySchemes | keys' apps/web/openapi.json    # ["bearerAuth","cookieAuth"]
# 3. Contract tests against the live local server
CONTRACT_BASE_URL=http://localhost:3000 bun run test:contract
# 4. BotID + attribution (M1-07), then the full web gate
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/chat" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"sessionId":"<id>","chatId":"<id>","messages":[]}'
#   expect: any status EXCEPT 403 bot-protection (400 validation is fine)
ls apps/web/lib/db/migrations | tail -3   # the usage_events source migration .sql is committed
bun --bun run ci
```

---

### M2 — iOS foundation: scaffold, codegen, CI

**Why it exists:** Stand up the `ios/` tree: XcodeGen project plus the 16-package skeleton,
the checked-in generated OpenAPI client with drift scripts, the swift-format gate and
one-command iOS CI script, the path-filtered GitHub Actions gate, and the shared
test-support package — with the monorepo isolation exit test green in both directions.
Specs: `03-architecture.md`, `08-ci-cd-release.md`, `06-testing-strategy.md`.

**Issues, in order:**

1. **M2-01 — ios/ scaffold: XcodeGen project, app target, and 16-package skeleton** —
   Create `ios/App/project.yml`, `OpenAgentsApp.swift`, `ios/.gitignore`, the generate
   script, and all 16 packages from the two `Package.swift` templates, each compiling.
2. **M2-02 — OpenAgentsAPI generated client package with drift scripts** — Vendor the spec,
   write the generator config excluding the four hand-rolled chat operations, commit the
   generated sources at pin 1.12.2, land `generate-api.sh` + `check-api-drift.sh`.
3. **M2-03 — Formatting gate, ios CI workflow, and monorepo isolation exit test** — Land
   `ios/.swift-format`, the `ios/Scripts/*` toolchain scripts, `ios/Scripts/ci.sh`,
   `.github/workflows/ios-ci.yml` (`changes`/`ios-build-test`/`ios-api-drift`/`ios-gate`),
   the `ios-feature-slice.yml` template, and `docs/process/ios-gate.md`; prove T6 both ways.
4. **M2-04 — OpenAgentsTestSupport package and test plans** — Build `StubURLProtocol` with
   chunked SSE delivery, run the chunk-boundary spike test, add tag/fixture/GRDB/clock
   helpers, and define the `UnitTests` + `UISmoke` test plans in `ios/App/project.yml`.

**VERIFICATION CHECKPOINT — M2.** You should now be able to clone, generate, build, and gate
the iOS tree with one command, and CI blocks contract drift in both directions.

```bash
# 1. Clean-machine bootstrap path
./ios/Scripts/generate-project.sh          # installs pinned XcodeGen, generates the project
xcodebuild build -project ios/App/OpenAgents.xcodeproj -scheme OpenAgents \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0' \
  -clonedSourcePackagesDirPath ios/.spm -disableAutomaticPackageResolution   # zero warnings
# repeat with -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M4),OS=26.0'
# 2. Every package compiles standalone
for pkg in ios/Packages/*/; do swift build --package-path "$pkg" || exit 1; done
# 3. Drift gate: green when in sync, red when not (P10)
./ios/Scripts/check-api-drift.sh           # "✓ ios/Packages/OpenAgentsAPI is in sync ..."
#   Then: trivially change apps/web/lib/api/openapi-spec.ts (e.g. info.description), run
#   `bun run --cwd apps/web openapi:generate`, re-run check-api-drift.sh → MUST exit 1. Revert.
# 4. The one-command gate
./ios/Scripts/ci.sh                        # "✓ iOS gate passed"
# 5. Monorepo isolation, both directions (T6)
bun --bun run ci                           # web gate green and unaffected by ios/
#   PR proof A: trivial iOS-only PR → `lint-and-typecheck` green, `ios-gate` passes.
#   PR proof B: spec-change-without-regeneration PR → `ios-api-drift` red, PR blocked.
gh pr checks <pr-number>                   # inspect the statuses on both proof PRs
# 6. Chunk-boundary spike (M2-04) recorded
swift test --package-path ios/Packages/OpenAgentsTestSupport --filter ChunkBoundary
```

One-time operator step after exit: promote `ios-gate` to a required check on `develop` and
`main` per `08-ci-cd-release.md` §4.

---

### M3 — Networking layer and typed facades

**Why it exists:** A middleware-driven API client with one error taxonomy, class-based
timeout/retry policy, environment switching, and `OpenAgentsCore` domain models plus
facades covering every generated-client endpoint a v1 screen consumes. Spec:
`docs/plans/ios-app/02-api-contract-and-networking.md` §4, `03-architecture.md` §3.

**Issues, in order:**

1. **M3-01 — APIClient networking core: sessions, middleware chain, errors, environments,
   RawHTTPClient** — Build the two URLSessions, the fixed middleware order
   (RequestID → Auth → EnvironmentHeaders → Logging → Retry), the single `APIError`
   taxonomy, per-class retry/backoff, `AppEnvironment`, and `RawHTTPClient`.
2. **M3-02 — Domain models + facades: sessions, chats, sandbox, files, diff, git** — Define
   the wire-named `OpenAgentsCore` models and typed facades for batches B–D; regenerate the
   client; fixture-decode every shape through `StubURLProtocol`.
3. **M3-03 — Domain models + facades: settings, models, usage, GitHub, repos, background
   agents, shares** — Extend models/facades to batches E–F, add `AdaptivePoller` and the
   30 s NSCache dedupe for GitHub lists.

**VERIFICATION CHECKPOINT — M3.** You should now be able to call every v1 endpoint through
a typed facade and prove decoding against recorded fixtures, with generated types contained
inside `APIClient`.

```bash
swift test --package-path ios/Packages/OpenAgentsCore
swift test --package-path ios/Packages/APIClient        # middleware, errors, retries, facades

# Boundary rule: only APIClient imports the generated package
grep -rln '"OpenAgentsAPI"' ios/Packages/*/Package.swift
#   expect exactly: OpenAgentsAPI/Package.swift and APIClient/Package.swift

# Fixture-decode coverage for: sessions list, chats list, sandbox status, diff, git status,
# preferences, models, usage, installations/repos, background-run detail, dashboard
swift test --package-path ios/Packages/APIClient --filter FixtureDecode
./ios/Scripts/ci.sh
```

---

### M4 — iOS auth: sign-in, token custody, lifecycle

**Why it exists:** P1 protected path — sign-in (Vercel OAuth and Sign in with Apple) lands a
bearer token in the Keychain that survives relaunch, rotates transparently, signs out
cleanly, and never appears in a log. Spec: `docs/plans/ios-app/04-auth.md` §6–§12.

**Issues, in order:**

1. **M4-01 — KeychainTokenStore and Vercel OAuth sign-in flow** — The Keychain actor with
   the exact attribute set, the `ASWebAuthenticationSession` flow, callback parsing, the OTT
   verify exchange capturing `set-auth-token`, and the §11 no-token-in-logs grep proof.
2. **M4-02 — Native Sign in with Apple flow** — `AppleSignInCoordinator` with a verbatim
   nonce on request and `idToken` POST, equal-prominence button, silent-cancel handling.
3. **M4-03 — AuthController state machine, bootstrap, 401 handling, sign-out, dev
   test-auth** — The `@Observable` state machine with §7 bootstrap rules, the exactly-once
   401 probe, native sign-out with the GRDB-nuke seam, and the DEBUG local test-auth path.

**VERIFICATION CHECKPOINT — M4.** You should now be able to sign in on a simulator, kill the
app, relaunch, and still be signed in — with zero token material in logs.

```bash
# 1. Unit suites (AuthKit is iOS-only; run via the simulator test plan)
./ios/Scripts/test-unit.sh    # includes CallbackParsing, KeychainTokenStore, AuthMiddleware,
                              # SessionUserInfoDecoding, AuthSessionState tests

# 2. Manual simulator smoke against local web (DEBUG test-auth path; bun run web running):
./ios/Scripts/generate-project.sh
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null || true; open -a Simulator
#   Build & run from Xcode (scheme OpenAgents), pick the DEBUG "Local dev server"
#   environment, sign in via test-auth → sessions surface reachable.
# 3. Relaunch survival (P1)
xcrun simctl terminate booted com.openagents.app
xcrun simctl launch booted com.openagents.app          # opens signed-in, no sign-in wall
# 4. Token-redaction proof (attach to the PR)
xcrun simctl spawn booted log show --last 15m \
  --predicate 'subsystem == "com.openagents.app"' > /tmp/oa-auth-smoke.log
grep -icE 'authorization: Bearer|set-auth-token: [A-Za-z0-9]|ott=[A-Za-z0-9]' /tmp/oa-auth-smoke.log  # 0
grep -rnE '\\(token\)|\\(ott\)|\\(authorization' ios/Packages/AuthKit/Sources   # no interpolations

# 5. Real-OAuth verification (preview deployment, device or simulator): Vercel sign-in via
#    the browser sheet → token in Keychain → GET /api/auth/info OK. Revocation drill:
#    delete the session row server-side → next request 401s → re-auth sheet exactly once.
```

---

### M5 — Design system and app shell

**Why it exists:** Tokens and chrome exist; the app boots into signed-out onboarding or the
four-tab shell with typed routing, deep links, and destination-preserving sign-in gates.
Spec: `docs/plans/ios-app/01-product-and-ux.md` §2–§3 and §8, `03-architecture.md` §8–§10.

**Issues, in order:**

1. **M5-01 — DesignSystem package: tokens, components, contrast tests, snapshots** — The 12
   color sets with WCAG-AA contrast tests, typography/spacing/radius tokens, shared
   components, `DesignSystemGallery` snapshots, and the grep-lint rule in `ios/Scripts/ci.sh`.
2. **M5-02 — AppShell composition root: tabs, typed router, deep links, scene-phase hooks**
   — `AppEnvironment`, `AppRouter` with typed route arrays, the four-tab shell, `DeepLink`
   parsing with exhaustive tests, and scene-phase hooks.
3. **M5-03 — Onboarding screens: Welcome, auth progress, sign-in gate, Connect GitHub** —
   SCR-01/02/03/51 with exact copy, the destination-preserving gate, the connection-status
   GitHub step, and the DEBUG launch-environment seam.

**VERIFICATION CHECKPOINT — M5.** You should now be able to boot into onboarding or the
four-tab shell, and deep links land on the right tab/stack from any app state.

```bash
# 1. Token discipline + snapshots
./ios/Scripts/ci.sh        # incl. grep-lint (no hex / Font.system(size:) / Color(red:)
                           # outside DesignSystem) and the snapshot suites
swift test --package-path ios/Packages/OpenAgentsCore --filter DeepLink   # every §10.6 row

# 2. Manual: signed-out boot shows the Welcome wall (both buttons, equal prominence);
#    signed-in boot shows the four-tab shell.
# 3. Deep-link smoke (custom scheme; universal links become OS-routable at M13-02):
xcrun simctl openurl booted "openagents://auth?error=access_denied"   # AuthKit refuses silently
#    Signed-out preservation: open a session deep link signed-out → SCR-51 gate → sign in →
#    arrival at the original destination (lesson B12).
# 4. Onboarding snapshots exist for SCR-01/02/03/51 in canonical + dark variants.
```

---

### M6 — Read-only core: persistence, inbox, transcripts

**Why it exists:** P2/P9 — a cache-first session inbox, session creation, and
offline-readable transcripts that render every persisted message part type from GRDB before
the network answers. Spec: `03-architecture.md` §9, `01-product-and-ux.md` §4–§5,
`05-streaming-chat-engine.md` §1.6/§6.

**Issues, in order:**

1. **M6-01 — PersistenceKit: GRDB schema v1, caches, nuke, pruning** — Migration v1 (eleven
   tables, exact columns/indexes/FK order), cache APIs with `ValueObservation`, `nuke()`
   wired to `auth.onSignedOut`, the account-mismatch guard, launch pruning.
2. **M6-02 — Sessions inbox (SCR-10) with cache-first rendering and polling** — Repo-grouped
   inbox with the 3 s/30 s poll, status glyphs, optimistic swipe actions, archived
   pagination, GRDB-first cold launch.
3. **M6-03 — New Session flow (SCR-11): repo picker, branch picker, error matrix** — The
   two-mode create flow with searchable repo picker, branch safety, and the full
   validation/429/403/offline error matrix.
4. **M6-04 — Chat history models, GRDB message cache, read receipts** — Byte-identical
   `UIMessage` round-trip models, the snapshot fetch over `RawHTTPClient`, GRDB write points
   preserving outbox rows, read receipts.
5. **M6-05 — Read-only transcript: markdown, code blocks, reasoning, chat shell** — Cached
   transcripts with progressive Markdown, `CodeBlockView`, collapsed reasoning,
   archived/offline banners, snapshots.
6. **M6-06 — Tool rows, data-part chips, and message badges** — 44-pt tool rows with the
   kind-symbol map, group summaries, data chips with pending→resolved states, unknown parts
   as generic chips, footer badges, canonical/dark/ax3 snapshots.

**VERIFICATION CHECKPOINT — M6.** You should now be able to open the app with the server
unreachable and read your inbox and a full transcript from GRDB.

```bash
# 1. Persistence + model suites (host-runnable)
swift test --package-path ios/Packages/PersistenceKit     # schema v1, caches, nuke, pruning
swift test --package-path ios/Packages/OpenAgentsCore --filter UIMessageRoundTrip
./ios/Scripts/ci.sh
# 2. Cache-first manual smoke (local web, seeded sessions): launch signed-in, sync, open a
#    transcript with text + code + reasoning + tool parts; stop the server (Ctrl-C
#    `bun run web`); then:
xcrun simctl terminate booted com.openagents.app && xcrun simctl launch booted com.openagents.app
#   expect: inbox renders instantly from cache with the amber offline banner; the transcript
#   renders every part type; no blank screens (P9).
# 3. Nuke proof (P9): sign out → relaunch → no cached data visible; GRDB rows gone.
# 4. Create flow (P6): restart the server, create a repo-backed session via SCR-11, land in
#    its chat; repo selection survives mode switches (lesson B13).
```

---

### M7 — Streaming chat engine

**Why it exists:** T3/U3/U4 — a deterministic, fixture-proven SSE engine: decode every
`ai@6.0.168` chunk type, reduce to messages off-main, resume by rebuilding from scratch, and
render the live run at 60 fps with zero duplicated or lost content. Spec:
`05-streaming-chat-engine.md` (entire document).

**Issues, in order:**

1. **M7-01 — SSE line parser, lenient chunk decoder, recorded fixture catalog** —
   `parseSSELine`, the 26-shape `UIMessageChunk` union with `.unknown` fallback, and the
   captured/sanitized 14-fixture catalog per §8.1–§8.2 (requires local web + test-auth).
2. **M7-02 — ChatTurnState reducer with golden and replay-idempotence tests** — The pure
   reducer with the full chunk-to-mutation table, golden byte-compares per fixture, the
   replay-idempotence test, and the round-trip test.
3. **M7-03 — ChatStreamClient actor: connect, resume probe, stop semantics, error mapping**
   — Post/resume/cancel over the 600 s streaming session, the v1 header assertion, 204
   handling, the error taxonomy, instant stop with snapshot POST.
4. **M7-04 — ChatRuntime, registry, send flow, and GRDB write points** — Optimistic send
   with the rollback matrix, 75 ms coalesced flushes, the `effectiveStatus` blend,
   auto-resubmit, and the navigation-surviving registry.
5. **M7-05 — Resume, reconnect, and app-lifecycle reconciliation (U4)** —
   Rebuild-from-scratch on every 200 replay, the 204 refetch path, the full reconnect
   trigger table, backgrounding drain, and the named U4 regression on fixture 07.
6. **M7-06 — Run-watching UI: streaming render, scroll rules, stop, status strip, perf
   budget** — The live-run UI (shimmer, caret overlay, frozen-block strategy, scroll
   anchoring, stop capsule, S4 fold-in, S2 strip) passing the throughput budget.

**VERIFICATION CHECKPOINT — M7.** You should now be able to send a message, watch the
stream live, background mid-stream, foreground, and see zero duplicated or lost content —
all backed by deterministic fixture tests.

```bash
# 1. Fixture catalog committed and complete
ls ios/Packages/StreamEngine/Tests/StreamEngineTests/Fixtures/*.sse.txt | wc -l   # 14
cat ios/Packages/StreamEngine/Tests/StreamEngineTests/Fixtures/README.md          # capture metadata
# 2. Engine suites (host-runnable)
swift test --package-path ios/Packages/StreamEngine --filter SSEParser     # edge cases incl. split chunks
swift test --package-path ios/Packages/StreamEngine --filter ReducerGolden # all 14 goldens byte-equal
swift test --package-path ios/Packages/StreamEngine --filter ReplayIdempotence
swift test --package-path ios/Packages/StreamEngine                        # stop, resume, rollback, …
# 3. The named U4 regression (background mid-stream → foreground → fixture 07 replay)
swift test --package-path ios/Packages/StreamEngine --filter ResumeRebuild
# 4. Perf budget (XCTest measure; simulator test plan)
./ios/Scripts/test-unit.sh    # includes the ≥5,000 chunks/s throughput check on fixture 04

# 5. Live manual smoke against local web: send "write me a haiku" → reply streams token by
#    token, elapsed timer ticks from second 1; stop mid-turn → output freezes instantly and
#    partial text survives relaunch; send again, background mid-stream, wait 10 s,
#    foreground → the same run continues with no duplicated or missing text (U4).
./ios/Scripts/ci.sh
```

---

### M8 — Interaction: composer, approvals, chat management

**Why it exists:** U5 — compose with attachments and voice, answer AskUserQuestion prompts
and edit approvals in two taps or fewer, switch models per chat, and manage chats and
messages without ever stranding the composer. Spec: `01-product-and-ux.md` §5 and §9.

**Issues, in order:**

1. **M8-01 — Composer: anatomy, attachments, drafts, queued sends, S1 liftoff** — The glass
   composer with the exact `+` menu, GRDB drafts, queued-send chip, downscaled image
   attachments, and the never-dead enablement rule (lesson B3).
2. **M8-02 — Voice dictation via /api/transcribe** — Mic recording → `POST /api/transcribe`
   → caret insertion (never auto-send), 413/429 handling, first-tap-only permission prompt.
3. **M8-03 — AskUserQuestion morph and edit-approval cards (U5)** — The composer morph
   wizard and the Approve/Deny cards with the fixture-05 engine round trip.
4. **M8-04 — Model picker, run options, and session info sheets (SCR-13/14/15)** — The
   curated-first model picker with PATCH persistence and revert toast, the read-only
   run-options sheet, and the session info/chat switcher.
5. **M8-05 — Message actions: copy, share, fork, edit & resend** — The context menu with
   fork navigation and delete-cascade application to the GRDB cache.

**VERIFICATION CHECKPOINT — M8.** You should now be able to run the full interactive loop:
dictate or type with attachments, get blocked by a question, answer it in two taps, and the
run continues.

```bash
swift test --package-path ios/Packages/StreamEngine --filter AskUserQuestionRoundTrip  # fixture 05
./ios/Scripts/test-unit.sh   # ChatFeature composer/picker/action tests + snapshots
./ios/Scripts/ci.sh
# Manual smoke against local web:
# 1. Composer: attach a photo, send → S1 liftoff once; kill mid-draft → relaunch → draft restored.
# 2. Dictation: first mic tap triggers the permission prompt (never earlier); transcript
#    inserts at the caret, editable before send.
# 3. U5: prompt "ask me a clarifying question before answering" → composer morphs →
#    answer in ≤ 2 taps → run auto-continues; draft restored afterwards.
# 4. Model switch in SCR-14 → close, reopen → selection persisted (server PATCH).
# 5. Edit & resend a user message → transcript and GRDB match the returned deletedMessageIds.
```

---

### M9 — Ship code: sandbox, files, diff, commit, PR

**Why it exists:** U6/U7 — review diffs (including cached offline), commit and push, open
and merge PRs, and resume paused workspaces with one tap — every sandbox-dependent surface
degrades to cached content plus a Resume CTA, never a blank screen. Spec:
`01-product-and-ux.md` SCR-12/SCR-16.

**Issues, in order:**

1. **M9-01 — Workspace status row and sandbox lifecycle surface** — The status row driven by
   throttled polling, one-tap resume, and the global 409→Resume mapping (lesson B14).
2. **M9-02 — Git panel container, Files browser, and File Viewer (SCR-16a/16b)** — The
   segmented panel with failure isolation, the disclosure file tree, and the file viewer
   with paused-workspace cached fallbacks.
3. **M9-03 — Diff tab with cached-offline fallback (SCR-16c)** — The structured
   `UnifiedDiffView` diff tab with scope control, discard, and the cached/stale state.
4. **M9-04 — Commit & Push with base-branch guard (SCR-16d)** — The commit flow with AI
   message generation, the in-200 `error` result handling, and the branch guard.
5. **M9-05 — PR surface: create, checks, merge, Squash & Archive, fix hand-backs
   (SCR-16e)** — PR create/checks/merge/close, Squash & Archive, and the Fix Errors /
   Fix Conflicts hand-backs.

**VERIFICATION CHECKPOINT — M9.** You should now be able to ship a PR entirely from the
phone (U6), and a paused workspace always shows cached content plus one-tap Resume (U7).

```bash
./ios/Scripts/ci.sh          # includes diff-model tests and cached/offline snapshots
# End-to-end manual proof (real repo-backed session against local web or the dev deployment):
# 1. Ask the agent for a small change → Git panel → Diff renders with per-file counts and
#    intraline spans.
# 2. Commit & Push (AI-generated message) → "Pushed <shortSHA>" pill with a working GitHub link.
# 3. Create PR (AI title/body) → checks populate → green → Squash & Archive → session archives.
# 4. U7 drill: pause the sandbox (`POST /api/sandbox/snapshot`), reopen the session →
#    cached transcript + cached diff + amber banner + Resume CTA; one tap → Active again.
#    No raw "Sandbox is unavailable" string may appear anywhere.
# 5. Failure isolation: kill the server mid-panel → Files errors alone; Diff and chat stay
#    usable (lesson B2).
```

---

### M10 — Monitoring and secondary surfaces

**Why it exists:** The remaining v1 surfaces: repos tab, background-agent monitoring, share
links and the public viewer, the settings subset with in-app alerts, account management
with deletion, and usage glances. Spec: `01-product-and-ux.md` §4 (Repos/Agents/Settings
tabs, public surfaces).

**Issues, in order:**

1. **M10-01 — Repos tab: list and failure-isolated repo dashboard (SCR-20/21)** — The
   org-grouped repo list and the dashboard with independently loading/failing cards.
2. **M10-02 — Agents tab: run feed, agent detail, run detail with proof grid
   (SCR-30/31/32)** — The run feed, enable toggles with revert, and the polled run detail
   with proof grid and stderr evidence.
3. **M10-03 — Sharing: share-link sheet and public shared-chat viewer (SCR-17/50)** —
   Create/copy/revoke sharing and the signed-out-capable public viewer with status polling.
4. **M10-04 — Settings core, preferences, default model, App Lock, in-app alerts
   (SCR-40/42/44/46)** — The settings root, preference writes with revert toasts, App Lock,
   and the foreground-polling in-app alerts story.
5. **M10-05 — Account surfaces: profile, connections, delete account (SCR-41/43/47)** —
   Profile, GitHub/Vercel connections management, and the typed-DELETE account deletion
   flow (P8, guideline 5.1.1(v)).
6. **M10-06 — Usage screen with heatmap and rank (SCR-45)** — The usage screen with the
   Swift Charts heatmap, insights rows, and offline caching.

**VERIFICATION CHECKPOINT — M10.** You should now be able to exercise every v1 surface
outside chat: repos, runs, shares, settings, account deletion, usage.

```bash
./ios/Scripts/ci.sh
# Manual smokes (local web, seeded data):
# 1. Repos: reach an existing session from the Repos tab in two taps; dashboard cards load
#    and fail independently (stop the server mid-load to prove it).
# 2. Agents: open a run detail → proof grid + 2 s timeline poll; failed run shows stderr
#    auto-expanded.
# 3. Sharing: create a link → open the public viewer signed-out → full transcript readable;
#    revoke → 404-revoked state.
# 4. Settings (P7): flip diff style + auto-commit, relaunch → persisted; stop the server,
#    flip a toggle → visible revert + toast.
# 5. Account deletion (P8) on a THROWAWAY account: typed-DELETE confirm → back to the
#    Welcome wall; server rows gone:
curl -s -o /dev/null -w "%{http_code}\n" -H "authorization: Bearer $DELETED_TOKEN" \
  "$BASE/api/auth/info"        # 401
# 6. Usage: open from Settings → headline cards + heatmap render; offline shows cached data
#    with the amber banner.
```

---

### M11 — Observability hardening

**Why it exists:** Discipline-grade client observability: structured redacted events with
server-joinable correlation IDs, a bounded diagnostics pipeline with in-app export, and the
crash/metrics/analytics stack measuring the U9 crash-free criterion. Spec:
`07-observability.md`.

**Issues, in order:**

1. **M11-01 — Structured event emitter, correlation IDs, and Redactor port** — The
   snake_case event emitter over the six categories, `CorrelationMiddleware` with
   `x-request-id: ios.<uuid>`, `StreamMetricsRecorder`, and the `Redactor` parity port.
2. **M11-02 — Ring buffer, debug console, and diagnostic bundle export** — The bounded ring
   buffer, OSLog reader, five-tap debug console, and the redacted `ios_debug_bundle`
   ShareLink export.
3. **M11-03 — MetricKit, Sentry, PostHog, consent, and signposts** — MetricKit, the pinned
   Sentry/PostHog SDKs behind the consent toggle, the three `mxSignpost` flows, and the
   dSYM upload step.

**VERIFICATION CHECKPOINT — M11.** You should now be able to join any device report to
server logs on `request_id`, and export a bounded redacted diagnostic bundle.

```bash
swift test --package-path ios/Packages/Observability       # emitter, Redactor parity fixtures
./ios/Scripts/ci.sh
# 1. Correlation proof: trigger one chat send on the simulator, then
xcrun simctl spawn booted log show --last 5m \
  --predicate 'subsystem == "com.openagents.app" AND category == "api"' | grep request_id
#   take one ios.<uuid> value and find it in the `bun run web` server output (x-request-id
#   is echoed; harness logs are single-line JSON with a request_id key).
# 2. Redaction audit: tokens, prompt content, diff hunks absent from captures at every log
#    level; grep proof attached to the PR.
# 3. Diagnostics: five-tap the Settings version row → debug console; export the bundle →
#    emits ui_diagnostics_exported; bundle is bounded and redacted.
# 4. Crash pipeline: enable consent, force a DEBUG test crash, relaunch → event appears in
#    Sentry scrubbed with an opaque user id; PostHog error autoCapture stays OFF.
```

---

### M12 — Polish, accessibility, iPad, UI smoke

**Why it exists:** U8-grade accessibility, restraint-audited motion and haptics, a
first-class iPad experience at every window size, and the machine-executable XCUITest smoke
that locks P1–P3. Spec: `01-product-and-ux.md` §3.7–§3.8, §6–§7;
`06-testing-strategy.md` §7.

**Issues, in order:**

1. **M12-01 — Accessibility pass and motion/haptics restraint audit** — Dynamic Type to AX5,
   the per-screen VoiceOver table, one `updatesFrequently` element, Reduce
   Motion/Transparency fallbacks, the two-haptics-per-run audit, ax3 snapshots.
2. **M12-02 — iPad: split view, inspector, keyboard shortcuts, pointer, window-size
   matrix** — `NavigationSplitView`, the trailing Git inspector, the exact Cmd shortcut
   table, hover effects, and the §6.4 window-size snapshot matrix.
3. **M12-03 — XCUITest smoke suite and nightly workflow** — The DEBUG launch-environment
   seam, `A11yID` registry, page objects, the single FlyingFox-mocked send/stream scenario
   (predicate waits only), and `.github/workflows/ios-nightly.yml`.

**VERIFICATION CHECKPOINT — M12.** You should now be able to use the full workspace with
VoiceOver at AX5, at any iPad window size, and prove P1–P3 with one machine-executable
smoke.

```bash
./ios/Scripts/ci.sh            # ax3 snapshot variants + window-size matrix snapshots green

# 1. Manual accessibility pass (VoiceOver on, text size AX5): transcript navigable as
#    combined elements; every disabled control states why; diff badges legible with
#    Differentiate Without Color on.
# 2. iPad ("iPad Pro 13-inch (M4)"): two-column split view; Git inspector resizes; the §6.2
#    Cmd shortcut table works from a hardware keyboard; a 400 pt floating window stays usable.
# 3. UI smoke, locally:
./ios/Scripts/test-ui-smoke.sh                       # single scenario green, no sleeps
grep -rn "sleep(" ios/App/UITests && exit 1 || true  # the grep ban holds
# 4. Nightly lane:
gh workflow run ios-nightly.yml && gh run watch      # green, -test-iterations 3, no flakes
```

---

### M13 — Release: TestFlight and App Store

**Why it exists:** TestFlight internal and external lanes proven from CI with cloud-managed
signing, server-side release compatibility (universal links + shipped-binary contract
lane), and a compliant App Store 1.0 submission. Spec: `08-ci-cd-release.md`,
`01-product-and-ux.md` §10, `07-observability.md` §13.

**Issues, in order:**

1. **M13-01 — Release workflow, cloud signing, and TestFlight lanes** —
   `.github/workflows/ios-release.yml`, `archive-and-upload.sh`, `ExportOptions.plist`,
   `asc-release-notes.ts`, UTC build numbering + `ios-build/<n>` tags, the one-time
   portal/ASC checklist, and the cloud-signing validation run.
2. **M13-02 — Server release readiness: AASA universal links and shipped-binary
   contract-compat lane** — Serve the `apple-app-site-association` from `apps/web`
   (matching the entitlement) and stand up the T8 contract-compat lane in web CI.
3. **M13-03 — App Store submission: privacy, metadata, compliance, 1.0 release** —
   `PrivacyInfo.xcprivacy`, the nutrition-label questionnaire, screenshots/metadata, review
   notes with a demo account, beta-exit verification (U1–U9, crash-free ≥ 99.5%), and the
   submission/rejection-triage loop.

**VERIFICATION CHECKPOINT — M13.** You should now be able to ship: a develop merge produces
an installable TestFlight build with zero local signing, universal links open the app, and
the 1.0 build is compliant.

```bash
# 1. Cloud-signing validation (one-time dispatch before relying on the lane)
gh workflow run ios-release.yml && gh run watch
#   expect: archive + upload succeed with no .p12 anywhere; the workflow summary records
#   the build number; tag ios-build/<YYYYMMDDHHMM> exists at the built SHA:
git fetch --tags && git tag -l 'ios-build/*' | tail -1

# 2. TestFlight: the build appears in the internal group with "Build <n> — commit <sha>"
#    in What to Test; install on a device; Settings shows version/build/commit.
# 3. Universal links (M13-02):
curl -s https://<production-web-host>/.well-known/apple-app-site-association | jq .
#   then open https://<production-web-host>/shared/<shareId> on the device → the installed
#   app opens SCR-50 directly. Record this for the PR.
# 4. Contract-compat lane (T8): deliberately break a spec-covered response shape on a
#    branch → the previous release's contract fixtures go red in web CI.
# 5. Submission gate: PrivacyInfo.xcprivacy present; nutrition label "Data Not Used to
#    Track"; SIWA + delete-account verified in the shipping binary; demo account seeded;
#    crash-free ≥ 99.5% over the beta. Submit; budget ≥ 2 review round-trips.
```

---

## 4. Troubleshooting appendix

The most likely failure points, each as symptom → cause → fix.

### 4.1 `./ios/Scripts/check-api-drift.sh` is red immediately after regenerating

- **Symptom:** Regeneration then drift check still exits 1; churn in `GeneratedSources/`.
- **Cause:** The generator version floated (local `Package.resolved` differs from the
  committed one), or the vendored `openapi.json` was not refreshed from `apps/web/`.
- **Fix:** `git checkout ios/Packages/OpenAgentsAPI/Package.resolved`, then re-run
  `./ios/Scripts/generate-api.sh` (its `--force-resolved-versions` pins the generator at
  1.12.2). Confirm the vendored spec byte-matches `apps/web/openapi.json`. Never hand-edit
  generated sources.

### 4.2 Generated Swift client fails to compile after a contract batch

- **Symptom:** `swift build --package-path ios/Packages/OpenAgentsAPI` errors on generated
  code (duplicate types, unsupported schema constructs).
- **Cause:** New spec entries violated the hygiene rules — usually a `components.schemas`
  name collision or a construct outside OpenAPI 3.0.3.
- **Fix:** Fix it in `apps/web/lib/api/openapi-spec.ts` (give the schema a distinct stable
  name from the §2.2 table), regenerate web artifacts, then
  `./ios/Scripts/generate-api.sh`. Never patch Swift output.

### 4.3 Generated client throws on every timestamp

- **Symptom:** Decoding fails with `dataCorrupted` on `createdAt`-style fields.
- **Cause:** The default ISO-8601 transcoder rejects fractional seconds
  (`2026-06-09T12:34:56.789Z`), or a field was specced as bare `z.string()` and Swift got
  `String` where code expects `Date`.
- **Fix:** The client factory must pass
  `Configuration(dateTranscoder: .iso8601WithFractionalSeconds)` (M2-02). Spec-side,
  declare ISO timestamps with `z.iso.datetime()`; keep sandbox `lifecycle` epoch-ms fields
  as numbers with the unit documented.

### 4.4 SSE stream dies after ~60 seconds on a long agent run

- **Symptom:** Long turns abort client-side with a timeout while the server keeps working.
- **Cause:** The request went over the default URLSession (60 s
  `timeoutIntervalForRequest`) instead of the dedicated streaming session.
- **Fix:** All SSE goes through the streaming `URLSessionConfiguration` with
  `timeoutIntervalForRequest = 600` (M3-01/M7-03). After an idle-timeout dirty EOF, the
  reconnect path (M7-05) resumes via `GET /api/chat/{chatId}/stream` — never by re-POSTing
  `/api/chat`.

### 4.5 SSE chunks arrive all at once at the end of the turn

- **Symptom:** No incremental rendering; the whole reply appears when the run finishes.
- **Cause:** Response buffering — a proxy/compression in front of the dev server, or
  consuming the response with a data task instead of `URLSession.bytes(for:)`.
- **Fix:** Use the byte-stream API on the streaming session; verify with
  `curl -sN --no-buffer` that bytes arrive incrementally; assert the
  `x-vercel-ai-ui-message-stream: v1` header (M7-03 makes this mandatory).

### 4.6 `ASWebAuthenticationSession` completes but the app never gets the callback

- **Symptom:** The browser sheet shows the signed-in web app (or just closes); no
  `openagents://auth` callback fires.
- **Cause:** The chain never reached `/api/native-auth/complete` (wrong `callbackURL` in
  the sign-in POST), `"openagents://"` missing from `trustedOrigins`, or
  `.customScheme("openagents")` not set on the session.
- **Fix:** Reproduce with curl per the M0 checkpoint: cookie → `/api/native-auth/complete`
  must 303 to `openagents://auth?ott=…` (a `?error=sign_in_failed` redirect means the
  browser session has no cookie — check the authorize URL). Verify `trustedOrigins` in
  `apps/web/lib/auth/config.ts` and `CFBundleURLTypes` in `ios/App/project.yml`.

### 4.7 Every iOS request 401s even though sign-in succeeded

- **Symptom:** Token lands in the Keychain but `GET /api/auth/info` is 401.
- **Cause:** The raw (unsigned) token was stored instead of the signed `set-auth-token`
  header value (`requireSignature: true` rejects raw tokens), or a rotated token was not
  persisted.
- **Fix:** Store exactly the `set-auth-token` header value from the OTT verify response —
  never a token from a JSON body. Reproduce with the M0 curl chain to isolate server vs
  client; the `AuthMiddleware` tests must assert rotation persistence.

### 4.8 `POST /api/chat` returns 403 "Access denied" from iOS or curl

- **Symptom:** Chat send blocked for non-browser traffic; works from the web app.
- **Cause:** BotID protection (`checkBotProtection()`) classifying bearer/non-browser
  traffic as a bot.
- **Fix:** The M1-07 workstream — bearer-authenticated requests must pass. Locally,
  `NODE_ENV=development` should not enforce; if it does, fix the server. Never hand-edit
  fixtures or fake browser headers in the app.

### 4.9 `xcodegen generate` succeeds but the build resolves wrong package versions

- **Symptom:** Builds fetch unexpected dependency versions, or CI fails with
  "automatic package resolution disabled".
- **Cause:** Regenerating the project discards the workspace `Package.resolved`.
- **Fix:** Always generate via `./ios/Scripts/generate-project.sh` (it restores the
  committed `ios/App/Package.resolved`). After an intentional dependency bump, run
  `./ios/Scripts/save-lockfile.sh` and commit the lockfile. Keep
  `-disableAutomaticPackageResolution` on every `xcodebuild` invocation.

### 4.10 Pinned simulator "iPhone 17 Pro, OS=26.0" not found

- **Symptom:** `xcodebuild` errors "Unable to find a destination"; local or CI.
- **Cause:** The iOS 26.0 simulator runtime is not installed, or the runner image rotated
  its device set.
- **Fix:** Locally: `xcodebuild -downloadPlatform iOS -buildVersion 26.0`. CI:
  `ios/Scripts/select-xcode.sh` downloads the runtime and fails loudly; if the device name
  itself is gone, follow the pin-update procedure in `08-ci-cd-release.md` §5.2 (update
  `ios/Scripts/env.sh`, re-record snapshots in the same PR).

### 4.11 Snapshot tests pass locally, fail on CI (or vice versa)

- **Symptom:** Pixel diffs with no code change.
- **Cause:** Baselines recorded on a different simulator/OS/scale than the pin, or a local
  Intel/arm64 mismatch.
- **Fix:** Record baselines only on the pinned simulator (`name=iPhone 17 Pro,OS=26.0`) via
  the record test plan; the `UnitTests` plan sets the snapshot record env to never in CI
  (M2-04). If the pin changed, re-record everything in the pin-change PR.

### 4.12 GRDB crash on launch: "table … already exists" / migration mismatch

- **Symptom:** App crashes opening the database after a schema edit.
- **Cause:** A registered migration was edited in place; existing installs already ran the
  old version of it.
- **Fix:** Never edit a landed migration — append a new
  `migrator.registerMigration("v<n+1>")`. DEBUG builds set `eraseDatabaseOnSchemaChange`
  (M6-01); deleting the app from the simulator also clears bad local state.

### 4.13 Strict-concurrency build errors in a new package

- **Symptom:** A new package fails with sendability/isolation errors other packages don't
  produce.
- **Cause:** The `swiftSettings` block was omitted from the new `Package.swift` — package
  manifests do **not** inherit project settings.
- **Fix:** Copy the correct `03-architecture.md` §4 template verbatim (MainActor-default
  for UI-facing packages, nonisolated-default + macOS platform for infrastructure); every
  target and test target needs the `swiftSettings:` argument.

### 4.14 Release lane fails: signing error at archive, or the build never becomes installable

- **Symptom:** `xcodebuild archive` fails with "No signing certificate"/profile errors on
  the runner; or the upload succeeds but the build sits in "Processing" / shows "Missing
  Compliance" and `asc-release-notes.ts` times out polling.
- **Cause:** Signing: cloud-managed signing could not mint/fetch the identity — the ASC API
  key lacks certificates/profiles access, `DEVELOPMENT_TEAM` is missing, or the Sign in
  with Apple capability was never registered on the App ID. Installability: processing
  genuinely takes up to ~30 minutes; "Missing Compliance" means
  `ITSAppUsesNonExemptEncryption` is absent from the built Info.plist.
- **Fix:** Signing: verify the key role (App Manager + cert access), `APPLE_TEAM_ID`, and
  the one-time portal checklist in `08-ci-cd-release.md` §10.3; if it still fails opaquely,
  enable the documented manual-keychain fallback (§10.2) as its own slice. Installability:
  the compliance key is `false` in `ios/App/project.yml` — verify it survived into the
  archive (`plutil -p`); for processing delays, extend the poll budget rather than
  re-uploading (re-uploads need a new build number).

### 4.15 Web CI breaks after `ios/` files appear

- **Symptom:** `bun --bun run ci` fails on Swift files, or `scripts/test-isolated.ts`
  tries to run iOS files.
- **Cause:** Ultracite/turbo/test globs picked up `ios/**`.
- **Fix:** Add explicit `ios/**` ignore entries to the offending tool configs (an M2-03
  exit check — T6), then re-run both gates to prove isolation in both directions.

---

## 5. Done means done

The build is complete when all milestone checkpoints M0–M13 have passed in order with
evidence in their PRs; the success criteria U1–U9 / T1–T8 from `00-overview.md` §5 are each
covered by a named deterministic test or a recorded release-lane proof; `develop` is green
on `lint-and-typecheck` and `ios-gate`; the nightly UI smoke is green; and the 1.0 build is
live on the App Store. Anything learned the hard way goes into
`docs/agents/lessons-learned.md` in the same PR that learned it.
