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
 * or null — never an undeclared node id.
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
 * edge; returns `{ nextNodeId: null, edgeId: null }` if no match.
 */
export function evaluateEdges(
  definition: LoopDefinition,
  nodeId: string,
  outcome: "success" | "failure" | "true" | "false",
): EvaluateEdgesResult {
  const outgoing = definition.edges.filter((e) => e.source === nodeId);

  // First: look for a direct match on outcome
  const directMatch = outgoing.find((e) => e.when === outcome);
  if (directMatch) {
    return { nextNodeId: directMatch.target, edgeId: directMatch.id };
  }

  // Fallback: always edge
  const alwaysEdge = outgoing.find((e) => e.when === "always");
  if (alwaysEdge) {
    return { nextNodeId: alwaysEdge.target, edgeId: alwaysEdge.id };
  }

  // No match
  return { nextNodeId: null, edgeId: null };
}
