# App Discovery: Open Agents API

## Application Type
Open Agents is a cloud AI coding-agent platform built as a Next.js 16 (App Router) monorepo app (`apps/web`, Turborepo, with `packages/sandbox`, `packages/agent`, etc.). Users drive persistent, sandboxed coding sessions through chat; the same platform also runs unattended **background agents** (webhook/cron-triggered), graph-based **agent loops**, an approval-gated **Verified Build harness**, a **GTM (go-to-market) coordinator** suite, and Composio-backed third-party tool integrations. Every product surface is backed by a JSON/SSE HTTP API under `/api/**` (164 `route.ts` files), making it fully exercisable with `curl`.

## Tech Stack
- **Framework**: Next.js 16.2.1 (App Router, Node runtime), React 19.2, TypeScript, Zod for request validation almost everywhere.
- **Auth**: better-auth 1.6 (GitHub OAuth provider), mounted at `/api/auth/[...all]`.
- **Database**: Postgres via `postgres` (postgres.js) + Drizzle ORM 0.45, connection string `POSTGRES_URL` (Neon-compatible). 62 tables in `apps/web/lib/db/schema.ts`.
- **Cache/Rate-limit**: Redis via `ioredis` (Upstash-compatible, `REDIS_URL`) — used by `lib/rate-limit.ts`, skills cache; `/api/health` probes it directly.
- **AI**: Vercel AI SDK (`ai` package) with AI **Gateway** (`gateway()`), model ids like `anthropic/claude-haiku-4.5`, `anthropic/claude-opus-4.6`; used for chat, title/PR/commit-message generation, agent-loop drafting, skill drafting.
- **Durable execution**: Vercel `workflow` package (v4) — chat sends (`/api/chat`) start a durable workflow run (`workflow/api` `start`/`getRun`), tracked via `chat.activeStreamId`.
- **Sandbox**: `@vercel/sandbox` wrapped by internal `@open-agents/sandbox` package — ephemeral/persistent named VMs with pause/resume/snapshot semantics.
- **Third-party tools**: `@composio/core` + `@composio/vercel` for Composio toolkit connections.
- **GitHub**: `@octokit/rest`, GitHub App installation tokens (`lib/github/app.ts`), Actions manager, Secrets manager.
- **Voice**: `@ai-sdk/elevenlabs` for `/api/transcribe`.
- **Bot protection**: `checkBotProtection()` (botid) on several mutating/AI-cost routes.

## Auth model
Nearly every route resolves a cookie session through one of two code paths that both funnel into `apps/web/lib/session/resolve-session.ts` → `resolveSessionFromHeaders`:
1. `requireAuthenticatedUser()` (`apps/web/app/api/sessions/_lib/session-context.ts`) — the common helper, 401s with `{error:"Not authenticated"}` if no session.
2. `getServerSession()` (cached, `next/headers`) or `getSessionFromReq(req)` (NextRequest variant) called directly with a manual `401` check — used by `sessions` (top-level), `sandbox` (top-level), `generate-pr`, `generate-title`, `transcribe`, `settings/preferences`, `settings/model-variants`, `settings/skills*`, `usage*`, `github/*` (non-Actions/Secrets), `vercel/repo-projects`, `sessions/[sessionId]` (top-level route), `sessions/[sessionId]/generate-commit-message`.

**Ownership checks**: resource-scoped routes additionally verify `session.userId === record.userId` via `requireOwnedSession` / `requireOwnedSessionChat` / `requireOwnedSessionWithSandboxGuard` (all in `session-context.ts`) or per-feature `getOwned...` lookups (agent loops, background agents, learnings, harness runs, GitHub Actions/Secrets via `verifyRepoAccess`). Most return `404` (not `403`) to avoid existence leaks; a few return `403` (e.g. `sessions/[sessionId]` PATCH-context routes, `generate-pr`).

**Test-auth bypass** (`apps/web/lib/session/test-auth.ts`, the mechanism a curl-driven test phase should use): when `NODE_ENV=development` OR `OPEN_AGENTS_ENABLE_TEST_AUTH=1`, **and** `VERCEL_ENV` is not `"production"`, a request cookie `open_agents_test_user_id=dev-managed-runtime-user` resolves to a fixed fake session (`userId: dev-managed-runtime-user`) — checked *before* any real cookie/authorization-header presence check, so it works with zero prior state. Production (`VERCEL_ENV=production`) refuses test-auth even if the flag is set. Cookie-only setter: `GET /api/dev/test-auth` (404 unless `isTestAuthEnabled()`; optional `?next=/sessions`). `GET /api/dev/managed-runtime-demo` also sets the cookie but provisions a sandbox — do not use it just to authenticate. Recommended flow: start the server with `OPEN_AGENTS_ENABLE_TEST_AUTH=1` (or `NODE_ENV=development`), call `/api/dev/test-auth` once, capture the `Set-Cookie`, and replay it on later requests instead of driving real GitHub OAuth.

**Service-to-service (cron) auth**: `/api/background-agents/cron` and `/api/agent-loops/sweep` accept `Authorization: Bearer <secret>` or header `x-background-agents-cron-secret: <secret>`, where secret = `BACKGROUND_AGENTS_CRON_SECRET` falling back to `CRON_SECRET`.

**Webhook auth**: `/api/github/webhook` verifies `X-Hub-Signature-256` (HMAC-SHA256 over raw body) using `GITHUB_WEBHOOK_SECRET`. `/api/background-agents/webhook/[publicId]` verifies a custom `x-open-agents-signature` header using `BACKGROUND_AGENTS_WEBHOOK_SECRET`.

**Fully public** (no auth at all): `/api/health`, `/api/models`, `/api/harness/ready`, `/api/shared/[shareId]/markdown`, `/api/shared/[shareId]/status`, `/api/vercel/projects/[idOrName]/env` (permanent 404 stub), `/api/auth/info` (returns `{user:undefined}` when signed out, not a 401), `/api/auth/[...all]` (is the auth provider), `/api/sessions/[sessionId]/share` (deprecated, always `410 Gone`), `/api/github/create-repo` (auth required but always `501 Not Implemented`).

## Full route inventory
164 route files; the table below lists one row per exported HTTP method (a file with GET+POST+PATCH+DELETE yields 4 rows), so the row count exceeds 164. Auth codes: `none` = no auth; `user` = cookie session only; `user+own` = session + resource-ownership check; `test-cookie` = only reachable with the dev test-auth cookie or the dev/test flag; `CRON_SECRET` = bearer/header cron secret; `webhook-hmac` = signed webhook payload.

