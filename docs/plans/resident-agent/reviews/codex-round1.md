# Codex round 1 — review, PRD, unattended-build gap check

Model: gpt-5.6-sol, reasoning_effort=xhigh, read-only over the full package in
the worktree. Returned 2026-08-11. Thread: 019ff290-2f63-7803-997a-ddbb6f7ebd9b.
Content below is Codex's output verbatim (link formatting normalized to plain
file names).

---

## A. Critical review

The Cloudflare substrate is plausible, but the package is not yet build-executable. Its weakest area is the control plane—authorization, registry, recovery, side-effect containment, and proof—not the Durable Object/Sandbox mapping.

### Findings

1. **"Any agent, anywhere is solved" is overstated.** Dynamic client registration solves client registration, not Owner authentication, consent, grants, or unattended machine access. README.md § "What the research confirmed" says this is solved, while § "What the second wave added" and mcp-client-landscape.md § "Fit for resident agent service" establish that OAuth requires a human consent event, Codex's clean headless path is a non-OAuth bearer token, ChatGPT registration is web-only, and mobile behavior is unverified. Story 1 must say "no manual client pre-registration," not "without human setup."

2. **The credential design confuses secret possession with authority.** resident-agent-service.md § "Key design principles" says clone/push/PR are deterministic Worker-owned tools and the Brain cannot perform them, but spike-plan.md § M2 proposes injecting GitHub credentials into traffic originating inside the Brain's container. Network injection prevents the Brain from reading a token; it does not prevent it from issuing a request that the proxy authenticates. A write-capable GitHub token attached to all `github.com` traffic effectively gives the Brain write authority. Clone/pull must use a read-only credential, while push/PR/comment must run outside the container through a separately granted Worker operation.

3. **The package has no account registry design, although the canonical product requires one.** Stories 16, 19, 21, and 22 require enumeration, fan-out, account roll-up, recorded outputs, and blocked-state aggregation, but spike-plan.md § "Explicit non-goals" excludes a multi-worker registry. Durable Object namespaces are not an account query surface. The plan needs a canonical account index/read model—physical storage TBD—or it cannot demonstrate the founder's main backlog/status flows.

4. **The one-service-endpoint versus one-endpoint-per-worker decision is missing.** The client research repeatedly raises "Nth-worker consent," but this should not remain an empirical accident. A single account/service MCP endpoint with `workerId` parameters permits one client registration and one grant relationship; a per-worker endpoint risks OAuth consent and connector configuration per task. This decision changes routing, token audience, client packaging, and unattended fan-out and must precede M1.

5. **M2 promises durability at the wrong abstraction.** spike-plan.md § M2 acknowledges that the reference implementation orphans a running `claude -p` process, then requires the turn to survive an intentional mid-run kill. Workflow checkpoints can replay completed steps; they cannot resume the instruction pointer or I/O stream of an external CLI process. "Survive" must mean either reattach/reconcile the process or restart idempotently and complete without duplicate effects. A terminal `unknown_reconcile` state is useful evidence, but it is a failed unattended-operation gate, not a successful resume.

6. **Persistence is sequenced after the feature that already needs it.** M2's kill/retry behavior depends on a recoverable workspace, while M3 introduces backup/restore later. Reorder persistence before the full recovery test: first run a real Brain, then prove workspace checkpoint/restore, then inject kills at defined boundaries. The backup contract also needs to name every included directory: `.git`, untracked files, Brain session state/dotfiles, dependency caches, and permission metadata. sandbox-sdk.md § "Lifecycle & persistence" makes clear that a directory backup and an ephemeral overlay are not a full VM snapshot.

7. **"Truth tables" is stronger language than the proposed memory can support.** memory-architectures.md § "Recommended shape" correctly distinguishes event history from narrative, but task status, decisions, and blocked reasons can still be written by a model. An append-only record of a model assertion is provenance, not proof. The schema must distinguish mechanically observed facts, system-derived projections, Worker claims, and narrative interpretation; completion or verification status may depend only on the first two.

8. **M1 is overbuilt for a platform spike.** It combines DO routing, alarm behavior, a typed dependency graph, FTS5, an event/decision store, and narrative memory before the front door or Workflow path has been proven. Keep only minimal worker state plus the evidence events required by M0. Full FTS indexing, condensation, and narrative generation should follow a functioning turn and restore path.

9. **M5 combines three experiments with no fixed oracle.** spike-plan.md § M5 includes provider switching, two memory conditions at two swap points, and multi-component cost attribution. The anti-lobotomy rubric has named failure modes but no pass threshold, while "cost/task is sane" is undefined. Cost instrumentation should precede provider comparison; the memory study should use a seeded deterministic oracle and thresholds fixed before the run.

10. **The latency and cost gates are not reproducible yet.** The `< ~15 s` sleeping-worker target is a legitimate provisional product target from § "Decision gates," but the plan does not define sample count, p50/p95, region, fixture size, image-cache state, retry treatment, or the start/end timestamps. Likewise, cost requires a billing source and accounting window; real provider billing may lag. M0 must version the benchmark method, with sample count and allowed error rate marked TBD until that method is approved.

11. **"No UI" conflicts with required protocol and recovery surfaces.** stories.md § "Explicit non-stories" excludes a human-facing UI, but OAuth still requires Owner authentication and consent, while Story 2 needs emergency client revocation. The product can omit a dashboard, but it cannot omit an authorization/consent page and an out-of-band bootstrap/recovery CLI or equivalent administrative path.

12. **The risk ranking prices market urgency as if it were a substrate risk.** "Competitive window" belongs in product strategy, not the spike's technical risk ranking. Security/authorization and side-effect containment are absent and should rank first; turn idempotency/recovery and persistence should follow; client auth/interoperability should be next. Cold latency and cost matter only after the system can prove that the correct worker ran safely and exactly one externally visible effect occurred.

