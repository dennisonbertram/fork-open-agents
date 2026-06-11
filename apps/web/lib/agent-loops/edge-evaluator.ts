/**
 * Agent Loops — edge evaluator (STUB for TDD red state)
 *
 * DO NOT IMPLEMENT YET — this stub provides the correct type signatures so
 * the test suite can exercise behavioral failures instead of import errors.
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
  _definition: LoopDefinition,
  _nodeId: string,
  _outcome: "success" | "failure" | "true" | "false",
): EvaluateEdgesResult {
  // STUB — always returns nulls so behavioral tests fail
  return { nextNodeId: null, edgeId: null };
}
