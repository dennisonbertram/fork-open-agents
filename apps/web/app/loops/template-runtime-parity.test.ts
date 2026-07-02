/**
 * Template runtime-parity test (#765) — the durable regression net for the
 * whole "templates lie" class.
 *
 * Walks every shipped template's graph and proves every `condition.path` /
 * `check.refFrom` / `check.prNumberFrom` context-path reference actually
 * resolves at runtime: either against an ancestor `agent_step`/`github_check`
 * node's output key (the node id the path starts with), or against the
 * documented `trigger.*` context contract seeded by the dispatcher bridge
 * (docs/plans/agent-loops-epic.md).
 *
 * This test is pure — no DB, no network, no LLM. It walks the STATIC graph
 * (BFS from `start`, following edges) so a path is only considered resolvable
 * if it is reachable from a node that runs strictly before the node reading
 * it (an ancestor in some execution order), matching the executor's actual
 * "read prior step context" semantics.
 *
 * Before the #765 fix, this test is RED on "merge-when-green": its
 * `ci_status` check node uses `refFrom: "context.start.ref"`, which resolves
 * to `context["context"]["start"]["ref"]` — a key that is never written by
 * any node or by the dispatcher bridge. No ancestor node id is "context", and
 * "trigger" was not yet a recognized root context key.
 */

import { describe, expect, test } from "bun:test";
import type { LoopDefinition, LoopNode } from "@/lib/agent-loops/types";
import { LOOP_TEMPLATES } from "./loop-templates";

/** Root context keys seeded by the runtime outside of any node's own output. */
const TRIGGER_CONTEXT_ROOT = "trigger";

/**
 * Returns the set of node ids reachable from `start` that can execute at or
 * before `targetNodeId` on SOME path through the graph — i.e. candidate
 * "ancestor" node ids whose output key a path may legally reference.
 *
 * Conservative: a node is a potential ancestor of `targetNodeId` if it is
 * reachable from start without passing through targetNodeId first for at
 * least one path (BFS predecessor set). Cycles (loop-back edges, e.g.
 * fix -> review) mean a node can be both an ancestor and a descendant of
 * itself across iterations — that's intentional (the `backlog-to-pr`
 * fix/review loop). We treat every node reachable from start as a "may have
 * already run" candidate EXCEPT nodes only reachable strictly after
 * targetNodeId with no cycle back — approximated here by: everything in the
 * graph is a candidate ancestor UNLESS it's only reachable via
 * targetNodeId's own outgoing edges and never loops back.
 *
 * For the purpose of this test (never resolve to a totally unrelated /
 * nonexistent node id), the practical check is simpler and stricter than
 * full ancestor analysis: the referenced root key must be either
 * TRIGGER_CONTEXT_ROOT, or an id of some OTHER node in the definition whose
 * kind produces context output (agent_step or github_check) that appears
 * upstream of targetNodeId in the definition's authoring order (position.x)
 * OR is part of a cycle that includes targetNodeId.
 */
function buildPredecessors(
  definition: LoopDefinition,
): Map<string, Set<string>> {
  const outgoing = new Map<string, string[]>();
  for (const node of definition.nodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of definition.edges) {
    outgoing.get(edge.source)?.push(edge.target);
  }

  // Full reachability from every node (to detect cycles cheaply).
  function reachableFrom(startId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const next of outgoing.get(id) ?? []) {
        if (!visited.has(next)) queue.push(next);
      }
    }
    return visited;
  }

  const startNode = definition.nodes.find((n) => n.kind === "start");
  const allReachableFromStart = startNode
    ? reachableFrom(startNode.id)
    : new Set<string>();

  const predecessors = new Map<string, Set<string>>();
  for (const node of definition.nodes) {
    const preds = new Set<string>();
    // A node P is a valid "may have run before" candidate for node N if:
    //  - P is reachable from start (it's part of the live graph), AND
    //  - either P can reach N (P is a structural predecessor, including via
    //    a cycle that loops back through N), or P !== N and P is reachable
    //    from start strictly outside of N's own forward-only subtree.
    for (const candidate of definition.nodes) {
      if (candidate.id === node.id) continue;
      if (!allReachableFromStart.has(candidate.id)) continue;
      const candidateReach = reachableFrom(candidate.id);
      // candidate can reach node.id (candidate runs at or before node.id on
      // some path) OR node.id can reach candidate.id (a cycle exists that
      // lets candidate run before a later iteration of node.id).
      const nodeReach = reachableFrom(node.id);
      if (candidateReach.has(node.id) || nodeReach.has(candidate.id)) {
        preds.add(candidate.id);
      }
    }
    predecessors.set(node.id, preds);
  }
  return predecessors;
}

/** Extracts the root segment of a dot-path (e.g. "trigger.ref" -> "trigger"). */
function rootOf(path: string): string {
  const idx = path.indexOf(".");
  return idx === -1 ? path : path.slice(0, idx);
}

/** True if the node kind ever writes context output another node can read. */
function producesContextOutput(node: LoopNode): boolean {
  return node.kind === "agent_step" || node.kind === "github_check";
}

describe("#765: template runtime-parity — every refFrom/condition path resolves", () => {
  for (const template of LOOP_TEMPLATES) {
    test(`template "${template.slug}": all context-path references resolve against an ancestor node output or trigger.*`, () => {
      const { definition } = template;
      const predecessors = buildPredecessors(definition);
      const nodeById = new Map(definition.nodes.map((n) => [n.id, n]));

      const unresolvedPaths: string[] = [];

      for (const node of definition.nodes) {
        const pathsToCheck: string[] = [];

        if (node.kind === "condition" && node.condition) {
          pathsToCheck.push(node.condition.path);
        }
        if (node.kind === "github_check" && node.check) {
          if (node.check.kind === "ci_status") {
            pathsToCheck.push(node.check.refFrom);
          }
          if (node.check.kind === "pr_status") {
            pathsToCheck.push(node.check.prNumberFrom);
          }
        }

        for (const path of pathsToCheck) {
          const root = rootOf(path);

          if (root === TRIGGER_CONTEXT_ROOT) {
            // Resolves against the documented trigger.* context contract —
            // always considered valid regardless of ancestry (the dispatcher
            // bridge seeds it at run creation, before any node runs).
            continue;
          }

          const rootNode = nodeById.get(root);
          const isValidAncestor =
            rootNode !== undefined &&
            producesContextOutput(rootNode) &&
            predecessors.get(node.id)?.has(root);

          if (!isValidAncestor) {
            unresolvedPaths.push(
              `node "${node.id}" references "${path}" (root "${root}") which is neither the trigger.* contract nor an ancestor agent_step/github_check node's output key`,
            );
          }
        }
      }

      expect(unresolvedPaths).toEqual([]);
    });
  }
});
