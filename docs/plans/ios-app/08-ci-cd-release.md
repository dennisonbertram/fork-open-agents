# 08 — CI/CD and Release

Status: planning document. Part of the iOS app build plan; see `docs/plans/ios-app/00-overview.md` for the index. Source research: `docs/plans/ios-app/research/24-ios-testing-and-ci.md` (runners, signing, TestFlight) and `docs/plans/ios-app/research/10-process-rules.md` (repo process the iOS lane must mirror). Codegen drift facts come from `docs/plans/ios-app/research/21-swift-openapi-generator.md`.

This document defines the GitHub Actions workflows, the one-command iOS gate, code signing, TestFlight automation, and the release train for the native iOS app living at `ios/` in this monorepo. It restates — never re-decides — the canonical stack: Xcode 26.x, Swift 6.2 strict concurrency, SwiftUI + `@Observable` MVVM, iOS 26.0 minimum, GRDB, XcodeGen, swift-openapi-generator 1.12.2, Swift Testing, swift-snapshot-testing 1.18.x, thin XCUITest smoke, `macos-26` runners, TestFlight via App Store Connect API keys.

Related plan docs: `02-api-contract-and-networking.md` (what the drift check protects), `03-architecture.md` (project layout, `project.yml`, schemes), `06-testing-strategy.md` (test plans, snapshot record policy), `07-observability.md` (evidence requirements), `09-step-by-step-build-guide.md` (execution order).

---

## 1. Decisions summary

| Decision | Value | Rationale (short) |
| --- | --- | --- |
| Runner | `macos-26` (arm64 standard, GitHub-hosted) | Only image line guaranteed to carry Xcode 26.x; arm64 matches dev machines (snapshot stability) |
| Xcode pin | `26.0` via `sudo xcode-select -s /Applications/Xcode_26.0.app` (constant in `ios/Scripts/env.sh`) | Pin = analog of web CI's `bun-version: "1.2.14"`; verify against `runner-images` `macos-26-Readme.md` before first run |
| Simulator pin | `platform=iOS Simulator,name=iPhone 17 Pro,OS=26.0` (constant in `ios/Scripts/env.sh`) | One canonical device+OS for tests and snapshot baselines; update procedure in §5.2 |
| Swift lint/format tool | **Apple `swift-format` (toolchain-shipped, invoked as `xcrun swift-format`)** | Pinned implicitly by the Xcode pin; zero extra install; one tool does lint + format, mirroring the web's single `ultracite check` gate. SwiftLint and nicklockwood/SwiftFormat rejected: extra binary to pin/install, Homebrew version drift on runners |
| Project generation | XcodeGen **2.45.4**, installed from the GitHub release zip (not Homebrew) | Deterministic pin; Homebrew installs whatever is current |
| SPM caching | `-clonedSourcePackagesDirPath ios/.spm` + `actions/cache@v4` keyed on committed `Package.resolved` files | Smaller and safer than caching DerivedData |
| iOS gate shape | One script `ios/Scripts/ci.sh` (lint → generate project → build → unit/snapshot tests → API drift → `git diff --check`) | Mirrors `bun --bun run ci`; named script per `docs/agents/lessons-learned.md` ("verification instructions must point at project scripts") |
| Required PR check | New required status check **`ios-gate`** added to branch protection on `develop` and `main`, alongside the existing `lint-and-typecheck` | Path-filter problem solved with an always-running ubuntu gate job (§4) |
| Signing | **Cloud-managed signing** (`-allowProvisioningUpdates` + ASC API key, `signingStyle: automatic`), manual `.p12` keychain import documented as fallback only | §10 |
| Upload | `xcodebuild -exportArchive` with `method: app-store-connect`, `destination: upload` | Apple-native, zero extra dependencies (no fastlane, no third-party upload action) |
| Build number | `CFBundleVersion` = UTC timestamp `YYYYMMDDHHMM`, set at archive time; commit SHA recorded in tag + TestFlight notes | Strictly monotonic across both lanes with zero coordination (§11.1) |
| Release train | feature branch → `develop` (TestFlight internal) → `main` (TestFlight external → manual App Store submission) | Maps 1:1 onto the repo's existing branch model (§13) |
| App binary rollback | **Fix-forward only**; server-side compatibility window is the real rollback lever | Per `docs/plans/ios-app/research/10-process-rules.md` §E.6; cross-ref `02-api-contract-and-networking.md` |

---

## 2. Workflow file layout

Three new workflow files. The existing `.github/workflows/ci.yml` (`lint-and-typecheck`) is **not modified** — web CI stays untouched, and `scripts/test-isolated.ts` / ultracite must be configured to ignore `ios/**` (owned by `03-architecture.md`; verify before merging the first iOS PR).

```
.github/workflows/ios-ci.yml        # PR gate + push to develop/main: lint, build, unit+snapshot tests, API drift, gate
.github/workflows/ios-nightly.yml   # scheduled XCUITest smoke + flake detection
.github/workflows/ios-release.yml   # push to develop/main (ios paths): UI smoke → archive → TestFlight upload → ASC postprocess
```

Supporting scripts (all committed, all `chmod +x`):

```
ios/Scripts/env.sh                  # single source of pinned constants (Xcode, simulator, XcodeGen versions)
ios/Scripts/install-xcodegen.sh     # pinned XcodeGen 2.45.4 from release zip into ios/.tools/
ios/Scripts/select-xcode.sh         # CI-only: xcode-select the pinned Xcode, verify simulator runtime
ios/Scripts/generate-project.sh     # xcodegen generate + restore committed Package.resolved into the generated project
ios/Scripts/save-lockfile.sh        # copy resolved lockfile back out of the generated project for committing
ios/Scripts/lint.sh                 # swift-format lint --strict over all non-generated Swift
ios/Scripts/format.sh               # swift-format --in-place (the `bun run fix` analog)
ios/Scripts/generate-api.sh         # copy apps/web/openapi.json into the package + run codegen plugin
ios/Scripts/check-api-drift.sh      # generate-api.sh + git diff --exit-code (mirrors apps/web/scripts/check-openapi.ts)
ios/Scripts/test-unit.sh            # build-for-testing + test-without-building, UnitTests test plan
ios/Scripts/test-ui-smoke.sh        # xcodebuild test, UISmoke test plan, passthrough args
ios/Scripts/ci.sh                   # the one-command iOS gate (local + CI)
ios/Scripts/archive-and-upload.sh   # release lane: archive + exportArchive(upload)
ios/Scripts/asc-release-notes.ts    # Bun script: poll ASC for the build, set whatToTest, assign external group
```

Git-ignored paths (add to root `.gitignore`):

```
ios/App/OpenAgents.xcodeproj/
ios/.tools/
ios/.spm/
ios/build/
ios/**/TestResults*.xcresult
ios/Packages/*/.build/
```

Committed lockfiles (drift-relevant; never gitignore): `ios/App/Package.resolved`, `ios/Packages/OpenAgentsAPI/Package.resolved`.

---

## 3. Pinned constants — `ios/Scripts/env.sh`

Every workflow and script sources this file. A toolchain bump is a one-file PR, and the SPM cache key hashes this file so caches roll automatically.

