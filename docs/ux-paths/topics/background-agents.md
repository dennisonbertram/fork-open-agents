# UX Paths — Background agents (triggers, webhooks, cron, runs)

Scope: `/api/background-agents*`, `/api/background-agent-runs*`, plus the two
service-auth surfaces (`/api/background-agents/cron`, `/api/background-agents/webhook/[publicId]`)
and the GitHub App webhook that also feeds the same dispatcher.

Auth notes used by every story below (verified in the route files):

- User routes use `requireAuthenticatedUser()` — session cookie. Missing/invalid session → `401`.
- Ownership misses return `404` ("Background agent not found" / "Background run not found"), never `403`.
- `POST /api/background-agents/[agentId]/test` returns `403` only when the feature flag is off
  (`result.enabled === false`, i.e. `BACKGROUND_AGENTS_ENABLED !== "true"`).
- Cron accepts `Authorization: Bearer $CRON_SECRET` **or** `x-background-agents-cron-secret: $CRON_SECRET`
  (secret = `BACKGROUND_AGENTS_CRON_SECRET` falling back to `CRON_SECRET`); missing secret config → `500`, bad secret → `401`.
- Webhook verifies `x-open-agents-signature: sha256=<hex hmac of the RAW body>` with
  `BACKGROUND_AGENTS_WEBHOOK_SECRET`; unset secret → `500`, bad signature → `401`, bad JSON → `400`,
  schema miss (including any unknown key — the schema is `.strict()`) → `400`.

Dispatch result shape (all three dispatch entrypoints return the same object):
`{ enabled, matched, created, duplicates, runIds, loopRunIds, ... }`.

---

## STORY-background-agents-01: Check readiness before creating the first agent

**Type**: short
**Persona**: Maya, a platform engineer evaluating whether background agents can run against her repo
**Goal**: Learn whether the feature is enabled and whether she has write access to `acme-corp/checkout-service`
**Preconditions**: Authenticated session; GitHub App installation may or may not exist
**Ideal path**: 1 call — readiness accepts the repo pair as query params and returns both the global feature state and the repo access verdict in one response.
**Alternate paths**: `GET /api/background-agents/readiness` with no query params returns only the global block; the same GitHub-installation facts also surface via `GET /api/github/installation` and `GET /api/account/status` (duplicate data across three endpoints).

### Steps
1. `GET /api/background-agents/readiness?repoOwner=acme-corp&repoName=checkout-service&permission=write` → expect `200` `{enabled, checks[], repoAccess}`
2. `GET /api/background-agents` → expect `200` `{agents: []}`

### Variations
- Drop `permission` → route defaults to `write` (`parsePermission` only special-cases the literal `"read"`).
- `permission=read` for a read-only reviewer agent.

### Edge Cases
- No session cookie → `401` from `requireAuthenticatedUser`.
- `?repoOwner=acme-corp` without `repoName` → `400` `{error:"repoOwner and repoName are both required"}`.
- `?permission=admin` → silently treated as `write` (no validation error — a quiet footgun).

---

## STORY-background-agents-02: Create a cron-scheduled dependency-audit agent

**Type**: short
**Persona**: Maya
**Goal**: Have an agent run every weekday morning and open a PR bumping vulnerable dependencies
**Preconditions**: STORY-01 readiness returned `enabled: true`
**Ideal path**: 1 call — create carries its triggers inline, so the agent + trigger are one POST.
**Alternate paths**: none found (there is no separate trigger CRUD route for background agents; agent-loop triggers have their own routes under `/api/agent-loops/*`).

### Steps
1. `POST /api/background-agents` — body:
   ```json
   {
     "name": "Weekday dependency audit",
     "description": "Bumps vulnerable npm dependencies and opens a PR",
     "status": "enabled",
     "repoOwner": "acme-corp",
     "repoName": "checkout-service",
     "instructions": "Run `bun audit`. For each high or critical advisory, bump the dependency to the lowest safe version, run the test suite, and open a single PR titled 'chore(deps): weekly security bumps'.",
     "permissions": { "github": { "contents": "write", "pullRequests": "write" } },
     "checkCommand": "bun run ci",
     "githubActions": { "open_pull_request": true, "push": true },
     "writeScope": { "mode": "this_repo" },
     "requireCiGreenForMerge": true,
     "modelId": "anthropic/claude-sonnet-4-5",
     "runBudgetPerTarget": 5,
     "triggers": [
       { "name": "Weekday 07:00 UTC", "kind": "schedule.cron", "status": "enabled", "schedule": "0 7 * * 1-5" }
     ]
   }
   ```
   → expect `201` `{agent}` with `agent.id` and `agent.triggers[0].id`
