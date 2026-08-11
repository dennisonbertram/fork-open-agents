# PRD — Resident Agent Service (spike-scoped v1)

**This is the binding specification.** It consolidates the Codex round-1 PRD,
the Fable arbitration, and the Kimi audit (see [reviews/](reviews/)) into one
document. Where any review document, research doc, or earlier plan disagrees
with this file, **this file wins**. Companion: [spike-plan.md](spike-plan.md)
(execution plan, subordinate to this PRD). Consensus status: under tri-model
review (Codex / Kimi / Fable); Fable holds final say. Date: 2026-08-11.

Standing constraints (founder): no premature optimization; buildable
autonomously by workflows and subagents; agent self-reports are never trusted
— evidence ledgers are; no invented numbers — TBD values carry a named
decider; e2e testing on real sample projects is the acceptance condition.

---

## 1. Product definition

The resident agent service provides one durable Worker per coding task.
External agent clients connect to **one account-level MCP endpoint**,
authenticate as Visitors acting for an Owner, and create, task, question,
inspect, stop, or repair Workers without receiving direct sandbox access.

Each Worker owns durable structured memory and coordinates a sandboxed Brain.
The Worker — not the Brain — owns grants, verification, persistence,
externally visible actions, and the evidence ledger.

Framing: *a coding harness for your coding harness.* The client of the
product is the owner's agent, not the owner.

## 2. Problem statement

Coding-agent sessions fragment context across clients, devices, and model
vendors. A file workspace alone does not preserve task intent, decisions,
blockers, verification evidence, or the ability for a different client to
resume work safely. The service makes task ownership durable and
client-neutral while preventing a model's self-report — or a sandbox's
possession of files — from being treated as proof of what occurred.

## 3. Goals

1. Prove a named Worker can hibernate, wake, execute a real coding turn,
   restore its workspace, and remain addressable through one MCP endpoint.
2. Let multiple independently authenticated Visitors use the same Worker and
   receive the same authoritative state.
3. Separate cheap structured reads from model-generated narrative.
4. Keep raw repository and model credentials outside the Brain container,
   and keep write *authority* (not just secrets) outside the Brain.
5. Make all mutations idempotent and all externally visible effects
   grant-controlled and auditable.
6. Produce independent evidence sufficient to decide Cloudflare vs. the
   existing fork without trusting agent narration.
7. Measure — not estimate — latency and attributable cost.

## 4. Non-goals (spike and v1 unless marked)

- General-purpose human dashboard. (A consent page and an out-of-band
  recovery CLI **are** required surfaces — see §7.11.)
- Teams, organizations, shared ownership, subscriptions, customer billing.
- Worker-to-worker delegation (stories 14–15 specified, deferred).
- More than one production Brain profile. M5 swaps the Worker's owner model;
  Brain replacement is a fast-follow, not a launch claim.
- Sandbox portability across providers.
- Arbitrary Visitor access to shell execution or raw sandbox RPC.
- Warm pools, multi-region, production-scale rate tuning.
- `@cloudflare/computer` in production (research-only).
- Batch worker-creation API (`create_workers`) — cut; clients loop
  `create_worker` with idempotency keys. Revisit only if M4b measurement
  shows client tool-call budgets make loops impractical.
- Retention/export/PITR/archive *machinery* in the spike — redaction and
  secret-canary scanning only; retention values are v1 policy, founder-TBD.

## 5. Personas and trust model

- **Owner** — human root authority for one account. Provisions identity,
  repositories, credentials, policies, budgets, client access; retains an
  out-of-band recovery path.
- **Visitor** — external agent client authenticated to the account.
  Untrusted beyond granted scopes and per-worker grants.
- **Worker** — durable task owner; single-writer coordinator. Owns lifecycle
  state, structured memory, grants enforcement, Workflow ids, verification,
  external actions, and the ledger.
- **Brain** — pluggable coding-agent CLI inside a sandbox. Semi-trusted: may
  read and mutate its workspace; cannot hold write credentials, trigger
  authenticated writes, alter ledger records, approve its own actions, or
  declare itself verified.

## 6. User stories and acceptance criteria