```bash
#!/usr/bin/env bash
# Single source of truth for pinned iOS toolchain constants.
# Verify OA_XCODE_VERSION and OA_SIM_NAME against
# https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md
# before changing. Changing this file invalidates the CI SPM cache (by design).
export OA_XCODE_VERSION="26.0"
export OA_XCODE_APP="/Applications/Xcode_${OA_XCODE_VERSION}.app"
export OA_SIM_NAME="iPhone 17 Pro"
export OA_SIM_OS="26.0"
export OA_DESTINATION="platform=iOS Simulator,name=${OA_SIM_NAME},OS=${OA_SIM_OS}"
export OA_XCODEGEN_VERSION="2.45.4"
export OA_SCHEME="OpenAgents"
export OA_PROJECT="ios/App/OpenAgents.xcodeproj"
export OA_BUNDLE_ID="com.openagents.app"
```

`OA_SIM_NAME`/`OA_SIM_OS` are the research brief's placeholder values ("iPhone 17 Pro" / 26.0). **First implementation task for this doc (see §16): run `xcrun simctl list devices available` on a `macos-26` runner, confirm or correct these two values, and commit the result.** Everything else in this plan treats them as final constants.

---

## 4. Path filtering and the required-check problem

GitHub branch protection cannot make a status check "required only when `ios/**` changed." If `ios-ci.yml` used a workflow-level `paths:` filter, web-only PRs would hang forever on an `Expected — ios-gate` check. The standard fix, used here:

1. `ios-ci.yml` has **no** `paths:` filter on `pull_request`.
2. A cheap `changes` job on `ubuntu-latest` runs `dorny/paths-filter@v3` to compute two booleans:
   - `ios` — true when `ios/**` or `.github/workflows/ios-ci.yml` changed.
   - `contract` — true when `apps/web/openapi.json` changed.
3. The expensive macOS jobs run only when their boolean is true (`ios-build-test` needs `ios`; `ios-api-drift` needs `ios || contract`).
4. A final `ios-gate` job on `ubuntu-latest` runs with `if: always()`, fails if any needed job `failure`/`cancelled`, and passes when they were `skipped`. **`ios-gate` is the only iOS check marked required in branch protection.**

Consequences, stated explicitly:

- Web-only PRs pay ~1–2 ubuntu minutes (`changes` + `ios-gate`), no macOS minutes.
- A web PR that changes `apps/web/openapi.json` without regenerating the Swift client **fails `ios-api-drift`** and is blocked. This is intentional and mirrors the philosophy of `db:check`/`openapi:check`: the checked-in generated client may never drift from the contract. The fix inside such a PR is `./ios/Scripts/generate-api.sh` and committing the diff.
- `ios-release.yml` and `ios-nightly.yml` are not required checks, so they may use plain `paths:`/`schedule` triggers.

Branch protection update (one-time, run by the operator; needs `gh auth refresh -s workflow` first if workflows are being pushed in the same session):

```bash
gh api -X POST "repos/dennisonbertram/fork-open-agents/branches/develop/protection/required_status_checks/contexts" \
  --input - <<< '["ios-gate"]'
gh api -X POST "repos/dennisonbertram/fork-open-agents/branches/main/protection/required_status_checks/contexts" \
  --input - <<< '["ios-gate"]'
```

Verify: `gh api repos/dennisonbertram/fork-open-agents/branches/develop/protection/required_status_checks/contexts` must list both `lint-and-typecheck` and `ios-gate`.

---

## 5. Toolchain setup steps (shared by all macOS jobs)

### 5.1 `ios/Scripts/select-xcode.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

if [ ! -d "${OA_XCODE_APP}" ]; then
  echo "Pinned Xcode not found at ${OA_XCODE_APP}. Installed Xcodes:" >&2
  ls -d /Applications/Xcode*.app >&2
  echo "Update OA_XCODE_VERSION in ios/Scripts/env.sh per macos-26-Readme.md." >&2
  exit 1
fi
sudo xcode-select -s "${OA_XCODE_APP}"
xcodebuild -version

# Ensure the pinned simulator runtime exists (runner images keep only ~3 runtimes).
if ! xcrun simctl list runtimes | grep -q "iOS ${OA_SIM_OS}"; then
  echo "iOS ${OA_SIM_OS} simulator runtime missing; downloading..."
  sudo xcodebuild -downloadPlatform iOS -buildVersion "${OA_SIM_OS}"
fi
xcrun simctl list devices available | grep -F "${OA_SIM_NAME}" >/dev/null || {
  echo "Pinned simulator '${OA_SIM_NAME}' not available under Xcode ${OA_XCODE_VERSION}." >&2
  xcrun simctl list devices available >&2
  exit 1
}
```

### 5.2 Updating the simulator/Xcode pin (the only sanctioned procedure)

1. Read the `Xcode` and `Installed simulators` tables in `runner-images` `macos-26-Readme.md` on GitHub.
2. Change `OA_XCODE_VERSION` / `OA_SIM_NAME` / `OA_SIM_OS` in `ios/Scripts/env.sh` in a dedicated PR.
3. Re-record all snapshot baselines locally on the same simulator/OS (see `06-testing-strategy.md`) in the same PR.
4. Expect the SPM cache to rebuild once (key includes a hash of `env.sh`).

Never let a runner-image rotation change the effective runtime silently — the explicit `OS=` in `OA_DESTINATION` plus the `-downloadPlatform` fallback guarantees the pinned runtime is used or the job fails loudly.

### 5.3 `ios/Scripts/install-xcodegen.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/env.sh"

BIN="${ROOT}/ios/.tools/xcodegen/bin/xcodegen"
if [ -x "${BIN}" ] && "${BIN}" version | grep -q "${OA_XCODEGEN_VERSION}"; then
  exit 0
fi
rm -rf "${ROOT}/ios/.tools/xcodegen"
mkdir -p "${ROOT}/ios/.tools"
curl -fsSL -o /tmp/xcodegen.zip \
  "https://github.com/yonaskolb/XcodeGen/releases/download/${OA_XCODEGEN_VERSION}/xcodegen.zip"
unzip -q -o /tmp/xcodegen.zip -d "${ROOT}/ios/.tools"
"${BIN}" version | grep -q "${OA_XCODEGEN_VERSION}" || { echo "XcodeGen version mismatch" >&2; exit 1; }
```

### 5.4 `ios/Scripts/generate-project.sh` and the SPM lockfile

XcodeGen regenerates `OpenAgents.xcodeproj` from `ios/App/project.yml`, which would discard the workspace `Package.resolved`. The lockfile is therefore committed at `ios/App/Package.resolved` and copied into the generated project after every generation; builds run with `-disableAutomaticPackageResolution` so CI can never silently float dependency versions.

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/env.sh"

"${SCRIPT_DIR}/install-xcodegen.sh"
"${ROOT}/ios/.tools/xcodegen/bin/xcodegen" generate \
  --spec "${ROOT}/ios/App/project.yml" \
  --project "${ROOT}/ios/App"

SWIFTPM_DIR="${ROOT}/${OA_PROJECT}/project.xcworkspace/xcshareddata/swiftpm"
mkdir -p "${SWIFTPM_DIR}"
cp "${ROOT}/ios/App/Package.resolved" "${SWIFTPM_DIR}/Package.resolved"
```