2. `GET /api/background-agents` → expect `200` `{agents:[...]}` containing the new agent
3. `GET /api/background-agents/{agentId}/status` → expect `200` `{latestRunId:null, latestRunStatus:null, latestOutputUrl:null}`

### Variations
- `"schedule": "@daily"` / `"@hourly"` / `"@weekly"` — accepted presets per `validateSchedule`.
- Omit `status` → defaults to `"disabled"`; omit `githubActions` → defaults to `{open_pull_request:true, comment_on_pr_or_issue:true}`.
- Omit `modelId` → defaults to `null` (inherit); `"user-profile:<id>"` selects an inference profile.

### Edge Cases
- `"triggers": []` → `400` `{error:"Invalid background agent", details}` (min 1).
- `kind:"schedule.cron"` with `"schedule": "every monday"` → `400`, `details.fieldErrors` path `triggers.0.schedule`.
- Unknown top-level key (e.g. `"enabled": true`) → `400` — schema is `.strict()`.
- Malformed JSON body → `400` `{error:"Invalid JSON body"}`.
- `"instructions": ""` → `400` (min 1); >8000 chars → `400`.
- No session → `401`.

---

## STORY-background-agents-03: Manual test dispatch and watch the run stream

**Type**: medium
**Persona**: Maya
**Goal**: Prove the agent actually runs before waiting for the cron window
**Preconditions**: STORY-02 created the agent (`agentId`)
**Ideal path**: 3 calls — dispatch, then stream the run to completion, then read the final detail. Polling `status` is only needed because the dispatch response returns `runIds` but not a terminal state.
**Alternate paths**: `GET /api/background-agents/{agentId}/status` and `GET /api/background-agent-runs?...` and `GET /api/background-agent-runs/{runId}` all surface the same `status`/`outputUrl` for the same run — three endpoints, one fact.

### Steps
1. `POST /api/background-agents/{agentId}/test` — no body; optional header `x-request-id: manual-test-001` → expect `200` `{enabled:true, matched:1, created:1, duplicates:0, runIds:["<runId>"], loopRunIds:[]}`
2. `GET /api/background-agent-runs/{runId}/stream` (SSE) → expect `200` `text/event-stream`, `event: event` frames with incrementing `id:` (the event `sequence`), `: heartbeat` comments every ~15s, terminated by `event: done` `data: {"status":"succeeded"}`
3. `GET /api/background-agent-runs/{runId}` → expect `200` `{run, agent, events[], outputs[]}`
4. `GET /api/background-agents/{agentId}/status` → expect `200` `{latestRunId:"<runId>", latestRunStatus:"succeeded", latestOutputUrl:"https://github.com/acme-corp/checkout-service/pull/412"}`

### Variations
- Reconnect mid-stream with `Last-Event-ID: 14` → replay resumes after sequence 14 (`listBackgroundAgentEventsAfter`).
- Stream a run that is already terminal → events replay immediately, then `event: done`, then close.
- `Last-Event-ID: not-a-number` → parsed as `null`, so the full history replays (silent fallback).

### Edge Cases
- Test dispatch on an agent whose triggers array is empty → `400` `{error:"Background agent has no triggers to test"}` (only reachable via an agent whose triggers were removed by PATCH).
- Feature flag off → `403` `{...result, error:"Background agents are disabled"}` with `enabled:false`.
- `POST /api/background-agents/00000000-0000-0000-0000-000000000000/test` → `404`.
- Streaming another user's run id → `404` `{error:"Background run not found"}` (JSON, not SSE).
- No session on the stream route → `401`.

---

## STORY-background-agents-04: Cron sweep fires the schedule (service auth)

**Type**: short
**Persona**: The platform scheduler (Vercel Cron / an ops curl)
**Goal**: Dispatch every agent whose `nextRunAt` window has arrived
**Preconditions**: STORY-02's enabled cron agent exists; `CRON_SECRET` or `BACKGROUND_AGENTS_CRON_SECRET` configured
**Ideal path**: 1 call — the sweep is a single idempotent service call that returns what it created.
**Alternate paths**: `GET` and `POST` on `/api/background-agents/cron` are the **same handler** (`handleCron`) — a duplicate method surface. `/api/agent-loops/sweep` is the sibling sweep for loops with the same secret scheme.