Stories 1–24 originate in [stories.md](stories.md); 25–31 were added in
review. Scope: **[S]** = spike, **[v1]** = first product release, **[D]** =
deferred. Acceptance criteria below are binding; stories.md keeps the
narrative form.

| # | Scope | Acceptance criteria |
|---|---|---|
| 1 | S | A conforming client discovers metadata and registers without pre-created client credentials (DCR or CIMD). One-time Owner login/consent is explicitly allowed and recorded; registration alone grants no account access. |
| 2 | v1 | Owner-authorized Visitor or the recovery CLI lists client identity, scopes, grant time, last use, status — and revokes. Refusal after revocation is proven through the deployed front door within a measured propagation window (see §7.2). |
| 3 | S | Every request is checked against account ownership, OAuth scope, worker grant, and action policy. Foreign workers return non-disclosing `not_found`. Denials are recorded without sensitive detail. |
| 4 | S | `create_worker` accepts repo, instructions, grants, profile, idempotency key; returns `workerId` + initial `turnId` without waiting for work. Repeating the key returns the same result. |
| 5 | S | Repository acquisition uses a Worker-controlled **read-only** credential path. The Brain receives no raw token and cannot use the injected path for push, PR, comment, merge, or branch deletion (authority split, §7.8). |
| 6 | v1 | Before mutation, the Worker records a task graph and an interpretive plan. Updates carry actor, timestamp, schema version, evidence refs. The plan never determines completion status. |
| 7 | S | Brain results are independently verified: configured test commands, workspace hashes, diff inspection. If verification cannot run, the turn is blocked or failed — never successful. |
| 8 | S | `ask_worker` starts an async narrative turn, returns `turnId`. The answer cites structured-state/event identifiers; never a raw transcript. |
| 9 | S | Task graph, decisions, plan, status, outputs, costs, ledger are readable with zero model invocation, and the evidence shows zero model invocation. |
| 10 | S | Authorized Visitors inspect diff, branch/head, selected files, test results, outputs, backup manifest. Paths are normalized; traversal outside the workspace is refused. |
| 11 | S | After a real 24-hour idle, an addressed Worker wakes with identity and memory intact. Workspace restore happens only when the operation needs it. Latency phases recorded. |
| 12 | S(split) | M5 proves owner-model swap without losing recorded task/decision state. Brain swap is deferred and must not be claimed. |
| 13 | S | Backup/restore preserves the declared workspace manifest with exact before/after digests across sandbox sleep. Missing/corrupt backup → typed blocked/failed state. |
| 14 | D | Worker-to-worker tasking uses the same service contract with delegated identity and grant narrowing. Not built in spike/v1. |
| 15 | partial | Registry lists all root Workers in v1. Ancestry and spend roll-up deferred with 14. |
| 16 | S(split) | Spike: list, stop, audit — stop reconciles active work and preserves inspectable state. v1: archive/destroy under the retention contract, which cannot silently erase required audit evidence. |
| 17 | S | Grants are per worker, per action: `deny`/`allow` exercised in spike; `require_approval` reserved in the schema, flow deferred to v1. Default deny. The Brain cannot widen grants. |
| 18 | S | Status includes attributable DO, Workflow, Sandbox, storage, egress, model usage — plus `unknown` with a reason where unattributable. Never zero-filled. |
| 19 | S | Fan-out = the client loops `create_worker` with per-item idempotency keys. N accepted items create N Workers that survive client disconnection and report independently. No batch API. |
| 20 | v1 | Quota/limit policy with typed `quota_exceeded` + retry guidance is a v1 story (limits TBD; decider: founder). The spike environment still carries a hard concurrency/spend ceiling as an operational guard against runaway autonomous fan-out — an ops setting, not a product feature. |
| 21 | S | One model-free account query returns authorized Workers: status, timestamps, blockers, output links, source/freshness metadata, cost. No Worker model wakes. |
| 22 | S | Blocked state records typed reason, provenance, evidence, requested resolution, entry time, retry safety (§7.10). Blocked is never presented as idle. |
| 23 | S | A differently authenticated Visitor inspects a blocked Worker and submits instructions/resolution **through the Worker**; it cannot mutate the sandbox directly or bypass grants. |
| 24 | v1 | Versioned client packaging: Claude Code skill/config, Codex CLI config (static-token mode), ChatGPT connector instructions. Each states auth mode, setup, timeout behavior, verified capability limits. |
| 25 | v1 | Owner bootstrap: account, IdP, repo installation/allowlist, default grants, recovery credential — before Visitors connect. |
| 26 | S | Every mutation takes an idempotency key; Workflow callbacks and external actions dedupe by stable operation id. Retries never create a second Worker, commit, PR, or comment. |
| 27 | S | External actions are proposed with exact repo/ref/payload and grant decision before execution; execution records provider object ids and independently observed outcomes. |
| 28 | S | Every turn emits the evidence bundle (§9.5). Worker/Brain cannot mark a run passing; a deterministic, independently owned evaluator derives the verdict. |
| 29 | S | Faults at each durable boundary produce safe completion, safe retry, or typed failed/blocked — never an unbounded lease, silent idle, or untracked external process. |
| 30 | S(trimmed) | Spike: redaction + secret-canary scan on all evidence surfaces. Retention/export/PITR/archive values are v1 policy, TBD (decider: founder). No retention machinery in the spike. |
| 31 | S | Credentials that unblock work arrive by secret reference or policy change — never in task text, MCP output, event payloads, or Brain environment. |