`ios/Scripts/save-lockfile.sh` (run locally after an intentional dependency update, then commit `ios/App/Package.resolved`):

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/env.sh"
cp "${ROOT}/${OA_PROJECT}/project.xcworkspace/xcshareddata/swiftpm/Package.resolved" \
   "${ROOT}/ios/App/Package.resolved"
echo "Updated ios/App/Package.resolved — review and commit."
```

---

## 6. Lint/format: Apple `swift-format`, wired like the web's formatting gate

The web's gate (`docs/process/formatting-gate.md`) is: `bun --bun run check` must be green before any handoff; `bun --bun run fix` repairs; `git diff --check` always runs. Ultracite/oxfmt cannot parse Swift, so the iOS tree gets the exact analog with Apple's `swift-format`, which ships inside the pinned Xcode 26 toolchain — pinning Xcode pins the formatter, the same way pinning Bun pins ultracite's runtime.

| Web command | iOS analog |
| --- | --- |
| `bun --bun run check` | `./ios/Scripts/lint.sh` |
| `bun --bun run fix` | `./ios/Scripts/format.sh` |
| `bun --bun run ci` | `./ios/Scripts/ci.sh` |
| `git diff --check` | unchanged (language-agnostic, included in `ci.sh`) |

Config file `ios/.swift-format` (JSON; `swift-format` discovers it by walking up from each file, so one file at `ios/` covers the whole tree):

```json
{
  "version": 1,
  "lineLength": 120,
  "indentation": { "spaces": 2 },
  "respectsExistingLineBreaks": true,
  "rules": {
    "NeverForceUnwrap": true,
    "NeverUseForceTry": true,
    "OrderedImports": true
  }
}
```

`ios/Scripts/lint.sh` (generated sources are excluded by path; they also carry `swift-format-ignore-file` via the generator's `additionalFileComments`, per `21-swift-openapi-generator.md`):

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${ROOT}"
find ios -name '*.swift' \
  -not -path '*/GeneratedSources/*' \
  -not -path 'ios/.tools/*' \
  -not -path 'ios/.spm/*' \
  -not -path '*/.build/*' \
  -print0 | xargs -0 xcrun swift-format lint --strict --parallel
```

`ios/Scripts/format.sh` is identical except the last line ends `xargs -0 xcrun swift-format format --in-place --parallel`.

Gate semantics copied verbatim from the formatting-gate doc: a red `lint.sh` is failing verification. Either run `format.sh` and re-run, or stop and get explicit user approval to defer — never hand off red. Until the issue/PR templates are amended for iOS (a follow-up slice per `10-process-rules.md` §E.11), iOS issues substitute `./ios/Scripts/ci.sh` for `bun --bun run ci` in the free-text checklist fields, and additionally run `bun --bun run ci` whenever a slice touches anything outside `ios/`.

---

## 7. Test and gate scripts

### 7.1 `ios/Scripts/test-unit.sh` — unit + snapshot tests (Swift Testing)

`build-for-testing` / `test-without-building` separates compile failures from test failures in logs and lets the same products be reused for sharding later if ever needed.

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/env.sh"
cd "${ROOT}"
set -o pipefail

xcodebuild build-for-testing \
  -project "${OA_PROJECT}" \
  -scheme "${OA_SCHEME}" \
  -testPlan UnitTests \
  -destination "${OA_DESTINATION}" \
  -clonedSourcePackagesDirPath ios/.spm \
  -disableAutomaticPackageResolution \
  -skipMacroValidation -skipPackagePluginValidation

xcodebuild test-without-building \
  -project "${OA_PROJECT}" \
  -scheme "${OA_SCHEME}" \
  -testPlan UnitTests \
  -destination "${OA_DESTINATION}" \
  -resultBundlePath ios/TestResults-unit.xcresult \
  -enableCodeCoverage YES
```

The `UnitTests` test plan (defined in `ios/App/project.yml` / `06-testing-strategy.md`) contains the app unit-test bundle plus every local package's test bundle, runs Swift Testing in parallel, and sets `SNAPSHOT_RECORD=never` in its environment so CI can never rewrite snapshot baselines. Local re-recording uses the separate `UnitTestsRecord` plan — see `06-testing-strategy.md`.

### 7.2 `ios/Scripts/test-ui-smoke.sh` — thin XCUITest smoke

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/env.sh"
cd "${ROOT}"
set -o pipefail

xcodebuild test \
  -project "${OA_PROJECT}" \
  -scheme "${OA_SCHEME}" \
  -testPlan UISmoke \
  -destination "${OA_DESTINATION}" \
  -clonedSourcePackagesDirPath ios/.spm \
  -disableAutomaticPackageResolution \
  -skipMacroValidation -skipPackagePluginValidation \
  -resultBundlePath ios/TestResults-uismoke.xcresult \
  "$@"
```

The `UISmoke` plan launches the app with `--uitesting` (animations off, networking pointed at the in-process mock server, persistence reset) per `06-testing-strategy.md`. It is **not** part of the PR gate: it runs nightly (§9) and as a release-lane gate (§12).

### 7.3 `ios/Scripts/check-api-drift.sh` — the `check-openapi.ts` mirror

The web already drift-guards `apps/web/openapi.json` against its Zod source via `apps/web/scripts/check-openapi.ts` (wired as `openapi:check`). The iOS analog guards the **checked-in generated Swift client** against `apps/web/openapi.json`:

`ios/Scripts/generate-api.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cp "${ROOT}/apps/web/openapi.json" \
   "${ROOT}/ios/Packages/OpenAgentsAPI/Sources/OpenAgentsAPI/openapi.json"

swift package \
  --package-path "${ROOT}/ios/Packages/OpenAgentsAPI" \
  --force-resolved-versions \
  --allow-writing-to-package-directory \
  generate-code-from-openapi --target OpenAgentsAPI
```

`ios/Scripts/check-api-drift.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

"${SCRIPT_DIR}/generate-api.sh"
if ! git -C "${ROOT}" diff --exit-code -- ios/Packages/OpenAgentsAPI; then
  echo "" >&2
  echo "Generated OpenAPI client is out of date with apps/web/openapi.json." >&2
  echo "Run: ./ios/Scripts/generate-api.sh and commit the diff." >&2
  exit 1
fi
echo "✓ ios/Packages/OpenAgentsAPI is in sync with apps/web/openapi.json"
```

Determinism: the generator version (1.12.2) is pinned by `ios/Packages/OpenAgentsAPI/Package.resolved` (committed) and `--force-resolved-versions`; generator upgrades are ordinary PRs whose diff *is* the regenerated client. The codegen plugin builds swift-syntax on first run, so the drift job caches `ios/Packages/OpenAgentsAPI/.build` (§8).

### 7.4 `ios/Scripts/ci.sh` — the one-command iOS gate

