# API Research Brief 05: Background Agents, Harness (Verified Build), and Workflow APIs

Researched June 2026 against branch `feat/agents-phase6-authored-tools`. All paths relative to repo root `/Users/dennison/develop/open-agents` unless absolute. Every claim below was verified against actual route/lib source, with `path:line` citations.

---

## 0. Cross-cutting facts

- **Auth for all user-facing endpoints** is the better-auth cookie session via `requireAuthenticatedUser()` (`apps/web/app/api/sessions/_lib/session-context.ts:65` → `getServerSession()`). There is **no token/Bearer API auth for users** — an iOS client must hold the better-auth session cookie. Unauthenticated → the helper's 401 response.
- **Machine endpoints** (cron, webhooks) authenticate with shared secrets/HMAC, not user sessions (see §1.6, §1.7, GitHub webhook §1.8).
- Error bodies are simple `{ error: string }` JSON for background-agent routes; harness routes use a structured envelope `{ error: { code, message, request_id } }` (`apps/web/app/api/harness/_lib/responses.ts:21-35`).
- **Nothing in these areas uses WebSockets.** One endpoint streams SSE (`GET /api/harness/runs/[runId]/events`); everything else is request/response JSON polled by the web UI with SWR `refreshInterval`.

---

## 1. Background Agents

"Background agents" are per-user, per-repo automation definitions that run unattended in a Vercel Sandbox when a trigger fires (GitHub event, cron schedule, signed webhook, or manual test). Execution is a Vercel Workflow DevKit durable workflow (`apps/web/app/workflows/background-agent.ts:4-12` — `"use workflow"` wrapping `executeBackgroundAgentRun`).

### 1.1 Agent definition shape

Create/update zod schemas: `apps/web/lib/background-agents/types.ts:91-125`. DB table `background_agents`: `apps/web/lib/db/schema.ts:860-905`.

```jsonc
// createBackgroundAgentSchema (strict)
{
  "name": "string 1-100",
  "description": "string ≤500 | null (optional)",
  "status": "enabled" | "disabled",          // default "disabled"
  "repoOwner": "string 1-120",
  "repoName": "string 1-120",
  "instructions": "string 1-8000",            // the agent prompt
  "permissions": {                             // default {}
    "github": {
      "contents": "read"|"write", "pullRequests": "read"|"write",
      "issues": "read"|"write", "deployments": "read",
      "statuses": "read", "checks": "read"     // all optional
    }
  },
  "outputMode": "comment"|"ready_pr"|"issue"|"notification"|"none", // default "none"
  "checkCommand": "string ≤500 | null",        // optional verification command
  "triggers": [ /* 1-10 items */ {
    "name": "string 1-100",
    "kind": "github.pull_request"|"github.deployment_status"|"github.issue"|"schedule.cron"|"webhook.error",
    "status": "enabled"|"disabled",            // default "enabled"
    "conditions": {                            // default {}
      "actions": ["opened",...], "branches": [...], "labels": [...],
      "environments": [...], "severities": [...]   // all optional string arrays
    },
    "schedule": "cron string ≤100 | null"      // for schedule.cron
  } ]
}
```

- Update schema = same minus required-ness; `triggers` if supplied **replaces all triggers** (delete + reinsert, preserving `webhookPublicId` for surviving webhook triggers via `getWebhookPublicIdForUpdatedTrigger`) (`apps/web/lib/background-agents/store.ts:175-202`).
- Trigger rows additionally carry server-managed fields: `webhookPublicId` (nanoid(16), only for `webhook.error` kind, `store.ts:112`), `lastRunAt`, `nextRunAt`, `lastSkipReason` (schema.ts:937-941).
- `backgroundAgents.composioToolkitSlugs: string[]` exists in schema (schema.ts:893-896) and is read by the executor, but is **NOT settable through the create/update API schema** (strict zod omits it). No production write path exists.
- Schedule presets used by the UI: `@hourly`, `0 9 * * *`, `0 9 * * 1-5`, `@weekly`, custom cron (`apps/web/lib/background-agents/schedule-presets.ts:16-22`).

