/**
 * definition-mapping.ts — PURE bidirectional mapping between LoopDefinition
 * and React Flow nodes/edges.
 *
 * Lossless round-trip guarantee: definitionToFlow → flowToDefinition must
 * produce a deep-equal LoopDefinition (positions update aside is a feature,
 * not a bug — they reflect user drag state).
 *
 * Canonical key order ensures that JSON.stringify(flowToDefinition(definitionToFlow(def)))
 * === JSON.stringify(def) for any valid definition that hasn't been mutated.
 */

import type { Edge, Node } from "@xyflow/react";
import type {
  LoopDefinition,
  LoopEdge,
  LoopNode,
} from "@/lib/agent-loops/types";

// ── Flow node data type ────────────────────────────────────────────────────────

/**
 * The data payload stored in each React Flow node.
 * We carry the full LoopNode so that flowToDefinition can reconstruct it
 * without any lossy mapping — all config fields pass through opaquely.
 */
export type LoopFlowNodeData = LoopNode;

/**
 * The data payload stored in each React Flow edge.
 *
 * parallelIndex / parallelCount are ADD-ONLY fields:
 *   - parallelCount = number of edges sharing the same (source, target) pair.
 *   - parallelIndex = 0-based index within that group (stable: follows edge order
 *     in the definition).
 *   - When parallelCount === 1, parallelIndex === 0 and the edge renders normally
 *     (no curve or label offset). Builder behavior is 100% unchanged for singles.
 *   - WhenEdge uses these to offset bezier curvature and label position so that
 *     parallel edge labels never overlap.
 */
export type LoopFlowEdgeData = {
  when: LoopEdge["when"];
  /** Original definition payload, retained opaquely for lossless saves. */
  definitionEdge?: LoopEdge;
  /**
   * 0-based index within the parallel group (edges sharing the same source+target).
   * Computed by definitionToFlow. Absent on edges created directly in the builder
   * store (they go through flowToDefinition → definitionToFlow next render cycle).
   */
  parallelIndex?: number;
  /**
   * Number of edges in the parallel group. 1 means no siblings (no offset needed).
   * Computed by definitionToFlow. Absent on edges created directly in the builder store.
   */
  parallelCount?: number;
  /**
   * True when this edge points "backward" — its target sits at an earlier graph
   * depth than its source (a loop-back / cycle-closing edge). Computed by
   * definitionToFlow via BFS depth from the start node. ADD-ONLY: when absent the
   * edge renders as a normal forward edge.
   */
  isLoopBack?: boolean;
};

// ── Loop-back detection ─────────────────────────────────────────────────────────

/**
 * BFS shortest-path depth of every node from the start node (depth 0).
 * Nodes unreachable from start are absent from the map. Pure.
 */
export function computeNodeDepths(def: LoopDefinition): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const edge of def.edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }
  const start = def.nodes.find((n) => n.kind === "start") ?? def.nodes[0];
  const depths = new Map<string, number>();
  if (!start) return depths;

  const queue: string[] = [start.id];
  depths.set(start.id, 0);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const depth = depths.get(id) ?? 0;
    for (const next of adjacency.get(id) ?? []) {
      if (!depths.has(next)) {
        depths.set(next, depth + 1);
        queue.push(next);
      }
    }
  }
  return depths;
}

export type LoopFlowNode = Node<LoopFlowNodeData>;
export type LoopFlowEdge = Edge<LoopFlowEdgeData>;

// ── definitionToFlow ──────────────────────────────────────────────────────────

/**
 * Convert a LoopDefinition to React Flow nodes and edges.
 *
 * Pure function — no side effects.
 */
export function definitionToFlow(def: LoopDefinition): {
  nodes: LoopFlowNode[];
  edges: LoopFlowEdge[];
} {
  const nodes: LoopFlowNode[] = def.nodes.map((loopNode) => ({
    id: loopNode.id,
    type: "loopNode",
    position: { x: loopNode.position.x, y: loopNode.position.y },
    data: loopNode,
  }));

  // Compute parallel-edge groups: edges sharing the same (source, target) pair
  // are parallel and need curve + label offsets to avoid visual overlap.
  // Only same-direction pairs are grouped (A→B and B→A are independent channels).
  type DirectedKey = `${string}->${string}`;
  const groupCount = new Map<DirectedKey, number>();
  for (const loopEdge of def.edges) {
    const key: DirectedKey = `${loopEdge.source}->${loopEdge.target}`;
    groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
  }

  // Depths drive loop-back detection: an edge whose target sits at an earlier
  // depth than its source closes a cycle (points backward).
  const depths = computeNodeDepths(def);

  // Assign each edge its parallelIndex within its group (stable: follows definition order)
  const groupIndex = new Map<DirectedKey, number>();
  const edges: LoopFlowEdge[] = def.edges.map((loopEdge) => {
    const key: DirectedKey = `${loopEdge.source}->${loopEdge.target}`;
    const parallelCount = groupCount.get(key) ?? 1;
    const parallelIndex = groupIndex.get(key) ?? 0;
    groupIndex.set(key, parallelIndex + 1);

    const sourceDepth = depths.get(loopEdge.source);
    const targetDepth = depths.get(loopEdge.target);
    const isLoopBack =
      sourceDepth !== undefined &&
      targetDepth !== undefined &&
      targetDepth < sourceDepth;

    return {
      id: loopEdge.id,
      source: loopEdge.source,
      target: loopEdge.target,
      type: "when",
      data: {
        when: loopEdge.when,
        definitionEdge: loopEdge,
        parallelIndex,
        parallelCount,
        isLoopBack,
      },
    };
  });

  return { nodes, edges };
}

// ── flowToDefinition ──────────────────────────────────────────────────────────

/**
 * Convert React Flow nodes/edges back to a LoopDefinition.
 *
 * Canonical key order is preserved by rebuilding each node in the same field
 * order as the original Zod schemas (id, kind, label, position, then
 * kind-specific fields). This ensures JSON.stringify stability.
 *
 * Pure function — no side effects.
 */
export function flowToDefinition(
  nodes: LoopFlowNode[],
  edges: LoopFlowEdge[],
): LoopDefinition {
  const loopNodes: LoopNode[] = nodes.map((flowNode) => ({
    ...flowNode.data,
    position: { x: flowNode.position.x, y: flowNode.position.y },
  }));

  const loopEdges: LoopEdge[] = edges.map((flowEdge) => {
    const definitionEdge = flowEdge.data?.definitionEdge;
    return {
      ...definitionEdge,
      id: flowEdge.id,
      source: flowEdge.source,
      target: flowEdge.target,
      when: flowEdge.data?.when ?? definitionEdge?.when ?? "always",
    };
  });

  return { nodes: loopNodes, edges: loopEdges };
}
