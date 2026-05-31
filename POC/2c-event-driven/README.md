# POC 2c — Event-driven agents (beyond GitHub webhooks)

> Wave 2. Generalizes the existing GitHub PR/installation webhook ingestion into
> a source-agnostic **"on event X, wake an agent"** pipeline, where
> X ∈ {GitHub issue opened, inbound email, deploy failed, Sentry alert, …}.

## Goal

The production app ingests GitHub webhooks at
`apps/web/app/api/github/webhook/route.ts`: it verifies an HMAC-SHA256
signature, parses the event by `x-github-event`, and dispatches
(`handlePullRequestWebhook` → finds linked sessions → archives them;
`issues`/`deployment_status` → `dispatchBackgroundTriggerEvent`). There is
already a *partial* generalization in `apps/web/lib/background-agents/`, but it
is **GitHub-only and repo-centric**: the single normalizer
(`github-events.ts`) only knows GitHub payloads, every
`NormalizedBackgroundTriggerEvent` requires a `repoOwner`/`repoName`, and the
only verifier is GitHub's signature scheme.

This POC proves the next step: a **source-agnostic event model**, a **per-source
verifier + normalizer registry** (each source verifies differently and may have
no repo), and a **rule engine** decoupled from any single payload shape — with
the GitHub PR-close behavior subsumed as **one rule** to show it is not a
regression.

## What was built

All code is self-contained in `POC/2c-event-driven/` (only dep: `zod`).

| File | Responsibility |
|------|----------------|
| `types.ts` | Canonical `AgentEvent { source, type, externalId, repo?, actor?, subject, body, metadata, occurredAt? }`, the `EventSource` contract (`matchesInbound` / `verify` / `normalize`), `TriggerRule`, `AgentRunIntent`, and the `RunAgent` seam. |
| `sources/verify.ts` | Constant-time compare + `hmacHex` helpers (SHA1/SHA256). |
| `sources/github.ts` | GitHub source. `x-hub-signature-256: sha256=<hex>` HMAC-SHA256. Normalizes `pull_request` (incl. the original `merged ? "merged" : "closed"` `prStatus` derivation) and `issues`. |
| `sources/agentmail.ts` | Inbound email. `x-agentmail-signature: <bare hex>` HMAC-SHA256. Normalizes `message.received`, parsing `Name <addr>` into a bare address. |
| `sources/vercel-deploy.ts` | Deploy-failed. `x-vercel-signature: <hex>` HMAC-**SHA1** (different algorithm). Normalizes `deployment.error`, deriving repo from commit meta. |
| `sources/sentry.ts` | Sentry issue alerts. `sentry-hook-signature: <bare hex>` HMAC-SHA256 (same algo as AgentMail, **different header**). |
| `sources/generic.ts` | Escape hatch: `authorization: Bearer <secret>` (non-HMAC) + caller-supplied canonical event. |
| `sources/index.ts` | Source registry + `resolveSource(inbound)` header routing. |
| `rule-engine.ts` | Dotted-key field access, `equals`/`in`/`prefix`/`contains` matchers, `source.*` type wildcards, `{{field}}` prompt templating, `matchEvent` → intents (with idempotency keys). |
| `dispatcher.ts` | `EventDispatcher`: match → for each intent, dedup on idempotency key then call the injected `RunAgent`. |
| `ingest.ts` | `IngestPipeline.ingest(RawInbound)`: resolve source → verify (raw body) → parse → normalize → dispatch. Transport-agnostic; returns `{status, body}`. |
| `rules.ts` | Default rule set incl. the PR-close subsumption rule and a deliberately-overlapping email rule for fan-out. |
| `eval.ts` | The meaningful eval (below). |
| `fixtures/*.json` | Real-shaped payloads for each source. |

### Pipeline

