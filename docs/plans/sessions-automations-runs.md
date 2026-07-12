# Sessions, Automations, and Runs

Status: canonical product and implementation contract for
[#931](https://github.com/dennisonbertram/fork-open-agents/issues/931)

Initial documentation slice:
[#932](https://github.com/dennisonbertram/fork-open-agents/issues/932)

Prepared: 2026-07-11

## Purpose

Open Agents already has durable cloud sessions, persistent sandboxes, GitHub
webhook ingestion, unattended coding agents, multi-step loops, and detailed run
evidence. The product is difficult to understand and operate because those
capabilities are exposed through overlapping product nouns, storage models,
run models, and experiments.

This document establishes one product contract and a dependency-ordered path to
reach it without a risky rewrite:

1. **Sessions** for interactive cloud coding.
2. **Runs** for trustworthy automation execution state, evidence, and recovery.
3. **Automations** for repeatable, manually or externally triggered coding
   work.
4. **Repositories** as the top-level context directory for repository
   dashboards and filtered links into execution work.
5. **Settings** for supporting account, repository, model, connection, usage,
   and explicitly advanced configuration.

This plan supersedes the **Agents + Workflows** product vocabulary in
[Unifying agents + loops](workflows-unification.md). That document remains
valuable technical evidence: background agents and loops already share trigger
infrastructure and converged definition fields, so additive adapters are safer
than a big-bang migration.

## Decision Summary

- Preserve existing tables and mature source-specific executors initially.
- Present background agents and loops as one Automation product.
- Present their executions through one normalized Runs product.
- Expose Repositories as a top-level context directory, not a fourth execution
  noun.
- Keep Settings as supporting configuration, not an execution noun.
- Use source-qualified references; source ids are not assumed globally unique.
- Keep honest optional fields and source-specific detail instead of false
  parity.
- Ship Runs before promoting the unified Automation editors.
- Keep legacy routes until replacement parity and redirect coverage exist.
- Freeze experiments by removing default discovery or creation paths, not by
  deleting code or records.
- Extract shared executor contracts only after characterization tests.
- Make storage consolidation an optional, evidence-gated research spike.

## Primary Product Nouns

### Workspace

A repository, branch, and persistent sandbox identity used as execution
context. A Workspace is visible inside Sessions and Runs but is not a competing
top-level navigation surface.

### Session

A durable interactive conversation attached to a Workspace. A Session owns the
user-facing transcript, interactive lifecycle, active stream, and access to
files, services, Git state, and sandbox controls.

### Automation

A versioned, repository-scoped definition containing:

- one or more steps;
- manual, GitHub, webhook, or schedule triggers;
- trigger conditions;
- instructions and tool access;
- GitHub and external-action permissions;
- verification commands and evidence requirements;
- output actions;
- concurrency, progress, retry, and cost limits.

A one-step Automation is initially backed by today's background-agent model. A
multi-step Automation is initially backed by today's loop model. This is an
adapter distinction, not a user-facing product split.

### Run

One durable execution attempt of an Automation revision. A Run answers:

- what started it and why;
- which Automation revision executed;
- which repository, branch, PR, issue, or delivery it targeted;
- which sandbox and workflow performed the work;
- its honest current and terminal state;
- which step is active;
- what permissions, checks, evidence, outputs, cost, and limitations exist;
- whether cancel, retry, resume, or another human action is currently valid.

### Step

One deterministic or model-driven unit inside an Automation. A one-step
Automation still has one conceptual Step even while legacy storage keeps the
instructions on the background-agent record.

### Trigger

A binding between an Automation and an external or manual start condition.
Trigger kinds include GitHub events, signed webhooks, schedules, and run-now.

## Terms That Are Not Primary Product Nouns

- **Agent** remains an implementation and configuration term for interactive
  chat roles, subagents, and model-driven Automation steps.
- **Workflow** remains the durable runtime mechanism and internal route/module
  naming.
- **Loop** remains a legacy storage/runtime alias for a multi-step Automation
  that may contain a cycle.
- **Background agent** remains a legacy storage/runtime alias for a one-step
  Automation.
- **Harness**, **Verified Build**, **Managed runtime**, and **Chief of Staff**
  remain advanced, experimental, or internal subsystem names.

## Target Information Architecture

```text
Workspace shell
├── Sessions
│   ├── New session
│   ├── Active sessions
│   └── Archived sessions
├── Runs
│   ├── Active
│   ├── Needs attention
│   ├── Completed
│   └── Repository, automation, and trigger filters
├── Automations
│   ├── All repositories
│   ├── Repository filter
│   ├── New automation
│   │   ├── Trigger and conditions
│   │   ├── Instructions
│   │   ├── Permissions
│   │   ├── Verification
│   │   ├── Output
│   │   └── Review and test
│   └── Advanced: multiple steps
├── Repositories
│   ├── Repository directory
│   ├── Repository dashboard
│   └── Filtered links into Sessions, Automations, and Runs
└── Settings
    ├── Account
    ├── Connections
    ├── Repositories
    ├── Models
    ├── Usage
    ├── Advanced
    │   ├── Chat roles
    │   ├── Composio
    │   ├── MCP servers
    │   ├── Skills
    │   └── Runtime
    └── Admin
```

Repositories is the top-level context directory and provides filters for
Sessions, Automations, and Runs. The repository dashboard may provide compact
summaries and links, but must not reintroduce a second product hierarchy called
Project, Agents, or Loops.

GitHub remains the system of record for general pull-request, issue, Actions,
and secrets administration. Open Agents shows only the GitHub context required
to start work, configure an Automation, or diagnose a Run.

## Canonical Contracts

The shapes below are conceptual contracts for future implementation issues.
They are not a schema migration request.

### Source-qualified identity

```ts
type AutomationRef =
  | { source: "background_agent"; sourceId: string }
  | { source: "agent_loop"; sourceId: string };

type AutomationRunRef =
  | { source: "background_agent"; sourceId: string }
  | { source: "agent_loop"; sourceId: string };
```

Every URL, cache key, idempotency key, API request, event correlation, and
diagnostic lookup that crosses sources must carry both fields. A raw id alone is
not a canonical identity.

### Automation summary

```ts
type AutomationSummary = {
  ref: AutomationRef;
  name: string;
  description?: string;
  repository: { owner: string; name: string };
  shape: "single_step" | "multi_step";
  status: "draft" | "enabled" | "paused" | "disabled" | "archived";
  stepCount: number;
  triggers: AutomationTriggerSummary[];
  verification?: AutomationVerificationSummary;
  permissions: AutomationPermissionSummary;
  latestRun?: AutomationRunSummary;
  nextRunAt?: string;
  sourceLimitations: string[];
  createdAt: string;
  updatedAt: string;
};
```

`sourceLimitations` makes missing source parity inspectable. For example, a
one-step source may not have a definition snapshot until a later additive
contract is introduced.

### Automation revision

```ts
type AutomationRevision = {
  automation: AutomationRef;
  revisionId: string;
  revisionKind: "source_snapshot" | "immutable_revision";
  steps: AutomationStepDefinition[];
  triggers: AutomationTriggerDefinition[];
  permissions: AutomationPermissionPolicy;
  verification: AutomationVerificationPolicy;
  outputs: AutomationOutputPolicy;
  guardrails: AutomationGuardrails;
  createdAt: string;
};
```

Multi-step runs already freeze a definition snapshot. One-step adapters must
not claim immutable revision support until the run stores sufficient source
definition provenance. The interim contract may use `source_snapshot` and
expose that limitation.

### Run lifecycle

```ts
type AutomationRunStatus =
  | "queued"
  | "running"
  | "waiting_on_user"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "stale"
  | "unknown";
```

Only an explicit successful terminal source state maps to `succeeded`.
`skipped`, `blocked`, `stale`, and `unknown` never map to completed or passed.

### Run summary

```ts
type AutomationRunSummary = {
  ref: AutomationRunRef;
  automation: AutomationRef;
  automationName: string;
  automationRevision?: string;
  repository: { owner: string; name: string; branch?: string };
  status: AutomationRunStatus;
  attentionReasons: string[];
  trigger: {
    source: "github" | "schedule" | "webhook" | "manual";
    kind: string;
    triggerId?: string;
    deliveryId?: string;
    target?: { prNumber?: number; issueNumber?: number; sha?: string };
  };
  progress?: {
    currentStepId?: string;
    currentStepLabel?: string;
    completedSteps?: number;
    totalSteps?: number;
  };
  timestamps: {
    createdAt: string;
    startedAt?: string;
    updatedAt: string;
    finishedAt?: string;
  };
  evidence: {
    sandboxName?: string;
    workflowRunId?: string;
    requestId?: string;
    checks?: "pending" | "passed" | "failed" | "not_configured";
    outputUrl?: string;
    limitationCount: number;
  };
  controls: {
    canCancel: boolean;
    canRetry: boolean;
    canResume: boolean;
  };
};
```

### Partial-source result

```ts
type AutomationRunListResult = {
  items: AutomationRunSummary[];
  sourceStatus: Array<{
    source: AutomationRunRef["source"];
    status: "ok" | "partial" | "failed";
    itemCount: number;
    safeErrorKind?: string;
  }>;
  nextCursor?: string;
};
```

One source failing must not erase successful results from the other source.
The failure must also not be silently hidden.

## Current Source Mapping

| Target concept | Current sources to preserve | Initial adapter behavior |
| --- | --- | --- |
| Session | `sessions`, `chats`, `workflow_runs`, active stream, sandbox lifecycle | Keep current routes and lifecycle; no Automation abstraction |
| Workspace | session repository/branch/sandbox fields and sandbox records | Show as Session/Run context, not a new primary route |
| Single-step Automation | `background_agents` + `background_agent_triggers` | Normalize to one Step; writes continue through current APIs |
| Multi-step Automation | `agent_loops` definition + shared triggers | Normalize graph nodes to Steps; writes continue through loop APIs |
| Automation Run | `background_agent_runs` or `agent_loop_runs` | Normalize honest shared fields; retain source-specific detail |
| Run timeline | background events or loop events/step runs | Shared shell, source-specific evidence panels |
| Output | background outputs/output URL; loop step/context output | Optional canonical summary plus source-specific evidence |
| Trigger | `background_agent_triggers.agentId` or `.loopId` | Normalize owner to `AutomationRef`; preserve exactly-one invariant |
| Run diagnosis | Account Coordinator normalization and diagnosis | Reuse redaction, correlation, and partial-failure patterns |
| Interactive roles | `agents` table scoped by user/repo/session | Rename Settings surface to Chat roles; never treat as Automation |

### Sessions

Current session routes and the workspace sidebar are the strongest direct match
for the target product. Preserve:

- session creation and repository selection;
- chat and active-stream reattachment;
- persistent sandbox naming and lifecycle;
- hibernation and resume;
- Git diff, branch, commit, push, and PR controls;
- runtime and sandbox evidence needed to diagnose interactive work.

Session work remains visible under Sessions rather than being duplicated in the
initial Automation Runs list. If interactive workflow attempts later need a
global ledger, add them through a separate source-qualified contract after
their in-flight lifecycle is durably persisted.

### Background agents

Background agents are the initial write source for single-step Automations.
Preserve:

- repository ownership;
- instructions;
- model and tool selection;
- permissions and GitHub action policy;
- verification command;
- trigger conditions;
- write scope and CI merge policy;
- per-target run budget;
- manual test and enablement lifecycle;
- run events, outputs, tool sessions, cost, and idempotency.

Do not copy those records into loop graphs merely to make the UI look unified.

### Agent loops

Loops are the initial write source for multi-step Automations. Preserve:

- definition graph and structured condition nodes;
- run-time definition snapshot;
- fresh sandbox-per-step execution;
- shared context and GitHub state across steps;
- run and step guardrails;
- pause, resume, retry, cancel, and watchdog semantics;
- trigger binding and idempotency;
- step events and source-specific graph evidence.

“Loop” remains valid as an internal description of a cycle, not as the
top-level product name.

### Account Coordinator

The Account Coordinator already demonstrates useful cross-source patterns:

- authenticated user scoping;
- status normalization;
- partial-source isolation;
- redacted summaries;
- source-qualified diagnosis;
- correlation across workflows, sandboxes, GitHub records, and evidence.

Reuse or extract those patterns. Do not ship another competing account-level
ledger, and do not expose “Chief of Staff” as a fourth primary product surface.

Known gaps must be corrected in the new Run contract:

- unknown source statuses must not default to completed;
- skipped must remain skipped;
- in-flight and terminal timestamps must be optional when the source lifecycle
  permits them to be absent;
- Session container state and chat workflow attempts must not be double-counted
  as Automation Runs.

## Keep, Consolidate, Freeze

| Decision | Capabilities and surfaces | Boundary |
| --- | --- | --- |
| Keep and harden | Sessions, chats, sandbox hibernate/resume, Git state, webhook verification, delivery idempotency, current executors, permissions, checks, outputs, events, costs, cancel/retry, watchdogs, repository connections, runtime evidence | Behavior remains source-authoritative until characterized |
| Consolidate | Background agents + loops into Automations; their run lists into Runs; Project/Agents/Loops entry points into repo-filtered Automations; recent activity into repo-filtered Runs; separate readiness into one Automation readiness contract | Product and read-model consolidation first; writes use adapters |
| Move to Advanced | Chat roles, model profiles, Composio, MCP, Skills, runtime controls, GitHub Actions dispatch | Available only to users who need lower-level configuration |
| Freeze and preserve | Verified Build/harness product UI, generic workflow catalog, GTM pages, Chief of Staff branding, custom runtime-profile authoring, graph-builder expansion, new sandbox providers, leaderboard/learnings expansion | Remove default discovery or creation; preserve records, diagnostics, and source |
| Leave to GitHub | General PR, issue, Actions, and secrets administration | Show only context and deep links required by Sessions, Automations, or Runs |

Freezing is reversible. It does not authorize dropping tables, migrations,
routes needed for existing record access, or diagnostic evidence.

## Lifecycle Contracts

### Session lifecycle

```text
create
  -> repository and branch resolved
  -> persistent sandbox identity reserved
  -> chat and durable stream started
  -> active interactive work
       -> disconnect/refresh -> reattach to same stream
       -> inactivity -> hibernate -> persistent snapshot/state
       -> reopen -> resume same sandbox identity
       -> commit/push/PR or leave branch pending
  -> archive
```

Session invariants:

- refresh or reconnect must not silently start duplicate work;
- resume must not silently substitute a new empty workspace;
- visible status distinguishes provisioning, running, hibernated, restoring,
  failed, completed, and archived;
- Git and sandbox evidence identify the actual workspace that performed work.

### Automation definition lifecycle

```text
draft
  -> configure trigger, instructions, permissions, verification, output
  -> save disabled
  -> readiness check
  -> manual test Run
       -> inspect evidence
       -> revise and retest if needed
  -> enable
  -> receive triggers / run manually
  -> pause or disable
  -> archive without deleting historical Runs
```

Definition invariants:

- a newly created Automation does not gain unattended authority merely because
  it was saved;
- write permissions and repository scope are explicit;
- readiness distinguishes disabled, missing configuration, blocked, ready, and
  tested;
- editing a definition never rewrites historical run evidence;
- an archived definition retains readable historical Runs.

### Automation Run lifecycle

```text
verified trigger or manual request
  -> repository scope and conditions checked
  -> idempotency / concurrency / budget checked
  -> definition revision captured
  -> queued
  -> running
       -> step progress and evidence persisted
       -> waiting_on_user / blocked / stale where applicable
       -> cancel or source-correct retry
  -> succeeded | failed | cancelled | skipped | unknown
  -> outputs, limitations, cleanup, and final evidence persisted
```

Run invariants:

- one accepted external delivery creates at most one Run per Automation target;
- duplicate delivery handling leaves inspectable skip/dedup evidence;
- terminal status is monotonic except through an explicit new retry attempt;
- retry creates or identifies a new attempt without rewriting the original;
- cancellation is cooperative, idempotent, and honest about work already
  performed;
- current step and progress survive process restarts;
- a source error never becomes a successful terminal state through
  normalization;
- absence of a configured check is `not_configured`, not passed;
- absence of live proof is unproven, not recovered or green.

## Status Mapping

| Canonical status | Background-agent source | Loop source | Notes |
| --- | --- | --- | --- |
| `queued` | `queued` | `queued` | Active, not success |
| `running` | `running` | `running` | Deadline and stale detection required |
| `waiting_on_user` | no direct state initially | `paused` when user action is required | Do not infer without evidence |
| `blocked` | typed blocked event/failure where available | typed blocked step/event where available | May remain optional until source supports it |
| `succeeded` | `succeeded` only | `completed` only | Explicit success only |
| `failed` | `failed` | `failed` | Preserve error kind and safe summary |
| `cancelled` | `cancelled` | `cancelled` | Terminal |
| `skipped` | `skipped` | dedup/budget skip evidence if no run row | Never map to success |
| `stale` | derived from active age and evidence | `stalled`, or derived active age | Must show derivation and threshold |
| `unknown` | unrecognized or contradictory source state | unrecognized or contradictory source state | Visible limitation, never success |

The adapter issue must freeze these mappings with fixture tests before a Runs
page is built.

## Cross-Cutting Invariants

### Ownership and authorization

- Every list, detail, action, event, and output read is user-scoped.
- Cross-user or missing source ids return a non-probing 404 or equivalent.
- Repository access is resolved authoritatively before cloning or mutation.
- Product adapters never bypass source action gates.

### Repository scope

- Missing unattended allowlist configuration fails closed.
- Explicit `*` remains a deliberate operator override, not the missing-config
  default.
- Write scope is independent from trigger-binding scope and remains explicit.
- A source-qualified Automation cannot mutate another repository merely because
  its instructions request it.

### Durability and idempotency

- External delivery ids and source-qualified Automation refs participate in
  idempotency.
- Definition state required for replay is snapshotted or its limitation is
  exposed.
- Progress, terminal status, events, and outputs are persisted outside the HTTP
  request lifecycle.
- Run-now uses the same durable dispatcher and policy path as external starts.

### Evidence and status honesty

- Every state-changing action leaves inspectable user/operator evidence.
- Only explicit success maps to success.
- Blocked, skipped, cancelled, stale, unknown, and not configured remain
  distinct.
- Partial source failure is visible.
- Run summaries link to deeper source evidence until canonical parity exists.

### Redaction

- Never expose provider tokens, auth cookies, webhook secrets, environment
  values, raw prompts, private session content, or unredacted artifacts.
- Summaries use bounded, redacted fields.
- Error kinds are stable and safe; raw exceptions remain server-side.
- Correlation identifiers are retained only when they do not grant access.

### Compatibility

- Legacy URLs remain readable until canonical route parity is tested.
- Legacy definitions remain editable through their source APIs during rehoming.
- Existing records are never rewritten merely to change vocabulary.
- Redirects preserve source kind, id, and repository/filter query state.

### Product proof

- Implemented, deterministic, locally integrated, browser-smoked,
  preview-proven, and production-proven are separate claims.
- A blocked canary is evidence of missing configuration, not a pass.
- Recovery alerts fire only after an actually failing executed journey becomes
  an actually passing executed journey.

## Delivery Waves and PR Boundaries

Each numbered slice requires a native child issue under #931, one isolated
worktree, one branch from `origin/develop`, one focused PR into `develop`, and
explicit file ownership. Later slices may be refined as current source changes,
but their dependency and stop conditions remain binding.

### Wave 0 — contract

#### Slice 0.1 — canonical product contract (#932)

Dependencies: none.

Scope:

- replace the stale root plan;
- add this canonical plan;
- mark old vocabulary superseded;
- add routing links.

Proof: documentation formatting, local-link validation, and diff hygiene.

Rollback: revert the docs-only commit.

### Wave 1 — trust and exposure foundations

#### Slice 1.1 — fail-closed unattended repository allowlists

Dependencies: contract merged.

Protected path: enabling unattended execution never expands to every repository
because an environment variable was omitted.

Scope:

- distinguish missing, explicit list, and explicit wildcard configuration;
- update readiness responses and operator documentation;
- preserve explicit `*` as intentional override;
- cover both background-agent and loop dispatch.

Expected files:

- `apps/web/lib/background-agents/config.ts`;
- `apps/web/lib/agent-loops/config.ts`;
- readiness/config tests and environment docs.

Proof target: Level 1 deterministic, plus Level 2 journey proof before enabling
in a shared environment.

Rollback: disable unattended features or restore the previous parser only after
explicit operator approval; never silently substitute wildcard behavior.

Stop if current production configuration cannot be inventoried without exposing
values; hand off the exact operator check instead.

#### Slice 1.2 — truthful production journey aggregation

Dependencies: contract merged; may run in parallel with 1.1 if files do not
overlap.

Protected path: blocked configuration never produces pass or recovery.

Scope:

- model passed, failed, cancelled, and blocked/unproven separately;
- aggregate only actually executed journeys into pass/fail recovery state;
- retain a visible blocked reason and remediation link;
- add transition tests for fail -> pass, blocked -> pass, and pass -> blocked.

Expected files:

- `apps/web/scripts/canary-journey-gate.ts`;
- `.github/workflows/authenticated-production-canary.yml`;
- production-ops documentation and focused tests.

Proof target: Level 1 for aggregation; Level 3 only after a scheduled production
run records the intended states.

Rollback: revert aggregation logic while keeping blocked evidence visible; do
not restore misleading recovery behavior.

#### Slice 1.3 — explicit product exposure gates

Dependencies: contract merged.

Protected path: default chat and navigation contain only shipped core product
surfaces.

Scope:

- separate runtime configuration from product exposure;
- hide Verified Build/harness creation and classification from default chat;
- keep existing Verified Build record/detail access;
- keep GTM, generic workflow catalog, and custom runtime-profile authoring out
  of default navigation/creation;
- document experimental/operator access.

Expected files:

- a focused `apps/web/lib/product-surfaces/` config module;
- chat route and Verified Build header/panel wiring;
- settings navigation;
- GTM/page exposure boundaries;
- focused route and UI tests.

Proof target: Level 1 and authenticated local browser smoke.

Rollback: re-enable the explicit gate; never remove it by coupling exposure back
to `HARNESS_ENABLED` or another runtime-only variable.

Stop if hiding creation would strand access to existing records; add an
owned/read-only legacy detail path first.

### Wave 2 — additive product contracts

#### Slice 2.1 — Automation read contract and adapters

Dependencies: Wave 1 exposure contract stable.

Protected path: users can list existing one-step and multi-step definitions as
Automations without data migration or false parity.

Scope:

- implement source-qualified Automation refs;
- normalize definitions, status, triggers, permissions, checks, latest run, and
  next schedule;
- expose source limitations;
- isolate partial source failures;
- add repository and lifecycle filters.

Expected files:

- new `apps/web/lib/automations/` modules and fixture tests;
- source store calls only as dependencies, not rewrites.

Proof target: Level 1 deterministic adapter and ownership tests.

Rollback: remove the unused additive adapter modules.

Stop if a field cannot be mapped honestly; make it optional and expose a
limitation rather than changing source data.

#### Slice 2.2 — Run read contract and adapters

Dependencies: status contract in this plan; may run in parallel with 2.1 using
separate files.

Protected path: background and loop run states remain honest when shown
together.

Scope:

- implement source-qualified Run refs;
- freeze status mappings with passing, failing, skipped, unknown, stale, and
  partial-source fixtures;
- normalize triggers, repository target, progress, evidence, timestamps, and
  available controls;
- reuse Account Coordinator redaction/correlation patterns;
- avoid treating Session containers as Automation Runs.

Expected files:

- new `apps/web/lib/runs/` modules and tests;
- carefully extracted helpers from `apps/web/lib/account-coordinator/` only
  when behavior stays compatible.

Proof target: Level 1 deterministic adapter, ownership, redaction, sorting, and
partial-source tests.

Rollback: remove the additive adapters; source run pages remain authoritative.

Stop if shared normalization would alter Account Coordinator behavior without
its own characterization tests.

### Wave 3 — Runs product

#### Slice 3.1 — unified Runs API and list

Dependencies: 2.2 merged.

Protected path: a user can find active, attention-needed, and completed Runs
across both Automation sources.

Scope:

- authenticated Runs API;
- stable cursor/sorting contract;
- repository, Automation, trigger, lifecycle, and attention filters;
- active-only polling with a deadline and visible stale/error state;
- initial links to source-specific detail routes;
- Runs entry in the workspace shell.

Expected files:

- `apps/web/app/api/runs/route.ts` and tests;
- `apps/web/app/runs/` page, components, and DOM tests;
- workspace sidebar integration.

Proof target: Level 1 plus authenticated Level 2 local/preview browser journey.

Rollback: remove the navigation entry and new route; legacy lists remain.

Stop if either source cannot enforce user ownership through the new route.

#### Slice 3.2 — normalized Run detail shell

Dependencies: 3.1 merged.

Protected path: a Run exposes common proof and all source-specific evidence and
controls.

Scope:

- source-qualified canonical detail routes;
- shared header, proof strip, status, trigger, repository, output, and action
  placement;
- composition of existing background timeline or loop graph/step/watchdog
  panels;
- legacy-route redirects only after parity tests.

Proof target: Level 1 detail/action tests and authenticated Level 2 browser
journeys for both sources.

Rollback: restore legacy links and remove redirects; source detail remains.

Stop if any evidence section or cancel/retry gate is absent or behaviorally
different from the source page.

### Wave 4 — Automations product

#### Slice 4.1 — unified read-only Automations list

Dependencies: 2.1 and 3.1 merged.

Protected path: users see all definitions as single-step or multi-step
Automations with recent Run state.

Scope:

- combined authenticated list and API;
- repository, shape, trigger, and status filters;
- New Automation call to action;
- legacy detail/editor links initially;
- one Automations sidebar group instead of Agents and Loops.

Proof target: Level 1 plus authenticated browser smoke.

Rollback: restore legacy sidebar groups; source pages remain.

#### Slice 4.2 — rehome the single-step editor

Dependencies: 4.1 and normalized Runs detail merged.

Protected path:
`Trigger -> Instructions -> Permissions -> Verification -> Output -> Test -> Enable`.

Scope:

- canonical single-step Automation create/detail/edit routes;
- reuse current background-agent builder, request mappers, readiness, manual
  test, and enablement lifecycle;
- rename user copy without changing payloads;
- direct manual-test navigation to canonical Run detail;
- preserve legacy routes until parity.

Proof target: Level 1 DOM/API tests, Level 2 journey proof, and Level 3 before
claiming the GitHub webhook path proven in production.

Rollback: route new creation back to legacy editor; stored definitions remain
unchanged.

Stop if rehoming requires changing source payload or execution behavior; split
that behavior change into its own issue.

#### Slice 4.3 — rehome the multi-step editor

Dependencies: 4.1, 3.2, and 4.2 vocabulary/patterns merged.

Protected path: a user can opt into multiple steps, preserve the exact graph,
run it, and inspect step progress.

Scope:

- canonical multi-step Automation detail/edit routes;
- rehome current loop builder and run-now controls;
- present “Add steps” as Advanced;
- preserve graph definition, snapshots, trigger bindings, guardrails,
  pause/resume/retry, and watchdog behavior;
- preserve legacy loop routes until parity.

Proof target: Level 1, loop Level 2 journey proof, and Level 3 before production
claims.

Rollback: route to the existing loop pages; stored graphs and Runs remain.

Stop if implementation attempts to convert one-step records into graphs.

### Wave 5 — remove product duplication

#### Slice 5.1 — workspace and repository navigation reduction

Dependencies: Waves 3 and 4 feature parity.

Scope:

- primary workspace links: Sessions, Runs, Automations, Repositories, Settings;
- repository links become filters into those products;
- replace Project/Agents/Loops destinations;
- demote general GitHub administration and keep direct GitHub links;
- preserve and test legacy redirects.

Proof target: Level 1 navigation tests and authenticated desktop/mobile browser
smoke.

Rollback: restore old navigation links; canonical routes remain usable.

#### Slice 5.2 — Settings reduction

Dependencies: 5.1 vocabulary stable.

Scope:

- Account: Profile, Preferences, Connections;
- Workspace: Repositories, Models, Usage;
- Advanced: Chat roles, Composio, MCP, Skills, Runtime;
- rename interactive Agents to Chat roles;
- remove Background agents and Loops as Settings products;
- retain admin authorization.

Proof target: Level 1 route/nav tests and authenticated browser smoke.

Rollback: restore nav metadata; settings routes and stored values remain.

#### Slice 5.3 — landing and onboarding alignment

Dependencies: canonical routes stable.

Scope:

- market durable Sessions, triggered Automations, and inspectable Runs;
- first journey:
  `Connect GitHub -> start Session -> create Automation -> inspect Run`;
- remove claims that exceed current proof.

Proof target: Level 1 copy/flow tests and signed-out/signed-in responsive browser
smoke.

Rollback: revert copy and links; no data impact.

### Wave 6 — runtime convergence after product parity

#### Slice 6.1 — characterize both unattended executors

Dependencies: product parity and stable golden journeys.

Scope:

- fixture and contract coverage for workspace acquisition, tools, model
  selection, permission enforcement, verification, output publication, usage,
  progress, finalization, and cleanup;
- no extraction in the same red-test commit.

Proof target: Level 1 characterization plus existing Level 2 source journeys.

Stop if tests require changing behavior to make the sources look identical.

#### Slice 6.2 — extract shared execution contracts

Dependencies: 6.1 merged.

Scope:

- shared Step definition, Run context, Run result, permissions, verification,
  output, and evidence interfaces;
- source adapters retain source-specific orchestration;
- small, reviewable extractions with unchanged golden journeys.

Proof target: Level 1 characterization unchanged, both Level 2 journeys, and
production proof appropriate to any deployed behavior touched.

Rollback: revert one extraction at a time; do not combine with storage changes.

### Wave 7 — optional storage-convergence spike

Dependencies:

- adapters round-trip every representative existing definition and Run;
- evidence/detail parity is complete;
- shared execution contracts have survived production use;
- an operator has a measured reason to remove the remaining source split.

The research spike must answer:

- Does a table merge remove meaningful operational cost?
- Can every definition, trigger, Run, event, output, and correlation migrate
  without loss?
- How are legacy and new writes handled during rollout?
- How are triggers repointed atomically?
- What are backward-compatible reads, rollback, and fix-forward paths?
- How is migration proven on an isolated Neon preview branch with
  representative rows?

No migration begins until the spike is approved. “Cleaner schema” alone is not
sufficient justification.

## Cheap-Agent Ownership and Coordination

The coordinating frontier agent owns architecture, status semantics, security
boundaries, integration review, and final evidence quality. Bounded agents own
token-heavy implementation and testing.

Recommended parallel waves:

| Agent packet | Bounded ownership | Must not touch |
| --- | --- | --- |
| Trust agent | Allowlist parsing/readiness | Canary aggregation, UI adapters |
| Ops agent | Canary status aggregation/workflow | Runtime config parsers |
| Exposure agent | Product gates and hidden experimental UI | Executor behavior |
| Automation-contract agent | `lib/automations` adapters/tests | Run adapters, UI |
| Run-contract agent | `lib/runs` adapters/tests | Automation editors |
| Runs UI agent | Runs API/list | Source executor/editor files |
| Detail agent | Shared detail shell and composition | Source action semantics |
| Single-step agent | Background-agent editor rehome | Loop builder |
| Multi-step agent | Loop editor rehome | Background-agent editor |
| IA agent | Sidebar/repository navigation | Runtime/source behavior |
| Settings agent | Settings regrouping and copy | Automation execution |
| QA agent | Test, browser, link, log, and failure clustering | Production mutation unless explicitly assigned |

Every handoff packet includes:

- repository and isolated worktree path;
- issue and parent epic;
- owned files and explicit out-of-scope files;
- protected user/operator path;
- failing-first test and expected red reason;
- focused and adjacent verification commands;
- required proof level;
- stop conditions and return format.

Agents must report findings, changed files, commands, residual risk, stop
conditions hit, commit, and PR. The coordinator reopens high-risk files and
reruns or spot-checks the verification before accepting the result.

Do not run two editing agents against the same file family. Dependent agents
start only after the contract they consume is merged or explicitly base their
worktree on that dependency branch.

## Verification and Proof Levels

Follow the
[Deployed Feature Proof Standard](../process/deployed-feature-proof-standard.md)
and [Observability Discipline](../process/observability-discipline.md).

### Claim vocabulary

- **Documented**: plan or contract exists; no behavior claim.
- **Implemented**: code exists on a branch or PR.
- **Deterministically tested**: focused repeatable tests pass.
- **Locally integrated**: multiple components work in a database-backed local
  environment.
- **Browser-smoked**: the actual user path was exercised and page, console,
  network, and server logs were inspected.
- **Preview-proven**: the journey passed against the preview deployment and its
  isolated backing services.
- **Production-proven**: the deployed main SHA and a real production journey
  produced linked evidence.

No lower claim implies a higher one.

### Proof matrix

| Change | Minimum before PR review | Minimum before production claim |
| --- | --- | --- |
| Docs-only contract | formatter, local links, `git diff --check` | Not applicable |
| Pure adapter/status logic | Level 1 deterministic tests | Level 1 unless user-visible journey depends on it |
| Authenticated list/detail UI | Level 1 + database-backed browser smoke | Level 2 preview journey |
| Trigger/dispatcher/policy | Level 1 workflow/route tests | Level 2 preview and Level 3 before “proven in production” |
| Sandbox/executor behavior | Level 1 characterization | Level 2 source journey; Level 3 for production claims |
| Navigation/copy only | Level 1 render/DOM tests + browser smoke | Preview smoke after deploy |
| Schema migration | migration safety, isolated database proof | Preview migration, rollback proof, then production observation |

### Golden journeys

1. **Durable Session**: connect a repo, start a Session, execute work, refresh,
   hibernate, resume the same workspace, and produce a branch or PR.
2. **PR review Automation**: a verified pull-request or review delivery matches
   one enabled Automation exactly once; the Run shows trigger, repository,
   permissions, sandbox, checks, review output, and limitations.
3. **Issue implementation Automation**: a verified issue delivery starts an
   implementation Run, performs scoped coding, passes configured verification,
   and creates the allowed PR output.
4. **Multi-step Automation**: a definition snapshot survives restart, steps
   advance with durable context, and failure/retry remains inspectable.
5. **Recovery controls**: cancel/retry/resume are visible only when valid,
   idempotent, and preserve the original attempt.
6. **Blocked production configuration**: missing credentials or allowlists
   report blocked/unproven, never passed or recovered.
7. **Legacy compatibility**: old definition and Run URLs retain access until
   canonical route parity is complete.

## Observability Contract

Canonical Run summaries carry, when available:

- source-qualified Automation and Run refs;
- repository, branch, PR, issue, SHA, and delivery context;
- Automation revision or explicit source-snapshot limitation;
- trigger kind and source;
- status and attention reason;
- current step and progress;
- request, workflow, sandbox, and output correlations;
- verification state;
- cost/usage summary;
- available recovery controls;
- redaction and evidence limitations.

Structured event vocabulary remains source-owned until a dedicated issue
defines a shared event contract. Shared adapters must not rename source events
without retaining their original event name and source.

Debug recipes belong in each behavior-changing child issue and PR because the
service/action names and source tables differ. At minimum they must show how to
query by the safe Run ref, request id, delivery id, workflow run id, or sandbox
name without printing raw secrets.

## Rollout Strategy

### Additive first

- Introduce adapters and canonical routes without changing writes.
- Keep source detail links and source pages.
- Compare adapter output against source fixtures and seeded records.
- Add navigation only after ownership, redaction, status, and partial-failure
  tests pass.

### Opt-in before replacement

- Gate new product routes or navigation by deployment/user cohort when useful.
- Run legacy and canonical read paths side by side.
- Record safe parity counters or test fixtures rather than raw payloads.
- Do not redirect creation/editing until manual test and Run observation are
  proven.

### Redirect after parity

- Redirect legacy list routes first.
- Redirect source definition detail/edit only after create/edit/test/enable
  parity.
- Redirect source Run detail only after every evidence and control section is
  represented.
- Preserve direct diagnostic access for frozen systems and old records.

### Runtime convergence last

- Characterize before extracting.
- Extract one concern at a time.
- Rerun both source journeys after each extraction.
- Do not combine executor extraction with storage migration.

## Rollback Strategy

- **Exposure gate rollback**: re-enable the explicit gate; never couple product
  visibility back to runtime configuration implicitly.
- **Adapter/API rollback**: remove the canonical route or navigation while
  source APIs/pages remain authoritative.
- **Redirect rollback**: restore legacy destinations; canonical paths may remain
  additive.
- **Editor rollback**: route users back to source editors; records were never
  converted.
- **Navigation rollback**: restore links without changing data or execution.
- **Executor extraction rollback**: revert the latest isolated extraction and
  keep characterization tests.
- **Migration rollback**: defined only by the later approved spike, including
  backward-compatible reads and fix-forward; no destructive shortcut.

Every PR names its rollback owner, trigger, commands or route/config change, and
data consequences. “Revert the PR” is insufficient when a policy change may
have blocked or started unattended work.

## Global Stop Conditions

Stop a slice and report the blocker rather than widening scope when:

- it requires destructive migration or deletion;
- a legacy definition, Run, event, output, or correlation cannot round-trip
  losslessly;
- shared abstractions change source execution before characterization exists;
- a canonical Run omits source evidence or controls;
- unattended execution would operate without explicit repository scope;
- status normalization would turn blocked, skipped, stale, cancelled, unknown,
  or unproven into success;
- authenticated persisted browser state cannot load for required proof;
- a missing external credential is the only blocker after safe local checks;
- a live external dependency is being introduced merely to test deterministic
  local behavior;
- implementation pulls Verified Build, GTM, generic catalog, or custom runtime
  authoring back into the default product;
- source files overlap another active PR or worktree without an integration
  owner;
- a verification command fails twice for the same unexplained reason;
- the fork or PR target is ambiguous.

## Explicit Non-goals

- No big-bang table merge.
- No deletion of definitions, Runs, or evidence.
- No executor rewrite before characterization.
- No completion of Verified Build, harness, GTM, generic workflow catalog, or
  custom managed-runtime profile authoring.
- No new sandbox provider.
- No general replacement for GitHub PRs, issues, Actions, or secrets.
- No claim of production proof from code, tests, local browser output, or a
  green-but-blocked canary alone.
- No forced inclusion of interactive chat workflow attempts in Automation Runs
  before their own lifecycle contract is designed.

## Open Decisions To Resolve In Child Issues

- Whether canonical detail routes use path-qualified refs or an opaque encoded
  source-qualified ref.
- Whether archived Automations appear by default or only through a filter.
- How a one-step Automation records immutable revision provenance additively.
- Which loop paused states truly mean waiting on user versus operator pause.
- Which background-agent events can honestly produce a canonical blocked state.
- Whether Runtime remains visible under Advanced or is operator-only while
  custom authoring is frozen.
- Which existing Account Coordinator helpers should be extracted versus wrapped
  to avoid behavior drift.

These decisions may refine API and UI shapes but may not violate source
qualification, status honesty, ownership, redaction, compatibility, or the
dependency order.

## Epic Definition Of Done

Parent epic #931 is complete only when:

- default navigation and onboarding expose Sessions, Runs, Automations,
  Repositories, and Settings only;
- existing one-step and multi-step definitions remain readable, editable, and
  executable through their proven source runtimes;
- GitHub-triggered and scheduled execution fail closed outside explicit
  repository scope;
- Runs expose honest normalized lifecycle, evidence, outputs, limitations, and
  recovery without hiding source-specific detail;
- legacy URLs retain access until replacement parity is proven;
- the durable Session, PR review, issue implementation, multi-step, recovery,
  blocked-config, and compatibility journeys have the required proof;
- production journey aggregation distinguishes executed pass/fail from blocked
  or unproven;
- frozen systems are absent from default product discovery but existing records
  remain diagnosable;
- any remaining runtime or storage convergence is explicitly deferred with
  measured evidence rather than assumed necessary;
- all child issues and PRs record their proof level, limitations, rollout, and
  rollback status.

## References

- [Parent epic #931](https://github.com/dennisonbertram/fork-open-agents/issues/931)
- [Documentation issue #932](https://github.com/dennisonbertram/fork-open-agents/issues/932)
- [Earlier Agents + Workflows epic #409](https://github.com/dennisonbertram/fork-open-agents/issues/409)
- [Unifying agents + loops](workflows-unification.md)
- [Background Agents Epic](background-agents-epic.md)
- [Agent Loops Implementation Plan](agent-loops-epic.md)
- [Chief of Staff Account Coordinator](chief-of-staff-account-coordinator.md)
- [Managed Runtime Profiles](managed-runtime-profiles.md)
- [Verified Build Roadmap](verified-build-roadmap.md)
- [Workflow Catalog Conventions](../process/workflow-catalog-conventions.md)
- [Development Workflow](../process/development-workflow.md)
- [Feature And Ticket Format](../process/feature-ticket-format.md)
- [GitHub Build Process](../process/github-build-process.md)
- [Observability Discipline](../process/observability-discipline.md)
- [Deployed Feature Proof Standard](../process/deployed-feature-proof-standard.md)
- [Background Agents Live Proof](../process/background-agents-live-proof.md)
- [Loops Live Proof](../process/loops-live-proof.md)
