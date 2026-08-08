# Guard Integrity

A guard is only as good as its inputs, and its inputs are usually configuration
nobody tests.

This repo has shipped four guards that were correct in isolation, passed their
own tests, and did nothing in production. Each was discovered only after it had
already failed to prevent the thing it existed to prevent. This document exists
so the fifth one does not happen.

## The failure mode

The pattern is always the same:

1. A defect is found.
2. A guard is written to prevent it.
3. Unit tests call the guard **directly** and pass.
4. In the real path the guard receives different inputs — stripped, unset,
   unvalidated, or a different shape — and silently allows what it was written
   to block.
5. CI is green the entire time.

Step 3 is what makes this hard to catch. A test that calls
`decideMigrationTarget({productionHost: "ep-prod..."})` proves the *logic*. It
proves nothing about whether the real caller can supply that value.

**Green tests are evidence about the function. They are not evidence about the
system.**

## The four instances

Read these before writing a guard. They are not hypotheticals.

| # | Guard | Why it did nothing |
| --- | --- | --- |
| 1 | Branded `ProviderModelId` (#1155) | The mint accepted any string and validated nothing, so `toProviderModelId(composite)` compiled and blessed a bad value. The brand was a no-op wrapper. |
| 2 | Migration target guard (#1167) | `turbo.json`'s build task declares an env allowlist. `PRODUCTION_DB_HOST` was not in it, so under `bun run build` the guard got `undefined` and failed open. |
| 3 | The same guard, locally | `PRODUCTION_DB_HOST` was absent from `.env.local` and `.env.example`, so the guard was unarmed on every developer machine. |
| 4 | `isToolUIPart` test doubles (#1153) | Ten hand-written doubles diverged from the real library predicate, hiding an entire class of tool from every test that used them. |
| 5 | The test enforcing *this document* | It asserted `PRODUCTION_DB_HOST` was present in `.env.example` and concluded "a fresh checkout arms the guard". The template ships the key **empty**, `init.sh`'s offline path copies it verbatim, and the guard fails open on a falsy host. The enforcement committed the error it was written to prevent. |
| 6 | The fix for #5 | The `DISARMED` warning was added to `init.sh`'s reporter, but the reporter was invoked on only 1 of 3 env routes — the two that actually *create* `.env.local` reported nothing. The replacement test asserted the string `DISARMED` appeared in the function, which is true regardless of whether the function is ever called. |

Instance 2 had a second edge worth internalizing: fixing only the variable the
reviewer named would have armed the guard while leaving `VERCEL_ENV` stripped —
making every production deploy look local and **refusing every release**. A
guard's inputs work as a set. Add them together or not at all.

## Required checks before claiming a guard works

Do all of these. Each maps to one of the failures above.

### 1. Run it through the real entry point, not the function

Execute the actual command a build or deploy runs, with the environment it will
actually have. For a build-path guard that means `bun run build` or the script
the build invokes — not `bun test`.

```bash
# wrong: proves the logic, not the wiring
bun test ./path/to/guard.test.ts

# right: proves the guard fires where it matters
env -u SOME_VAR POSTGRES_URL="$TARGET" bun run --cwd apps/web db:migrate:apply
```

### 2. Prove the refusal path, and check its exit code without a pipe

A guard that logs and exits `0` lets the build continue anyway.

```bash
# WRONG -- reports tail's exit code, not the script's
cmd 2>&1 | tail -2; echo $?

# right
cmd >/dev/null 2>&1; echo "exit: $?"
```

### 3. Prove the allow paths too

Over-guarding is the worse failure. A guard on the build path that refuses
incorrectly blocks every deploy. Every guard needs must-stay-green cases for the
traffic it must **not** block, named as such in the test file.

### 3b. Presence is not configuration

A key existing in `.env.example`, `turbo.json`, or a Vercel environment does not
mean it holds a usable value. Templates ship keys empty on purpose. An assertion
that a key is *present* proves documentation, not arming — say which one you are
claiming.

Instance 6 is the same rule one step further out: a warning that exists in a
function is not a warning that fires. If a check must run on several code paths,
**execute each path in the test** rather than asserting the check's text exists.
A source-text assertion cannot tell you whether the code runs.

Where a checkout cannot be proven armed from the repo, make the disarmed state
**announce itself** instead. `init.sh` warns `the migration guard is DISARMED`
when `PRODUCTION_DB_HOST` is empty, which is verifiable from the repo in a way
that a developer's actual environment is not.

### 4. Verify every input reaches it in the real environment

For each value the guard reads, confirm the real caller supplies it:

- **Turbo:** is it in the `build` task's `env` list in `turbo.json`? Strict env
  mode passes nothing else.
- **Vercel:** is it set for every environment that runs this path — Production,
  Preview, *and* Development? Verify with `vercel env pull --environment=<env>`
  and read the specific key.
- **Local:** is it in `apps/web/.env.example` so a fresh checkout arms it?

### 5. Decide fail-open vs fail-closed deliberately, and say which in the code

A guard on a path that gates every deploy must **fail open** when unconfigured —
blocking all releases over a missing variable is worse than the bug. A guard on
a security or data-integrity boundary should **fail closed**.

Whichever you choose, state it in the module doc comment with the reason. An
undocumented fail-open reads as a bug to the next person; an undocumented
fail-closed becomes an outage.

### 6. Pin configuration to code with a test

Where a guard depends on config, derive the requirement from the code rather
than duplicating a list by hand. A hand-copied list drifts exactly like the
config did.

`apps/web/lib/db/migration-guard-env-wiring.test.ts` is the worked example: it
greps `migrate.ts` for its own `process.env` reads and asserts `turbo.json`
declares every one. Adding a new read fails the test until Turbo is taught to
pass it.

## Test doubles

A hand-written double is a claim about a library's behavior, and claims rot.

- **Do not re-implement a pure function you can import.** `isToolUIPart` is a
  two-line predicate on `part.type`; ten copies existed, seven of them wrong.
  Where a module must be mocked for other reasons, have the double delegate to
  the real implementation.
- **Model the real shape, not a convenient one.** A mock that threw
  synchronously from `stream()` passed for two days while production failed,
  because the real AI SDK resolves, emits a `start` part, surfaces errors as a
  stream part, and rejects a derived promise. The test proved a code path
  production never takes.
- **When a test is green and production is broken, suspect the double first.**

## Documentation

Do not state intended architecture as current fact. AGENTS.md asserted that
preview deployments never touch production data; that assertion is why nobody
checked, and previews had been migrating the production database.

- Describe the intended state as intended, and give the command that reveals the
  actual state.
- When correcting a claim, say explicitly that older copies are wrong. Readers
  and agents cache them.
- Prefer making the real state visible over documenting it. `init.sh` now prints
  which database endpoint it is about to use and warns when that is production —
  that removes the question, where a doc only answers it.

## Reading a value before you report it

Two findings in this repo were wrong because a value was read loosely and
attributed to the wrong key:

```bash
# WRONG -- matches every line, returns the first hit, which is a different var
grep -o 'ep-[a-z0-9-]*' apps/web/.env.local | head -1

# right -- read the specific key
grep '^POSTGRES_URL=' apps/web/.env.local | grep -o 'ep-[a-z0-9-]*' | head -1
```

Before reporting that a config points somewhere, read the exact key by name.
Before generalizing from one checkout's state, say it is one checkout's state.

## Definition of done for a guard

- [ ] Refusal path exercised through the real entry point, exit code checked
      without a pipe
- [ ] Allow paths exercised and named as must-stay-green in the test file
- [ ] Every input confirmed present in Turbo's env allowlist, in every Vercel
      environment that runs the path, and in `.env.example`
- [ ] Fail-open or fail-closed chosen deliberately and justified in the code
- [ ] Config-to-code wiring pinned by a test that derives its expectations from
      the source
- [ ] If the guard can block deploys, the PR says what to watch for and how to
      roll back
