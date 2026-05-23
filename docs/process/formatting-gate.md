# Formatting Gate

Formatting checks are completion gates, not courtesy notes. Do not present work
as done while the required formatter is red by saying only touched files are
formatted.

## Required Rule

Before finishing implementation, docs, config, migration, or generated-code
changes, run:

```bash
git diff --check
bun --bun run check
```

For full verification, run:

```bash
bun --bun run ci
```

If formatting fails, treat that as failing verification. Do one of the
following before final handoff:

1. Run `bun --bun run fix`, then rerun checks.
2. If the formatter would create unsafe or unreviewable churn, stop and get
   explicit user approval to defer cleanup. Report the command, representative
   files, and follow-up owner before calling the work complete.

Touched-file formatting checks may supplement the repo-level check, but they do
not replace it when `bun --bun run check` or `bun --bun run ci` is part of the
expected gate.

## Files Outside Formatter Coverage

When touched files fall outside the formatter's coverage, verify them
separately when a parser exists. At minimum, run:

```bash
git diff --check
```

Do not use formatter coverage gaps as a reason to skip the repo-level check.