13. **The package already contains version drift despite being compiled on one date.** agents-sdk-and-mcp.md § "OAuth for MCP" reports `workers-oauth-provider` 0.4.0, while examples-and-boilerplates.md § "Status / maturity" reports 0.10.3 and official examples pinned to 0.8.1. M0 must generate the authoritative dependency manifest from registries/docs at kickoff; prose version claims cannot drive the build.

14. **The competition claim should be narrower.** prior-art-and-competition.md § "Fit" says no exact product exists, but its own open questions leave third-party Devin MCP wrappers unresolved. The defensible claim is: "No confirmed vendor-native product combining all three properties was found as of 2026-08-11."

### Recommended spike order

1. **M0 — evidence and deployed-e2e harness:** isolated dev resources, deployment fingerprinting, deterministic Brain, fault injection, ledger, independent pass evaluator, and real-entry-point auth/security tests.
2. **M1 — thin worker spine:** one service endpoint, opaque worker identity, minimal account registry, minimal event ledger, named DO routing, idempotent turn start, alarm smoke; start the 24-hour soak immediately.
3. **M4a — front door early:** Claude Code OAuth/DCR/PKCE, Owner consent, expired/revoked/denied/cross-worker cases, and the OAuth-only versus static-bearer decision.
4. **M2a — one real Brain:** deterministic fixture task, pre-baked image, read-only repository acquisition, independent diff/test verification, no external writes.
5. **M3 — workspace persistence:** explicit backup manifest, before/after hashes, restore after sleep, repeated cold/restore measurements.
6. **M2b — recovery:** fault injection before, during, and after the CLI process and Workflow fan-in; prove safe retry/reconciliation and absence of duplicate side effects.
7. **M4b — product-shape proof:** second client, batch creation, account roll-up, blocked state, and connector behavior.
8. **M5 — cost, then model continuity:** prove attribution first; run the model-swap study only with a precommitted rubric.

Cut from the two-week critical path: git-on-s3fs, full memory condensation, ChatGPT mobile writes, a second Brain, worker-to-worker delegation, and subjective model-swap scoring. ChatGPT mobile read-only status and the full anti-lobotomy matrix are useful canaries, not prerequisites for validating the substrate.

---

## B. PRD — resident agent service (spike-scoped v1)

### 1. Product definition

The resident agent service provides one durable Worker per coding task. External agent clients connect to one account-level MCP endpoint, authenticate as Visitors acting for an Owner, and create, task, question, inspect, stop, or repair Workers without receiving direct sandbox access.

Each Worker owns durable structured memory and coordinates a sandboxed Brain. The Worker—not the Brain—owns grants, verification, persistence, externally visible actions, and the evidence ledger.

### 2. Problem statement

Coding-agent sessions currently fragment context across clients, devices, and model vendors. A file workspace alone does not preserve task intent, decisions, blockers, verification evidence, or the ability for a different client to resume work safely.

The service must make task ownership durable and client-neutral while preventing a model's self-report or a sandbox's possession of files from being treated as proof of what occurred.

### 3. Goals

- Prove that a named Worker can hibernate, wake, execute a real coding turn, restore its workspace, and remain addressable through one MCP service endpoint.
- Let multiple independently authenticated Visitors use the same Worker and receive the same authoritative state.
- Separate cheap structured reads from model-generated narrative.
- Keep raw repository and model credentials outside the Brain container.
- Make all mutations idempotent and all externally visible effects grant-controlled and auditable.
- Produce enough independent evidence to decide Cloudflare versus the existing fork without trusting agent narration.
- Measure—not estimate—latency and attributable cost for the spike fixture.

### 4. Non-goals

- General-purpose human dashboard. Login, consent, and emergency administrative recovery surfaces are still required.
- Teams, organizations, shared ownership, subscriptions, or customer billing.
- Worker-to-worker delegation in spike v1; Stories 14–15 remain specified but deferred.
- More than one production Brain profile. M5 swaps the Worker's owner model; cross-Brain replacement is a fast-follow.
- Sandbox portability across providers.
- Arbitrary Visitor access to shell execution or raw sandbox RPC.
- Production-scale rate tuning, warm pools, or broad repository support.
- Production use of `@cloudflare/computer`.

### 5. Personas and trust

- **Owner:** Human root authority for one account. Provisions identity, repositories, credentials, policies, budgets, and client access; may act through a Visitor but retains an out-of-band recovery path.
- **Visitor:** External agent client authenticated to the account. It is untrusted beyond its granted scopes and per-worker permissions.
- **Worker:** Durable task owner and single-writer coordinator. It owns lifecycle state, structured memory, grants, Workflow IDs, verification, and external actions.
- **Brain:** Pluggable coding-agent CLI inside a sandbox. It is semi-trusted: it may read and mutate its workspace but cannot possess write credentials, alter authoritative ledger records, approve its own actions, or declare itself verified.

### 6. User stories and acceptance criteria

