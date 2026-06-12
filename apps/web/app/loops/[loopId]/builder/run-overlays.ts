/**
 * run-overlays.ts — stub (RED phase)
 * Real implementation follows in green commit.
 */

export type RunNodeStatus =
  | "unvisited"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type EdgeTraversalInput =
  | { traversed: boolean; mostRecent: boolean }
  | undefined;

export type EdgeTraversalStyle = {
  opacity: number;
  strokeWidth: number;
};

// All functions throw or return wrong values to produce meaningful RED failures.

export function mapRunStatusToHeaderStatus(
  _status: RunNodeStatus | undefined,
): "idle" | "processing" | "success" | "error" | undefined {
  throw new Error("not implemented");
}

export function isNodeDimmed(_status: RunNodeStatus | undefined): boolean {
  throw new Error("not implemented");
}

export function isNodePulsing(_isCurrent: boolean | undefined): boolean {
  throw new Error("not implemented");
}

export function hasFailedRing(_status: RunNodeStatus | undefined): boolean {
  throw new Error("not implemented");
}

export function shouldShowVisitPill(_visitCount: number): boolean {
  throw new Error("not implemented");
}

export function getEdgeTraversalStyle(
  _traversal: EdgeTraversalInput,
): EdgeTraversalStyle {
  throw new Error("not implemented");
}