### Steps
1. `POST /api/background-agents/cron` — headers `Authorization: Bearer $CRON_SECRET`, `x-request-id: cron-2026-08-02T07:00Z`; no body → expect `200` `{enabled:true, matched:N, created:N, duplicates:0, runIds:[...], loopRunIds:[...]}`
2. `GET /api/background-agent-runs?limit=10` (as Maya, session cookie) → expect `200` `{runs:[{source:"schedule", status:"queued"|"running", ...}]}`

### Variations
- Header form `x-background-agents-cron-secret: $CRON_SECRET` instead of Bearer — accepted identically.
- `GET /api/background-agents/cron` with the same header — identical behavior and body.
- Immediate second sweep in the same window → `created:0` (persisted `nextRunAt` already advanced).

### Edge Cases
- Wrong secret → `401` `{error:"Unauthorized"}`.
- No auth header at all → `401`.
- Neither `CRON_SECRET` nor `BACKGROUND_AGENTS_CRON_SECRET` set → `500` `{error:"CRON_SECRET or BACKGROUND_AGENTS_CRON_SECRET is not configured"}` — note this is checked **before** auth, so an unconfigured deploy leaks its config state to an unauthenticated caller.
- A session cookie alone (no secret) → `401`; this route does not accept user auth.

---

## STORY-background-agents-05: External error webhook triggers an incident-triage agent

**Type**: medium
**Persona**: Priya, an SRE wiring Sentry alerts into an auto-triage agent
**Goal**: A production error creates a run that investigates and comments on the tracking issue
**Preconditions**: Authenticated session for setup; `BACKGROUND_AGENTS_WEBHOOK_SECRET` configured
**Ideal path**: 3 calls — create the agent with a `webhook.error` trigger, read back its `webhookPublicId`, POST the signed event. The read-back is only needed because create does not surface a ready-to-paste webhook URL.
**Alternate paths**: none found for the external-error path; GitHub-sourced events instead arrive at `POST /api/github/webhook` (HMAC via `X-Hub-Signature-256`) and land in the same dispatcher/run tables.

### Steps
1. `POST /api/background-agents` — body:
   ```json
   {
     "name": "Prod error triage",
     "status": "enabled",
     "repoOwner": "acme-corp",
     "repoName": "checkout-service",
     "instructions": "Given a production error payload, find the responsible code path, summarize the likely cause with file and line references, and comment the analysis on the linked GitHub issue. Do not push code.",
     "permissions": { "github": { "contents": "read", "issues": "write" } },
     "githubActions": { "comment_on_pr_or_issue": true },
     "triggers": [
       { "name": "Sentry critical", "kind": "webhook.error", "status": "enabled",
         "conditions": { "severities": ["critical", "error"], "ignoreActors": ["dependabot[bot]"] } }
     ]
   }
   ```
   → expect `201` `{agent}`
2. `GET /api/background-agents` → expect `200`; read `agents[].triggers[].webhookPublicId` (non-null only for `webhook.error` triggers)
3. `POST /api/background-agents/webhook/{publicId}` — headers `x-open-agents-signature: sha256=<hmac_sha256(raw_body, $BACKGROUND_AGENTS_WEBHOOK_SECRET)>`, `content-type: application/json`; body:
   ```json
   {
     "externalId": "sentry-evt-9f2c1a4e",
     "repoOwner": "acme-corp",
     "repoName": "checkout-service",
     "severity": "critical",
     "title": "TypeError: cannot read properties of undefined (reading 'total')",
     "message": "at computeCartTotal (lib/cart/total.ts:48)",
     "url": "https://sentry.io/organizations/acme/issues/5512091/",
     "actor": "sentry",
     "occurredAt": "2026-08-02T09:14:22.000Z"
   }
   ```
   → expect `200` `{enabled:true, matched:1, created:1, duplicates:0, runIds:["<runId>"], loopRunIds:[]}`
4. `GET /api/background-agent-runs?repoOwner=acme-corp&repoName=checkout-service&limit=5` → expect `200` `{runs:[{source:"webhook", ...}]}`
5. `GET /api/background-agent-runs/{runId}` → expect `200` `{run, agent, events, outputs}` — `agent` is the redacted evidence view (`toSafeBackgroundAgentEvidence`), not the raw row.

