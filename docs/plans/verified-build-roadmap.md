# Verified Build Roadmap

Prepared: 2026-05-14

## Purpose

This roadmap is the short, durable status map for building Verified Build. It exists so a human or coding agent can answer three questions quickly:

- where are we in the build process?
- what must be true before we advance?
- what evidence proves the current step is complete?

The deeper model docs are:

- [Verified Build Observability Requirements](verified-build-observability-requirements.md)
- [Verified Build Coordinator Operating Model](verified-build-coordinator-operating-model.md)
- [Verified Build Contracts V0](verified-build-contracts-v0.md)
- [Open Agents Verified Build Implementation Plan](open-agents-verified-build-implementation-plan.md)

The repo-local agent skill is:

- `.agents/skills/verified-build-observability/SKILL.md`

## Current Status

Current step: **Step 2, Executable Contracts**.

Step 0 defined the concept model. Step 1 made the planning and observability foundation durable enough for future agents. Step 2 must not advance until the contracts are executable, tested, and observable in deterministic fixtures.

## Roadmap

| Step | Name | Goal | Status |
| --- | --- | --- | --- |
| 0 | Concept Model | Define the coordinator, workers, trust loop, artifacts, and evidence model. | Complete |
| 1 | Observability Foundation | Save the repo-local guidance future agents need before implementation starts. | Complete |
| 2 | Executable Contracts | Turn artifact docs into typed schemas and validation tests. | Next |
| 3 | Dry-Run Coordinator | Prove the coordinator loop with mocked workers and deterministic traces. | Not started |
| 4 | Harness Integration | Connect the coordinator contracts to harness gates, audit, cancellation, and reports. | Not started |
| 5 | Real Worker Execution | Replace mocked workers with sandbox-spawned agents using scoped workcell contracts. | Not started |
| 6 | Real Integration Loop | Merge workcell outputs, rerun gates, detect conflicts, and open repair workcells. | Not started |
| 7 | Open Agents UI Flow | Render Verified Build mode, timeline, workcells, evidence, repair, and final reports. | Not started |
| 8 | Wow Demo | Run a PRD-driven multi-agent build with evidence and a final go/no-go report. | Not started |

## Step Details

### Step 0: Concept Model

Goal: make the operating model understandable before implementation starts.

Inputs:

- user goals and constraints from the planning discussion;
- existing Open Agents implementation plan;
- autonomous build infrastructure strategy docs.

Completion evidence:

- coordinator role is documented;
- worker and sub-coordinator roles are documented;
- harness responsibility is documented;
- trust loop is documented;
- core artifacts are named;
- open decisions are captured.

Exit gate:

- [Verified Build Coordinator Operating Model](verified-build-coordinator-operating-model.md) exists.
- [Verified Build Contracts V0](verified-build-contracts-v0.md) exists.

Status: complete.

### Step 1: Observability Foundation

Goal: make future Verified Build work observable before runtime implementation starts.

Build:

- repo-local `verified-build-observability` skill;
- roadmap status and exit gates;
- observability requirements;
- required reading order for future agents;
- rules that prevent implementation from advancing without evidence;
- links between the roadmap, observability requirements, contracts, operating model, and implementation plan.

Completion evidence:

- `.agents/skills/verified-build-observability/SKILL.md` exists;
- the skill tells future agents which docs to read before touching Verified Build;
- this roadmap identifies observability as the first implementation step;
- observability requirements define what future agents need to inspect each build phase;
- `git diff --check` passes;
- `bun --bun run ci` passes.

Exit gate:

- the observability skill and docs are committed with the planning docs;
- future agents can answer what step the project is in and what evidence is required before coding;
- Step 2 is blocked until this foundation exists.

Status: complete.

### Step 2: Executable Contracts

Goal: make the contracts machine-checkable.

Build:

- Zod schemas for every v0 artifact;
- TypeScript types inferred from those schemas;
- validators for evidence coverage, surface scope, workcell completion, and final go/no-go;
- passing and failing fixture packets;
- tests that reject invalid packets and incomplete evidence.

Completion evidence:

- contract schemas exist in a stable module;
- all v0 artifacts from [Verified Build Contracts V0](verified-build-contracts-v0.md) are covered;
- tests prove final reports cannot be `go` without required evidence;
- tests prove missing, stale, or wrong-kind evidence is rejected;
- tests prove workers cannot claim out-of-scope surfaces as completed work.

Exit gate:

- contract tests pass;
- `bun --bun run ci` passes;
- docs link to the schema module and test fixtures.

