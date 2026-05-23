# Behavior-First TDD

Use this workflow whenever a change can affect a user, operator, deployment,
agent run, sandbox, workflow, or integration.

## Core Rule

Name the path first. Write or identify the failing behavior test second. Only
then change implementation.

Unit tests are the inner loop. The outer contract is the user or operator
outcome that must continue to work.

## Required Order

1. Name the protected path.
2. Add lower-level unit or contract tests for the smallest missing behavior.
3. Add or identify the larger behavior, integration, or regression proof.
4. Run targeted commands and confirm the expected red state.
5. Commit the failing test-only state on the work branch when practical.
6. Make the smallest implementation change that turns lower-level tests green.
7. Re-run the original path proof. It should only go green once the lower-level
   behavior is fixed.
8. Commit the green implementation separately from the red test commit when
   practical.
9. Run the adjacent suite.
10. Refactor only while tests stay green.

Broken-test commits are audit evidence, not a mergeable final state. Keep them
on work branches or PRs, and document any reason the red and green work could
not be separated.

## Examples Of Behavior Tests

Behavior tests should prove outcomes like:

1. managed runtime mode removes direct coding tools from the coordinator,
2. a workflow persists and resumes a streaming turn safely,
3. a session cannot read or mutate another user's state,
4. a migration preserves old deployment compatibility,
5. a browser/runtime preview reports service logs and screenshots,
6. a GitHub App install path preserves the return URL and CSRF state,
7. a final answer includes evidence when a sandbox profile was used,
8. a deploy path fails before production when required config is missing.

## Checklist Template

Use this in issue bodies, PR descriptions, or handoff notes:

```markdown
## Behavior TDD

- [ ] User/operator path named:
- [ ] Behavior test file:
- [ ] Behavior RED command:
- [ ] Expected red reason:
- [ ] Unit/contract RED tests:
- [ ] Red test commit:
- [ ] Unit/contract GREEN command:
- [ ] Behavior GREEN command:
- [ ] Green implementation commit:
- [ ] Adjacent suite command:
- [ ] Repo-level check command:
```

## When A New Behavior Test Is Not Required

You may skip a new behavior test only when all are true:

1. the change is docs-only, comments-only, formatting-only, or mechanical
   metadata,
2. no runtime behavior, config, deploy path, provider contract, storage
   behavior, or user/operator path changes,
3. an existing test owner is named if there is any risk.

State the reason in the PR notes.
