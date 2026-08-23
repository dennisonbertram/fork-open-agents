# Distilled Learnings

Durable rules mined from session transcripts, each grounded in something that
actually happened. This is not a changelog — it records the *shapes* of
mistakes that recur here, so the next person or agent does not rediscover them.

Add to it when a mistake teaches something general. Keep every entry evidenced:
a `path:line`, an error string, an issue number. An entry without evidence is a
guess, and guesses age badly.

- [Reading status from the cloud loop](#reading-status-from-the-cloud-loop)
- [Writing a dispatch brief](#writing-a-dispatch-brief)
- [The MCP server itself](#the-mcp-server-itself)
- [Guards that pass while doing nothing](#guards-that-pass-while-doing-nothing)
- [What tests cannot see](#what-tests-cannot-see)
- [Mutation testing](#mutation-testing)
- [Release, deploy and status tools](#release-deploy-and-status-tools)
- [Recurring product defect shapes](#recurring-product-defect-shapes)
- [Working with several agents at once](#working-with-several-agents-at-once)

---

## Reading status from the cloud loop

**`completed` is not success.** A slice reports `completed` whether its output
is excellent or unusable. Grade the diff against the brief's file list; never
merge on the status alone. This is the founding rule of
[Dogfood The Cloud Loop](../process/dogfood-cloud-fanout.md) and every entry
below is a variation on it.

**A field can be null because nothing happened *or* because it has not settled
yet.** `activity` flips to `idle` before `lastRunOutcome` is written, so an
immediate read returns `null` — indistinguishable from "never ran" (#1259). The
same class later hit `prNumber`: the PR existed, the field had not caught up.
Re-read after a delay before treating an absent value as a negative result.

**`hibernated` is the resting state, not a failure.** The sandbox parks to stop
billing and resumes on the next message. `resumable: true` is the field that
tells you it is alive.

**A stall is invisible from the list tool unless you ask for the right field.**
`open_agents_list_sessions` returned `state`, `workspace` and `activity` but
not `lastRunOutcome`, so a dead run and a healthy one both read
`activity: "idle"`. Fixed 2026-08-20; the lesson is that a batch dispatcher must
poll the field that distinguishes outcomes, not the one that describes motion.

**An approval request in a headless run is terminal, not a pause.** Nothing
outside a browser click resolves one — no route, no MCP tool, no timeout. The
run now ends with an explanation instead of parking forever, but the underlying
truth stands: never gate a tool a headless run legitimately needs.

## Writing a dispatch brief

**The brief is the whole contract. A remote agent cannot ask a question.**
Five things, every time: a closed list of files with every path verified to
exist; the contract written out verbatim rather than described; one acceptance
command with the *real* baseline numbers captured by running it first; a named
test file with the assertion that must fail; and a size a reviewer will read.

**Write the acceptance condition before dispatching**, so grading is mechanical
rather than a judgement call afterwards.

**`gh` is not available in cloud sandboxes** (#1308). A brief that says "read
the issue with `gh issue view`" fails silently. Inline the decision instead.

**Omitting `expectedFiles` is sometimes correct.** When a task requires
discovering paths first, a wrong allowlist fails the run on contact. That is a
deliberate trade, not sloppiness — say so in the brief when you make it.

**A cheap model will implement your spec exactly, including its mistakes.**
See [Working with several agents at once](#working-with-several-agents-at-once).

## The MCP server itself

**Consent was not enforced by default** in better-auth's `mcp` plugin:
`/mcp/register` had no session middleware and `authorize` returned a code
unless the *client* asked for consent. Four gates now defend it
(`lib/auth/mcp-consent-hook.ts`), each proven by reverting it and watching the
test fail. A related bypass wrapped the code in an array to slip past a
string-only check.

**Do not advertise a scope before the tool exists.** Discovery metadata listed
`agents:read`, `agents:write` and `sandbox:exec` before anything implemented
them. A generic client requesting everything got consent for all of it — so
when the capability shipped, an existing grant already covered it, with no new
consent prompt.

**Test with a second, differently-behaved client.** Auth-scheme parsing was
backwards from RFC 7235 — lowercase `bearer` was rejected, a bare token with no
scheme was accepted — and only surfaced because a client other than the usual
one connected.

**Missing `.strict()` on a tool input schema silently drops misspelled
parameters** and returns a default with HTTP 200 instead of an error.

**The MCP OIDC provider is load-bearing and better-auth-specific.** It is wired
at `lib/auth/config.ts:154` on the `mcp` plugin, owns the `oauth_applications`
/ `oauth_access_tokens` / `oauth_consents` tables, and is what the cloud
dispatch loop authenticates against. Replacing better-auth means reimplementing
RFC 8414, RFC 9728, authorize, token and consent. See
[Authentication provider options](../plans/auth-provider-options.md).

## Guards that pass while doing nothing

Read [Guard Integrity](../process/guard-integrity.md) first. These extend it.

**A guard can exist only in a comment.** `bash.ts` claimed the git-push family
was safe to gate because "the unattended loop denies it with a recorded
reason". No such loop existed, and a gated force-push wedged a headless run
exactly like the incident the comment implied was handled. This is a category
the existing doc does not list: not a guard that fails to fire, but a guard
that was never written and is documented as if it were.

**A guard that checks a name is not checking the claim.** The `.env.example`
exemption skipped approval on filename suffix while its justification was
"committed placeholder" — a claim nothing verified. An untracked
`.env.example` full of real credentials would have passed. Now
`isCommittedDotEnvTemplate` asks git and fails closed on every error path.

**Reusing shared guard infrastructure imports its contract, not just its
code.** `detectRepetition`'s cycle arm, built for a broader signal, was reused
for "3 consecutive identical tool failures" and fired on an alternating
`A,B,A,B` pattern — a cycle, but not the contract.

## What tests cannot see

Read [Reviewing What Tests Cannot See](../process/reviewing-what-tests-cannot-see.md).
These are the concrete instances.

**A render-only test cannot see route wiring.** #1373 added a `not-found.tsx`
inside `[sessionId]/`, but `[sessionId]/layout.tsx:32` throws `notFound()`
*above* that segment — so the boundary could never fire. The test rendered the
component directly and passed. Caught in review, not by any test.

**A test double that is unrealistic hides the defect it was written for.**
`ToolLoopAgent.stream` was mocked to throw synchronously; the real AI SDK
resolves and surfaces errors as a stream part. A pre-existing test went red
only once the double was made realistic — which is why #1140 and #1141 passed
CI while every delegated worker in production failed without attribution.

**A test can pass because of an unrelated bound.** A breaker test used
`maxSteps: 4`, so the loop ended at step 4 whether or not the breaker fired.
It could not distinguish the two outcomes. Check that a test can actually fail.

**Source-text guards break when code moves and intent does not.** This happened
three times in one day, always the same way: the guard asserted a literal
call-site string, and a legitimate change replaced the literal with a variable
that defaults to the same value. Write the guard against the invariant — the
default value, the sanitiser being used — not the call site's spelling. Then
mutation-test the rewritten guard.

## Mutation testing

**Assert the mutation target exists before applying it.** A mutation that
silently fails to apply — because the code moved or a formatter reflowed it —
leaves the file unchanged and the guard looks like it passed. Always:

```python
assert target in source, "MUTATION TARGET MISSING"
```

**Never revert a mutation with `git checkout <file>`.** It discards uncommitted
work, including a concurrent agent's. Use symmetric edits or `git stash`.

## Release, deploy and status tools

**`ops:status` can print a SHA that does not belong to the deployment it
names.** It takes the deployment identity from Vercel but the commit from
Vercel's `meta.githubCommitSha`, *falling back* to the latest GitHub deployment
record when that is absent — and the two can describe different deployments.
During an incident this reported the previous SHA beside a deployment already
running the new one, for two hours. The check that is not fooled: read the
GitHub Production deployment record for the SHA you expect, then confirm its
`environment_url` matches the deployment Vercel is actually serving.

**Match a CI run by workflow name, not position.** Several workflows share a
commit SHA and some are `skipped`; taking the first match reports `skipped` or
`pending` forever. Filter on `.name == "CI"`.

**Merge states: `BEHIND` means backmerge. `UNSTABLE` means required checks
passed and only an optional one is unhappy — mergeable. `UNKNOWN` means not yet
recomputed, so it is transient, not terminal. `BLOCKED` has three causes and
only two are terminal: pending checks (wait), a failed required check (fix), or
an unresolved review thread (answer it).**

**Squash-merging a backmerge loses the ancestry link.** The content matches but
the release merge commit never enters `develop`'s history, so every subsequent
release PR opens reporting `BEHIND`. Merge backmerges with `--merge`.

**A `git merge-base --is-ancestor` test misclassifies squash-merged branches as
unmerged**, because a squash never puts the branch tip in the target's history.
To classify branches for deletion, use the pull-request outcome instead. Of 138
branches this test called "unmerged", 47 had merged PRs and 80 had closed ones.

**Infrastructure failures masquerade as code failures.** A release build failed
twice on GitHub returning 429 for the `setup-bun` action download. Read the log
before assuming the code broke.

**Check the database before any write:**

```bash
grep '^POSTGRES_URL=' apps/web/.env.local | grep -o 'ep-[a-z0-9-]*' | head -1
```

`ep-old-union` is dev; `ep-soft-silence` is production. Several *unused*
variables in `.env.local` still hold production credentials (#1162).

## Recurring product defect shapes

**A readiness or permission check that asks a different question than the thing
deciding success.** Found five times:
- `verifyRepoAccess` demanded `write` for read-only work, so a read-only canary
  could never pass (#1314).
- Background-agent readiness verified GitHub permission but not the allowlist
  the dispatcher enforces — a trigger was refused weekly for six weeks while
  the panel showed green (#1332).
- `actions-manager/readiness.ts` checks the GitHub *App's* permission, never
  the signed-in user's, so a read-only collaborator sees an enabled "Run
  workflow" button that fails at submit (flow-critique F-003).
- The same agent is blocked on one edit surface and enable-able on its sibling
  (F-004).
- The `.env.example` guard above.

When you write a readiness check, ask: *is this the same question the thing
that actually fails will ask?*

**The UI has the information and does not show it.** Nine confirmed cases of
one shape: a `useSWR` call drops `error`, falls back to an empty value, and
renders a confident false statement — "No branches found" when the request
failed. Reference fix #1087, six more in #1094–#1099. Related: a skip reason
written to the database but never returned by the API, so a refused trigger and
an idle one looked identical for a month.

## Working with several agents at once

**A delegated agent implements your spec exactly — including its errors.** The
ticket for #1373 named a file path where the boundary could never fire; the
agent built precisely that. When a delegated result is wrong, suspect the brief
before the agent.

**Give every concurrent agent its own worktree.** A subagent dispatched without
`isolation: "worktree"` edited the shared checkout while the coordinator ran
`git add -A` there, sweeping its in-progress change into an unrelated commit and
breaking CI. Never broad-add a directory another agent is working in.

**Verify a delegated fix against real data, not against the diff's logic.**
A provider-resolution fix looked correct on inspection and was rejected only
after querying the production table and finding a user it resolves wrong for.

**What an automated reviewer reliably catches**, on this repo: claims the code
makes about itself that no test forces to be true — cross-cutting wiring, a
boundary's position in the render tree, a guard that never checks the thing it
is named for. Treat every review finding as a lead and verify it; several have
been right where a green suite was not.