### 1.2 Tool grants (Composio) — internal only

Table `background_agent_tool_grants` (schema.ts:957-989): `{ provider: "composio", profileId, agentRole: "main"|"explorer"|"executor"|"design", phase: "investigate"|"mutate"|"notify"|"always", status: "enabled"|"disabled" (default disabled) }`. The executor reads enabled grants via `listEnabledToolGrantsForAgent` (`store.ts:704-737`) to gate Composio tool resolution. **There is no API route or UI that creates/edits grants** (grep confirms only `store.ts` + schema reference the table). Off-by-default, experimental — not an iOS v1 surface.

### 1.3 Routes (all JSON, all polled)

| Route | Method | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| `/api/background-agents` (`route.ts:8-16`) | GET | session | — | `{ agents: BackgroundAgentWithTriggers[] }` (full rows incl. `triggers[]`) | 401 |
| `/api/background-agents` (`route.ts:18-41`) | POST | session | create schema above | 201 `{ agent }` | 400 `Invalid JSON body` / `Invalid background agent` |
| `/api/background-agents/[agentId]` (`[agentId]/route.ts:12-47`) | PATCH | session+ownership | partial update schema | `{ agent }` | 400, 404 `Background agent not found` |
| `/api/background-agents/[agentId]` (`[agentId]/route.ts:49-65`) | DELETE | session+ownership | — | `{ success: true }` | 404 |
| `/api/background-agents/[agentId]/status` (`status/route.ts:15-45`) | GET | session | — | `{ latestRunId, latestRunStatus, latestOutputUrl }` (nullable) — lightweight per-card polling | 401 |
| `/api/background-agents/[agentId]/test` (`test/route.ts:9-50`) | POST | session+ownership | — (reads `x-request-id` header) | `BackgroundDispatchResult` (below) | 404; 400 `no triggers to test`; 403 `Background agents are disabled` when feature flag off |
| `/api/background-agents/readiness` (`readiness/route.ts:39-65`) | GET | session | optional query `repoOwner`,`repoName`,`permission=read\|write` | `BackgroundAgentReadiness` (+ `repoAccess` when repo params given) | 400 if only one of owner/name |
| `/api/background-agents/cron` (`cron/route.ts:13-41`) | GET/POST | `Authorization: Bearer <CRON_SECRET>` or `x-background-agents-cron-secret` header | — | `BackgroundDispatchResult` | 500 secret unconfigured; 401 |
| `/api/background-agents/webhook/[publicId]` (`webhook/[publicId]/route.ts:24-68`) | POST | HMAC-SHA256 signature header `x-open-agents-signature` = `sha256=<hexdigest>` over raw body with `BACKGROUND_AGENTS_WEBHOOK_SECRET` (`signature.ts:3-23`) | strict zod `{ externalId (req), repoOwner?, repoName?, severity?, title?, message?, url?, actor?, occurredAt? }` | `BackgroundDispatchResult` | 500 secret unconfigured; 401 invalid signature; 400 invalid JSON/payload |
| `/api/background-agent-runs` (`route.ts:9-24`) | GET | session | query `repoOwner?`, `repoName?`, `limit?` (1-200, default 50) | `{ runs: BackgroundAgentRun[] }` | 401 |
| `/api/background-agent-runs/[runId]` (`[runId]/route.ts:12-49`) | GET | session+ownership | — | `{ run, agent: {id,name,permissions,checkCommand}\|null, events (≤200, desc), outputs (≤50, desc) }` | 404 `Background run not found` |

`BackgroundDispatchResult` = `{ enabled: boolean, matched, created, duplicates: number, runIds: string[] }` (`apps/web/lib/background-agents/dispatcher.ts:27-33`).

### 1.4 Run model & lifecycle

