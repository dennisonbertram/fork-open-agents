# Process Rules Brief — what an iOS workstream must comply with

Ground truth gathered from actual repo files (June 2026). Every claim cites a file. This is the
engineering-process contract ALL work in `dennisonbertram/fork-open-agents` follows; section E flags
what is web-specific and must be explicitly adapted for a native Swift/SwiftUI sub-project.

Sources read (all absolute under `/Users/dennison/develop/open-agents/`):
`CLAUDE.md`, `docs/process/index.md`, `docs/process/feature-ticket-format.md`,
`docs/process/github-build-process.md`, `docs/process/development-workflow.md`,
`docs/process/behavior-tdd.md`, `docs/process/regression-discipline.md`,
`docs/process/formatting-gate.md`, `docs/process/observability-discipline.md`,
`docs/process/local-development.md`, `docs/process/production-release-runbook.md`,
`docs/process/managed-runtime-proof-standard.md`, `docs/process/workflow-catalog-conventions.md`,
`docs/agents/code-style.md`, `docs/agents/lessons-learned.md`,
`.github/ISSUE_TEMPLATE/*.yml`, `.github/pull_request_template.md`, `.github/workflows/ci.yml`,
`.github/workflows/preview-smoke.yml`, root `package.json`, `scripts/test-isolated.ts`,
live `gh label list` and live epic issues (#244 etc.).

---

## A. GitHub issue templates — exact structure and labels

Blank issues are **disabled** (`.github/ISSUE_TEMPLATE/config.yml:1` — `blank_issues_enabled: false`).
All issues created or materially edited by agents MUST use a standard template
(`CLAUDE.md` "Repository Ownership" + "Build Process" sections; `docs/process/feature-ticket-format.md:18-20`).
Repo target is the fork `dennisonbertram/fork-open-agents` — never `vercel-labs/open-agents`
(`CLAUDE.md` ownership policy; `docs/agents/lessons-learned.md:125-129`).

### A.1 Feature slice (`.github/ISSUE_TEMPLATE/feature-slice.yml`)

- name: `Feature slice`; title prefix: `"feat: "`; auto-labels: `["type:feature"]` (lines 1-4).
- All 16 textareas are `required: true`. Verbatim section labels, in order:
  1. `Why this matters`
  2. `User/operator path protected` (placeholder: "A user/operator can ...")
  3. `Behavior contract` (Given/When/Then scenario form)
  4. `Product and design spec` (placeholder fields: Entry point / Primary flow /
     Empty/loading/success/error states / Permissions/auth boundaries /
     Accessibility/usability notes / Copy or terminology)
  5. `Integration spec` (placeholder fields: Routes/components/API surfaces;
     Agent/sandbox/workflow surfaces; Data model/migrations/events/background jobs;
     External services/config/env vars; Observability/status/logging/evidence;
     Backward compatibility)
  6. `In scope`
  7. `Out of scope`
  8. `Research and context sources` (Repo docs / External docs or Context7 IDs /
     Prior issues/incidents / Decision or assumption)
  9. `Agent todo checklist` — pre-filled ordered checkbox value (feature-slice.yml:96-109),
     ending with `Run \`bun --bun run ci\`, or document approved/pre-existing failures.` and
     `Update docs with verification and observability notes.`
  10. `Tests to add first` (Smallest unit/contract test: Test file / Expected red command /
      Expected red reason; Behavior/integration proof: same trio; "What should only go green
      after all lower-level TDD tests pass")
  11. `Observability and user feedback` — placeholder enforces sub-headings:
      `### User-visible status`, `### Structured events` (Service name + per-event level and
      fields like `{ userId, sessionId, chatId, requestId, outcome, latencyMs }`),
      `### Error taxonomy` (typed error kinds), `### Correlation` (IDs + runtime attribution),
      `### Redaction` (Never log / Redaction helper or boundary), `### Debug recipes`
      (grep-able commands), `### Evidence` (screenshots/browser/service)
  12. `Regression harness plan` — sub-headings `### Existing coverage`, `### New coverage to add`,
      `### Verify fail-before / pass-after`, `### Limits`
  13. `TDD audit trail` — pre-filled checkboxes: Red test commit planned (Commit /
      Failing command/output), Green implementation commit planned (Commit /
      Passing command/output), "If red and green work cannot be separated into commits, explain why"
  14. `Regression risks and concerns` (Risk / Mitigation/test / Open concern)
  15. `Deploy or migration impact` (Vercel, Neon, Upstash, GitHub App, workflow, sandbox,
      docs, env var impacts; default "None")
  16. `Definition of done` — pre-filled checkbox value (feature-slice.yml:230-242), verbatim:
      - [ ] Smallest behavior/contract test observed red first
      - [ ] Behavior/integration proof observed red before implementation when applicable
      - [ ] Red test commit exists on the work branch, or exception is documented
      - [ ] Green implementation commit exists after the red test commit, or exception is documented
      - [ ] Targeted tests pass
      - [ ] Adjacent suite passes
      - [ ] `git diff --check` passes
      - [ ] `bun --bun run ci` passes or approved/pre-existing failures are documented
      - [ ] Regression harness plan implemented or explicitly deferred with rationale
      - [ ] Docs updated
      - [ ] Observability evidence is available to users/operators
      - [ ] Deploy notes included

The prose version of this list (matching 1:1) is `docs/process/feature-ticket-format.md:24-54`.
Observability section quality bar with good/weak examples: feature-ticket-format.md:56-91
("Add logs." is explicitly called out as a weak section). Checklist quality bar:
feature-ticket-format.md:110-135 ("Checklist items should name files, commands, routes, or user
paths when known").

### A.2 Bug regression (`.github/ISSUE_TEMPLATE/bug-regression.yml`)

- name: `Bug regression`; title prefix `"fix: "`; auto-labels `["type:bug", "type:regression"]` (lines 1-4).
- Verbatim section labels, in order (all required):
  1. `Observed behavior`
  2. `Expected behavior`
  3. `Forbidden behavior` ("Which repo rule, protected path, provider contract, or unacceptable
     behavior does this violate?")
  4. `Reproduction` (deterministic local steps; if live-only, say what local regression should be created)
  5. `Regression test plan` (Smallest regression test + Behavior/integration proof, each with
     Test file / Expected red command / Expected red reason; "What should only go green after the fix")
  6. `Blast radius`
  7. `Observability evidence` (same `### Structured events` / `### Error taxonomy` /
     `### Correlation` / `### Redaction` / `### Debug recipes` / `### Proof` shape)
  8. `Research and context sources`
  9. `Agent todo checklist` (pre-filled; reproduce → failing regression test → red commit →
     smallest fix → green commit → adjacent suite → docs → deploy/rollback notes)
  10. `TDD audit trail` (red regression commit + green fix commit planned)
  11. `Definition of done` (bug variant, bug-regression.yml:152-165; includes
      "Forbidden behavior is covered by regression assertions" and
      "`bun --bun run ci` passes or approved/pre-existing failures are documented")

### A.3 Research spike (`.github/ISSUE_TEMPLATE/research-spike.yml`)

- title prefix `"research: "`; auto-label `["type:research"]`.
- Sections: `Question`, `Options to compare`, `Documentation sources` (Context7 IDs expected),
  `Decision criteria` (Security / Reliability / Developer experience / Testability /
  Observability / Cost-runtime risk), `Agent todo checklist`, `Expected output`
  (recommendation captured in `docs/research/` or a process doc; follow-up issues;
  "No production code changed unless explicitly promoted to implementation").

### A.4 UX finding (`.github/ISSUE_TEMPLATE/ux-finding.yml`)

- title prefix `"[UX] "`; auto-label `["ux-finding"]`. One discrete finding per issue,
  evidence-grounded. Dropdowns: `Severity` (Critical/Major/Minor), `Finding type` (8 options).
  Fields: `Surface / location`, `Persona & journey`, `What happened (the confusion)`,
  `What the user expected`, `Evidence`, `UX assessment`, `Suggested direction (non-prescriptive)`,
  `Frequency`, pre-submit checkboxes (single finding; evidence included; "Filed against the
  operator's fork (not vercel-labs upstream)").

### A.5 Epics — convention, not a template

There is NO epic `.yml` template. Observed live convention (gh label/issue data, e.g. #244, #264):

- Labels: `epic` (+ usually `type:feature`; sometimes `status:grooming`/`status:ready`).
- Title prefix: `epic: <name>` (older ones: `feat: epic — ...`).
- Free-form body but with consistent headings observed in #244:
  `## Vision`, `## Why`, `## Scope`, `## Current state to build on / reconcile`,
  `## Key design questions (to resolve in grooming)`, `## Phased plan (proposed)`
  (each phase independently shippable + tested), `## Definition of done (epic-level)`,
  plus a `<sub>` footer linking related issues.
- CLAUDE.md rule: "Whenever an agent creates a non-trivial plan, roadmap, epic, or implementation
  breakdown, first create or identify the corresponding GitHub issue or epic ... The issue/epic is
  the durable record of what is being built and why; planning docs ... must link back to the
  issue/epic instead of replacing it."

### A.6 Label vocabulary (live `gh label list` output)

- Type: `type:feature`, `type:bug`, `type:regression` ("Must include a failing regression test
  first"), `type:research` (label exists via template; not in default list dump but applied by
  research-spike template), `epic` ("Multi-slice epic").
- Status workflow (used by groom/implement loops): `status:grooming`, `status:ready`
  ("Groomed and ready for autonomous implementation"), `status:in-progress`
  ("Currently being worked by issue-implementer"), `status:blocked`
  ("Exhaustively groomed but a path-decision needs a human"), `status:kill` (kill switch).
- Severity: `severity:critical`, `severity:high`, `severity:medium`, `severity:low`.
- UX: `ux-finding`, `ux-walker`, `ux-improvement`.
- Plus GitHub defaults (`bug`, `enhancement`, `documentation`, ...).

---

## B. Branch/PR flow, commits, and the CI gate

### B.1 Branch model (`docs/process/github-build-process.md:52-98`; CLAUDE.md "Git Commands")

```
feature branch -> PR into develop -> shared dev deployment
develop        -> release PR into main
main           -> production deployment
```

- Branch feature work from `origin/develop`; PRs target `develop`. Only release PRs (and explicit
  production hotfixes) target `main`. Hotfixes branch from `main`, then `main` is merged back into
  `develop` (github-build-process.md:130-132).
- One branch implements one primary issue; worktrees for parallel work
  (`git worktree add -b <branch> .worktrees/<branch> origin/develop`).
- No direct pushes to `develop`/`main` — branch protection requires PRs
  (github-build-process.md:62-63, 234-246). Protection on both branches: require PR, require the
  **`lint-and-typecheck` status check**, require branch up to date before merge, require
  conversation resolution, include administrators, block force pushes/deletions. Approvals NOT
  currently required (solo maintainer; github-build-process.md:244-246).
- Sync preference: merge `origin/develop` into the branch, do NOT rebase, unless explicitly asked
  (CLAUDE.md "Branch sync preference").
- Memory note: release PRs from develop→main can show BEHIND but still auto-merge
  (user memory `open-agents-develop-main-release-flow`); pushing `.github/workflows/*` requires
  `gh auth refresh -s workflow` first (memory `workflow-scope-push-block`).
- CLAUDE.md end-of-work rule: "always preserve the work in Git: create an intentional commit, push
  it to the user's fork/workspace, and open a pull request before calling the task complete."
  Stage only files belonging to the implementation.

### B.2 Commit conventions (observed in `git log`, enforced by templates)

Conventional-commit style with scope and issue reference:

- `feat(agents): policy-gated agent-authored Composio tools with provenance (#242)`
- `fix(sessions): collapse sidebar to a narrow icon rail instead of hiding it (#30)`
- Red/green TDD audit commits use dedicated prefixes:
  `test(red): TASK-242 failing tests for ...` then `feat(...): ... (#242)` then optionally
  `test(regression): TASK-242 regression coverage for ...`.
- Branch names: `feat/<slug>`, `fix/<slug>`, `integration/<slug>` (observed: current branch
  `feat/agents-phase6-authored-tools`).

### B.3 PR template (`.github/pull_request_template.md`) — verbatim sections

`## Summary` (+ base-branch checkboxes: "Feature/integration PR targets `develop`" /
"Production release/hotfix PR targets `main`"), `## Scope` (In scope / Out of scope),
`## Product / UX` (Entry point / User-visible behavior / States covered / Accessibility notes),
`## Integration` (Routes/components/API surfaces; Agent/sandbox/workflow surfaces;
Data/events/background jobs; External services/config; Observability; Backward compatibility),
`## Test Evidence` (red observed first; red commit; green commit; targeted tests;
behavior/integration tests; adjacent suite; `git diff --check`; `bun --bun run ci`),
`## Preview / Release Safety` (Risk tier: Low/Medium/High; Vercel Preview URL; Preview smoke
passed or N/A; Agent Browser Preview review or N/A; Dev smoke required?; Production smoke plan;
Rollback plan), `## Docs`, `## Deploy / Migration Notes` (Vercel / Neon-migrations /
Upstash-Redis-KV / GitHub App-OAuth / Sandbox-runtime profiles / Rollback), `## Linked Issue`
(`Closes #`).

Every PR must answer 8 questions (github-build-process.md:209-221): what changed, what's out of
scope, what test failed first, what tests are now green, what docs changed, what observability
proves it works, what deploy/migration steps, what rollback path.

Merge gate (github-build-process.md:223-231): issue exists (or docs-only rationale), tests
added/updated for behavior change, regressions covered for bugs, docs describe reality, CI passes,
one clean PR-sized slice.

### B.4 The CI gate — what `bun run ci` is and what GitHub runs

Root `package.json` script:
`"ci": "bun run check && bun run typecheck && bun run test:isolated && bun run --cwd apps/web db:check"`
where `check` = `ultracite check` (oxlint + oxfmt), `typecheck` = `turbo typecheck`,
`test:isolated` = `scripts/test-isolated.ts` which globs every `**/*.test.ts(x)` (excluding
`node_modules/` and dotdirs) and runs **each test file in its own `bun test` process**, failing on
the first failing file (test-isolated.ts:24-38). Local runs prefer `bun --bun run ci` so native
oxfmt bindings load under Bun (CLAUDE.md "CI/script execution rules"; lessons-learned.md:18).

GitHub Actions (`.github/workflows/ci.yml`): single job named **`lint-and-typecheck`** (this exact
name is the required status check), `runs-on: ubuntu-latest`, 20-min timeout, Bun pinned `1.2.14`,
steps: `bun install --frozen-lockfile` → `bun run check` → `bun run typecheck` →
`bun run test:isolated` → `bun run --cwd apps/web db:check`. Triggers: push to `main`, PRs to any
branch, with per-ref concurrency cancellation.

Second workflow `.github/workflows/preview-smoke.yml`: on `deployment_status` success for
non-Production environments, runs `bun run --cwd apps/web preview:smoke` against
`DEPLOYMENT_URL` with `VERCEL_AUTOMATION_BYPASS_SECRET`.

**What an iOS-equivalent gate must provide** (functional parity, see also section E):
(1) deterministic format/lint check, (2) compile/typecheck of all targets, (3) the full unit test
suite run reliably (the repo deliberately isolates test files to avoid cross-file state bleed —
an iOS plan should note the analogous concern: parallel/clean simulator state per test run),
(4) a schema/contract check analog (here `db:check` validates Drizzle migrations; iOS analog is
API-contract validation against the generated OpenAPI client — see
`docs/process/api-openapi-contract.md` and `bun run test:contract`), (5) it must be wired as a
required PR status check; either reuse/extend the required check name `lint-and-typecheck` or
update branch protection to add a new required check (an open decision, see Open Questions).

### B.5 Release promotion (production-release-runbook.md)

- Before merge (every non-trivial PR): CI green, Vercel Preview ready, preview smoke passed, PR
  lists risk tier/test evidence/deploy notes/rollback plan, Agent Browser Preview review recorded
  for browser-visible changes (runbook:5-13).
- High-risk surfaces: auth, ownership, secrets, billing, inference, GitHub App, sandbox,
  workflows, migrations (runbook:22-23). High-risk PRs additionally need dev smoke, migration
  compatibility classification, named live-service risks, rollback classified app-only vs
  fix-forward.
- Path: merge to `develop` → Vercel deploys shared `dev` env
  (`https://open-agents-env-dev-dennisons-projects.vercel.app`) → smoke dev → release PR
  `develop`→`main` → production deploy → immediate production smoke → rollback fast if smoke fails
  (`vercel rollback`). Record commit SHA, deployment URL/id, smoke result, rollback path.
- Migration rollback rule: every schema change states app-only rollback vs forward-compatible vs
  fix-forward; never ship destructive migration in the same PR that removes the app fallback
  (runbook:142-151).

---

## C. Behavior-TDD and regression discipline (as they'd apply to Swift tests)

### C.1 Behavior-first TDD (`docs/process/behavior-tdd.md`)

Core rule (behavior-tdd.md:7-13): **Name the protected path first. Write/identify the failing
behavior test second. Only then change implementation.** Unit tests are the inner loop; the outer
contract is the user/operator outcome.

Required order (behavior-tdd.md:14-31), directly transferable to Swift:

1. Name the protected path (e.g. "a signed-in user can open a session and watch the agent stream").
2. Add lower-level unit/contract tests for the smallest missing behavior
   (Swift: `XCTest`/Swift Testing unit tests on view models, API client decoding, SSE parsing).
3. Add or identify the larger behavior/integration/regression proof
   (Swift: an integration test against a stubbed `URLProtocol` server or a contract test against
   the OpenAPI spec; XCUITest for UI-visible paths).
4. Run targeted commands and confirm the expected RED state.
5. **Commit the failing test-only state on the work branch when practical** (observed convention:
   `test(red): ...` commit).
6. Smallest implementation change that turns lower-level tests green.
7. Re-run the original path proof — it should only go green once lower-level behavior is fixed.
8. Commit green implementation separately from the red commit when practical.
9. Run the adjacent suite. 10. Refactor only while green.

"Broken-test commits are audit evidence, not a mergeable final state" (behavior-tdd.md:29-31) —
they live on work branches/PRs; document any reason red and green could not be separated.

Skip conditions (behavior-tdd.md:66-76): a new behavior test may be skipped ONLY when the change
is docs/comments/formatting/mechanical-metadata-only AND no runtime behavior/config/deploy
path/provider contract/storage/user path changes AND an existing test owner is named if there is
any risk. State the reason in PR notes.

Checklist template to embed in issues/PRs (behavior-tdd.md:48-64): path named / behavior test
file / behavior RED command / expected red reason / unit RED tests / red commit / unit GREEN
command / behavior GREEN command / green commit / adjacent suite command / repo-level check command.

Surrounding rules from development-workflow.md: non-negotiables include "Prefer deterministic
tests before live services, live models, or production sandboxes" (line 15-16) and "Do not
normalize a red suite. Record the baseline and avoid increasing the failure count" (line 18-19).
Deterministic-first proof ladder (development-workflow.md:143-156): pure unit/contract →
integration with deterministic mocks → local service smoke → browser smoke → Preview smoke →
dev/production smoke; live LLMs/real repos/prod DBs are "canaries, not the primary regression
suite."

Swift translation the plan should propose explicitly: RED command = e.g.
`xcodebuild test -scheme OpenAgents -only-testing:OpenAgentsTests/SessionStreamTests` (or
`swift test --filter ...` for SPM packages); deterministic mocks = `URLProtocol` stubs / recorded
fixtures of the SSE chat stream; "adjacent suite" = the test target owning the touched module;
"repo-level check" = the iOS CI gate command (section E).

### C.2 Regression discipline (`docs/process/regression-discipline.md`)

A bug fix is complete only when the regression test: (1) fails without the fix, (2) passes with
it, (3) runs in the smallest suite that owns the behavior, (4) feeds a behavior/integration proof
when the bug crosses a user/operator path, (5) has a red/green audit trail on the work branch when
practical (regression-discipline.md:7-15).

Regression mandatory for (regression-discipline.md:34-43): production incident; user-visible bug;
auth/ownership/secret/billing boundary bug; workflow/retry/timeout/resume/duplicate-side-effect
bug; migration or data-compatibility bug; managed runtime/sandbox/browser/service preview bug;
code-review finding identifying a real failure mode. iOS equivalents: keychain/token handling
bugs, background refresh/retry bugs, offline-cache migration bugs, push-notification dedupe bugs
all fall under "mandatory regression."

"Live Bugs Become Deterministic" (regression-discipline.md:44-49): bugs found via production,
live LLM behavior, live browser runs, or manual QA must be converted to the closest deterministic
local test; a live smoke may remain as a canary but never the only protection. (iOS: a bug seen on
a device against prod must become a unit/integration test with a recorded fixture.)

Also: update `docs/agents/lessons-learned.md` when a bug teaches a durable repo lesson
(regression-discipline.md:31-32; CLAUDE.md header makes lessons-learned a living document).

---

## D. Observability evidence requirements

### D.1 Core discipline (`docs/process/observability-discipline.md`)

"Observability is part of the feature contract" (line 1-5). Core rule: if the system can make a
decision, launch work, mutate code, run a sandbox, or claim completion, that action leaves
inspectable evidence (lines 8-11). Evidence mix for this product (lines 12-21): user-visible
status text; structured workflow/chat data parts; tool output metadata; sandbox/profile/runtime
attribution; logs or run records; screenshots/browser/service evidence; final answer verification
notes.

Seven required questions before implementing non-trivial behavior (lines 22-34):
(1) what would a naive user need to see to believe this mode is active, (2) which actor did the
work, (3) which profile/sandbox/run/deployment/service was used, (4) current status while running,
(5) what command/test/screenshot/log/event proves completion, (6) likely failure mode and how the
UI surfaces it, (7) which sensitive values must not be shown.

### D.2 Issue-level requirements (feature-ticket-format.md:56-91)

Every non-trivial issue's observability section must name: user-visible status/evidence; ONE named
service/module responsible for structured events; every important action/event with level and data
fields; typed error kinds (stable `kind`/`errorKind` values); correlation IDs (`requestId`,
`sessionId`, `chatId`, `workflowRunId`, `sandboxName`, `profileId`, `runId` as applicable);
redaction rules (secrets, provider tokens, logs, artifacts, PII, prompt/session content);
grep-able/query-able debug recipes; screenshots/browser/service evidence when relevant.
Good example: "`sandbox-lifecycle` emits `resume-failed` at warn with `{ sessionId, sandboxName,
errorKind, providerStatus }`". Weak: "Add logs."

### D.3 UI and deploy evidence

For local UI changes (observability-discipline.md:56-69 + user-global CLAUDE.md "Browser QA"):
run the relevant automated test first, open the exact local target with Agent Browser, inspect the
interactive snapshot, exercise the changed path, check console/page errors and network requests,
inspect server logs, report the smoke. Browser smoke is NOT a substitute for durable automated
tests. For deployment-impacting changes (lines 71-81): record commit SHA, deployment id/URL,
health smoke result, migration status, rollback path, known gaps. "Never deploy uncommitted source
unless it is an explicit break-glass emergency."

### D.4 Managed Runtime Proof Standard — relevance note

`docs/process/managed-runtime-proof-standard.md` defines proof levels 1-3 (local deterministic /
live sandbox / production) and the 9-record evidence bundle (Claim, Provenance, Enforcement,
Environment preparation, Attributed work, Independent verification, User visibility, Limitations,
Redaction). **Relevance to iOS: indirect.** The iOS app will not implement managed-runtime
enforcement, but two things carry over: (a) if the iOS app *displays* managed-runtime/run state,
issues touching it inherit the "do not treat a label/transcript as proof" rule — the UI must
surface attribution fields the API provides; (b) the proof-level pattern is the repo's template
for graded evidence and the plan can mirror it for device proofs (simulator-deterministic vs
device/TestFlight vs App Store). `docs/process/workflow-catalog-conventions.md` is web-internal
(catalog entries in `apps/web/lib/workflows/catalog.ts`) — only relevant if iOS surfaces the
workflow catalog; its id (kebab-case, stable) and semverish version rules apply to any new
catalog-like registry the iOS work introduces.

---

## E. What must be ADAPTED for an iOS sub-project (web-specific gaps, flagged)

Everything in A-D that is language-agnostic applies as-is: issue templates, labels, branch model,
PR template, red/green TDD, regression discipline, observability sections, lessons-learned upkeep,
"commit + push + PR before calling complete." The following are **web-specific today** and the iOS
plan must propose explicit amendments (ideally as a new `docs/process/ios-*.md` + template tweaks,
filed via the standard process):

1. **Formatting gate** (`docs/process/formatting-gate.md`) names `bun --bun run check` /
   `bun --bun run fix` / `bun --bun run ci` plus `git diff --check`. The doc's own escape hatch
   applies (lines 36-44): "When touched files fall outside the formatter's coverage, verify them
   separately when a parser exists" — Ultracite/oxfmt does not cover Swift. iOS amendment: define
   the Swift formatter/linter (e.g. `swiftformat --lint` + `swiftlint`) as the repo-level check
   for the iOS tree, runnable by one script, and treat it as a completion gate exactly like
   `bun --bun run check` (red formatter = failing verification; fix-then-rerun or explicit
   user-approved deferral). `git diff --check` stays as-is (language-agnostic).

2. **CI runner and required check name.** `ci.yml` is `ubuntu-latest` + Bun; Swift/xcodebuild
   needs a `macos-*` runner with a pinned Xcode (analog of the pinned `bun-version: "1.2.14"` —
   pin Xcode/Swift toolchain versions explicitly). Branch protection requires the single status
   check named `lint-and-typecheck` (github-build-process.md:237). Decision needed: add an iOS job
   to the existing workflow gated by path filters, name a new required check (requires a branch
   protection settings change — note memory: pushing workflow files needs
   `gh auth refresh -s workflow`), or keep iOS CI advisory initially. The plan must say which.
   An iOS gate mirroring `bun run ci` should be one command (e.g. a `Makefile`/script:
   format-lint → build all targets → unit tests → contract/codegen check).

3. **`bun run ci` semantics.** CLAUDE.md says `bun run ci` is "REQUIRED after making any changes."
   `test:isolated` globs every `**/*.test.ts` in the repo — Swift files are invisible to it, so an
   iOS-only change would pass `bun run ci` vacuously. Amendment: the iOS Definition-of-done line
   "`bun --bun run ci` passes" must be extended/replaced with the iOS gate command for iOS-only
   slices, and BOTH gates run when a slice touches shared API contract surfaces. If iOS code lives
   in the monorepo, also confirm the TS glob/turbo/ultracite configs ignore the iOS directory so
   web CI doesn't choke on it (and vice versa).

4. **"Protected path" definitions for mobile.** The web defines protected paths as user/operator
   journeys ("a user can open a session and watch the stream"). iOS equivalents the plan should
   enumerate explicitly: sign-in/token refresh survives app relaunch (Keychain); session list →
   chat stream renders and resumes after backgrounding; diff view renders for a real PR; commit/PR
   action round-trips; settings persist; push/poll notification of agent completion; offline/poor
   network degradation states. Each iOS feature issue must still fill `User/operator path
   protected` with one of these concrete journeys.

5. **Browser QA → simulator/device QA.** Rules referencing `agent-browser`
   (development-workflow.md:86-141; observability-discipline.md:56-69; user CLAUDE.md;
   production-release-runbook smoke sections) have no iOS meaning. Amendment: define the iOS
   analog smoke — boot a named simulator (`xcrun simctl`), exercise the changed path (XCUITest
   smoke or scripted `simctl` + screenshot), capture screenshots as evidence, and check the app's
   structured logs (`OSLog`/`os_log` via `xcrun simctl spawn ... log stream` or `xcrun devicectl`)
   as the analog of "check console/page errors + server logs." The "authenticated local UI smoke"
   prerequisite (local DB + test-auth cookie, development-workflow.md:86-141 and memory
   `authenticated-ui-smoke`) becomes: a runnable backend target (local `bun run web` on :3002 per
   memory, or the dev deployment) plus a documented test-auth mechanism for the app — note the
   existing `open_agents_test_user_id` cookie is a web cookie; the iOS plan needs an equivalent
   header/cookie injection story for development builds.

6. **Preview/dev/production deployment lane → TestFlight lane.** Vercel Preview per-PR, `develop`
   → shared dev env, `main` → production (runbook + github-build-process) have no direct iOS
   equivalent. The plan must define the analog: e.g. per-PR CI build artifact (simulator build) as
   "preview"; `develop` merges → TestFlight internal build as "shared dev"; release PR to `main`
   → TestFlight external/App Store submission as "production," each with a recorded smoke
   (build number = analog of commit SHA + deployment id) and a rollback statement (App Store
   rollback is effectively fix-forward — the runbook's "fix-forward only" classification,
   runbook:142-151, is the honest default for shipped app binaries; server-side flags are the real
   rollback lever). PR template's `## Preview / Release Safety` section fields (Vercel Preview
   URL, Agent Browser review) need iOS-specific replacements proposed.

7. **Deploy/migration impact vocabulary.** Template placeholders enumerate Vercel/Neon/Upstash/
   GitHub App/sandbox. iOS issues need additional impact axes: App Store review risk, OS/Xcode
   version floor changes, push entitlement/provisioning changes, OAuth callback/universal-link
   registration (note lessons-learned.md:26-27 — the Vercel OAuth app must register exact
   callbacks; an iOS OAuth flow will need its own registered redirect URI), API
   backward-compatibility window (an old app binary in the field is the analog of "old deployment
   compatibility" in behavior-tdd.md example 4 — the server must stay compatible with shipped app
   versions, which is a NEW constraint the iOS plan imposes on web-side API work).

8. **Observability stack.** Web events are structured server logs with service/action/correlation
   fields. The iOS app cannot grep production logs; the amendment should map the same shape onto:
   client-side structured logging (OSLog categories = "service name"; events with stable names,
   levels, and field payloads including `sessionId`/`chatId`/`requestId` echoed from API
   responses), a crash/telemetry pipeline decision (open question), and redaction rules extended
   to device logs (never log tokens/prompt content into OSLog where other apps/sysdiagnose can
   capture it). Debug recipes become e.g. `log show --predicate 'subsystem == "..."'`.

9. **Code style doc is TypeScript-specific** (`docs/agents/code-style.md`: Bun-only, kebab-case
   files, Zod, no-`any`). An iOS plan must add a Swift style section/doc (SwiftUI conventions,
   Codable models generated or hand-written against `openapi.json` — see
   `docs/process/api-openapi-contract.md` and `apps/web/lib/api/client.ts` for the typed-client
   precedent; `bun run test:contract` is the existing real-HTTP contract suite the iOS client
   should reuse/extend rather than re-invent). The spirit-level rules transfer: never untyped
   (`any` ↔ avoid `Any`/force-casts), schema-first validation (Zod ↔ Codable +
   validation), file-per-concern separation (CLAUDE.md "File Organization" section applies
   verbatim to Swift: extract feature logic into focused files, don't grow god-views).

10. **Local development bootstrap.** `./init.sh` (local-development.md) is web-only (bun install,
    Vercel env pull). The iOS plan should specify the analog bootstrap (e.g.
    `apps/ios/README` or script: xcodegen/SPM resolve, pinned toolchain check, `.xcconfig`
    pointing at local `:3002` / dev alias / production), staying consistent with init.sh's
    conservative philosophy: never silently mutate shared services, write secrets only to ignored
    files, `--verify`-style smoke mode that proves the checkout builds and can reach
    `/api/auth/info`.

11. **Issue/PR template text itself.** The templates hardcode `bun --bun run ci` and
    `git diff --check` in `Agent todo checklist`, `Definition of done`, and PR `## Test
    Evidence`. Until templates are amended, iOS issues must still use them and explicitly
    substitute the iOS gate command in the free-text fields (the templates' own "or document
    approved/pre-existing failures" / "explain why" escape hatches cover this). A cleaner path the
    plan can propose: a new `ios-feature-slice.yml` template variant (same 16 sections, iOS
    commands) — filed through the standard process as its own slice.

### Relevant lessons-learned items for the iOS workstream

- lessons-learned.md:20 — "Strong agent process needs executable issue/PR structure, not only
  prose docs": replicate, don't dilute, the template rigor for iOS.
- lessons-learned.md:13 — verification instructions must point at project scripts before generic
  commands; the iOS gate must be a named script, not "run xcodebuild somehow."
- lessons-learned.md:125-129 — fork-only writes; iOS issues/PRs go to
  `dennisonbertram/fork-open-agents` (verify with `git remote -v`; upstream push is DISABLED).
- Memory: local app runs on **:3002** locally (not :3000); develop→main release PRs may show
  BEHIND yet auto-merge; renumbered Drizzle migrations break persistent preview DBs (matters if
  iOS work rides along a PR with schema changes).

---

## Compliance checklist for any single iOS slice (distilled)

1. File/identify a `feature-slice` (or `bug-regression`) issue in the fork with all 16 (or 11)
   sections filled; epics get `epic` label + Vision/Why/Scope/Phases/DoD body; link plan docs back
   to the issue.
2. Branch `feat/<slug>` from `origin/develop`; one issue per branch; merge (not rebase) develop in.
3. Name the protected path; write the smallest failing Swift test; confirm RED; commit
   `test(red): ...`.
4. Smallest green change; commit `feat(scope): ... (#issue)`; run adjacent test target.
5. Run the iOS gate (format/lint + build + tests) AND `git diff --check`; run `bun --bun run ci`
   too if any shared/TS surface was touched.
6. Fill the PR template completely (risk tier, evidence, smoke, rollback); target `develop`; CI
   (`lint-and-typecheck`) must pass; conversations resolved.
7. Provide observability evidence: named log subsystem, structured events with correlation IDs,
   redaction statement, debug recipe, simulator screenshots for UI changes.
8. Bugs always get a fails-without/passes-with regression test; live-device bugs become
   deterministic tests; durable lessons go to `docs/agents/lessons-learned.md`.
9. Push and open the PR before calling the work complete.