| Method | Path | Auth | Purpose | Request shape | Response shape |
|---|---|---|---|---|---|
| GET | /api/account/diagnosis | user | Diagnose a work item across sources | query: source∈{session,chat_workflow,background_agent,agent_loop}, id, limit? | `{diagnosis}` \| 400/404 |
| GET | /api/account/status | user | Account-wide activity snapshot | query: window? | `{snapshot}` |
| GET | /api/agent-loop-runs/[runId] | user+own(404) | Loop run detail: run, loop summary, steps, events, watchdog runs | none | `{run,loop,steps,events,watchdogRuns}` |
| POST | /api/agent-loop-runs/[runId]/cancel | user | Cancel a loop run | none | `{success:true}` \| mapped error |
| POST | /api/agent-loop-runs/[runId]/pause | user | Pause a loop run | none | `{success:true}` |
| POST | /api/agent-loop-runs/[runId]/resume | user | Resume a loop run | none | `{success:true}` |
| POST | /api/agent-loop-runs/[runId]/retry | user | Retry current step | none | `{success:true}` |
| GET | /api/agent-loops | user | List loops (filter repoOwner/repoName) | query | `{loops}` |
| POST | /api/agent-loops | user | Create a loop | zod `createAgentLoopBodySchema` {name,description,repoOwner,repoName,definition,guardrails,permissions,status} | `{loop}` 201 \| 400 loop_invalid |
| GET | /api/agent-loops/[loopId] | user+own | Get loop + triggers | none | `{loop,triggers}` \| 404 |
| PATCH | /api/agent-loops/[loopId] | user+own | Update loop | `updateAgentLoopBodySchema` | `{loop}` \| 400/404 |
| DELETE | /api/agent-loops/[loopId] | user+own | Delete loop | none | `{success:true}` \| 404 |
| GET | /api/agent-loops/[loopId]/runs | user | List runs for a loop | query limit | `{runs}` |
| POST | /api/agent-loops/[loopId]/runs | user | Manually start a loop run | none | `{runId,created}` 202 \| 400/403/404/409/502 |
| GET | /api/agent-loops/[loopId]/triggers | user+own | List triggers | none | `{triggers}` \| 404 |
| POST | /api/agent-loops/[loopId]/triggers | user+own | Create trigger | `createLoopTriggerBodySchema` | `{trigger}` 201 |
| PATCH | /api/agent-loops/[loopId]/triggers/[triggerId] | user+own | Update trigger | `updateLoopTriggerBodySchema` | `{trigger}` \| 400/404 |
| DELETE | /api/agent-loops/[loopId]/triggers/[triggerId] | user+own | Delete trigger | none | `{success:true}` \| 404 |
| POST | /api/agent-loops/draft | user | AI-draft a loop definition from NL | `{description: string(8-2000)}` | `{name,description,definition}` \| 422/502 |
| GET | /api/agent-loops/readiness | user | Feature-flag + repo-allowlist readiness | query owner?,repo? | `{enabled,checks[]}` |
| GET/POST | /api/agent-loops/sweep | CRON_SECRET | Mark stalled loop runs | none | `{stalledCount,checkedCount}` \| 401/500 |
| GET | /api/agents/tool-entries | user | List proposed tool entries | query agentId | `{entries}` \| 400 |
| POST | /api/agents/tool-entries | user | Approve/reject a proposed tool entry | `{action:"approve"|"reject",entryId}` | `{ok,action}` \| 404 |
| GET/POST | /api/auth/[...all] | none (is the provider) | better-auth catch-all: sign-in/up, GitHub OAuth callback, session, sign-out | provider-specific | provider-specific |
| GET | /api/auth/info | none | Current user + GitHub link/admin status | none | `{user,authProvider,isAdmin,hasGitHub,...}` or `{user:undefined}` |
| GET | /api/automations | user | Unified automations list w/ filters | query | `{requestId,...snapshot}` \| 400 |
| GET | /api/background-agent-runs | user | List background agent runs | query repoOwner?,repoName?,limit? | `{runs}` |
| GET | /api/background-agent-runs/[runId] | user+own | Run detail: events + outputs | none | `{run,agent,events,outputs}` \| 404 |
| GET | /api/background-agent-runs/[runId]/stream | user+own | SSE stream of run events | header `Last-Event-ID`? | `text/event-stream` |
| GET | /api/background-agents | user | List agents | none | `{agents}` |
| POST | /api/background-agents | user | Create agent | `createBackgroundAgentSchema` | `{agent}` 201 \| 400 |
| PATCH | /api/background-agents/[agentId] | user | Update agent | `updateBackgroundAgentSchema` | `{agent}` \| 404 |
| DELETE | /api/background-agents/[agentId] | user | Delete agent | none | `{success:true}` \| 404 |
| GET | /api/background-agents/[agentId]/status | user | Latest run status (poll) | none | `{latestRunId,latestRunStatus,latestOutputUrl}` |
| POST | /api/background-agents/[agentId]/test | user | Manually dispatch a test run | none | result \| 400/403/404 |
| GET | /api/background-agents/[agentId]/tool-preflight | user | Predict toolkit availability for next run | none | `{toolkits}` \| 404 |
| GET/POST | /api/background-agents/cron | CRON_SECRET | Dispatch all scheduled agents | none | result \| 401/500 |
| GET | /api/background-agents/readiness | user | Feature + repo readiness | query repoOwner?,repoName?,permission? | readiness object |
| POST | /api/background-agents/webhook/[publicId] | webhook-hmac | External error-webhook trigger | `{externalId,repoOwner?,repoName?,severity?,title?,message?,url?,actor?,occurredAt?}` (strict) | result \| 401/400/500 |
| POST | /api/chat | user+own(session+chat) | Send a chat message; starts/reconnects a durable workflow run, may route into Verified Build harness | `{messages,sessionId,chatId,workflowId?,inputValues?,workflowSchema?,workflowSchemaVersion?}` | UI-message stream, header `x-workflow-run-id` \| 400/403/409/422/502 |
| POST | /api/chat/[chatId]/stop | user+own | Cancel active chat workflow run | `{assistantMessage?}` optional | `{success:true}` |
| GET | /api/chat/[chatId]/stream | user+own | Reconnect to an active chat stream | none | UI-message stream \| 204 if none |
| POST | /api/composio/connect | user | Create a Composio OAuth connect link | `{toolkitSlug? or authConfigId?, alias?, callbackUrl?}` (refine: one required) | `{id,redirectUrl}` \| 400 |
| GET | /api/composio/connected-accounts | user | List connected accounts | none | `{accounts,unavailable?}` |
| GET | /api/composio/status | user | Composio config/live status | query live? | `{status}` |
| GET | /api/composio/toolkits | user | Toolkit catalog (cached 1h) | none | `{toolkits}` \| 502 |
| GET | /api/dev/managed-runtime-demo | test-cookie | Dev-only: seed demo session + sandbox + set test-auth cookie | query profileId? | demo payload, sets `open_agents_test_user_id` cookie \| 404 if disabled |
| GET | /api/dev/test-auth | test-cookie | Dev-only: seed demo user + GitHub rows and set test-auth cookie (no sandbox) | query next? (same-origin relative path) | `{ok,userId}` + `Set-Cookie` \| 302 when `next` is safe \| 404 if disabled |
| POST | /api/generate-pr | user+own(session) | Prepare branch + AI-generate PR title/body | `{sessionId,sessionTitle,baseBranch,branchName,createBranchOnly?}` | `{title,body,branchName}` or `{branchName}` \| 400/403/404 |
| POST | /api/generate-title | user | AI session title from a message | `{message}` | `{title}` \| 400/401/500 |
| GET | /api/github/app/callback | user (redirect) | GitHub App Setup URL callback | query installation_id?,setup_action?,state | redirect |
| GET | /api/github/app/install | user (redirect) | Kick off GitHub App install | query next?,target_id?,reconnect? | redirect |
| GET | /api/github/branches | user (fallback public) | List/search branches | query owner,repo,limit?,query? | `{branches,defaultBranch}` \| 400/401/500 |
| GET | /api/github/connection-status | user | GitHub connection + sync status | none | status object |
| POST | /api/github/create-repo | user | (Disabled) create repo | any JSON | 501 |
| GET | /api/github/installations | user | List installations | none | array |
| GET | /api/github/installations/repos | user | List repos for an installation | query installation_id,query?,limit? | repos array |
| GET | /api/github/orgs | user | List user's orgs | none | orgs array \| 401/500 |
| GET | /api/github/orgs/install-status | user | Org + personal install status | none | `ConnectionStatusResponse` |
| GET | /api/github/post-link | user (redirect) | Post-OAuth-link sync + redirect chain | query next? | redirect |
| GET | /api/github/repos/[owner]/[repo]/actions/jobs/[jobId]/logs | user+repo(read) | Proxy job logs (truncated) | none | `text/plain` |
| GET | /api/github/repos/[owner]/[repo]/actions/readiness | user+repo(read) | Actions manager readiness | query permission? | `{ok,readiness,defaultBranch}` |
| GET | /api/github/repos/[owner]/[repo]/actions/runs | user+repo(read) | List workflow runs | query branch?,event?,status?,per_page? | `{ok,runs,...}` |
| POST | /api/github/repos/[owner]/[repo]/actions/runs/[runId]/cancel | user+repo(write) | Cancel a run | none | `{ok,action,runId}` 202 |
| GET | /api/github/repos/[owner]/[repo]/actions/runs/[runId]/jobs | user+repo(read) | List jobs for a run | none | `{ok,jobs}` |
| POST | /api/github/repos/[owner]/[repo]/actions/runs/[runId]/rerun | user+repo(write) | Rerun (all or only failed) | query onlyFailed? | `{ok,action,runId}` 202 |
| GET | /api/github/repos/[owner]/[repo]/actions/workflows | user+repo(read) | List workflows | none | `{ok,workflows}` |
| POST | /api/github/repos/[owner]/[repo]/actions/workflows/[workflowId]/dispatch | user+repo(write) | Dispatch a `workflow_dispatch` run | `{ref,inputs?}` (ref must equal default branch) | `{ok,action,run}` 202 |
| GET | /api/github/repos/[owner]/[repo]/secrets | user+repo-secrets(read) | List secret names | none | `{ok,readiness,secrets}` |
| POST | /api/github/repos/[owner]/[repo]/secrets | user+repo-secrets(write) | Create/update a secret | `{name,value}` | `{ok,name}` |
| PUT | /api/github/repos/[owner]/[repo]/secrets/[name] | user+repo-secrets(write) | Update a secret's value | `{value}` | `{ok,name}` |
| DELETE | /api/github/repos/[owner]/[repo]/secrets/[name] | user+repo-secrets(write) | Delete a secret | none | `{ok:true}` |
| GET | /api/github/user | user | Fetch GitHub user profile | none | user object \| 401/500 |
| POST | /api/github/webhook | webhook-hmac | GitHub App webhook (installation, pull_request → agent triggers, session archival) | GitHub event payload | `{ok:true,...}` |
| GET | /api/gtm/activation/signals | user | List activation signals | none | `{signals}` |
| POST | /api/gtm/activation/signals | user | Run activation watcher | `{candidates:[{targetUserHash,...}]}` | result 201 \| 400 |
| PATCH | /api/gtm/approvals/[approvalId] | user | Approve/deny a GTM approval | `{decision:"approved"|"denied"}` | result \| 400/404/409 |
| GET | /api/gtm/brief | user | GTM snapshot brief | query window (1h-168h) | snapshot \| 400 |
| POST | /api/gtm/calls/debrief | user | Record a call debrief | `{accountId?,contactId?,callId?,notes,attendees[],evidenceRefs[]}` | result 201 \| 400/403 |
| POST | /api/gtm/calls/prep | user | Record call prep | `{accountId?,contactId?,founderObjective,knownContext[],openLoops[],desiredOutcome?,evidenceRefs[]}` | result 201 \| 400/403 |
| GET | /api/gtm/diagnosis | user | Diagnose a GTM work item | query source∈{account_work,product_shipments,inbound,distribution,audience},id,limit? | diagnosis \| 400/404 |
| POST | /api/gtm/outbound/drafts | user | Create outbound draft (email/CRM action) | `{accountId?,contactId?,actionKind,subject,body,summary?,recipientHash?,recipientDomain?,allowedDomains[],evidenceRefs[],metadata}` | result 201 \| 400/403 |
| POST | /api/gtm/research/runs | user | Record research run w/ claims | `{accountId?,contactId?,accountName?,contactName?,claims[],openQuestions[],nextSteps[]}` | result 201 \| 400/403 |
| GET | /api/gtm/weekly-review | user | List active GTM learnings | none | `{learnings}` |
| POST | /api/gtm/weekly-review | user | Run weekly review | `{weekStart,weekEnd,approvals[]}` | result 201 \| 400 |
| GET | /api/harness/artifacts/[artifactId] | user+own(run) | Fetch one artifact (scoped by runId) | query runId | artifact JSON \| 400 |
| GET | /api/harness/ready | none | Verified Build harness readiness probe | none | readiness |
| GET | /api/harness/runs | user+own(session/chat) | Latest Verified Build run for a chat | query sessionId,chatId | `{run,events}` |
| POST | /api/harness/runs | user+own+feature-flag | Start a Verified Build/investigation run | `startRunSchema` {sessionId,chatId,latestUserMessageId,intentSummary?,selectionReason?,mode?} | `{run}` 202 \| 400/404 |
| GET | /api/harness/runs/[runId] | user+own(run) | Run snapshot + events | none | `{run,harnessRun,events}` |
| POST | /api/harness/runs/[runId]/approve | user+own(run) | Approve a pending gate | `{kind,approved:true,note?}` | proxied harness response |
| GET | /api/harness/runs/[runId]/artifacts | user+own(run) | List run artifacts | none | proxied |
| GET | /api/harness/runs/[runId]/audit | user+own(run) | Audit trail | none | proxied |
| POST | /api/harness/runs/[runId]/cancel | user+own(run) | Cancel run | `{reason?}` | proxied |
| GET | /api/harness/runs/[runId]/capsules | user+own(run) | Failure capsules | none | proxied |
| GET | /api/harness/runs/[runId]/events | user+own(run) | SSE run event stream (persists to DB) | header `Last-Event-ID` / query `after_event_id` | `text/event-stream` |
| POST | /api/harness/runs/[runId]/repair | user+own(run) | Repair from a failure capsule/approval kind | `{capsuleId? or approvalKind?, note?}` | proxied |
| GET | /api/harness/runs/[runId]/trace | user+own(run) | Execution trace | none | proxied |
| GET | /api/harness/runs/[runId]/trace/export-plan | user+own(run) | Trace export plan | none | proxied |
| GET | /api/harness/workcells/[workcellId] | user | Get workcell detail | none | workcell |
| GET | /api/health | none | Liveness + Redis rate-limit backend probe | none | `{status,rateLimitBackend,redisConfigured}` 200/503 |
| GET | /api/inference-profiles | user | List BYO inference profiles | none | `{profiles}` |
| POST | /api/inference-profiles | user | Create profile | `createInferenceProfileInputSchema` {name,provider,baseUrl?,apiKey,...} | `{profile}` 201 \| 400 |
| PATCH | /api/inference-profiles | user | Update profile | `updateInferenceProfileInputSchema` | `{profile}` \| 400/404 |
| DELETE | /api/inference-profiles | user | Delete profile | `{profileId}` | `{success:true}` \| 400/404 |
| POST | /api/inference-profiles/[profileId]/test | user | Test-call the endpoint with a model | `{modelId?}` | `{profile,result:{status,message}}` \| 404 |
| GET | /api/inference-profiles/usage | user | Usage summary per profile | none | `{usage}` \| 500 |
| GET | /api/learnings | user | Repo learnings + agent enable status | query repoOwner?,repoName? | `{enabled,verdict,learnings[],agentId?,missingEvents?}` |
| POST | /api/learnings | user | Enable/disable the learnings agent for a repo | `{repoOwner,repoName,enabled}` | `{enabled,verdict,agentId?}` \| 403/404 |
| GET | /api/learnings/[learningId] | user+own | Get one learning | none | `{learning}` \| 403/404 |
| PATCH | /api/learnings/[learningId] | user+own | Update status/confidence | `{status?:"archived",confidence?}` (strict) | `{learning}` \| 400/403/404 |
| DELETE | /api/learnings/[learningId] | user+own | Archive (soft-delete) | none | `{learning}` \| 403/404 |
| GET | /api/models | none | List available LLM models w/ context windows (AI Gateway) | none | `{models}` \| 500 |
| GET | /api/repos/[owner]/[repo]/dashboard | user | Repo dashboard aggregate (PRs/issues/Actions/agents/runs/readiness) | none | aggregate object |
| GET | /api/runs | user | Unified automation runs list | query | `{requestId,...result}` \| 400/503 |
| POST | /api/sandbox | user | Create/resume a repo-backed sandbox VM | `{repoUrl?,branch?,isNewBranch?,sessionId,sandboxType?}` | `{createdAt,timeout,currentBranch?,mode,timing}` \| 400/403 |
| DELETE | /api/sandbox | user | Stop/clear a sandbox | `{sessionId}` | `{success:true,alreadyStopped?}` |
| POST | /api/sandbox/activity | user+own | Refresh inactivity timer (heartbeat) | `{sessionId}` | `{success:bool,reason?}` |
| POST | /api/sandbox/extend | user+own | Extend sandbox timeout | `{sessionId}` | `{success,expiresAt,extendedBy}` |
| GET | /api/sandbox/reconnect | user+own | Reconnect/probe sandbox liveness | query sessionId | `ReconnectResponse{status,hasSnapshot,lifecycle,...}` |
| POST | /api/sandbox/snapshot | user+own | Pause/stop sandbox (compat) | `{sessionId}` | `{snapshotId,createdAt}` \| 500 |
| PUT | /api/sandbox/snapshot | user+own | Resume/restore sandbox from snapshot | `{sessionId}` | `{success,restoredFrom,sandboxName,...}` \| 404/500 |
| GET | /api/sandbox/status | user+own | Sandbox + lifecycle status poll | query sessionId | `SandboxStatusResponse` |
| GET | /api/sessions | user | List sessions (status filter, archived pagination) | query status?,limit?,offset? | `{sessions,archivedCount,pagination?}` |
| POST | /api/sessions | user | Create session (+ initial chat, optional sandbox/repo/Vercel project) | `CreateSessionRequest` | session+chat result \| 400/403 |
| GET | /api/sessions/[sessionId] | user+own | Get session | none | `{session}` |
| PATCH | /api/sessions/[sessionId] | user+own | Update session (title/status/runtime, archive/unarchive) | `UpdateSessionRequest` | `{session}` \| 400/404/409 |
| DELETE | /api/sessions/[sessionId] | user+own | Delete session | none | `{success:true}` |
| GET | /api/sessions/[sessionId]/browser-runs | user+own | List managed browser check runs | none | `{runs}` |
| POST | /api/sessions/[sessionId]/browser-runs | user+own(managed_runtime) | Run a managed browser check | `{serviceId?,targetUrl?,chatId?}` | `{run}` \| 400/404/409 |
| GET | /api/sessions/[sessionId]/chats | user+own | List chats | none | `{chats,defaultModelId}` |
| POST | /api/sessions/[sessionId]/chats | user+own | Create (or idempotently fetch) a chat | `{id?}` | `{chat}` \| 400/409 |
| GET | /api/sessions/[sessionId]/chats/[chatId] | user+own | Get chat + messages | none | `ChatRefreshResponse` |
| PATCH | /api/sessions/[sessionId]/chats/[chatId] | user+own | Update title/model/inferenceProfile/composioSelection | `UpdateChatRequest` | `{chat}` \| 400/404 |
| DELETE | /api/sessions/[sessionId]/chats/[chatId] | user+own | Delete chat (must not be last) | none | `{success:true}` \| 400 |
| GET | /api/sessions/[sessionId]/chats/[chatId]/debug-bundle | user+own OR signed token | Fetch diagnostic bundle (json/markdown) | query token?,eventLimit?,format? | bundle \| 401/404 |
| POST | /api/sessions/[sessionId]/chats/[chatId]/debug-bundle | user+own | Mint a signed diagnostic bundle URL | `{ttlMinutes?}` | `{url,token,expiresAt,redaction}` |
| POST | /api/sessions/[sessionId]/chats/[chatId]/fork | user+own | Fork chat through a message | `{messageId,id?}` | `{chat}` \| 400/404/409 |
| POST | /api/sessions/[sessionId]/chats/[chatId]/messages | user+own | Upsert an assistant message | `{message:WebAgentUIMessage}` | `{success,status}` \| 400/409 |
| DELETE | /api/sessions/[sessionId]/chats/[chatId]/messages/[messageId] | user+own | Delete a user message + following | none | `{success,deletedMessageIds}` \| 400/404/409 |
| POST | /api/sessions/[sessionId]/chats/[chatId]/read | user+own | Mark chat read | none | `{success:true}` |
| GET | /api/sessions/[sessionId]/chats/[chatId]/share | user+own | Get share id | none | `{shareId}` |
| POST | /api/sessions/[sessionId]/chats/[chatId]/share | user+own | Create share link | none | `{shareId}` |
| DELETE | /api/sessions/[sessionId]/chats/[chatId]/share | user+own | Revoke share | none | `{success:true}` |
| POST | /api/sessions/[sessionId]/chats/[chatId]/strip-reasoning | user+own | Strip model reasoning from transcript | none | `{updatedMessages}` \| 409 |
| POST | /api/sessions/[sessionId]/checks/fix | user+own | Build "fix failing checks" prompt+AI-compacted CI logs | `{checkRuns:CheckRun[]}` (max 10) | `{prompt,snippets}` \| 400 |
| GET | /api/sessions/[sessionId]/code-editor | user+own | code-server status | none | `{running,url,port}` |
| POST | /api/sessions/[sessionId]/code-editor | user+own | Launch code-server | none | `{url,port}` \| 409/500 |
| DELETE | /api/sessions/[sessionId]/code-editor | user+own | Stop code-server | none | `{stopped}` |
| POST | /api/sessions/[sessionId]/dev-server | user+own | Auto-detect + launch a dev server | none | `{packagePath,port,url,logPath}` \| 404/500 |
| GET | /api/sessions/[sessionId]/dev-server | user+own | Read dev-server logs | query lines? | `text/plain` \| 404 |
| DELETE | /api/sessions/[sessionId]/dev-server | user+own | Stop dev server | none | `{stopped,packagePath,port}` \| 404 |
| GET | /api/sessions/[sessionId]/diff | user+own | Compute working-tree diff | none | `DiffResponse` \| 409 |
| GET | /api/sessions/[sessionId]/diff/cached | user+own | Cached diff (stale) | none | `{data,cachedAt,isStale:true}` \| 404 |
| GET | /api/sessions/[sessionId]/diff/patch | user+own | Download diff as `.patch` | none | `text/x-diff` attachment \| 409 |
| GET | /api/sessions/[sessionId]/files | user+own | List tracked+untracked repo files | none | `{files}` \| 400/409 |
| GET | /api/sessions/[sessionId]/files/content | user+own | Preview a file's content | query path | `{path,content,size}` \| 400/404/413 |
| POST | /api/sessions/[sessionId]/generate-commit-message | user | AI commit message from diff | none | `{message}` \| 400/404 |
| POST | /api/sessions/[sessionId]/git/branch | user+own | Create a branch | `createBranchRequestSchema` | branch result |
| POST | /api/sessions/[sessionId]/git/commit | user+own | Commit changes | `commitChangesRequestSchema` | commit result |
| GET | /api/sessions/[sessionId]/git/deployment-url | user+own | Get deployment URL for PR/branch | query prNumber?,branch? | result |
| POST | /api/sessions/[sessionId]/git/discard | user+own | Discard working changes | `discardChangesRequestSchema` | result |
| GET | /api/sessions/[sessionId]/git/pr | user+own | Check PR status | none | result |
| POST | /api/sessions/[sessionId]/git/pr | user+own | Open a PR | `openPullRequestRequestSchema` | result |
| POST | /api/sessions/[sessionId]/git/pr/close | user+own | Close PR | none | result |
| POST | /api/sessions/[sessionId]/git/pr/generate | user+own | Generate PR title/body | `generatePrContentRequestSchema` | result |
| POST | /api/sessions/[sessionId]/git/pr/merge | user+own | Merge PR | `mergePrRequestSchema` | result |
| GET | /api/sessions/[sessionId]/git/pr/readiness | user+own | Merge readiness checks | none | result |
| GET | /api/sessions/[sessionId]/git/status | user+own | Git status | none | `{status}` |
| GET | /api/sessions/[sessionId]/managed-runtime/profile-drafts | user+own | List profile drafts | query chatId?,limit? | `{drafts}` |
| POST | /api/sessions/[sessionId]/managed-runtime/profile-drafts | user+own | Upsert a draft from a tool call | `{chatId?,toolCallId,input}` | `{draft}` \| 400 |
| GET | /api/sessions/[sessionId]/managed-runtime/profile-drafts/[draftId] | user+own | Get a draft | none | `{draft}` \| 404 |
| PATCH | /api/sessions/[sessionId]/managed-runtime/profile-drafts/[draftId] | user+own | Approve/reject a draft (may save as profile) | `{output,forceApproved?}` | `{draft,savedProfileId?,appliedToSessionId?}` \| 404 |
| POST | /api/sessions/[sessionId]/managed-runtime/profile-drafts/[draftId]/test | user+own | Run draft setup/verify commands in sandbox | `{mode?:"verify"|"setup_and_verify"}` | `{draft:...+testEvidence}` \| 404/409/500 |
| GET | /api/sessions/[sessionId]/managed-runtime/profiles | user+own | List profiles (built-in + saved) | none | `{profiles}` |
| GET | /api/sessions/[sessionId]/managed-runtime/profiles/[profileId] | user+own | Get saved profile detail | none | detail \| 404 |
| PATCH | /api/sessions/[sessionId]/managed-runtime/profiles/[profileId] | user+own | Update saved profile | `updateProfileSchema` | detail \| 404 |
| DELETE | /api/sessions/[sessionId]/managed-runtime/profiles/[profileId] | user+own | Delete saved profile | none | `{deletedProfileId,fallbackProfileId,sessionsReset}` \| 404 |
| POST | /api/sessions/[sessionId]/managed-runtime/profiles/[profileId]/test | user+own | Test a saved profile in sandbox | `{mode?}` | `{profile,testEvidence}` \| 404/409/500 |
| GET | /api/sessions/[sessionId]/observability | user+own | Aggregate observability feed (events, profile runs, workflows, services, browser runs, goals, artifacts) | query chatId?,limit? | large aggregate object |
| POST | /api/sessions/[sessionId]/sandbox | user+own | Attach on-demand sandbox to a no-repo session | none | `{session}` |
| DELETE | /api/sessions/[sessionId]/sandbox | user+own | Clear failed provisional sandbox attach | none | `{session}` |
| GET | /api/sessions/[sessionId]/sandbox-services | user+own | List managed services | none | `{services}` |
| POST | /api/sessions/[sessionId]/sandbox-services | user+own(managed_runtime) | Start a managed dev server | none | `{service}` \| 500 |
| DELETE | /api/sessions/[sessionId]/sandbox-services/[serviceId] | user+own | Stop a managed service | none | `{service}` \| 404 |
| GET | /api/sessions/[sessionId]/sandbox-services/[serviceId]/logs | user+own | Read service logs | query lines? | `text/plain` |
| POST | /api/sessions/[sessionId]/share | none (deprecated) | Deprecated session-level share | none | 410 |
| DELETE | /api/sessions/[sessionId]/share | none (deprecated) | Deprecated session-level unshare | none | 410 |
| GET | /api/sessions/[sessionId]/skills | user+own | Discover Skills in sandbox (cached) | query refresh? | `{skills}` \| 400/409 |
| GET | /api/settings/agents | user | Get 4 canonical agent-role settings | none | `{agents}` |
| PATCH | /api/settings/agents | user | Upsert one role's settings | `agentPatchSchema {role,...}` | `{agent}` \| 400 |
| DELETE | /api/settings/agents | user | Reset a role to inherited | `agentDeleteSchema {role}` | `{ok:true}` \| 400 |
| GET | /api/settings/composio | user | Composio profiles/defaults/status for a repo | query repoOwner?,repoName? | `ComposioSettingsResponse` |
| POST | /api/settings/composio | user | Create a tool profile | `composioToolProfileInputSchema` | `{profile}` 201 \| 400/409 |
| PATCH | /api/settings/composio | user | Update defaults and/or a profile | `{defaults?,profileId?,profile?}` | `{defaults?,profile?}` \| 400/404/409 |
| DELETE | /api/settings/composio | user | Delete a tool profile | `{profileId}` | `{success:true}` \| 400/404 |
| GET | /api/settings/mcp-servers | user | List MCP servers | none | `{servers}` |
| POST | /api/settings/mcp-servers | user | Create MCP server | `createMcpServerSchema` | `{server}` 201 \| 400/409 |
| PATCH | /api/settings/mcp-servers/[serverId] | user | Update MCP server | `updateMcpServerSchema` | `{server}` \| 400/404/409 |
| DELETE | /api/settings/mcp-servers/[serverId] | user | Delete MCP server | none | `{ok:true}` \| 404 |
| GET | /api/settings/model-variants | user | List model variants (built-in+custom) | none | `{modelVariants}` |
| POST | /api/settings/model-variants | user | Create a model variant | `createModelVariantInputSchema` | `{modelVariants}` \| 400/500 |
| PATCH | /api/settings/model-variants | user | Update a variant | `updateModelVariantInputSchema` | `{modelVariants}` \| 400/403/404/500 |
| DELETE | /api/settings/model-variants | user | Delete a variant | `deleteModelVariantInputSchema {id}` | `{modelVariants}` \| 400/403/404 |
| GET | /api/settings/preferences | user | Get preferences | none | `{preferences}` |
| PATCH | /api/settings/preferences | user | Update preferences (models, sandbox, diff, auto-commit/PR, alerts, skills) | `UpdatePreferencesRequest` | `{preferences}` \| 400/500 |
| GET | /api/settings/repositories/[repoOwner]/[repoName] | user | Resolved + raw per-repo settings | none | `{resolved,raw}` |
| PATCH | /api/settings/repositories/[repoOwner]/[repoName] | user | Patch per-repo overrides | `repoSettingsPatchSchema` | `{resolved,raw}` \| 400 |
| DELETE | /api/settings/repositories/[repoOwner]/[repoName] | user | Reset all per-repo overrides | none | `{resolved,raw}` |
| GET | /api/settings/repositories/[repoOwner]/[repoName]/composio | user | Repo-scoped Composio profile policy | none | `RepositoryComposioSettingsResponse` |
| PATCH | /api/settings/repositories/[repoOwner]/[repoName]/composio | user | Update repo Composio allow/block lists | `repositoryComposioSettingsInputSchema` | `RepositoryComposioSettingsResponse` \| 400/502 |
| GET | /api/settings/runtime-profiles | user | List profiles (built-in+user_default) | none | `{profiles}` |
| POST | /api/settings/runtime-profiles | user | Create a user_default profile | `createOrUpdateProfileSchema` | `{profile}` 201 \| 400 |
| PATCH | /api/settings/runtime-profiles/[profileId] | user | Update a user_default profile | `updateProfileSchema` | `{profile}` \| 400/404 |
| DELETE | /api/settings/runtime-profiles/[profileId] | user | Delete a user_default profile | none | `{deletedProfileId,preferenceReset}` \| 404 |
| GET | /api/settings/skills | user | List user Skills | none | `{skills}` |
| POST | /api/settings/skills | user | Create a Skill | `createUserSkillInputSchema` | `{skill}` 201 \| 400/409 |
| PATCH | /api/settings/skills | user | Update a Skill | `updateUserSkillInputSchema` | `{skill}` \| 400/404/409 |
| DELETE | /api/settings/skills | user | Delete a Skill | `deleteUserSkillInputSchema {id}` | `{success:true}` \| 400/404 |
| POST | /api/settings/skills/generate | user | AI-draft a Skill from a prompt | `{prompt}` (max length bounded) | `{skill}` \| 400/500/502 |
| GET | /api/shared/[shareId]/markdown | none | Render a shared chat as markdown/text | header Accept or query format? | `text/markdown` \| 404 |
| GET | /api/shared/[shareId]/status | none | Streaming status of a shared chat | none | `{isStreaming}` \| 404 |
| POST | /api/transcribe | user | Transcribe audio (ElevenLabs) | `{audio(base64),mimeType?}` | `{text}` \| 400/413/500 |
| GET | /api/usage | user | Usage history + insights + domain leaderboard | query from?,to? | `{usage,insights,domainLeaderboard}` \| 401 |
| GET | /api/usage/rank | user | Current user's daily leaderboard rank | none | `LeaderboardRankResponse` or `null` |
| GET | /api/vercel/projects/[idOrName]/env | none | Stub — always 404 (unimplemented) | none | 404 |
| GET | /api/vercel/repo-projects | user | List Vercel projects matching a repo | query repoOwner,repoName | `{projects,selectedProjectId}` \| 400/403/500 |
| GET | /api/workflows/catalog | user | List workflow catalog entries | none | `{workflows}` \| 404 if surface disabled/503 |