Run row (`background_agent_runs`, schema.ts:991-1076): `id, agentId, triggerId, userId, status: queued|running|succeeded|failed|skipped|cancelled, source: github|schedule|webhook, triggerKind, externalId, idempotencyKey (unique), repoOwner/repoName, ref/sha/branch, prNumber, issueNumber, deploymentUrl, sandboxName, outputKind, outputUrl, errorKind, errorMessage, payloadSummary {title,url,actor,action,environment,severity,message}, resultSummary (RunSummary), requestId, workflowRunId, startedAt, finishedAt, createdAt, updatedAt`.

- **Idempotency key** = `agentId:triggerId:source:kind:externalId` (`types.ts:162-174`); duplicate events return the existing run (`store.ts:362-394`).
- `errorKind` enum: `duplicate_event, agent_disabled, permission_missing, installation_missing, sandbox_unavailable, workflow_failed, checks_failed, pr_creation_failed, webhook_signature_invalid` (`types.ts:50-60`).
- Terminal statuses set `finishedAt`; `running` sets `startedAt` (`store.ts:460-488`).

Executor lifecycle (`apps/web/lib/background-agents/executor.ts:572` onward), each step emits a `background_agent_events` row:
1. `background-agent.run.created` (on dispatch), `background-agent.trigger.received`
2. `background-agent.workflow.started` → status `running`
3. Repo access check via GitHub App installation (write permission required if `outputMode === "ready_pr"`, else read; executor.ts:617-621) → `background-agent.github.installation.resolved` or failure `installation_missing`/`permission_missing`
4. Vercel Sandbox boot, repo clone with short-lived installation token → `background-agent.sandbox.started` or `sandbox_unavailable`
5. `background-agent.git.context`, optional `background-agent.composio.resolved`/`.composio.error`
6. Mutation agent (only for mutating output modes) → `background-agent.agent.started/.step.completed/.completed`, `background-agent.git.branch.resolved`
7. Optional `checkCommand` → `background-agent.check.started/.completed` (or `.completed` with status `skipped` when unset); failure → `checks_failed`
8. Output: `ready_pr` path commits/pushes/creates PR → events `background-agent.commit.started/.completed`, `background-agent.output.created`; failure → output row `status:"failed"` + run `pr_creation_failed`
9. `background-agent.run.completed` → status `succeeded`; deterministic bounded `RunSummary` persisted best-effort (`run-summary.ts:18-25`: `{ headline, checked[], changed[], blocked[], artifacts[{kind,label,url,prNumber,issueNumber}], next[] }`).

Event row (schema.ts:1078-1131): `eventName, status: started|running|succeeded|failed|blocked|skipped|info, level: info|warn|error, summary, requestId, workflowRunId, sandboxName, errorKind, payload (redacted), redactionStatus`. Output row (schema.ts:1133-1161): `kind (same enum as outputMode), status: pending|created|failed|skipped, url, prNumber, payload`.

### 1.5 Triggers & dispatch

- GitHub events arrive at `POST /api/github/webhook` (GitHub App webhook, HMAC `x-hub-signature-256`); `pull_request`, `issues`, `deployment_status` are normalized (`lib/background-agents/github-events.ts:81`) and fanned out via `dispatchBackgroundTriggerEvent` (`apps/web/app/api/github/webhook/route.ts:188-238`).
- Trigger matching: kind + enabled status + case-insensitive repo match, then condition filters (`store.ts:291-315`, `matching.ts:4`).
- Cron: Vercel Cron hits `/api/background-agents/cron` every 5 minutes (`apps/web/vercel.json` crons: `*/5 * * * *`). Dispatcher evaluates each enabled `schedule.cron` trigger with `scheduleMatchesNow`, advances `lastRunAt/nextRunAt` unconditionally, records `lastSkipReason` for non-matches (`dispatcher.ts:357-469`). Schedule external id = `triggerId:minuteBucket` for idempotency (`dispatcher.ts:352-355`).
- Webhook `webhook.error` triggers are addressed by **public id in URL** (`webhookPublicId`), with global HMAC secret — no per-trigger secret in active use (`webhookSecretHash` column exists but unused; schema.ts:938).
- Global gates: `BACKGROUND_AGENTS_ENABLED === "true"` feature flag and `BACKGROUND_AGENTS_ALLOWED_REPOS` allowlist (comma/space-separated `owner/repo`, `*` = all) (`config.ts:7-39`). Dispatch is a no-op (`enabled:false` result) when flagged off.