## 7. Functional requirements

### 7.1 Identity, addressing, topology

- One account-level MCP endpoint; `workerId` is a parameter. Per-worker
  endpoints are out of scope.
- `workerId` is immutable and opaque; slugs/titles are display data.
- Worker DO addressed by a collision-resistant account/worker key that does
  not expose repo or task names.
- A canonical **account registry read model** is mandatory (stories 15, 16,
  19, 21, 22). Physical store (Account DO vs D1 vs other) is an M0 ADR
  (decider: implementing team, from deployed tests).
- The Worker DO is the only writer of authoritative Worker/turn state.
  Workflows report through idempotent callbacks.
- Worker DO vs Sandbox DO topology: distinct objects unless M0 proves a safe
  unified class; ADR before M1.
- **Workflow instance-id convention (pinned):** `${workerId}-turn-${seq}`,
  ≤100 chars; duplicate-live-id-throws is the turn idempotency mechanism.
- **Correlation identity (pinned):** `run_id` **is** the Workflow instance
  id string above — one turn, one run_id; not a separate identifier.
  `requestId` (per MCP request) is distinct and maps N:1 onto turns. AI
  Gateway custom metadata carries the run_id only on provider-backed turns.

### 7.2 OAuth, scopes, auth modes

Scopes: `account:read`, `workers:read`, `workers:write`, `workers:admin`,
`actions:approve` (reserved with the approval flow, v1).

- OAuth 2.1 authorization-code + PKCE. **MCP spec revision pinned:
  2026-07-28** (stateless lifecycle, per-request `_meta`). Support **CIMD
  and DCR** — CIMD preferred (the spec deprecates DCR, removal ~summer
  2027); serve `client_id_metadata_document_supported: true` and `"none"` in
  `token_endpoint_auth_methods_supported` so Claude Code selects CIMD.
  RFC 8707 resource indicators enforced.
- DCR/CIMD create client metadata only; Owner authentication + consent
  create the grant. One authorization covers all authorized Workers behind
  the endpoint; worker grants narrow per resource.
- **Two auth modes, both gate-tested:** OAuth (Claude Code) and
  Owner-issued scoped static bearer tokens for headless clients (Codex CLI
  `--bearer-token-env-var` pattern). Static-token issuance, scoping,
  storage, rotation, and revocation design is an M0 work item (owner: the
  front-door epic).
- Identity provider for `/authorize`: TBD at P0 (decider: founder;
  `workers-oauth-provider` is not an IdP).
- Fail closed: metadata, audience/resource, expiry, revocation, scope —
  through the deployed entry point.
- **Revocation acceptance is a measured-window criterion:** OAuth state
  lives in globally distributed KV; record observed propagation time and
  flag if it exceeds documented consistency expectations. Binary
  "immediately fails everywhere" is not testable and not claimed.