| Story | Scope | Refined acceptance criteria |
|---|---|---|
| 1 | Spike/v1 | A conforming client can discover metadata and dynamically register without pre-created client credentials. One-time Owner login/consent is explicitly allowed and recorded; registration alone grants no account access. |
| 2 | v1 | An Owner-authorized Visitor or recovery CLI can list client identity, scopes, grant time, last use, and status, then revoke it. Subsequent calls fail through the deployed front door. |
| 3 | Spike/v1 | Every request is checked against account ownership, OAuth scope, worker grant, and action policy. Foreign workers are returned as non-disclosing `not_found`; denial is recorded without sensitive details. |
| 4 | Spike/v1 | `create_worker` accepts repo, instructions, grants, profile, and idempotency key; it returns `workerId` and initial `turnId` without waiting for work. Repeating the key returns the same result. |
| 5 | Spike/v1 | Repository acquisition uses a Worker-controlled, read-only credential path. The Brain receives no raw token and cannot use the injected path for push, PR, comment, merge, or branch deletion. |
| 6 | v1 | Before mutation, the Worker records a task graph and an interpretive plan. Each update carries actor, timestamp, schema version, and evidence references; the plan never determines completion status. |
| 7 | Spike/v1 | The Brain's result is independently checked with configured test commands, workspace hashes, and diff inspection. If verification cannot run, the turn is blocked or failed—not successful. |
| 8 | Spike/v1 | `ask_worker` starts an asynchronous narrative turn and returns a `turnId`. Its eventual answer cites structured-state/event identifiers and never substitutes a raw transcript. |
| 9 | Spike/v1 | Task graph, decisions, plan, status, outputs, costs, and ledger are readable without a model call. Evidence shows zero model invocation for these reads. |
| 10 | Spike/v1 | Authorized Visitors can inspect diff, branch/head, selected files, test results, output records, and backup manifest. Paths are normalized and traversal outside the workspace is refused. |
| 11 | Spike/v1 | After a real 24-hour idle period, an addressed Worker wakes with the same identity and memory. Workspace restoration occurs only when the requested operation needs it; latency phases are recorded. |
| 12 | Spike/v1 split | M5 proves swapping the Worker's owner model without losing recorded task/decision state. Swapping the Brain implementation is deferred and must not be claimed as launch capability. |
| 13 | Spike/v1 | Backup/restore preserves the declared workspace manifest and exact before/after digests across sandbox sleep. Missing or corrupt backup state produces a typed blocked/failed state. |
| 14 | Deferred | Worker-to-worker tasking will use the same service contract with explicit delegated identity and grant narrowing. No implementation is required in the spike. |
| 15 | Partial | The account registry must list all root Workers in v1. Nested-worker ancestry and spend roll-up are deferred with Story 14. |
| 16 | Spike/v1 | Authorized operations list, stop, archive/destroy, and audit Workers. Destruction follows the declared retention contract and cannot silently erase required audit evidence. |
| 17 | Spike/v1 | Grants are per worker and per action with `deny`, `allow`, or `require_approval`; default is deny. The Brain cannot widen grants or approve its own action. |
| 18 | Spike/v1 | Status includes attributable DO, Workflow, Sandbox, storage, egress, and model usage, plus `unknown` with a reason where attribution is unavailable. |
| 19 | Spike/v1 | A batch request containing more than one fixture task creates one Worker per accepted item, survives client disconnection, and reports each item independently. |
| 20 | Spike/v1 | Exceeding a configured concurrency, queue, or spend limit returns a typed partial result with accepted, queued, and rejected items plus retry guidance. Exact limits are TBD from account capacity and Owner budget. |
| 21 | Spike/v1 | One model-free account query returns authorized Workers, status, timestamps, blockers, output links, source/freshness metadata, and cost. It does not wake Worker models. |
| 22 | Spike/v1 | Blocked state records typed reason, provenance, evidence, requested resolution, time entered, and whether retry is safe. Blocked is never represented as idle. |
| 23 | Spike/v1 | A differently authenticated Visitor can inspect a blocked Worker and submit instructions or a resolution through the Worker. It cannot mutate the sandbox directly or bypass grants. |
| 24 | v1 | Deliver versioned Claude Code configuration/skill, ChatGPT connector instructions, and Codex CLI configuration. Each states its auth mode, setup requirements, timeout behavior, and verified capability limits. |
| 25 | Added | The Owner can bootstrap an account, identity provider, repository installation/allowlist, default grants, and emergency recovery credential before Visitors connect. |
| 26 | Added | Every mutation accepts an idempotency key; Workflow callbacks and external actions deduplicate by stable operation ID. Retries never create a second Worker, commit, PR, or comment. |
| 27 | Added | Externally visible actions are proposed with exact repo/ref/payload and grant decision before execution; execution records provider object IDs and independently observed outcomes. |
| 28 | Added | Every turn emits the evidence bundle defined below. The Worker/Brain cannot mark the run passing; an independent evaluator derives the verdict. |
| 29 | Added | Faults at each durable boundary result in safe completion, safe retry, or a typed failed/blocked state; they never leave an unbounded lease, silent idle state, or untracked external process. |
| 30 | Added | Retention, redaction, export, PITR, archive, and destruction behavior are explicit for memory, logs, backups, OAuth data, and external-output records. Values are TBD by the Owner's privacy policy. |
| 31 | Added | Credentials needed to unblock work are supplied by secret reference or policy change, never in task text, MCP output, event payload, or Brain environment. |

### 7. Functional requirements

#### 7.1 Identity, addressing, and topology

- The public product exposes one account-level MCP endpoint. Per-worker endpoints are out of scope.
- Worker identity is an immutable opaque `workerId`; task slugs and titles are mutable display data and cannot be addressing keys.
- A Worker DO is addressed from a collision-resistant account/worker key. Exact encoding is an implementation detail, but it must not expose repo or task names.
- A canonical account registry/read model is mandatory because DO namespaces cannot provide Story 21. Its physical implementation is **TBD during M0**: choose an Account DO, D1, or another Cloudflare store based on consistency, enumeration, fan-in load, data locality, and deployed tests.
- The Worker DO is the only writer of authoritative Worker/turn state. Workflows report results through idempotent callbacks; they do not independently mutate Worker memory.
- The Sandbox SDK's DO/container identity is distinct from the Worker unless M0 proves a safe unified class. The ownership choice must be recorded in an ADR before M1.

