# Open Agents Verified Build Implementation Plan

Prepared: 2026-05-12  
Primary source strategy: `/Users/dennisonbertram/Develop/autonomous-build-infra/docs/open-agents-verified-build-strategy.md`

## Scope

This plan turns Open Agents into a consumer of the AutoBuilder harness verified-build control plane. Open Agents keeps ownership of conversation, intent, session state, product UI, user approvals, and sandbox provider wiring. The harness owns governed mutation, workcell execution, gates, evidence, repair, cancellation truth, audit, trace, metrics, and final go/no-go reports.

Read [Verified Build Roadmap](verified-build-roadmap.md) first to understand where the build currently is and what evidence is required to advance. Then read [Verified Build Builder Observability](verified-build-builder-observability.md) so the implementation process itself stays inspectable. Runtime/product observability for completed Verified Build runs lives in [Verified Build Runtime Observability Requirements](verified-build-observability-requirements.md). The product and contract foundations live in [Verified Build Coordinator Operating Model](verified-build-coordinator-operating-model.md) and [Verified Build Contracts V0](verified-build-contracts-v0.md).

The target user promise is:

```text
intent -> classification -> harness run -> workcells -> gates -> repair -> evidence -> report -> PR
```

The first production-safe rule is that trusted code-changing work must not mutate files through the current top-level coding agent. It must route through a Verified Build run. Direct coding can remain available as an explicit fast/developer mode, visually distinct from Verified Build.

## Sources Read

- `/Users/dennisonbertram/Develop/autonomous-build-infra/docs/open-agents-verified-build-strategy.md`
- `/Users/dennisonbertram/Develop/autonomous-build-infra/docs/open-agents-adoption-plan.md`
- `/Users/dennisonbertram/Develop/autonomous-build-infra/docs/open-agents-integration.md`
- `/Users/dennisonbertram/Develop/autonomous-build-infra/docs/open-agents-contract/README.md`
- `/Users/dennisonbertram/Develop/autonomous-build-infra/docs/open-agents-operator-runbook.md`
- `/Users/dennisonbertram/Develop/autonomous-build-infra/docs/open-agents-completion-audit.md`
- Local Open Agents architecture and integration points:
  - `apps/web/app/api/chat/route.ts`
  - `apps/web/app/workflows/chat.ts`
  - `apps/web/app/workflows/chat-sandbox-runtime.ts`
  - `apps/web/lib/db/schema.ts`
  - `apps/web/lib/db/sessions.ts`
  - `apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx`
  - `packages/agent/open-agent.ts`
  - `packages/sandbox/interface.ts`

## Current Local Shape

Open Agents already has the host-side pieces the strategy expects:

- Durable chat workflow with active stream recovery in `apps/web/app/api/chat/route.ts` and `apps/web/app/workflows/chat.ts`.
- Sandbox resolution in `apps/web/app/workflows/chat-sandbox-runtime.ts`.
- A narrow sandbox interface in `packages/sandbox/interface.ts` with `workingDirectory`, `exec`, optional `execDetached`, optional `domain`, optional `getState`, and `stop`.
- Direct coding tools in `packages/agent/open-agent.ts`, including raw file writes, edits, shell, and subagent execution.
- Session/chat database state in `apps/web/lib/db/schema.ts`.
- Right-side session panel infrastructure currently focused on Git/diff/PR state.
- Bun test and route/component test patterns already in place.

The harness side is locally ready according to the completion audit. The remaining external blockers are hosted production config and real Open Agents live-proof inputs.

## Naming Decision

Use `harness` in code and API paths for the integration boundary:

```text
apps/web/lib/harness/*
apps/web/app/api/harness/*
```

Use `Verified Build` in product UI copy. This keeps the product language friendly while matching the adoption plan and contract docs.

## Non-Negotiables

- `HARNESS_ENABLED=false` by default until hosted readiness and live proof are complete.
- Open Agents must not import harness internals. It consumes `GET /openapi.json`, `GET /ui-manifest.json`, and the HTTP/SSE contract.
- Every Open Agents server call to the harness includes service bearer auth, tenant/project/actor scope, and `X-Request-ID`.
- The UI must recover after refresh from stored run mapping plus harness SSE replay using `Last-Event-ID` or `after_event_id`.
- Raw provider credentials, bearer tokens, authorization headers, request bodies, artifact content, and env values must never be logged.
- PR creation from Verified Build is disabled until required gates pass and the final report says go.
- Cancellation must surface cleanup/recovery state, not only "stopped".
- Artifact content is blocked in Open Agents unless the harness reports `redaction_status: passed`.

## Data Model

Add a dedicated run mapping table. Do not overload `chats.activeStreamId`; that field tracks the Open Agents workflow stream.

### `verified_build_runs`

Fields:

- `id text primary key`
- `session_id text not null references sessions(id) on delete cascade`
- `chat_id text not null references chats(id) on delete cascade`
- `user_id text not null references users(id) on delete cascade`
- `harness_run_id text not null unique`
- `mode text not null enum('investigation', 'verified_build')`
- `status text not null`
- `tenant_id text not null`
- `project_id text`
- `actor_id text not null`
- `idempotency_key text not null`
- `intent_summary text`
- `selection_reason text`
- `last_event_id text`
- `last_event_name text`
- `last_event_at timestamp`
- `plan_approval_state text enum('not_required', 'pending', 'approved', 'rejected')`
- `pending_approval_kind text`
- `final_report_artifact_id text`
- `go_no_go text enum('unknown', 'go', 'no_go') default 'unknown'`
- `created_at timestamp not null default now()`
- `updated_at timestamp not null default now()`

Indexes:

- `verified_build_runs_session_chat_idx(session_id, chat_id)`
- `verified_build_runs_user_status_idx(user_id, status)`
- `verified_build_runs_harness_run_id_idx(harness_run_id)`
- `verified_build_runs_idempotency_idx(tenant_id, project_id, actor_id, idempotency_key)` unique

### `verified_build_events`

Persist a redacted event mirror for refresh recovery, support triage, and local UI history. The harness remains source of truth.

Fields:

- `id text primary key`
- `verified_build_run_id text not null references verified_build_runs(id) on delete cascade`
- `harness_event_id text not null`
- `event_name text not null`
- `event_payload jsonb not null`
- `event_at timestamp`
- `received_at timestamp not null default now()`
- `request_id text`

Indexes:

- `verified_build_events_run_event_idx(verified_build_run_id, harness_event_id)` unique
- `verified_build_events_run_received_idx(verified_build_run_id, received_at)`

Retention:

- Keep all events for active runs.
- For terminal runs, keep metadata forever with a future retention job for very large payloads if needed.
- Store payloads only after applying Open Agents redaction, even though the harness already redacts.

After changing `apps/web/lib/db/schema.ts`, run:

```bash
bun run --cwd apps/web db:generate
```

## Environment And Feature Flags

Add to `apps/web/.env.example`:

```env
# Verified Build harness integration
HARNESS_ENABLED=false
HARNESS_BASE_URL=http://localhost:4318
HARNESS_SERVICE_TOKEN=
HARNESS_TENANT_ID=
HARNESS_DEFAULT_PROJECT_ID=
HARNESS_ALLOWED_DIRECT_MODE=false
HARNESS_LOG_JSON=false
HARNESS_REQUEST_TIMEOUT_MS=15000
HARNESS_SSE_REPLAY_LIMIT=100

# Optional observability export discovery rendered from harness export-plan
OTEL_EXPORTER_OTLP_ENDPOINT=
LANGTRACE_ENDPOINT=
LANGTRACE_API_KEY_REF=
```

Rules:

- `HARNESS_SERVICE_TOKEN` is server-only.
- `HARNESS_TENANT_ID` is required when `HARNESS_ENABLED=true`.
- No client bundle receives service token, tenant secret material, or raw artifact content.
- `HARNESS_ALLOWED_DIRECT_MODE=true` only enables the explicit fast/developer escape hatch. It does not make direct mode the default.

## Implementation Phases

### Phase 0: Baseline And Local Developer Instrumentation

Goal: make the repo ready to add UI and integration without hidden boot issues.

Implementation:

- Run `bun install`.
- Install Agentation for frontend local development:

  ```bash
  bun add -d agentation
  ```

- Mount it in `apps/web/app/providers.tsx` behind development mode only.
- Run baseline checks:

  ```bash
  bun run typecheck
  bun run ci
  ```

- From `autonomous-build-infra`, run the credential-safe consumer check:

  ```bash
  pnpm harness:open-agents:consumer-check -- --repo /Users/dennisonbertram/Develop/open-agents --json
  ```

Observability:

- Confirm existing workflow logs do not print secrets.
- Add no harness runtime behavior yet.

Tests:

- Existing repo tests only.
- Manual browser smoke with dev server in tmux:

  ```bash
  tmux new-session -d -s open-agents-web 'cd /Users/dennisonbertram/Develop/open-agents && bun run web'
  ```

Exit:

- Open Agents boots.
- Agentation toolbar appears locally in development.
- No runtime harness behavior exists yet.

### Phase 1: Harness Config, Types, Client, And Readiness

Goal: Open Agents can verify a harness service without creating runs.

Files to add:

```text
apps/web/lib/harness/config.ts
apps/web/lib/harness/types.ts
apps/web/lib/harness/request-id.ts
apps/web/lib/harness/redaction.ts
apps/web/lib/harness/logger.ts
apps/web/lib/harness/client.ts
apps/web/lib/harness/client.test.ts
apps/web/lib/harness/config.test.ts
apps/web/lib/harness/redaction.test.ts
apps/web/app/api/harness/ready/route.ts
apps/web/app/api/harness/ready/route.test.ts
```

Behavior:

- Parse server-only config with Zod.
- If disabled, `/api/harness/ready` returns `{ enabled: false }` and never contacts the harness.
- If enabled, server route calls:
  - `GET /health`
  - `GET /ready`
  - `GET /openapi.json`
  - `GET /ui-manifest.json`
