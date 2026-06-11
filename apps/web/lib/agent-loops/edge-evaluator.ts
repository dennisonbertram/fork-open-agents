/**
 * Agent Loops — edge evaluator
 *
 * evaluateEdges(definition, nodeId, outcome) → { nextNodeId, edgeId }
 *
 * Picks the edge from `nodeId` whose `when` matches `outcome`.
 * Falls back to an `always` edge if no direct match exists.
 * Returns `{ nextNodeId: null, edgeId: null }` if no match found.
 *
 * Property upheld: nextNodeId is always a node declared in the definition,
 * or null — never an undeclared node id. This guard is enforced even when
 * the definition was not pre-validated (e.g. stored as opaque JSONB): if a
 * matched edge's target is not in definition.nodes, the function fails closed
 * and returns nulls rather than routing to a phantom node.
 *
 * No I/O, no DB, no eval.
 */

import type { LoopDefinition } from "./types";

export type EvaluateEdgesResult = {
  nextNodeId: string | null;
  edgeId: string | null;
};

/**
 * Given a loop definition, a source node id, and an outcome,
 * returns the matching edge's target node id and edge id.
 *
 * Picks the edge whose `when` matches `outcome`; falls back to an `always`
 * edge; returns `{ nextNodeId: null, edgeId: null }` if no match or if the
 * matched edge's target is not a declared node in the definition.
 */
export function evaluateEdges(
  definition: LoopDefinition,
  nodeId: string,
  outcome: "success" | "failure" | "true" | "false",
): EvaluateEdgesResult {
  const declaredNodeIds = new Set(definition.nodes.map((n) => n.id));
  const outgoing = definition.edges.filter((e) => e.source === nodeId);

  // First: look for a direct match on outcome
  const directMatch = outgoing.find((e) => e.when === outcome);
  if (directMatch) {
    // Fail closed if target is not a declared node (dangling edge guard)
    if (!declaredNodeIds.has(directMatch.target)) {
      return { nextNodeId: null, edgeId: null };
    }
    return { nextNodeId: directMatch.target, edgeId: directMatch.id };
  }

  // Fallback: always edge
  const alwaysEdge = outgoing.find((e) => e.when === "always");
  if (alwaysEdge) {
    // Fail closed if target is not a declared node (dangling edge guard)
    if (!declaredNodeIds.has(alwaysEdge.target)) {
      return { nextNodeId: null, edgeId: null };
    }
    return { nextNodeId: alwaysEdge.target, edgeId: alwaysEdge.id };
  }

  // No match
  return { nextNodeId: null, edgeId: null };
}