- Every request records stable client identity and the effective
  scope/grant snapshot hash.

### 7.3 MCP tool surface

All mutations return promptly with ids — never awaiting a coding turn
(client budgets: Codex CLI defaults to 60 s per tool call). Every result
carries `requestId`, status, and typed errors.

**Spike tools (10):**

| Tool | Minimum scope | Contract |
|---|---|---|
| `whoami` | authenticated | Owner/account id, client id, scopes, auth mode, grant summary. |
| `create_worker` | `workers:write` | Create one Worker + initial turn from repo, instructions, grants, profile, idempotency key. Repeat key → same result. |
| `task_worker` | `workers:write` | Submit instructions as a new turn; returns `turnId`. |
| `ask_worker` | `workers:write` | Start an owner-model narrative/query turn; returns `turnId`. |
| `get_worker_status` | `workers:read` | Deterministic read-model status; no model wake. |
| `get_account_status` | `account:read` | Deterministic account roll-up; paginated/filterable; no model wake. |
| `get_turn` | `workers:read` | Turn state, progress, output references, errors, ledger URI. |
| `cancel_turn` | `workers:write` | Request cancellation; reports cancelled, reconciling, or terminal no-op. |
| `resolve_block` | `workers:write` | Attach a decision, grant change, or secret reference; optionally start a retry turn; appends, never overwrites the blocker. |
| `stop_worker` | `workers:write` | Prevent new turns; reconcile active work; preserve inspectable state. |

**v1 additions:** `destroy_worker` (`workers:admin`; executes the declared
retention contract, confirmed + idempotent), `set_worker_grants`
(`workers:admin`; replaces a versioned grant set after validation, no
silent defaults), `list_clients` / `revoke_client` (`workers:admin`;
revocation proven at the front door within the measured window),
`approve_action` (`actions:approve`; approves/denies an exact proposed
external action). No `create_workers` — see §4.

Read tools and resources call the same core query functions so
authorization and projections cannot drift. This table is complete and
binding; no other document defines the tool surface.

### 7.4 MCP resources

Stable URIs, read-only, paginated where unbounded, annotated with
`lastModified` + provenance + staleness, zero model invocation; large
payloads return R2-backed references:

`resident://account/status`, `resident://account/workers`,
`resident://workers/{id}/status|tasks|decisions|events|plan|tests|outputs|cost`,
`resident://workers/{id}/workspace/diff`,
`resident://workers/{id}/turns/{turnId}/ledger`.

Long tool calls emit MCP progress notifications at a cadence that beats the
strictest client idle window (Claude Code: 5-minute idle timeout).

### 7.5 Error contract

Envelope: `errorKind`, safe `message`, `requestId`, `retryable`, optional
`retryAfter`, redacted `details`. Kinds: `unauthorized`, `forbidden_scope`,
`not_found`, `invalid_request`, `conflict`, `rate_limited`,
`quota_exceeded`, `blocked`, `unavailable`, `reconciliation_required`,
`internal_error`. Unknown failures map to `internal_error` at the client
boundary with the classified root cause preserved in operator evidence.

### 7.6 Worker and turn lifecycle

Worker: `creating → idle ↔ running → blocked | failed | stopped →
destroying → destroyed`. One mutating turn per Worker (queue or `conflict`,
declared in the result). Reads stay available during turns. `blocked`
carries the latest successful checkpoint. `destroyed` ids are never reused.

Turn: `queued → starting → running → succeeded | failed | blocked |
cancelled | reconciliation_required`. Terminal states immutable except an
audited, force-gated stale-run reconciler. The Workflow claims the turn
after it exists and reports its run id back (idempotent claim). Fan-in
dedupes by `turnId`. CLI executions carry their own operation id and
reconciliation record. **Mid-turn kill semantics (decided):** safe
idempotent restart completing without duplicate effects, plus truthful
terminal states; process reattachment is not promised.

### 7.7 Memory contract

Authority classes (completion/verification/cost/blocked projections may
derive **only** from 1–2):

1. **Observed evidence** — command results, provider ids, timestamps,
   hashes, backup handles, Workflow/Sandbox state.