### Variations
- Replay the exact same body+signature → `200` with `created:0, duplicates:1` and the original `runIds` (idempotency key = `agentId:triggerId:source:kind:externalId`).
- Severity outside `conditions.severities` (e.g. `"warning"`) → `200` `{matched:0, created:0, runIds:[]}` — a no-op success, not an error.

### Edge Cases
- Missing `x-open-agents-signature` → `401` `{error:"Invalid webhook signature"}`.
- Signature computed over a re-serialized body instead of the raw bytes → `401`.
- Valid signature, body `{"externalId":""}` → `400` `{error:"Invalid webhook payload"}`.
- Extra key such as `"fingerprint":"abc"` → `400` (`.strict()`).
- `"url": "not-a-url"` → `400`.
- Body that is not JSON but correctly signed → `400` `{error:"Invalid JSON payload"}`.
- Unknown `publicId` with a valid signature → `200` with `matched:0` (no `404` — existence is not leaked).
- `BACKGROUND_AGENTS_WEBHOOK_SECRET` unset → `500` before signature checking.

---

## STORY-background-agents-06: Preflight external toolkits before enabling an agent

**Type**: short
**Persona**: Priya
**Goal**: Confirm the Linear and Slack toolkits will actually be available to the next run
**Preconditions**: STORY-05 agent exists
**Ideal path**: 2 calls — attach the toolkit slugs, then read the prediction.
**Alternate paths**: Connection state for the same toolkits is also readable via `/api/composio/*` (profiles/connections) and via `/api/repositories/[owner]/[repo]/tool-policy` — three surfaces describing the same availability facts.

### Steps
1. `PATCH /api/background-agents/{agentId}` — body: `{"composioToolkitSlugs":["linear","slack"]}` → expect `200` `{agent}`
2. `GET /api/background-agents/{agentId}/tool-preflight` → expect `200` `{toolkits:[{slug:"linear", ...}, {slug:"slack", ...}]}`

### Variations
- Agent with no toolkit slugs → `200` `{toolkits: []}` with no Composio call made at all.
- Repo tool-policy blocks a slug → the toolkit is returned as unavailable with a reason rather than erroring.

### Edge Cases
- Unknown/other-user `agentId` → `404` `{error:"Background agent not found"}`.
- Repo-policy read failure → `500` `{error:"Failed to compute tool preflight."}` (distinct from a per-toolkit `composio_unreachable` prediction).
- No session → `401`.

---

## STORY-background-agents-07: Full lifecycle of a PR-review agent (multi-turn, event-driven)

**Type**: long
**Persona**: Dev team lead Sam, standing up an automated PR reviewer and iterating on it over several rounds
**Goal**: An agent that reviews opened PRs, is tuned across several dispatches based on observed run evidence, and finally gets merge authority
**Preconditions**: GitHub App installed on `acme-corp/checkout-service`; feature enabled
**Ideal path**: 12 calls — create, verify readiness, test, inspect, tune (PATCH), retest, inspect, widen permissions, retest, confirm, list runs, disable. Each tuning round genuinely needs a dispatch + an evidence read; nothing collapses further.
**Alternate paths**: run evidence is reachable three ways — `GET /api/background-agent-runs/{runId}`, the SSE stream, and `GET /api/account/diagnosis?source=background_agent&id={runId}`; agent-level status duplicates in `/api/background-agents/{agentId}/status` and in the `runs` list.

### Steps
1. `GET /api/background-agents/readiness?repoOwner=acme-corp&repoName=checkout-service&permission=write` → expect `200` `{enabled:true, repoAccess:{...}}`
2. `POST /api/background-agents` — body:
   ```json
   {
     "name": "PR reviewer",
     "status": "enabled",
     "repoOwner": "acme-corp",
     "repoName": "checkout-service",
     "instructions": "Review the diff of the triggering pull request. Flag missing tests, unsafe SQL, and unhandled promise rejections. Leave one consolidated review comment. Never push commits.",
     "permissions": { "github": { "contents": "read", "pullRequests": "write", "checks": "read" } },
     "githubActions": { "comment_on_pr_or_issue": true },
     "writeScope": { "mode": "this_repo" },
     "runBudgetPerTarget": 3,
     "triggers": [
       { "name": "PR opened or synchronized", "kind": "github.pull_request", "status": "enabled",
         "conditions": { "actions": ["opened", "synchronize"], "branches": ["main"], "ignoreActors": ["open-agents[bot]"] } }
     ]
   }
   ```
   → expect `201` `{agent}`
