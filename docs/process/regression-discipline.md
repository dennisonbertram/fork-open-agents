# Regression Discipline

Every bug fix should leave behind a test that proves the bug cannot silently
return.

## Core Rule

A bug fix is not complete until the regression test:

1. fails without the fix,
2. passes with the fix,
3. runs in the smallest suite that owns the behavior,
4. feeds a behavior or integration proof when the bug crosses a user/operator
   path,
5. has a red/green audit trail on the work branch when practical.

## Required Bug-Fix Process

1. Reproduce or describe the failure mode.
2. Write the regression test.
3. Add or identify the behavior/integration proof for the affected path when
   applicable.
4. Run the targeted command and confirm the expected failure.
5. Commit the failing test-only state on the work branch when practical.
6. Implement the smallest fix.
7. Re-run the regression test and behavior/integration proof.
8. Commit the green fix separately from the red regression commit when
   practical.
9. Run the adjacent suite.
10. Run repo-level checks when practical.
11. Update [Lessons Learned](../agents/lessons-learned.md) if the bug teaches a
    durable repo lesson.

## When A Regression Is Mandatory

1. production incident,
2. user-visible bug,
3. auth, ownership, secret, or billing boundary bug,
4. workflow, retry, timeout, resume, or duplicate-side-effect bug,
5. migration or data compatibility bug,
6. managed runtime, sandbox, browser check, or service preview bug,
7. code-review finding that identified a real failure mode.

## Live Bugs Become Deterministic

When a bug is found through production, live LLM behavior, live browser runs, or
manual QA, convert it into the closest deterministic local test. A live smoke
can remain as a canary, but it should not be the only protection.