Status: next.

### Step 3: Dry-Run Coordinator

Goal: prove the full trust loop without real model workers.

Build:

- deterministic dry-run coordinator state machine;
- mocked research packet generation;
- mocked workcell launches and completion packets;
- one simulated failure;
- one repair workcell;
- deterministic final report;
- run trace fixture that can be replayed in tests.

Completion evidence:

- dry run creates one research packet, one build plan, at least three workcells, at least three completion packets, one integration result, and one final report;
- dry run blocks `go` before repair;
- dry run returns `go` only after the required repair and evidence are present;
- dry run emits a readable event timeline and evidence matrix.

Exit gate:

- dry-run tests pass;
- a single command can print or snapshot the dry-run trace;
- `bun --bun run ci` passes.

Status: not started.

### Step 4: Harness Integration

Goal: attach the coordinator loop to the Verified Build harness boundary.

Build:

- harness client readiness;
- run mapping;
- status/event replay;
- audit and trace proxy routes;
- cancellation truth;
- approval and repair actions;
- final report fetching.

Completion evidence:

- local fake harness integration tests pass;
- Open Agents persists redacted run events;
- stale cursors and replay recovery are tested;
- audit and trace can be viewed through owner-scoped read-only routes.

Exit gate:

- harness integration routes pass route tests;
- run recovery after refresh is tested;
- `bun --bun run ci` passes.

Status: not started.

### Step 5: Real Worker Execution

Goal: replace mocked workcells with real sandbox-spawned workers.

Build:

- workcell-to-sandbox launch path;
- scoped prompts generated from workcell contracts;
- worker completion packet ingestion;
- worker self-check enforcement;
- artifact and patch capture.

Completion evidence:

- a real worker can run in an isolated sandbox;
- worker output is rejected without a valid completion packet;
- self-check evidence is recorded but not treated as final authority;
- failed workers produce failure capsules for repair.

Exit gate:

- capped live-proof worker test passes;
- failed worker test opens repair;
- `bun --bun run ci` passes.

Status: not started.

### Step 6: Real Integration Loop

Goal: merge workcell outputs safely.

Build:

- integration sandbox or branch strategy;
- patch/branch merge mechanism;
- conflict detection;
- post-merge gates;
- integration failure capsules;
- repair workcell creation from integration failures.

Completion evidence:

- clean workcell outputs integrate successfully;
- conflicting outputs are blocked and routed to repair;
- post-integration gates run before final report;
- final report cites integration evidence.

Exit gate:

- integration tests cover clean merge, conflict, gate failure, and repair;
- `bun --bun run ci` passes.

Status: not started.

### Step 7: Open Agents UI Flow

Goal: make Verified Build legible to the user.

Build:

- Verified Build mode indicator;
- coordinator timeline;
- workcell list;
- evidence matrix;
- approval, cancel, and repair actions;
- artifact viewer with redaction status;
- final report view.

Completion evidence:

- user can see why Verified Build was selected;
- user can inspect workcell status and evidence;
- blocked artifacts are visibly blocked;
- refresh recovers the run timeline;
- final go/no-go report is visible.

Exit gate:

- component and route tests pass;
- browser smoke test passes;
- `bun --bun run ci` passes.

Status: not started.

### Step 8: Wow Demo

Goal: prove this is more than a single coding agent.

Build:

- PRD-driven local demo;
- at least frontend, backend/API, database, background worker, and QA/evidence workcells;
- required browser and API/unit evidence;
- repair loop;
- final report.

Completion evidence:

- the demo can be run repeatedly from a clean local state;
- the generated app works locally;
- the final report maps requirements to evidence;
- the system can explain what failed, what repaired it, and why the final decision is `go` or `no_go`.

Exit gate:

- demo runbook exists;
- demo recording or screenshots exist;
- `bun --bun run ci` passes after demo code is generated or integrated.

Status: not started.

## Roadmap Update Rules

Every implementation PR or significant local build step should update this file when status changes.

Rules:

- Do not mark a step complete without naming the evidence that proved it.
- Do not advance to a later step by bypassing an incomplete exit gate.
- If an exit gate changes, update this roadmap and the observability requirements together.
- If a step produces new commands, fixtures, or reports, link them from the relevant step.
- Keep this file short enough that a future coordinator can read it before acting.

## Current Next Action

Implement Step 2:

```text
contract docs -> Zod schemas -> fixtures -> validation tests -> CI
```

Step 3 should not start until Step 2 can reject invalid artifacts and incomplete evidence deterministically.
