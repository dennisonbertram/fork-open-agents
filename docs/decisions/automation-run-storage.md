# Keep Automation and Run storage source-specific

- Status: accepted
- Date: 2026-07-12
- Decision issue:
  [#945](https://github.com/dennisonbertram/fork-open-agents/issues/945)
- Product contract: [Sessions, Automations, and Runs](../plans/sessions-automations-runs.md)
- Prior technical direction: [Unifying agents and loops](../plans/workflows-unification.md)
- Source plans: [Background Agents](../plans/background-agents-epic.md) and
  [Agent Loops](../plans/agent-loops-epic.md)

## Decision

Do **not** physically merge background-agent and agent-loop definition, Run, or
evidence tables.

Keep the two mature source models authoritative. Continue to expose one
Automation product and one Runs product through additive, source-qualified read
projections. Keep the already-shared trigger table, including its database
constraint that exactly one of `agentId` and `loopId` is set.

This is a storage decision, not a reversal of the unified product model. Users
should not need to understand the source split. The split remains an internal
adapter boundary because it currently preserves behavior and evidence that a
common-column table would discard.

No database migration accompanies this decision.

## Context

The unified product surfaces proved that both sources can share product
vocabulary and normalized list/detail contracts. They did not prove that the
native records are interchangeable or that those projections can reconstruct
the source records. A physical merge would therefore be a data migration and
executor cutover, not ordinary schema cleanup.

The audit reviewed schemas, source stores, executors, routes, deletion paths,
read adapters, snapshots, triggers, and representative evidence. The executable
safety harness is
[`storage-decision.test.ts`](../../apps/web/lib/automations/storage-decision.test.ts).
Its research-only pure modeling helpers live in
[`storage-decision.ts`](../../apps/web/lib/automations/storage-decision.ts).
The harness is deliberately in-memory: it specifies prerequisites without
creating a shadow schema that might be mistaken for an approved migration.
Those helpers are not production migration codecs, deletion implementations,
or dual-read infrastructure. In particular, the fixture definition-removal
simulation proves only that modeled history remains present; production source
deletion must continue to use the mature source-specific lifecycle paths.

## Evidence

### Definitions are different native models

- A background agent is a flat, repository-scoped, one-step policy with its own
  instructions, GitHub action grants, write scope, budget, model, verification,
  and tool configuration.
- An agent loop owns a graph of heterogeneous nodes and edges plus loop-wide
  guardrails, iteration limits, watchdog policy, retry budget, and per-node
  agent-step configuration.
- Shared `AgentDefinitionV1` adapters are intentionally discriminated unions.
  They establish execution-contract parity while retaining source provenance;
  they are not inverse storage codecs.

Encoding a background agent as a one-node graph could be a future canonical
model, but today there is no lossless inverse mapping or golden fixture suite
proving that conversion.

### Runs share an envelope, not all semantics

Both sources have identity, status, timestamps, snapshots, request IDs, and
workflow IDs. Their native state beyond that overlap differs:

| Background Run | Agent-loop Run |
| --- | --- |
| GitHub target metadata, payload/result summaries, branch/ref/SHA, sandbox and published output URLs | frozen graph definition, current node/step pointers, context/dataflow, iteration and step counts |
| typed outputs and tool sessions | step attempts, step input/output, per-step sandbox/workflow attribution, watchdog decisions |
| sequenced background-agent events | node/step-correlated loop events |

The unified Run adapters are truthful lossy projections for display. Treating
them as a physical schema would lose source evidence needed for diagnosis,
retries, and audit.

### Identity is source-qualified

Definition, Run, and event IDs are guaranteed within their source tables, not
across both sources. The read model already uses source-qualified references.
Any untagged canonical primary key or idempotency key could silently overwrite
equal local IDs from the other source. The safety harness detects those
collisions and keys representative rows with the existing length-prefixed
Automation identity.

### Triggers are shared but tagged

`backgroundAgentTriggers` is already the useful shared primitive. Its
`agentId`/`loopId` exclusive target records source type as well as local ID. A
replacement `targetId` column without a source discriminator would make the
target ambiguous. Keep the current constraint and project it to an explicit
tagged target in normalized reads.

### Deletion and retention behavior is not yet unified

Both source Run foreign keys use `ON DELETE SET NULL`, so historical Runs can
outlive their definition. The surrounding behavior differs:

- background-agent deletion follows its source-specific trigger and relation
  cleanup;
- loop deletion explicitly cancels active Runs, skips pending steps, fails
  watchdog work, emits source-deletion evidence, and then retains history.

A common delete path must preserve these guarantees before it can own both
models. Definition deletion must never cascade away Run or evidence history.

### The blast radius is larger than the read adapters

The two source stores alone exceed 3,500 lines, before executors, workflow
entrypoints, route handlers, schemas, and source tests. The unified Automation
and Run adapters are roughly 600 lines. The audit found source-specific
references across dozens of files and an external unqualified reference from
repository-learning extraction to a background-agent Run. A table merge would
need to migrate all such consumers, not only the product pages.

## Rejected alternatives

### One untagged common-column table

Rejected because it loses graph, step, watchdog, output, tool-session, event
ordering, and source-specific definition fields; makes local-ID collisions
possible; and cannot represent trigger ownership safely.

### One table with a generic JSON payload now

Rejected for now. A source tag plus opaque payload could preserve bytes, but it
would provide little consolidation benefit while moving mature constraints and
query semantics out of typed columns. It would also require a high-risk dual
write and backfill without an inverse codec or measured operational need.

### Big-bang rewrite to one graph executor

Rejected because normalized unattended input and shared contracts already
deliver the useful execution boundary. Replacing both storage and executors at
once couples data risk to runtime behavior risk and removes the safest rollback.

## Conditions to revisit

Reopen the physical consolidation decision only when all of these exist:

1. A strict, versioned canonical tagged union for definitions, Runs, events,
   outputs, steps, tool sessions, and watchdog decisions.
2. Lossless source-to-canonical-to-source codecs with golden fixtures covering
   every native field and evidence relation.
3. A production audit of row counts, source-local ID collisions, idempotency
   collisions, relation cardinalities, nullability, and orphaned references.
4. One specified deletion, cancellation, retention, and redaction contract that
   preserves the stronger behavior of each source.
5. A canonical ordering and correlation contract for all evidence.
6. A migration of every raw foreign key and external source-specific reference
   to a tagged canonical identity.
7. A measured operational or product benefit that exceeds the migration and
   ongoing compatibility cost.

Unified UI adoption alone is not evidence for a physical merge.

## Safe migration shape if revisited

The migration must be additive and reversible:

1. Add versioned canonical tables and side tables; do not alter or drop legacy
   tables.
2. Backfill through the lossless codecs and record a migration journal mapping
   every source-qualified legacy identity to its canonical identity.
3. Verify counts, hashes, relations, event ordering, and representative detail
   views on an isolated preview database.
4. Shadow-read canonical and legacy lanes together. Compare same-source copies
   while retaining equal local IDs from different sources.
5. Dual-write behind an environment-scoped feature flag and continuously
   reconcile the migration journal.
6. Move normalized reads, then dispatch, then executor writes in separate PRs.
7. Repoint triggers atomically only after parity is proven.
8. Soak in development/preview, then production, with dashboards and alerts for
   divergence.
9. Keep dual writes enabled throughout the soak and rollback window. Before
   ending dual writes, quiesce mutations, reconcile both directions against the
   journal, verify zero unexplained deltas, and require explicit approval.
10. If rollback is required after any canonical-only writes, first quiesce
    mutations, backfill and verify every canonical delta into legacy storage,
    and only then switch reads and writes back to legacy.
11. Drop legacy storage only in a later migration after explicit approval and
    at least one verified point-in-time recovery exercise.

While dual writes remain verified, rollback is a feature-flag switch back to
legacy reads and writes. Once canonical-only writes exist, rollback is not a
flag flip: writes must be quiesced and canonical deltas reconciled into legacy
before switching. A rollback that loses canonical deltas or depends on reverse
engineering canonical JSON is not acceptable.

## Estimate

If the revisit conditions are met, the physical consolidation is estimated at
8–12 reviewable PRs and 4–8 engineer-weeks, plus preview rehearsal and a
production soak. This estimate includes schema/codec work, collision audit,
backfill and journal, dual reads/writes, relation migration, trigger cutover,
executor cutover, observability, rollback proof, and cleanup. It does not
include redesigning the product surfaces, which already use adapters.

Until there is a measured reason to pay that cost, the smaller architecture is:

1. source-specific authoritative storage and executors;
2. shared trigger infrastructure;
3. strict source-qualified execution contracts; and
4. unified, honest read projections for Automations and Runs.

## Consequences

- The product remains coherent while mature runtime and evidence semantics stay
  intact.
- New normalized code must carry source-qualified identities and must not assume
  that adapters are lossless.
- Source-specific capabilities remain explicit optional detail instead of fake
  parity.
- Some storage duplication remains. That is accepted technical cost, bounded by
  shared contracts and adapters rather than a reason for an unsafe migration.
- Future storage work can be evaluated against executable invariants instead of
  architectural preference.