### 1.6 Readiness check shape

`GET /api/background-agents/readiness` returns (`readiness.ts:26-31, 71-173`):
```ts
{ enabled: boolean, ready: boolean, missing: string[],   // env var names
  checks: [{ id, label, status: "ready"|"missing"|"disabled", detail, missing: string[] }] }
```
Check ids: `feature_flag, auth_database, vercel_oauth, github_oauth, github_app, github_app_webhooks, sandbox_runtime, inference_gateway, repo_allowlist, cron_secret, webhook_secret`. With `repoOwner`+`repoName` query, adds `repoAccess` (per-repo install/permission verdict from `repo-readiness.ts`).

### 1.7 Web UI consumers (user-facing today)

- **Settings → Background agents** page `/settings/background-agents` (`apps/web/app/settings/background-agents/page.tsx`) → `BackgroundAgentsSection` (`background-agents-section.tsx`): SWR on `/api/background-agents`, `/api/background-agent-runs?limit=8`, `/api/background-agents/readiness`; create/edit/delete agents; displays webhook URL `/api/background-agents/webhook/{publicId}` with copy button (line 374, 681).
- **Repo agents dashboard** `/repos/[owner]/[repo]/agents` (`repo-agents-dashboard.tsx:73,93`; `page.tsx` server-loads `listRepoBackgroundAgents` + runs) with per-agent cards polling `/api/background-agents/[id]/status` at 4 s while active (`agent-card.tsx:65-69`), PATCH to enable/disable, agent templates and an agent-spec JSON editor; `[agentId]` detail page exists.
- **Run detail** `/background-runs/[runId]` (`background-run-detail.tsx:326-335`): SWR on `/api/background-agent-runs/[runId]` with 2 s refresh while `queued|running`, 0 when terminal. Shows events timeline, outputs, run summary, cost.

**Verdict: Background agents are a real, shipped, user-facing surface** (settings CRUD + repo dashboard + run detail), though gated server-side by `BACKGROUND_AGENTS_ENABLED` and the repo allowlist. Good candidate for iOS read-only views (agents list, run list, run detail with events/summary) and enable/disable + manual test actions. No streaming required — pure polling.

---

## 2. Harness API (`/api/harness/*`) = "Verified Build"

The harness routes are a thin authenticated **proxy to an external harness service** (a separate deployment, configured by env: `HARNESS_ENABLED`, `HARNESS_BASE_URL`, `HARNESS_SERVICE_TOKEN`, `HARNESS_TENANT_ID`, `HARNESS_DEFAULT_PROJECT_ID`, timeout 15 s default, SSE replay limit 100 — `apps/web/lib/harness/config.ts:18-46`). The web app stores a local mapping row per run plus persisted events; everything else is forwarded upstream with service-token auth and tenant/project/actor headers (`client.ts:61-77`).

Key vocabulary (from upstream event names and proxy resources; upstream payloads are typed as opaque `HarnessJsonObject`):
- **Run** — one Verified Build (or investigation) execution, anchored to a chat message. Modes: `investigation | verified_build` (`types.ts:1`).
- **Workcell** — a scoped worker cell spawned by the coordinator during a run (`workcell.created` events; `GET /workcells/{id}` upstream). The catalog describes verified-build as "coordinator spawns scoped worker cells, collects evidence bundles" (`catalog.ts:204-218`).
- **Capsule** — a failure capsule; repair is requested against a `capsuleId` or `approvalKind` (`repair/route.ts:10-42`).
- **Trace / trace export-plan, artifacts, audit** — upstream run resources proxied verbatim.
- **Approval gates** — runs can block on `approval.required`; local run row tracks `planApprovalState: not_required|pending|approved|rejected` and `pendingApprovalKind` (schema.ts:803-808), reduced from SSE events (`events.ts:35-100`).
- **go/no-go** — final verdict `unknown|go|no_go` plus `finalReportArtifactId` set by `run.completed` (`events.ts:66-75`).