```bash
#!/usr/bin/env bash
# iOS analog of `bun --bun run ci`. Run from anywhere; requires the pinned Xcode active.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

"${SCRIPT_DIR}/lint.sh"
"${SCRIPT_DIR}/generate-project.sh"
"${SCRIPT_DIR}/test-unit.sh"
"${SCRIPT_DIR}/check-api-drift.sh"
git -C "${ROOT}" diff --check
echo "✓ iOS gate passed"
```

---

## 8. PR gate workflow — `.github/workflows/ios-ci.yml`

```yaml
name: iOS CI

on:
  push:
    branches: ["main", "develop"]
  pull_request:
    branches: ["*"]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  changes:
    name: changes
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      ios: ${{ steps.filter.outputs.ios }}
      contract: ${{ steps.filter.outputs.contract }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.sha }}
      - name: Detect changed paths
        id: filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            ios:
              - 'ios/**'
              - '.github/workflows/ios-ci.yml'
            contract:
              - 'apps/web/openapi.json'

  ios-build-test:
    name: ios-build-test
    needs: changes
    if: needs.changes.outputs.ios == 'true'
    runs-on: macos-26
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.sha }}
      - name: Select Xcode and verify simulator
        run: ./ios/Scripts/select-xcode.sh
      - name: Cache XcodeGen
        uses: actions/cache@v4
        with:
          path: ios/.tools/xcodegen
          key: xcodegen-${{ runner.os }}-${{ hashFiles('ios/Scripts/env.sh') }}
      - name: Cache SPM checkouts
        uses: actions/cache@v4
        with:
          path: ios/.spm
          key: spm-${{ runner.os }}-${{ hashFiles('ios/Scripts/env.sh') }}-${{ hashFiles('ios/App/Package.resolved', 'ios/Packages/**/Package.resolved') }}
          restore-keys: |
            spm-${{ runner.os }}-${{ hashFiles('ios/Scripts/env.sh') }}-
      - name: Lint and format check
        run: ./ios/Scripts/lint.sh
      - name: Generate Xcode project
        run: ./ios/Scripts/generate-project.sh
      - name: Build and run unit + snapshot tests
        run: ./ios/Scripts/test-unit.sh
      - name: Whitespace check
        run: git diff --check
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ios-unit-test-results
          path: ios/TestResults-unit.xcresult
          retention-days: 7

  ios-api-drift:
    name: ios-api-drift
    needs: changes
    if: needs.changes.outputs.ios == 'true' || needs.changes.outputs.contract == 'true'
    runs-on: macos-26
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.sha }}
      - name: Select Xcode
        run: ./ios/Scripts/select-xcode.sh
      - name: Cache codegen build
        uses: actions/cache@v4
        with:
          path: ios/Packages/OpenAgentsAPI/.build
          key: apigen-${{ runner.os }}-${{ hashFiles('ios/Scripts/env.sh') }}-${{ hashFiles('ios/Packages/OpenAgentsAPI/Package.resolved') }}
      - name: Check generated client drift
        run: ./ios/Scripts/check-api-drift.sh

  ios-gate:
    name: ios-gate
    needs: [changes, ios-build-test, ios-api-drift]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Evaluate results
        run: |
          results="changes:${{ needs.changes.result }} build:${{ needs.ios-build-test.result }} drift:${{ needs.ios-api-drift.result }}"
          echo "$results"
          for pair in $results; do
            r="${pair#*:}"
            if [ "$r" = "failure" ] || [ "$r" = "cancelled" ]; then
              echo "iOS gate failed: $results" >&2
              exit 1
            fi
          done
          echo "iOS gate passed (skipped jobs are OK): $results"
```

Notes:

- The fork-aware `checkout` parameters mirror the existing `.github/workflows/ci.yml` exactly.
- Job names are the status-check contexts; only `ios-gate` goes into branch protection (§4).
- `select-xcode.sh` runs before any cache step needs the toolchain, and asserts `xcodebuild -version` into the log — that is the pin's observability evidence.
- Target wall time: ≤15 minutes for `ios-build-test` with a warm SPM cache (brief 24 §5: 8–15 min is the realistic band for a midsize SwiftUI app without UI tests).

---

## 9. Nightly workflow — `.github/workflows/ios-nightly.yml`

UI smoke runs nightly (not per-PR) per the v1 strategy in `06-testing-strategy.md`. `-test-iterations 3` surfaces flakes without masking them (retries-as-detector, never as a merge crutch). The guard step skips the macOS spend when `ios/` had no commits in the last 25 hours.

```yaml
name: iOS Nightly

on:
  schedule:
    - cron: "0 7 * * *" # 07:00 UTC daily
  workflow_dispatch:

permissions:
  contents: read

jobs:
  ios-ui-smoke-nightly:
    name: ios-ui-smoke-nightly
    runs-on: macos-26
    timeout-minutes: 40
    steps:
      - name: Checkout develop
        uses: actions/checkout@v4
        with:
          ref: develop
          fetch-depth: 0
      - name: Skip if ios/ unchanged in last 25h
        id: guard
        run: |
          if git log --since="25 hours ago" --oneline -- ios/ | grep -q .; then
            echo "run=true" >> "$GITHUB_OUTPUT"
          else
            echo "No ios/ commits in the last 25 hours; skipping."
            echo "run=false" >> "$GITHUB_OUTPUT"
          fi
      - name: Select Xcode and verify simulator
        if: steps.guard.outputs.run == 'true'
        run: ./ios/Scripts/select-xcode.sh
      - name: Generate Xcode project
        if: steps.guard.outputs.run == 'true'
        run: ./ios/Scripts/generate-project.sh
      - name: UI smoke with flake detection
        if: steps.guard.outputs.run == 'true'
        run: ./ios/Scripts/test-ui-smoke.sh -test-iterations 3
      - name: Upload test results
        if: always() && steps.guard.outputs.run == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: ios-uismoke-nightly-results
          path: ios/TestResults-uismoke.xcresult
          retention-days: 14
```

Any nightly failure is triaged the next working session under `docs/process/regression-discipline.md`: a flaky UI test becomes a deterministic lower-level test plus a fixed or quarantined (issue-tracked) UI test — never a silently retried one.

---

## 10. Code signing

### 10.1 Decision: cloud-managed signing (recommended)

The release lane signs with **Xcode cloud-managed distribution signing**: `signingStyle: automatic` + `-allowProvisioningUpdates` authenticated by the App Store Connect API key. Apple mints and holds a cloud-managed Apple Distribution certificate; provisioning profiles are created/refreshed at archive/export time.

Rationale:

- **One secret family.** The same ASC API key (.p8 + Key ID + Issuer ID) drives signing, upload, and the TestFlight metadata API. No `.p12` export, no `match` git repo, nothing else to rotate.
- **No annual renewal toil.** Manually-managed Apple Distribution certificates expire yearly and silently break CI; cloud-managed certificates are Apple's problem.
- **No long-lived private keys on ephemeral runners.** The API key authorizes the operation; the distribution private key never lands in GitHub secrets.
- **Solo-maintainer fit.** `fastlane match`'s value (shared cert state across many devs/apps) does not apply here; it would add a Ruby toolchain and an encrypted repo for nothing.
- **Known risk, accepted with a fallback.** Research brief 24 §7 notes archive-time cloud identity minting can fail opaquely on ephemeral runners. Mitigation: (a) a one-time `workflow_dispatch` validation run before relying on the lane (§16), and (b) the documented manual-keychain fallback below, which can be enabled without restructuring the workflow.