```
RawInbound ──resolveSource(header)──▶ EventSource
   │
   ├─ verify(rawBody, secret)         per-source scheme (SHA256 / SHA1 / bearer)
   ├─ JSON.parse(rawBody)
   ├─ normalize(parsed) ─▶ AgentEvent[]   source-agnostic canonical model
   └─ for each event: matchEvent(rules) ─▶ AgentRunIntent[]
            └─ dedup(idempotencyKey) ─▶ runAgent(intent)   ← the 2a seam
```

## How it was tested + evidence

`bun run eval` signs each fixture with that source's **real** signature scheme,
runs it through the **full** pipeline, and asserts on real outcomes. **53/53
assertions pass.** Evidence:

- `evidence/eval-log.txt` — full PASS/FAIL log.
- `evidence/dispatch-decisions.json` — per-event normalized `AgentEvent` + the
  dispatch decisions (matched rule, rendered prompt, idempotency key, runId) for
  every case, plus a `_summary` of all 6 dispatched runs.

Commands:

```bash
cd POC/2c-event-driven
bun install
bun run typecheck   # tsc --noEmit, clean
bun run eval        # 53/53 assertions PASS
```

What the eval proves:

- **3+ sources, full happy path** — GitHub `issues.opened`, AgentMail
  `message.received`, Vercel `deployment.error` (plus Sentry `issue.alert` and a
  generic bearer source). Each: correct secret/signature **verifies**,
  **normalizes** to the right canonical `AgentEvent`, **matches** the intended
  rule, and **dispatches** exactly one run with a **prompt rendered from event
  fields**.
- **Multi-rule fan-out** — the inbound email subject contains "Bug", so it
  matches **both** `email-support-triage` and `email-bug-report` → 2 distinct
  dispatches with the right rule set and distinct prompts.
- **Bad signature → REJECTED** — a GitHub payload signed with the wrong secret
  returns 401 and produces **no** dispatch (verified by asserting the run count
  is unchanged).
- **No-rule → no dispatch** — a `github.issues.closed` event verifies and
  normalizes but matches no rule → 0 dispatches.
- **Idempotency / redelivery dedup** — re-POSTing the same GitHub issue still
  verifies and still matches, but dispatches **0 new** runs (counted as a
  duplicate); `runAgent` is not called again.
- **Unrecognized source → 400**, and **wrong bearer → 401** for the generic
  source.
- **No regression** — the GitHub `pull_request.closed` (merged) case is handled
  as the single `github-pr-close-archive` rule, normalizing to the same
  `prStatus = "merged"` the original `handlePullRequestWebhook` derived, and
  dispatching exactly one run carrying the PR number and status.

## Integration plan

Generalize, do not rewrite. The production seam already exists; this POC shows
how to widen it without breaking GitHub.

1. **Schema** (`apps/web/lib/db/schema.ts`): add two tables.
   - `eventSources` — `{ id, kind (github|agentmail|vercel-deploy|sentry|generic),
     secretRef, config }`. Lets operators register a source + its secret without
     code changes; `verify` is selected by `kind`.
   - `triggerRules` — the `TriggerRule` shape: `{ id, ownerUserId, enabled,
     whenSource, whenType, match (jsonb), agentId/targetRepo, promptTemplate }`.
     This generalizes today's `backgroundAgentTriggers.conditions`
     (`apps/web/lib/background-agents/types.ts`) off the repo-centric `match`.
   - Run `bun run --cwd apps/web db:generate` and commit the `.sql`.
2. **Sources**: move `sources/*` into
   `apps/web/lib/event-agents/sources/` and fold the existing
   `background-agents/github-events.ts` logic into `sources/github.ts`
   (the POC already reproduces its `prStatus` derivation).
3. **Rule engine + dispatcher**: place `rule-engine.ts` + `dispatcher.ts` in
   `apps/web/lib/event-agents/`. The `RunAgent` seam wires to the **same**
   materialization the GitHub route already uses:
   `dispatchBackgroundTriggerEvent` → `start(runBackgroundAgentWorkflow)`
   (`apps/web/lib/background-agents/dispatcher.ts`), which is the trigger-mode
   analogue of how `apps/web/app/workflows/chat.ts` (`runAgentWorkflow` →
   `openAgent`) materializes an interactive run.
