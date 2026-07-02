/**
 * loop-step-summary.ts — human-readable prose summary of a loop's steps
 * (#768).
 *
 * The loop detail page previously showed the raw definition JSON as the
 * primary description of what a loop does. This module walks the graph from
 * `start` along its "always"/"success"/"true" edges (the happy path) and
 * produces a numbered, plain-English line per work node (agent_step /
 * github_check / condition — start/end are structural, not "steps").
 *
 * Each line notes what happens on failure for that node when the graph
 * doesn't wire an explicit failure edge — a node whose only outgoing edges
 * are success/always/true-style edges stops the run if it fails.
 */

import type { LoopDefinition, LoopNode } from "@/lib/agent-loops/types";

function describeNode(node: LoopNode): string {
  switch (node.kind) {
    case "github_check":
      return node.label;
    case "agent_step":
    case "condition":
      return node.label;
    default:
      return node.label;
  }
}

/** True when this node has an outgoing edge that runs on failure. */
function hasFailureHandling(definition: LoopDefinition, nodeId: string) {
  return definition.edges.some(
    (edge) => edge.source === nodeId && edge.when === "failure",
  );
}

/** Picks the "happy path" outgoing edge from a node (always/success/true). */
function happyPathEdge(definition: LoopDefinition, nodeId: string) {
  return definition.edges.find(
    (edge) =>
      edge.source === nodeId &&
      (edge.when === "always" ||
        edge.when === "success" ||
        edge.when === "true"),
  );
}

/**
 * Summarizes a loop definition's happy path as numbered, human-readable
 * lines. Returns an empty array for a definition with no start node or no
 * work steps.
 */
export function summarizeLoopSteps(definition: LoopDefinition): string[] {
  const nodesById = new Map(definition.nodes.map((n) => [n.id, n]));
  const start = definition.nodes.find((n) => n.kind === "start");
  if (!start) {
    return [];
  }

  const lines: string[] = [];
  const visited = new Set<string>([start.id]);
  let current = happyPathEdge(definition, start.id);
  let index = 1;

  while (current) {
    const node = nodesById.get(current.target);
    if (!node || visited.has(node.id)) {
      break;
    }
    visited.add(node.id);

    if (node.kind !== "start" && node.kind !== "end") {
      const failureNote = hasFailureHandling(definition, node.id)
        ? ""
        : " (on failure: stop)";
      lines.push(`${index}. ${describeNode(node)}${failureNote}`);
      index += 1;
    }

    current = happyPathEdge(definition, node.id);
  }

  return lines;
}