#### 7.2 OAuth and scopes

Required OAuth scopes:

- `account:read` — account roll-up and attributable cost.
- `workers:read` — worker status, memory, ledger, and workspace inspection.
- `workers:write` — create/task/ask/cancel/resolve/stop.
- `workers:admin` — destroy workers, manage grants, list/revoke clients.
- `actions:approve` — approve externally visible operations.

Requirements:

- OAuth 2.1 authorization-code flow with PKCE and DCR/CIMD support.
- DCR creates client metadata only; Owner authentication and consent create the grant.
- Identity provider is **TBD before M0 provisioning**; decide based on the Owner's account system and supported callback flow.
- OAuth metadata, audience/resource checks, expiry, revocation, and scopes fail closed through the deployed MCP entry point.
- OAuth-only versus OAuth plus static bearer tokens is **TBD before M4a**. The deciding requirement is whether unattended Codex/CI clients must connect without any interactive OAuth bootstrap.
- One authorization must cover authorized Workers behind the service endpoint; Worker grants provide resource-level narrowing.
- Every request records stable client identity and the effective scope/grant snapshot hash.

#### 7.3 MCP tool surface

All mutations return promptly with IDs; they never wait for a coding turn. Every result includes `requestId`, status, and typed error information where applicable.

| Tool | Minimum scope | Contract |
|---|---|---|
| `whoami` | authenticated | Return Owner/account ID, client ID, scopes, auth mode, and grant summary. |
| `create_worker` | `workers:write` | Create one Worker and initial turn using an idempotency key. |
| `create_workers` | `workers:write` | Batch create with per-item idempotency and independent accepted/queued/rejected results. |
| `task_worker` | `workers:write` | Submit instructions as a new turn; return `turnId`. |
| `ask_worker` | `workers:write` | Start an owner-model narrative/query turn; return `turnId`. |
| `get_worker_status` | `workers:read` | Deterministic read-model status; no model wake. |
| `get_account_status` | `account:read` | Deterministic account roll-up with pagination/filtering. |
| `get_turn` | `workers:read` | Return turn state, progress, output references, errors, and ledger URI. |
| `cancel_turn` | `workers:write` | Request cancellation; report whether cancellation, reconciliation, or terminal no-op occurred. |
| `resolve_block` | `workers:write` | Attach a decision, grant change, or secret reference and optionally start a retry turn. |
| `stop_worker` | `workers:write` | Prevent new turns and reconcile active work without erasing state. |
| `destroy_worker` | `workers:admin` | Execute the declared deletion/retention contract with confirmation and idempotency. |
| `set_worker_grants` | `workers:admin` | Replace a versioned grant set after validation; no silent defaults. |
| `approve_action` | `actions:approve` | Approve or deny an exact proposed external action. |
| `list_clients` | `workers:admin` | List connected clients and effective grants. |
| `revoke_client` | `workers:admin` | Revoke the client and prove refusal at the front door. |

Read tools and resources must call the same core query functions so their authorization and projections cannot drift.

#### 7.4 MCP resources

Required stable URI templates:

- `resident://account/status`
- `resident://account/workers`
- `resident://workers/{workerId}/status`
- `resident://workers/{workerId}/tasks`
- `resident://workers/{workerId}/decisions`
- `resident://workers/{workerId}/events`
- `resident://workers/{workerId}/plan`
- `resident://workers/{workerId}/workspace/diff`
- `resident://workers/{workerId}/tests`
- `resident://workers/{workerId}/outputs`
- `resident://workers/{workerId}/cost`
- `resident://workers/{workerId}/turns/{turnId}/ledger`

Resources are read-only, paginated where unbounded, annotated with `lastModified`, provenance, and staleness, and served without model invocation. Large logs/files return R2-backed references rather than exceeding MCP or Workflow payload limits.

#### 7.5 Error contract

The shared envelope must include:

- `errorKind`
- safe `message`
- `requestId`
- `retryable`
- optional `retryAfter`
- redacted structured `details`

Required kinds: `unauthorized`, `forbidden_scope`, `not_found`, `invalid_request`, `conflict`, `rate_limited`, `quota_exceeded`, `blocked`, `unavailable`, `reconciliation_required`, and `internal_error`. Unknown failures map to `internal_error` at the client boundary while preserving the classified root cause in operator evidence.

#### 7.6 Worker and turn lifecycle

Worker states:

`creating → idle ↔ running → blocked | failed | stopped → destroying → destroyed`

Rules:

- Only one mutating owner/Brain turn may run per Worker. New turns are queued or return `conflict`; the behavior is declared in the request result.
- Read-only resource queries remain available during a turn.
- `blocked` includes the latest successful checkpoint and is not terminal unless policy says so.
- `stopped` rejects new work but preserves inspectable state.
- `destroyed` is terminal and cannot be reused as a Worker identity.

Turn states:

`queued → starting → running → succeeded | failed | blocked | cancelled | reconciliation_required`

- Terminal states are immutable except an audited, force-gated stale-run reconciler.
- The Workflow claims the turn only after it exists and reports the run ID back to the Worker.
- Final fan-in is deduplicated by `turnId`.
- CLI/process execution has its own stable operation ID and reconciliation record.
- Cancellation is best effort but must converge to a truthful state.

#### 7.7 Memory contract

Authoritative storage classes:

1. **Observed evidence:** command results, provider IDs, timestamps, hashes, backup handles, Workflow/Sandbox state.
2. **System projections:** task status, dependency readiness, lifecycle status, blocked status, cost roll-up.
3. **Declared decisions:** Worker-authored decision events with rationale and evidence references.
4. **Narrative:** plan and story-altitude summaries; explicitly non-authoritative.

