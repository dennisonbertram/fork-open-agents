# Verified Build Contracts V0

Prepared: 2026-05-14
Status: draft contract layer for the coordinator operating model

## Purpose

This document turns the [Verified Build Coordinator Operating Model](verified-build-coordinator-operating-model.md) into concrete v0 contracts. The current build sequence lives in [Verified Build Roadmap](verified-build-roadmap.md), the process-level builder guidance lives in [Verified Build Builder Observability](verified-build-builder-observability.md), and the future runtime inspection/debugging surface lives in [Verified Build Runtime Observability Requirements](verified-build-observability-requirements.md).

These contracts are the nouns that make coordinator tools legible. The coordinator should not reason in low-level mechanics such as "reserve scope" or "ask for evidence." It should create and inspect artifacts with clear meaning:

```text
ResearchPacket
BuildPlan
WorkcellContract
WorkerCompletionPacket
PlanChangeProposal
IntegrationResult
FinalBuildReport
```

The contracts here are not final database schemas. They are the minimum shape needed to build a deterministic dry run, then a harness service, then a real Open Agents Verified Build loop.

Executable schemas currently live in
`apps/web/lib/verified-build/contracts.ts`, with initial delegated workspace
linkage fixtures in `apps/web/lib/verified-build/contracts.test.ts`.

## Shared Conventions

All contracts should follow these conventions.

IDs:

```text
research_<slug-or-id>
build_<slug-or-id>
workcell_<slug-or-id>
proposal_<slug-or-id>
integration_<slug-or-id>
report_<slug-or-id>
artifact_<slug-or-id>
gate_<slug-or-id>
evidence_<slug-or-id>
```

Timestamps are ISO 8601 strings.

Paths are repository-relative unless the field explicitly says otherwise. Absolute local paths must not appear in persisted user-facing artifacts.

Statuses are intentionally small enums. If a caller needs more nuance, it should add structured reasons instead of inventing new status strings.

Every artifact that may contain logs, screenshots, command output, or provider data needs a redaction state.

```ts
type RedactionStatus =
  | "not_required"
  | "pending"
  | "passed"
  | "redacted"
  | "failed";
```

Every contract that can affect trusted completion should include provenance.

```ts
type ContractProvenance = {
  created_at: string;
  created_by: {
    actor_type: "user" | "coordinator" | "sub_coordinator" | "worker" | "harness";
    actor_id: string;
  };
  source_refs: string[];
};
```

Common references:

```ts
type ArtifactRef = {
  artifact_id: string;
  kind:
    | "research_packet"
    | "build_plan"
    | "workcell_contract"
    | "completion_packet"
    | "plan_change_proposal"
    | "integration_result"
    | "final_report"
    | "log"
    | "diff"
    | "screenshot"
    | "trace"
    | "gate_result"
    | "failure_capsule"
    | "manual_evidence";
  path?: string;
  url?: string;
  sha256?: string;
  redaction_status: RedactionStatus;
  summary?: string;
};
```

## Behavior And Evidence

The coordinator and harness should reason about behavior, not just files and commands.

```ts
type EvidenceKind =
  | "unit"
  | "typecheck"
  | "lint"
  | "api"
  | "database"
  | "worker_log"
  | "browser"
  | "agent_browser"
  | "manual_review"
  | "deployment"
  | "security"
  | "accessibility";

type BehaviorRequirement = {
  behavior_id: string;
  priority: "required" | "optional";
  statement: string;
  acceptance: string;
  required_evidence_kinds: EvidenceKind[];
};

type EvidenceRef = {
  evidence_id: string;
  behavior_ids: string[];
  kind: EvidenceKind;
  status: "passed" | "failed" | "blocked" | "needs_review";
  artifact_refs: ArtifactRef[];
  summary: string;
  limitations: string[];
};
```

Rules:

- Required behavior cannot be marked proven without evidence.
- Evidence must reference behavior IDs.
- Evidence with `limitations` can still be useful, but completion must decide whether the limitations leave behavior unproven.
- Worker-produced evidence should be rerun or sampled by the parent harness after integration for important gates.

## Surface Scope

V0 should use "surface" rather than only "file path" because complete applications involve APIs, databases, workers, routes, auth, and provider resources.

