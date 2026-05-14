# Verified Build Runtime Observability Requirements

Prepared: 2026-05-14

## Purpose

Verified Build runs should be observable before they are powerful. The system should not depend on a coordinator saying "done" because the transcript looks plausible. It should expose enough structured state that a human, a coordinator, or a future coding agent can inspect a running or completed build and understand:

- what the user asked for;
- what the coordinator planned;
- what each workcell was allowed to touch;
- what each worker claimed;
- what evidence exists;
- which gates passed or failed;
- what was repaired;
- why the final decision is `go` or `no_go`.

This document defines runtime/product observability for future Verified Build runs. For the observability needed by humans and coding agents while building Verified Build itself, read [Verified Build Builder Observability](verified-build-builder-observability.md) first.

Related docs:

- [Verified Build Roadmap](verified-build-roadmap.md)
- [Verified Build Builder Observability](verified-build-builder-observability.md)
- [Verified Build Coordinator Operating Model](verified-build-coordinator-operating-model.md)
- [Verified Build Contracts V0](verified-build-contracts-v0.md)
- [Open Agents Verified Build Implementation Plan](open-agents-verified-build-implementation-plan.md)

Repo-local skill:

- `.agents/skills/verified-build-observability/SKILL.md`

## Principle

If the coordinator can make a decision, the decision should leave an inspectable trace.

If a worker can claim something is complete, the claim should be tied to contract scope and evidence.

If the system can report `go`, the report should map every required behavior to passing evidence.

## What A Future Runtime Inspector Needs

A future coordinator, operator, or coding agent inspecting a Verified Build run needs a small set of reliable runtime signals before it can trust the build flow:

- run id, status, owner, mode, and intent summary;
- current coordinator state;
- current workcell states;
- assigned and forbidden surfaces;
- event names and state transitions;
- artifact refs and redaction status;
- evidence coverage matrix;
- gate results;
- integration attempts;
- failure and repair history;
- final report status and rationale.

The builder-process version of these signals lives in [Verified Build Builder Observability](verified-build-builder-observability.md). The runtime version should live in queryable state, not only in agent chat history.

## Observability Layers

### 1. Roadmap Linkage

Purpose: make sure runtime observability work remains tied to the build roadmap.

Required artifacts:

- [Verified Build Roadmap](verified-build-roadmap.md)
- [Verified Build Builder Observability](verified-build-builder-observability.md)
- runtime observability step gates;
- links to runtime tests, fixtures, event definitions, and UI surfaces.

Minimum requirement before implementation:

- future agents have a local skill that tells them to read the builder observability plan before touching Verified Build;
- runtime observability work has an explicit roadmap gate;
- runtime event, evidence, trace, and artifact expectations are linked from the relevant step.

Agent-readable question:

```text
Where are we in the Verified Build build process, and what proves the next step is done?
```

### 2. Contract Observability

Purpose: make claims machine-checkable.

Required artifacts:

- Zod schemas for every v0 contract;
- inferred TypeScript types;
- passing fixtures;
- failing fixtures;
- validation errors that identify the broken field and reason;
- tests for evidence coverage and final go/no-go constraints.

Required contracts:

- `ResearchPacket`
- `BuildPlan`
- `WorkcellContract`
- `WorkerCompletionPacket`
- `PlanChangeProposal`
- `IntegrationResult`
- `FinalBuildReport`

Minimum requirement before real workers:

- invalid contracts fail validation;
- incomplete evidence fails validation;
- out-of-scope worker claims fail validation;
- a final report cannot be `go` without required behavior evidence.

Agent-readable question:

```text
Is this artifact valid, and if not, exactly which contract rule did it violate?
```

### 3. Coordinator Trace Observability

Purpose: make coordinator decisions inspectable.

Required event categories:

- run accepted;
- mode selected;
- research commissioned;
- research completed;
- build plan created;
- workcell created;
- workcell launched;
- workcell inspected;
- workcell completed;
- workcell failed;
- integration started;
- integration completed;
- gate started;
- gate completed;
- repair opened;
- plan change proposed;
- plan change accepted or rejected;
- final report created.

Every event should include:

- `event_id`
- `run_id`
- `timestamp`
- `actor_type`
- `actor_id`
- `event_name`
- `summary`
- `related_artifact_ids`
- `request_id` when request-related
- redacted metadata

Minimum requirement before the dry-run coordinator:

- a deterministic dry run emits a stable event timeline;
- tests can snapshot or assert important event transitions;
- event payloads avoid raw secrets and raw artifact content.

Agent-readable question:

```text
What did the coordinator decide, when did it decide it, and which artifact or evidence caused that decision?
```

### 4. Workcell State Observability

Purpose: make worker lifecycle and scope visible.

Recommended states:

- `draft`
- `ready`
- `launched`
- `running`
- `blocked`
- `completed`
- `failed`
- `repair_requested`
- `integrated`
- `rejected`

Every workcell status view should show:

- workcell id;
- parent run id;
- parent coordinator id;
- assigned role;
- assigned surfaces;
- forbidden surfaces;
- required outputs;
- required evidence;
- current state;
- start and end timestamps;
- completion packet id when available;
- failure capsule id when failed;
- repair workcell id when repaired.

Minimum requirement before real workers:

- workcell state transitions are validated;
- workers cannot report completion for unassigned surfaces;
- failed workcells produce inspectable failure records.