## Feature Map
- **Sessions & sandbox lifecycle** — create/list/archive sessions; attach/create/pause/resume/reconnect/extend a Vercel Sandbox VM; per-session inactivity heartbeat.
- **Chat / core agent loop** — send a message, stream the response, stop/fork/share a chat, delete/read messages, strip reasoning, mint diagnostic bundles.
- **Code editing surface** — file browser, file preview, dev server auto-launch, code-server (VS Code in browser), diff (live/cached/patch download), checks/fix (AI-summarized CI logs).
- **Git & GitHub integration** — branch/commit/discard, open/merge/close PR, PR content generation, merge readiness, GitHub App install/link flow, Actions manager (list/cancel/rerun runs, dispatch workflows, stream logs), repo Secrets manager, repo dashboard.
- **Background agents** — CRUD agents, manual test dispatch, cron-driven scheduling, GitHub webhook triggers, tool preflight, run streaming (SSE).
- **Agent loops** — graph-defined automations: CRUD loops, AI drafting, triggers (schedule/webhook), manual/triggered runs with pause/resume/retry/cancel, stalled-run sweep.
- **Verified Build harness** — gated, approval-driven build runs proxied to an external harness service: start, approve/repair/cancel, trace/audit/capsules/artifacts, SSE events.
- **Managed runtime profiles** — AI-drafted or hand-authored sandbox setup/verification command sets, tested live in-sandbox, saved per-session or as account defaults.
- **Composio tool integrations** — connect OAuth-like toolkit accounts, manage tool profiles, per-repo allow/block policy, agent-role toolkit assignment.
- **GTM coordinator** — accounts/contacts/signals, call prep/debrief, research runs with claims, outbound drafts, approvals, weekly review with learnings.
- **Repo learnings** — auto-extracted engineering learnings from merged PRs, enable/disable per repo, archive/confidence override.
- **Settings & account config** — per-role agent defaults, MCP servers, model variants, inference profiles (BYO LLM endpoints), user Skills (AI-generated or hand-authored), per-repo settings, preferences.
- **Usage & observability** — usage history/insights/leaderboard, session observability feed, unified `/api/runs` and `/api/automations` cross-source views, account/GTM diagnosis endpoints.
- **Public/unauthenticated surfaces** — shared chat markdown/status pages, health check.