Requirements for cloud signing to work:

- ASC API key with role **App Manager** and **Access to Certificates, Identifiers & Profiles** enabled. If App ID/capability registration returns 403 on first run, perform that one-time registration manually in the developer portal (§10.3) — do not escalate the key to Admin.
- `DEVELOPMENT_TEAM` set (passed on the `xcodebuild archive` command line from the `APPLE_TEAM_ID` repo variable).
- `CODE_SIGN_STYLE=Automatic` in the app target (set in `ios/App/project.yml`).

### 10.2 Fallback: manual keychain import (only if cloud signing fails)

Add these steps before `archive-and-upload.sh` in `ios-release.yml`, and set `signingStyle` to `manual` plus an explicit `provisioningProfiles` map in `ExportOptions.plist`. Secrets `IOS_DIST_CERT_P12_BASE64` / `IOS_DIST_CERT_PASSWORD` exist only in this scenario.

```bash
KEYCHAIN_PASSWORD="$(uuidgen)"
security create-keychain -p "${KEYCHAIN_PASSWORD}" build.keychain
security default-keychain -s build.keychain
security unlock-keychain -p "${KEYCHAIN_PASSWORD}" build.keychain
security set-keychain-settings -t 3600 -u build.keychain
echo "${IOS_DIST_CERT_P12_BASE64}" | base64 --decode > "${RUNNER_TEMP}/dist.p12"
security import "${RUNNER_TEMP}/dist.p12" -k build.keychain \
  -P "${IOS_DIST_CERT_PASSWORD}" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "${KEYCHAIN_PASSWORD}" build.keychain
```

### 10.3 Provisioning: `openagents://` scheme and Sign in with Apple

| Item | Mechanism | Provisioning/profile impact |
| --- | --- | --- |
| `openagents://` URL scheme (auth deep-link handoff, see `04-auth.md`) | `CFBundleURLTypes` Info.plist entry, declared in `ios/App/project.yml` (snippet below) | **None.** Custom URL schemes are Info.plist-only; no entitlement, no App ID capability, no profile change |
| Sign in with Apple (App Store guideline 4.8, see `04-auth.md`) | Entitlements file `ios/App/OpenAgents.entitlements` with `com.apple.developer.applesignin = ["Default"]`; capability enabled on the App ID | Profile must include the capability. Automatic signing with `-allowProvisioningUpdates` registers it; verify once in the portal |
| Keychain token storage (better-auth bearer token, see `04-auth.md`) | Default app keychain, no shared access group in v1 | None |
| Push notifications | **Not in v1** | n/a |

`ios/App/project.yml` Info.plist properties (authoritative project.yml layout lives in `03-architecture.md`; these keys are the CI-relevant contract):

```yaml
info:
  path: Info.plist
  properties:
    CFBundleURLTypes:
      - CFBundleURLName: com.openagents.app.auth
        CFBundleURLSchemes: ["openagents"]
    ITSAppUsesNonExemptEncryption: false # HTTPS-only; prevents "Missing Compliance" blocking TestFlight
```

One-time portal/ASC setup checklist (manual, done before the first release-lane run):

- [ ] Create App ID `com.openagents.app` in the Apple Developer portal (Identifiers → App IDs), enable the **Sign in with Apple** capability.
- [ ] Create the app record in App Store Connect for `com.openagents.app` (name, primary language, SKU); note the numeric **Apple ID** of the app → repo variable `ASC_APP_ID`.
- [ ] App Store Connect → Users and Access → Integrations → App Store Connect API → create a **team key**, role **App Manager**, with certificates/profiles access. Record Key ID, Issuer ID, download the `.p8` once.
- [ ] TestFlight → create internal group `OpenAgents Internal` with **automatic distribution enabled** (every processed build reaches it without an API call).
- [ ] TestFlight → create external group `OpenAgents Beta`; note its group ID (from the ASC URL or `GET /v1/betaGroups`) → repo variable `ASC_EXTERNAL_GROUP_ID`.
- [ ] Set the GitHub secrets/variables from the §14 table.

---

## 11. TestFlight automation

### 11.1 Build-number scheme

- `CFBundleShortVersionString` (marketing version): `MARKETING_VERSION: "1.0.0"` in `ios/App/project.yml`, bumped by ordinary PR. The release lane greps it, so the literal format `MARKETING_VERSION: "x.y.z"` on one line is a contract.
- `CFBundleVersion` (build number): **UTC timestamp `YYYYMMDDHHMM`**, computed at archive time (`TZ=UTC date +%Y%m%d%H%M`) and injected as `CURRENT_PROJECT_VERSION`. Properties: strictly monotonic across the internal (develop) and external (main) lanes with zero coordination or ASC queries; collision-free because `ios-release.yml` serializes uploads with a non-cancelling concurrency group (two uploads can never start in the same minute).
- Traceability (the "commit SHA + deployment id" analog from `docs/process/github-build-process.md`): every successful upload (a) tags the repo `ios-build/<BUILD_NUMBER>` at the built SHA, (b) writes `Build <BUILD_NUMBER> — commit <SHA>` into the TestFlight "What to Test" notes, and (c) embeds the SHA in the binary via the `OABuildCommit` Info.plist key (`OABuildCommit: $(OA_BUILD_COMMIT)` in `project.yml` `info.properties`, with `OA_BUILD_COMMIT` passed as a build setting at archive). The Settings screen surfaces version/build/commit per `07-observability.md`.
- `ExportOptions.plist` sets `manageAppVersionAndBuildNumber: false` so Xcode never rewrites the number.

