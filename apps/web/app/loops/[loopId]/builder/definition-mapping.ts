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
 */
export type LoopFlowEdgeData = {
  when: LoopEdge["when"];
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

  const edges: LoopFlowEdge[] = def.edges.map((loopEdge) => ({
    id: loopEdge.id,
    source: loopEdge.source,
    target: loopEdge.target,
    type: "when",
    data: { when: loopEdge.when },
  }));

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