## Data Entities (from `apps/web/lib/db/schema.ts`) and their CRUD routes
| Entity (table) | Primary routes |
|---|---|
| `users`, `accounts`, `authSessions`, `verification` | managed by better-auth via `/api/auth/[...all]`; read via `/api/auth/info` |
| `githubInstallations` | `/api/github/installations*`, `/api/github/orgs/install-status`, `/api/github/webhook` |
| `vercelProjectLinks` | `/api/vercel/repo-projects`, `/api/sessions` (create) |
| `inferenceProfiles` | `/api/inference-profiles*` |
| `userSkills` | `/api/settings/skills*` |
| `sessions` | `/api/sessions*`, `/api/sandbox*`, `/api/sessions/[sessionId]/*` |
| `chats` | `/api/sessions/[sessionId]/chats*` |
| `sandboxServices` | `/api/sessions/[sessionId]/sandbox-services*` |
| `sandboxBrowserRuns` | `/api/sessions/[sessionId]/browser-runs` |
| `managedRuntimeProfileRuns`, `delegatedWorkerRuns` | read via `/api/sessions/[sessionId]/observability` |
| `managedRuntimeSavedProfiles` | `/api/sessions/[sessionId]/managed-runtime/profiles*`, `/api/settings/runtime-profiles*` |
| `managedRuntimeProfileDrafts` | `/api/sessions/[sessionId]/managed-runtime/profile-drafts*` |
| `sessionEvents` | read via `/api/sessions/[sessionId]/observability` |
| `shares` | `/api/sessions/[sessionId]/chats/[chatId]/share`, `/api/shared/[shareId]/*` |
| `chatMessages`, `chatReads` | `/api/sessions/.../chats/[chatId]/messages*`, `.../read` |
| `verifiedBuildRuns`, `verifiedBuildEvents` | `/api/harness/*`, `/api/chat` (routing trigger) |
| `backgroundAgents`, `backgroundAgentTriggers` | `/api/background-agents*` |
| `backgroundAgentRuns`, `backgroundAgentEvents`, `backgroundAgentOutputs`, `backgroundAgentToolSessions` | `/api/background-agent-runs*` |
| `agentLoops` | `/api/agent-loops*` |
| `agentLoopRuns`, `agentLoopToolSessions`, `agentLoopStepRuns`, `agentLoopEvents`, `agentLoopWatchdogRuns` | `/api/agent-loop-runs*`, `/api/agent-loops/[loopId]/runs` |
| `workflowToolApprovals` | internal (chat tool-approval flow); no direct route found |
| `workflowRuns`, `workflowRunSteps`, `workflowArtifacts` | read via `/api/sessions/[sessionId]/observability` |
| `workflowInputSnapshots` | internal (chat workflow-input validation) |
| `workflowGoals`, `workflowGoalEvents` | read via `/api/sessions/[sessionId]/observability` |
| `gtmAccounts`, `gtmContacts`, `gtmSignals`, `gtmExperiments`, `gtmTouchpoints`, `gtmInsights`, `gtmAgentRuns`, `gtmApprovals`, `gtmEvents` | `/api/gtm/*` |
| `repoLearnings`, `repoLearningEvidence`, `repoLearningExtractionRuns` | `/api/learnings*` |
| `composioToolProfiles`, `composioAgentSessions` | `/api/settings/composio`, `/api/composio/*` |
| `repositoryComposioSettings` | `/api/settings/repositories/[repoOwner]/[repoName]/composio` |
| `repositorySettings` | `/api/settings/repositories/[repoOwner]/[repoName]` |
| `mcpServers` | `/api/settings/mcp-servers*` |
| `userPreferences` | `/api/settings/preferences`, `/api/settings/model-variants` |
| `agents` | `/api/settings/agents` |
| `agentToolEntries` | `/api/agents/tool-entries` |
| `usageEvents` | `/api/usage*`, `/api/inference-profiles/usage` |