### 11.2 `ios/App/ExportOptions.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>TEAM_ID_PLACEHOLDER</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
```

`method: app-store-connect` + `destination: upload` is the Apple-native path: `xcodebuild -exportArchive` uploads straight to App Store Connect — no `.ipa` shuffling, no `altool` (dead), no `iTMSTransporter` (legacy), no third-party action.

### 11.3 `ios/Scripts/archive-and-upload.sh`

Inputs via environment: `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_P8`, `APPLE_TEAM_ID`, `BUILD_NUMBER`, `GITHUB_SHA`.

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/env.sh"
cd "${ROOT}"
set -o pipefail

: "${APP_STORE_CONNECT_API_KEY_ID:?}" "${APP_STORE_CONNECT_API_ISSUER_ID:?}"
: "${APP_STORE_CONNECT_API_KEY_P8:?}" "${APPLE_TEAM_ID:?}" "${BUILD_NUMBER:?}"

KEY_PATH="${RUNNER_TEMP:-/tmp}/asc_key.p8"
printf '%s' "${APP_STORE_CONNECT_API_KEY_P8}" > "${KEY_PATH}"

EXPORT_PLIST="${RUNNER_TEMP:-/tmp}/ExportOptions.plist"
cp ios/App/ExportOptions.plist "${EXPORT_PLIST}"
plutil -replace teamID -string "${APPLE_TEAM_ID}" "${EXPORT_PLIST}"

xcodebuild archive \
  -project "${OA_PROJECT}" \
  -scheme "${OA_SCHEME}" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath ios/build/OpenAgents.xcarchive \
  -clonedSourcePackagesDirPath ios/.spm \
  -disableAutomaticPackageResolution \
  -skipMacroValidation -skipPackagePluginValidation \
  -allowProvisioningUpdates \
  -authenticationKeyPath "${KEY_PATH}" \
  -authenticationKeyID "${APP_STORE_CONNECT_API_KEY_ID}" \
  -authenticationKeyIssuerID "${APP_STORE_CONNECT_API_ISSUER_ID}" \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM="${APPLE_TEAM_ID}" \
  CURRENT_PROJECT_VERSION="${BUILD_NUMBER}" \
  OA_BUILD_COMMIT="${GITHUB_SHA:-unknown}"

xcodebuild -exportArchive \
  -archivePath ios/build/OpenAgents.xcarchive \
  -exportOptionsPlist "${EXPORT_PLIST}" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "${KEY_PATH}" \
  -authenticationKeyID "${APP_STORE_CONNECT_API_KEY_ID}" \
  -authenticationKeyIssuerID "${APP_STORE_CONNECT_API_ISSUER_ID}"

rm -f "${KEY_PATH}"
echo "Uploaded build ${BUILD_NUMBER} (commit ${GITHUB_SHA:-unknown}) to App Store Connect."
```

### 11.4 Release notes + group assignment — `ios/Scripts/asc-release-notes.ts`

`destination: upload` cannot set "What to Test" or assign external groups, so a Bun script (zero npm dependencies; ES256 via WebCrypto) finishes the job on a cheap ubuntu runner after upload. Contract:

```
bun run ios/Scripts/asc-release-notes.ts \
  --build-number "$BUILD_NUMBER" \
  --notes-file "$RUNNER_TEMP/notes.txt" \
  --lane internal|external
```

Environment: `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_P8`, `ASC_APP_ID`; `ASC_EXTERNAL_GROUP_ID` (external lane only).

```ts
#!/usr/bin/env bun
// Poll ASC for the uploaded build, set TestFlight "What to Test", and (external
// lane) assign the build to the external beta group, which triggers Beta App Review.

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const buildNumber = args.get("build-number") ?? fail("--build-number required");
const notesFile = args.get("notes-file") ?? fail("--notes-file required");
const lane = args.get("lane") ?? fail("--lane internal|external required");
const keyId = env("APP_STORE_CONNECT_API_KEY_ID");
const issuerId = env("APP_STORE_CONNECT_API_ISSUER_ID");
const keyP8 = env("APP_STORE_CONNECT_API_KEY_P8");
const appId = env("ASC_APP_ID");

function fail(msg: string): never { console.error(msg); process.exit(1); }
function env(name: string): string { return process.env[name] ?? fail(`Missing env ${name}`); }
const b64url = (data: Uint8Array | string) =>
  Buffer.from(data).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function makeJwt(): Promise<string> {
  const der = Buffer.from(
    keyP8.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s/g, ""), "base64");
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

const base = "https://api.appstoreconnect.apple.com";
async function asc(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${await makeJwt()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) fail(`ASC ${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// 1. Poll until the build exists and finishes processing (max 45 min).
let build: any = null;
const deadline = Date.now() + 45 * 60 * 1000;
while (Date.now() < deadline) {
  const result = await asc("GET",
    `/v1/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1`);
  build = result.data[0] ?? null;
  const state = build?.attributes?.processingState;
  if (state === "VALID") break;
  if (state === "FAILED" || state === "INVALID") fail(`Build processing state: ${state}`);
  console.log(`Waiting for build ${buildNumber} (state: ${state ?? "not yet visible"})...`);
  await Bun.sleep(60_000);
}
if (build?.attributes?.processingState !== "VALID") fail("Timed out waiting for build processing");

// 2. Set "What to Test".
const whatToTest = (await Bun.file(notesFile).text()).slice(0, 4000);
const locs = await asc("GET", `/v1/builds/${build.id}/betaBuildLocalizations`);
const enLoc = locs.data.find((l: any) => l.attributes.locale === "en-US");
if (enLoc) {
  await asc("PATCH", `/v1/betaBuildLocalizations/${enLoc.id}`, {
    data: { type: "betaBuildLocalizations", id: enLoc.id, attributes: { whatToTest } },
  });
} else {
  await asc("POST", "/v1/betaBuildLocalizations", {
    data: {
      type: "betaBuildLocalizations",
      attributes: { locale: "en-US", whatToTest },
      relationships: { build: { data: { type: "builds", id: build.id } } },
    },
  });
}
console.log(`Set What to Test for build ${buildNumber}.`);

// 3. External lane: assign to the external group (triggers Beta App Review on first build).
if (lane === "external") {
  const groupId = env("ASC_EXTERNAL_GROUP_ID");
  await asc("POST", `/v1/betaGroups/${groupId}/relationships/builds`, {
    data: [{ type: "builds", id: build.id }],
  });
  console.log(`Assigned build ${buildNumber} to external group ${groupId}.`);
}
```

Internal lane needs no group call: `OpenAgents Internal` has automatic distribution enabled (§10.3 checklist), so every processed build reaches internal testers without review.

### 11.5 Release-notes content

Generated in the workflow from commits since the last upload tag, scoped to iOS-relevant paths:

```bash
git fetch --tags --quiet
LAST_TAG="$(git tag --list 'ios-build/*' --sort=-creatordate | head -1)"
RANGE="${LAST_TAG:+${LAST_TAG}..HEAD}"
{
  echo "Build ${BUILD_NUMBER} — commit ${GITHUB_SHA}"
  echo ""
  git log --no-merges --pretty='- %s' ${RANGE:--20} -- ios/ apps/web/openapi.json | head -40
} > "${RUNNER_TEMP}/notes.txt"
```

---

## 12. Release workflow — `.github/workflows/ios-release.yml`

```yaml
name: iOS Release

on:
  push:
    branches: ["develop", "main"]
    paths:
      - "ios/**"
      - ".github/workflows/ios-release.yml"
  workflow_dispatch:
    inputs:
      lane:
        description: "TestFlight lane"
        type: choice
        options: ["auto", "internal", "external"]
        default: "auto"

concurrency:
  group: ios-release
  cancel-in-progress: false # serializes uploads; guarantees unique YYYYMMDDHHMM build numbers

permissions:
  contents: write # tag pushes in postprocess

jobs:
  ios-ui-smoke:
    name: ios-ui-smoke
    runs-on: macos-26
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4
      - name: Select Xcode and verify simulator
        run: ./ios/Scripts/select-xcode.sh
      - name: Cache SPM checkouts
        uses: actions/cache@v4
        with:
          path: ios/.spm
          key: spm-${{ runner.os }}-${{ hashFiles('ios/Scripts/env.sh') }}-${{ hashFiles('ios/App/Package.resolved', 'ios/Packages/**/Package.resolved') }}
      - name: Generate Xcode project
        run: ./ios/Scripts/generate-project.sh
      - name: UI smoke
        run: ./ios/Scripts/test-ui-smoke.sh
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ios-uismoke-release-results
          path: ios/TestResults-uismoke.xcresult
          retention-days: 30

  ios-archive-upload:
    name: ios-archive-upload
    needs: ios-ui-smoke
    runs-on: macos-26
    timeout-minutes: 45
    outputs:
      build_number: ${{ steps.meta.outputs.build_number }}
      lane: ${{ steps.meta.outputs.lane }}
    steps:
      - uses: actions/checkout@v4
      - name: Select Xcode
        run: ./ios/Scripts/select-xcode.sh
      - name: Cache SPM checkouts
        uses: actions/cache@v4
        with:
          path: ios/.spm
          key: spm-${{ runner.os }}-${{ hashFiles('ios/Scripts/env.sh') }}-${{ hashFiles('ios/App/Package.resolved', 'ios/Packages/**/Package.resolved') }}
      - name: Generate Xcode project
        run: ./ios/Scripts/generate-project.sh
      - name: Compute build metadata
        id: meta
        run: |
          BUILD_NUMBER="$(TZ=UTC date +%Y%m%d%H%M)"
          if [ "${{ github.event_name }}" = "workflow_dispatch" ] && [ "${{ inputs.lane }}" != "auto" ]; then
            LANE="${{ inputs.lane }}"
          elif [ "${{ github.ref_name }}" = "main" ]; then
            LANE="external"
          else
            LANE="internal"
          fi
          echo "build_number=${BUILD_NUMBER}" >> "$GITHUB_OUTPUT"
          echo "lane=${LANE}" >> "$GITHUB_OUTPUT"
          echo "Build ${BUILD_NUMBER}, lane ${LANE}, commit ${GITHUB_SHA}" >> "$GITHUB_STEP_SUMMARY"
      - name: Archive and upload to App Store Connect
        env:
          APP_STORE_CONNECT_API_KEY_ID: ${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}
          APP_STORE_CONNECT_API_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_API_ISSUER_ID }}
          APP_STORE_CONNECT_API_KEY_P8: ${{ secrets.APP_STORE_CONNECT_API_KEY_P8 }}
          APPLE_TEAM_ID: ${{ vars.APPLE_TEAM_ID }}
          BUILD_NUMBER: ${{ steps.meta.outputs.build_number }}
        run: ./ios/Scripts/archive-and-upload.sh

  ios-testflight-postprocess:
    name: ios-testflight-postprocess
    needs: ios-archive-upload
    runs-on: ubuntu-latest # ASC processing poll runs on cheap minutes, not macOS
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.2.14"
      - name: Generate release notes
        env:
          BUILD_NUMBER: ${{ needs.ios-archive-upload.outputs.build_number }}
        run: |
          git fetch --tags --quiet
          LAST_TAG="$(git tag --list 'ios-build/*' --sort=-creatordate | head -1)"
          RANGE="${LAST_TAG:+${LAST_TAG}..HEAD}"
          {
            echo "Build ${BUILD_NUMBER} — commit ${GITHUB_SHA}"
            echo ""
            git log --no-merges --pretty='- %s' ${RANGE:--20} -- ios/ apps/web/openapi.json | head -40
          } > "${RUNNER_TEMP}/notes.txt"
          cat "${RUNNER_TEMP}/notes.txt"
      - name: Set What to Test and assign group
        env:
          APP_STORE_CONNECT_API_KEY_ID: ${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}
          APP_STORE_CONNECT_API_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_API_ISSUER_ID }}
          APP_STORE_CONNECT_API_KEY_P8: ${{ secrets.APP_STORE_CONNECT_API_KEY_P8 }}
          ASC_APP_ID: ${{ vars.ASC_APP_ID }}
          ASC_EXTERNAL_GROUP_ID: ${{ vars.ASC_EXTERNAL_GROUP_ID }}
        run: |
          bun run ios/Scripts/asc-release-notes.ts \
            --build-number "${{ needs.ios-archive-upload.outputs.build_number }}" \
            --notes-file "${RUNNER_TEMP}/notes.txt" \
            --lane "${{ needs.ios-archive-upload.outputs.lane }}"
      - name: Tag build
        run: |
          git tag "ios-build/${{ needs.ios-archive-upload.outputs.build_number }}" "${GITHUB_SHA}"
          git push origin "ios-build/${{ needs.ios-archive-upload.outputs.build_number }}"
      - name: Summary
        run: |
          {
            echo "TestFlight ${{ needs.ios-archive-upload.outputs.lane }} build ${{ needs.ios-archive-upload.outputs.build_number }}"
            echo "Commit: ${GITHUB_SHA}"
            echo "Tag: ios-build/${{ needs.ios-archive-upload.outputs.build_number }}"
          } >> "$GITHUB_STEP_SUMMARY"