Required logical schema:

- Typed task graph with typed dependency edges.
- Append-only, sequence-ordered, schema-versioned event/decision log.
- Artifact references for tests, diffs, backups, outputs, and large logs.
- Interpretive plan document.
- FTS5 index over safe searchable fields; full payloads containing sensitive data are excluded or redacted.
- Projection version and source-event sequence so read models can be rebuilt.
- Workspace checkpoint record containing backup ID, manifest, HEAD/tree/diff digests, and creation time.

Completion, verification, cost, and blocked projections cannot be set solely from Brain or Worker prose. Compaction may hide old events from model context but may not rewrite the underlying log within its retention period.

Retention and legal deletion values are **TBD before M0 schema finalization**, decided by the Owner's privacy/compliance requirements. "Append-only" means application history within retention, not exemption from deletion obligations.

#### 7.8 Grants and external actions

A worker grant set is versioned and contains:

- Repository owner/name and allowed refs/branch patterns.
- Built-in tool allowlist.
- Network host allowlist.
- Actions: clone/read, push, open PR, comment, approve/request changes, merge, delete branch.
- Per action: `deny`, `allow`, or `require_approval`.
- Optional expiry and spend/concurrency limits.

Rules:

- Default deny.
- Grants can narrow account policy but never widen it.
- The Brain receives no write-capable GitHub credential.
- Read-only clone/pull credentials may be injected at the egress boundary.
- Push/PR/comment/merge execute through deterministic Worker-side integrations using distinct write credentials.
- External actions use idempotency keys and record provider object IDs.
- Client revocation does not cancel already-authorized external actions unless account policy explicitly says so; this policy is **TBD before M4**.

#### 7.9 Fan-out and status roll-up

- `create_workers` returns per-item results; a single invalid item does not roll back accepted items.
- Each item has its own idempotency key, Worker ID, turn ID, grants, and cost attribution.
- Quota response distinguishes accepted, queued, and rejected items.
- Disconnecting the Visitor cannot cancel accepted work.
- Account status is served from a materialized read model and never by querying Worker models.
- Each row includes lifecycle state, active/latest turn, blocker, outputs, recorded cost, `lastChangedAt`, external-source freshness, and stale/error indicators.
- External PR/CI state must identify its source and observation time; a recorded PR link is not automatically current GitHub status.
- Freshness SLA is **TBD from M0 measurements and GitHub webhook/poll design**.

#### 7.10 Blocked state

Required fields:

- `reasonKind`
- `reportedBy`
- `since`
- `summary`
- `requestedAction`
- `retryable`
- `evidenceRefs`
- `lastSuccessfulCheckpoint`
- optional `credentialTypeNeeded`, never its value
- optional expiry/escalation time

Minimum reason kinds: Owner decision, missing grant, missing credential, verification failure, external service failure, quota, conflicting writer, persistence corruption, memory/workspace drift, and unknown classified failure.

`resolve_block` creates an event; it does not overwrite the original blocker. If a Worker merely claims it is blocked without system evidence, provenance must say `worker_claim`.

### 8. Non-functional requirements

#### Latency

- `create_worker`, `create_workers`, `task_worker`, and `ask_worker` must return IDs before the shortest documented target-client default timeout: Codex CLI's 60 seconds. The actual acknowledgment SLO is **TBD from M0**, and should be materially below that limit.
- Sleeping-worker end-to-end answer target is the spike's provisional `< ~15 s`. Report p50/p95 plus raw samples; sample count is **TBD in M0**.
- Separately record DO wake, first SQL read, Workflow creation, sandbox start, restore, Brain start, first progress, and final answer.
- A real deployed 24-hour idle test is required. Simulated clock tests may supplement but cannot replace it.
- The vendor's ~2-second restore and ~30-second cold scenario are baselines to remeasure, not acceptance values.

#### Reliability and durability

- All public mutations and external effects are idempotent.
- At-least-once Workflow/alarm delivery must not produce duplicate effects.
- Storage is written incrementally; no shutdown hook is assumed.
- Backup integrity is verified before the old recoverable checkpoint is discarded.
- No running/queued lease may remain unexamined beyond a reconciliation interval; the value is **TBD from M0 fault tests**.
- Schema migrations are versioned and forward-tested; constructor-only `CREATE TABLE IF NOT EXISTS` is insufficient for evolving data.

#### Security

- Auth, audience, scope, ownership, grant, repo allowlist, and data-integrity checks fail closed.
- All denials are exercised through the deployed entry point with allow-path controls.
- Sandbox egress is deny-by-default except approved hosts.
- Credentials must not appear in Brain environment, argv, filesystem, logs, crash output, backups, or MCP responses.
- Environment bindings for dev/preview/production point to physically distinct state. Actual deployed identities are compared; configuration files are not accepted as proof.
- Worker existence is not disclosed across Owners or unauthorized clients.
- Secrets used to resolve blockers are referenced through a secret store.
- Exact data jurisdiction/location is **TBD before Worker creation**, because a DO's initial placement is effectively permanent.

#### Cost visibility

Per turn, report observed or attributable:

- DO requests, duration, rows read/written, and storage.
- Workflow steps, CPU, state size, retention, and retries.
- Sandbox instance type, lifetime, CPU, provisioned memory/disk, egress, and image.
- R2 objects, size, operations, and retention.
- Model provider, input/output/cache usage, gateway mode, and billing source.
- Unattributable subscription/remote-Brain cost as `unknown`, never zero.