## Integrations (GitHub, Vercel Sandbox, Composio, AI Gateway, Upstash Redis, Neon)
- **GitHub**: OAuth login via better-auth's GitHub provider; separate GitHub **App** installation flow (`/api/github/app/install`, `/api/github/app/callback`, `/api/github/post-link`) mints scoped installation tokens (`lib/github/app.ts`); Actions manager and Secrets manager wrap `@octokit/rest` behind per-route `requireActionsReadAccess`/`requireActionsWriteAccess`/`requireSecretsAccess` helpers; inbound webhook (`/api/github/webhook`) verified with `X-Hub-Signature-256` / `GITHUB_WEBHOOK_SECRET`.
- **Vercel Sandbox**: `@vercel/sandbox` (v2.0.0-beta.11) wrapped by `packages/sandbox` (`connectSandbox`); every code-execution route (`/api/sandbox*`, `/api/sessions/[sessionId]/{files,diff,git,code-editor,dev-server,sandbox-services,checks,skills,browser-runs}`) connects to a named, persistent sandbox with pause (`snapshot` POST)/resume (`snapshot` PUT)/reconnect/extend/heartbeat semantics tracked in `sessions.sandboxState`/`lifecycleState`.
- **Composio**: `@composio/core` + `@composio/vercel`; connect flow (`/api/composio/connect`) mints an OAuth-like link via `connectedAccounts.link`; toolkit catalog cached 1h (`/api/composio/toolkits`); tool profiles and per-repo allow/block policy (`/api/settings/composio*`, `/api/settings/repositories/.../composio`).
- **AI Gateway**: Vercel AI SDK `ai` package's `gateway()`; `/api/models` lists available models with context windows; used for chat completion, session-title generation, PR/commit-message generation, agent-loop drafting (`anthropic/claude-opus-4.6`), skill drafting, and Verified Build task classification.
- **Upstash-compatible Redis**: `ioredis` client (`REDIS_URL`), used for rate limiting (`lib/rate-limit.ts`, applied on `generate-pr`, `generate-title`, `transcribe`, `sandbox/extend`, `sessions` create, `sandbox` create/delete, `checks/fix`, `generate-commit-message`, `settings/skills/generate`) and the skills-discovery cache; `/api/health` actively probes it.
- **Neon-compatible Postgres**: `postgres` (postgres.js) + Drizzle ORM (`POSTGRES_URL`); 62 tables; the entire persistence layer for the app.
- **ElevenLabs**: `@ai-sdk/elevenlabs`, used by `/api/transcribe`.
- **Vercel platform API**: `/api/vercel/repo-projects` lists matching projects for env-var linking; `/api/vercel/projects/[idOrName]/env` is a permanently-disabled stub (env sync to sandbox is commented out in `lib/sandbox/route.ts`).