3. `GET /api/background-agents/{agentId}/tool-preflight` → expect `200` `{toolkits:[]}` (none attached yet)
4. `POST /api/background-agents/{agentId}/test` → expect `200` `{enabled:true, matched:1, created:1, runIds:["run-1"]}`
5. `GET /api/background-agent-runs/run-1/stream` → SSE to `event: done`
6. `GET /api/background-agent-runs/run-1` → expect `200`; observe `run.status:"failed"` with `run.errorKind:"agent_stalled"` (round 1: instructions too vague)
7. `PATCH /api/background-agents/{agentId}` — body: `{"instructions":"Review the diff of the triggering pull request. Produce at most 8 findings, each with file:line and a one-line fix. Post them as a single review comment, then stop. Never push commits.","runBudgetPerTarget":5}` → expect `200` `{agent}`
8. `POST /api/background-agents/{agentId}/test` → expect `200` `{created:1, runIds:["run-2"]}`
9. `GET /api/background-agent-runs/run-2` → expect `200` `{run:{status:"succeeded", outputUrl:"https://github.com/acme-corp/checkout-service/pull/418#pullrequestreview-...”}, events:[...], outputs:[...]}`
10. `PATCH /api/background-agents/{agentId}` — body: `{"githubActions":{"comment_on_pr_or_issue":true,"approve_pull_request":true,"merge_pull_request":true},"requireCiGreenForMerge":true,"permissions":{"github":{"contents":"read","pullRequests":"write","checks":"read","statuses":"read"}}}` → expect `200`
11. `POST /api/background-agents/{agentId}/test` → expect `200` `{created:1, runIds:["run-3"]}`
12. `GET /api/background-agents/{agentId}/status` → expect `200` `{latestRunId:"run-3", latestRunStatus:"running"|"succeeded", latestOutputUrl}`
13. `GET /api/background-agent-runs?repoOwner=acme-corp&repoName=checkout-service&limit=25` → expect `200` `{runs:[run-3, run-2, run-1]}`
14. `GET /api/account/diagnosis?source=background_agent&id=run-1&limit=20` → expect `200` `{diagnosis}` for the failed round-1 run
15. `PATCH /api/background-agents/{agentId}` — body: `{"status":"disabled"}` → expect `200` `{agent:{status:"disabled"}}`
16. `POST /api/background-agents/{agentId}/test` → expect `200` `{matched:0, created:0, runIds:[]}` — a disabled agent yields a no-op success, not a `409`/`400`.

### Variations
- Replace step 4/8/11 dispatches with a real `POST /api/github/webhook` (signed `X-Hub-Signature-256`, `X-GitHub-Event: pull_request`) to exercise the production trigger path.
- Add `"actors":["sam-dev"]` to conditions so only that author's PRs trigger reviews.
- `writeScope:{"mode":"specific_repos","repos":[{"owner":"acme-corp","name":"checkout-service"}]}` instead of `this_repo`.

### Edge Cases
- Step 7 with `{"status":"paused"}` → `400` (enum is `enabled|disabled` only).
- Step 10 with an unknown action key (`"rebase_pull_request": true`) → `400` (strict `githubActions`).
- `PATCH` with `{}` → `200` and a no-op update (every field is optional; there is no "nothing to update" guard).
- `PATCH` on another user's agent → `404`.
- `runBudgetPerTarget: 0` → `400` (min 1); `1001` → `400` (max 1000).

---

## STORY-background-agents-08: Deployment-failure agent with a repo-scoped run feed

**Type**: medium
**Persona**: Priya
**Goal**: React to failed production deployments and open a rollback PR, then audit the last week of runs for that repo only
**Preconditions**: Authenticated session; GitHub App installed
**Ideal path**: 4 calls — create, dispatch, filter runs by repo, open the newest run. The repo filter exists on the list route, so no client-side filtering is needed.
**Alternate paths**: `GET /api/background-agents/{agentId}/status` returns the newest run for one agent, but it does so by fetching **50 runs and filtering in JS** — a second, less efficient path to the same fact the list route already serves.