- Preserve incoming `X-Request-ID` if safe; otherwise generate one.
- Attach:
  - `Authorization: Bearer <token>`
  - `X-Open-Agents-Tenant`
  - `X-Open-Agents-Project` when available
  - `X-Open-Agents-Actor` when available
  - `X-Request-ID`
- Use bounded request timeouts.
- Return stable Open Agents error envelopes to the UI without exposing harness exception details.

Observability:

- Add `logHarnessEvent(event)` JSON logger with redaction.
- Log one sanitized line per Open Agents harness route:
  - `event`
  - `request_id`
  - `session_id` when route-scoped
  - `chat_id` when route-scoped
  - `harness_run_id` when known
  - `method`
  - `path`
  - `status`
  - `duration_ms`
  - `harness_status`
  - `tenant_id`
  - `project_id`
  - `actor_id`
  - `error_code`
- Never log:
  - request bodies
  - `Authorization`
  - `HARNESS_SERVICE_TOKEN`
  - raw env values
  - artifact content
  - provider URLs containing credentials

Unit tests:

- Config disabled by default.
- Enabled config rejects missing `HARNESS_BASE_URL`, token, and tenant.
- Base URL rejects non-HTTP(S), non-origin values, credentials, query strings, and fragments.
- Client sends required auth and scope headers.
- Client preserves/generates request id.
- Client maps unauthorized, forbidden, invalid request, payload too large, and internal errors.
- Redactor removes bearer values, token-shaped strings, raw env-shaped values, and artifact-like payloads.

Integration tests:

- Fake harness server returns health/ready/openapi/ui manifest.
- `/api/harness/ready` succeeds when enabled and fake server is ready.
- `/api/harness/ready` fails closed on auth failure.
- Disabled mode makes no outbound fetch.

Regression tests:

- No bearer token appears in console logs.
- `WWW-Authenticate` and `X-Request-ID` from harness are preserved in server-side diagnostics but not leaked unsafely to the browser.

Exit:

- Readiness route works.
- No run creation yet.

### Phase 2: Run Mapping, Start, Status, And SSE Replay

Goal: Open Agents starts fake/local harness runs and can recover the timeline after refresh.

Files to add:

```text
apps/web/lib/db/verified-build-runs.ts
apps/web/lib/db/verified-build-runs.test.ts
apps/web/lib/harness/run-mapping.ts
apps/web/lib/harness/events.ts
apps/web/lib/harness/events.test.ts
apps/web/app/api/harness/runs/route.ts
apps/web/app/api/harness/runs/route.test.ts
apps/web/app/api/harness/runs/[runId]/route.ts
apps/web/app/api/harness/runs/[runId]/route.test.ts
apps/web/app/api/harness/runs/[runId]/events/route.ts
apps/web/app/api/harness/runs/[runId]/events/route.test.ts
```

Behavior:

- `POST /api/harness/runs` requires authenticated user and owned `sessionId`/`chatId`.
- Build idempotency key from `sessionId`, `chatId`, latest user message id, and action name.
- Call harness `POST /runs`.
- Persist `verified_build_runs` row with returned `harness_run_id`, effective tenant/project/actor, mode, and status.
- `GET /api/harness/runs/[runId]` checks local ownership, then calls harness `GET /runs/:id`.
- `GET /api/harness/runs/[runId]/events` checks ownership, then proxies SSE from harness.
- The SSE proxy sends `Last-Event-ID` from:
  - browser `Last-Event-ID` header,
  - `after_event_id` query param,
  - stored `verified_build_runs.last_event_id`.
- Persist each event id/name/payload after redaction.
- Update the run mapping cursor and status as events arrive.
- Bound replay with `HARNESS_SSE_REPLAY_LIMIT`.

Observability:

- Log `verified_build.run.start.requested`, `accepted`, `conflict`, `failed`.
- Log `verified_build.sse.connected`, `event.persisted`, `replay.started`, `disconnected`, `failed`.
- Include stream duration and last event id in disconnect logs.
- Add local debug endpoint only for owners:

  ```text
  GET /api/harness/runs/[runId]/audit
  GET /api/harness/runs/[runId]/trace
  GET /api/harness/runs/[runId]/trace/export-plan
  ```

  These proxy harness redacted audit/trace/export-plan routes in later phases.

Unit tests:

- Idempotency key is stable for retries and different across distinct user actions.
- Event reducer maps harness event names to Open Agents run states.
- Unknown events persist and render as timeline metadata instead of breaking.
- Local ownership checks deny cross-session and cross-user access.

Integration tests:

- Fake harness `POST /runs` returns `202` immediately.
- Fake harness SSE emits:
  - `ready`
  - `open_agents.run.accepted`
  - `coordinator.plan`
  - `workcell.created`
  - `gate.running`
  - `gate.completed`
  - `run.completed`
