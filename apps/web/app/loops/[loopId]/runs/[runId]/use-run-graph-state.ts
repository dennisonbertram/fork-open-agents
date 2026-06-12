/**
 * use-run-graph-state.ts — PURE derivation of per-node/per-edge run state
 *
 * SNAPSHOT RULE (pinned by BT-LOOPS-030): All node/edge structure comes
 * exclusively from `definitionSnapshot` — never from the loop's current
 * live definition. This ensures the graph always matches what was running
 * when the run started, even if the loop was edited since.
 *
 * Traversal derivation approach:
 *   Steps are sorted by `createdAt` ascending. Consecutive step pairs
 *   (step[i] → step[i+1]) imply an edge was traversed: we look up edges
 *   where source === step[i].nodeId AND target === step[i+1].nodeId.
 *   The last traversal of any edge-pair marks the edge as `mostRecent`.
 *
 * Node status priority (for a node that has multiple steps, e.g. revisits):
 *   running > failed > skipped > succeeded (most-informative wins for display)
 *   "unvisited" when no steps touch the node.
 */

import { GUARDRAIL_DEFAULTS } from "@/lib/agent-loops/types";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import type { AgentLoopStepRun, AgentLoopRun } from "@/lib/db/schema";

// ── Types ──────────────────────────────────────────────────────────────────────

export type NodeRunStatus =
  | "unvisited"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type NodeGraphState = {
  status: NodeRunStatus;
  visitCount: number;
  latestAttempt: number;
};

export type EdgeGraphState = {
  traversed: boolean;
  mostRecent: boolean;
};

export type RunMeter = {
  iterationCount: number;
  maxIterations: number;
  stepCount: number;
  maxStepsPerRun: number;
};

export type RunGraphState = {
  nodes: Record<string, NodeGraphState>;
  edges: Record<string, EdgeGraphState>;
  currentNodeId: string | null;
  meter: RunMeter;
};

export type RunGraphInput = {
  definitionSnapshot: LoopDefinition;
  steps: AgentLoopStepRun[];
  run: Pick<
    AgentLoopRun,
    "status" | "currentNodeId" | "iterationCount" | "stepCount"
  >;
  guardrails: Record<string, unknown> | null;
};

// ── Status priority for merging multiple step statuses for one node ────────────

const STATUS_PRIORITY: Record<NodeRunStatus, number> = {
  running: 4,
  failed: 3,
  skipped: 2,
  succeeded: 1,
  unvisited: 0,
};

function stepStatusToNodeStatus(
  status: AgentLoopStepRun["status"],
): NodeRunStatus {
  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "queued":
      // queued is treated as running for display purposes
      return "running";
    default:
      return "unvisited";
  }
}

// ── Main derivation function ───────────────────────────────────────────────────

/**
 * Pure function: derives per-node and per-edge run state from the run detail.
 *
 * No side effects. Safe to call on every poll update.
 */
export function deriveRunGraphState(input: RunGraphInput): RunGraphState {
  const { definitionSnapshot, steps, run, guardrails } = input;

  // ── 1. Initialize all nodes from SNAPSHOT as unvisited ─────────────────────

  const nodes: Record<string, NodeGraphState> = {};
  for (const node of definitionSnapshot.nodes) {
    nodes[node.id] = {
      status: "unvisited",
      visitCount: 0,
      latestAttempt: 0,
    };
  }

  // ── 2. Initialize all edges from SNAPSHOT as not traversed ─────────────────

  const edges: Record<string, EdgeGraphState> = {};
  for (const edge of definitionSnapshot.edges) {
    edges[edge.id] = {
      traversed: false,
      mostRecent: false,
    };
  }

  // ── 3. Aggregate step data per node ────────────────────────────────────────

  // Sort steps by createdAt ascending for consistent traversal derivation
  const sortedSteps = [...steps].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  for (const step of sortedSteps) {
    const nodeState = nodes[step.nodeId];
    if (!nodeState) {
      // Step references a node not in snapshot (shouldn't happen, but be safe)
      continue;
    }

    const stepStatus = stepStatusToNodeStatus(step.status);

    // Update status using priority merge
    if (STATUS_PRIORITY[stepStatus] > STATUS_PRIORITY[nodeState.status]) {
      nodeState.status = stepStatus;
    }

    // visitCount: count every step for this node
    nodeState.visitCount += 1;

    // latestAttempt: max attempt
    if (step.attempt > nodeState.latestAttempt) {
      nodeState.latestAttempt = step.attempt;
    }
  }

  // ── 4. Derive edge traversal from step sequence ────────────────────────────
  //
  // Build a lookup: (source, target) → edge id(s)
  // Then walk consecutive step pairs.
  // The most-recently traversed pair for each edge gets mostRecent=true.

  // Build adjacency lookup
  type EdgeKey = `${string}->${string}`;
  const edgeBySourceTarget = new Map<EdgeKey, string[]>();
  for (const edge of definitionSnapshot.edges) {
    const key: EdgeKey = `${edge.source}->${edge.target}`;
    const existing = edgeBySourceTarget.get(key);
    if (existing) {
      existing.push(edge.id);
    } else {
      edgeBySourceTarget.set(key, [edge.id]);
    }
  }

  // Walk consecutive step pairs and track traversal order
  // Each traversal increments a counter; edges with the highest traversal
  // index get mostRecent=true.
  const edgeLastTraversalIndex = new Map<string, number>();
  let traversalIndex = 0;

  for (let i = 0; i < sortedSteps.length - 1; i++) {
    const fromStep = sortedSteps[i];
    const toStep = sortedSteps[i + 1];
    if (!fromStep || !toStep) continue;

    const key: EdgeKey = `${fromStep.nodeId}->${toStep.nodeId}`;
    const matchingEdgeIds = edgeBySourceTarget.get(key);

    if (matchingEdgeIds) {
      traversalIndex++;
      for (const edgeId of matchingEdgeIds) {
        const edgeState = edges[edgeId];
        if (edgeState) {
          edgeState.traversed = true;
          edgeLastTraversalIndex.set(edgeId, traversalIndex);
        }
      }
    }
  }

  // Mark most-recent: the edge(s) with the highest traversal index
  if (traversalIndex > 0) {
    for (const [edgeId, idx] of edgeLastTraversalIndex.entries()) {
      const edgeState = edges[edgeId];
      if (edgeState) {
        edgeState.mostRecent = idx === traversalIndex;
      }
    }
  }

  // ── 5. Guardrail meter ────────────────────────────────────────────────────

  const maxIterations =
    typeof guardrails?.maxIterations === "number"
      ? guardrails.maxIterations
      : GUARDRAIL_DEFAULTS.maxIterations;

  const maxStepsPerRun =
    typeof guardrails?.maxStepsPerRun === "number"
      ? guardrails.maxStepsPerRun
      : GUARDRAIL_DEFAULTS.maxStepsPerRun;

  const meter: RunMeter = {
    iterationCount: run.iterationCount,
    maxIterations,
    stepCount: run.stepCount,
    maxStepsPerRun,
  };

  // ── 6. currentNodeId from run ─────────────────────────────────────────────

  return {
    nodes,
    edges,
    currentNodeId: run.currentNodeId ?? null,
    meter,
  };
}
