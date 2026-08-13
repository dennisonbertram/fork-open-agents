# Testing & Observability on Cloudflare (Agents SDK + Durable Objects + Workflows + Sandbox SDK + MCP) — research as of 2026-08-11

All facts below were fetched live on **2026-08-11** unless a different "reported" date is given for a
changelog/blog item. Every claim is tagged **[official]** (developers.cloudflare.com, cloudflare GitHub
org, npm registry), **[vendor-blog]** (blog.cloudflare.com / cloudflare changelog posts), or
**[community]** (third-party benchmarks, forum posts). Anything I could not pin to a source is marked
**UNVERIFIED**.

## TL;DR

- `@cloudflare/vitest-pool-workers` (current npm version **0.21.1**, published 2026-08-11) runs real
  `workerd` locally and now has first-class **introspection APIs for Workflows**
  (`introspectWorkflowInstance`/`introspectWorkflow`, shipped in v0.9.0+, Nov 2025) and for **Durable
  Objects** (`runInDurableObject`, `runDurableObjectAlarm`, `listDurableObjectIds`) — this is a much
  richer story than "just Miniflare with mocks." Queues also run locally and are covered by test APIs.
  **Containers/Sandbox SDK are not part of vitest-pool-workers at all** — they only run under
  `wrangler dev`, require a local Docker engine, and have real, documented local/production behavior
  gaps (S3-FUSE mount, egress interception).
- The single sharpest boundary for the M0 harness: **anything involving a container (Sandbox SDK) needs
  a real `wrangler dev` + Docker process, not vitest-pool-workers**, and several Sandbox SDK features
  (live FUSE bucket mount, exact TLS-interception CA behavior) are demonstrably different locally vs.
  deployed. DO hibernation/eviction timing (10s hibernate / 70–140s evict, **[official]**) and container
  cold-start latency (community-measured median 10.5s / p95 15.6s on Cloudflare Containers vs 3.4s/4.1s
  on AWS microVMs, **[community]**) are real-world behaviors no local test can reproduce faithfully.
- Observability is uneven across the stack: Workers has mature Logs + open-beta automatic OTel tracing;
  Durable Objects and Workflows have GraphQL/dashboard metrics but **no first-party distributed trace
  propagation between them**; Sandbox SDK container stdout/stderr forwarding to Workers Observability
  was a real gap that was closed by an April 2026 change (GitHub issue, closed "completed" 2026-04-01)
  — verify this actually reached your SDK version, don't assume. **There is no first-party trace/run-id
  propagation across Worker → DO → Workflow → container exec → model call** — the app must carry a
  correlation id end to end and log it at every hop; this matches the founder's "app-level ledger"
  instinct.
- AI Gateway and Workers AI unified on **2026-08-07** (4 days before this research) under `env.AI`; a
  `"default"` gateway now auto-creates on first request with full-payload logging, token counts, and
  cost attribution with zero setup — this is new enough that docs/tutorials may still describe the old
  two-product model.
- MCP: `createMcpHandler` is documented as **stateless** and pairs with
  `@cloudflare/workers-oauth-provider` (current npm **0.10.3**). The MCP spec revision **2026-07-28**
  (11 days before this research) **deprecates Dynamic Client Registration** in favor of Client ID
  Metadata Documents (CIMD), with DCR kept only as a fallback and targeted for removal "summer 2027"
  **[vendor-blog, Cloudflare 2026-08-06]**. The product context's "OAuth 2.1 + PKCE + DCR" phrasing is
  already slightly behind the spec Cloudflare's own SDK just adopted — flag this for the founder.

---

## Status / maturity (dated)

| Component | Status (as of 2026-08-11) | Evidence |
|---|---|---|
| `@cloudflare/vitest-pool-workers` | Active, npm `0.21.1`, last publish **2026-08-11** (today) | npm registry [official] |
| Workflows test-introspection APIs | Shipped `@cloudflare/vitest-pool-workers` **≥0.9.0**, announced 2025-11-04 | blog.cloudflare.com/better-testing-for-workflows/ [vendor-blog] |
| Workers automatic tracing (OTel export) | **Open beta**, announced 2025-11-07; free during beta, "pricing starting" was flagged for Jan 15 2025 in the original beta doc (predates this beta announcement — treat that pricing date as stale/superseded, not confirmed for the current beta) | developers.cloudflare.com/workers/observability/traces/ ; changelog 2025-11-07 [official] |
| Sandbox SDK / Containers | **GA** 2026-04-13 (`blog.cloudflare.com/sandbox-ga/`, SDK was v0.8.9 at GA); npm `@cloudflare/sandbox` now **0.12.5** (2026-08-07); a **1.0 preview** shipped under the `@next` npm tag on 2026-08-07 with a new RPC-only transport (breaking) | [vendor-blog] + [official npm/changelog] |
| Sandbox outbound credential injection / TLS interception | Shipped **2026-04-13** (`outboundByHost`, `setOutboundHandler`, `interceptHttps`) | developers.cloudflare.com/changelog/post/2026-04-13-sandbox-outbound-workers-tls-auth/ [official] |
| Container stdout/stderr → Workers Observability | Was an open gap (GitHub issue filed 2026-03-21); **closed "completed" 2026-04-01** | github.com/cloudflare/workers-sdk#12998 [official/GitHub] — I could not find the merged PR number or a changelog entry naming the shipped mechanism; treat "fixed" as directionally true but **UNVERIFIED which SDK version carries the fix** |
| Workers AI / AI Gateway unification (`env.AI`) | **Shipped 2026-08-07** (4 days before this research) | developers.cloudflare.com/changelog/post/2026-08-07-workers-ai-unified-billing/ [official] |
| MCP spec 2026-07-28 / DCR→CIMD | Cloudflare's `workers-oauth-provider` updated for it, blog dated **2026-08-06** | blog.cloudflare.com/mcp-v2/ [vendor-blog] |
| Cloudflare Agents SDK | npm `agents` **0.20.1**, last publish 2026-07-28 | npm registry [official] |
| `@cloudflare/workers-oauth-provider` | npm **0.10.3**, last publish 2026-08-10 (1 day before this research) | npm registry [official] |
| Workflows per-step/storage billing | Announced 2026-07-07, **billing starts no earlier than 2026-08-10** — i.e., may already be live as of this research date | developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/ [official] |