- Route persists mapping and event cursor.
- Browser reconnect with `Last-Event-ID` receives only missing events.
- Duplicate `POST /api/harness/runs` with same idempotency key returns the existing mapping.

Regression tests:

- Duplicate browser submits do not create duplicate harness runs.
- Refresh during an active SSE stream recovers from stored `last_event_id`.
- Cross-user run id fetch returns 404 or 403 without probing harness.
- Malformed harness event payload is stored as safe unknown metadata and logged with request id.

Exit:

- A fake harness run can be started from server API and followed through SSE.
- Refresh recovery works without UI polish yet.

### Phase 3: Verified Build Panel And UI Manifest Rendering

Goal: users can see a run as a trustworthy build process.

Files to add:

```text
apps/web/app/sessions/[sessionId]/chats/[chatId]/verified-build-panel.tsx
apps/web/app/sessions/[sessionId]/chats/[chatId]/verified-build-timeline.tsx
apps/web/app/sessions/[sessionId]/chats/[chatId]/verified-build-workcells.tsx
apps/web/app/sessions/[sessionId]/chats/[chatId]/verified-build-evidence.tsx
apps/web/app/sessions/[sessionId]/chats/[chatId]/verified-build-approvals.tsx
apps/web/app/sessions/[sessionId]/chats/[chatId]/verified-build-observability.tsx
apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-verified-build-run.ts
apps/web/app/sessions/[sessionId]/chats/[chatId]/hooks/use-verified-build-events.ts
apps/web/components/verified-build/status-badge.tsx
apps/web/components/verified-build/event-icon.tsx
```

Likely existing files to adjust:

```text
apps/web/app/sessions/[sessionId]/session-layout-shell.tsx
apps/web/app/sessions/[sessionId]/chats/[chatId]/session-chat-content.tsx
apps/web/app/types.ts
```

Behavior:

- Add a session right rail that can show Git, Verified Build, or both as clear tabs.
- Render first-pass surfaces from `GET /ui-manifest.json`:
  - status
  - lifecycle timeline
  - plan
  - workcells
  - gates
  - evidence/artifacts metadata
  - failure capsules
  - pending approvals
  - cancel/repair controls
  - redacted trace/export readiness
  - audit trail
  - final go/no-go report
- Add a `data-verified-build` UI message part or local chat annotation so the chat can narrate major transitions without hiding the run panel.
- Do not place the whole feature inside nested cards. Use a dense operator panel with small status rows, tables, and tabs.
- PR button remains disabled until `go_no_go=go` and required evidence passed.

Observability:

- Panel shows:
  - current `request_id` for last server action
  - last event id
  - worker heartbeat if returned by status
  - stale/recovered status
  - cleanup-required state
  - trace export plan: disabled, ready, or blocked
- User-visible error states include request id and safe error code.
- Add UI event logs only for control actions:
  - `verified_build.ui.approve.clicked`
  - `verified_build.ui.cancel.clicked`
  - `verified_build.ui.repair.clicked`
  - `verified_build.ui.trace.opened`

Component tests:

- Status badge renders running, approval-required, cancelled, failed, completed, needs-review.
- Timeline groups unknown events without crashing.
- Failure capsule renders summary without artifact content.
- Redaction-failed artifact shows metadata and blocks content.
- Final report enables PR only for go state with required gates passed.
- Long text wraps and does not overflow compact rows.

Behavioral tests:

- User starts fake run and sees plan, workcell, gate, final report.
- User refreshes and sees the same timeline restored.
- User sees request id on a failed control action.
- User cannot open blocked artifact content.

Exit:

- Fake run lifecycle is understandable in the session UI.

### Phase 4: Coordinator Routing And Restricted Trusted Mode

Goal: code-changing intent defaults to Verified Build instead of direct tools.

Files to add:

```text
apps/web/lib/verified-build/task-classifier.ts
apps/web/lib/verified-build/task-classifier.test.ts
apps/web/lib/verified-build/mode-policy.ts
apps/web/lib/verified-build/mode-policy.test.ts
apps/web/app/workflows/verified-build.ts
apps/web/app/workflows/verified-build.test.ts
```

Likely files to adjust:

```text
apps/web/app/api/chat/route.ts
apps/web/app/workflows/chat.ts
apps/web/app/types.ts
packages/agent/open-agent.ts
packages/agent/system-prompt.ts
```

Behavior:

- Add three modes:
  - `chat`: explanation and discussion, no mutation.
  - `investigation`: read-only or low-risk scoped exploration.
  - `verified_build`: governed code-changing work.
- Start with a deterministic classifier and allow model-assisted classification later.
- Verified Build default triggers:
  - implement, fix, refactor, migrate, test, deploy, open PR, change files.
  - auth, billing, permissions, data migration, secrets, deployment, providers.
  - multi-file or cross-package work.
  - user asks for tests, CI, browser proof, or PR.
- Chat mode triggers:
  - explain, brainstorm, strategy-only, no repo mutation.
- Investigation triggers:
  - look into, debug why, scope, review, plan.
