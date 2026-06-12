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
  parallelIndex: number;
  parallelCount: number;
};

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

  // Assign each edge its parallelIndex within its group (stable: follows definition order)
  const groupIndex = new Map<DirectedKey, number>();
  const edges: LoopFlowEdge[] = def.edges.map((loopEdge) => {
    const key: DirectedKey = `${loopEdge.source}->${loopEdge.target}`;
    const parallelCount = groupCount.get(key) ?? 1;
    const parallelIndex = groupIndex.get(key) ?? 0;
    groupIndex.set(key, parallelIndex + 1);

    return {
      id: loopEdge.id,
      source: loopEdge.source,
      target: loopEdge.target,
      type: "when",
      data: { when: loopEdge.when, parallelIndex, parallelCount },
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
  const loopNodes: LoopNode[] = nodes.map((flowNode) => {
    // Reconstruct with canonical key order from the flow node data.
    // The data field carries the full LoopNode — we just update position
    // from the React Flow node (which may have been dragged).
    const base = flowNode.data;
    const position = { x: flowNode.position.x, y: flowNode.position.y };

    // Rebuild with canonical key order matching the Zod schema field order:
    // id → kind → label → position → (kind-specific fields)
    switch (base.kind) {
      case "start":
        return {
          id: base.id,
          kind: "start" as const,
          label: base.label,
          position,
        };

      case "agent_step": {
        const node: LoopNode = {
          id: base.id,
          kind: "agent_step" as const,
          label: base.label,
          position,
          ...(base.instructions !== undefined && {
            instructions: base.instructions,
          }),
          ...(base.outputSchema !== undefined && {
            outputSchema: base.outputSchema,
          }),
          ...(base.checkCommand !== undefined && {
            checkCommand: base.checkCommand,
          }),
        };
        return node;
      }

      case "github_check": {
        const node: LoopNode = {
          id: base.id,
          kind: "github_check" as const,
          label: base.label,
          position,
          ...(base.check !== undefined && { check: base.check }),
        };
        return node;
      }

      case "condition": {
        const node: LoopNode = {
          id: base.id,
          kind: "condition" as const,
          label: base.label,
          position,
          ...(base.condition !== undefined && { condition: base.condition }),
        };
        return node;
      }

      case "end":
        return {
          id: base.id,
          kind: "end" as const,
          label: base.label,
          position,
        };

      default:
        throw new Error(`Unknown node kind in flowToDefinition`);
    }
  });

  const loopEdges: LoopEdge[] = edges.map((flowEdge) => ({
    id: flowEdge.id,
    source: flowEdge.source,
    target: flowEdge.target,
    when: flowEdge.data?.when ?? "always",
  }));

  return { nodes: loopNodes, edges: loopEdges };
}