```ts
type SurfaceRef = {
  kind:
    | "file_glob"
    | "route"
    | "api_endpoint"
    | "database_schema"
    | "migration"
    | "worker"
    | "env_var"
    | "provider_resource"
    | "package"
    | "test"
    | "documentation";
  value: string;
  access: "read" | "write" | "own" | "forbidden";
  reason: string;
};
```

Rules:

- A workcell may read broader surfaces than it can write.
- Write and own scopes should be narrow.
- Forbidden surfaces should include secrets, auth state, production credentials, unrelated generated artifacts, and any product area outside the workcell.
- Risky overlap between writable surfaces should be detected when workcells are created.

## `ResearchPacket`

A research packet is a curated operating brief, not a transcript of search results.

```ts
type ResearchPacket = {
  packet_id: string;
  title: string;
  topic: string;
  purpose: string;
  target_stack_or_subsystem: string[];
  status: "draft" | "ready" | "stale" | "superseded" | "blocked";
  freshness: {
    researched_at: string;
    expires_at?: string;
    freshness_required: boolean;
    reason: string;
  };
  questions_answered: Array<{
    question: string;
    answer: string;
    confidence: "low" | "medium" | "high";
    source_refs: string[];
  }>;
  recommended_approach: string;
  sources_checked: Array<{
    title: string;
    url?: string;
    local_path?: string;
    source_type: "official_docs" | "repo_source" | "standard" | "issue" | "blog" | "other";
    checked_at: string;
  }>;
  versions_or_apis_confirmed: string[];
  setup_commands: string[];
  test_commands: string[];
  known_pitfalls: string[];
  security_notes: string[];
  deployment_notes: string[];
  worker_briefs: Array<{
    target_role: string;
    brief: string;
    include_by_default: boolean;
  }>;
  open_questions: Array<{
    question: string;
    blocking: boolean;
    suggested_resolution: string;
  }>;
  things_workers_must_not_assume: string[];
  artifact_refs: ArtifactRef[];
  provenance: ContractProvenance;
};
```

Validation rules:

- `sources_checked` is required unless status is `blocked`.
- Fresh library, framework, SDK, API, CLI, or cloud-service research must cite current documentation.
- `worker_briefs` should be concise enough to attach to a workcell without overwhelming the worker.
- Research packets can recommend architecture changes but cannot apply them.

## `BuildPlan`

The build plan is the coordinator's current map of the work.

```ts
type BuildPlan = {
  build_plan_id: string;
  title: string;
  status: "draft" | "ready" | "running" | "blocked" | "completed" | "superseded";
  source: {
    kind: "user_prompt" | "prd" | "issue" | "manual";
    summary: string;
    artifact_refs: ArtifactRef[];
  };
  user_intent_summary: string;
  non_goals: string[];
  architecture_map: {
    summary: string;
    domains: Array<{
      domain_id: string;
      name: string;
      responsibility: string;
      owned_surfaces: SurfaceRef[];
      dependencies: string[];
    }>;
    interface_contracts: Array<{
      contract_id: string;
      producer_domain_id: string;
      consumer_domain_ids: string[];
      summary: string;
      artifact_refs: ArtifactRef[];
    }>;
  };
  behavior_requirements: BehaviorRequirement[];
  milestones: Array<{
    milestone_id: string;
    title: string;
    exit_criteria: string[];
    depends_on: string[];
  }>;
  workcell_candidates: Array<{
    title: string;
    owner_role: string;
    objective: string;
    candidate_surfaces: SurfaceRef[];
    depends_on: string[];
  }>;
  research_packets_required: Array<{
    topic: string;
    purpose: string;
    required_before: "planning" | "workcell_launch" | "integration" | "finalization";
    status: "missing" | "commissioned" | "ready" | "waived";
    packet_id?: string;
  }>;
  evidence_strategy: Array<{
    behavior_id: string;
    required_evidence_kinds: EvidenceKind[];
    planned_workcell_ids: string[];
  }>;
  risks: Array<{
    risk_id: string;
    summary: string;
    severity: "low" | "medium" | "high";
    mitigation: string;
  }>;
  open_questions: Array<{
    question: string;
    blocking: boolean;
    owner: "user" | "coordinator" | "research_worker" | "sub_coordinator";
  }>;
  approval_points: Array<{
    approval_id: string;
    kind: "architecture" | "scope" | "provider" | "credential" | "budget" | "release";
    reason: string;
    required_before: string;
    status: "not_requested" | "pending" | "approved" | "rejected" | "waived";
  }>;
  version: number;
  supersedes_build_plan_id?: string;
  provenance: ContractProvenance;
};
```

