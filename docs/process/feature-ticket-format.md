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

Blank issues are allowed for quick triage, but implementation issues should be
converted into one of the standard shapes before coding.

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
    or runtime attribution users/operators need.
12. `TDD audit trail` - red test commit and green implementation commit, or an
    exception.
13. `Regression risks and concerns`.
14. `Deploy or migration impact`.
15. `Definition of done`.

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
