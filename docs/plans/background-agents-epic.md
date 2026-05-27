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
