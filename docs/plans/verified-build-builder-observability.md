# Verified Build Builder Observability

Prepared: 2026-05-14

## Purpose

Builder observability is the visibility that a human or future coding agent needs while building Verified Build.

This is different from runtime observability. Runtime observability answers questions about an autonomous build run after the product exists. Builder observability answers questions about our own implementation process before the product exists:

- where are we in the roadmap?
- what is the current exit gate?
- what decisions are already settled?
- what files and docs are in scope?
- what must be proven before the next step starts?
- what did the agent change in this work session?
- what checks were run?
- what remains unknown or blocked?

The goal is to make the build process itself inspectable enough that future agents can continue without relying on chat history or vibes.

## Read This First

Future agents working on Verified Build should read these in order:

1. [Verified Build Roadmap](verified-build-roadmap.md)
2. This document
3. [Verified Build Runtime Observability Requirements](verified-build-observability-requirements.md)
4. [Verified Build Contracts V0](verified-build-contracts-v0.md)
5. [Verified Build Coordinator Operating Model](verified-build-coordinator-operating-model.md)
6. [Open Agents Verified Build Implementation Plan](open-agents-verified-build-implementation-plan.md)

The repo-local skill that enforces this path is:

- `.agents/skills/verified-build-observability/SKILL.md`

## Builder Versus Runtime Observability

| Kind | Primary audience | Exists to answer | Implemented as |
| --- | --- | --- | --- |
| Builder observability | humans and coding agents building Verified Build | "Where are we, what should I do next, and what proves I did it?" | roadmap, skills, docs, work packets, commits, tests |
| Runtime observability | users, coordinators, operators, and coding agents inspecting Verified Build runs | "What is this build doing, why, what evidence exists, and what blocks go?" | ledgers, events, workcell states, evidence matrices, artifacts, traces |

Builder observability comes first. Runtime observability is one of the capabilities we will build later.

## Required Builder Signals

### Current Position

There must be one durable source of truth for:

- current roadmap step;
- status of every roadmap step;
- current next action;
- exit gate for the current step;
- evidence required to mark the step complete.

Source of truth:

- [Verified Build Roadmap](verified-build-roadmap.md)

Agent rule:

- Every future agent should start by naming the current roadmap step and exit gate before editing files.

### Decided Architecture

Future agents need to know which choices should not be relitigated casually.

Current settled decisions:

| Decision | Current answer | Source |
| --- | --- | --- |
| Trusted path | Serious mutating software work should route through Verified Build, not direct coding. | [Coordinator Operating Model](verified-build-coordinator-operating-model.md) |
| Coordinator role | The top-level coordinator is a model agent with narrow coordination tools, not a general-purpose coder. | [Coordinator Operating Model](verified-build-coordinator-operating-model.md) |
| Worker role | Workers may edit code but must return scoped completion packets with evidence. | [Contracts V0](verified-build-contracts-v0.md) |
| Done criteria | Evidence and gates decide completion, not worker confidence or transcript quality. | [Runtime Observability Requirements](verified-build-observability-requirements.md) |
| Sub-coordinators | Sub-coordinators may maintain local plans but propose parent-level architecture changes upward. | [Coordinator Operating Model](verified-build-coordinator-operating-model.md) |
| Research | Research packets are first-class shared artifacts, sliced to workers instead of dumped wholesale. | [Contracts V0](verified-build-contracts-v0.md) |
| First real implementation order | Builder observability, then executable contracts, then dry-run coordinator, then harness/runtime integration. | [Roadmap](verified-build-roadmap.md) |
| Direct mode | Direct Coding may remain as an explicit fast/developer escape hatch, not the trusted default. | [Coordinator Operating Model](verified-build-coordinator-operating-model.md) |

Agent rule:

- If a change modifies a settled decision, update the source doc and explain why in the final handoff.

### Build Map

Future agents need a file map before coding so they do not search from scratch every time.

Current planning files:

- `.agents/skills/verified-build-observability/SKILL.md`
- `docs/plans/verified-build-roadmap.md`
- `docs/plans/verified-build-builder-observability.md`
- `docs/plans/verified-build-observability-requirements.md`
- `docs/plans/verified-build-contracts-v0.md`
- `docs/plans/verified-build-coordinator-operating-model.md`
- `docs/plans/open-agents-verified-build-implementation-plan.md`

Existing Verified Build code surfaces:

- `apps/web/lib/verified-build/mode-policy.ts`
- `apps/web/lib/verified-build/task-classifier.ts`
- `apps/web/app/api/harness/**`

Step 2 code surfaces:

- `apps/web/lib/verified-build/contracts.ts`
- `apps/web/lib/verified-build/contracts.test.ts`
- `apps/web/lib/verified-build/contract-validation.ts`
- `apps/web/lib/verified-build/fixtures/*`
- `apps/web/lib/verified-build/evidence-coverage.test.ts`

Agent rule:

- Treat this map as a starting point, not permission to skip code exploration. Verify the local shape before editing.

### Step Gate

Every roadmap step must have an explicit gate.

A good gate includes:

- files or artifacts expected to exist;
- tests that prove the behavior;
- commands that must pass;
- docs that must be updated;
- what must not be implemented yet.

Agent rule:

- If a step cannot be verified by a concrete artifact, test, or command, improve the gate before implementing the step.

