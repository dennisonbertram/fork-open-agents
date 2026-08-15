# Dogfood The Cloud Loop

Implementation work on this repo defaults to **running on this product**: plan
locally, then dispatch the work to Open Agents cloud sessions over the hosted
MCP server, review what comes back, and fix whatever the attempt exposes.

This is not a preference about tooling. It is how defects in the loop get found.

## Why this is the default

On 2026-08-14 the fan-out loop was used for real work for one day. It surfaced
ten defects that the test suite, the type checker, and CI all passed clean:

- Work committed by a slice was pushed to a protected branch, rejected, and lost
  with the sandbox — while the run reported `completed` (#1246).
- A new working branch was cut from the repository default rather than the
  branch the caller named, so slices built on the wrong code and aimed pull
  requests at `main` (#1251).
- A run truncated by the model's output token limit was recorded as
  `completed`, so a half-finished slice reported success (#1247).
- Read-only slices — review, analysis, reporting — were killed at 20 steps by a
  fuse that treated "no git delta" as "no progress" (#1242).
- A headless run could stall forever on a tool approval nobody was able to
  give, because `bash` and the browser tools never consulted the unattended
  flag that `fetch` already honoured (#1272).

Every one of those was invisible from the outside. None was caught by writing
more tests. They were caught by using the thing and reading what it actually
did.

## The loop

1. **Plan locally.** Decide the design, fix the contract between slices, and
   write the acceptance conditions. Judgment stays with the expensive model;
   it is the part a slice cannot do for itself.
2. **Dispatch slices** with `open_agents_start_session` — one well-scoped task
   each, under a shared `label` so the batch is findable from any client. Give
   every slice: an explicit list of files it may touch, tests-first, the exact
   verification commands to run, and instructions to stop with `BLOCKED:`
   rather than guess.
3. **Check in by label**, not by holding session ids. That is the path a second
   device would use, and exercising it is part of the point.
4. **Read every diff and run the tests before merging.** Not optional — see
   below.
5. **File what the attempt exposed.** A slice that stalls, corrupts a file, or
   reports success for work it did not do is a finding about the product, not
   just a bad run. Write the issue with the evidence while it is in front of
   you.

## Never merge on a green status

Every slice reports `completed` whether its output is excellent or unusable.
On 2026-08-14, two slices of five produced corrupted documentation — quotes
escaped across unrelated lines, the requested content never added — and both
reported success with confident summaries describing work they had not done.
CI passed on both: corrupted markdown is valid markdown.

So the run's own status is not evidence, and neither is CI. Before merging a
slice's work:

- Read the whole diff.
- Confirm no file outside the slice's assigned list appears in it.
- Confirm no line was changed that the task did not call for.
- Run its tests locally.

## Write the acceptance condition before dispatching

The cheapest grader is a rule stated up front, checked mechanically against the
diff — no second model required:

> Only these files may change. No existing line may be modified.

That single pair would have rejected both corrupted documentation attempts
deterministically. State the pass condition with the task, the way a test is
written before the code.

## Model choice is part of the setup

The same prompts and the same rails, run twice with only the model changed,
produced two corrupted files out of four slices on one tier and four mergeable
pull requests out of four on another. Pass `model` to
`open_agents_start_session` deliberately; do not inherit whatever the account
default happens to be.

## The dispatcher owns integration

Scoped delegation guarantees a class of gap. A slice told to touch only its
assigned files is doing the right thing — that scoping is what lets several
slices run at once without colliding. But a change that widens a shared type or
a shared function signature breaks callers the slice was never allowed to open.

Both happened in one slice: adding a required field to the chat type broke its
optimistic constructors in a hook, and adding an argument to
`claimChatActiveStreamId` broke the browser route's existing assertions. Two CI
rounds, two fixes, neither the slice's fault.

Do not widen the scope to fix this — that reintroduces collisions. Expect
integration work, and treat it as the dispatcher's job.

## Verify the push, not your own success message

A push that fails and a script that prints "done" regardless will cost you a
CI cycle and a wrong diagnosis. After pushing a fix onto a slice's branch,
read the remote back and confirm the change is actually there.

## Handed-down diagnoses are leads, not conclusions

A slice produced a careful, plausible root-cause analysis; it was endorsed and
fed back as confirmation; it was wrong. The real cause was one layer out, and
a later agent found it by writing a probe test instead of trusting the
analysis.

Treat an inherited diagnosis the way you would treat a slice's own claim of
success: as something to verify cheaply before building on it.

## When to stay local

Dogfooding is the default, not a rule to follow off a cliff:

- Work that must not be lost if a slice misbehaves.
- Judgment calls, contracts between slices, and final review.
- Anything blocked by a known defect in the loop itself — fix that first, and
  file it.

Say which you chose and why. "I ran this locally because the loop is currently
broken for X" is a useful sentence; silently avoiding the product is not.