## State transitions and lifecycles
- **Session → sandbox**: `null` (no repo) → `provisioning` (repo-backed create, or on-demand attach via `POST /api/sessions/[sessionId]/sandbox`) → `active` (`sandboxState` populated) → `hibernated` (via `POST /api/sandbox/snapshot` or stop/error) → resumable via `PUT /api/sandbox/snapshot` or `GET /api/sandbox/reconnect` → `archived` (`PATCH /api/sessions/[sessionId]` `status:"archived"`, which also pauses the sandbox) → `failed` (recoverable back to `active` on next successful reconnect/status check).
- **Chat → run**: `POST /api/chat` starts a durable `workflow` run, stamping `chat.activeStreamId = runId`; `GET .../stream` reconnects to the same stream; `POST .../stop` cancels it and clears `activeStreamId` (CAS-guarded against races); if the message classifies as a code-changing task and Verified Build is enabled, `/api/chat` instead starts a harness run (`startVerifiedBuildRun`) and streams a short "routed to Verified Build" notice.
- **Background agent trigger → run**: a webhook (`POST /api/background-agents/webhook/[publicId]`), cron sweep (`GET/POST /api/background-agents/cron`), or manual test (`POST /api/background-agents/[agentId]/test`) creates a `backgroundAgentRuns` row that transitions `queued → running → succeeded/failed/skipped/cancelled`; events/outputs accumulate and are watchable live via `GET /api/background-agent-runs/[runId]/stream` (SSE).
- **Agent loop → run**: `POST /api/agent-loops/[loopId]/runs` (or a `schedule.cron`/`webhook` trigger) creates an `agentLoopRuns` row; controlled via `/api/agent-loop-runs/[runId]/{pause,resume,retry,cancel}`; `stepRuns`/`events`/`watchdogRuns` track per-step progress; `GET/POST /api/agent-loops/sweep` (cron) marks runs stalled if their latest event exceeds `AGENT_LOOPS_STALL_MINUTES`.
- **Workflow (feature) → steps**: `/api/workflows/catalog` exposes static workflow definitions; started via `/api/chat`'s `workflowId` field (validated by `validateWorkflowInputs`), producing `workflowRuns`/`workflowRunSteps`/`workflowArtifacts`/`workflowGoals` rows surfaced through `/api/sessions/[sessionId]/observability`.
- **Verified Build harness run**: `POST /api/harness/runs` (or the `/api/chat` auto-route) → `queued → running`, optionally `pending_approval` (resolved via `POST .../approve`) or a failure state (resolved via `POST .../repair`), terminating `succeeded/failed/cancelled` (`POST .../cancel`); events stream via SSE (`GET .../events`) and are persisted; post-hoc inspection via `/artifacts`, `/audit`, `/capsules`, `/trace`, `/trace/export-plan`.

