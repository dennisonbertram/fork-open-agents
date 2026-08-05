# UX Paths — Public/Unauthenticated & Service Surfaces

Scope: routes reachable without a browser session cookie — liveness/config probes,
public share-link reads, GitHub App webhooks, background-agent webhooks, cron/sweep
service endpoints, and the deprecated/disabled stubs. These need a different curl
setup than the rest of the catalog: HMAC signing or a bearer cron secret instead of
a session cookie.

## Environment / curl setup

```bash
BASE=http://localhost:3000
# service secrets (from apps/web/.env.local)
CRON=$BACKGROUND_AGENTS_CRON_SECRET        # falls back to CRON_SECRET
GH_SECRET=$GITHUB_WEBHOOK_SECRET
BA_SECRET=$BACKGROUND_AGENTS_WEBHOOK_SECRET
COOKIE=/tmp/oa-cookies.txt                  # only for the setup steps that need a session
```

Signature formats differ between the two webhook routes — this is a real
inconsistency worth recording:

- `POST /api/github/webhook` → `X-Hub-Signature-256: sha256=<hex hmac>`
  (`app/api/github/webhook/route.ts:verifySignature`)
- `POST /api/background-agents/webhook/[publicId]` → `x-open-agents-signature: <hex hmac>`
  with **no** `sha256=` prefix (`lib/background-agents/signature.ts`)

```bash
sign_gh()  { printf '%s' "$1" | openssl dgst -sha256 -hmac "$GH_SECRET" | sed 's/^.* /sha256=/'; }
sign_ba()  { printf '%s' "$1" | openssl dgst -sha256 -hmac "$BA_SECRET" | awk '{print $2}'; }
```

---

## STORY-public-surfaces-01: Uptime monitor probes the deployment without credentials

**Type**: short
**Persona**: External uptime monitor (Better Stack / cron curl), no account
**Goal**: Confirm the deployment is alive and that the Redis rate-limit backend behind authenticated routes is actually reachable.
**Preconditions**: Server running. No auth of any kind.
**Ideal path**: 1 call — `/api/health` already probes Redis through the real `checkRateLimit` path, so one request answers both liveness and dependency health.
**Alternate paths**: `GET /api/auth/info` and `GET /api/models` are also unauthenticated and would prove the process is up, but neither checks the rate-limit backend. `GET /api/harness/ready` is a third unauthenticated liveness-ish surface (Verified Build readiness). Three separate no-auth "is it up" endpoints exist — redundancy signal.

### Steps
1. `GET /api/health` → expect `200 {status:"ok",rateLimitBackend:"ok",redisConfigured:true}` when `REDIS_URL` is set and reachable.
2. `GET /api/health` with `REDIS_URL` unset in the environment → expect `503 {status:"degraded",rateLimitBackend:"unavailable",redisConfigured:false}`.

### Variations
- `curl -I` — route is `dynamic = "force-dynamic"`, so no caching between probes.
- Poll every 30s; nothing here is rate limited (the probe uses `limit: 1_000_000`).

### Edge Cases
- Redis configured but unreachable → `checkRateLimit` returns a 503-status decision → `rateLimitBackend:"unavailable"`, HTTP `503`.
- Redis configured but returning a non-503 limit decision → `rateLimitBackend:"degraded"`, HTTP `503`.
- **Local-dev trap**: outside production `checkRateLimit` fails open and returns `null`; the route guards with `isRedisConfigured()` first, so a local run with no Redis correctly reports `unavailable`, not `ok`.
- No auth-failure case exists — this route has no auth check at all.

---

## STORY-public-surfaces-02: Anonymous visitor reads a shared chat as markdown

