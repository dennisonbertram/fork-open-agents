# Feature And Ticket Format

Use this format whenever a product idea becomes a GitHub issue. The goal is
that any agent can pick up the ticket, understand the protected path, and
execute the checklist without needing the original conversation.

## Standard Templates

Use these issue templates:

- `.github/ISSUE_TEMPLATE/feature-slice.yml` for PR-sized product or platform
  work.
- `.github/ISSUE_TEMPLATE/bug-regression.yml` for bugs that need a regression
  test.
- `.github/ISSUE_TEMPLATE/research-spike.yml` for time-boxed research before
  adopting a package, API, architecture, provider, or process.

Blank issues are disabled so product, bug, and research work starts with a
complete handoff shape. For quick triage, use the closest standard template and
mark unknown fields explicitly instead of opening an unstructured issue.

## Required Feature Ticket Shape

Every feature issue should include:

1. `Why this matters` - the user, operator, or product outcome unlocked.
2. `User/operator path protected` - the concrete path this ticket makes better
   or safer.
3. `Behavior contract` - scenario-form descriptions of visible behavior.
4. `Product and design spec` - entry point, primary flow, states,
   accessibility, copy, permissions, and error/empty/loading behavior.
5. `Integration spec` - routes, components, API surfaces, agent/sandbox/workflow
   surfaces, data model, events, services, observability, config, and
   compatibility.
6. `In scope` - behavior this one PR-sized slice should implement.
7. `Out of scope` - adjacent ideas that must stay out of the slice.
8. `Research and context sources` - repo docs, known issues, incidents,
   Context7/vendor docs, or assumptions.
9. `Agent todo checklist` - ordered todos that an agent can follow.
10. `Tests to add first` - tests that should be observed failing before
    implementation.
11. `Observability and user feedback` - the status, evidence, logs, screenshots,
    or runtime attribution users/operators need. This must name structured
    events, service/action vocabulary, typed error kinds, correlation IDs,
    redaction rules, and debug recipes when the issue touches production,
    runtime, sandbox, workflow, browser, deploy, auth, or GitHub App behavior.
12. `Regression harness plan` - existing or new test, smoke, browser path, or
    scenario coverage that should continuously catch the behavior after merge,
    with fail-before/pass-after expectations when practical.
13. `TDD audit trail` - red test commit and green implementation commit, or an
    exception.
14. `Regression risks and concerns`.
15. `Deploy or migration impact`.
16. `Definition of done`.

## Observability Section Rules

Follow the sharper issue shape used in `dennisonbertram/partyline`: every
non-trivial issue should make debugging expectations concrete before
implementation starts.

Include:

- the user-visible status or evidence the feature/fix exposes,
- one named service or module responsible for structured events,
- every important action/event with level and data fields,
- typed error kinds using a stable `kind` or `errorKind` value,
- correlation IDs such as `requestId`, `sessionId`, `chatId`, `workflowRunId`,
  `sandboxName`, `profileId`, or `runId` as applicable,
- redaction rules for secrets, provider tokens, logs, artifacts, PII, and
  prompt/session content,
- grep-able or query-able debug recipes an operator could run during an
  incident,
- screenshots, browser evidence, service evidence, or runtime attribution when
  relevant.

Weak observability sections:

- "Add logs."
- "Show errors."
- "Use existing observability."

Good observability sections:

- `managed-runtime` emits `worker-started` at info with `{ sessionId, chatId,
  workflowRunId, profileId, sandboxName }`.
- `debug-bundle` emits `bundle-token-created` at info with `{ userId,
  sessionId, chatId, expiresAt }` and never logs the token value.
- `sandbox-lifecycle` emits `resume-failed` at warn with `{ sessionId,
  sandboxName, errorKind, providerStatus }`.
- Debug recipe: `grep '"chatId":"<id>"' logs | grep '"service":"debug-bundle"'`.

## Regression Harness Plan Rules

Each implementation issue should identify the smallest durable signal that
would fail if the protected path regressed.

Use one or more of:

- a unit, contract, or route test,
- a workflow or agent test,
- an Agent Browser or Playwright smoke for local UI behavior,
- a preview/prod smoke check,
- a managed-runtime proof artifact,
- a future harness/catalog scenario when the behavior spans multiple systems.

If no continuous harness is practical for the slice, the issue must say why and
name the manual proof that will be captured in the PR.

## Agent Todo Checklist Rules

Every issue that reaches implementation should include a checkbox todo list.
The list should be concrete enough that a new agent can continue from any
unchecked item.

Good checklist items:

- [ ] Read the current runtime mode flow and identify the protected path.
- [ ] Add a failing package-level test for coordinator tool gating.
- [ ] Add a workflow test that proves runtime mode reaches the agent call.
- [ ] Commit the failing test-only state on the work branch.
- [ ] Implement the smallest policy change that turns the targeted test green.
- [ ] Run `bun test packages/agent/open-agent.test.ts`.
- [ ] Run `bun --bun run ci`.
- [ ] Update process docs with verification notes.

Weak checklist items:

- [ ] Build the feature.
- [ ] Make it good.
- [ ] Test it.
- [ ] Deploy it.

Checklist items should name files, commands, routes, or user paths when known.
If the exact file is unknown, name the subsystem and discovery task.