- When classified as Verified Build:
  - Persist user message.
  - Stream assistant narration explaining why Verified Build was selected.
  - Start harness run.
  - Do not call `resolveChatSandboxRuntime`.
  - Do not expose direct `bash`, `write`, `edit`, or `task` mutation tools.
- Keep direct mode behind explicit user action or flag.

Observability:

- Log classifier input summary, not raw prompt.
- Log mode decision:
  - `mode`
  - `reason_code`
  - `confidence`
  - `direct_mode_allowed`
  - `request_id`
  - `session_id`
  - `chat_id`
- Record the selection reason in `verified_build_runs.selection_reason`.

Unit tests:

- Mutating examples classify as Verified Build.
- Strategy-only examples remain Chat.
- "Review/plan/debug why" examples classify as Investigation.
- High-risk keywords escalate to Verified Build.
- Explicit direct mode is rejected when `HARNESS_ALLOWED_DIRECT_MODE=false`.

Workflow tests:

- Verified Build path starts harness and does not resolve sandbox runtime.
- Direct chat path still uses existing workflow.
- Existing active stream conflict behavior still prevents duplicate work.
- Managed-template trial message limit still applies before starting Verified Build.

Regression tests:

- User prompt "fix this" cannot call direct `write`, `edit`, or `bash` in trusted mode.
- Auto-commit and auto-PR do not run for Verified Build unless final harness evidence permits PR.
- Active direct workflow and active Verified Build cannot both mutate the same chat concurrently.

Exit:

- Code-changing intent routes through harness by default.

### Phase 5: Approvals, Cancellation, Repair, Artifacts, Audit, And Trace

Goal: complete the operator loop before real sandbox bridge work.

API routes to add:

```text
apps/web/app/api/harness/runs/[runId]/approve/route.ts
apps/web/app/api/harness/runs/[runId]/cancel/route.ts
apps/web/app/api/harness/runs/[runId]/repair/route.ts
apps/web/app/api/harness/runs/[runId]/artifacts/route.ts
apps/web/app/api/harness/runs/[runId]/capsules/route.ts
apps/web/app/api/harness/runs/[runId]/audit/route.ts
apps/web/app/api/harness/runs/[runId]/trace/route.ts
apps/web/app/api/harness/runs/[runId]/trace/export-plan/route.ts
apps/web/app/api/harness/workcells/[workcellId]/route.ts
```

Behavior:

- Approval route accepts only known approval kinds returned by harness status/events.
- Cancel route is idempotent and updates local status to cancellation-requested while waiting for harness truth.
- Repair route requires a failure capsule or explicit repair approval kind.
- Artifact list is metadata-only.
- Artifact detail route blocks content unless harness redaction passed.
- Audit and trace routes are owner-scoped and read-only.
- Operator status can be surfaced for admins later:

  ```text
  apps/web/app/api/harness/operator/status/route.ts
  apps/web/app/api/harness/operator/metrics/route.ts
  ```

Observability:

- Every control route logs:
  - control kind
  - request id
  - run id
  - status
  - duration
  - harness error code
- Panel correlates:
  - request logs
  - SSE events
  - audit entries
  - trace spans
  - final report
- Add warnings when local event cursor lags harness status.

Tests:

- Approval with known kind succeeds.
- Approval with unknown kind is rejected client-side and server-side.
- Completed/failed run approval fails cleanly.
- Cancel active run records local cancellation-requested and then cancelled event.
- Repeated cancel is safe.
- Repair requires failed state or approval requirement.
- Artifact content is denied when redaction failed.
- Trace/export-plan blocks credential-bearing endpoints in displayed metadata if harness reports blocked.

Exit:

- Fake run supports the full operator loop: approve, cancel, repair, artifacts, audit, trace.

### Phase 6: Open Agents Sandbox Bridge

Goal: allow the harness to execute workcells through an Open Agents sandbox without exposing broad internals.

Files to add:

```text
apps/web/lib/harness/sandbox-bridge.ts
apps/web/lib/harness/sandbox-bridge.test.ts
scripts/open-agents-bridge.mjs
docs/plans/open-agents-verified-build-bridge-notes.md
```

Implementation:

- Export a narrow bridge:

  ```ts
  export async function createOpenAgentsSandboxBridge({ credentialRef }) {
    return {
      async connect({ run_id, request, plan }) {
        return {
          sandbox_ref: "open-agents:<session-or-sandbox-id>",
          sandbox,
        };
      },
    };
  }
  ```

- The returned sandbox object must satisfy:
  - `workingDirectory`
  - `exec(command, cwd, timeoutMs, { signal })`
  - optional `execDetached(command, cwd)`
  - optional `domain(port)`
  - optional `getState()`
  - `stop()`
- Resolve `credential-ref:*` through Open Agents-owned config or token broker.
- If a GitHub setup token is needed, mint the narrow token in Open Agents, pass it only into `connectSandbox`, revoke it after setup, and never expose it to workcells.
- Bind cancellation to `sandbox.stop()`.
- Persist updated sandbox state back to the session when safe.