### Steps
1. `POST /api/background-agents` — body:
   ```json
   {
     "name": "Failed deploy responder",
     "status": "enabled",
     "repoOwner": "acme-corp",
     "repoName": "checkout-service",
     "instructions": "When a production deployment fails, identify the commit range since the last successful deploy, summarize the probable breaking change, and open a revert PR against main.",
     "permissions": { "github": { "contents": "write", "pullRequests": "write", "deployments": "read", "statuses": "read" } },
     "checkCommand": "bun run ci",
     "githubActions": { "open_pull_request": true, "push": true },
     "triggers": [
       { "name": "Production deploy failed", "kind": "github.deployment_status", "status": "enabled",
         "conditions": { "environments": ["production"], "actions": ["failure", "error"] } }
     ]
   }
   ```
   → expect `201`
2. `POST /api/background-agents/{agentId}/test` → expect `200` `{created:1, runIds:["<runId>"]}`
3. `GET /api/background-agent-runs?repoOwner=acme-corp&repoName=checkout-service&limit=200` → expect `200` `{runs}` (limit is clamped to 1..200)
4. `GET /api/background-agent-runs/{runId}` → expect `200` `{run, agent, events, outputs}`

### Variations
- `kind:"github.check_suite"` with `conditions.branches:["main"]` for a CI-failure responder.
- `kind:"github.issue"` with `conditions.labels:["needs-repro"]` for an issue triager.

### Edge Cases
- `?limit=0` → clamped to `1`; `?limit=9999` → clamped to `200`; `?limit=abc` → falls back to `50`. All `200` — no validation error.
- `?repoOwner=acme-corp` without `repoName` → `200` with an owner-only filter (unlike readiness, which `400`s on the same asymmetry — inconsistent behavior between two routes taking the same pair).
- No session → `401`.

---

## STORY-background-agents-09: Delete an agent and confirm the runs outlive it

**Type**: short
**Persona**: Maya, retiring an experiment
**Goal**: Remove the agent without losing the audit trail
**Preconditions**: STORY-02 agent exists with at least one completed run
**Ideal path**: 2 calls — delete, then confirm the list no longer contains it.
**Alternate paths**: `PATCH ... {"status":"disabled"}` is the soft alternative reaching a similar operational outcome (no future runs) while keeping the config.

### Steps
1. `GET /api/background-agent-runs?limit=5` → expect `200`; note a `runId` belonging to the agent
2. `DELETE /api/background-agents/{agentId}` → expect `200` `{success:true}`
3. `GET /api/background-agents` → expect `200` `{agents}` without the deleted agent
4. `GET /api/background-agent-runs/{runId}` → expect `200` or `404` — record which; this asserts whether run history survives agent deletion (the run→agent join in `getOwnedBackgroundAgentRunWithAgent` is the thing under test).
5. `GET /api/background-agents/{agentId}/status` → expect `200` `{latestRunId:null,...}` — note the route does **not** `404` for a deleted/unknown agent; it silently returns an empty status.

### Edge Cases
- `DELETE` the same agent twice → second call `404` `{error:"Background agent not found"}`.
- `DELETE` another user's agent → `404`.
- `POST /api/background-agents/{deletedAgentId}/test` → `404`.
- No session → `401`.

---

## STORY-background-agents-10: Two agents on one repo, one cron sweep, ping-pong guarded

**Type**: long
**Persona**: Sam, running a reviewer agent and a fixer agent on the same repo
**Goal**: Have the fixer respond to the reviewer's findings without the two agents triggering each other forever
**Preconditions**: Feature enabled; cron secret configured
**Ideal path**: 10 calls — two creates, two preflight/verification reads, one sweep, and evidence reads per agent. The ping-pong guard is configuration (`ignoreActors`, `runBudgetPerTarget`), not extra calls.
**Alternate paths**: the sweep in step 5 can be replaced by two `POST /api/background-agents/{agentId}/test` calls, or by two signed `POST /api/github/webhook` deliveries — three distinct ways to produce the same runs.