---

## Testing: local-vs-deployed capability matrix

| Primitive | Runs in `vitest-pool-workers` (real `workerd`)? | Runs in `wrangler dev` (local)? | `wrangler dev --remote`? | Deploy-only behaviors |
|---|---|---|---|---|
| **Durable Objects (core RPC/storage)** | Yes — real `workerd` DO instances, real SQLite storage engine (`ctx.storage.sql.exec()` works) [official: developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects] | Yes | Supported for DO as a binding in some configs (not verified in this pass — see Open Questions) | Global uniqueness edge case: an object can become "outdated" mid-execution if a colocated instance appears elsewhere during a no-storage-access window [official: durable-objects/platform/known-issues] |
| **DO alarms** | Yes, via `runDurableObjectAlarm(stub)` — force-fires an alarm without waiting [official: workers/testing/vitest-integration/test-apis] | Yes, but **"Durable Object alarm methods may fail after a hot reload"**; workaround is to restart `wrangler dev` [official: durable-objects/platform/known-issues] | n/a | Real wake-latency and at-least-once retry timing only exist deployed |
| **DO hibernation / eviction timing** | Not timing-accurate — you can force-trigger, but you cannot observe the real 10s-hibernate / 70–140s-evict clock in a test | Prior to `wrangler@3.13.2`/Miniflare `v3.20231016.0`, WebSockets **did not hibernate locally at all** and the DO was never evicted from memory; fixed in that release train [community, GitHub cloudflare/cloudflare-docs#19856 discussion] | — | **Confirmed only in production**: hibernates after **10 seconds** of no incoming request/event; evicted from memory after **70–140 seconds** of inactivity while idle/non-hibernateable [official: durable-objects/concepts/durable-object-lifecycle] |
| **Workflows** | Yes — `introspectWorkflowInstance()` / `introspectWorkflow()` from `cloudflare:test`, with `disableSleeps()`, `mockStepResult()`, `mockEvent()` (satisfies `step.waitForEvent()`), `forceStepTimeout()`, and `waitForStatus()`/`getOutput()`/`getError()` for assertions — this is a real, deterministic, offline test surface, not a mock shim [official: workers/testing/vitest-integration/test-apis; blog.cloudflare.com/better-testing-for-workflows/ 2025-11-04] | Yes — Wrangler runs "**an emulated version of Workflows** compared to the one Cloudflare runs globally" [official: workflows/build/local-development], with a Local Explorer UI, and instance `pause()/resume()/restart()/terminate()` | **Not supported** — "Workflows are not supported as remote bindings or when using `npx wrangler dev --remote`" [official: workflows/build/local-development] | Real cross-region durability, real retry backoff timing, real multi-day `sleep()` behavior. One community-reported flake: `vitest-pool-workers` running Workflow tests unreliably in CI (GitLab) with a `resolveId` timeout — filed Sept 2025, closed Mar 2026; treat as **resolved but historically real** [GitHub cloudflare/workers-sdk#10600] |
| **Queues** | Yes — `createMessageBatch()` / `getQueueResult()` test helpers exist [official: workers/testing/vitest-integration/test-apis] | Yes, simulated via Miniflare [official: queues/configuration/local-development] | **Not supported** in remote mode [official/community synthesis via developers.cloudflare.com/workers/local-development/bindings-per-env] | Real cross-consumer ordering/concurrency at scale |
| **Containers / Sandbox SDK** | **Not covered by vitest-pool-workers at all.** No known Miniflare/workerd simulation of a container exists; this must be exercised via `wrangler dev` + a real local Docker (or Docker-compatible) engine | Yes, with caveats: requires "a Docker compatible CLI tool and Engine" (Docker Desktop, Colima); Worker code hot-reloads, **container code does not** — you must manually rebuild (press `[r]`); ports need explicit `EXPOSE` in the Dockerfile; local concurrency is capped by your machine, and `max_instances` config **does not apply locally** [official: containers/local-dev] | Not evaluated in this pass — Containers are a compute primitive, not a bindable resource in the KV/R2 sense; treat as **UNVERIFIED for `--remote`** | See Sandbox SDK row below |
| **Sandbox SDK — S3/R2 `mountBucket()` (live FUSE mount)** | n/a (container-only) | **Different mechanism, not full parity**: local dev uses `localBucket: true` + **periodic sync** with the R2 binding, not a live mount — "files are synchronized between R2 and the container using a periodic sync process rather than a direct filesystem mount," so there **is** sync delay locally [official: developers.cloudflare.com/sandbox/guides/mount-buckets/] | — | **Production uses a direct FUSE filesystem mount with no synchronization delay** [official, same page]. This confirms and refines the prior research finding: FUSE live-mount is deploy-only; local dev approximates it, it does not replicate it. |
| **Sandbox SDK — backup/restore from R2** | n/a | **No FUSE required locally** — local restore extracts the archive with `unsquashfs`; the restored directory **replaces** the target rather than layering copy-on-write [official: developers.cloudflare.com/sandbox/guides/backup-restore/] | — | Production restore mounts the backup as a **read-only FUSE overlayfs lower layer** (true copy-on-write) [official, same page] |
| **Sandbox SDK — HTTPS interception / `outboundByHost` credential injection** | n/a | **Revises the prior research assumption** — `wrangler dev` now spawns a sidecar inside the sandbox's network namespace that applies TPROXY rules to route matching traffic to the local `workerd` instance, "**mirroring production behavior**," and an ephemeral CA is written to `/etc/cloudflare/certs/cloudflare-containers-ca.crt` when `interceptHttps=true` **and** an outbound/`outboundByHost` handler is defined [official: developers.cloudflare.com/sandbox/guides/outbound-traffic/]. I could **not** find current doc language stating HTTPS interception is HTTP-only or deploy-only — this looks like it changed with the 2026-04-13 credential-injection/TLS-interception release. **Do not carry forward "local dev is HTTP-only interception" as current fact without re-verifying against your exact SDK version** — see Open Questions. | — | Real per-instance ephemeral CA issuance and the full zero-trust credential path only exist deployed; local sidecar approximates it |
| **Sandbox SDK — `enableInternet=false`** | n/a | No explicit local-dev caveat found; documented behavior ("traffic on ports other than 80/443 denied when `enableInternet=false`") reads as environment-agnostic in current docs | — | UNVERIFIED whether enforcement differs local vs. deployed — flagged, not confirmed either way |

### `wrangler dev` local vs. remote mode, generally

- Local mode (`wrangler dev`, default) simulates bindings via Miniflare/workerd. Remote mode
  (`wrangler dev --remote`) proxies to real Cloudflare-hosted resources for bindings that support it.
- Confirmed **not supported in `--remote`**: Workflows [official], Queues [official/community].
- A newer "**remote bindings**" feature (Wrangler ≥ v4.37.0, and in `@cloudflare/vitest-pool-workers`)
  lets *local* dev/test runs talk to *real* remote resources for supported binding types — this is a
  different mechanism from `--remote` mode and is the more promising lever for "test against a real
  deployed dependency without deploying your own Worker" [community-sourced via GitHub
  cloudflare/workers-sdk discussion #9660 — **UNVERIFIED against official docs page**, did not
  directly fetch a first-party page confirming exact binding coverage].

### Testing against a real deployed dev/staging environment

- **`wrangler versions upload`** (Wrangler ≥ v3.40.0) uploads a new Worker version without promoting
  traffic to it, and **returns a preview URL** per version for testing before rollout; `wrangler
  versions deploy` then does percentage-based gradual rollout [official, synthesized from
  developers.cloudflare.com/workers/versions-and-deployments/ and
  .../configuration/versions-and-deployments/gradual-deployments/ — **fetched via search summary, not
  direct WebFetch**; treat page-level wording as community-paraphrased, re-verify quotes before citing
  verbatim in a spec].
- **Per-environment Worker + resource isolation**: `wrangler.toml` `[env.<NAME>]` sections deploy a
  separate Worker (e.g. `my-worker-staging`) with its own bindings [official:
  developers.cloudflare.com/workers/wrangler/environments/]. The doc I fetched does **not** show
  built-in DO-namespace-per-environment or R2-bucket-per-environment isolation as an out-of-the-box
  feature — you construct that yourself by giving each `[env]` its own binding IDs/bucket names in
  config, the same way this repo already isolates `POSTGRES_URL` per Vercel environment. Treat
  "environment isolation" here as **your responsibility to configure explicitly**, not a platform
  default — this is exactly the class of mistake this repo's own `CLAUDE.md` already flags for Neon
  branches.
- No first-party "per-branch preview Worker" product was found equivalent to Vercel preview
  deployments; the closest analogues are (a) `wrangler versions upload` preview URLs, and (b) hand-rolled
  `[env.pr-N]` sections driven from CI. **UNVERIFIED**: whether Cloudflare has since shipped a
  Vercel-preview-style automatic per-PR deployment product — worth a follow-up search focused
  specifically on "Workers Builds" (native CI product mentioned in passing at
  developers.cloudflare.com/workers/ci-cd/builds/, not explored in depth this pass).

---

## Observability, per primitive

### Workers (the platform layer under everything)

- **Workers Logs**: dashboard-native log ingestion. Retention **3 days (Free)**, **7 days (Paid)**;
  event volume **200,000/day (Free)**, **20M/month included then $0.60/additional million (Paid)**,
  account-wide cap **5 billion/day** [official: developers.cloudflare.com/workers/observability/logs/workers-logs/].
  Captures request/response metadata plus whatever you explicitly emit via `console.log()` — it is
  **not** automatic full-body capture; structured JSON output is the documented best practice for
  filtering.
- **Logpush**: separate mechanism to push Workers Trace Event Logs to R2, S3, or third-party logging
  destinations, for retention beyond the dashboard's window [official:
  developers.cloudflare.com/workers/observability/].
