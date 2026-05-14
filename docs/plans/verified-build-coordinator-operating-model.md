# Verified Build Coordinator Operating Model

Prepared: 2026-05-14

## Purpose

Verified Build turns Open Agents from a single coding agent in a sandbox into a governed software-building organization.

The current build status lives in [Verified Build Roadmap](verified-build-roadmap.md). The process-level observability requirements for humans and coding agents building this system live in [Verified Build Builder Observability](verified-build-builder-observability.md). Runtime/product observability for future Verified Build runs lives in [Verified Build Runtime Observability Requirements](verified-build-observability-requirements.md). The concrete v0 artifact shapes for this model live in [Verified Build Contracts V0](verified-build-contracts-v0.md).

The coordinator is a model agent with tools and memory, but it is not the primary coder. It communicates with the user, maintains intent, commissions research, decomposes work, launches scoped workers or sub-coordinators, integrates results, and decides whether evidence is strong enough to report go or no-go.

The harness is the control plane that makes this trustworthy. It owns launch contracts, policy, gates, evidence, failure capsules, repair loops, audit, trace, and final completion reports.

The guiding promise is:

```text
PRD or user goal
  -> coordinator
  -> research packets
  -> build plan
  -> workcells
  -> worker sandboxes
  -> completion packets
  -> integration
  -> gates and evidence
  -> repair when needed
  -> final go/no-go report
```

## Design Principles

- The coordinator should use organizational tools, not general-purpose coding tools.
- Workers may write code, but evidence decides whether the work counts.
- Worker self-checks are required, but they are not final authority.
- Serious code-changing work routes through Verified Build by default.
- Direct Coding remains an explicit fast/developer escape hatch for small edits, experiments, or expert override.
- The system should optimize first for completeness and correctness. Parallelism comes after the loop is reliable.
- Start by proving reliable coordination of a small team, such as 3 to 8 workers, before designing for very large swarms.
- Research artifacts should improve worker context without becoming giant context dumps.
- Sub-coordinators may maintain local plans, but parent-level architecture changes must be proposed upward.
- Shared state should give workers enough to operate, not enough to distract.

## Roles

### User

The user provides intent, a PRD, constraints, approvals, and product judgment. The user should see which mode the system selected and why.

### Top-Level Coordinator

The top-level coordinator is the user-facing agent. It behaves more like a technical program manager and release manager than a programmer.

Responsibilities:

- preserve user intent;
- ask clarifying questions when needed;
- commission research packets;
- create and update the build plan;
- create workcells with scoped contracts;
- launch workers and sub-coordinators;
- inspect completion packets;
- integrate completed work;
- create repair work when evidence fails;
- propose user-visible decisions and approvals;
- produce the final go/no-go report.

The coordinator should not directly edit application code in the trusted path.

### Sub-Coordinator

A sub-coordinator owns a bounded domain of the build, such as backend, frontend, data, QA, deployment, or a large feature area.

Responsibilities:

- decompose its assigned domain into child workcells;
- launch and inspect child workers;
- integrate child outputs into a domain result;
- report domain status upward;
- propose architecture or contract changes upward when the original plan no longer fits reality.

A sub-coordinator may refine its local plan, but it should not silently change parent architecture, global interfaces, evidence requirements, or user-visible scope.

### Worker

A worker is an implementation or research agent with a narrow contract. Workers operate in isolated sandboxes or workspaces.

Responsibilities:

- understand the workcell contract;
- inspect only the context needed for the task;
- make changes inside allowed scope;
- run the required local feedback loop;
- return a completion packet with evidence, risks, and unproven requirements.

Workers should communicate through artifacts and coordinator-mediated updates, not free-form peer chat by default.

### Harness

The harness is not a personality. It is the authority layer.

Responsibilities:

- validate intent and task specs;
- enforce file, tool, credential, and budget policy;
- manage run state;
- emit ledger and trace events;
- run gates;
- validate evidence artifacts;
- create failure capsules;
- coordinate repair loops;
- verify completion against behavior evidence;
- publish final reports.

## Coordinator Tools

Coordinator tools should be obvious high-level organizational actions. Lower-level mechanics, such as reserving scope or requesting evidence, should be embedded in higher-level contracts until they become important enough to expose directly.

### `create_research_packet`

Commission a read-only research artifact for a technology, API, architecture option, repo subsystem, or failure class.

Use when:

- planning a stack or integration;
- a worker needs current library or platform knowledge;
- a failure suggests misunderstanding of an API, framework, provider, or local architecture;
- the coordinator needs a concise operating brief before assigning implementation work.

Research packets must include provenance, freshness, open questions, and worker-specific applicability.

### `create_build_plan`

Convert the PRD or user goal into a build plan with domains, milestones, dependencies, risks, and evidence strategy.

This tool should produce the initial architecture map and identify where research packets are needed before work starts.

### `create_workcell`

Create a scoped unit of work with:

- objective;
- owner role;
- allowed and forbidden surfaces;
- dependencies;
- required context packets;
- required feedback loop;
- evidence requirements;
- budget;
- done criteria.

Scope reservation happens inside this tool. If the new workcell overlaps another active workcell in a risky way, the tool should warn, block, or require coordinator review.

### `launch_workcell`

Start a worker or sub-coordinator in an isolated sandbox or workspace using the workcell contract.

The launched agent receives only the context needed to execute the workcell, plus links or packet references for optional context.

### `inspect_workcell`

Return the current state of a workcell:

- status;
- changed surfaces;
- gates run;
- evidence produced;
- blockers;
- costs;
- latest completion packet or partial packet;
- relevant logs and artifacts.

This tool should summarize by default and expose raw artifacts only when explicitly needed.

### `integrate_workcell`

Attempt to merge or import a completed workcell into the parent integration workspace.

It should report:

- merge status;
- conflicts;
- integrated files;
- post-merge gates;
- integration risks;
- required repairs.

### `open_repair`

Create a repair workcell from a failed gate, failed evidence check, merge conflict, incomplete completion packet, or failure capsule.

Repairs must be bounded to the failure, allowed scope, and remaining budget.

### `propose_plan_change`

Submit an architecture, interface, scope, or evidence change for parent approval.

Sub-coordinators and workers use this when reality disagrees with the plan. They should not silently mutate parent-level contracts.

### `finalize_build`

Run final completion checks, verify behavior coverage, collect reports, and produce the final go/no-go decision.

This is the only tool that can move a trusted build into final completed status.

## Core Artifacts

### Research Packet

A research packet is not a search result dump. It is a curated operating brief.

Minimum fields:

```text
packet_id
topic
purpose
target_stack_or_subsystem
questions_answered
recommended_approach
sources_checked
freshness_date
versions_or_apis_confirmed
setup_commands
test_commands
known_pitfalls
security_notes
deployment_notes
worker_brief
open_questions
things_workers_must_not_assume
```

Rules:

- Research workers are read-only by default.
- Research packets may recommend architecture but do not change architecture by themselves.
- Packets should be sliced into worker-specific briefs before distribution.
- Packets should expire or require refresh when the underlying library, provider, or platform is likely to have changed.

### Build Plan

The build plan is the coordinator's map of the work.

Minimum fields:

```text
build_plan_id
source_prd_or_goal
user_intent_summary
architecture_map
domains
milestones
workcell_candidates
research_packets_required
interface_contracts
evidence_strategy
risks
open_questions
approval_points
```

The build plan can evolve, but parent-level changes must be visible in the audit trail.

### Workcell Contract

A workcell is the smallest trusted unit of assigned work.

Minimum fields:

```text
workcell_id
parent_id
title
objective
owner_role
mode: research | implementation | integration | qa | repair
allowed_surfaces
forbidden_surfaces
dependencies
context_packets
required_feedback_loop
required_evidence
budget
done_criteria
stop_conditions
plan_change_policy
```

The workcell should be obvious to a human reviewer. If the contract is too vague for a person, it is too vague for an agent.

### Worker Completion Packet

Every worker must return a completion packet before its result can be integrated.

Minimum fields:

```text
workcell_id
status: done | blocked | failed | needs_review
summary
files_changed
scope_check_result
commands_run
tests_run
gates_run
behavior_evidence
artifacts
unproven_requirements
known_risks
blockers
diff_or_commit_ref
cost_summary
suggested_next_action
```

The critical questions are:

```text
What changed?
Was it inside scope?
How was it tested?
What user-visible behavior is proven?
What is still unproven?
```

### Plan Change Proposal

Workers and sub-coordinators use this when the plan needs to change.

Minimum fields:

```text
proposal_id
proposed_by
affected_plan_or_workcell
change_type: architecture | interface | scope | evidence | dependency | timeline
current_assumption
new_information
proposed_change
impact
risks
approval_required_from
```