Observability:

- Log bridge lifecycle:
  - connect requested
  - sandbox connected
  - command started
  - command completed
  - command failed
  - cancellation signaled
  - sandbox stopped
- Include command metadata only:
  - command hash or first safe verb
  - cwd
  - timeout
  - duration
  - exit code
- Do not log stdout/stderr by default. If a future debug mode captures them, apply redaction and size caps.

Tests:

- Bridge returns only the narrow sandbox shape.
- `AbortSignal` calls `sandbox.stop()`.
- Credential ref is required and raw credential-like values are rejected.
- Setup token revocation runs in `finally`.
- `exec` propagates timeout and signal.
- `domain` and `getState` are optional.

Live-proof preflight:

From `autonomous-build-infra`:

```bash
OPEN_AGENTS_LIVE_PROOF=1 \
OPEN_AGENTS_LIVE_SPEND_CAP_USD=5 \
OPEN_AGENTS_CREDENTIAL_REF=credential-ref:<open-agents-sandbox> \
pnpm harness:open-agents:live-proof -- --check-only --bridge-module /Users/dennisonbertram/Develop/open-agents/scripts/open-agents-bridge.mjs
```

Exit:

- Check-only live proof accepts the bridge module.
- No raw credentials appear in source, logs, DB rows, or artifacts.

### Phase 7: Hosted Harness And Production Readiness

Goal: connect Open Agents to a hosted long-running harness service.

Hosted requirements from the source docs:

- Managed operator store.
- Artifact storage.
- Credential broker.
- Service token ref.
- Public harness HTTPS origin.
- Allowed Open Agents origin.
- Network exposure approved.
- Provider proofs gated.
- Spend cap no greater than 5 USD.

Open Agents implementation:

- Configure production env without exposing secrets to the client.
- Add admin-only readiness/status surface if needed.
- Add deployment documentation under `docs/deployment/verified-build-harness.md`.
- Keep `HARNESS_ENABLED=false` until production-check is ready.

Required harness check:

```bash
pnpm harness:open-agents:production-check
```

Observability:

- Confirm hosted harness JSON lifecycle logs are collected.
- Confirm `GET /operator/metrics` is scraped with service bearer token outside the browser.
- Add dashboard panels for:
  - visible runs
  - running runs
  - failed runs
  - cancelled runs
  - active workers
  - stale running rows
  - pending approvals
  - cleanup-required workcells
- Wire alerts to the runbook:
  - `OpenAgentsHarnessStaleRunningRuns`
  - `OpenAgentsHarnessNoActiveWorkerForRunningRuns`
  - `OpenAgentsHarnessCleanupDebt`
  - `OpenAgentsHarnessApprovalBacklog`

Exit:

- Open Agents can call hosted `/ready`.
- Hosted fake run completes end to end.

### Phase 8: Capped Live Proof And PR Gating

Goal: prove a real Open Agents sandbox run can complete and produce a trustworthy report.

Run:

```bash
OPEN_AGENTS_LIVE_PROOF=1 \
OPEN_AGENTS_LIVE_SPEND_CAP_USD=5 \
OPEN_AGENTS_CREDENTIAL_REF=credential-ref:open-agents \
pnpm harness:open-agents:live-proof -- --bridge-module /Users/dennisonbertram/Develop/open-agents/scripts/open-agents-bridge.mjs
```

Open Agents behavior:

- Final report appears in the Verified Build panel.
- Required gates are visible.
- PR creation is enabled only when:
  - final report is `go`,
  - required gates pass,
  - artifact redaction passes,
  - no cleanup debt blocks completion.
- If final report is `no_go`, show repair or cancel options, not PR creation.

Observability:

- Save request ids and final harness run id in the local run mapping.
- Attach trace/export-plan state to final UI.
- Secret-scan generated live-proof artifacts before upload or sharing.

Exit:

- Real Verified Build succeeds from Open Agents.
- Evidence report is visible.
- PR creation is gated on passing evidence.

## Testing Matrix

### Unit Tests

Add focused Bun tests for:

- Harness config parsing and fail-closed defaults.
- Header building and tenant/project/actor scoping.
- Request id preservation/generation.
- Redaction.
- Error envelope mapping.
- Idempotency key generation.
- Event reducer and status derivation.
- DB mapping helpers and ownership checks.
- Task classifier.
- Mode policy and direct-mode escape hatch.
- UI status helpers.
- Sandbox bridge shape and cancellation.

### Route Tests

Use existing route test style with `mock.module`.

Required route coverage:

- `/api/harness/ready`
  - disabled mode
  - missing config
  - ready success
  - harness auth failure
  - request id propagation
- `/api/harness/runs`
  - auth required
  - session/chat ownership required
  - idempotent start
  - invalid body
  - harness conflict
- `/api/harness/runs/[runId]`
  - owner access
  - cross-user denial
  - terminal status mapping
- `/api/harness/runs/[runId]/events`
  - SSE proxy
  - stored cursor replay
  - `Last-Event-ID`
  - malformed event resilience