- **Automatic tracing (OpenTelemetry)**: **open beta**, announced 2025-11-07 [vendor-blog:
  blog.cloudflare.com/workers-tracing-now-in-open-beta/]. Instruments every I/O operation in `workerd`
  automatically — KV, R2, Durable Objects, `fetch`, handler calls — with **no manual SDK
  instrumentation**, and exports OTLP-formatted traces+logs (sharing trace IDs) to Grafana, Sentry,
  Honeycomb, Axiom, etc. Known limitations, quoted directly [official:
  developers.cloudflare.com/workers/observability/traces/known-limitations/]:
  - "Non-I/O operations may report time of 0 ms" (Spectre-mitigation side effect of the runtime's timer
    resolution).
  - "**Trace IDs are not propagated to services outside of Cloudflare.**" (Directly relevant to the
    founder's cross-hop trace-id question — see Trace Correlation below.)
  - Span/attribute naming "not yet finalized" during beta.
  - In-progress traces show "Trace in Progress" until the root span completes.
  - The known-limitations page as fetched does **not** mention Durable Objects, Workflows, or
    Containers explicitly as excluded/included — treat DO/Workflow/container span coverage as
    **UNVERIFIED**, not confirmed either way.
- **Analytics Engine** (`env.ANALYTICS.writeDataPoint({ blobs, doubles, indexes })`): a generic
  fire-and-forget custom-metrics binding (no `await`, no ack) usable from any Worker or DO to emit
  arbitrary structured events, queried via a SQL dialect over the GraphQL/HTTP API [community
  synthesis of blog.cloudflare.com/workers-analytics-engine/ and
  developers.cloudflare.com/durable-objects/observability/graphql-analytics — **not directly
  WebFetched**, treat exact API shape as needing a direct doc check before implementation].

### Durable Objects

- Four GraphQL Analytics datasets exist: `durableObjectsInvocationsAdaptiveGroups`,
  `durableObjectsPeriodicGroups`, `durableObjectsStorageGroups`,
  `durableObjectsSubrequestsAdaptiveGroups` [official:
  developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/]. Available fields
  include request counts, CPU time, memory usage (P50/P90/P99/P999 as `memoryUsageBytes`), stored bytes
  (`storedBytes`), response size, and subrequests. **WebSocket metrics land in the invocations dataset
  only once the connection closes**; hibernated-connection messages land in invocations groups, not
  periodic groups. **No retention period was stated on this page** — it points at the general Workers
  Logs retention doc, which is a different (shorter, 3/7-day) window; do not assume Analytics-dataset
  retention equals Logs retention without checking directly. **No alarms metric and no per-DO error
  metric were found documented** on this page — alarm success/failure visibility appears to rely on
  your own `console.log`/tracing instrumentation inside `alarm()`, not a platform-provided dataset.
- Lifecycle timing is documented precisely and is directly useful for the M0 harness's "what can only
  be observed deployed" list: **hibernates after 10 seconds** of no incoming request/event; **evicted
  from memory after 70–140 seconds** of inactivity while idle and non-hibernateable [official:
  developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/].

### Workflows

- Dashboard + GraphQL Analytics (`workflowsAdaptiveGroups` dataset) expose per-workflow / per-instance /
  per-step / per-event-type metrics, filterable by minute/5-min/15-min/hour granularity. **Metrics are
  retained for 31 days** [official: developers.cloudflare.com/workflows/observability/metrics-analytics/].
  I was only able to confirm one concretely-named metric field ("number of read queries issued against
  a database") from the fetched excerpt — the dimension list (workflow name, instance ID, step name,
  event type) is confirmed, but the **full metric field list is UNVERIFIED**; re-fetch this page
  directly (not via summarizer) before building dashboards against it.
- Local Explorer UI + `pause()/resume()/restart()/terminate()` work in local dev [official:
  developers.cloudflare.com/workflows/build/local-development/], giving you real step-by-step
  introspection without deploying — this plus the `cloudflare:test` introspection APIs (above) is
  probably sufficient for M0's Workflow-level assertions without needing a deployed environment for
  most cases.

### Sandbox SDK / Containers

- **Container stdout/stderr → Workers Observability was a documented gap** (filed as GitHub issue
  #12998 against `cloudflare/workers-sdk`, 2026-03-21): "`observability.logs.enabled: true` in
  container config captures Sandbox **runtime** logs, but not stdout/stderr from **user processes**";
  `process.getLogs()` was a point-in-time snapshot only, no streaming, no cursor/offset. The issue was
  **closed "completed" on 2026-04-01**, implying the automatic-forwarding request was fulfilled — but I
  could not find the specific changelog entry or PR describing exactly what shipped, so **treat "fixed"
  as directionally credible from the closure reason, not independently confirmed** — a harness build
  should write a probe that starts a container process, emits known stdout, and asserts it shows up in
  Workers Observability logs/`wrangler tail` before relying on this.
- `process.streamProcessLogs(process.id)` exists as a real-time streaming API for
  processes started via the Sandbox SDK [community search synthesis of
  developers.cloudflare.com/sandbox/guides/streaming-output/ — not directly WebFetched, re-verify exact
  method name/signature before coding against it].
- No first-party resource-metrics API (CPU/memory time series per container instance) was located in
  this pass — **UNVERIFIED**, worth a targeted follow-up on `developers.cloudflare.com/containers/`
  observability/metrics pages specifically (the generic Containers pricing model bills per-10ms of
  active vCPU/memory/disk, which implies the platform tracks this internally, but a queryable API for
  it was not confirmed).

### AI Gateway (post-unification, 2026-08-07)

- `env.AI.run()` now calls both Workers AI-hosted models and supported third-party providers through
  the same binding [official: developers.cloudflare.com/changelog/post/2026-08-07-workers-ai-unified-billing/].
- Passing `"default"` as the gateway ID **auto-creates the gateway on first authenticated request**,
  and from that point every request is logged with **full request and response payloads, per-model
  token counts, and cost attribution — with zero dashboard setup** [official, same changelog].
- AI Gateway observability index page confirms: costs, user insights, custom metadata, OpenTelemetry
  integration, analytics, logging [official: developers.cloudflare.com/ai-gateway/observability/] — I
  did **not** get to the individual OTel/logging sub-pages to confirm exact trace-header names or log
  export destinations; **UNVERIFIED at the field level**.
- Anthropic via AI Gateway: base endpoint
  `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`; supports either
  pass-through `x-api-key` (your own Anthropic key) or **BYOK/Unified Billing** via
  `cf-aig-authorization` — with an explicit documented gotcha: **"do not set `x-api-key` in
  `defaultHeaders`... AI Gateway supplies the Anthropic key for you"** when using BYOK, or the request
  fails [official: developers.cloudflare.com/ai-gateway/providers/anthropic/]. There is also an
  OpenAI-compatible endpoint (`.../ai/v1/chat/completions` with `"model": "anthropic/{model}"`).

---

## Trace correlation across Worker → DO → Workflow → container exec → model call

**Direct finding, stated plainly: there is no confirmed first-party mechanism that automatically
propagates a single trace/run ID across this entire chain.**

What exists, per hop:

- Workers automatic tracing instruments Worker-internal I/O (KV, R2, DO calls, `fetch`) and shares a
  trace ID between OTLP traces and OTLP logs **within Cloudflare's own boundary** — but the docs state
  explicitly: **"Trace IDs are not propagated to services outside of Cloudflare"**
  [official, .../traces/known-limitations/]. A container is not a Cloudflare-native traced surface in
  this sense (it's your own process inside a VM), and a call out to the Anthropic API is external by
  definition — both are outside what automatic tracing covers.
- Workflows have their own GraphQL/dashboard observability (instance/step/event-level), but nothing
  found in this pass ties a Workflow instance ID back to the Worker-level trace ID or forward to a
  container exec ID automatically.
- AI Gateway generates its own per-request logs and (per its observability index) supports "OpenTelemetry
  integration" — but whether that integration consumes/propagates an inbound trace/span ID versus
  minting its own is **UNVERIFIED** in this pass; the sub-page was not fetched directly.
- Sandbox SDK container processes have no automatic tie-in to Worker/DO/Workflow trace IDs found in
  docs — `process.getLogs()` / `streamProcessLogs()` are keyed by process ID only.

**Conclusion for the founder's ask, stated as directed: no first-party propagation exists across this
full chain today.** The app-level ledger the founder already wants for M0 is not a nice-to-have
architectural preference here — it is the only mechanism that will make Worker → DO → Workflow →
container → model call correlatable at all. A pragmatic pattern (not documented by Cloudflare, inferred
from the primitives above, so treat as **design guidance, not a vendor-confirmed feature**): mint one
`run_id` at the top of each turn in the Worker/Agent DO, pass it explicitly as (a) a Workflow instance
parameter, (b) an env var or first exec argument into the Sandbox SDK container process, and (c) a
`cf-aig-metadata`/custom-metadata field on the AI Gateway request (AI Gateway's "custom metadata"
observability feature, confirmed to exist but not verified at the field level above, looks like the
right attachment point for step 3 — confirm its exact API before relying on it).

---

## Unattended-build credentials manifest

| Credential | Exact scope / permission | Where set | Plan / cost prerequisite | Human-required step |
|---|---|---|---|---|
| Cloudflare account | n/a (account itself) | — | Free to create | **Yes** — account creation is a human step (email verification, ToS acceptance); cannot be automated by a coding agent |
| Cloudflare API Token — Workers deploy | `Workers Scripts:Edit` [official: developers.cloudflare.com/fundamentals/api/reference/permissions/] | `CLOUDFLARE_API_TOKEN` env var (CI secret) or `wrangler login`-derived OAuth token; CI must use the token, not interactive OAuth [official: developers.cloudflare.com/workers/wrangler/ci-cd/] | Free tier sufficient for Workers Scripts itself | No, once the account/token exist |
| Cloudflare API Token — Durable Objects | No separate permission group found; DO access rides on `Workers Scripts:Edit` since DOs are deployed as part of a Worker script [inferred from developers.cloudflare.com/fundamentals/api/reference/permissions/ — **UNVERIFIED**, the fetched permission list had no distinct "Durable Objects" entry] | Same token as Workers Scripts | Free plan works for **SQLite-backed** DOs only; **Workers Paid ($5/mo) required for KV-backed DOs** [official: developers.cloudflare.com/durable-objects/platform/pricing/ — "Workers Free plan: Only Durable Objects with SQLite storage backend are available"] | No |
| Cloudflare API Token — R2 | `Workers R2 Storage:Edit` [official, permissions page] | `CLOUDFLARE_API_TOKEN` (same token, additional scope) or separate R2-scoped token | R2 free tier: 10 GB storage, 1M Class A ops/mo, 10M Class B ops/mo, $0 egress [community: multiple 2026 pricing summaries — cross-check against developers.cloudflare.com/r2/pricing/ directly, not fetched this pass] | **Contested**: Cloudflare's marketing page says "no credit card required," but multiple 2026 community reports (forum threads, dated within the last week of this research) say a **mandatory billing card dialog appears when enabling R2 on a profile**. Flag as **UNVERIFIED / possibly requires a human to add a payment method** even to stay on the free tier — do not assume this is unattended-safe without a live probe. |
| Cloudflare API Token — Workflows | No distinct "Workflows" permission group found in the fetched permissions page — **UNVERIFIED**, likely rides on `Workers Scripts:Edit` since Workflow classes deploy inside a Worker | Same token | Free tier available (3M requests/mo, 10ms CPU/invocation, 1GB storage); **per-step and per-storage billing starts no earlier than 2026-08-10** — i.e., may already be live [official: developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/] | No |
| Cloudflare API Token — Containers | `Containers:Read` / `Containers:Edit` [official, permissions page] | Same token, additional scope | **Requires Workers Paid ($5/mo)** — no free tier for Containers; billed per-10ms of active vCPU/memory/disk, with 25 GiB-hr memory / 375 vCPU-min / 200 GB-hr disk included in the $5 plan [community: multiple 2026 pricing summaries — **not independently confirmed against developers.cloudflare.com/containers/pricing/ directly in this pass**] | Requires a payment method on the account (see R2 caveat above) — likely a human step at account setup, not per-deploy |
| Cloudflare API Token — Workers AI | `Workers AI:Read` / `Workers AI:Edit` [official, permissions page] | Same token | Usage-billed; part of the unified AI Gateway billing as of 2026-08-07 | No |
| Cloudflare API Token — AI Gateway | `AI Gateway:Read` / `AI Gateway:Edit` / `AI Gateway:Run` — **documented as account-scoped only, cannot be restricted to a single gateway** [official, permissions page, quoted directly] | Same token | Free; usage billed via unified credits or BYOK pass-through | No |
| Cloudflare API Token — Logs/Observability | `Logs:Read` / `Logs:Edit`; also `Workers Tail:Read` for `wrangler tail`/live-log access [official, permissions page] | Same token | Included at both plan tiers, with lower retention/volume on Free (see Observability section) | No |
| `CLOUDFLARE_ACCOUNT_ID` | Not a secret, but required alongside the token — wrangler/wrangler-action error explicitly: `"[ERROR] No account id found, quitting.."` if missing [official: github.com/cloudflare/wrangler-action README] | `wrangler.toml` `account_id` field, or CI `accountId` input / env var | n/a | No |
| Anthropic API key (Claude Code CLI "brain") | Standard Anthropic API key | `ANTHROPIC_API_KEY` env var, **read once at Claude Code process start and never re-checked** — restart the process if you rotate it mid-run [community: multiple 2026 Claude Code configuration write-ups, cross-checked against the CLI's documented env-var behavior] | Requires an Anthropic account + billing | **Yes** — Anthropic account creation and payment method are human steps done once during provisioning |
| Anthropic key via AI Gateway (BYOK routing) | Route `ANTHROPIC_BASE_URL=https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`, `ANTHROPIC_AUTH_TOKEN=<cf-aig token or passthrough key>` | Same Claude Code env-var mechanism; do **not** also set `x-api-key` if using BYOK — the documented gotcha causes request failure [official: developers.cloudflare.com/ai-gateway/providers/anthropic/] | Requires the AI Gateway token above, plus the stored Anthropic key configured via BYOK in the gateway's Stored Keys settings (a one-time console action) | **Yes, once** — storing the BYOK key in AI Gateway's dashboard/API is a provisioning-time action; not required per-run once set up |
| GitHub access for the disposable fixture repo | For clone+push automation, GitHub's own guidance: a **fine-grained PAT needs at minimum `Repository contents: Read-only` to clone, `Read and write` to push** [community, docs.github.com-sourced synthesis — cross-check the exact permission name directly on docs.github.com before finalizing]; **GitHub itself recommends GitHub Apps over long-lived PATs for durable automation** because App installation tokens are short-lived and scoped per-repo, reducing blast radius if leaked [community synthesis of github.blog and docs.github.com] | Fine-grained PAT: repo secret / CI env var. GitHub App: App ID + private key + installation ID, exchanged for a short-lived installation token per run | Free (GitHub App creation and fine-grained PAT creation are both free) | **Yes for the PAT approach** (a human must generate and rotate it); **the GitHub App approach still needs one human step to create/register the App and install it on the fixture repo**, but after that, token minting is fully automatable — this is the better fit for "no human in the loop after initial provisioning" |
| Docker / container engine (for local dev only, not deploy) | n/a — local tooling, not a Cloudflare credential | Local machine / CI runner | Docker Desktop free tier or Colima (free) sufficient for local `wrangler dev` container testing [official: developers.cloudflare.com/containers/local-dev/] | No, once installed — but CI runners need Docker-in-Docker or a Docker-enabled runner class, which is an infra decision, not a credential |

**Net read on "fully unattended after provisioning":** every item above *can* be made unattended once
set up, **except** two things that are structurally one-time human actions and should be named as such
in the M0 plan rather than treated as automatable: (1) Cloudflare account creation + attaching a payment
method (needed for Containers, likely needed for R2 despite the "no credit card" marketing claim), and
(2) Anthropic account creation + payment method, or AI Gateway BYOK key storage if you want the model
call to route through the Gateway instead of directly to Anthropic. Everything downstream of those two
one-time actions — token minting, scoping, rotation — can run unattended via `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`, and a GitHub App installation token.

---

## Fit for resident agent service — what M0 should build

Given the boundary established above, an M0 observability + testing harness milestone should split
cleanly into two tiers, and should **not** try to make everything pass in `vitest-pool-workers` —
that would hide exactly the wiring failures this repo's own lesson ("green tests exercise functions,
production exercises wiring") warns about.

**Tier 1 — `vitest-pool-workers`, fast, deterministic, CI-gating on every PR:**
- Agent DO RPC/routing logic, SQLite storage read/write correctness, and DO-alarm-triggered behavior via
  `runInDurableObject()` / `runDurableObjectAlarm()` — all confirmed real (not mocked) `workerd`
  behavior [official].
- Per-turn Workflow step logic, using `introspectWorkflowInstance()`/`introspectWorkflow()` with
  `mockStepResult()`, `mockEvent()` for `waitForEvent()`, `disableSleeps()`, and `forceStepTimeout()` to
  deterministically exercise retry/timeout/event-wait branches **without wall-clock waits** [official].
  This is a genuinely strong local story — build it first, it's cheap and it's real.
- MCP handler request/response shape and `workers-oauth-provider` token-validation logic, since
  `createMcpHandler` is explicitly stateless and should be unit-testable without a live container or DO.

**Tier 2 — real deployed environment, slower, run on a schedule + pre-merge-to-main gate, exercising
exactly the wiring vitest cannot reach:**
- Anything touching a Sandbox SDK container: cold start, `outboundByHost` credential injection actually
  reaching an external host, `mountBucket()` live FUSE mount vs. the local periodic-sync approximation,
  container stdout/stderr actually landing in Workers Observability (given the "closed completed" but
  unconfirmed-mechanism status above, this is a **must-probe**, not an assume-it-works item).
- DO hibernation/eviction timing assertions (the 10s/70–140s windows) — cannot be observed pre-fix-era
  local Miniflare, and even post-fix, real timing only exists deployed.
- Workflows cross-region durability and real multi-minute/hour `sleep()` — the local emulation
  explicitly differs from the global runtime ("Wrangler runs an emulated version...compared to the one
  Cloudflare runs globally" [official]).
- The AI Gateway `env.AI` default-gateway auto-creation and full-payload logging path, and R2
  backup/restore against a real bucket, both of which have plan/billing-account prerequisites that a
  mock cannot represent.
- The full trace-correlation chain (Worker → DO → Workflow → container → model call) — since no
  first-party propagation exists, the *only* way to prove the app-level `run_id` ledger actually
  threads through every hop is to run the real chain deployed and assert on the ledger records, exactly
  as the founder specified ("assert on records, not agent self-reports").

**Concretely, "deployed" for Tier 2 does not have to mean production.** Use `wrangler versions upload`
preview URLs for per-change testing, and a distinct `[env.test]` Worker/DO/R2/Workflow set (its own
binding IDs/bucket names) so Tier 2 runs never touch production data — mirroring exactly the
`POSTGRES_URL`-per-environment discipline this repo already enforces for Neon. Given no first-party
per-PR-preview product was confirmed in this pass, plan for a hand-rolled `[env.pr-N]` or a single
long-lived `[env.test]` reused across runs (simpler, and consistent with "resident" DO state being the
thing under test — a fresh env per PR would also reset the DO state you're trying to validate).

---

## Open questions

1. Which SDK/wrangler version actually shipped the container stdout/stderr → Workers Observability
   forwarding fix behind GitHub issue #12998 (closed "completed" 2026-04-01)? No changelog entry or PR
   number was found in this pass — needs a direct probe (start a container process, emit known stdout,
   check `wrangler tail`) before the M0 harness can rely on it.
2. Does the current Sandbox SDK local-dev HTTPS-interception sidecar (TPROXY-based, "mirroring
   production behavior") have **any** remaining local/production gap, or has that prior finding
   ("HTTPS interception requires the Cloudflare runtime; local dev uses HTTP-only interception") been
   fully superseded by the 2026-04-13 change? The current outbound-traffic guide reads as "mirrors
   production" but does not explicitly disclaim all gaps — needs a live test (intercept an HTTPS
   request locally, confirm the injected credential and the CA chain) to close this out.
3. Exact behavior of `enableInternet=false` locally vs. deployed — no explicit local-dev caveat was
   found, but that absence is not confirmation of parity.
4. Full field list for the Workflows GraphQL `workflowsAdaptiveGroups` dataset — only one field
   ("read queries against a database") was confirmed from a summarized fetch; the actual step
   duration/error/retry-count fields need direct verification before building a dashboard or alert on
   them.
5. Whether Durable Objects support remote bindings under `wrangler dev` in any mode — not resolved in
   this pass, and directly relevant to whether Tier 1 tests could ever touch a real deployed DO without
   a full deploy.
6. Exact OpenTelemetry trace-header propagation behavior for AI Gateway requests (does it consume an
   inbound `traceparent` header, or only mint its own?) — the observability index confirms "OpenTelemetry
   integration" exists but the field-level mechanics were not fetched.
7. Whether R2 truly requires a payment method for the free tier today, or whether that's stale/
   inconsistent community reporting — directly affects the "no human after provisioning" credentials
   claim and should be resolved with a live account-creation probe, not documentation alone.
8. Whether Cloudflare has a native per-PR preview-deployment product beyond `wrangler versions upload`
   (analogous to Vercel preview URLs) — "Workers Builds" was named in passing but not explored.
9. Container-level resource-metrics API (CPU/memory time series per Sandbox instance) — billing implies
   the data exists internally; no queryable API was confirmed in this pass.

---

## Sources

All fetched 2026-08-11 unless noted. Credibility: **official** = developers.cloudflare.com, npm
registry, or github.com/cloudflare first-party repos/issues; **vendor-blog** = blog.cloudflare.com or
Cloudflare changelog narrative posts; **community** = third-party blogs, forums, benchmark sites.

- [official] https://developers.cloudflare.com/workers/testing/vitest-integration/get-started/ — vitest-pool-workers overview, requires Vitest 4.1+, page last updated 2026-05-27
- [official] https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/ — WebSocket/DO isolation caveat, dynamic-import limitation, fake-timer limitation
- [official] https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/ — full Workflow/DO/Queue test API surface
- [official] https://developers.cloudflare.com/containers/local-dev/ — Docker requirement, hot-reload gaps, `max_instances` not applying locally
- [official] https://github.com/cloudflare/sandbox-sdk — README, "Beta" status note, TLS-proxy CA-bundle note
- [official] https://developers.cloudflare.com/workflows/build/local-development/ — "emulated version...compared to global," `--remote` unsupported, Local Explorer
- [official] https://developers.cloudflare.com/workers/observability/ — Logs vs Logpush vs Analytics Engine overview
- [official] https://developers.cloudflare.com/agents/ — Agents SDK overview, State/Sessions/Routing/WebSockets/Scheduling, MCP mention
- [official] https://developers.cloudflare.com/fundamentals/api/reference/permissions/ — exact permission-group names quoted in the credentials table
- [official] https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/ — GraphQL datasets, WebSocket/hibernation metric placement
- [official] https://developers.cloudflare.com/workflows/observability/metrics-analytics/ — 31-day retention, dimension list
- [official] https://developers.cloudflare.com/workers/observability/logs/workers-logs/ — retention (3d Free / 7d Paid), volume limits
- [official] https://developers.cloudflare.com/workers/observability/traces/known-limitations/ — "Trace IDs are not propagated to services outside of Cloudflare," other beta caveats
- [official] https://developers.cloudflare.com/durable-objects/platform/known-issues/ — alarm-after-hot-reload caveat, WebSocket log delay, global-uniqueness edge case
- [official] https://developers.cloudflare.com/durable-objects/platform/pricing/ — SQLite-only on Free plan
- [official] https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/ — 10s hibernate / 70–140s evict timing
- [official] https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects — official DO testing guidance, `runDurableObjectAlarm`
- [official] https://developers.cloudflare.com/sandbox/guides/outbound-traffic/ — `wrangler dev` TPROXY sidecar "mirroring production behavior"
- [official] https://developers.cloudflare.com/sandbox/guides/backup-restore/ — FUSE overlayfs (prod) vs `unsquashfs` (local)
- [official] https://developers.cloudflare.com/sandbox/guides/mount-buckets/ — live FUSE mount (prod) vs `localBucket` periodic sync (local)
- [official] https://developers.cloudflare.com/ai-gateway/providers/anthropic/ — endpoint format, BYOK header gotcha
- [official] https://developers.cloudflare.com/ai-gateway/observability/ — six observability areas listed (index page only)
- [official] https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/ — `createMcpHandler` stateless, `getMcpAuthContext()`
- [official] https://developers.cloudflare.com/workers/wrangler/environments/ — `[env.<NAME>]` per-environment Worker deploys
- [official] https://developers.cloudflare.com/changelog/post/2026-08-07-workers-ai-unified-billing/ — AI Gateway/Workers AI unification, default-gateway auto-create
- [official] https://developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates/ — per-step/storage billing start date
- [official] https://developers.cloudflare.com/changelog/post/2026-04-13-sandbox-outbound-workers-tls-auth/ — credential injection + TLS interception ship date
- [official] https://developers.cloudflare.com/changelog/product/sandbox/ — Sandbox SDK 1.0-preview `@next` tag (2026-08-07), Devin Outposts (2026-07-21)
- [official] https://github.com/cloudflare/workers-sdk/issues/12998 — container stdout/stderr forwarding gap, filed 2026-03-21, closed "completed" 2026-04-01
- [official] https://github.com/cloudflare/workers-sdk/issues/10600 — Workflows vitest-in-CI reliability bug, filed 2025-09-10, closed 2026-03-26
- [official] https://github.com/cloudflare/wrangler-action — `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` requirement, exact error text
- [official] https://github.com/cloudflare/workers-oauth-provider — OAuth 2.1 (draft-ietf-oauth-v2-1-13), PKCE S256-default, DCR routes, `clientIdMetadataDocumentEnabled`
- [official] npm registry: `@cloudflare/vitest-pool-workers@0.21.1` (2026-08-11), `@cloudflare/sandbox@0.12.5` (2026-08-07), `agents@0.20.1` (2026-07-28), `@cloudflare/workers-oauth-provider@0.10.3` (2026-08-10)
- [vendor-blog] https://blog.cloudflare.com/better-testing-for-workflows/ — 2025-11-04, `introspectWorkflowInstance`/`introspectWorkflow`, requires vitest-pool-workers ≥0.9.0
- [vendor-blog] https://blog.cloudflare.com/sandbox-ga/ — 2026-04-13, Sandboxes + Containers GA, SDK v0.8.9 at GA
- [vendor-blog] https://blog.cloudflare.com/mcp-v2/ — 2026-08-06, DCR→CIMD, `createMcpHandler` graduating into official MCP TS SDK, DCR removal "targeted for summer 2027"
- [vendor-blog, via changelog] https://developers.cloudflare.com/workers/observability/traces/ + changelog 2025-11-07 — automatic tracing open-beta announcement
- [community] https://alchemy.run/blog/2026-07-01-microvm-cold-starts/ — 2026-07-01, 700-boot benchmark: Cloudflare Containers median 10.5s/p95 15.6s vs AWS microVMs median 3.4s/p95 4.1s (opencode workload)
- [community] https://github.com/cloudflare/cloudflare-docs/issues/19856 — pre-`wrangler@3.13.2` local WebSocket-hibernation gap (historical, reportedly fixed)
- [community] MCP spec 2026-07-28 DCR-deprecation coverage (modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration, cross-referenced against the official Cloudflare blog above)
- [community, unverified against a direct fetch] R2 payment-method requirement discrepancy — Cloudflare marketing copy vs. multiple 2026 Cloudflare Community forum threads reporting a mandatory card dialog
- [community, unverified against a direct fetch] `wrangler versions upload` preview-URL behavior and gradual-deployment percentage rollout — synthesized from search snippets of developers.cloudflare.com/workers/versions-and-deployments/ and .../gradual-deployments/, not independently re-fetched with direct quotes