### Integration Result

Integration is a separate outcome from worker completion.

Minimum fields:

```text
integration_id
parent_workcell_or_build_plan
integrated_workcells
merge_status
conflicts
files_integrated
post_merge_gates
evidence_preserved
new_failures
repair_workcells_opened
```

### Final Build Report

The final report is user-facing and audit-friendly.

Minimum fields:

```text
build_id
final_status: go | no_go | needs_review | blocked
user_goal_summary
work_completed
behavior_coverage
gates_run
evidence_artifacts
repairs_performed
unproven_requirements
known_risks
approval_history
cost_and_duration
next_recommended_action
```

## Feedback Loop

Workers must test and check their own work before reporting completion. This avoids making the coordinator review large piles of unverified code.

A normal implementation worker feedback loop should include:

```text
read task contract
inspect relevant context
make scoped change
run local unit/type/lint checks where applicable
run task-specific API/browser/worker evidence where applicable
self-review diff for scope and accidental damage
write completion packet
```

The parent coordinator or harness must still rerun important gates after integration. Worker self-evidence is necessary but not sufficient.

Completion must fail or require review when:

- required behavior evidence is missing;
- changed files escape scope;
- tests are deleted, skipped, or weakened without approval;
- credentials or auth state leak into artifacts;
- a worker changes architecture or interfaces without an approved proposal;
- final integrated gates disagree with worker evidence.

## Shared State

Workers should receive enough shared state to operate, but not the entire global context by default.

Always available:

```text
repo setup guide
commands to run app and tests
architecture overview
current workcell contract
relevant interface contracts
allowed and forbidden surfaces
required research packet briefs
active blockers relevant to the workcell
lessons learned relevant to the workcell
```

Available on request:

```text
full PRD
global architecture map
other workcell summaries
integration branch status
historical failure capsules
raw logs and artifacts
```

Not available by default:

```text
all other workers' raw logs
unrelated implementation details
entire global conversation
unfiltered repo history
secrets or auth state
```

Shared state should include surface awareness, such as active workcell summaries and changed areas, but workers should not freely coordinate through open-ended peer chat in the first version.

## Sandbox And Integration Model

The long-term model should favor isolation:

```text
worker workcell -> isolated sandbox
sub-coordinator -> domain integration sandbox
top coordinator -> final integration branch or sandbox
```

One sandbox for an entire run may be useful for early implementation, but the operating model should not depend on shared mutable state. Per-workcell isolation makes misbehavior easier to contain and evidence easier to attribute.

For large builds, a sub-coordinator may own an integration sandbox where it merges child workcell outputs and returns a coherent domain result upward. Lower-level workers should not be responsible for global merges.

## Modes

Open Agents should expose mode clearly:

```text
Chat
Investigation
Verified Build
Direct Coding
```

Default routing:

- Chat for explanation, brainstorming, and no-code discussion.
- Investigation for read-only discovery, review, or planning.
- Verified Build for user-facing, multi-file, risky, long-running, PR-bound, or production-like work.
- Direct Coding for explicit fast/developer mode.

Verified Build should be the trusted path. Direct Coding can remain available, but it should be visually distinct and should not claim the same evidence-backed guarantees.

## First Demo Shape

Avoid overfitting the system to one demo app. The first demo should prove the organization loop, not a specific product idea.

A good first PRD should require:

- frontend;
- backend/API;
- database or persistent state;
- background worker or scheduled process;
- auth-shaped or permissioned behavior;
- browser evidence;
- API evidence;
- integration and repair.

The demo should be small enough to run locally and complex enough that a single-agent sandbox workflow feels inadequate.

The success criterion is not "an agent generated a small app." The success criterion is:

```text
Given a PRD, the coordinator decomposed the work, commissioned research, launched scoped agents, integrated their outputs, repaired failures, and produced a trustworthy go/no-go report with evidence.
```

## Open Decisions

- Which coordinator tools need to exist in the first service API, and which should remain internal orchestration mechanics?
- What is the exact schema for research packets, workcell contracts, and completion packets?
- How much global architecture context should be included by default for each workcell type?
- When should a task become a sub-coordinator assignment instead of a worker assignment?
- How should parent coordinators compare child evidence against independently rerun gates?
- What merge strategy should be used for early multi-worker builds?
- How should lessons learned propagate without turning into noisy global memory?