2. **System projections** — task status, readiness, lifecycle, blocked,
   cost roll-ups; rebuildable from events (projection version + source
   sequence recorded).
3. **Declared decisions** — Worker-authored decision events with rationale
   and evidence refs; provenance `worker_claim`.
4. **Narrative** — plan and summaries; explicitly non-authoritative.

Spike schema (minimal): append-only sequence-ordered event/decision log
(schema-versioned), typed task graph (arrives with M2a — the first real
turn needs it), workspace checkpoint record (backup id, manifest, HEAD/tree/
diff digests), artifact references, interpretive plan document. **FTS5 and
condensation are post-spike.** Compaction may hide events from model
context; it may not rewrite the log within retention.

### 7.8 Grants and external actions (the authority split)

Versioned grant set per worker: repo + allowed refs/branch patterns,
built-in tool allowlist, network host allowlist, per-action
`deny`/`allow` (+ reserved `require_approval`), optional expiry and
spend/concurrency limits. Default deny. Grants narrow account policy, never
widen.

- The Brain never holds or triggers a write-capable GitHub credential.
  Read-only clone/pull credentials may be injected at the egress boundary.
- Push, PR, comment, merge run as deterministic Worker-side integrations
  with distinct write credentials, idempotency keys (retry-safe branch
  names, PR lookup keys, comment markers), and recorded provider object
  ids; ambiguous provider failures reconcile before retry.
- Spike-fixture grant defaults (PROPOSED; decider: founder before M2a):
  clone/read, push to worker-prefixed branch, open PR, comment = allow;
  merge, delete branch = deny.
- Client revocation vs in-flight authorized actions: policy TBD before M4
  (decider: founder).

### 7.9 Fan-out and status roll-up

Client-looped `create_worker` (§4). Accepted work survives client
disconnect. Account status is served from the registry read model — never
by waking Worker models. Rows carry lifecycle state, active/latest turn,
blocker, outputs, recorded cost, `lastChangedAt`, external-source freshness
(a recorded PR link is not current GitHub state; source + observation time
required). Freshness SLA: TBD from M0 measurement (decider: founder at
decision review).

### 7.10 Blocked state

Fields: `reasonKind`, `reportedBy`, `since`, `summary`, `requestedAction`,
`retryable`, `evidenceRefs`, `lastSuccessfulCheckpoint`, optional
`credentialTypeNeeded` (never a value), optional escalation time. Reason
kinds: owner decision, missing grant, missing credential, verification
failure, external service failure, quota, conflicting writer, persistence
corruption, memory/workspace drift, unknown-classified. `resolve_block`
appends; it never overwrites the original blocker. Unevidenced worker
claims of blockage carry provenance `worker_claim`.

### 7.11 Owner surfaces (no dashboard)

Consent/authorization page (required by OAuth), owner-scoped MCP tools, and
an out-of-band recovery CLI that can revoke every client, stop all work,
and recover from a broken front door. These are in scope; a dashboard is
not.

## 8. Non-functional requirements

**Latency.** Mutations acknowledge well under the strictest client default
(60 s; SLO TBD from M0 method). Sleeping-worker end-to-end answer:
provisional target < ~15 s — hard-gate status confirmed by founder at
decision review, warm-pool cost as the explicit alternative. Phase-level
recording: DO wake, first SQL read, Workflow create, sandbox start,
restore, Brain start, first progress, final answer. One real deployed
24-hour idle test is mandatory. Vendor numbers (2 s restore / 30 s cold)
are baselines to re-measure, never acceptance values. Benchmark method
(sample count, region, cache state, retry treatment) is versioned in M0.

**Reliability.** All mutations/effects idempotent; at-least-once delivery
never duplicates effects; incremental writes (no shutdown hooks assumed);
backup integrity verified before discarding the prior checkpoint; no
running/queued lease unexamined beyond a reconciliation interval (value TBD
from M0 fault tests); versioned schema migrations (constructor
`CREATE TABLE IF NOT EXISTS` is insufficient for evolution).