Validation rules:

- A ready plan must include at least one required behavior.
- Workcell candidates must map to domains or explain why they are cross-domain.
- Provider, credential, budget, and release approval points must be explicit.
- If the plan changes parent-level architecture, the change should reference an approved `PlanChangeProposal`.

## `WorkcellContract`

A workcell is the smallest trusted unit of assigned work.

```ts
type WorkcellContract = {
  workcell_id: string;
  parent_id: string;
  parent_kind: "build_plan" | "workcell";
  title: string;
  objective: string;
  owner_role:
    | "research_worker"
    | "implementation_worker"
    | "qa_worker"
    | "integration_worker"
    | "repair_worker"
    | "sub_coordinator";
  mode: "research" | "implementation" | "integration" | "qa" | "repair";
  status: "draft" | "ready" | "running" | "blocked" | "completed" | "failed" | "cancelled";
  workspace_mode: "shared" | "isolated";
  delegated_worker?: {
    worker_id: string;
    run_id: string;
    workspace_mode: "shared" | "isolated";
    completion_packet_id?: string;
    validation_status: "valid" | "invalid" | "missing" | "partial";
  };
  assigned_agent?: {
    agent_id: string;
    agent_kind: "model_worker" | "deterministic_worker" | "sub_coordinator";
    sandbox_ref?: string;
  };
  surfaces: {
    readable: SurfaceRef[];
    writable: SurfaceRef[];
    owned: SurfaceRef[];
    forbidden: SurfaceRef[];
  };
  dependencies: Array<{
    dependency_id: string;
    kind: "workcell" | "research_packet" | "approval" | "external_input";
    required_status: string;
  }>;
  context: {
    required_packet_ids: string[];
    optional_packet_ids: string[];
    repo_setup_summary: string;
    commands_to_start: string[];
    commands_to_test: string[];
    relevant_lessons: string[];
  };
  behavior_requirements: BehaviorRequirement[];
  required_feedback_loop: Array<{
    step_id: string;
    command_or_action: string;
    required: boolean;
    evidence_kind?: EvidenceKind;
  }>;
  required_evidence: Array<{
    behavior_id: string;
    evidence_kind: EvidenceKind;
    required_before_completion: boolean;
  }>;
  budget: {
    max_wall_clock_minutes: number;
    max_model_cost_usd: number;
    max_repair_attempts: number;
  };
  done_criteria: string[];
  stop_conditions: string[];
  plan_change_policy: {
    may_propose_changes: boolean;
    may_apply_parent_plan_changes: false;
    requires_parent_approval_for: Array<"architecture" | "interface" | "scope" | "evidence" | "provider" | "credential">;
  };
  provenance: ContractProvenance;
};
```

Validation rules:

- `may_apply_parent_plan_changes` is always `false` in v0.
- A ready implementation, integration, QA, or repair workcell must include at least one required evidence entry or explicitly state why evidence is not required.
- Writable and forbidden surfaces must not overlap.
- Broad writable scope requires an approval point.
- A workcell should be understandable without reading the entire global plan.
- `workspace_mode` is the delegated worker launch preference for the workcell.
- `delegated_worker` records the persisted worker/run linkage after launch or
  packet attachment.

## `WorkerCompletionPacket`

The worker completion packet is the worker's structured handoff.