- control routes
  - approve
  - cancel
  - repair
- evidence routes
  - artifacts
  - capsules
  - audit
  - trace
  - export-plan

### Integration Tests

Add a fake harness test server in `apps/web/lib/harness/test-utils/fake-harness-server.ts`.

Scenarios:

- Readiness handshake fetches health, ready, OpenAPI, and UI manifest.
- Async `POST /runs` returns immediately with run id and workcell ids.
- SSE lifecycle completes and persists event cursor.
- Reconnect replays from `Last-Event-ID`.
- Approval-required run pauses, records approval, and resumes.
- Cancellation marks cleanup-required, then terminal cancelled.
- Failure capsule appears, repair queues, second gate passes.
- Artifact metadata lists while failed-redaction content stays blocked.
- Trace/export-plan returns local-only, ready, and blocked variants.

### Behavioral Tests

These are product-level stories that can be automated as workflow tests first and browser tests later.

- Explanation prompt stays in Chat mode and does not call harness.
- "Look into why tests fail" starts Investigation mode without mutation.
- "Fix the failing tests" starts Verified Build and disables direct tools.
- User approves a plan and sees worker/gate progress.
- User denies or cancels and sees safe terminal/cleanup state.
- User refreshes during work and recovers timeline.
- Harness auth failure shows request id and no secret detail.
- Gate failure shows failure capsule and repair option.
- Final `go` report enables PR creation.
- Final `no_go` report blocks PR creation.

### Regression Tests

Lock down the risk areas:

- No duplicate harness run on double submit.
- No direct `bash`, `write`, `edit`, or `task` mutation in trusted mode.
- No auto-commit/auto-PR until harness evidence permits it.
- No cross-tenant, cross-project, cross-actor, or cross-user data access.
- No artifact content display before redaction passes.
- No token, bearer, provider credential, env var, stdout/stderr, or artifact body in logs.
- Terminal runs reject stale approvals.
- Cancel is idempotent and does not rewrite completed runs.
- `Last-Event-ID` recovery does not replay duplicate UI rows.
- Unknown future harness event names do not break the panel.
- Missing hosted config leaves feature disabled, not partially enabled.

### Browser And Local UX Tests

When UI is implemented:

- Start Open Agents in tmux:

  ```bash
  tmux new-session -d -s open-agents-web 'cd /Users/dennisonbertram/Develop/open-agents && bun run web'
  ```

- Start fake harness in tmux:

  ```bash
  tmux new-session -d -s open-agents-harness 'cd /Users/dennisonbertram/Develop/autonomous-build-infra && pnpm harness:open-agents -- --token dev-service-token'
  ```

- Use Browser or Playwright to verify:
  - Agentation floating button appears in dev.
  - Verified Build panel opens without layout overlap.
  - Timeline updates live.
  - Buttons have clear disabled/loading/error states.
  - Mobile right rail works.
  - Long labels and request ids wrap cleanly.

### Secret And Safety Checks

Before commit or push:

```bash
gitleaks protect --staged --redact --no-banner
```

If `gitleaks` is missing, install it globally first.

Harness-side secret scan:

```bash
pnpm harness:open-agents:secret-scan -- --json
```

Open Agents checks:

```bash
bun run ci
```

## Observability And Logging Plan

Observability is a first-class product requirement, not an afterthought.

### Correlation IDs

Every Open Agents harness action must have a `request_id`.

Propagate it through:

- Open Agents API response headers.
- Harness request `X-Request-ID`.
- Local `verified_build_events.request_id` when action-related.
- JSON logs.
- User-visible error details.
- Harness audit/trace correlation views.

Also correlate:

- `session_id`
- `chat_id`
- `user_id` or safe `actor_id`
- `workflow_run_id` when a workflow starts the action
- `verified_build_run_id`
- `harness_run_id`
- `harness_event_id`
- `idempotency_key` hash only, not the raw key if it includes message ids

### Structured Logs

Add `apps/web/lib/harness/logger.ts` with a small typed logger. It can write JSON to `console.info/warn/error` initially because the repo does not have a central logging package.

Log event names:

- `verified_build.ready.checked`
- `verified_build.run.start.requested`
- `verified_build.run.accepted`
- `verified_build.run.start.failed`
- `verified_build.sse.connected`
- `verified_build.sse.event.persisted`
- `verified_build.sse.replay.started`
- `verified_build.sse.disconnected`
- `verified_build.sse.failed`
- `verified_build.approval.requested`
- `verified_build.approval.recorded`
- `verified_build.cancel.requested`
- `verified_build.cancel.completed`
- `verified_build.repair.requested`
- `verified_build.artifact.blocked`
- `verified_build.trace.export_plan.checked`
- `verified_build.mode.selected`
- `verified_build.mode.direct_rejected`

Log levels:

- `info`: successful state transitions and control actions.
- `warn`: retry, stale cursor, cancellation cleanup debt, blocked artifact, classifier uncertainty.
- `error`: route failure, harness unavailable, auth failure, DB persistence failure, SSE parse failure.

