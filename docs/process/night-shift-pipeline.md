# Night-Shift Pipeline: Implementer → Reviewer → Merge Bot

This is the concrete recipe for wiring three background agents into a
self-contained overnight pipeline on one repository: an implementer that
picks up work on a schedule, a reviewer that reacts to pull request activity,
and a merge bot that reacts to CI completion. It closes the gap identified in
[#742](https://github.com/dennisonbertram/fork-open-agents/issues/742) and
implemented in #749: a `github.check_suite` trigger kind for CI-completion
events, `actors`/`ignoreActors` trigger conditions to stop agents from
reacting to each other's own activity forever, and a per-agent-per-PR run
budget as a hard backstop against any loop that slips past the actor filters.

Related: [Background Agents Epic](../plans/background-agents-epic.md),
[Background Agents Live Proof](background-agents-live-proof.md).

## Operator prerequisite: subscribe the GitHub App to `check_suite`

The merge bot's trigger (`github.check_suite`) only fires if the GitHub App
installation is subscribed to the `check_suite` webhook event and has
`checks:read` permission. This is an **operator step in the GitHub App
settings** — it cannot be granted from inside this application.

1. Open the GitHub App settings page (Settings → Developer settings → GitHub
   Apps → your app → Permissions & events).
2. Under **Repository permissions**, ensure **Checks** is set to at least
   **Read-only**.
3. Under **Subscribe to events**, check **Check suite**.
4. Save changes. GitHub will prompt existing installations to accept the new
   permission/event before check_suite deliveries start arriving.
5. Confirm readiness: the background-agents readiness check
   (`getGitHubAppWebhookReadinessCheck` in
   `apps/web/lib/background-agents/github-app-webhooks.ts`, surfaced through
   the repo/settings readiness API) reports `missing: ["event:check_suite"]`
   or `missing: ["permission:checks=read"]` until both are configured, and
   `status: "ready"` once they are.

Without this step the merge bot's trigger will simply never receive
deliveries — there is no error, just silence. Check the readiness surface
first if a merge-bot pipeline looks idle.

## The three agents

All three agents target the same `repoOwner`/`repoName`. Configure them as
separate background agents (Settings → Background Agents, or the repo
dashboard's agent editor).

### 1. Implementer (cron agent)

- **Trigger kind:** `schedule.cron`
- **Schedule:** e.g. `@hourly` or a custom cron expression — whatever cadence
  fits the backlog.
- **Instructions:** pick up the next ready issue/task and open a draft PR.
- **GitHub actions:** `open_pull_request: true`, `push: true`.
- **Conditions:** none (schedule triggers have no event conditions).
- **Run budget:** the default `runBudgetPerTarget: 10` is irrelevant here
  since schedule triggers are not scoped to a PR number — the budget only
  applies to PR-scoped triggers (see below).

### 2. Reviewer (on pull_request opened/synchronize)

- **Trigger kind:** `github.pull_request`
- **Conditions:**
  - `actions`: `opened, synchronize` — react to new PRs and pushes to
    existing PRs (e.g. the implementer's or a fixer's follow-up commits).
  - `ignoreActors`: the reviewer's **own bot login** (the GitHub App's
    installation user, or the login the reviewer's PR comments post as).
    This is the critical loop-safety condition: without it, if the reviewer
    ever pushes a commit or triggers a synchronize-shaped event on its own
    PR, it would review itself forever.
- **Instructions:** review the diff, leave a PR review/comment, request
  changes or approve.
- **GitHub actions:** `comment_on_pr_or_issue: true`,
  `approve_pull_request: true`, `request_changes: true`.

### 3. Merge bot (on check_suite success)

- **Trigger kind:** `github.check_suite`
- **Conditions:**
  - `statuses` (maps to the check_suite conclusion): `success` — only act
    when CI reports a clean conclusion. GitHub also sends `failure`,
    `cancelled`, `timed_out`, `action_required`, etc. — leave those out so
    the merge bot does not try to merge a red build.
  - `branches` (optional): restrict to the base branches this pipeline
    manages (e.g. leave blank to match all, or scope to specific long-lived
    branches if the repo has several parallel pipelines).
  - `ignoreActors` (optional): exclude check suites attributed to the merge
    bot's own re-run/dispatch actions, if the merge bot ever triggers its own
    CI re-runs.
- **Instructions:** confirm the PR's CI is green (the trigger already
  filtered for `success`, but the agent should still re-verify via the
  `requireCiGreenForMerge` GitHub action gate before merging) and merge.
- **GitHub actions:** `merge_pull_request: true`. Set the agent's
  `requireCiGreenForMerge: true` (the default) so the merge tool itself
  re-checks CI status server-side before merging, independent of the trigger
  condition — this is defense in depth, not redundant.
- **Run budget:** since `check_suite` events carry a `prNumber` when the
  check suite is associated with a pull request (`pull_requests[0].number`
  from the webhook payload), the per-agent-per-PR budget applies here. The
  default `runBudgetPerTarget: 10` means the merge bot will stop attempting
  merges for the same PR after 10 runs within 24h — see below.

## Loop-safety layers (defense in depth)

The pipeline can loop if an agent's own activity re-triggers a peer agent
(e.g. reviewer's PR comment counts as some other bot's trigger, or CI re-runs
keep firing check_suite). Three independent layers guard against this,
ordered from "prevent the trigger from firing" to "hard stop":

1. **`ignoreActors` on the reviewer/merge-bot triggers.** The reviewer should
   `ignoreActors: [<reviewer's own bot login>]`; if the merge bot ever
   dispatches its own workflow re-runs, it should ignore its own login too.
   This is the primary defense — it should mean the pipeline never loops in
   normal operation.
2. **`actors` allowlist (optional, tighter alternative).** Instead of a
   denylist, an agent can use `actors` to only react to a specific known
   actor (e.g. the implementer's bot login), which is stricter than
   `ignoreActors` when the set of legitimate actors is small and known.
3. **Per-agent-per-PR run budget (the backstop).** Even if the actor filters
   are misconfigured or a third-party actor (e.g. a human pushing manual
   commits) keeps re-triggering an agent, the dispatcher refuses to create
   more than `runBudgetPerTarget` runs (default 10) for the same
   `(agent, repo, prNumber)` within a rolling 24-hour window. This is checked
   in `dispatchBackgroundTriggerEvent` before a run row is created, so it
   applies to the reviewer, the merge bot, or any other PR-scoped trigger.

### What happens when the budget is exhausted

There is deliberately **no run-scoped event** for a budget-exhausted skip,
because no run exists yet at the point the budget check happens (recording a
`background-agent.run.*` event requires a `runId`, and creating a run is
exactly what the budget check prevents). Instead:

- The trigger's `lastSkipReason` is updated via `recordTriggerSkipReason`
  with a message like
  `budget exhausted: 10/10 runs in 24h for PR #123` — visible in the
  trigger's card in the agent settings/detail UI.
- A structured `console.warn` is emitted with
  `eventName: "background-agent.run.budget_exhausted"` and fields
  `{ agentId, repoOwner, repoName, prNumber, budget, windowHours,
  requestId }` for log-based alerting.

This is a documented deviation from the run-event observability pattern used
elsewhere in the background-agents subsystem — adding a runless event surface
was out of scope for this ticket (see #749) and would require its own schema
decision rather than being invented ad hoc here.

### Debug recipe

To see how close a given agent is to its budget for a specific PR:

```sql
select count(*)
from background_agent_runs
where agent_id = '<id>'
  and pr_number = <n>
  and created_at > now() - interval '24 hours';
```

To check or change an agent's budget, see the `runBudgetPerTarget` column on
`background_agents` (default `10`); it is set the same way as other
per-agent config, through the agent create/update payload.

## Condition summary table

| Agent       | Trigger kind             | Key conditions                                   |
| ----------- | ------------------------ | ------------------------------------------------- |
| Implementer | `schedule.cron`          | schedule expression only                          |
| Reviewer    | `github.pull_request`    | `actions: [opened, synchronize]`, `ignoreActors: [<reviewer bot login>]` |
| Merge bot   | `github.check_suite`     | `statuses: [success]`, optional `branches`, optional `ignoreActors` |

## Verifying the pipeline end to end

Follow [Background Agents Live Proof](background-agents-live-proof.md) for
the general hosted-proof steps (signed fixture webhooks, run/event
inspection). For this specific pipeline, the regression harness is a
two-agent chain exercised locally with fixture webhooks signed via the same
GitHub fixture harness described there — the reviewer and merge-bot triggers
are unit-tested independently (`github-events.test.ts`, `matching.test.ts`,
`dispatcher.test.ts`) and the full loop is proved via that live-proof
checklist rather than an automated multi-agent integration test.