Local DB: `verified_build_runs` (schema.ts:776-832; unique `harnessRunId`, idempotency unique on tenant/project/actor/key) and `verified_build_events` (schema.ts:834-858; unique per run+harnessEventId). Run statuses are **opaque strings from upstream** (e.g. `accepted`, `running`, `gated`, `completed`, `failed`, `cancelled`, `cancellation_requested`) — not a DB enum.

### 2.1 Routes

All errors use the harness envelope; codes in `types.ts:13-27` (`harness_disabled` 503, `harness_unavailable`/`harness_timeout` 504, `harness_unauthorized` 401-up, `not_found` 404, `invalid_request` 400, etc.). Every response carries `X-Request-ID`.

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/harness/runs?sessionId&chatId` (`runs/route.ts:35-82`) | GET | session + chat ownership | Latest run for chat: `{ run: VerifiedBuildRunSnapshot\|null, events: VerifiedBuildEventSnapshot[] }`. 400 missing params. |
| `/api/harness/runs` (`runs/route.ts:84-189`) | POST | session + chat ownership | Body `{ sessionId, chatId, latestUserMessageId, intentSummary? ≤1000, selectionReason? ≤500, mode: "investigation"\|"verified_build" (default verified_build) }`. Idempotent on session/chat/message/mode (`run-mapping.ts:64-77, 240-247`). Returns **202** `{ run }`. 503 disabled. |
| `/api/harness/runs/[runId]` (`[runId]/route.ts:8-12`) | GET | session + run ownership | Snapshot: `{ run, harnessRun (live upstream status object), events[] }` (`run-access.ts:89-116`). |
| `/api/harness/runs/[runId]/events` (`events/route.ts:24-155`) | GET | session + run ownership | **SSE stream** (`text/event-stream`), proxied from upstream with `Last-Event-ID` header / `after_event_id` query / stored lastEventId resume + replay limit; web app **tees the stream**, persisting each event to `verified_build_events` and reducing run state. |
| `/api/harness/runs/[runId]/approve` (`approve/route.ts:10-52`) | POST | session + run ownership | `{ kind (1-120, req), approved: bool=true, note? ≤1000 }` → forwarded as `{ approval_kind, approved, note? }`. Validates `kind` is actually pending (local field or upstream `pending_approvals`/`pending_approval_details`) else 400 (`proxy.ts:62-79`). |
| `/api/harness/runs/[runId]/cancel` (`cancel/route.ts:10-37`) | POST | session + run ownership | `{ reason? ≤500 }`; optimistically sets local status `cancellation_requested` (`proxy.ts:81-86`). |
| `/api/harness/runs/[runId]/repair` (`repair/route.ts:10-50`) | POST | session + run ownership | `{ capsuleId?, approvalKind?, note? }`; 400 unless capsuleId or approvalKind present. |
| `/api/harness/runs/[runId]/{artifacts,capsules,audit,trace}` | GET | session + run ownership | Verbatim upstream JSON proxy (`proxy.ts:115-138`). |
| `/api/harness/runs/[runId]/trace/export-plan` | GET | same | Upstream proxy (`proxy.ts:140-161`). |
| `/api/harness/workcells/[workcellId]` (`workcells/[workcellId]/route.ts:15-47`) | GET | session (no run scoping!) | Upstream workcell JSON. |
| `/api/harness/artifacts/[artifactId]?runId=` (`artifacts/[artifactId]/route.ts:9-24`) | GET | session + run ownership via required `runId` query | Upstream artifact JSON. |
| `/api/harness/ready` (`ready/route.ts:7-49`) | GET | **none** (no session check) | `{ enabled:false }` when disabled; else aggregates upstream `/health`, `/ready`, `/openapi.json`, `/ui-manifest.json` (`client.ts:131-149`). |

`VerifiedBuildRunSnapshot` (`types.ts:82-103`): `{ id, sessionId, chatId, harnessRunId, mode, status, tenantId, projectId, actorId, intentSummary, selectionReason, lastEventId, lastEventName, lastEventAt, planApprovalState, pendingApprovalKind, finalReportArtifactId, goNoGo, createdAt, updatedAt }`.

### 2.2 SSE event names known to the web client

`apps/web/.../hooks/use-verified-build-events.ts:9-22`: `ready, open_agents.run.accepted, coordinator.plan, workcell.created, gate.running, gate.completed, approval.required, approval.recorded, run.completed, run.failed, run.cancelled, run.canceled`. The browser uses native `EventSource` with `after_event_id` resume. Persisted-event reduction (`events.ts:35-100`) maps these to status/planApprovalState/goNoGo. Note: `EventSource` cannot set headers, so the cookie session is the only auth — relevant for iOS (URLSession SSE must carry cookies).

### 2.3 Web UI consumers and maturity

- Chat page right panel `VerifiedBuildPanel` (tabs Timeline / Workcells / Evidence / Ops) mounted via portal in `session-chat-content.tsx:3285-3307`, toggled from `session-header.tsx:112,273`. Reads GET `/api/harness/runs?sessionId&chatId` (SWR, no auto-refresh) + live SSE; Ops tab has Approve plan / Cancel / Repair buttons posting to the three action routes (`verified-build-approvals.tsx:8-17`).
- Workcells/Evidence/Observability tabs render purely from the event stream — **no UI consumer exists** for `/workcells/[id]`, `/artifacts/[id]`, `/runs/[id]/{artifacts,capsules,audit,trace}`, `/trace/export-plan`, or `/ready` (grep confirms zero non-API references).
- **The Start button is currently unreachable**: `VerifiedBuildPanelEmpty` (with the "Start Verified Build" POST) is exported but never rendered — the live panel shows plain "No Verified Build run for this chat" text when no run exists (`verified-build-panel.tsx:90-95,132+`). So in practice runs only start if something else creates them; treat starting runs from UI as not wired.
- Whole feature is server-gated by `HARNESS_ENABLED` env; when off, every run-scoped route returns 503 `harness_disabled` and `/ready` returns `{enabled:false}`.

**Verdict: Verified Build is internal/experimental.** The proxy and panel exist, but the external harness service is env-gated, the catalog entry is disabled (§3), and the start affordance isn't mounted. Not an iOS v1 surface; at most a "view timeline if a run exists" curiosity. The approve/cancel/repair gates would only matter once the harness ships.

---

## 3. Workflows

Two distinct things share the name:

### 3.1 `/api/workflows/catalog` — the only `/api/workflows/*` route

`GET /api/workflows/catalog` (`apps/web/app/api/workflows/catalog/route.ts:90-128`), session auth. Response:
```ts
{ workflows: [{ id, name, version, description, capabilities: string[],
                proofLevel: "level-1"|"level-2"|"level-3",
                available: boolean, disabledReason: string|null }] }
```
503 `{ errorKind: "catalog_unavailable", message }` on failure. The static catalog (`apps/web/lib/workflows/catalog.ts:204-272`) has exactly 4 entries — `verified-build`, `deep-research`, `runtime-profile-validation`, `release-smoke` — and **all are `enabled: false`** ("the managed workflow runtime that executes this workflow has not shipped"). UI consumer: `WorkflowPickerCompact` chip in the chat composer (`workflow-picker-compact.tsx:133`); selection is local state only and the trigger is disabled when no workflow is available — which is always, today. **Catalog = visible but inert. Skip for iOS v1.**

### 3.2 `workflow_runs` / `workflow_run_steps` — chat-run telemetry, not a public API

Despite the name, `workflow_runs` (schema.ts:1200-1248) records **each chat agent run** executed as a Vercel Workflow DevKit durable function (`runAgentWorkflow` in `apps/web/app/workflows/chat.ts`, started by `POST /api/chat` via `start()` — `app/api/chat/route.ts:3,32,306`; response header `x-workflow-run-id`). Columns: model/inference route, runtime mode (`classic|managed_runtime`), sandboxName, managed-runtime profile linkage, `status: completed|aborted|failed`, timings; steps table has per-step durations and finish reasons (schema.ts:1250-1272). These rows surface only through the session **observability** endpoint `GET /api/sessions/[sessionId]/observability` (`route.ts:56-156`) and debug bundles — another researcher's area. Background-agent runs also reference their durable `workflowRunId` (string, no FK).

There is also a goal ledger (`workflow_goals` / `workflow_goal_events`, schema.ts:1701-1786; statuses `draft → planned → running → awaiting_input/blocked/validating → complete/failed/canceled/archived`) written by `lib/workflows/goal-ledger-recorder.ts` during chat workflows and read via the observability route — no dedicated API.

Workflow *input* validation/snapshots (`lib/workflows/run-start.ts`, `workflow_input_snapshots` schema.ts:1350-1374): `POST /api/chat` accepts optional `workflowId`, `workflowSchema`, `workflowSchemaVersion` and rejects invalid inputs with 422-style errors (`workflow_input_invalid` with `fieldErrors`, `workflow_input_unauthorized`, `workflow_version_mismatch`) before starting the durable run (`app/api/chat/route.ts:242-345`). Since the catalog is all-disabled, this path is dormant in real use.

---

## 4. iOS v1 guidance (what to build vs skip)

**Build (real, user-facing, poll-friendly):**
1. Background agents list + create/edit/enable-disable (`/api/background-agents` CRUD) — forms are complex (triggers, conditions, permissions, output modes) but the API is clean JSON with strict zod validation.
2. Background runs list + run detail (`/api/background-agent-runs`, `/[runId]`) with events timeline, outputs (PR links), `resultSummary` — mirrors web's 2 s/4 s SWR polling; trivially portable to iOS timers.
3. Readiness banner (`/api/background-agents/readiness`) to explain why the feature is disabled (mirrors `background-readiness-verdict.ts` UX in settings).
4. Manual test trigger (`POST /api/background-agents/[id]/test`).

**Defer/skip:**
- All `/api/harness/*` (env-gated experimental Verified Build; start affordance not even wired in web).
- `/api/workflows/catalog` (all entries disabled; picker is inert).
- Tool grants / composioToolkitSlugs for background agents (no write API).
- Cron/webhook endpoints (machine-to-machine, never called by clients).

**iOS-relevant technical notes:**
- All client surfaces assume the better-auth session cookie; SSE (`/api/harness/runs/[id]/events`) is the only streaming endpoint in scope and relies on cookie auth because the web uses `EventSource`.
- Server feature gates (`BACKGROUND_AGENTS_ENABLED`, `BACKGROUND_AGENTS_ALLOWED_REPOS`, `HARNESS_ENABLED`) mean iOS must handle "enabled:false"/403/503 states gracefully; the readiness endpoint is the canonical way to render that.
- Timestamps serialize as ISO strings through `Response.json` (Drizzle `Date` → JSON), e.g. `createdAt`, `lastEventAt`.

## Open questions / uncertainties

- The external harness service implementation isn't in this repo; upstream payload shapes for workcells/capsules/artifacts/trace are opaque (`HarnessJsonObject`). If Verified Build ever becomes an iOS surface, the harness's own OpenAPI (`/openapi.json` via `/api/harness/ready`) is the source of truth.
- Whether `HARNESS_ENABLED`/`BACKGROUND_AGENTS_ENABLED` are set in the production Vercel project could not be verified from the repo (env, not code). Settings UI ships either way, so background agents may show "missing/disabled" readiness in prod.
- `VerifiedBuildPanelEmpty` being unmounted looks like an unfinished wiring step, not a deliberate removal — confirm intent before assuming runs can be started from any client.
- `webhookSecretHash` column on triggers is unused; per-trigger webhook secrets may land later and would change the iOS webhook-display UX.