### Redaction Policy

Before any log write:

- Drop request/response bodies by default.
- Redact keys matching token, secret, authorization, cookie, password, api key, private key.
- Redact bearer-looking strings.
- Redact raw URLs containing username/password/query/fragment.
- Redact stdout/stderr unless explicitly summarized.
- Redact artifact content always.
- Allow `credential-ref:*`, `secret-ref:*`, `artifact-store:*`, and public HTTPS origins.

Tests must assert redaction with representative bad values.

### Metrics

Open Agents should not expose high-cardinality labels. Use the harness `GET /operator/metrics` for aggregate hosted alerting.

Open Agents local metrics can initially be derived from DB queries and logs:

- verified build runs by status
- starts per hour
- failed starts
- cancellation count
- approval wait count
- stale cursor count
- SSE reconnect count
- artifact blocked count
- average run duration
- final go/no-go count

If a metrics endpoint is added later, avoid labels for user, tenant, project, run, workcell, artifact, or credential.

### Trace And Audit

Expose harness redacted trace and audit in the UI:

- `GET /runs/:id/trace` as a span tree.
- `GET /runs/:id/trace/export-plan` as export readiness.
- `GET /runs/:id/audit` as a control-plane decision trail.

Do not perform third-party trace export from Open Agents. The harness export plan tells the user/operator whether export is disabled, ready, or blocked.

### Operator Runbook Integration

Map UI/admin banners to the harness runbook:

- Stale running runs: suggest recover.
- No active worker for running rows: show process/recovery warning.
- Cleanup debt: block PR and show cleanup-required.
- Approval backlog: show pending approval age and budget/provider scope.

## PR Sequence

1. Baseline docs, env, Agentation dev mount, and harness readiness client.
2. DB schema and run mapping helpers.
3. Start/status/events routes with fake harness integration tests.
4. Verified Build panel with fake run timeline.
5. Approve/cancel/repair/artifact/audit/trace routes and UI.
6. Coordinator mode policy and Verified Build routing.
7. Sandbox bridge and check-only live-proof preflight.
8. Hosted config docs and production readiness.
9. Capped live proof and PR gating.

Each PR must keep the feature disabled by default unless it is explicitly a local fake-run PR.

## Verification Commands

Open Agents:

```bash
bun run check
bun run typecheck
bun test
bun run --cwd apps/web db:check
bun run ci
```

After schema changes:

```bash
bun run --cwd apps/web db:generate
bun run --cwd apps/web db:check
```

Harness repo:

```bash
cd /Users/dennisonbertram/Develop/autonomous-build-infra
pnpm harness:open-agents:consumer-check -- --repo /Users/dennisonbertram/Develop/open-agents --json
pnpm harness:open-agents:local-gate -- --out .harness/open-agents-local-gate
pnpm harness:open-agents:secret-scan -- --json
pnpm harness:open-agents:remaining -- --json
```

Live proof, only after hosted inputs are ready:

```bash
OPEN_AGENTS_LIVE_PROOF=1 \
OPEN_AGENTS_LIVE_SPEND_CAP_USD=5 \
OPEN_AGENTS_CREDENTIAL_REF=credential-ref:open-agents \
pnpm harness:open-agents:live-proof -- --bridge-module /Users/dennisonbertram/Develop/open-agents/scripts/open-agents-bridge.mjs
```

## Acceptance Criteria

The integration is complete when a user can:

1. Ask Open Agents to build or fix a software feature.
2. See Open Agents choose Verified Build and explain why.
3. Review and approve a plan when policy requires it.
4. Watch workcells, gates, repairs, and evidence in the panel.
5. Cancel safely and see cleanup/recovery state.
6. Inspect redacted trace and audit evidence with request-id correlation.
7. Receive a final go/no-go report.
8. Create or open a PR only after required gates pass.
9. Refresh or reopen the session and recover the run timeline, artifacts, audit, and report.

The integration is not complete if Open Agents only starts a background job but cannot show proof, approvals, failures, repairs, observability, or final evidence.

## Open Questions To Resolve Before Phase 4

- Should the first user-facing launch make Verified Build automatic for every mutating prompt, or should it start with an explicit "Run Verified Build" action while routing confidence is tuned?
- Should Investigation mode call the harness immediately, or start as an Open Agents read-only coordinator mode and graduate to harness after fake-run UX is stable?
- Should direct mode be called "Fast Mode", "Direct Mode", or be hidden behind settings while trust surfaces mature?
- Which gates are mandatory for the first public claim: typecheck, tests, diff check, secret scan, browser proof, PR preview, or all of them when applicable?
- Should Open Agents store every redacted event indefinitely, or store only cursor plus recent timeline snapshots once the hosted harness is reliable?

Recommended defaults:

- Verified Build default for mutating tasks once Phase 4 ships.
- Explicit direct mode only.
- Dedicated run mapping and event tables.
- Required first gates: typecheck, tests, diff check, secret scan. Add browser proof whenever UI files change.