### Steps
1. `POST /api/background-agents` (reviewer) — body: as STORY-07 step 2 but `"name":"Reviewer"` and `"conditions":{"actions":["opened","synchronize"],"ignoreActors":["open-agents-fixer[bot]"]}` → expect `201`, capture `reviewerAgentId`
2. `POST /api/background-agents` (fixer) — body:
   ```json
   {
     "name": "Fixer",
     "status": "enabled",
     "repoOwner": "acme-corp",
     "repoName": "checkout-service",
     "instructions": "When a review requests changes, apply the smallest fix that satisfies each comment, run `bun run ci`, and push to the PR branch. Do not open new PRs.",
     "permissions": { "github": { "contents": "write", "pullRequests": "write" } },
     "githubActions": { "push": true, "comment_on_pr_or_issue": true },
     "requireCiGreenForMerge": true,
     "runBudgetPerTarget": 3,
     "triggers": [
       { "name": "Changes requested", "kind": "github.pull_request_review", "status": "enabled",
         "conditions": { "actions": ["submitted"], "ignoreActors": ["open-agents-reviewer[bot]"] } }
     ]
   }
   ```
   → expect `201`, capture `fixerAgentId`
3. `GET /api/background-agents` → expect `200` with both agents
4. `PATCH /api/background-agents/{reviewerAgentId}` — body: `{"triggers":[{"name":"Nightly re-review","kind":"schedule.cron","status":"enabled","schedule":"@daily"},{"name":"PR opened","kind":"github.pull_request","status":"enabled","conditions":{"actions":["opened"],"ignoreActors":["open-agents-fixer[bot]"]}}]}` → expect `200`; note that PATCHing `triggers` replaces the whole set while preserving per-trigger state (`lastSkipReason`, `webhookPublicId`) for surviving triggers
5. `POST /api/background-agents/cron` — header `Authorization: Bearer $CRON_SECRET` → expect `200` `{enabled:true, matched:>=1, created:>=1, runIds:[...]}`
6. `GET /api/background-agent-runs?limit=20` → expect `200` `{runs}` with `source:"schedule"` entries
7. `GET /api/background-agent-runs/{reviewerRunId}/stream` → SSE to `event: done`
8. `POST /api/background-agents/{fixerAgentId}/test` → expect `200` `{created:1, runIds:["<fixerRunId>"]}`
9. `GET /api/background-agent-runs/{fixerRunId}` → expect `200`; inspect `events[]` for the tool-call trail and `outputs[]` for the pushed commit / comment
10. `POST /api/background-agents/cron` again immediately → expect `200` `{created:0}` for the daily trigger (window already consumed)
11. `GET /api/background-agents/{reviewerAgentId}/status` and `GET /api/background-agents/{fixerAgentId}/status` → both `200` with their latest run ids

### Variations
- Set `runBudgetPerTarget: 1` on both and dispatch twice against the same PR → second run is created but recorded as skipped/limited rather than rejected at the API layer.
- Give the fixer `writeScope:{"mode":"all_repos"}` and re-run preflight to see the broadened blast radius.

### Edge Cases
- Step 4 with 11 triggers → `400` (max 10).
- Step 4 with a mixed set where one cron `schedule` is `"* * * *"` (4 fields) → `400` on that element's `schedule` path.
- Step 5 with the secret in the wrong header name → `401`.
- Two concurrent sweeps in the same window → the second returns `created:0`/`duplicates` rather than double-dispatching (idempotency key covers `agentId:triggerId:source:kind:externalId`).

---

## Cross-cutting observations

- **Same data, many endpoints**: a run's `status` + `outputUrl` is served by `GET /api/background-agent-runs`, `GET /api/background-agent-runs/{runId}`, `GET /api/background-agent-runs/{runId}/stream`, `GET /api/background-agents/{agentId}/status`, and `GET /api/account/diagnosis?source=background_agent`. Five surfaces.
- **Duplicate method surface**: `GET` and `POST /api/background-agents/cron` share one handler with identical semantics.
- **Three dispatch entrypoints, one result shape**: manual test, cron sweep, and webhook all return `{enabled, matched, created, duplicates, runIds, loopRunIds}` — but only the manual-test route converts `enabled:false` into a `403`; cron and webhook return `200` with `enabled:false`.
- **Silent no-ops**: unknown webhook `publicId`, disabled agent test dispatch, and non-matching conditions all return `200` with `matched:0` — indistinguishable from "delivered but filtered" without reading the counters.
- **Inconsistent partial-repo-param handling**: `/readiness` `400`s on owner-without-name; `/background-agent-runs` accepts it.
- **Config leak before auth**: the cron route's missing-secret `500` is returned to unauthenticated callers.