4. **Endpoint**: add `apps/web/app/api/events/[source]/route.ts` (or a single
   `/api/events/ingest`) backed by `IngestPipeline`. Keep
   `/api/github/webhook` as a thin alias that calls the same pipeline so the
   existing GitHub App webhook URL keeps working. Verification reads
   `await req.text()` **before** `JSON.parse` (the POC enforces raw-body
   verification, matching the current route).
5. **Email source wiring**: register an AgentMail webhook
   (`client.webhooks.create({ url, eventTypes: ["message.received"] })`) pointing
   at `/api/events/agentmail`; store the signing secret in `eventSources`.

## Feasibility verdict

**Feasible and low-risk.** The canonical `AgentEvent` cleanly subsumes the
existing GitHub-only `NormalizedBackgroundTriggerEvent` (repo becomes optional;
GitHub still populates it). The per-source verifier registry handles three
distinct HMAC schemes **plus** a non-HMAC bearer with no special-casing in the
pipeline. The rule engine reproduces the original PR-close behavior as data
(one rule), so generalization is additive, not a rewrite. The only genuinely
new production surface is two small tables and one route handler.

## Blind spots eliminated

- **Per-source auth differences are real and handled.** GitHub uses
  `sha256=<hex>`; AgentMail uses **bare** hex SHA256; Vercel uses **SHA1**;
  Sentry uses SHA256 under a *different header*; generic uses a bearer token.
  The eval signs each with its true scheme and proves verify/reject both ways.
  A single hard-coded verifier (today's reality) would silently reject 3 of 4
  external sources.
- **Idempotency / redelivery dedup.** Webhooks are redelivered (GitHub, Vercel,
  Sentry all retry). The idempotency key (`rule:source:type:externalId`,
  mirroring `buildBackgroundRunIdempotencyKey`) makes a redelivery dispatch
  **zero** new runs. Proven by re-POSTing an identical payload.
- **Rule-matching ambiguity / fan-out.** One event legitimately matching
  multiple rules dispatches the **correct set** (proven with the overlapping
  email rules), and an event matching none dispatches nothing.
- **Repo-optional events.** Email and Sentry events have no repo; the canonical
  model and rules handle them without a synthetic repo, unlike the current
  repo-mandatory `NormalizedBackgroundTriggerEvent`.
- **Raw-body verification discipline.** Signatures are computed/verified over
  the exact transmitted bytes (never re-serialized), matching the production
  route's `await req.text()` ordering.

## Remaining risks

- **Durability dependency on POC 2b.** This POC dispatches a run *intent* via
  the `RunAgent` seam and stops there. For a triggered run to **survive sandbox
  teardown / serverless restart** (the whole point of waking an agent on an
  event), dispatch must enqueue into the durable workflow/job queue from POC 2b
  — exactly as production's `dispatcher.ts` calls
  `start(runBackgroundAgentWorkflow)`. Until 2b lands, a crash between
  "intent created" and "run started" loses the wake-up. The idempotency key is
  the reconciliation hook 2b needs.
- **Dedup store must be durable + bounded.** The eval uses an in-memory `Set`.
  Production needs a unique index (or TTL'd store) on the idempotency key so
  dedup holds across instances and the table does not grow unbounded.
- **Secret/source provisioning is an operator surface.** Each source needs its
  secret stored and rotated; a misconfigured secret looks identical to an
  attacker (both 401). Needs observability on verification-failure rate per
  source.
- **Vercel signature specifics** were taken from Vercel's webhook security docs
  (HMAC-SHA1 hex over the raw body, `x-vercel-signature`). Confirm against a
  live delivery before trusting in production; the verifier is a one-line change
  if the algorithm differs. Sentry's `sentry-hook-signature` HMAC-SHA256 should
  likewise be confirmed against a live alert.
- **Normalizer drift.** Each external provider can change payload shapes;
  schemas should fail closed (return `[]`, as they do) and emit an observability
  event so drift is visible rather than silently dropping events.
```