The go/no-go cost threshold is **TBD before M5**, decided by the Owner against the fork alternative and expected workload. "Sane" is not a valid criterion.

#### Compatibility and change control

- Pin exact package and container-image versions in the lockfile and evidence ledger.
- Re-resolve current versions at spike kickoff and midpoint; upgrades require contract/e2e reruns.
- `@cloudflare/computer` remains research-only.
- Sandbox stable versus `@next` is **TBD at M0** based on current vendor recommendation, image/package compatibility, and available examples.

### 9. Testing requirements

#### M0 rule

No feature milestone begins until the observability and real-e2e harness can deploy an isolated environment, launch a run, collect a complete ledger, inject a named fault, and independently produce a pass/fail verdict.

#### Test layers

| Layer | Required coverage |
|---|---|
| Unit | Schemas, state transitions, projection logic, scope/grant decisions, path normalization, error mapping, redaction, idempotency keys, cost aggregation, backup manifests, completion rules. |
| Local integration | Stateless MCP handler→Worker routing, account registry, Worker↔Workflow callback dedupe, deterministic Brain protocol, duplicate/reordered events, fake billing, local R2 backup/restore, memory rebuild, client revocation logic. |
| Deterministic e2e | Fake Brain executable that mutates a known fixture and supports named barriers: before clone, after clone, before mutation, after mutation, during execution, before verification, and before fan-in. It can sleep, exit nonzero, emit malformed output, and be killed. |
| Real deployed e2e | Cloudflare DO hibernation/alarms, Workflow retries, Sandbox lifecycle, HTTPS interception, egress policy, R2 backup/restore, real OAuth, real clients, real billing/usage evidence, and the 24-hour soak. |
| Real-Brain canary | One pinned Brain CLI performs a deterministic fixture task; the Worker independently verifies the objective result. The Brain's prose is not an oracle. |
| Real-client canary | Claude Code plus one second external client address the same Worker. ChatGPT mobile read-only status is tested separately if the required account is provisioned. |

#### Must be tested in a real deployed environment

- OAuth discovery, DCR/CIMD, PKCE, consent, refresh, expiry, revocation, audience, and scope refusal.
- Foreign-worker non-disclosure and repo-grant denial.
- DO hibernation, inactive wake, alarm wake, location behavior, and real 24-hour idle return.
- Workflow start, retries, kill/redeploy behavior, final callback, and state retention.
- Sandbox creation, real CLI execution, outbound HTTPS interception, host denial, credential leak scan, and container sleep.
- R2 backup/restore with `.git`, symlinks, permissions, ignored/untracked files, Brain state, and dependency files defined by the manifest.
- Real client timeout/backgrounding behavior.
- Cost attribution and BYOK `default` alias behavior.
- Environment isolation using deployed resource fingerprints.

Local emulation is insufficient for these because the package identifies real differences in HTTPS interception, FUSE, hibernation, OAuth clients, and billing.

#### Deterministic Brain versus real Brain

- The deterministic Brain is the regression oracle and fault-injection target. All state-machine, idempotency, restore, and evidence gates must pass with it.
- The real Brain proves that a pinned CLI can consume the contract and do work; it does not define correct platform semantics.
- A real-Brain run passes only if objective workspace and test assertions pass independently.
- Non-deterministic model quality metrics require a frozen fixture, rubric, evaluator version, and threshold set before execution. Sample count is **TBD in M0**.
- The M5 memory-only condition must structurally deny workspace access; a prompt asking the model not to inspect the repo is not isolation.

#### Evidence ledger acceptance criteria

A turn counts as passing only if one linked bundle records:

- Schema and evaluator version.
- Deployment ID, source commit, dependency lock digest, environment, and resource fingerprints.
- Request/correlation ID; account, client, worker, turn, and Workflow run IDs.
- Effective OAuth scopes and grant snapshot hash.
- Worker DO class/name and jurisdiction; Sandbox/container ID; image digest; backup/R2 IDs.
- Brain profile, CLI/version, owner model/provider, gateway mode, and billing source—never raw credentials.
- Ordered sequence-numbered events with timestamps, attempt number, retry cause, status transition, and typed error kind.
- Every verification command's normalized argv/cwd, start/end time, exit code, and redacted stdout/stderr references or digests.
- Before/after Git HEAD, tree, diff, and workspace-manifest digests.
- Proposed and executed external actions, idempotency key, grant/approval decision, and provider object ID.
- Phase latencies and usage/cost components with `observed`, `derived`, or `unknown` provenance.
- Redaction result and secret-canary scan result.
- Final independent verdict, failed criteria, and limitations.

A run is not passing if required evidence is missing, identifiers disagree across layers, verification exists only in model prose, an unclassified error occurred, a secret appears in evidence, or an external action cannot be reconciled.

### 10. Spike success metrics

