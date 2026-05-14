---
name: verified-build-observability
description: Use when planning, designing, implementing, or reviewing Verified Build, autonomous build coordination, coordinator tools, workcells, evidence, repair loops, harness integration, or related observability. Ensures future agents read the roadmap and builder observability requirements before changing code.
---

# Verified Build Observability

Use this skill before changing any Verified Build behavior, contracts, coordinator logic, workcell execution, evidence handling, repair flow, harness integration, or UI.

The first goal is to keep the process of building Verified Build inspectable for humans and future agents. Runtime observability for autonomous build runs comes later. Do not treat a coordinator transcript as proof of completion. Completion must be backed by contracts, events, evidence, gates, repair history, and a final go/no-go report.

## Required Reading Order

1. Read `docs/plans/verified-build-roadmap.md` to identify the current roadmap step and exit gate.
2. Read `docs/plans/verified-build-builder-observability.md` to identify how future agents should observe and continue the implementation process.
3. Read `docs/plans/verified-build-observability-requirements.md` when touching runtime/product observability for Verified Build runs.
4. Read `docs/plans/verified-build-contracts-v0.md` when touching schemas, fixtures, evidence, workcells, integrations, or final reports.
5. Read `docs/plans/verified-build-coordinator-operating-model.md` when touching coordinator behavior, tools, delegation, research packets, or repair loops.
6. Read `docs/plans/open-agents-verified-build-implementation-plan.md` when touching Open Agents integration, harness routes, persistence, UI, or production readiness.

## Operating Rules

- Start by naming the current roadmap step and the exit gate for the requested work.
- Build builder/process observability before runtime behavior for the same capability.
- Do not advance a roadmap step without evidence listed in the roadmap.
- Do not implement real workers before contract validation, fixture traces, and dry-run evidence matrices exist.
- Do not let workers claim completion without a valid completion packet.
- Do not let final reports return `go` without required behavior evidence.
- Do not treat worker self-checks as final authority.
- Do not expose artifact content unless redaction status allows it.
- Update roadmap and observability docs when a change modifies gates, events, evidence, or completion criteria.

## Observability Checklist

For every Verified Build change, check whether the change adds or alters:

- roadmap step or exit gate;
- builder work packet expectations;
- implementation file map;
- settled decision;
- contract schema;
- fixture trace;
- coordinator event;
- workcell state;
- surface scope;
- evidence kind;
- gate result;
- integration record;
- repair record;
- final go/no-go rule;
- redaction status;
- runtime recovery state;
- user-visible status or report.

If yes, update the relevant docs and tests in the same change.

## Expected Proof

Before reporting completion, include:

- docs updated, if the change affects planning or observability;
- tests or fixtures proving the observable behavior;
- `git diff --check`;
- `bun --bun run ci`;
- any remaining observability gaps.

If the work is planning-only, still verify formatting and repo checks unless the user explicitly asks not to.
