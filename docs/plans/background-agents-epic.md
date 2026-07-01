# Background Agents Epic

Prepared: 2026-05-27

GitHub epic: https://github.com/dennisonbertram/fork-open-agents/issues/18

## Goal

Background agents let users attach standing instructions to repositories so
GitHub events, cron ticks, and signed external error webhooks can start durable
cloud-sandbox work without a live browser session.

The v1 trust boundary is intentionally narrow:

- GitHub App installation access is authoritative for repository clone, branch,
  commit, push, PR creation, and webhook trust.
- Background runs are persisted with idempotency keys and redacted event
  timelines before real mutation is enabled.
- External tool providers are schema/UI-ready but not executable in v1.
- Composio is deferred to v1.5.

## Child Issues

- https://github.com/dennisonbertram/fork-open-agents/issues/19 - data model
  and trigger dispatcher foundation.
- https://github.com/dennisonbertram/fork-open-agents/issues/20 - Settings,
  repo dashboard, and run evidence UI.
- https://github.com/dennisonbertram/fork-open-agents/issues/21 - sandbox
  execution and ready PR output.
- https://github.com/dennisonbertram/fork-open-agents/issues/22 - Composio tool
  grants for background agents.
- https://github.com/dennisonbertram/fork-open-agents/issues/26 - hosted live
  proof for real webhook delivery, sandbox execution, and ready PR creation.