| Milestone | Pass criteria |
|---|---|
| M0 — observability/e2e | Isolated deployed environment is fingerprinted; deterministic Brain and real-path harness run; named fault is injected; ledger completeness and secret redaction are machine-checked; independent evaluator can deliberately detect a missing/corrupt evidence item. |
| M1 — hello Worker | One service MCP call routes to the correct named Worker; duplicate creation is idempotent; minimal memory/event state survives wake; alarm works; real 24-hour test is launched and later passes. Wake p50/p95 and raw samples are recorded; sample count is TBD in M0. |
| M2 — Brain in a box | Pinned real Brain completes the deterministic repo fixture; Worker verification passes independently; no credential leakage occurs. Workflow kills between completed steps resume; a kill during CLI execution must reconcile or restart safely and complete without duplicate mutation/effect. Otherwise M2 fails the unattended gate. |
| M3 — persistence | Declared workspace manifest and Git/task/event digests match before and after sleep/restore; next-day follow-up returns the objective expected state; restore and cold paths report phase-level p50/p95. Corruption/missing-backup test produces the correct blocked/failed state. |
| M4 — front door | Claude Code completes real OAuth and tasks/queries the Worker; a second external client reaches the same Worker; expiry, revocation, denied scope, foreign Worker, and allow paths behave correctly. One account authorization covers multiple Workers; minimal fan-out/status roll-up works without model wake. |
| M5 — model swap and cost | Required usage categories are captured from real provider evidence; BYOK billing source is proven; cost threshold is set before evaluation. At two predefined swap points, memory-only and memory+workspace variants are scored against a frozen rubric for repeated work, recorded rationale, and first productive action; rubric thresholds remain TBD until approved before M5. |
| Cloudflare go | M0–M4 pass; sleeping-worker latency meets the provisional `< ~15 s` target or an explicitly costed mitigation is accepted; M5 cost is under its predeclared threshold; no security, duplicate-effect, restore-integrity, or evidence-completeness blocker remains. |
| Fork/hybrid | Any platform-level inability to enforce credential/action boundaries, reconcile mid-turn execution, restore exact workspace state, support real client auth, or produce independent evidence is a no-go regardless of model prose. Latency/cost misses may result in hybrid rather than immediate rejection if mitigation is measurable. |

---

## C. Unattended-build gap check

### 1. Human-provided accounts, credentials, and decisions

1. **Cloudflare account and billing:** Provide a Workers Paid account with permission to use Workers, Durable Objects, Workflows, Sandbox/Containers, R2, KV, Workers AI/AI Gateway, logs, and billing data.
2. **Automation token:** Provide a least-privilege Cloudflare API token and account/project identifiers that permit unattended deployment and resource inspection without exposing unrelated production resources.
3. **Domain and DNS:** Provide or authorize a stable HTTPS domain for MCP and OAuth metadata/callbacks; `workers.dev` versus custom-domain use must be decided before client registration.
4. **Environment isolation:** Approve explicit dev/preview/production names and physically separate DO namespaces, R2 buckets, KV namespaces, Workflow bindings, OAuth data, logs, and AI Gateway resources.
5. **Owner identity provider:** Choose and provision GitHub, Google, Cloudflare Access, or another IdP for `/authorize`; `workers-oauth-provider` is not itself an identity provider.
6. **OAuth bootstrap:** A human must complete initial Owner sign-in/consent and any Claude Code or hosted-client connector setup that cannot be automated.
7. **Static-token policy:** Decide whether OAuth is the only front door or whether Codex/CI receives scoped static bearer tokens; if supported, provide an issuance, storage, rotation, and revocation mechanism.
8. **GitHub identity:** Provide a disposable GitHub fixture repository and a GitHub App or equivalent installation with explicitly approved read/write/PR/check permissions.
9. **Repository policy:** Approve repo allowlists, base branches, worker branch naming, force-push policy, fork behavior, and whether PR/comment/merge actions require per-action approval.
10. **Brain credentials:** Choose the first Brain and provide its headless credential path—such as an Anthropic API key routed through AI Gateway—plus permission to build a pinned container image.
11. **Owner models:** Enable Workers AI and provide any second-provider BYOK key required by M5, including the correct AI Gateway alias and access to provider usage records.
12. **Real client accounts:** Provide a Claude Code account; for the planned second client, provide the relevant ChatGPT/Codex account and plan. ChatGPT Developer Mode and connector registration require web access.
13. **Mobile canary:** If phone status is gating, provide a supported ChatGPT mobile account/device already linked to the web-configured connector.
14. **Budgets:** Set Cloudflare, model, and GitHub-operation spend ceilings plus the M5 cost/task go/no-go threshold; the package supplies no acceptable value.
15. **Latency decision:** Confirm whether `< ~15 s` for a sleeping-worker answer is a hard product gate and whether a paid warm-pool mitigation is acceptable.
16. **Data location:** Select allowed jurisdiction/location before Workers are created because DO location decisions are difficult to reverse.
17. **Retention/privacy:** Set retention and deletion rules for event history, command logs, OAuth data, backups, model inputs/outputs, external-action records, and PITR.
18. **Destroy semantics:** Decide whether destroy erases workspace, memory, backups, OAuth grants, cost records, and audit records immediately or retains some under policy.
19. **Administrative recovery:** Nominate the out-of-band credential or operator identity allowed to revoke every client, stop all work, and recover from a broken OAuth deployment.
20. **Cloudflare/fork decision authority:** Name who will interpret the gates and authorize continuing on Cloudflare, returning to the fork, or accepting a hybrid result.

### 2. Unattended-build gaps not resolved by the package