## Recommended Story Topics
1. **Account creation & GitHub connection** — `/api/auth/*`, `/api/github/app/*`, `/api/github/post-link`, `/api/github/connection-status`, `/api/github/orgs/install-status`: every other journey requires an authenticated, GitHub-linked account first.
2. **Session lifecycle & sandbox provisioning** — `/api/sessions*`, `/api/sandbox*`, `/api/sessions/[sessionId]/sandbox`: the pause/resume/reconnect/extend/snapshot state machine is the riskiest, most stateful surface in the app.
3. **Core chat loop** — `/api/chat*`, `/api/sessions/.../chats/[chatId]/*` (send, stream, stop, fork, share, delete): the primary user-facing product action.
4. **Git & PR workflow** — `/api/sessions/[sessionId]/git/*`, `diff/*`, `checks/fix`: the "ship code" end of the product, with the most distinct sub-resources (branch, commit, PR open/merge/close, readiness).
5. **Background agents** — `/api/background-agents*`, `/api/background-agent-runs*`: an entire autonomous-agent surface with its own auth modes (CRON_SECRET, webhook HMAC) alongside normal session auth.
6. **Agent loops** — `/api/agent-loops*`, `/api/agent-loop-runs*`: graph-based automation with a distinct lifecycle (pause/resume/retry) and its own cron sweep.
7. **Verified Build harness** — `/api/harness/*` plus its `/api/chat` routing hook: a distinct approval-gated execution model layered on top of chat, with SSE events and artifact/trace retrieval.
8. **Managed runtime profiles** — `/api/sessions/.../managed-runtime/*`, `/api/settings/runtime-profiles*`: an AI-draft → in-sandbox-test → approve → reuse loop that spans both session-scoped and account-scoped resources.
9. **Composio tool connections & repo policy** — `/api/composio/*`, `/api/settings/composio`, `/api/settings/repositories/.../composio`: external OAuth-like tool auth with allow/block governance.
10. **GTM coordinator suite** — `/api/gtm/*`: a large, mostly self-contained sub-product (accounts, calls, research, outbound, approvals, weekly review) with its own approval gate.
11. **Settings & preferences** — `/api/settings/{agents,mcp-servers,model-variants,skills}`, `/api/inference-profiles*`, `/api/agents/tool-entries`: account-level configuration that several other journeys implicitly depend on.
12. **Public/unauthenticated & service surfaces** — `/api/shared/*`, `/api/health`, `/api/github/webhook`, `/api/background-agents/webhook/[publicId]`: the only routes exercisable without a session cookie, worth isolating since they need a different curl setup (HMAC signing / cron secret instead of a cookie).

---

## Summary for the parent agent

- **Recommended Story Topics (12)**: (1) Account & GitHub connection, (2) Session lifecycle & sandbox, (3) Core chat loop, (4) Git & PR workflow, (5) Background agents, (6) Agent loops, (7) Verified Build harness, (8) Managed runtime profiles, (9) Composio & repo tool policy, (10) GTM coordinator suite, (11) Settings & preferences, (12) Public/unauthenticated & webhook surfaces.
- **Total routes inventoried**: **164** route files (all of them — no sampling), spanning roughly 230 individual `method + path` endpoints once multi-method files are counted.
- **File to save**: the full markdown above should be written verbatim to `/Users/dennison/develop/open-agents/docs/ux-paths/discovery.md` by an agent with write access — I was unable to create it myself under this session's read-only tool restrictions.