/**
 * run-graph-merge.ts — Pure merge helpers for run-graph overlays.
 *
 * Extracted from run-graph.tsx so that the no-remount contract
 * (BT-LOOPS-051) can be tested at the data level without React Flow.
 *
 * Stable-identity guarantee:
 *   These functions map over the base arrays produced from the immutable
 *   definitionSnapshot and return new arrays with identical length, order,
 *   and ids. React Flow only remounts a node when its `id` changes — because
 *   ids are taken directly from the snapshot (never generated here), no poll
 *   update can ever cause a remount. This contract is pinned by
 *   run-graph-merge.test.ts.
 *
 * Color-token exports:
 *   RUNNING_SWATCH_CLASS, SUCCEEDED_SWATCH_CLASS, FAILED_SWATCH_CLASS,
 *   UNVISITED_SWATCH_CLASS are re-exported from run-overlays.ts where they now
 *   live alongside the RING_* fragment constants that runStateWrapperClass
 *   (loop-nodes.tsx) consumes. This co-location ensures the legend cannot
 *   silently drift from the actual node ring styling.
 *   BT-LOOPS-053 pins this contract.
 */

import type { Node, Edge } from "@xyflow/react";
import type {
  LoopFlowNode,
  LoopFlowEdge,
} from "@/app/loops/[loopId]/builder/definition-mapping";
import type { RunGraphState, NodeRunStatus } from "./use-run-graph-state";

// ── Re-export swatch constants from run-overlays (canonical home) ─────────────
//
// The constants live in run-overlays.ts alongside the RING_* class fragments
// used by runStateWrapperClass in loop-nodes.tsx. Re-exporting here preserves
// any existing import paths that already reference run-graph-merge.

export {
  RUNNING_SWATCH_CLASS,
  SUCCEEDED_SWATCH_CLASS,
  FAILED_SWATCH_CLASS,
  UNVISITED_SWATCH_CLASS,
} from "@/app/loops/[loopId]/builder/run-overlays";

// ── applyNodeRunState ─────────────────────────────────────────────────────────

/**
 * Merges run-state into each node's data so that the builder node components
 * can render status badges, rings, and visit count pills.
 *
 * Builder rendering is unchanged when runStatus is absent; these props are
 * add-only and never remove or replace existing data fields.
 *
 * Stable-identity guarantee: output array has the same length, order, and ids
 * as the input `nodes` array. A poll update (new graphState) changes data
 * fields only — no node is ever dropped, added, or re-keyed.
 */
export function applyNodeRunState(
  nodes: LoopFlowNode[],
  graphState: RunGraphState,
): Node[] {
  return nodes.map((node: LoopFlowNode) => {
    const nodeState = graphState.nodes[node.id];
    const status: NodeRunStatus = nodeState?.status ?? "unvisited";
    const visitCount = nodeState?.visitCount ?? 0;
    const isCurrent = node.id === graphState.currentNodeId;

    return {
      ...node,
      data: {
        ...node.data,
        // Add-only run-state props — consumed by loop-nodes.tsx overlays
        runStatus: status,
        visitCount,
        isCurrent,
      },
    };
  });
}

// ── applyEdgeRunState ─────────────────────────────────────────────────────────

/**
 * Merges traversal state into each edge's data so that WhenEdge can render
 * traversal overlays (opacity, stroke width, animation).
 *
 * Builder WhenEdge rendering is unchanged when traversed/mostRecent are absent.
 *
 * Stable-identity guarantee: output array has the same length, order, and ids
 * as the input `edges` array. A poll update changes data fields only — no edge
 * is ever dropped, added, or re-keyed.
 */
export function applyEdgeRunState(
  edges: LoopFlowEdge[],
  graphState: RunGraphState,
): Edge[] {
  return edges.map((edge: LoopFlowEdge) => {
    const edgeState = graphState.edges[edge.id];
    const traversed = edgeState?.traversed ?? false;
    const mostRecent = edgeState?.mostRecent ?? false;

    return {
      ...edge,
      data: {
        ...edge.data,
        // Add-only run-state props — consumed by when-edge.tsx overlays
        traversed,
        mostRecent,
      },
    };
  });
}