Agent-readable question:

```text
What is this worker responsible for, what state is it in, and what proof has it returned?
```

### 5. Evidence Coverage Observability

Purpose: make "done" mean "covered by evidence."

The central view is an evidence matrix:

```text
behavior requirement -> owner workcell -> required evidence -> actual evidence -> gate status -> final decision
```

Every behavior requirement should expose:

- requirement id;
- user-facing summary;
- source artifact;
- assigned workcell;
- required evidence kinds;
- received evidence refs;
- gate status;
- missing evidence;
- final coverage status.

Evidence should expose:

- evidence id;
- kind;
- producer;
- command or probe summary;
- timestamp;
- artifact refs;
- redaction status;
- pass/fail status;
- linked requirement ids.

Minimum requirement before the dry-run coordinator:

- the dry run can produce an evidence matrix;
- tests prove missing required evidence blocks `go`;
- tests prove wrong-kind evidence does not satisfy a requirement;
- tests prove stale or failed evidence does not satisfy a requirement.

Agent-readable question:

```text
Which requirements are covered, which are missing proof, and why is the final decision allowed or blocked?
```

### 6. Integration And Repair Observability

Purpose: make merge and repair work explainable.

Integration records should show:

- integration id;
- input workcell ids;
- input completion packet ids;
- changed surfaces;
- merge status;
- conflict status;
- gates run after integration;
- new evidence produced;
- failures detected;
- repair workcells opened.

Repair records should show:

- source failure;
- failed requirement or gate;
- repair workcell id;
- repair scope;
- repair output;
- evidence added by repair;
- final result.

Minimum requirement before real integration:

- integration success and failure are recorded;
- repair workcells are linked to the failure that caused them;
- final reports cite repair evidence when a repair was required.

Agent-readable question:

```text
What changed during integration, what broke, what repaired it, and what evidence proves the repair worked?
```

### 7. Runtime Recovery Observability

Purpose: let Open Agents recover and inspect runs after refresh, disconnect, or process restart.

Required runtime state:

- run mapping row;
- redacted event mirror;
- last event id;
- last event name;
- last event timestamp;
- final report artifact id;
- go/no-go state;
- approval state;
- cancellation state;
- cleanup debt state.

Minimum requirement before UI flow:

- refresh can reconstruct the visible timeline;
- stale cursors can replay missing events;
- terminal runs remain inspectable;
- cancellation shows cleanup and recovery state instead of only "stopped."

Agent-readable question:

```text
After reconnecting, what is the authoritative run state and what events did we miss?
```

### 8. Redaction And Safety Observability

Purpose: make inspection safe.

Before any log, trace, artifact preview, or event mirror write:

- drop raw request and response bodies by default;
- redact bearer tokens, cookies, passwords, API keys, private keys, and secret-looking strings;
- redact raw artifact content unless explicitly redaction-passed;
- redact stdout and stderr unless summarized;
- preserve safe references such as `credential-ref:*`, `secret-ref:*`, and `artifact-store:*`.

Every artifact or evidence ref should include:

- `redaction_status`;
- safe preview availability;
- blocked reason when unavailable.

Minimum requirement before artifact UI:

- tests cover representative secret values;
- blocked artifacts are visible as blocked, not silently missing;
- trace and audit routes are read-only and owner-scoped.

Agent-readable question:

```text
Can this artifact or event be safely shown, and if not, why is it blocked?
```

## Required Dry-Run Observability

The first dry run should emit these inspectable outputs:

- run summary;
- coordinator event timeline;
- research packet;
- build plan;
- workcell contracts;
- worker completion packets;
- evidence matrix;
- simulated failure;
- repair workcell;
- integration result;
- final build report.

The dry run should have two canonical fixture traces:

- `blocked-before-repair`: final report is `no_go` or blocked because required evidence is missing or failed;
- `go-after-repair`: final report is `go` after repair and required evidence pass.

These fixtures are the first proof that the trust loop is real.

## Minimum Observability Before Each Roadmap Step

| Roadmap step | Observability required before starting |
| --- | --- |
| Step 1: Builder Observability Foundation | Roadmap, builder observability doc, runtime observability requirements, and repo-local skill exist. |
| Step 2: Executable Contracts | Step 1 is complete; roadmap links to contract docs. |
| Step 3: Dry-Run Coordinator | Contract schemas, validation tests, and fixtures exist. |
| Step 4: Harness Integration | Dry-run event timeline and evidence matrix exist. |
| Step 5: Real Worker Execution | Workcell state model and completion packet validation exist. |
| Step 6: Real Integration Loop | Integration and repair records exist in dry-run form. |
| Step 7: Open Agents UI Flow | Runtime recovery state and redacted event mirror are designed. |
| Step 8: Wow Demo | Final report, evidence matrix, trace, and repair history are user-visible. |

## Non-Goals For V0

- Third-party trace export from Open Agents.
- Large-scale swarm coordination.
- Direct worker-to-worker chat.
- Unredacted artifact browsing.
- Treating worker self-checks as final proof.

## Open Decisions

- Should the dry-run traces live as JSON fixtures, TypeScript builders, or both?
- Should the evidence matrix be stored as an artifact, computed from events, or both?
- Which event payloads belong in Postgres versus artifact storage?
- Should roadmap status remain a doc, become a generated status artifact, or both?
- Which contract validation errors should be user-facing versus operator-only?
