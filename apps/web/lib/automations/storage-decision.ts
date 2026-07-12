import { makeAutomationId } from "./identity";
import type { AutomationSource } from "./types";

/**
 * NON-PRODUCTION RESEARCH ARTIFACT FOR DECISION #945.
 *
 * These in-memory helpers make storage-consolidation safety invariants
 * executable. They are not database codecs, migration utilities, deletion
 * operations, shadow-read infrastructure, or an approved canonical schema.
 */

export type SourceQualifiedStorageRecord = Record<string, unknown> & {
  source: AutomationSource;
  id: string;
};

export type LegacyAutomationTrigger = Record<string, unknown> & {
  id: string;
  agentId: unknown;
  loopId: unknown;
  kind: unknown;
};

export type TaggedAutomationTrigger = {
  id: string;
  target:
    | { source: "background_agent"; definitionId: string }
    | { source: "agent_loop"; definitionId: string };
  kind: unknown;
};

export type StorageDecisionFixtures = {
  definitions: SourceQualifiedStorageRecord[];
  runs: SourceQualifiedStorageRecord[];
  events: SourceQualifiedStorageRecord[];
  outputs: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
  watchdogRuns: Array<Record<string, unknown>>;
  triggers: LegacyAutomationTrigger[];
};

export type SourceQualifiedStorageEnvelope = {
  decisionScope: "research_only";
  definitions: Map<string, SourceQualifiedStorageRecord>;
  runs: Map<string, SourceQualifiedStorageRecord>;
  events: Map<string, SourceQualifiedStorageRecord>;
  evidence: {
    backgroundAgentOutputs: Array<Record<string, unknown>>;
    agentLoopSteps: Array<Record<string, unknown>>;
    agentLoopWatchdogRuns: Array<Record<string, unknown>>;
  };
  triggers: Map<string, TaggedAutomationTrigger>;
};

export type StorageIdCollision = {
  namespace: "definition" | "run" | "event";
  id: string;
  sources: AutomationSource[];
};

export type RollbackReadEntry<T extends SourceQualifiedStorageRecord> = {
  storage: "canonical" | "legacy";
  sourceQualifiedId: string;
  row: T;
};

/**
 * Encode representative source rows without projecting away native fields.
 *
 * This is a decision harness, not a proposed database schema. The in-memory
 * envelope makes the minimum safety properties of any future physical
 * consolidation executable while the existing source tables stay authoritative.
 */
export function encodeSourceQualifiedStorage(
  input: StorageDecisionFixtures,
): SourceQualifiedStorageEnvelope {
  return {
    decisionScope: "research_only",
    definitions: toSourceQualifiedMap(input.definitions),
    runs: toSourceQualifiedMap(input.runs),
    events: toSourceQualifiedMap(input.events),
    evidence: {
      backgroundAgentOutputs: [...input.outputs],
      agentLoopSteps: [...input.steps],
      agentLoopWatchdogRuns: [...input.watchdogRuns],
    },
    triggers: new Map(
      input.triggers.map((trigger) => [
        trigger.id,
        tagLegacyAutomationTrigger(trigger),
      ]),
    ),
  };
}

export function decodeSourceQualifiedStorage(
  envelope: SourceQualifiedStorageEnvelope,
): Omit<StorageDecisionFixtures, "triggers"> & {
  triggers: TaggedAutomationTrigger[];
} {
  return {
    definitions: [...envelope.definitions.values()],
    runs: [...envelope.runs.values()],
    events: [...envelope.events.values()],
    outputs: [...envelope.evidence.backgroundAgentOutputs],
    steps: [...envelope.evidence.agentLoopSteps],
    watchdogRuns: [...envelope.evidence.agentLoopWatchdogRuns],
    triggers: [...envelope.triggers.values()],
  };
}

export function detectSourceLocalIdCollisions(
  input: StorageDecisionFixtures,
): StorageIdCollision[] {
  return [
    ...collisionsFor("definition", input.definitions),
    ...collisionsFor("run", input.runs),
    ...collisionsFor("event", input.events),
  ];
}

export function hasExactlyOneLegacyTriggerTarget(trigger: {
  agentId: unknown;
  loopId: unknown;
}): boolean {
  return (
    (isNonEmptyString(trigger.agentId) && trigger.loopId === null) ||
    (trigger.agentId === null && isNonEmptyString(trigger.loopId))
  );
}

export function tagLegacyAutomationTrigger(
  trigger: LegacyAutomationTrigger,
): TaggedAutomationTrigger {
  if (isNonEmptyString(trigger.agentId) && trigger.loopId === null) {
    return {
      id: trigger.id,
      target: {
        source: "background_agent",
        definitionId: trigger.agentId,
      },
      kind: trigger.kind,
    };
  }

  if (trigger.agentId === null && isNonEmptyString(trigger.loopId)) {
    return {
      id: trigger.id,
      target: {
        source: "agent_loop",
        definitionId: trigger.loopId,
      },
      kind: trigger.kind,
    };
  }

  throw new Error(
    `Automation trigger ${trigger.id} must target exactly one source`,
  );
}

/**
 * Simulate one research invariant by removing a fixture definition only.
 * This is not the complete production deletion behavior for either source.
 */
export function simulateDefinitionRemovalPreservingFixtureHistory(
  envelope: SourceQualifiedStorageEnvelope,
  definition: { source: AutomationSource; id: string },
): void {
  envelope.definitions.delete(
    makeAutomationId(definition.source, definition.id),
  );
}

/**
 * Model both storage lanes for the rollback fixture in this decision harness.
 *
 * This does not implement a production shadow-read or reconciliation path. The
 * lane is part of the fixture identity so copies can be compared without
 * collapsing equal local IDs from different executors.
 */
export function modelCanonicalAndLegacyRollbackRead<
  Canonical extends SourceQualifiedStorageRecord,
  Legacy extends SourceQualifiedStorageRecord,
>(params: {
  canonical: Canonical[];
  legacy: Legacy[];
}): Array<RollbackReadEntry<Canonical | Legacy>> {
  return [
    ...params.canonical.map((row) => makeRollbackReadEntry("canonical", row)),
    ...params.legacy.map((row) => makeRollbackReadEntry("legacy", row)),
  ];
}

function toSourceQualifiedMap(
  rows: SourceQualifiedStorageRecord[],
): Map<string, SourceQualifiedStorageRecord> {
  return new Map(
    rows.map((row) => [makeAutomationId(row.source, row.id), row]),
  );
}

function collisionsFor(
  namespace: StorageIdCollision["namespace"],
  rows: SourceQualifiedStorageRecord[],
): StorageIdCollision[] {
  const sourcesById = new Map<string, Set<AutomationSource>>();
  for (const row of rows) {
    const sources = sourcesById.get(row.id) ?? new Set<AutomationSource>();
    sources.add(row.source);
    sourcesById.set(row.id, sources);
  }

  return [...sourcesById.entries()]
    .filter(([, sources]) => sources.size > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, sources]) => ({
      namespace,
      id,
      sources: [...sources].sort(),
    }));
}

function makeRollbackReadEntry<T extends SourceQualifiedStorageRecord>(
  storage: RollbackReadEntry<T>["storage"],
  row: T,
): RollbackReadEntry<T> {
  return {
    storage,
    sourceQualifiedId: makeAutomationId(row.source, row.id),
    row,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