```ts
type WorkerCompletionPacket = {
  packet_id: string;
  workcell_id: string;
  status: "done" | "blocked" | "failed" | "needs_review";
  summary: string;
  changed_surfaces: SurfaceRef[];
  files_changed: string[];
  scope_check: {
    status: "in_scope" | "out_of_scope" | "needs_review";
    violations: Array<{
      surface: SurfaceRef;
      reason: string;
    }>;
  };
  commands_run: Array<{
    command: string;
    cwd?: string;
    status: "passed" | "failed" | "blocked" | "skipped";
    artifact_refs: ArtifactRef[];
  }>;
  gates_run: Array<{
    gate_id: string;
    status: "passed" | "failed" | "blocked" | "skipped";
    covered_behavior_ids: string[];
    artifact_refs: ArtifactRef[];
  }>;
  behavior_evidence: EvidenceRef[];
  artifacts: ArtifactRef[];
  unproven_requirements: Array<{
    behavior_id: string;
    reason: string;
    suggested_next_action: string;
  }>;
  known_risks: Array<{
    summary: string;
    severity: "low" | "medium" | "high";
    mitigation?: string;
  }>;
  blockers: Array<{
    summary: string;
    blocked_on: "user" | "coordinator" | "external_service" | "dependency" | "budget" | "credential";
  }>;
  diff_ref?: ArtifactRef;
  commit_ref?: string;
  cost_summary: {
    model_cost_usd: number;
    sandbox_minutes?: number;
    duration_ms: number;
  };
  self_review: {
    checked_scope: boolean;
    checked_tests: boolean;
    checked_secrets: boolean;
    notes: string;
  };
  suggested_next_action: "integrate" | "repair" | "ask_user" | "needs_review" | "abandon";
  delegated_worker: {
    worker_id: string;
    run_id: string;
    workspace_mode: "shared" | "isolated";
    validation_status: "valid" | "invalid" | "missing" | "partial";
  };
  provenance: ContractProvenance;
};
```

Validation rules:

- `done` requires `scope_check.status` to be `in_scope`.
- `done` requires no unproven required behavior assigned to the workcell.
- `done` requires at least one command, gate, or evidence artifact unless the workcell is explicitly research-only.
- Failed or blocked work should include enough artifacts to create a repair workcell or explain the blocker.
- Completion packets are claims, not final truth. Parent integration and harness finalization may reject them.
- Worker packets must name the delegated worker run and workspace mode so final
  reports can cite provenance without scraping chat/tool transcripts.

## `PlanChangeProposal`

Plan change proposals prevent silent architecture drift.

```ts
type PlanChangeProposal = {
  proposal_id: string;
  proposed_by: {
    actor_type: "worker" | "sub_coordinator" | "coordinator" | "harness";
    actor_id: string;
    workcell_id?: string;
  };
  affected_ids: string[];
  change_type: "architecture" | "interface" | "scope" | "evidence" | "dependency" | "timeline" | "budget";
  status: "draft" | "pending" | "approved" | "rejected" | "superseded";
  current_assumption: string;
  new_information: string;
  proposed_change: string;
  impact: {
    behavior_ids: string[];
    workcell_ids: string[];
    surfaces: SurfaceRef[];
    risk_summary: string;
  };
  approval_required_from: "top_coordinator" | "user" | "operator";
  decision?: {
    decided_at: string;
    decided_by: string;
    rationale: string;
  };
  provenance: ContractProvenance;
};
```

Validation rules:

- Parent-level architecture, interface, evidence, provider, credential, or broad scope changes must be represented as proposals.
- Workers and sub-coordinators may propose changes; they may not apply parent-level changes directly.
- Rejected proposals should remain in audit history.

## `IntegrationResult`

Integration result records whether completed work can survive the parent context.

```ts
type IntegrationResult = {
  integration_id: string;
  parent_id: string;
  parent_kind: "build_plan" | "workcell";
  integrated_workcell_ids: string[];
  status: "integrated" | "conflicted" | "failed" | "needs_review" | "blocked";
  merge: {
    strategy: "patch" | "git_merge" | "cherry_pick" | "manual" | "synthetic";
    base_ref?: string;
    result_ref?: string;
    conflicts: Array<{
      surface: SurfaceRef;
      summary: string;
      owner_workcell_ids: string[];
    }>;
  };
  files_integrated: string[];
  evidence_preserved: EvidenceRef[];
  post_merge_gates: Array<{
    gate_id: string;
    status: "passed" | "failed" | "blocked" | "skipped";
    artifact_refs: ArtifactRef[];
  }>;
  new_failures: Array<{
    failure_id: string;
    summary: string;
    related_behavior_ids: string[];
    artifact_refs: ArtifactRef[];
  }>;
  repair_workcells_opened: string[];
  unintegrated_workcell_ids: string[];
  provenance: ContractProvenance;
};
```

Validation rules:

- Worker `done` does not imply integration `integrated`.
- Integration must preserve evidence references or explain why they became stale.
- Failed post-merge gates should produce failures or repair workcells.
- Merge conflicts should name the affected surfaces and owning workcells.