**Type**: medium
**Persona**: A colleague who was sent a share link, not signed in to Open Agents
**Goal**: Read the full transcript of a shared chat, and grab the raw markdown to paste into a PR description.
**Preconditions**: A signed-in owner has created a session with at least one chat containing a user message and an assistant reply. This story creates the share itself (steps 1–3 use the owner's cookie; steps 4+ are anonymous).
**Ideal path**: 2 calls anonymously — one `POST .../share` by the owner to mint the id, one `GET /api/shared/{shareId}/markdown` by the reader. Everything the reader needs (title, repo, branch, PR url, transcript) is in the single markdown response's frontmatter.
**Alternate paths**: `GET /api/sessions/{sessionId}/chats/{chatId}/share` returns the *same* `shareId` as the `POST` (POST is idempotent — it returns the existing share rather than creating a second one), so two routes return identical data. `GET /api/shared/{shareId}/status` returns a slice (`isStreaming`) of state also derivable from the owner-side `GET /api/sessions/{sessionId}/chats/{chatId}`. `POST /api/sessions/{sessionId}/share` is the deprecated session-level ancestor and always `410`.

### Steps
1. `POST /api/sessions/sess_8f21c4/chats/chat_a7d9/share` (owner cookie) — body: none → expect `200 {shareId:"V1StGXR8_Z5j"}`
2. `POST /api/sessions/sess_8f21c4/chats/chat_a7d9/share` again (owner cookie) → expect `200` with the **same** `shareId` (idempotent, no duplicate row)
3. `GET /api/sessions/sess_8f21c4/chats/chat_a7d9/share` (owner cookie) → expect `200 {shareId:"V1StGXR8_Z5j"}` — duplicate of step 1's payload
4. `GET /api/shared/V1StGXR8_Z5j/markdown` with header `Accept: text/markdown` (no cookie) → expect `200`, `content-type: text/markdown; charset=utf-8`, `vary: Accept`, body starting with a `---` frontmatter block containing `session_name`, `repo`, `branch`, `pr_url`, `pr_number`, `created_at`, then `## User` / `## Assistant` sections
5. `GET /api/shared/V1StGXR8_Z5j/markdown` with no `Accept` header → expect `200`, `content-type: text/plain; charset=utf-8`, identical body
6. `GET /api/shared/V1StGXR8_Z5j/status` (no cookie) → expect `200 {isStreaming:false}`
7. `DELETE /api/sessions/sess_8f21c4/chats/chat_a7d9/share` (owner cookie) → expect `200 {success:true}`
8. `GET /api/shared/V1StGXR8_Z5j/markdown` (no cookie) → expect `404`, body `Not found\n` with the negotiated content type

### Variations
- Chat where the assistant turn contains tool calls or reasoning parts: the markdown emits an `<!-- tool_activity: duration=... tool_calls=N -->` comment before the `## Assistant` heading. Verify `tool_calls` matches the number of tool parts.
- Chat containing a `data-snippet` part: expect a `<snippet filename="apps/web/lib/db/schema.ts">…</snippet>` block in the body.
- Session with no repo linked: `repo`, `pr_url`, `pr_number` lines are omitted from frontmatter entirely (null fields are skipped), not emitted as `null`.

### Edge Cases
- Unknown share id `GET /api/shared/does-not-exist/markdown` → `404` `Not found\n` (plain text, not JSON).
- Unknown share id `GET /api/shared/does-not-exist/status` → `404 {error:"Not found"}` (JSON — the two public share routes disagree on error content type).
- Share row exists but the underlying chat row was deleted → `404` from the `getChatById` guard.
- Share + chat exist but the session row was deleted → `404` from the `getSessionByIdCached` guard (markdown only; `status` does not check the session).
- Non-owner tries step 1 with their own cookie → `403/404` from `requireOwnedSessionChat`.
- No cookie on step 1 → `401` from `requireAuthenticatedUser`.

---

## STORY-public-surfaces-03: Env content in a shared chat must stay redacted

**Type**: short
**Persona**: Security reviewer verifying a share link before it is posted publicly
**Goal**: Prove that secrets pasted into a chat are not leaked through the public markdown endpoint.
**Preconditions**: STORY-public-surfaces-02 step 1 has produced a `shareId` for a chat whose transcript includes an env-file paste (e.g. `POSTGRES_URL=postgres://user:hunter2@ep-soft-silence.aws.neon.tech/main`).
**Ideal path**: 1 anonymous call — the redaction is applied server-side in `redactSharedEnvContent` on every message before rendering, so one GET is enough to audit.
**Alternate paths**: none found — no other public route renders chat message bodies.

### Steps
1. `GET /api/shared/V1StGXR8_Z5j/markdown` header `Accept: text/markdown` → expect `200`; assert the response body does **not** contain `hunter2` and does not contain the raw connection string.
2. `GET /api/shared/V1StGXR8_Z5j/status` → expect `200 {isStreaming:false}` (carries no message content at all).

### Variations
- Secret inside a `data-snippet` part rather than a text part.
- Secret inside a tool-call argument — tool parts are counted but their bodies are not emitted by `getMessageBody`, so they should never appear.

### Edge Cases
- Share revoked mid-audit → `404` on the next call.
- Share id with URL-unsafe characters (`GET /api/shared/..%2Fadmin/markdown`) → `404`; the id is used only as a DB lookup key, never as a path.

---

## STORY-public-surfaces-04: Anonymous client polls a live shared chat

**Type**: medium
**Persona**: Reader watching a teammate's agent work in real time via a share link
**Goal**: Know when the shared chat stops streaming so they can re-fetch the final transcript.
**Preconditions**: STORY-public-surfaces-02 created `shareId`; the owner then starts a new chat turn (`POST /api/chat`) so `chat.activeStreamId` is non-null.
**Ideal path**: The reader-side ideal is 1 subscribe + 1 final read (2 calls). Today there is no public SSE for shares, so the reader must poll `status` N times and then re-fetch markdown — a friction point worth recording.
**Alternate paths**: The owner can watch the same stream via `GET /api/sessions/{sessionId}/chats/{chatId}/stream` (SSE, authenticated) — the public side has no equivalent, only the boolean `isStreaming`.

### Steps
1. `POST /api/chat` (owner cookie) — body: `{"sessionId":"sess_8f21c4","chatId":"chat_a7d9","messages":[{"role":"user","parts":[{"type":"text","text":"Add a health check to the worker service"}]}]}` → expect `200` streaming response
2. `GET /api/shared/V1StGXR8_Z5j/status` (anonymous) → expect `200 {isStreaming:true}`
3. `GET /api/shared/V1StGXR8_Z5j/status` (anonymous, repeat every 2s) → expect `200 {isStreaming:true}` while the run is active
4. `POST /api/chat/chat_a7d9/stop` (owner cookie) → expect `200`
5. `GET /api/shared/V1StGXR8_Z5j/status` (anonymous) → expect `200 {isStreaming:false}`
6. `GET /api/shared/V1StGXR8_Z5j/markdown` (anonymous) → expect `200` with the newly appended `## User` / `## Assistant` pair

### Variations
- Let the turn finish naturally instead of stopping it; step 5 should still flip to `false`.
- Poll `status` for a share whose chat has never streamed → `{isStreaming:false}` from the first call.

### Edge Cases
- Owner revokes the share while streaming → step 3 returns `404 {error:"Not found"}` mid-poll.
- `getShareByIdCached` is a cached read: after `DELETE .../share` the `404` may lag by the cache TTL — treat a stale `200` immediately after revocation as expected cache behavior, not a leak of new content.

---

## STORY-public-surfaces-05: External error tracker triggers a background agent by signed webhook

**Type**: medium
**Persona**: Sentry-style alerting service configured with an Open Agents webhook URL
**Goal**: When a production error fires, have the matching background agent open a run automatically.
**Preconditions**: An authenticated user has created a background agent with a `webhook` trigger; the trigger's `publicId` is known. `BACKGROUND_AGENTS_WEBHOOK_SECRET` is set. Steps 1–2 use the owner cookie to get the `publicId`; the rest are unauthenticated + signed.
**Ideal path**: 1 signed POST — the dispatcher matches triggers, dedupes on `externalId`, and creates the run in a single call.
**Alternate paths**: The same run can be produced by `POST /api/background-agents/{agentId}/test` (authenticated manual dispatch), by `POST /api/github/webhook` with an `issues`/`check_suite` event, or by `GET|POST /api/background-agents/cron`. Four distinct entry points converge on `backgroundAgentRuns` — strong redundancy signal, each with a different auth mode.

### Steps
1. `POST /api/background-agents` (owner cookie) — body: `{"name":"Prod error triage","repoOwner":"dennisonbertram","repoName":"open-agents","prompt":"Investigate the reported production error and propose a fix.","triggers":[{"kind":"webhook"}]}` → expect `201 {agent:{id,...,triggers:[{publicId:"wh_3kf9a2"}]}}`
2. `GET /api/background-agents/{agentId}` (owner cookie) → expect `200`; capture `triggers[0].publicId`
3. `POST /api/background-agents/webhook/wh_3kf9a2` — headers `x-open-agents-signature: $(sign_ba "$BODY")`, `content-type: application/json`; body: `{"externalId":"sentry-issue-4821","repoOwner":"dennisonbertram","repoName":"open-agents","severity":"error","title":"TypeError: cannot read property 'id' of undefined","message":"apps/web/lib/db/sessions.ts:214 in getChatById","url":"https://sentry.io/organizations/acme/issues/4821/","actor":"sentry","occurredAt":"2026-08-02T14:31:00.000Z"}` → expect `200 {enabled:true,matched:1,created:1,duplicates:0,runIds:["run_..."],loopRunIds:[]}`
4. `POST /api/background-agents/webhook/wh_3kf9a2` with the **identical** body and signature → expect `200 {matched:1,created:0,duplicates:1,runIds:[...]}` (dedupe on `externalId`)
5. `GET /api/background-agent-runs/{runId}` (owner cookie) → expect `200` with `status` in `queued|running|succeeded`
6. `GET /api/background-agent-runs/{runId}/stream` (owner cookie, SSE) → expect `200 text/event-stream` with run events

### Variations
- Minimal body `{"externalId":"sentry-issue-4822"}` — every other field is optional; expect `200`.
- `publicId` that exists but whose agent is disabled → `200 {enabled:false,matched:0,created:0,...}` (not an error).
- Repo not on the allowlist → `200 {enabled:true,matched:0,created:0,skipReason:"..."}`.

### Edge Cases
- Missing `x-open-agents-signature` header → `401 {error:"Invalid webhook signature"}`.
- Signature computed with the wrong secret, or prefixed `sha256=` (GitHub style) → `401`; the background webhook expects bare hex and length-mismatched buffers fail before `timingSafeEqual`.
- Correct signature but malformed JSON body → `400 {error:"Invalid JSON payload"}`.
- Valid JSON, missing `externalId` → `400 {error:"Invalid webhook payload"}` (zod).
- Valid JSON with an extra field, e.g. `"projectSlug":"api"` → `400 {error:"Invalid webhook payload"}` — the schema is `.strict()`, so unknown keys are rejected. Real alerting providers send extra fields; this is a compatibility hazard worth flagging.
- `url` that is not a valid URL (`"sentry.io/issues/4821"`) → `400 {error:"Invalid webhook payload"}`.
- Unknown `publicId` with a valid signature → `200` with `matched:0` (no 404 — enumerating public ids is not distinguishable from a disabled agent).
- `BACKGROUND_AGENTS_WEBHOOK_SECRET` unset → `500 {error:"BACKGROUND_AGENTS_WEBHOOK_SECRET is not configured"}` before any signature check.

---

## STORY-public-surfaces-06: GitHub App delivers a PR-closed webhook and the session is archived

**Type**: medium
**Persona**: GitHub App webhook delivery (service-to-service)
**Goal**: When a PR linked to an Open Agents session is merged or closed, mark the session's PR status and archive its sandbox.
**Preconditions**: A session exists with `repoOwner=dennisonbertram`, `repoName=open-agents`, `prNumber=1002`. `GITHUB_WEBHOOK_SECRET` is set.
**Ideal path**: 1 signed POST — the route updates PR status, archives, and fans out to background-agent triggers in one request.
**Alternate paths**: The session PR status is also readable/settable through `GET /api/sessions/{sessionId}/git/pr` and `POST /api/sessions/{sessionId}/git/pr/merge` (authenticated) — the same `sessions.prStatus` field is written by two independent paths.

### Steps
1. `POST /api/github/webhook` — headers `x-github-event: ping`, `x-hub-signature-256: $(sign_gh "$BODY")`; body: `{"zen":"Design for failure.","hook_id":471234567}` → expect `200 {ok:true}`
2. `POST /api/github/webhook` — headers `x-github-event: pull_request`, signed; body: `{"action":"closed","repository":{"name":"open-agents","owner":{"login":"dennisonbertram"}},"pull_request":{"number":1002,"merged":true}}` → expect `200 {ok:true,event:"pull_request",action:"closed",prStatus:"merged",matchedSessions:1,updatedSessions:1,archivedSessions:1}` plus a `backgroundAgents` object when a matching trigger exists
3. `GET /api/sessions/sess_8f21c4` (owner cookie) → expect `200` with `prStatus:"merged"` and `status:"archived"`
4. `POST /api/github/webhook` — headers `x-github-event: pull_request`, signed; body: same but `{"action":"reopened","pull_request":{"number":1002}}` → expect `200 {...,prStatus:"open",matchedSessions:1,updatedSessions:1,archivedSessions:0}`
5. `POST /api/github/webhook` — headers `x-github-event: check_suite`, signed; body: `{"action":"completed","check_suite":{"conclusion":"failure","head_branch":"fix/1000-cron-sweep"},"repository":{"name":"open-agents","owner":{"login":"dennisonbertram"}}}` → expect `200 {ok:true,event:"check_suite",backgroundAgents:{...}}`
6. `POST /api/github/webhook` — headers `x-github-event: check_suite`, signed; body with `"action":"requested"` → expect `200 {ok:true,ignored:true,event:"check_suite"}`

### Variations
- `x-github-event: issues` and `x-github-event: deployment_status` and `x-github-event: pull_request_review` — all route to `dispatchBackgroundTriggerEvent` and return `{ok:true,event,backgroundAgents}`.
- `action:"assigned"` on a `pull_request` event → `200 {ok:true,ignored:true,action:"assigned"}` (only `closed`/`reopened` are handled for sessions).
- `x-github-event: installation` with `action:"created"` → upserts the installation row.
- PR number matching zero sessions → `200 {...,matchedSessions:0,updatedSessions:0,archivedSessions:0}`.
- Repo owner casing differs (`DennisonBertram`) → still matches; the query lowercases both sides.

### Edge Cases
- Missing `x-github-event` or missing `x-hub-signature-256` → `400 {error:"Missing webhook headers"}`.
- Signature present but wrong (or unprefixed hex without `sha256=`) → `401 {error:"Invalid webhook signature"}`.
- Valid signature, body is not JSON → `400 {error:"Invalid JSON payload"}` — note the `ping` short-circuit returns `200` *before* JSON parsing, so a `ping` with a garbage body still succeeds.
- Valid signature, `pull_request` event missing `repository.owner.login` → `400 {error:"Invalid webhook payload"}`.
- `issues` event whose payload the normalizer cannot understand → `400 {error:"Invalid webhook payload"}`.
- `GITHUB_WEBHOOK_SECRET` unset → `500 {error:"GITHUB_WEBHOOK_SECRET is not configured"}`.
- Replay of the exact same signed delivery → processed again; there is no delivery-id dedupe on this route (unlike the background webhook's `externalId` dedupe). Worth flagging.

---

## STORY-public-surfaces-07: Scheduler drives the two cron service endpoints

**Type**: medium
**Persona**: Vercel Cron / external scheduler holding `CRON_SECRET`
**Goal**: Dispatch due background agents and sweep stalled agent-loop runs on a schedule, and confirm both refuse unauthenticated callers.
**Preconditions**: `BACKGROUND_AGENTS_CRON_SECRET` (or `CRON_SECRET`) set. At least one background agent with a `schedule` trigger whose `nextRunAt` is in the past, and at least one agent-loop run stuck in `running` with its latest event older than `AGENT_LOOPS_STALL_MINUTES`.
**Ideal path**: 2 calls — one per subsystem. A single unified sweep endpoint would be 1; the split is a deliberate subsystem boundary, not accidental.
**Alternate paths**: Both endpoints accept **both** `GET` and `POST` with identical behavior (`handleCron`/`handleSweep` ignore the method) — 4 route/method combinations for 2 operations. Both also accept **two** header forms (`Authorization: Bearer` and `x-background-agents-cron-secret`) and share the *same* secret resolver `getBackgroundAgentsCronSecret()`. Manual equivalents exist at `POST /api/background-agents/{agentId}/test` (per agent, authenticated).

### Steps
1. `GET /api/background-agents/cron` with no auth header → expect `401 {error:"Unauthorized"}`
2. `GET /api/background-agents/cron` header `Authorization: Bearer wrong-secret` → expect `401 {error:"Unauthorized"}`
3. `GET /api/background-agents/cron` header `Authorization: Bearer $CRON` → expect `200` with the dispatch result (dispatched/created counts, run ids)
4. `POST /api/background-agents/cron` header `x-background-agents-cron-secret: $CRON` → expect `200` with the same result shape; the due agent from step 3 should now report as already dispatched (no duplicate run for the same window)
5. `GET /api/agent-loops/sweep` with no auth header → expect `401 {error:"Unauthorized"}`
6. `GET /api/agent-loops/sweep` header `Authorization: Bearer $CRON` → expect `200 {stalledCount:1,checkedCount:N}`
7. `POST /api/agent-loops/sweep` header `x-background-agents-cron-secret: $CRON` → expect `200 {stalledCount:0,checkedCount:N}` (the run from step 6 is no longer queued/running)
8. `GET /api/agent-loop-runs/{runId}` (owner cookie) → expect `200` with the run marked stalled/failed

### Variations
- Send `x-request-id: cron-2026-08-02T14:00Z` on step 3; it is threaded into dispatcher logging as the request id.
- Run step 3 with no due agents → `200` with zero counts, not an error.
- Missed-window catch-up: set a persisted `nextRunAt` well in the past and call step 3 once; expect a single catch-up dispatch plus a stale-run sweep with `background-agent.run.swept_stale` evidence.

### Edge Cases
- Neither `CRON_SECRET` nor `BACKGROUND_AGENTS_CRON_SECRET` configured → `500 {error:"CRON_SECRET or BACKGROUND_AGENTS_CRON_SECRET is not configured"}` — returned *before* the auth check, so an unauthenticated caller can distinguish "misconfigured" from "wrong secret".
- Correct secret sent in the wrong header (`x-cron-secret`) → `401`.
- `Authorization: $CRON` without the `Bearer ` prefix → `401` (exact string compare).
- A browser session cookie with no cron secret → `401`; these routes ignore user sessions entirely.

---

## STORY-public-surfaces-08: Signed-out visitor discovers what the app offers before creating an account

**Type**: medium
**Persona**: Prospective user landing on the marketing/app page with no session
**Goal**: See which models the platform supports and whether Verified Build is enabled, then start sign-in — without hitting a wall of 401s.
**Preconditions**: None. No cookie jar.
**Ideal path**: 2 calls — one "who am I / what is configured" call and one sign-in initiation. Today it takes 4 because model list, harness readiness, and auth state live on three separate unauthenticated routes.
**Alternate paths**: `GET /api/auth/info` is the only route that returns `{user: undefined}` with `200` instead of `401` when signed out — every other user-scoped route 401s. Model data is also reachable authenticated via `GET /api/settings/model-variants` and `GET /api/inference-profiles`, so the same catalog is exposed by three endpoints with different shapes.

### Steps
1. `GET /api/auth/info` (no cookie) → expect `200 {user:undefined}` — note: **not** `401`
2. `GET /api/models` (no cookie) → expect `200 {models:[{id:"anthropic/claude-opus-4.6",contextWindow:...},...]}`, header `Cache-Control: private, no-store`
3. `GET /api/harness/ready` (no cookie) → expect `200 {enabled:false,requestId:"..."}` when `HARNESS_ENABLED` is off, or `200` with the upstream readiness payload plus `x-request-id` when on
4. `GET /api/auth/get-session` (no cookie, better-auth handler at `/api/auth/[...all]`) → expect `200 null`
5. `GET /api/sessions` (no cookie) → expect `401` — confirms the boundary: everything outside the public set requires a cookie
6. `GET /api/auth/sign-in/social?provider=github` → expect a `302` redirect to GitHub OAuth

### Variations
- Repeat step 2 after signing in — same payload; the route never reads the session, so an anonymous caller consumes the same AI Gateway quota as a logged-in one. Worth flagging as an abuse surface.
- Send `x-request-id: onboarding-probe-1` to step 3 and assert it is echoed back as `requestId`.

### Edge Cases
- AI Gateway unreachable / `AI_GATEWAY_API_KEY` unset → `GET /api/models` returns `500 {error:"Failed to fetch available models"}`.
- Harness configured but upstream down → `GET /api/harness/ready` returns the mapped harness error response (non-200) with `requestId` preserved.
- `GET /api/auth/info` with a cookie for a user row that has since been deleted → `200 {user:undefined}` (the `userExists` guard), not a 500.
- `GET /api/health` is unaffected by any of the above.

---

## STORY-public-surfaces-09: Caller hits the deprecated and permanently-disabled stubs

**Type**: short
**Persona**: Maintainer of an older integration script written against a previous API version
**Goal**: Find out which endpoints were retired and what replaced them, from the responses alone.
**Preconditions**: A valid session cookie for the routes that check auth before returning their stub status.
**Ideal path**: 3 calls — one per retired route. Ideally these would be discoverable from a single deprecation/index endpoint; none exists.
**Alternate paths**: The replacement for session-level sharing is `POST /api/sessions/{sessionId}/chats/{chatId}/share` (see STORY-public-surfaces-02) and the error body names it explicitly, which is the right pattern. The other two stubs do not name a replacement route.

### Steps
1. `POST /api/sessions/sess_8f21c4/share` (owner cookie) — body: none → expect `410 {error:"Session-level sharing is deprecated. Use /api/sessions/:sessionId/chats/:chatId/share."}`
2. `DELETE /api/sessions/sess_8f21c4/share` (owner cookie) → expect `410` with the same message
3. `GET /api/vercel/projects/prj_9aQ2xLm/env` (no cookie) → expect `404 {error:"Not found"}`, header `Cache-Control: no-store` — a permanent stub that returns 404 regardless of the project id or auth state
4. `POST /api/github/create-repo` (owner cookie) — body: `{"name":"open-agents-playground","private":true}` → expect `501 {error:"Creating repositories from Open Agents is temporarily disabled. Create the repository on GitHub first, then connect it to a session."}`
5. `POST /api/github/create-repo` (no cookie) — body: `{"name":"open-agents-playground"}` → expect `401 {error:"Not authenticated"}` — auth is still enforced ahead of the disabled stub

### Variations
- Step 1 with a session id the caller does not own → still `410`; the deprecated handlers do no auth or ownership check at all, so they leak nothing but also validate nothing.
- Step 3 with a nonsense project id → identical `404`.

### Edge Cases
- `POST /api/github/create-repo` (owner cookie) with a non-JSON body → `400 {error:"Invalid JSON body"}` — the body is parsed and discarded before the `501`, so validation-failure ranks above the disabled status.
- `GET /api/sessions/{sessionId}/share` → `405` (only POST and DELETE are exported).

---

## STORY-public-surfaces-10: Dev-only test-auth surface must be invisible in production

**Type**: short
**Persona**: Release operator verifying that a dev backdoor is not exposed on a deployed environment
**Goal**: Confirm `/api/dev/managed-runtime-demo` 404s unless test auth is explicitly enabled, and that when enabled it sets a test-auth cookie.
**Preconditions**: Two environments to compare, or the ability to toggle the test-auth flag locally.
**Ideal path**: 1 call per environment — `isTestAuthEnabled()` is the only gate.
**Alternate paths**: none found — this is the only route that mints a test-auth cookie.

### Steps
1. `GET /api/dev/managed-runtime-demo` against an environment with test auth disabled → expect `404 {error:"Not found"}` and **no** `Set-Cookie` header
2. `GET /api/dev/managed-runtime-demo` locally with test auth enabled → expect `200` with the demo payload and a `Set-Cookie` carrying the test-auth cookie
3. `GET /api/dev/managed-runtime-demo?profileId=mrp_node22` (test auth enabled) → expect `200` with the demo scoped to that profile
4. `GET /api/auth/info` reusing the cookie jar from step 2 → expect `200` with a populated `user`, proving the cookie is a real session

### Variations
- Step 3 with a `profileId` belonging to another user.

### Edge Cases
- Unknown `profileId` or a failure inside `prepareManagedRuntimeDemo` → `500 {error:"<message>"}`.
- The 404 in step 1 is indistinguishable from a route that does not exist — intended, and the correct behavior to assert in a production smoke.

---

## STORY-public-surfaces-11: Full public-surface sweep for a security review

**Type**: long
**Persona**: Security engineer auditing every route reachable without a session cookie
**Goal**: Enumerate the unauthenticated attack surface, confirm each route's failure mode, and confirm nothing outside the known public set answers without a cookie.
**Preconditions**: A `shareId` from STORY-public-surfaces-02 and a background-agent webhook `publicId` from STORY-public-surfaces-05. All service secrets available so both authorized and unauthorized variants can be exercised.
**Ideal path**: ~12 calls — one per public route plus one negative probe per auth mode. There is no machine-readable route manifest, so the list has to be maintained by hand against the filesystem; that is the friction being recorded.
**Alternate paths**: `GET /api/health`, `GET /api/models`, `GET /api/harness/ready`, and `GET /api/auth/info` all serve as "is it up" probes without auth — four overlapping liveness surfaces.

### Steps
1. `GET /api/health` → `200` or `503`, JSON with `status`, `rateLimitBackend`, `redisConfigured`
2. `GET /api/models` → `200 {models:[...]}` — confirm no user-identifying data in the payload
3. `GET /api/harness/ready` → `200`, capture `requestId`
4. `GET /api/auth/info` → `200 {user:undefined}`
5. `GET /api/shared/V1StGXR8_Z5j/status` → `200 {isStreaming:false}`
6. `GET /api/shared/V1StGXR8_Z5j/markdown` → `200 text/plain`; grep the body for `POSTGRES_URL`, `sk-`, `ghp_`, `Bearer ` — expect no hits
7. `GET /api/shared/aaaaaaaaaaaa/markdown` → `404` (share-id enumeration returns a uniform 404 with no timing-distinct branch)
8. `GET /api/vercel/projects/prj_9aQ2xLm/env` → `404 {error:"Not found"}`
9. `POST /api/github/webhook` with no headers → `400 {error:"Missing webhook headers"}`
10. `POST /api/github/webhook` header `x-github-event: ping` + `x-hub-signature-256: sha256=deadbeef` → `401 {error:"Invalid webhook signature"}`
11. `POST /api/background-agents/webhook/wh_3kf9a2` with no signature header — body: `{"externalId":"probe-1"}` → `401 {error:"Invalid webhook signature"}`
12. `GET /api/background-agents/cron` with no auth → `401 {error:"Unauthorized"}`
13. `GET /api/agent-loops/sweep` with no auth → `401 {error:"Unauthorized"}`
14. `GET /api/dev/managed-runtime-demo` → `404 {error:"Not found"}` (expected on any non-dev environment)
15. `GET /api/sessions` with no cookie → `401`
16. `GET /api/settings/preferences` with no cookie → `401`
17. `GET /api/background-agents` with no cookie → `401`
18. `GET /api/harness/runs` with no cookie → `401`
19. `GET /api/gtm/brief` with no cookie → `401`
20. `GET /api/account/status` with no cookie → `401`
21. `GET /api/usage` with no cookie → `401`
22. `GET /api/github/branches?owner=vercel&repo=next.js` with no cookie → `401 {error:"GitHub not connected"}` — despite the route having a full unauthenticated GitHub fallback path internally (`fetchPublicGitHubBranches`), the handler 401s before reaching it. Dead public code path worth flagging.

### Variations
- Repeat steps 1–8 with `Origin: https://evil.example` to confirm no permissive CORS headers are returned.
- Repeat step 6 with `Accept: text/markdown` and confirm `vary: Accept` is set so a shared cache cannot serve the wrong content type.
- Run the whole sweep against a preview deployment and diff the status codes against local.

### Edge Cases
- Any route in steps 15–21 answering `200` without a cookie is a finding.
- Step 22 answering `200` would mean the unauthenticated GitHub fallback became reachable — also a finding, in the opposite direction.
- Steps 12–13 returning `500` instead of `401` means the cron secret is unset on that environment; the misconfiguration is observable to an unauthenticated caller.
- Step 3 returning a non-200 harness error leaks upstream harness state to anonymous callers; confirm the body carries no tenant or project identifiers beyond what is already public.

---

## STORY-public-surfaces-12: Signed webhook drives a full unattended agent run, end to end

**Type**: long
**Persona**: On-call engineer whose alerting stack is wired to Open Agents; they only intervene at the approval gate
**Goal**: Have a production alert fan out into an automated triage run, watch it, approve the gated step, and read the result — with the only unauthenticated actor being the alerting service.
**Preconditions**: Owner session cookie; repo `dennisonbertram/open-agents` on the background-agent allowlist; `BACKGROUND_AGENTS_WEBHOOK_SECRET` and `BACKGROUND_AGENTS_CRON_SECRET` set. This is the multi-turn story for this topic: multiple inbound webhook deliveries, tool-grant preflight, an approval, and a follow-up turn.
**Ideal path**: ~10 calls — create agent, preflight grants, one signed webhook, stream, approve, read outputs. The extra calls below come from readiness/preflight and dedupe verification being separate endpoints.
**Alternate paths**: The run in step 6 could equally be created by `POST /api/background-agents/{agentId}/test`, by the cron endpoint, or by a `POST /api/github/webhook` `issues` delivery — four convergent triggers. Run state is readable from `GET /api/background-agent-runs/{runId}`, from `GET /api/background-agent-runs?agentId=...`, and from the SSE stream — the same run row surfaced three ways.

### Steps
1. `GET /api/background-agents/readiness` (owner cookie) → expect `200` describing whether the repo allowlist and tool grants are satisfied
2. `POST /api/background-agents` (owner cookie) — body: `{"name":"Prod alert triage","repoOwner":"dennisonbertram","repoName":"open-agents","prompt":"Reproduce the reported error, find the root cause, and post a summary with the failing file and line.","triggers":[{"kind":"webhook"}]}` → expect `201`; capture `agentId` and `triggers[0].publicId`
3. `POST /api/background-agents/{agentId}/tool-preflight` (owner cookie) — body: `{"tools":["bash","read_file","edit_file"]}` → expect `200` with grant status per tool
4. `GET /api/background-agents/{agentId}/status` (owner cookie) → expect `200` with the agent enabled and no blocking reason
5. `POST /api/background-agents/{agentId}/test` (owner cookie) — body: `{"externalId":"manual-smoke-1"}` → expect `200/201` with a run id; confirms the pipeline works before wiring the alerting service
6. `POST /api/background-agents/webhook/{publicId}` — signed with `sign_ba`; body: `{"externalId":"pagerduty-inc-90412","repoOwner":"dennisonbertram","repoName":"open-agents","severity":"critical","title":"500s on /api/sessions after deploy 86731ae","message":"getChatById threw TypeError for 3.2% of requests","url":"https://acme.pagerduty.com/incidents/PQ90412","actor":"pagerduty","occurredAt":"2026-08-02T09:12:00.000Z"}` → expect `200 {enabled:true,matched:1,created:1,duplicates:0,runIds:["run_x"],loopRunIds:[]}`
7. `GET /api/background-agent-runs/run_x/stream` (owner cookie, SSE) → expect `200 text/event-stream`; observe `queued → running` and tool-call events
8. `POST /api/background-agents/webhook/{publicId}` — identical signed body (alerting service retry) → expect `200 {created:0,duplicates:1}`; assert no second run id appears
9. `POST /api/background-agents/webhook/{publicId}` — signed; body: `{"externalId":"pagerduty-inc-90413","severity":"critical","title":"Follow-up: same trace after rollback","message":"Still failing on the previous release"}` → expect `200 {created:1}` with a **new** run id (different `externalId`, second turn of the incident)
10. `GET /api/background-agent-runs?agentId={agentId}` (owner cookie) → expect `200` listing both runs
11. `GET /api/background-agent-runs/run_x` (owner cookie) → expect `200` with events and any pending approval marker
12. `POST /api/harness/runs/{harnessRunId}/approve` (owner cookie) — body: `{"decision":"approve","note":"Root cause confirmed, allow the patch step"}` → expect `200` (only when the agent's work escalated to a gated harness run)
13. `GET /api/background-agent-runs/run_x` (owner cookie) → expect `200` with `status:"succeeded"`
14. `GET /api/agent-loops/sweep` header `Authorization: Bearer $CRON` → expect `200 {stalledCount:0,checkedCount:N}` — nothing stalled after a clean run
15. `GET /api/background-agents/cron` header `Authorization: Bearer $CRON` → expect `200`; a webhook-only agent has no schedule trigger, so it must not be dispatched again here
16. `PATCH /api/background-agents/{agentId}` (owner cookie) — body: `{"enabled":false}` → expect `200`
17. `POST /api/background-agents/webhook/{publicId}` — signed; body: `{"externalId":"pagerduty-inc-90414","title":"Post-disable probe"}` → expect `200 {enabled:false,matched:0,created:0,runIds:[]}`
18. `DELETE /api/background-agents/{agentId}` (owner cookie) → expect `200`
19. `POST /api/background-agents/webhook/{publicId}` — signed; body: `{"externalId":"pagerduty-inc-90415"}` → expect `200 {matched:0,created:0}` (deleted agent behaves like an unknown publicId — no 404)

### Variations
- Between steps 7 and 11, `POST /api/background-agent-runs/{runId}/cancel`-equivalent control (see the background-agents topic) and confirm the sweep in step 14 does not re-open it.
- Deliver step 6 through `POST /api/github/webhook` with an `issues` event instead and compare the resulting run's trigger attribution.
- Let the run stall (kill the sandbox mid-run), then run step 14 and expect `stalledCount:1`.

### Edge Cases
- Step 6 with the signature computed over a re-serialized body rather than the exact bytes sent → `401`; the route signs `req.text()`, so any whitespace difference breaks verification.
- Step 6 with an alerting provider that appends its own metadata field → `400 {error:"Invalid webhook payload"}` from the `.strict()` schema.
- Step 12 approving a run the caller does not own → `403/404` from the harness ownership check.
- Step 15 with the cron secret sent as `x-background-agents-cron-secret` instead of `Authorization` → identical `200`; both header forms are accepted.
- Steps 17 and 19 both return `200` with zero counts — a disabled agent, a deleted agent, and a never-existing `publicId` are externally indistinguishable. Intentional (no enumeration oracle) but it means an alerting service cannot detect a broken wiring from the response.

---

## Cross-cutting observations

- **Four convergent trigger paths** create `backgroundAgentRuns`: signed background webhook, signed GitHub webhook, cron secret endpoint, and authenticated manual test. Each uses a different auth scheme.
- **Two webhook signature conventions** in the same codebase: GitHub's `sha256=<hex>` and Open Agents' bare `<hex>`.
- **Two cron endpoints, four method/route combinations, two accepted header names, one shared secret** (`getBackgroundAgentsCronSecret`) for what are two operations.
- **Four unauthenticated liveness-ish probes**: `/api/health`, `/api/models`, `/api/harness/ready`, `/api/auth/info`.
- **`shareId` is returned identically** by `POST` and `GET` on `/api/sessions/{sessionId}/chats/{chatId}/share`.
- **Misconfiguration is observable to anonymous callers**: the cron and webhook routes return `500 "<VAR> is not configured"` before checking auth.
- **Dead public code path**: `fetchPublicGitHubBranches` in `/api/github/branches` implements a full unauthenticated fallback that the handler's leading `401` makes unreachable.
- **`/api/models` is unmetered and unauthenticated**, yet calls the AI Gateway on every request.
- **Error content types disagree** across the two public share routes: `markdown` returns plain-text `Not found\n`, `status` returns JSON `{error:"Not found"}`.
