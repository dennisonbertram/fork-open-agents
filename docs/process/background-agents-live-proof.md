# Background Agents Live Proof

Use this runbook for GitHub issue
[#26](https://github.com/dennisonbertram/fork-open-agents/issues/26) before
calling the background-agents epic proven in a hosted environment.

The goal is to prove the deployed product path, not just route contracts:
configured agent -> trigger delivery -> durable run -> sandbox evidence ->
checks -> ready PR or typed failure -> inspectable run detail.

## Safety Rules

- Use a disposable repository owned by Dennison's workspace.
- In production proof, set `BACKGROUND_AGENTS_ALLOWED_REPOS` to the disposable
  repo before enabling `BACKGROUND_AGENTS_ENABLED=true`.
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

For Vercel project env names, run:

```bash
bun run --cwd apps/web background-agents:env-audit -- \
  --environment preview \
  --branch <proof-branch> \
  --require-allowlist
```

The command runs `vercel env ls`, checks names and scopes only, and exits
non-zero when required names are missing. It never reads or prints encrypted
values.

To also confirm required values are non-empty without printing them, add
`--verify-values`. This creates a temporary env file through
`vercel env pull`, reports only blank/missing variable names, and deletes the
temporary file before exit:

```bash
bun run --cwd apps/web background-agents:env-audit -- \
  --environment production \
  --verify-values \
  --require-allowlist
```

To combine the env audit with the hosted readiness route and disposable repo
check, run the preflight command:

```bash
bun run --cwd apps/web background-agents:live-proof-preflight -- \
  --environment production \
  --verify-values \
  --base-url https://<target-host> \
  --repo <owner>/<repo>
```

The preflight exits non-zero until automated prerequisites are ready. It can
also verify authenticated repo readiness before live events are fired. To let
the CLI verify repo access through the hosted app, set
`BACKGROUND_AGENT_PREFLIGHT_COOKIE` to a current browser session cookie in your
local shell. The command sends that cookie but never prints it. Without the
cookie, confirm repo readiness from the authenticated Settings panel.

When `--verify-values` is enabled, Vercel may report branch-scoped sensitive
values as unreadable. The audit should list those names as unverified sensitive
values rather than printing or failing on their contents. Confirm the actual
runtime values through the authenticated readiness route before firing live
events.

Check GitHub App installation, event subscriptions, and repo permissions without
printing secrets:

```bash
tmpfile=$(mktemp)
vercel env pull "$tmpfile" --environment=development --yes >/dev/null
bun run --cwd apps/web background-agents:github-app-readiness -- \
  --env-file "$tmpfile" \
  --repo <owner>/<repo>
rm -f "$tmpfile"
```

This check must report `OK Event subscriptions` before real GitHub delivery can
be proven. If it reports missing `event:pull_request`, `event:issues`, or
`event:deployment_status`, an app owner must update the GitHub App in the
browser:

1. Open `https://github.com/settings/apps/<github-app-slug>`.
2. Complete GitHub sudo/passkey if prompted.
3. Open the App's permissions and events settings.
4. Subscribe to `Pull request`, `Issues`, and `Deployment status` events.
5. Save the App settings and rerun `background-agents:github-app-readiness`.

GitHub's REST API can update App webhook delivery configuration such as URL,
content type, secret, and SSL verification, but the live proof depends on the
App event subscriptions above. Treat missing subscriptions as an owner UI step,
not a secret or env-var problem.

- Database and Better Auth session configuration.
- Vercel sign-in and GitHub OAuth configuration.
- GitHub App configuration:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_PRIVATE_KEY`
  - `NEXT_PUBLIC_GITHUB_APP_SLUG`
  - `GITHUB_WEBHOOK_SECRET`
- Background-agent dispatch configuration:
  - `BACKGROUND_AGENTS_ENABLED=true`
  - `BACKGROUND_AGENTS_ALLOWED_REPOS=<owner>/<repo>` for controlled proof
  - `CRON_SECRET` or `BACKGROUND_AGENTS_CRON_SECRET`
  - `BACKGROUND_AGENTS_WEBHOOK_SECRET`
- Sandbox/runtime and inference provider configuration used by ordinary chat
  runs.
- The readiness panel should report both `Sandbox runtime` and
  `Inference gateway` as ready. On Vercel, the automatic deployment context can
  satisfy these without exposing a provider key; outside Vercel, configure the
  appropriate token or `AI_GATEWAY_API_KEY`.
- The readiness panel should also report `GitHub App webhooks` as ready. That
  check verifies the App subscribes to `pull_request`, `issues`, and
  `deployment_status` events and has the repo permissions needed for clone,
  branch, commit, PR, issue, deployment, status, and metadata evidence.
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

Repo-specific readiness is also available for authenticated operators:

```bash
curl -i \
  "https://<target-host>/api/background-agents/readiness?repoOwner=<owner>&repoName=<repo>&permission=write"
```

The `repoAccess` response verifies the same user-token plus GitHub App
installation coverage used by background-agent execution. It reports typed
reasons such as `no_user_token`, `user_no_access`, `user_no_write`,
`no_installation`, or `app_no_access`; it does not return provider tokens.

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

## Manual Test Trigger Proof (automated)

The cheapest first proof is the manual test trigger driven end-to-end against
the deployed (or local) target. The `background-agents:test-proof` harness posts
the manual test trigger for an existing agent, then polls the run detail API
until a terminal status (or timeout) and prints run id, final status, errorKind,
event count, output PR URL, and elapsed time. It never prints the cookie or any
secret. A run that terminates with a typed failure is still proof success (the
path ran end-to-end and recorded a typed failure) unless
`BACKGROUND_AGENT_PROOF_REQUIRE_SUCCEEDED` is set.

```bash
BACKGROUND_AGENT_PROOF_BASE_URL=https://<target-host> \
BACKGROUND_AGENT_PROOF_AGENT_ID=<agent-id> \
BACKGROUND_AGENT_PROOF_COOKIE='<authenticated-session-cookie>' \
bun run --cwd apps/web background-agents:test-proof
```

Optional variables:

- `BACKGROUND_AGENT_PROOF_TIMEOUT_MS` — run-completion timeout (default 120000)
- `BACKGROUND_AGENT_PROOF_POLL_MS` — poll interval (default 2000)
- `BACKGROUND_AGENT_PROOF_REQUIRE_SUCCEEDED` — fail unless the run succeeded
- `VERCEL_AUTOMATION_BYPASS_SECRET` — preview protection bypass

Expected result:

- dispatch reports `matched>=1 created>=1` and a run id;
- the harness polls the run detail API until a terminal status;
- the summary line shows the final status, event count, and (for failures) the
  typed errorKind;
- a typed failure (e.g. `permission_missing`, `sandbox_unavailable`) is proof
  the durable path ran end-to-end — inspect the run timeline at
  `/background-runs/<runId>` for the event chain.

This complements the webhook-proof and github-webhook-proof harnesses, which
prove trigger delivery and idempotency but do not wait for the run to complete.

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

## Local Manual-Test Proof (captured 2026-06-28)

A local end-to-end proof was run against `next dev` on `http://localhost:3010`
with `OPEN_AGENTS_ENABLE_TEST_AUTH=1` and a migrated local database. This is a
**local, typed-failure** proof — it proves the durable path runs end-to-end to a
typed terminal status, not that a `succeeded`/ready-PR run completed. It is
recorded here so the gap to close is explicit.

- Target: `http://localhost:3010` (local `next dev`, Next.js 16.2.1 / Turbopack)
- Proof agent: `XP8HyGwMhSSfAfh746Pt2` ("Local proof sentinel"),
  `outputMode:none`, `github.issue` trigger, repo
  `dennisonbertram/fork-open-agents` (allowlisted locally)
- Harness: `bun run --cwd apps/web background-agents:test-proof` (built,
  unit-tested, typechecked — see `apps/web/scripts/background-agent-test-proof.ts`)
- Runs captured (both via the manual test trigger, `dev-managed-runtime-user`):
  - `r8WS_WOAblU-MWMXgTCsm` (curl-driven) — `failed`, `errorKind=permission_missing`
  - `3MrkObjYcPJgOR01xnnwB` (harness-driven) — `failed`, `errorKind=permission_missing`,
    `events=4`, `elapsedMs=2387`
- Event timeline (both runs): `background-agent.run.created` →
  `background-agent.trigger.received` → `background-agent.workflow.started` →
  `background-agent.run.failed`
- Sandbox attribution recorded: `sandboxName=background_agent_<runId>`

Proven locally (real, not mocked):

- manual test trigger dispatches and creates a durable run;
- the Vercel Workflow runtime **starts** under `next dev` (`workflow.started`
  event — the workflow is not deferred to a deployed env only);
- sandbox attribution is recorded on the run row;
- failures are typed and observable (`permission_missing` /
  "Connect GitHub to access repositories") with a full event timeline;
- the run reaches a terminal status within seconds, so the path is
  end-to-end-complete to a typed terminal state.

NOT proven locally (remaining gap):

- a `succeeded` run. The `permission_missing` failure is because the test-auth
  user (`dev-managed-runtime-user`) has no connected GitHub token or
  installation for the repo — a **config/credential gap, not a code defect**.
  A local `succeeded` run needs the proof user to have GitHub access; the
  hosted `succeeded`/ready-PR run against a disposable repo remains the #26
  step. When that is captured, fill the "Evidence To Post" template below.

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