## `FinalBuildReport`

The final report is user-facing and audit-friendly. It is the artifact the system should be comfortable standing behind.

```ts
type FinalBuildReport = {
  report_id: string;
  build_plan_id: string;
  final_status: "go" | "no_go" | "needs_review" | "blocked";
  user_goal_summary: string;
  work_completed: Array<{
    workcell_id: string;
    summary: string;
    status: string;
    delegated_worker?: {
      worker_id: string;
      run_id: string;
      workspace_mode: "shared" | "isolated";
      validation_status: "valid" | "invalid" | "missing" | "partial";
    };
  }>;
  behavior_coverage: Array<{
    behavior_id: string;
    priority: "required" | "optional";
    status: "proven" | "waived" | "missing" | "blocked";
    evidence_refs: EvidenceRef[];
    notes: string;
  }>;
  gates_run: Array<{
    gate_id: string;
    status: "passed" | "failed" | "blocked" | "skipped";
    summary: string;
  }>;
  evidence_artifacts: ArtifactRef[];
  integrations: Array<{
    integration_id: string;
    status: string;
    summary: string;
  }>;
  repairs_performed: Array<{
    repair_workcell_id: string;
    failure_summary: string;
    status: string;
  }>;
  unproven_requirements: Array<{
    behavior_id: string;
    reason: string;
    required_for_go: boolean;
  }>;
  known_risks: Array<{
    summary: string;
    severity: "low" | "medium" | "high";
    mitigation?: string;
  }>;
  approval_history: Array<{
    approval_id: string;
    kind: string;
    status: "approved" | "rejected" | "waived";
    rationale: string;
  }>;
  cost_and_duration: {
    total_model_cost_usd: number;
    total_duration_ms: number;
    worker_count: number;
    repair_count: number;
  };
  next_recommended_action: string;
  artifact_refs: ArtifactRef[];
  provenance: ContractProvenance;
};
```

Validation rules:

- `go` requires every required behavior to be `proven` or explicitly `waived`.
- `go` requires final integrated gates to pass or be explicitly waived.
- `go` is not allowed when artifact redaction failed.
- `blocked` should name the missing user input, credential, provider, budget, or dependency.
- `needs_review` should name the review decision the user or operator must make.

## Tool-To-Contract Mapping

The first coordinator tools map cleanly to these contracts.

| Tool | Primary output | Reads |
| --- | --- | --- |
| `create_research_packet` | `ResearchPacket` | PRD, repo, current docs, prior packets |
| `create_build_plan` | `BuildPlan` | PRD, user intent, research packets |
| `create_workcell` | `WorkcellContract` | build plan, research packets, active workcells |
| `launch_workcell` | run state | workcell contract, sandbox policy |
| `inspect_workcell` | `WorkerCompletionPacket` or partial packet | run state, artifacts |
| `integrate_workcell` | `IntegrationResult` | completion packets, parent workspace |
| `open_repair` | `WorkcellContract` | failures, capsules, integration result |
| `propose_plan_change` | `PlanChangeProposal` | workcell findings, build plan |
| `finalize_build` | `FinalBuildReport` | build plan, integrations, evidence, approvals |

## V0 Dry Run Requirements

The first deterministic dry run should prove these contracts without real model workers.

It should create:

- one `ResearchPacket`;
- one `BuildPlan`;
- at least three `WorkcellContract` records;
- at least three `WorkerCompletionPacket` records;
- one `IntegrationResult`;
- one `FinalBuildReport`.

The dry run should include:

- one frontend-like workcell;
- one backend/API-like workcell;
- one QA/evidence workcell;
- one required behavior with browser evidence;
- one required behavior with API or unit evidence;
- one simulated failure that opens a repair workcell;
- one final report that is `go` only after repair and integration evidence are present.

## Open Decisions

- Should these contracts live first as TypeScript types in Open Agents, Zod schemas in the harness, or both?
- Which fields are persisted in Postgres versus kept in artifact storage?
- How much of `ResearchPacket.worker_briefs` should be embedded directly into worker prompts?
- Should `SurfaceRef` become a first-class lock/lease object or remain part of workcell validation?
- Which evidence kinds are required for the first PRD dry run?
- How should plan proposals be displayed to users versus hidden as internal coordinator decisions?
