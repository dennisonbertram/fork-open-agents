# Deployed Feature Proof Standard

Use this standard before opening, implementing, or closing any user-facing
feature or bug-fix work. The goal is to make "fixed" mean the change is
shipped and provably working in production, not "a commit exists somewhere."

## Core Rule

A user-facing claim ("this bug is fixed", "this feature works") is proven
only when a skeptical reviewer can verify it via a merged commit on
`origin/main` plus either a deterministic red-then-green test or a
journey/harness run against a real deployment.

Proof is not:

1. an open PR containing a correct fix,
2. a green test on an unmerged branch,
3. the model saying it fixed it,
4. a screenshot from a dev server,
5. an HTTP 200 with no observed state change.

Proof is a linked evidence bundle whose records agree about claim,
provenance, red test, merged PR, journey/live evidence, user-visible
feedback, limitations, and redaction.

## Required Evidence Bundle

Every proof bundle should include these records or explicitly state why a
record is not applicable.

1. **Claim**: the concrete user-facing claim being made, for example "the
   agent-creation toast now shows a success confirmation."
2. **Provenance**: issue number, PR number, fix SHA,
   `git merge-base --is-ancestor <fix-sha> origin/main`, deployed URL or SHA,
   and timestamps.
3. **Red test link**: the failing-first commit proving the bug or missing
   behavior, or a documented exception when no red/green cycle applies.
4. **Merged PR on origin/main**: a link to the PR that merged the fix to
   `origin/main` — a merge to `develop` alone is not shipped.
5. **Journey/live evidence**: run IDs and timestamps from a
   journey/harness run, or an explicitly documented, approved exception.
6. **User-visible feedback**: evidence the change satisfies the User
   Feedback Contract below.
7. **Limitations**: what was not proven, what was skipped, and why. A
   blocked or partial proof is valid evidence only if the limitation is
   visible.
8. **Redaction**: evidence proves what happened without exposing secrets,
   raw tokens, private env values, or sensitive stdout/stderr.

## Proof Levels

Use the lowest level that is sufficient for the issue, but do not claim a
higher level without its required evidence.

### Level 1: Local Deterministic Proof

The behavior is proven by a deterministic red/green unit or
DOM-interaction test and local records. For click-driven UI behavior, the
canonical tool is the `*.dom.test.tsx` infrastructure at
`apps/web/tests/dom/` (`registerDomTestHooks()`, `userClick()`) — it uses
role-based queries so `role="alert"` feedback is asserted, not assumed.

Required evidence:

1. the test observed failing first (red),
2. the green commit that made it pass,
3. `git diff --check`,
4. the targeted test command.

### Level 2: Local Or Preview Journey Proof

An authenticated journey-harness run exercises the feature against a local
or preview deployment. Canonical examples:
`bun run --cwd apps/web background-agents:journey-proof`
(`apps/web/scripts/background-agent-journey-proof.ts`, runbook
`docs/process/background-agents-live-proof.md`) and
`bun run --cwd apps/web loops:journey-proof`
(`apps/web/scripts/agent-loop-journey-proof.ts`, runbook
`docs/process/loops-live-proof.md`).

Required evidence:

1. all Level 1 evidence for the touched behavior,
2. run IDs and timestamps,
3. terminal status,
4. cleanup result.

### Level 3: Production Proof

A journey-harness run against production, ideally via the scheduled canary
(`bun run --cwd apps/web ops:canary-journey -- background-agents` or
`bun run --cwd apps/web ops:canary-journey -- loops`,
`apps/web/scripts/canary-journey-gate.ts`,
`.github/workflows/authenticated-production-canary.yml`).

Required evidence:

1. all Level 2 evidence,
2. deployed commit SHA and deployment URL,
3. harness run evidence,
4. rollback note for deploy-impacting changes.

Motivation: bugs #877, #879, and #880 (guardrail edits silently discarded,
stored guardrails not honored by manual dispatch, and run-detail live
polling wedging on a stale "Running" state) were caught only by production
verification after release #875 — deterministic tests and local proof had
all passed first. #880 is the worked example for the deadline-bounded
polling rule below.

## No Stranded Fixes

A rule managed-runtime's standard doesn't need to state as explicitly: a
bug fix ships on its own branch off `origin/develop` (never stacked on a
feature branch), and opens its PR and merges it in the same working
session. If it cannot merge same-session (conflict, blocked CI), the issue
stays open with an explicit, dated blocker comment — never silently
treated as done.

Worked negative example: commit `2d5498f4` (a correct
`toast.success("Agent created successfully.")` fix) sat on unmerged,
non-default branches (`feat/native-github-tool-actions`,
`feat/github-write-scope-736`) for weeks. PRs #676 and #705, both still
`OPEN`, attempted overlapping fixes to the same area while the bug stayed
live in production.

Corrected pattern: #859 (PR #871) and #860 (PR #872) merged to `develop`
and shipped to `main` via release PR #875, verified with
`git merge-base --is-ancestor <fix-sha> origin/main`. #676 and #705 are
now superseded by that merged work and are recommended for closure as
superseded — this recommendation is recorded here for the coordinator to
act on at release; this standard does not close them itself.

## User Feedback Contract

- Every mutation control (save, create, toggle, run, delete) must expose
  pending, success, and error states visible in the UI, with success and
  error announced via `role="alert"` semantics.
- A 200-with-nothing response — the mutation returns success but the UI
  shows no confirmation and no state change — is a defect, not a UX nice-
  to-have.
- Polling for async completion must be deadline-bounded. "Still running"
  past the deadline is a failure state to surface, never implicit success
  (worked example: #880).

## Completion Gate

A user-facing fix is complete only when the issue, the PR, the merged
commit on `origin/main`, and the live evidence all agree on:

1. protected path,
2. red-test link,
3. merged SHA,
4. proof level achieved,
5. verification outcome,
6. known limitations.

If those surfaces disagree, the issue stays open or explicitly records the
gap.

Limitation: this standard's regression protection is social and
review-based — a reviewer citing it when a PR's Definition of Done is
thin — not a CI gate.

## Issue Acceptance Criteria

User-facing feature and bug-fix issues should include acceptance criteria
in this shape:

```markdown
## Proof Level

- Target level:
- Why this level is sufficient:

## Required Evidence

- [ ] Claim named.
- [ ] Red test linked and observed failing first.
- [ ] Merged PR on origin/main linked.
- [ ] `git merge-base --is-ancestor <fix-sha> origin/main` confirms the
      fix is on main.
- [ ] Journey/live evidence captured or exception documented.
- [ ] Mutation controls meet the User Feedback Contract.
- [ ] Polling is deadline-bounded.
- [ ] Limitations surfaced.
- [ ] Secrets redacted.

## Behavior TDD

- [ ] User/operator path named.
- [ ] Behavior test file.
- [ ] Behavior RED command and expected reason.
- [ ] GREEN command.
- [ ] Adjacent suite command.
```

## Relationship To Other Standards

- [Managed Runtime Proof Standard](managed-runtime-proof-standard.md) —
  the subsystem-specific standard this doc generalizes, for
  runtime-attribution claims specifically.
- [Regression Discipline](regression-discipline.md) — the bug-to-regression
  workflow.
- [Feature Ticket Format](feature-ticket-format.md) — its Observability
  Section Rules apply verbatim; this doc does not restate them.
- [Background Agents Live Proof](background-agents-live-proof.md) and
  [Loops Live Proof](loops-live-proof.md) — the runbooks behind the Level 2
  and Level 3 harnesses cited above.
