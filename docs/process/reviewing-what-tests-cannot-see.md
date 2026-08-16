# Reviewing What Tests Cannot See

A green suite is evidence that the code the suite can reach behaves as asserted.
It is not evidence about code the suite structurally cannot reach.

On 2026-08-16 three defects were found by reading a diff, in a repository with
thousands of passing tests. None was "we forgot to write a test." In each case a
test of that kind **could not exist** where the defect lived. That is a
different problem, and it needs a different review question.

The question is not *"are there tests?"* It is:

> **What can this test suite structurally not see, and have I read those
> places?**

## The four blind spots

Work through these against the diff in front of you. They are ordered by how
often they hide something.

### 1. Lines that need real infrastructure to execute

A line that only runs against a live sandbox, a real network call, or a real
database is skipped by every mock. The suite reports green having never
evaluated it.

*What it cost:* `agent-step.ts` re-verified repository access before every
`openAgent.generate` call and required `write`. Reaching that line needs a live
sandbox, so 898 passing tests said nothing about it. Two preparation gates were
fixed, the third was missed, and the fix would not have worked. A reviewer
reading the diff found it.

**Ask:** which changed lines cannot run under the test harness? Read each one.
Do not add a mock and call it covered — a mock proves the mock behaves.

### 2. Combinations that are individually tested and never combined

Two options each have thorough coverage. Nothing exercises them together. The
interaction is where the defect lives.

*What it cost:* `expectFileChanges` and the truncation bound were both well
tested. No test declared `expectFileChanges: true` on a run that was also
truncated. Because `no_file_changes` outranks `truncated` in the outcome
precedence, such a run reported the wrong stop reason — and the two point at
opposite remediations.

**Ask:** what does this change interact with that it is not tested alongside?
Enumerate the cross-product explicitly rather than trusting that each half is
covered.

### 3. Behavior decided outside the code

Configuration in YAML, environment variables, database rows, and dashboard
settings determines real behavior. No unit test of the code observes it.

*What it cost:* both production journey proofs treat "require the run to have
succeeded" as an opt-in flag defaulting to `false`, and the scheduled workflow
never set it. A run reaching terminal `failed` was graded as passed. The canary
reported success every six hours for a month over 144 failed production runs.

**Ask:** what behavior here is set outside the code? If a flag has a permissive
default, does the production caller opt in — and does anything assert that it
did? A guard for this has to read the configuration file; nothing else can.

### 4. The environment your evidence came from

A measurement is only as good as knowing where it came from.

*What it cost:* an investigation reported two subsystems as dead with no
activity for six weeks and proposed deleting roughly 110,000 lines. The queries
ran against the **dev** database branch while the investigator believed it was
production. In production both were the busiest subsystems, active that day.

**Ask:** which environment produced this number? Verify it, do not assume it.
For this repo: `grep '^POSTGRES_URL=' apps/web/.env.local | grep -o 'ep-[a-z0-9-]*'`,
and `vercel env pull` for the real production values.

## The remedy: guard from the source text

When a line cannot be executed under test, asserting on the **source** is worth
more than another mock. Both guards written for the episode above count sites
rather than behavior:

- `apps/web/lib/agent-loops/write-gate-placement.regression.test.ts` — `write`
  is required in exactly two places in `agent-step.ts`, none in
  `step-executor.ts`, and both sit behind a `hasChanges` guard.
- `apps/web/scripts/canary-strictness.regression.test.ts` — the workflow YAML
  opts both journey proofs into strict grading, and the final gate still turns
  a non-passing aggregate into a non-zero exit.

Neither could be written as a behavioural test. Both catch the real regression.

A source guard has a cost: it is coupled to how the code is written, so a
legitimate refactor can trip it. That is acceptable when the alternative is no
coverage at all — a tripped guard asks a human a question, which is the point.
Write the failure message so the answer is obvious.

**Every guard must be mutation-tested before you trust it.** Break the thing it
protects, watch it fail, restore, watch it pass. Record the observed failure in
the commit message. This repository has shipped guards that were green and
inert; a guard nobody has seen fail is not evidence. See
[Guard Integrity](guard-integrity.md) for the same rule applied to guards in
product code.

## Instructing a reviewer

The `expectFileChanges` defect was found because the review prompt said, in
substance: *the required scenarios all pass — now go past them and ask what
happens when this meets the other terminal states.* That instruction produced
the finding. Left implicit, it would not have.

So put the blind spots in the prompt, not in your memory of good practice:

- Name what the change is supposed to do, and say the happy path is expected to
  pass — so the reviewer does not spend its effort re-confirming it.
- Ask explicitly which changed lines the harness cannot execute.
- Ask explicitly what this interacts with that is not tested alongside it.
- Ask whether behavior is decided in configuration, and whether production opts
  in.
- Require a per-question answer. **Silence is not an answer** — a reviewer that
  reports nothing on question 3 has not necessarily looked at question 3.
- Ask for the evidence read, not just the conclusion, so a claim can be
  checked.

## Treat every review finding as a lead

A finding is a hypothesis with a citation, not a verdict. Verify the decisive
claim yourself before acting, and say plainly which you verified.

In the same session a reviewer produced one confirmed high-severity defect,
correctly reasoned, **and** one false positive: it claimed
`probeChangedFilePaths` could throw and fail an otherwise-good run. Reading the
implementation showed it catches everything and returns `null`. Both arrived in
the same report with the same confident tone.

The reverse also holds. An automated grooming pass reported an issue as shipped
citing a commit that was real, on the default branch, and whose subject was a
formatting change rather than the work the issue described. Checking that a
cited commit exists is not checking that it does what was claimed.