1. **No durable build ticket is identified.** The top-level concept note says an issue/epic must be created, and repository policy requires the standard observability, tests-first, deploy-impact, and definition-of-done sections before implementation.
2. **Build location is ambiguous.** The package chooses a greenfield Cloudflare spike but does not say whether it lives in this monorepo, a new package, or a separate repository, nor how repo-wide Bun-only policy applies to official npm-based examples.
3. **M0 itself lacks a frozen contract.** The follow-up work must define ledger schema, real-e2e runner, fault barriers, pass evaluator, environment fingerprints, and evidence storage before feature agents can implement against it.
4. **Dependency truth is inconsistent.** Package versions disagree across files and official templates lag current APIs; unattended agents need one generated lock manifest and an upgrade/freeze policy.
5. **The modern MCP→DO bridge is not settled.** `addMcpServer` is principally a client primitive; the front door still needs an explicit authenticated RPC/fetch bridge to the named plain Agent DO.
6. **Account enumeration has no storage owner.** One DO per Worker cannot satisfy account roll-up or client/worker administration without a separate registry/read model.
7. **The Worker DO versus Sandbox DO topology is unresolved.** The build cannot assign lifecycle ownership, alarms, turn leases, or recovery responsibilities until it knows whether there are one or two coordinated objects.
8. **DO schema migration is unspecified.** Constructor-time `CREATE TABLE IF NOT EXISTS` does not handle column changes, backfills, indexes, rollback, or destructive class migrations.
9. **OAuth revocation consistency is unproven.** OAuth storage uses KV characteristics, but the required immediate-revocation behavior and any authoritative per-call grant check are not specified.
10. **The Brain protocol is absent.** There is no normalized contract for startup, input, progress, cancellation, process identity, session resume, output, exit status, or malformed output.
11. **"Kill" has no deterministic control path.** The harness needs named barriers and distinct mechanisms to kill the Workflow, Worker DO, Sandbox DO, container, or CLI process; otherwise recovery tests will be flaky and uninterpretable.
12. **Backup scope is undefined.** `/workspace` alone may omit `.git`, Brain session files, home-directory configuration, untracked files, permissions, and artifacts needed for continuation.
13. **Backup garbage collection is missing.** TTL is checked at restore time but expired objects remain in R2; unattended runs will accumulate data without lifecycle rules or a tested sweeper.
14. **External action idempotency is unspecified.** Retry-safe branch names, commits, PR lookup keys, comment markers, and reconciliation after ambiguous provider failures are required before Workers can write to GitHub.
15. **The fixture task is contradictory.** "Add a failing test" conflicts with "tests pass"; the fixture needs an exact expected patch, test result, and final repository digest.
16. **Status freshness is unspecified.** Recorded PR links do not tell the current CI/merge/issue state; the build needs webhook or polling ownership plus explicit stale semantics.
17. **Cost evidence may not be synchronously available.** The harness must support delayed provider billing data and distinguish immediate usage counters from later invoiced cost.
18. **Local development cannot prove critical behavior.** HTTPS interception, FUSE, hibernation, real OAuth clients, container placement, and billing differ locally, so agents need deployed-dev access from M0 onward.
19. **Secret scanning has no canonical locations or canaries.** Define the sentinel secret, logs/artifacts/backups to scan, redaction rules, and what evidence may safely be retained.
20. **No branch/concurrency policy exists for multiple Workers on one repo.** Workers need isolated branches/workspaces and a rule for conflicting PRs or shared remote refs.
21. **No retry/rate-limit budget exists.** Model throttling, GitHub secondary limits, Workflow retry defaults, and container provisioning failures can cause unattended cost loops unless bounded and classified.
22. **No independent proof authority is assigned.** If the same building agent writes code, runs tests, and declares success, the founder's evidence-ledger rule is not met; the harness must compute verdicts independently.
23. **Client packages are not specified as artifacts.** Story 24 needs exact file locations, versioning, installation commands, timeout settings, auth instructions, and compatibility tests.
24. **No deployment rollback/data-migration procedure exists.** Durable Object class renames/deletions can destroy data, while pinned preview dependencies may force migrations during the spike.
25. **No safe fallback behavior is specified for a broken front door.** An OAuth or scope regression could lock the Owner out of client revocation and Worker shutdown without an out-of-band operator path.

### 3. Founder questions before the spike, ranked by build impact

1. **Is one-time human OAuth consent acceptable, and must any client connect fully headlessly afterward?** This decides OAuth-only versus OAuth plus static bearer authentication and changes M0/M4 substantially.
2. **May the Brain ever perform authenticated Git writes, or must all push/PR/comment/merge operations run exclusively as Worker-side deterministic tools?** This determines the credential topology and whether the current `outboundByHost` design is safe.
3. **Is the public product one account-level MCP endpoint or one endpoint per Worker?** This changes OAuth audience/consent, routing, client packaging, registry design, and fan-out viability.
4. **What does "survive a mid-turn kill" promise: actual process reattachment, safe idempotent restart, or merely a truthful failed/reconciliation state?** This is likely the largest engineering variable in M2.
5. **Must the two-week spike prove the canonical fan-out/account-status/blocked-state flow, or only the Cloudflare primitives?** This determines whether a registry and batch/status surface are in the critical path.
6. **Which first Brain and owner models are mandatory, and is model replacement or Brain replacement the launch claim?** The documents currently treat brain neutrality as both core and deferred.
7. **What exact actions can a preauthorized grant allow without per-action Owner approval?** The answer defines unattended PR creation and the grant schema.
8. **What data is authoritative when memory, git state, Workflow status, and Worker narrative disagree?** This determines projections, blocked-state behavior, and the independent evaluator.
9. **What are the hard latency and cost gates, including whether warm resources are acceptable?** `< ~15 s` and "sane cost" are not sufficient decision criteria.
10. **What must `destroy` delete, and what must remain auditable?** This must be settled before the memory, R2, OAuth, and ledger schemas are frozen.
11. **What Owner administration surface is acceptable without a dashboard?** At minimum, choose between owner-scoped MCP tools plus recovery CLI, a minimal dashboard, or another out-of-band operator path.
12. **Which second client is a true gate: ChatGPT web/mobile, Codex CLI, or another OAuth client?** Their authentication and timeout behavior differ enough to change M4.
13. **Is ChatGPT mobile read-only status a launch requirement or a non-gating compatibility canary?** Current evidence does not support treating mobile writes as established capability.
14. **Which platform-level failures automatically return the project to the fork?** Credential-boundary failure, unrecoverable duplicate effects, inability to restore state, and missing independent evidence should be explicit no-go conditions before work begins.