- https://github.com/dennisonbertram/fork-open-agents/issues/721 - reclassify
  scoped GitHub as a default built-in tool, surface the Standard toolpack
  (`builtinToolNames`, `web_fetch` off by default), make Result the single
  source of truth for GitHub write permission, and fix the Report-only
  no-op. See
  [Background Agent Tools Model](../agents/architecture.md#background-agent-tools-model)
  for the resulting tool tiers and the unchanged credential invariant.
- `docs/process/background-agents-live-proof.md` - operational runbook for the
  #26 hosted proof checklist.

## V1 Foundation Scope

The first implementation slice creates:

- `background_agents`, triggers, runs, events, outputs, future tool grants, and
  future provider sessions tables.
- GitHub event normalization for pull requests, issues, and deployment statuses.
- Cron and signed generic error webhook dispatch routes.
- A durable background workflow that records trigger/workflow evidence.
- Settings, repo-dashboard, and run-detail visibility.

The first slice does not claim to perform real sandbox mutation or ready PR
creation. Those behaviors are tracked in issue 21 and should build on the run,
event, and output records introduced here.

## Runtime Evidence Slice

The next implementation slice adds inspectable sandbox execution without
turning on code mutation yet:

- each run resolves repo-scoped GitHub App access before sandbox work starts;
- each run creates or resumes a named sandbox using `background_agent_<runId>`;
- each run records sandbox attribution, working directory, branch, and host when
  available;
- each run records git context before checks run;
- configured check commands emit `started` and `completed` events with status,
  exit code, duration, compact stdout/stderr, and truncation status;
- active run detail pages poll the run API so humans and agents can watch the
  timeline update while a workflow is running;
- `ready_pr` runs still fail visibly after sandbox/check evidence because
  mutation and PR creation remain the next protected step.

## Ready PR Slice

The ready PR implementation slice turns the evidence path into an output path
for `ready_pr` agents:

- `ready_pr` runs prepare a deterministic run-scoped branch before mutation;
- the existing Open Agent tool loop runs inside the background sandbox with an
  unattended prompt and explicit "do not create a PR yourself" boundary;
- each agent step records finish reason, tool-call count, duration, and token
  usage into the run timeline;
- configured checks still gate output after mutation and before commit/PR
  creation;
- successful runs bundle sandbox changes into a verified GitHub App commit;
- successful runs open a user-token PR only after checks pass and persist a
  `ready_pr` output record with URL, PR number, branch, base branch, and commit;
- failed output creation records a typed `pr_creation_failed` failure and no
  ready PR is created;
- Composio and other external tool providers remain out of execution for v1.

## Manual Test Slice

Operators and agents need a first-class way to prove wiring before waiting on a
real webhook:

- saved agents expose a Settings `Test` action;
- `POST /api/background-agents/[agentId]/test` verifies ownership, picks an
  enabled trigger, and creates a manual test event through the same durable run
  machinery;
- manual tests honor `BACKGROUND_AGENTS_ENABLED` and return an explicit disabled
  response when rollout is off;
- successful test dispatches navigate directly to `/background-runs/[runId]` so
  the live timeline can be inspected while the workflow is running.

## Run Detail Proof Strip Slice

The run detail page should make the run auditable before the user opens the
timeline:

- the proof strip includes status, trigger, repo, ref or SHA, sandbox,
  permissions, checks, output action, duration, and cost when available;
- run detail data includes only the agent metadata needed for evidence
  rendering: name, permissions, and check command;
- the timeline remains the source of command evidence, but the proof strip
  summarizes whether the run has enough evidence to trust the output;
- typed failures stay visible even when no output was created.

## Live Debug Correlation Slice

The run detail view and run API should expose the correlation fields needed to
debug a live run without database access:

- run detail includes request ID, workflow run ID, idempotency key, external
  event ID, source, trigger target, sandbox, and output PR number when present;
- timeline events include request ID and redaction status alongside workflow,
  sandbox, and error metadata;
- output records expose PR numbers in addition to URLs;
- route tests protect the authenticated run-detail API contract so future
  agents can depend on this evidence while polling running workflows.

## Dispatcher Harness Slice

The trigger dispatcher should prove idempotency and failure observability before
live webhooks are enabled:

- duplicate GitHub deliveries return the existing run and never start a second
  workflow;
- GitHub, signed error webhook, manual, and scheduled runs record typed
  `background-agent.workflow.start_failed` evidence when durable workflow start
  fails;
- scheduled runs now record `background-agent.trigger.received` before workflow
  start so cron-triggered runs have the same first timeline breadcrumb as
  GitHub and webhook-triggered runs.

## Settings Edit And Disable Slice

Operators need to adjust standing instructions after creation without deleting
and recreating agents:

- Settings supports create and edit from the same bounded form;
- existing agents can be loaded into the form, updated, disabled, and saved
  through the authenticated PATCH route;
- trigger conditions for actions, branches, labels, environments, and
  severities are included in the Settings payload;
- the Settings form shows the intended Trigger -> Conditions -> Instructions ->
  Permissions -> Outputs -> Test flow while keeping Composio/tool providers
  deferred to v1.5;
- route tests cover authenticated PATCH and DELETE scoping for agent updates and
  removal.

## Settings Run History Slice

The global Settings entry point must show both configuration and recent run
evidence:

- `GET /api/background-agent-runs` is covered as an authenticated, owner-scoped
  list contract with optional repo filters and bounded limits;
- `/settings/background-agents` now fetches recent background runs alongside the
  agent list;
- Settings renders loading, empty, error, and populated run-history states;
- recent runs link to `/background-runs/[runId]` and, when available, the
  output URL;
- this gives operators and future agents a global debug surface before they
  know which repo dashboard or run detail to open.

## Readiness Diagnostic Slice

The hosted proof path needs a safe way to see missing prerequisites before a
trigger is fired:

- `bun run --cwd apps/web background-agents:env-audit -- --environment preview
  --branch <branch>` audits Vercel env names and branch scopes without reading
  or printing encrypted values;
- `background-agents:env-audit -- --require-allowlist` treats
  `BACKGROUND_AGENTS_ALLOWED_REPOS` as required for controlled live proof;
- `background-agents:env-audit -- --verify-values` uses a temporary
  `vercel env pull` file to report only blank required variable names, then
  deletes the temp file before exit;
- `background-agents:live-proof-preflight` combines env audit, hosted
  readiness-route protection, disposable repo accessibility, and optional
  authenticated repo readiness into one redacted preflight before live events
  are fired;
- `GET /api/background-agents/readiness` is an authenticated route that returns
  only safe readiness status, missing env var names, and setup categories; it
  never returns secret values;
- `GET /api/background-agents/readiness?repoOwner=<owner>&repoName=<repo>`
  also verifies user-token plus GitHub App repo coverage with typed readiness
  reasons when called by an authenticated operator;
- `BACKGROUND_AGENTS_ALLOWED_REPOS` is optional but can limit dispatch to one
  or more `owner/repo` entries for production live proof and staged rollout;
- `/settings/background-agents` shows a compact readiness section with feature
  flag, auth/database, Vercel sign-in, GitHub OAuth, GitHub App, cron secret,
  sandbox runtime, inference gateway, cron secret, and generic webhook secret
  status;
- the diagnostic caught the current preview gap: preview has DB/auth basics but
  lacks GitHub App/background-agent proof secrets, while production has GitHub
  App credentials but still needs the background-agent flag and dispatch
  secrets before #26 can run.

## Signed Webhook Proof Harness Slice

Once #26's hosted environment is configured, agents need a repeatable command
for the signed generic webhook path:

- `bun run --cwd apps/web background-agents:webhook-proof` signs a
  `webhook.error` fixture with `BACKGROUND_AGENTS_WEBHOOK_SECRET` and posts it
  to `/api/background-agents/webhook/[publicId]`;
- the harness requires `BACKGROUND_AGENT_PROOF_BASE_URL` and
  `BACKGROUND_AGENT_PROOF_WEBHOOK_PUBLIC_ID`, with optional repo, external ID,
  actor, URL, severity, title, message, and Vercel bypass env vars;
- by default it sends the same payload twice and asserts the second delivery is
  reported as a duplicate with the same run ID, giving #26 a direct hosted
  check for signed delivery plus idempotency;
- the script logs only dispatch counts and run IDs, never the webhook secret or
  computed signature.

## GitHub Webhook Proof Harness Slice

Real GitHub App delivery is still required for #26, but agents also need a
repeatable signed fixture path that exercises the deployed webhook route:

- `bun run --cwd apps/web background-agents:github-webhook-proof` signs a
  GitHub-style `pull_request`, `issues`, or `deployment_status` payload with
  `GITHUB_WEBHOOK_SECRET` and posts it to `/api/github/webhook`;
- the harness uses the same `x-github-event` and `x-hub-signature-256` headers
  as GitHub, plus optional Vercel bypass support for protected previews;
- by default it posts the same GitHub payload twice and asserts the nested
  `backgroundAgents` dispatch result reports duplicate delivery with the same
  run ID;
- the script logs only dispatch counts and run IDs, never the webhook secret,
  computed signature, or full payload.

## Native GitHub Action Tool Slice (#740)

GitHub issue: https://github.com/dennisonbertram/fork-open-agents/issues/740

Follow-on to #736 (write-scope) and #721 (Standard toolpack). Output Mode
(`outputMode: "none" | "ready_pr"`) is replaced entirely by a directly
model-callable, per-action GitHub tool so background agents can act as
autonomous team members end-to-end (open PRs, comment, review, merge
CI-green PRs, push, delete branches) instead of only producing safe drafts a
human must hand-merge:

- Persisted shape: `permissions.github.enabledActions: GitHubToolAction[]`
  (subset of `open_pull_request`, `comment_on_pr_or_issue`,
  `approve_pull_request`, `request_changes`, `merge_pull_request`, `push`,
  `delete_branch`) plus `permissions.github.requireCiGreenToMerge: boolean`.
  `writeScopeMode`/`writeScopeRepos` (#736) are unchanged in shape and now
  bound every enabled action, not just PR creation.
- Migration is byte-identical and DDL-free: `resolveGitHubToolConfig`
  (`apps/web/lib/background-agents/github-actions.ts`) derives
  `enabledActions`/`requireCiGreenToMerge` from legacy `outputMode` at read
  time whenever `enabledActions` is absent (`ready_pr` ->
  `["open_pull_request","comment_on_pr_or_issue"]`; everything else -> `[]`).
  `outputMode` itself is still persisted as a derived legacy mirror
  (`buildAgentPayload`) so any not-yet-migrated reader stays consistent.
- Tool set: `apps/web/lib/github/background-agent-tools.ts` builds one AI SDK
  `tool()` per enabled action (`github_comment_on_pr_or_issue`,
  `github_open_pull_request`, `github_approve_pull_request`,
  `github_request_changes`, `github_merge_pull_request`, `github_push`,
  `github_delete_branch`), resolved once per run
  (`resolveGitHubActionToolsForBackgroundAgent`) and merged into the same
  tools object as Composio tools before `runMutationAgent`'s
  `openAgent.generate` call — the model calls these mid-turn instead of the
  executor creating a PR post-hoc.
- Per-call token pattern: every action mints and revokes its own installation
  token (`withScopedInstallationOctokit` / `mintInstallationToken` +
  `revokeInstallationToken`) scoped to the run's already-resolved bounded
  write-scope repo-ID list (`resolveWriteScopeRepositoryIds`, #736, resolved
  once at run start) — no standing credential exists across the model's turn.
  `merge_pull_request` is the one exception that manually spans a single
  mint/revoke across both the CI-readiness check and the merge call, so only
  one token is minted per merge rather than two.
- `merge_pull_request`'s "require CI checks to pass before merging" gate is a
  per-agent toggle (`requireCiGreenToMerge`, default on) enforced inside the
  tool's own `execute()` via the existing `getMergeReadiness` computation
  (`apps/web/lib/github/pulls.ts`) — never left to the model to self-police,
  and never hardcoded either way.
- `open_pull_request`'s `checkCommand` gate (the existing "run tests before
  opening a PR" agent config) also runs and is enforced inside the tool's own
  `execute()`, not just as a prompt instruction — preserved from the pre-#740
  executor-level gate.
- UI: the agent builder's fixed "GitHub (scoped to this repo)" row and the
  "Result"/Output Mode section are replaced by a per-action toggle list
  (`open_pull_request`/`comment_on_pr_or_issue` on by default, the other 5
  off) with a merge CI-gate sub-toggle and an "Irreversible" caption on
  destructive actions (label only, never a blocker) — see
  `apps/web/app/repos/[owner]/[repo]/agents/github-actions-section.tsx`.
- Safety model (explicit product decision, not an oversight — see #740's
  design-constraints note before relitigating): visibility + toggles +
  observability, not capability withholding. Destructive actions are off by
  default but fully available one toggle away.

### #740 Live-Proof Checklist (comment + open_pull_request minimum)

Automated tests cover every tool's contract, the per-call mint/revoke
pattern, the merge CI-gate, the `checkCommand` gate, and the migration
mapping in isolation, but cannot prove the real GitHub API path end to end.
The issue's minimum bar is live proof of `comment_on_pr_or_issue` and
`open_pull_request` against a real, signed-in session and an allowlisted
repo (unblocks the same live-proof gap #736/#737 left open). This is
operator work, not automatable in CI:

1. Sign in with a real Vercel/GitHub session against an environment where
   `BACKGROUND_AGENTS_ALLOWED_REPOS` includes a disposable test repo (see
   `docs/process/background-agents-live-proof.md` for the readiness
   preflight — `background-agents:live-proof-preflight`).
2. Configure a background agent on that repo with
   `permissions.github.enabledActions` including at least
   `open_pull_request` and `comment_on_pr_or_issue`, a real `checkCommand`
   (e.g. a trivial passing script), and default `requireCiGreenToMerge`.
3. Trigger the agent (manual test dispatch or a real event) and give it
   instructions that require both actions (e.g. "leave a short comment on
   the tracking issue, then make a small change and open a PR").
4. Verify, and capture for the record:
   - the comment actually appears on the target issue/PR with the expected
     body, and the PR actually opens against the configured base branch;
   - `background-agent.github.comment_on_pr_or_issue` and
     `background-agent.github.open_pull_request` events are recorded on the
     run timeline with `succeeded` status and correct attribution
     (`runId`, `agentId`, `number`/`commentId` or `prNumber`/`url`);
   - no standing installation credential exists across the run — each
     action's token mint/revoke pair is scoped to exactly that call (no
     token reuse across the two actions).
5. Record the run ID, PR URL, and comment URL as the live-proof evidence.

Status as of this consolidation pass: not yet executed in this session — see
this step's risk notes for the concrete blocker (no real signed-in
session/allowlisted repo available in this non-interactive worker context).
This checklist is ready for an operator or a future session with browser/
session access to execute; do not mark the managed/live GitHub-write path as
proven until it has been run and its evidence captured here or in
`docs/process/background-agents-live-proof.md`.

## Observability Vocabulary

Service name: `background-agents`.

Initial events:

- `background-agent.trigger.received`
- `background-agent.run.created`
- `background-agent.workflow.started`
- `background-agent.github.installation.resolved`
- `background-agent.sandbox.started`
- `background-agent.git.context.started`
- `background-agent.git.context.completed`
- `background-agent.git.branch.started`
- `background-agent.git.branch.completed`
- `background-agent.git.branch.resolved`
- `background-agent.agent.started`
- `background-agent.agent.step.completed`
- `background-agent.agent.completed`
- `background-agent.check.started`
- `background-agent.check.completed`
- `background-agent.commit.started`
- `background-agent.commit.completed`
- `background-agent.output.created`
- `background-agent.workflow.start_failed`
- `background-agent.run.completed`
- `background-agent.run.failed`

Native GitHub action tool events (#740), one per action call, emitted from
`apps/web/lib/github/background-agent-tools.ts` with the run's standard
attribution (`runId`, `agentId`, `userId`, `workflowRunId`, `requestId`,
`sandboxName`) plus a `severity` field (`"high"` for the three destructive
actions — `merge_pull_request`, `push`, `delete_branch` — `"low"` for the
rest) and per-action attribution scaled to that severity (comment carries
only `number`/`commentId`; merge/push/delete carry CI-status-at-merge,
forced flag, target branch/sha):

- `background-agent.github.comment_on_pr_or_issue`
- `background-agent.github.open_pull_request`
- `background-agent.github.approve_pull_request`
- `background-agent.github.request_changes`
- `background-agent.github.merge_pull_request`
- `background-agent.github.push`
- `background-agent.github.delete_branch`

Typed error kinds returned by these tools' `execute()` (never thrown, always
a discriminated `{ ok:false; errorKind; error }` result):
`merge_blocked_ci_not_green`, `merge_conflict`, `check_command_failed`,
`not_fast_forward`, `protected_branch`, `no_changes`, `access_error` (plus a
reserved-but-currently-unused `pr_not_found` kind for a future PR-lookup
action).

Important correlation fields:

- `runId`
- `agentId`
- `triggerId`
- `requestId`
- `workflowRunId`
- `idempotencyKey`
- `repoOwner`
- `repoName`
- `externalId`

Redaction rule: never persist raw webhook signatures, provider tokens,
authorization headers, secret values, full provider payloads, or unredacted
artifact/log content.

## Design References

Mobbin references used during planning:

- Airtable automation setup for trigger creation.
- n8n schedule trigger for narrow trigger configuration.
- Vercel deployments for dense run lists.
- Better Stack and incident.io timelines for evidence and incident/run history.
