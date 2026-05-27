# Background Agents Live Proof

Use this runbook for GitHub issue
[#26](https://github.com/dennisonbertram/fork-open-agents/issues/26) before
calling the background-agents epic proven in a hosted environment.

The goal is to prove the deployed product path, not just route contracts:
configured agent -> trigger delivery -> durable run -> sandbox evidence ->
checks -> ready PR or typed failure -> inspectable run detail.

## Safety Rules

- Use a disposable repository owned by Dennison's workspace.
- Keep production disabled unless explicitly approved. Prefer a preview or
  staging-like environment.
- Never paste secrets into GitHub issues, PR comments, screenshots, shell logs,
  or chat.
- Do not print raw webhook signatures, auth headers, provider tokens, full
  webhook payloads, full prompts, or unredacted artifacts.
- Keep Composio, Slack, and third-party tool execution out of v1 proof.
- Roll back by setting `BACKGROUND_AGENTS_ENABLED=false`.

## Prerequisites

Confirm the target deployment has these categories configured. Check only env
names or the product readiness route; do not expose values.

- Database and Better Auth session configuration.
- Vercel sign-in and GitHub OAuth configuration.
- GitHub App configuration:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_PRIVATE_KEY`
  - `NEXT_PUBLIC_GITHUB_APP_SLUG`
  - `GITHUB_WEBHOOK_SECRET`
- Background-agent dispatch configuration:
  - `BACKGROUND_AGENTS_ENABLED=true`
  - `CRON_SECRET` or `BACKGROUND_AGENTS_CRON_SECRET`
  - `BACKGROUND_AGENTS_WEBHOOK_SECRET`
- Sandbox/runtime and inference provider configuration used by ordinary chat
  runs.
- The readiness panel should report both `Sandbox runtime` and
  `Inference gateway` as ready. On Vercel, the automatic deployment context can
  satisfy these without exposing a provider key; outside Vercel, configure the
  appropriate token or `AI_GATEWAY_API_KEY`.
- A disposable repository with the GitHub App installed and permissions for
  metadata, contents, pull requests, issues, deployments or statuses, and
  webhook delivery for the tested event types.

## Readiness Check

Open the target deployment while authenticated:

```bash
https://<target-host>/settings/background-agents
```

The readiness panel should show the feature flag, auth/database, Vercel sign-in,
GitHub OAuth, GitHub App, cron secret, and webhook secret as ready. If it does
not, fix hosted configuration before firing triggers.

The readiness API is authenticated and redacted:

```bash
curl -i https://<target-host>/api/background-agents/readiness
```

Unauthenticated `401` proves the route is deployed and protected. Authenticated
JSON should report missing variable names and setup categories, not secret
values.

## Configure Test Agent

From `/settings/background-agents`, create a repo-scoped agent for the
disposable repository:

- Trigger: start with `github.issue` or `github.pull_request`; add
  `webhook.error` for the signed generic webhook proof.
- Conditions: keep filters narrow, such as a proof label, branch, or severity.
- Instructions: make a small, reversible change for the ready PR proof, such as
  adding or updating a single proof file.
- Permissions: grant only the repo permissions needed by v1.
- Outputs: use `ready_pr` for the success path.
- Test: use the built-in Test action first, then inspect the run detail page.

Capture the agent ID, trigger ID, webhook public ID if applicable, and the first
manual-test run ID.

## Generic Signed Webhook Proof

Run the generic `webhook.error` fixture against the configured hosted target:

```bash
BACKGROUND_AGENT_PROOF_BASE_URL=https://<target-host> \
BACKGROUND_AGENT_PROOF_WEBHOOK_PUBLIC_ID=<webhook-public-id> \
BACKGROUND_AGENTS_WEBHOOK_SECRET=<secret-from-env-manager> \
BACKGROUND_AGENT_PROOF_REPO_OWNER=<owner> \
BACKGROUND_AGENT_PROOF_REPO_NAME=<repo> \
bun run --cwd apps/web background-agents:webhook-proof
```

Optional variables:

- `BACKGROUND_AGENT_PROOF_EXTERNAL_ID`
- `BACKGROUND_AGENT_PROOF_SEVERITY`
- `BACKGROUND_AGENT_PROOF_TITLE`
- `BACKGROUND_AGENT_PROOF_MESSAGE`
- `BACKGROUND_AGENT_PROOF_URL`
- `BACKGROUND_AGENT_PROOF_ACTOR`
- `BACKGROUND_AGENT_PROOF_DUPLICATE=false`
- `VERCEL_AUTOMATION_BYPASS_SECRET`

Expected result:

- first delivery reports one created run;
- duplicate delivery reports the same run ID and no new work;
- run detail shows signed webhook trigger evidence with redaction metadata;
- invalid signatures are rejected by the route test harness and should not be
  manually retried with real secrets in logs.

## GitHub Signed Fixture Proof

This fixture exercises the deployed GitHub webhook route with GitHub-compatible
headers and signing. It complements, but does not replace, a real GitHub App
delivery.

```bash
BACKGROUND_AGENT_GITHUB_PROOF_BASE_URL=https://<target-host> \
GITHUB_WEBHOOK_SECRET=<secret-from-env-manager> \
BACKGROUND_AGENT_GITHUB_PROOF_REPO_OWNER=<owner> \
BACKGROUND_AGENT_GITHUB_PROOF_REPO_NAME=<repo> \
BACKGROUND_AGENT_GITHUB_PROOF_EVENT=pull_request \
bun run --cwd apps/web background-agents:github-webhook-proof
```

Supported `BACKGROUND_AGENT_GITHUB_PROOF_EVENT` values:

- `pull_request`
- `issues`
- `deployment_status`

Useful optional variables:

- `BACKGROUND_AGENT_GITHUB_PROOF_ID`
- `BACKGROUND_AGENT_GITHUB_PROOF_DUPLICATE=false`
- `BACKGROUND_AGENT_GITHUB_PROOF_ACTION`
- `BACKGROUND_AGENT_GITHUB_PROOF_LABELS`
- `BACKGROUND_AGENT_GITHUB_PROOF_SHA`
- `BACKGROUND_AGENT_GITHUB_PROOF_HEAD_REF`
- `BACKGROUND_AGENT_GITHUB_PROOF_BASE_REF`
- `BACKGROUND_AGENT_GITHUB_PROOF_PR_NUMBER`
- `BACKGROUND_AGENT_GITHUB_PROOF_ISSUE_NUMBER`
- `BACKGROUND_AGENT_GITHUB_PROOF_DEPLOYMENT_STATE`
- `VERCEL_AUTOMATION_BYPASS_SECRET`

Expected result:

- first delivery dispatches through `/api/github/webhook`;
- duplicate delivery returns duplicate background-agent dispatch evidence with
  the same run ID;
- existing GitHub App installation sync and PR-close/archive behavior remain
  intact.

## Real GitHub Delivery Proof

After fixture proof passes, trigger a real event from GitHub:

- For issue proof, create or label an issue in the disposable repo.
- For PR proof, open or synchronize a small PR in the disposable repo.
- For deployment proof, send a deployment status event from the repo's normal
  deployment path if available.

Record the GitHub delivery ID or event URL if available, then inspect the run
created by the deployed app.

Expected run evidence:

- `background-agent.trigger.received`
- `background-agent.run.created`
- `background-agent.workflow.started`
- `background-agent.github.installation.resolved`
- `background-agent.sandbox.started`
- `background-agent.check.started`
- `background-agent.check.completed`
- `background-agent.output.created` for successful ready PRs, or
  `background-agent.run.failed` with a typed error for failure proof.

## Ready PR Success Proof

Use an instruction that produces a minimal repository change and configured
checks that can pass.

Expected evidence:

- run status completes successfully;
- sandbox name is visible and tied to the run ID;
- check evidence includes command, status, exit code, and duration;
- output action is `ready_pr`;
- output record includes PR URL, PR number, branch, base branch, and commit;
- the created PR links back to the background run.

## Failure Proof

Prove one typed failure path in the disposable repo without creating a ready PR.
Prefer a controlled failure that does not depend on flaky external services.

Examples:

- configure an intentionally failing check command;
- temporarily target a repo without the required installation;
- disable the agent and trigger it to confirm visible disabled behavior.

Expected evidence:

- run detail shows a typed error such as `checks_failed`,
  `installation_missing`, or `agent_disabled`;
- no ready PR is created for the failed run;
- timeline evidence is redacted and includes correlation IDs.

## Browser Smoke

Use Agent Browser against the hosted target after the automated proof commands:

```bash
agent-browser open https://<target-host>/settings/background-agents
agent-browser snapshot -i
agent-browser errors
agent-browser console
```

Exercise:

- Settings list and readiness panel.
- Agent edit and disable affordances.
- Manual Test action.
- Repo dashboard at `/repos/<owner>/<repo>/agents`.
- Run detail at `/background-runs/<runId>`.

Capture screenshots only after checking that no secret, auth header, full
payload, or unredacted artifact appears on screen.

## Evidence To Post

Post a concise proof comment to #26, #24, and #18 with:

- target deployment URL;
- disposable repo URL;
- agent ID and trigger kind, but not secrets;
- manual run ID;
- real GitHub delivery event and run ID;
- generic webhook proof run ID;
- duplicate idempotency evidence, including same run ID;
- sandbox name;
- check command names and statuses;
- ready PR URL and run link;
- failure run ID and typed error kind;
- browser-smoke paths exercised;
- hosted checks or CI links for the PR head.

Use this template:

```markdown
Live proof completed for #26.

- Target: <deployment-url>
- Repo: <repo-url>
- Agent: <agent-id>, trigger: <trigger-kind>
- Manual run: <run-url>
- GitHub delivery run: <run-url>, external event: <id-or-url>
- Generic webhook run: <run-url>
- Duplicate proof: <first-run-id> == <duplicate-run-id>
- Sandbox: <sandbox-name>
- Checks: <check-name> <status> in <duration>
- Ready PR: <pr-url>
- Failure proof: <run-url>, errorKind=<kind>
- Browser smoke: Settings -> repo dashboard -> run detail
- Redaction checked: yes
```

Do not include raw signatures, secrets, auth headers, full payloads, full prompt
content, or unredacted logs.
