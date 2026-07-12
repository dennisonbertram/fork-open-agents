import { makeAutomationId } from "./identity";
import type { AutomationSource } from "./types";

export type SourceQualifiedStorageRecord = Record<string, unknown> & {
  source: AutomationSource;
  id: string;
};

export type LegacyAutomationTrigger = Record<string, unknown> & {
  id: string;
  agentId: string | null;
  loopId: string | null;
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
    Number(trigger.agentId !== null) + Number(trigger.loopId !== null) === 1
  );
}

export function tagLegacyAutomationTrigger(
  trigger: LegacyAutomationTrigger,
): TaggedAutomationTrigger {
  if (!hasExactlyOneLegacyTriggerTarget(trigger)) {
    throw new Error(
      `Automation trigger ${trigger.id} must target exactly one source`,
    );
  }

  return {
    id: trigger.id,
    target:
      trigger.agentId !== null
        ? {
            source: "background_agent",
            definitionId: trigger.agentId,
          }
        : {
            source: "agent_loop",
            definitionId: trigger.loopId as string,
          },
    kind: trigger.kind,
  };
}

/** Remove only the definition. Retained runs and native evidence stay intact. */
export function deleteDefinitionPreservingRunHistory(
  envelope: SourceQualifiedStorageEnvelope,
  definition: { source: AutomationSource; id: string },
): void {
  envelope.definitions.delete(
    makeAutomationId(definition.source, definition.id),
  );
}

/**
 * Return both storage lanes during a reversible shadow-read period.
 *
 * The lane is part of the audit identity, so canonical and legacy copies can
 * be compared. Source qualification prevents equal local IDs from different
 * executors from being collapsed.
 */
export function readCanonicalAndLegacyForRollback<
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