**Security.** Fail-closed auth/audience/scope/ownership/grants/allowlists/
integrity, exercised through the deployed entry point with allow-path
controls. Sandbox egress deny-by-default beyond approved hosts. Credentials
never in Brain env, argv, filesystem, logs, crash output, backups, or MCP
responses — enforced by the secret-canary scan. Physically distinct
dev/preview/prod resources, proven by deployed fingerprints, not config
files. No cross-owner existence disclosure. Jurisdiction: TBD before M1
(decider: founder; DO placement is permanent).

**Cost visibility.** Per turn: DO, Workflow, Sandbox, R2, model usage with
provenance `observed`/`derived`/`unknown` — `unknown` never rendered as
zero. Go/no-go cost threshold: TBD before M5 (decider: founder). "Sane" is
not a criterion.

**Change control.** Exact versions pinned in lockfile and ledger; M0
generates the authoritative dependency manifest from registries (prose
version claims in research docs do not drive the build); re-resolve at
kickoff and midpoint; upgrades require contract/e2e reruns. Sandbox stable
vs `@next`: decided at M0 from current vendor recommendation.

## 9. Testing requirements

### 9.1 Gate rule

No feature milestone begins until the M0 harness can: deploy an isolated
environment, launch a run, collect a complete core ledger, inject a named
fault, and produce an independent pass/fail verdict. **The evaluator is
deterministic, lives in a protected path implementing agents cannot edit,
and derives verdicts only from ledger evidence.**

### 9.2 Test layers

Unit; local integration (`@cloudflare/vitest-pool-workers` — real workerd:
DO SQLite/alarms via `runInDurableObject`/`runDurableObjectAlarm`/eviction
helpers; Workflows via `introspectWorkflow` + `mockStepResult`/`mockEvent`/
`disableSleeps`); deterministic e2e (fake Brain, below); real deployed e2e
(containers, hibernation timing, OAuth, billing — everything the research
proved local emulation cannot reach); real-Brain canary (one pinned CLI,
objective verification, OpenHands-style cadence); real-client canary
(Claude Code OAuth + Codex CLI static token as gates; ChatGPT web/mobile as
canaries).

### 9.3 Deterministic Brain

A fake Brain executable (testagent-style: argv-compatible, deterministic
stream frames, zero tokens) mutates a known fixture and supports named
barriers: before-clone, after-clone, before-mutation, after-mutation,
during-execution, before-verification, before-fan-in. It can sleep, exit
nonzero, emit malformed output, and be killed. It is the regression oracle
and fault-injection target; all state-machine, idempotency, restore, and
evidence gates pass with it.

### 9.4 Fixture and oracle (M2a entry criterion)

