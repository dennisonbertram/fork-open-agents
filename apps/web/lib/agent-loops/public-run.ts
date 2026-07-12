import type { AgentLoop, AgentLoopRun } from "@/lib/db/schema";
import { canonicalJson } from "@/lib/execution-snapshots/canonical-json";
import {
  hashAgentLoopExecutionSnapshot,
  parseAgentLoopExecutionSnapshot,
  type AgentLoopExecutionSnapshotV1,
} from "./execution-snapshot";
import {
  loopDefinitionSchema,
  type LoopEdge,
  type LoopNode,
  type ResolvedGuardrails,
} from "./types";

export type PublicLoopGraph = {
  nodes: Array<Pick<LoopNode, "id" | "kind" | "label" | "position">>;
  edges: Array<Pick<LoopEdge, "id" | "source" | "target" | "when">>;
};

export type AgentLoopSnapshotSource =
  | "frozen"
  | "legacy_live_fallback"
  | "invalid";

export type PublicAgentLoopRun = Omit<
  AgentLoopRun,
  "executionSnapshot" | "context" | "definitionSnapshot"
> & {
  definitionSnapshot: PublicLoopGraph;
  snapshotSource: AgentLoopSnapshotSource;
};

type PublicResolution =
  | { source: "legacy_live_fallback"; snapshot: null }
  | { source: "invalid"; snapshot: null }
  | { source: "frozen"; snapshot: AgentLoopExecutionSnapshotV1 };

type AgentLoopSnapshotTuple = Pick<
  AgentLoopRun,
  | "loopId"
  | "definitionSnapshot"
  | "executionSnapshot"
  | "definitionVersion"
  | "definitionHash"
>;

function resolvePublicSnapshot(run: AgentLoopSnapshotTuple): PublicResolution {
  const tuple = [
    run.executionSnapshot,
    run.definitionVersion,
    run.definitionHash,
  ];
  const present = tuple.filter((value) => value != null).length;
  if (present === 0) {
    return { source: "legacy_live_fallback", snapshot: null };
  }
  if (present !== 3 || run.definitionVersion !== 1) {
    return { source: "invalid", snapshot: null };
  }
  try {
    const snapshot = parseAgentLoopExecutionSnapshot(run.executionSnapshot);
    if (
      snapshot.snapshotVersion !== run.definitionVersion ||
      hashAgentLoopExecutionSnapshot(snapshot) !== run.definitionHash ||
      (run.loopId !== null && snapshot.source.definitionId !== run.loopId) ||
      canonicalJson(snapshot.definition) !==
        canonicalJson(loopDefinitionSchema.parse(run.definitionSnapshot))
    ) {
      return { source: "invalid", snapshot: null };
    }
    return { source: "frozen", snapshot };
  } catch {
    return { source: "invalid", snapshot: null };
  }
}

export function getSafeFrozenAgentLoopEvidence(
  run: AgentLoopSnapshotTuple,
): Omit<SafeAgentLoopEvidence, "sourceDeleted" | "sourceActive"> | null {
  const resolved = resolvePublicSnapshot(run);
  if (resolved.source !== "frozen") return null;
  return {
    id: resolved.snapshot.source.definitionId,
    name: resolved.snapshot.source.name,
    repoOwner: resolved.snapshot.repository.owner,
    repoName: resolved.snapshot.repository.name,
    guardrails: resolved.snapshot.guardrails,
  };
}

export function getAgentLoopSnapshotSource(
  run: AgentLoopRun,
): AgentLoopSnapshotSource {
  return resolvePublicSnapshot(run).source;
}

export function toPublicAgentLoopRun(run: AgentLoopRun): PublicAgentLoopRun {
  const {
    executionSnapshot: _privateSnapshot,
    context: _privateContext,
    definitionSnapshot,
    ...safeRun
  } = run;
  return {
    ...safeRun,
    definitionSnapshot: toPublicLoopGraph(definitionSnapshot),
    snapshotSource: getAgentLoopSnapshotSource(run),
  };
}

function toPublicLoopGraph(value: unknown): PublicLoopGraph {
  const parsed = loopDefinitionSchema.safeParse(value);
  if (!parsed.success) return { nodes: [], edges: [] };
  return {
    nodes: parsed.data.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      position: node.position,
    })),
    edges: parsed.data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      when: edge.when,
    })),
  };
}

export type SafeAgentLoopEvidence = {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  guardrails: ResolvedGuardrails | AgentLoop["guardrails"];
  sourceDeleted: boolean;
  sourceActive: boolean;
};

export function toSafeAgentLoopEvidence(
  run: AgentLoopRun,
  liveLoop: AgentLoop | null,
): SafeAgentLoopEvidence | null {
  const resolved = resolvePublicSnapshot(run);
  if (resolved.source === "invalid") return null;
  if (resolved.source === "frozen") {
    return {
      id: resolved.snapshot.source.definitionId,
      name: resolved.snapshot.source.name,
      repoOwner: resolved.snapshot.repository.owner,
      repoName: resolved.snapshot.repository.name,
      guardrails: resolved.snapshot.guardrails,
      sourceDeleted: liveLoop === null,
      sourceActive: liveLoop?.status === "active",
    };
  }
  return liveLoop
    ? {
        id: liveLoop.id,
        name: liveLoop.name,
        repoOwner: liveLoop.repoOwner,
        repoName: liveLoop.repoName,
        guardrails: liveLoop.guardrails,
        sourceDeleted: false,
        sourceActive: liveLoop.status === "active",
      }
    : null;
}
