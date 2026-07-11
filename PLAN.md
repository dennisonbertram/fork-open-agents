# Sessions, Automations, and Runs Product Reset

## Summary

Issue [#932](https://github.com/dennisonbertram/fork-open-agents/issues/932)
defines the durable product and delivery contract for parent epic
[#931](https://github.com/dennisonbertram/fork-open-agents/issues/931).
Open Agents will preserve its mature session, sandbox, webhook, background-agent,
and loop runtimes while reducing default navigation to **Sessions**, **Runs**,
**Automations**, **Repositories**, and **Settings**.

The detailed, canonical plan is
[Sessions, Automations, and Runs](docs/plans/sessions-automations-runs.md).
This root plan is the active-task execution map; it intentionally does not
duplicate every contract and acceptance criterion from the durable plan.

## Context

The repository already has the necessary primitives, but exposes overlapping
product and implementation nouns:

- interactive sessions and chat workflow runs;
- background agents and background-agent runs;
- loops, loop steps, watchdogs, and loop runs;
- Verified Build and harness surfaces;
- a disabled generic workflow catalog;
- managed-runtime profile authoring;
- GTM and Account Coordinator systems.

The earlier
[workflows unification plan](docs/plans/workflows-unification.md) correctly
identified that background agents and loops share triggers and execution
concepts. Its **Agents + Workflows** product vocabulary is superseded by this
plan because `Agent` is also used for interactive chat roles and subagents, and
`Workflow` is also an internal runtime concept.

## Product Contract

The primary surfaces are:

1. **Sessions** — durable interactive coding work attached to a workspace.
2. **Runs** — durable automation execution attempts with an honest lifecycle,
   evidence, outputs, cost, and recovery controls.
3. **Automations** — versioned repository-scoped coding definitions with one or
   more steps, triggers, permissions, verification, outputs, and limits.
4. **Repositories** — the top-level context directory for repository
   dashboards and links into Sessions, Automations, and Runs.
5. **Settings** — account, connections, repository policy, models, usage, and
   explicitly advanced configuration.

Sessions, Automations, and Runs are the only default execution nouns.
Repositories is the top-level context directory; Settings owns supporting
configuration. Workspace remains execution context, not a sixth destination.

A one-step Automation is backed initially by today's background-agent storage
and executor. A multi-step Automation is backed initially by today's loop
storage and step executor. Source-qualified adapters hide that split without
pretending the sources have identical fields or statuses.

## System Impact

### Source of truth before the reset

- `sessions`, chats, workflow runs, and sandbox lifecycle records own
  interactive work.
- `background_agents`, their triggers, runs, events, and outputs own
  single-step unattended work.
- `agent_loops`, loop runs, step runs, and events own multi-step unattended
  work.
- Source-specific pages and APIs expose each model separately.

### Source of truth during the reset

- Existing tables and executors remain authoritative for writes and detailed
  evidence.
- Additive Automation and Run adapters provide canonical read contracts.
- Canonical references always include a source kind and source id.
- New product routes compose or delegate to source-specific detail and action
  handlers until parity is proven.

### Source of truth after product parity

- Sessions, Automations, and Runs are the only default execution nouns.
- Repositories is the top-level context directory; Settings owns supporting
  configuration.
- Existing source storage may remain permanently if adapters are reliable.
- Shared executor contracts may be extracted only after characterization.
- A canonical-table migration is a separate research decision, not an assumed
  requirement.

## Dependency-Ordered Delivery

```text
contract and exposure boundaries
  -> truthful allowlists and canaries
  -> Automation and Run adapters
  -> unified Runs list
  -> normalized Run detail shell
  -> unified Automations list
  -> single-step editor rehome
  -> multi-step editor rehome
  -> navigation, Settings, landing, and onboarding reduction
  -> shared executor contracts
  -> optional storage-migration spike
```

Runs ship before editor rehoming because an Automation test or webhook delivery
must have a trustworthy observation surface before the new creation experience
is promoted.

## Implementation Waves

### Wave 0 — durable contract

- Complete #932 as a docs-only PR into `develop`.
- Mark old vocabulary as superseded while preserving its technical evidence.
- Create or attach PR-sized native child issues under #931 before coding.

### Wave 1 — trust and product exposure

- Make missing unattended repository allowlists fail closed; preserve explicit
  `*` only as a deliberate override.
- Distinguish passed, failed, cancelled, and blocked/unproven canary outcomes.
- Add explicit product exposure gates for Verified Build/harness UI, GTM,
  generic workflow catalog, and custom runtime-profile authoring.

### Wave 2 — additive contracts

- Add source-qualified Automation adapters over background agents and loops.
- Add normalized Run adapters over background-agent and loop runs.
- Reuse Account Coordinator redaction and partial-source isolation patterns,
  while fixing optimistic unknown/skipped mappings.

### Wave 3 — Runs product

- Add a unified Runs API/list with repository, Automation, trigger, lifecycle,
  and attention filters.
- Add a normalized Run detail shell that composes existing evidence and control
  panels.
- Keep legacy detail routes until parity and redirect tests pass.

### Wave 4 — Automations product

- Add a unified read-only Automations list.
- Rehome the background-agent builder as the default single-step flow.
- Rehome the loop builder as the advanced multi-step flow.
- Preserve existing payloads, storage, dispatch, and execution behavior.

### Wave 5 — product reduction

- Reduce workspace and repository navigation to Sessions, Runs, Automations,
  Repositories, and Settings.
- Rename interactive `Agents` settings to `Chat roles` and move non-core tools
  under Advanced.
- Align landing and onboarding with
  `Connect GitHub -> start Session -> create Automation -> inspect Run`.

### Wave 6 — runtime convergence after parity

- Characterize both unattended executors.
- Extract shared step, permission, verification, output, context, and result
  contracts without changing behavior.
- Time-box a storage-migration spike only after all existing records round-trip
  losslessly through adapters.

## Planned Changes For #932

- `PLAN.md` — replace the stale runtime-agents task with this active execution
  map.
- `docs/plans/sessions-automations-runs.md` — add the canonical product,
  lifecycle, contracts, implementation waves, verification, rollout, rollback,
  and stop-condition plan.
- `docs/plans/workflows-unification.md` — mark its product vocabulary as
  superseded, while retaining it as technical evidence.
- `docs/process/index.md` — link the canonical plan from the repository process
  routing document.

No code, schema, API, UI, environment, workflow, or deployment behavior changes
in #932.

## Verification For #932

- Check Markdown formatting through the repository formatter.
- Validate changed Markdown local links resolve.
- Run `git diff --check`.
- Inspect the final diff for docs-only scope and consistent issue links.

This slice uses a documented TDD exception: it changes no runtime behavior, so
there is no meaningful red behavioral test. Later behavior-changing child
issues must follow behavior-first TDD and the proof-level requirements in the
canonical plan.

## Global Stop Conditions

Stop rather than widen an implementation slice when it requires:

- destructive migration or record deletion;
- loss-prone conversion of a legacy definition or evidence packet;
- executor behavior changes before characterization tests exist;
- a normalized Run that omits source-specific evidence or controls;
- unattended execution outside an explicit repository allowlist;
- false success for blocked, skipped, unknown, or unproven states;
- pulling frozen systems back into the default product path;
- a live external dependency merely to prove deterministic local behavior.

## Definition Of Done

For #932:

- the root plan points to the canonical contract;
- the detailed plan is dependency-ordered and executable by bounded agents;
- the old vocabulary is unambiguously superseded but not deleted;
- the process index links the new plan;
- formatting, local-link validation, and diff checks pass;
- a detailed docs-only PR targets `develop` and references #931 and #932.

For parent epic #931, completion requires the full criteria in
[the canonical plan](docs/plans/sessions-automations-runs.md#epic-definition-of-done).