Named fixture repo, pinned commit, expected patch, expected test outcome,
final repository digest — and an oracle-green-before-change run proving the
fixture's own test suite passes pre-change (SWE-bench leakage/flakiness
lesson). The spike uses **one** pinned fixture. **v1 acceptance runs the
story-derived e2e suite against at least two real sample projects** (the
founder's plural requirement lands at v1, not the spike).

### 9.5 Evidence bundle

**M0 core (entry bar):** correlation ids (request/account/client/worker/
turn/workflow-run), sequence-numbered status transitions with timestamps
and attempt numbers, verification command argv/cwd/exit codes with redacted
output refs, before/after workspace digests, redaction + secret-canary
result, independent verdict. **Full v1 bundle** adds: deployment id, source
commit, dependency-lock digest, environment fingerprints, grant snapshot
hash, DO/container/image/backup ids, brain/model/gateway/billing
provenance, external-action records, phase latencies, cost components —
each attached at the milestone that produces it. A run is not passing if
required evidence is missing, identifiers disagree across layers,
verification exists only in prose, an unclassified error occurred, a secret
appears in evidence, or an external action cannot be reconciled.

### 9.6 Platform-trap criteria (from research; binding)

- M3: backup-GC rule (R2 lifecycle rule or sweeper — expired squashfs
  objects must not accumulate) and the `mksquashfs` permission test
  (0600/0700 dotfiles included in manifest round-trip).
- M4a: revocation as measured-window (§7.2).
- M0: container stdout→observability probe (issue #12998 closed without a
  named mechanism) and HTTPS-interception local/prod parity probe — both
  run in M0, before any later milestone relies on them.
- M5: BYOK `default`-alias check before cost capture (silent Unified
  Billing fallback would invalidate the comparison).

## 10. Milestones and success metrics

Detailed execution in [spike-plan.md](spike-plan.md). Timebox ~3 weeks
after P0.

| Milestone | Pass criteria (summary) |
|---|---|
| **P0 — Provisioning (human)** | Founder provides: Workers Paid account + payment method, least-privilege API token + account id, domain/DNS decision, IdP choice, GitHub App on a disposable fixture repo, Anthropic key (or AI Gateway BYOK), client accounts (Claude Code; Codex CLI), budgets/ceilings. Each item has the founder as named decider. Nothing else starts until P0 completes. |
| **M0 — Harness** | Isolated deployed env fingerprinted; deterministic Brain runs; named fault injected; core ledger completeness and redaction machine-checked; independent evaluator demonstrably catches a deliberately corrupted evidence item; benchmark method + dependency manifest versioned; static-token design written. |
| **M1 — Thin worker spine** | One MCP call routes to the correct named DO; duplicate create idempotent; minimal event state survives wake; alarm fires; 24-h soak launched. Wake p50/p95 recorded per M0 method. |
| **M4a — Front door** | Claude Code completes OAuth (CIMD/DCR) and tasks a Worker; Codex CLI via static token **performs an allowed Worker operation** and passes the applicable refusal matrix (expiry, denied scope, foreign worker, revoked token) — both auth modes fully exercised; allow paths proven deployed; revocation measured-window recorded; Nth-worker consent behavior recorded. |
| **M2a — Brain in a box** | Pinned real Brain completes the pinned fixture (§9.4); Worker verifies independently; zero credential leakage (canary scan); no external writes. |
| **M3 — Persistence** | Manifest + digests round-trip sleep/restore; next-day follow-up correct; corrupt/missing-backup → typed state; backup-GC + permission tests pass. **After M2a+M3: the full hibernated-worker→final-answer latency benchmark** runs per the M0 method (M1 wake and M3 restore phases alone cannot satisfy §8) — this number feeds the decision gate. |
| **M2b — Recovery** | Faults at named barriers (§9.3): the **during-execution kill must restart idempotently and complete without duplicate effects** — `reconciliation_required`/`failed`/`blocked` on that barrier fails the unattended gate. Unrecoverable injected faults (e.g. corrupt backup) may land typed terminal states. Includes **one disposable Worker-side GitHub write** (comment or PR on the fixture repo) with a fault injected after provider success and before ledger acknowledgement — reconciliation must return the same provider object id with no second effect. No orphaned process unrecorded. |
| **M4b — Product shape (evidence, not gate)** | Client-looped fan-out (≥3 workers), account roll-up without model wake, blocked→cross-client resolve — all recorded as evidence for the decision review. |
| **M5 — Cost, then swap** | **Cost is go-gating:** usage categories (including storage and egress, or `unknown` with provenance) captured from real provider evidence; BYOK alias proven; cost vs founder threshold. **The model-swap study is evidence, not gate** (memory design is not a platform property): frozen rubric, memory-only structurally denies workspace access, two swap points. |
| **Cloudflare go** | **Substrate-gated:** M0, M1, M4a, M2a, M3, M2b pass; the full-chain latency target met or mitigation costed; M5 cost under the founder threshold; no security, duplicate-effect, restore-integrity, or evidence-completeness blocker. M4b and the swap study inform, do not gate. |
| **Fork/hybrid** | Auto-return-to-fork on any platform-level inability to: enforce the credential/authority boundary, avoid duplicate external effects, restore exact workspace state, support real client auth, or produce independent evidence. Latency/cost misses may yield hybrid if mitigation is measurable. |

## 11. Founder-input register

Blocking P0: account/billing, API token, domain/DNS, IdP, GitHub App,
Anthropic key, budgets. Blocking M1: jurisdiction. Blocking M2a: grant
defaults (§7.8). Blocking M5: cost threshold. Decision review: latency
hard-gate, freshness SLA, retention values, destroy semantics, new-repo
name. All carry "decider: founder."