### Work Session Trace

During each future work session, the agent should maintain enough state for the user and future agents to understand what happened.

Minimum live trace:

- task goal;
- current roadmap step;
- files inspected;
- files changed;
- checks run;
- results;
- blockers or open questions.

Where this lives:

- in the active conversation while working;
- in `PLAN.md` for complex or multi-turn implementation work;
- in updated roadmap/docs when the status or gate changes;
- in the commit message and final handoff after the work is done.

Agent rule:

- Do not leave durable project state only in chat if it affects future implementation.

### Scoped Commit Trail

Future agents need commits to map cleanly to roadmap progress.

Commit expectations:

- stage only files related to the current Verified Build task;
- leave unrelated dirty files alone;
- commit planning and observability changes separately from runtime implementation changes when practical;
- use commit messages that describe the roadmap capability, not just the edited files.

Agent rule:

- Before committing, run `git status --short` and `git diff --cached --name-only` to confirm the scope.

## Builder Work Packet

For any non-trivial Verified Build implementation step, create a short work packet before coding. In a single-turn task, this can live in the conversation and final answer. In a multi-turn task, use `PLAN.md` and then move durable results into the roadmap/docs when finished.

Template:

```md
## Verified Build Work Packet

Roadmap step:
Exit gate:
Goal:
Non-goals:

Docs read:
- ...

Files expected:
- ...

Decisions relied on:
- ...

Implementation checklist:
- ...

Verification:
- ...

Handoff requirements:
- docs updated:
- tests run:
- commit needed:
- remaining gaps:
```

The work packet is not a substitute for tests or docs. It is a temporary build trace.

## Agent Start Procedure

Before editing Verified Build files, a future agent should:

1. Load `.agents/skills/verified-build-observability/SKILL.md`.
2. Read [Verified Build Roadmap](verified-build-roadmap.md).
3. Read this builder observability doc.
4. Identify the current roadmap step and exit gate.
5. Read the step-specific source docs.
6. Run `git status --short` to identify unrelated local work.
7. Inspect the relevant code surfaces with `rg` and targeted file reads.
8. State the expected work packet before editing.

If the requested work conflicts with the current roadmap gate, the agent should call that out and update the plan before coding.

## Agent Completion Procedure

Before reporting completion, a future agent should:

1. Update docs when the work changes decisions, gates, file maps, schemas, event names, evidence rules, or runtime expectations.
2. Run `git diff --check`.
3. Run `bun --bun run ci` unless the user explicitly scopes the task away from repo checks.
4. Validate any skill frontmatter when a skill changes.
5. Stage only scoped files if committing.
6. Commit when the user asked for saved durable progress or when the work is a complete planning milestone.
7. Report changed files, checks run, commit hash if committed, and remaining gaps.

## Step 2 Builder Observability

The current next implementation step is **Step 2: Executable Contracts**.

Before Step 2 starts, future agents should be able to answer:

- Which contracts are required?
- Where should schemas live?
- Where should fixtures live?
- Which tests prove invalid artifacts fail?
- Which tests prove incomplete evidence blocks `go`?
- Which docs must link to the resulting schema and fixtures?

Step 2 should produce:

- schema module for all v0 artifacts;
- inferred TypeScript types;
- validation helpers for evidence coverage and final decisions;
- passing fixtures;
- failing fixtures;
- tests for required evidence, wrong-kind evidence, stale/failed evidence, and out-of-scope worker claims;
- docs updated with actual schema/test/fixture paths.

Step 2 must not produce:

- real worker execution;
- real sandbox spawning;
- real integration or merge logic;
- UI beyond existing tests;
- model-driven coordinator behavior.

The point of Step 2 is to make later runtime behavior impossible to fake.

## Builder Observability By Roadmap Step

| Roadmap step | Builder-observable proof |
| --- | --- |
| Step 1: Builder Observability Foundation | Skill, roadmap, builder observability doc, runtime observability doc, contracts doc, and operating model exist and are committed. |
| Step 2: Executable Contracts | Tests can validate every contract and reject invalid evidence/completion/final-report claims. |
| Step 3: Dry-Run Coordinator | A deterministic trace fixture shows the coordinator loop and can be replayed by tests. |
| Step 4: Harness Integration | Route/client tests show run mapping, event replay, audit/trace reads, approval, cancellation, and repair against fake harness data. |
| Step 5: Real Worker Execution | Capped live proof shows a real worker can run in a sandbox and produce a valid completion packet. |
| Step 6: Real Integration Loop | Integration tests show clean merge, conflict, gate failure, repair, and final evidence behavior. |
| Step 7: Open Agents UI Flow | Component/route/browser tests show users can inspect timeline, workcells, evidence, repair, artifacts, and final reports. |
| Step 8: Wow Demo | A repeatable demo runbook and evidence bundle show a PRD-driven multi-agent build working locally. |

## Remaining Builder Observability Gaps

These are acceptable gaps right now because they are future-step outputs, not Step 1 prerequisites:

- no executable contract schema paths yet;
- no contract fixture directory yet;
- no dry-run trace fixture yet;
- no evidence matrix renderer or dump command yet;
- no runtime event ledger implementation yet;
- no live worker or integration runbook yet.

These should become concrete artifacts as the roadmap advances.
