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
- `GET /api/background-agents/readiness` is an authenticated route that returns
  only safe readiness status, missing env var names, and setup categories; it
  never returns secret values;
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