```

---

## 13. Release train mapped onto the repo flow

The iOS lane reuses the repo's existing branch model (`docs/process/github-build-process.md`) verbatim; only the deployment targets change:

| Repo event | Web meaning | iOS meaning |
| --- | --- | --- |
| Feature PR → `develop` | Vercel Preview deployment | `ios-ci.yml` gate (lint, build, unit+snapshot, drift); simulator artifacts in `.xcresult` are the "preview" |
| Merge → `develop` (touching `ios/**`) | Shared dev deployment | `ios-release.yml` internal lane: UI smoke → archive → **TestFlight internal** (`OpenAgents Internal`, no review) |
| Release PR `develop` → `main`, merged | Production deployment | `ios-release.yml` external lane: UI smoke → archive → **TestFlight external** (`OpenAgents Beta`, Beta App Review on first build of a version) |
| Production smoke | `vercel rollback` available | Install the external build from TestFlight on a device, exercise sign-in + open session + stream (protected paths from `01-product-and-ux.md`); rollback is **fix-forward** — expire the bad build in ASC, ship a fix; server-side compatibility flags are the real lever (`02-api-contract-and-networking.md`) |
| App Store submission | n/a | **Manual in v1**: ASC → select the externally-tested build → submit for review. Automate later only if cadence demands it |

Required PR checks for any PR (after §4's branch-protection update): `lint-and-typecheck` (existing, always runs) **and** `ios-gate` (passes instantly on non-iOS PRs). PRs touching both trees must be green on both; an iOS-only PR still gets a vacuous-but-green `lint-and-typecheck`, and a web-only PR a vacuous-but-green `ios-gate` — both cheap.

Hotfixes follow the repo rule: branch from `main`, PR to `main` (external lane fires on merge), then merge `main` back into `develop`.

Per-PR process requirements (issue templates, red/green TDD commits, PR template sections) are unchanged; iOS slices substitute `./ios/Scripts/ci.sh` for `bun --bun run ci` in free-text fields as described in §6, and fill `## Preview / Release Safety` with: lane (internal/external), build number + tag once uploaded, UI smoke result, and the fix-forward rollback statement.

---

## 14. Secrets and variables inventory

GitHub → repo `dennisonbertram/fork-open-agents` → Settings → Secrets and variables → Actions. Set with `gh secret set <NAME>` / `gh variable set <NAME>`.

| Name | Kind | Value / source | Used by | Rotation |
| --- | --- | --- | --- | --- |
| `APP_STORE_CONNECT_API_KEY_ID` | Secret | Key ID from ASC → Users and Access → Integrations | `ios-release.yml` (archive, upload, postprocess) | Only if key revoked |
| `APP_STORE_CONNECT_API_ISSUER_ID` | Secret | Issuer ID from the same ASC page | same | Never (team-stable) |
| `APP_STORE_CONNECT_API_KEY_P8` | Secret | Full PEM contents of the downloaded `.p8` (including BEGIN/END lines) | same | On key revocation; ASC allows multiple active keys for zero-downtime rotation |
| `APPLE_TEAM_ID` | Variable | 10-char team ID from the developer portal membership page | `archive-and-upload.sh` | Never |
| `ASC_APP_ID` | Variable | Numeric Apple ID of the app record (ASC → App Information) | `asc-release-notes.ts` | Never |
| `ASC_EXTERNAL_GROUP_ID` | Variable | UUID of the `OpenAgents Beta` group (`GET /v1/betaGroups` or ASC URL) | `asc-release-notes.ts` (external lane) | If group recreated |
| `IOS_DIST_CERT_P12_BASE64` | Secret (fallback only) | base64 of an exported Apple Distribution `.p12` | §10.2 fallback steps | Annually (cert expiry) — this toil is why cloud signing is primary |
| `IOS_DIST_CERT_PASSWORD` | Secret (fallback only) | `.p12` export password | §10.2 fallback steps | With the cert |

Explicit non-needs: iOS CI requires **no** backend secrets (`POSTGRES_URL`, `BETTER_AUTH_SECRET`, etc.) — unit, snapshot, and UI smoke tests run against in-process mocks per `06-testing-strategy.md`; no third-party telemetry DSNs in v1 unless `07-observability.md` adds one. Redaction rule: the `.p8` is written only to `${RUNNER_TEMP}` and deleted in `archive-and-upload.sh`; never `echo` key material; GitHub masks secret values in logs but scripts must still avoid `set -x` around secret handling.

---

## 15. Runner cost notes and mitigations

Prices (private repos, Jan 2026 pricing): standard macOS **$0.062/min**, ubuntu $0.006/min. Public repos: standard runners free. This fork is private, so macOS minutes are real money.

| Job | Runner | Typical duration | Cost/run |
| --- | --- | --- | --- |
| `changes` + `ios-gate` (every PR, incl. web-only) | ubuntu | ~2 min total | ~$0.01 |
| `ios-build-test` (iOS PRs, warm cache) | macos-26 | ~12 min | ~$0.74 |
| `ios-api-drift` (iOS or contract PRs, warm cache) | macos-26 | ~6 min | ~$0.37 |
| `ios-ui-smoke` (release lane) | macos-26 | ~20 min | ~$1.24 |
| `ios-archive-upload` | macos-26 | ~20 min | ~$1.24 |
| `ios-testflight-postprocess` (incl. ASC poll) | ubuntu | ~20 min | ~$0.12 |
| Nightly UI smoke (×3 iterations, only when ios/ changed) | macos-26 | ~30 min | ~$1.86 |

Rough month (40 iOS PR runs, 15 internal releases, 4 external releases, 20 active nightlies): ≈ $44 + $39 + $10 + $37 ≈ **$130/month**. Acceptable; revisit if PR volume triples.

Mitigations, in order of leverage (already designed in above):

1. **Path filtering via the `changes` job** — web-only PRs never touch macOS (§4).
2. **Per-ref concurrency cancellation** on `ios-ci.yml` — force-pushes kill stale runs.
3. **SPM cache** keyed on `Package.resolved` + `env.sh`; the codegen `.build` cache spares the drift job a swift-syntax rebuild (~5–10 min cold).
4. **UI smoke out of the PR gate** — nightly + release lanes only, with the nightly 25-hour change guard.
5. **ASC processing poll on ubuntu**, not macOS (~$1.10 saved per release).
6. **No `macos-26-xlarge`** ($0.16/min) unless the PR gate exceeds 20 min with a warm cache for two consecutive weeks.
7. **Test sharding: explicitly deferred.** Only adopt when the `UnitTests` plan alone exceeds ~20 min warm; the mechanism is already compatible (build once with `build-for-testing`, fan out `test-without-building -only-testing:` shards across parallel jobs). Do not pre-build this.

---

## 16. Execution checklist (ordering lives in `09-step-by-step-build-guide.md`)

- [ ] One-time: complete the Apple portal/ASC setup checklist (§10.3) and set all §14 secrets/variables.
- [ ] One-time: on a scratch branch, run a `macos-26` job that executes `xcrun simctl list devices available` and `ls /Applications/Xcode*.app`; confirm/correct `OA_XCODE_VERSION`, `OA_SIM_NAME`, `OA_SIM_OS` in `ios/Scripts/env.sh`.
- [ ] Commit `ios/Scripts/*` (all of §2's script list), `ios/.swift-format`, `ios/App/ExportOptions.plist`, and the three workflow files. Pushing workflows requires `gh auth refresh -s workflow` first.
- [ ] Verify web tooling ignores `ios/**` (ultracite/oxlint config, `turbo`, `scripts/test-isolated.ts` glob — it already excludes non-`.test.ts(x)` files, so Swift is invisible by construction; confirm `bun --bun run ci` is unaffected by the `ios/` tree).
- [ ] Open a trivial iOS PR (e.g. comment change under `ios/`) and a trivial web-only PR; confirm `ios-gate` goes green on both, with macOS jobs running only on the former.
- [ ] Add `ios-gate` to required checks on `develop` and `main` (§4 commands), then re-verify both PRs still merge.
- [ ] One-time cloud-signing proof: `gh workflow run ios-release.yml --ref develop -f lane=internal`; evidence to record per `docs/process/observability-discipline.md`: workflow summary (build number, SHA, lane), the `ios-build/<n>` tag, the build visible in TestFlight with What to Test populated, install on one device. If archive fails on signing, file the fallback slice (§10.2) before retrying.
- [ ] First external proof on `main`: confirm Beta App Review passes for the `OpenAgents Beta` group; record the review turnaround in the release PR.
- [ ] Follow-up process slices (file as standard feature-slice issues): `docs/process/ios-gate.md` documenting `./ios/Scripts/ci.sh` as the iOS formatting/CI gate; optional `ios-feature-slice.yml` issue-template variant with iOS commands baked in.

## 17. Open items

| Item | Owner doc / trigger |
| --- | --- |
| Exact Xcode 26.x point version and simulator device names on `macos-26` at execution time | §16 scratch-branch job; update `env.sh` |
| Whether cloud-managed archive signing works first try on hosted runners | §16 cloud-signing proof; fallback §10.2 pre-written |
| App Store submission automation (ASC `appStoreVersions` API) | Deferred; manual checklist in §13 until release cadence justifies it |
| Crash-reporting/symbol pipeline beyond `uploadSymbols: true` | `07-observability.md` |
| Public vs private repo (macOS minutes free vs ~$130/mo) | Operator decision; all math in §15 assumes private |
