"use client";

/**
 * run-overlays.ts — Pure helper functions for run-state overlays on builder
 * node components and when-edges.
 *
 * Design principle (add-only): these helpers are ONLY called when run-state
 * props are present. When the props are absent (builder mode), the node/edge
 * components skip all calls here and render with their normal builder appearance
 * — zero visual change for the builder.
 *
 * Exported helpers:
 *   mapRunStatusToHeaderStatus  — NodeRunStatus → NodeHeaderStatus badge status
 *   isNodeDimmed                — true for unvisited/skipped
 *   isNodePulsing               — true when isCurrent=true
 *   hasFailedRing               — true for failed
 *   shouldShowVisitPill         — true when visitCount > 1
 *   getEdgeTraversalStyle       — returns opacity/strokeWidth for edge rendering
 *
 * Node ring color fragment constants (consumed by runStateWrapperClass in
 * loop-nodes.tsx and by the swatch constants below):
 *   RING_RUNNING_CLASS   — ring-orange-400 animate-pulse (current node)
 *   RING_FAILED_CLASS    — ring-red-500 (failed node)
 *   RING_SUCCEEDED_CLASS — ring-emerald-500 (succeeded node)
 *
 * Swatch constants for StatusLegend (sourced here so the legend shares the
 * exact color tokens used in runStateWrapperClass — enforced by BT-LOOPS-053):
 *   RUNNING_SWATCH_CLASS, SUCCEEDED_SWATCH_CLASS, FAILED_SWATCH_CLASS,
 *   UNVISITED_SWATCH_CLASS
 */

import type { NodeRunStatus } from "../runs/[runId]/use-run-graph-state";

// ── Node ring color fragment constants ────────────────────────────────────────
//
// These are the exact Tailwind token fragments used in runStateWrapperClass
// (loop-nodes.tsx). Exporting them here means:
//   (a) The swatch constants below are derived from the same source of truth.
//   (b) A future ring color change must go through these constants and will
//       automatically update both the node wrapper and the legend.
// Pinned by BT-LOOPS-053 (status-legend.test.tsx).

/** Ring class fragment for the running/current node (orange-400 + pulse). */
export const RING_RUNNING_CLASS =
  "ring-2 ring-orange-400 animate-pulse rounded-md";

/** Ring class fragment for a failed node (red-500 solid ring). */
export const RING_FAILED_CLASS = "ring-2 ring-red-500 rounded-md";

/** Ring class fragment for a succeeded node (emerald-500 solid ring). */
export const RING_SUCCEEDED_CLASS = "ring-2 ring-emerald-500 rounded-md";

// ── Status legend swatch constants ────────────────────────────────────────────
//
// Dot/swatch classes for StatusLegend — derived from the same color tokens as
// the node rings above so the legend cannot drift from the actual node styling.
// Consumers: status-legend.tsx (visual render), status-legend.test.tsx (pinned
// by BT-LOOPS-053).

/** Running / current node: pulsing orange dot (matches ring-orange-400 + animate-pulse) */
export const RUNNING_SWATCH_CLASS =
  "size-2.5 rounded-full bg-orange-400 animate-pulse";

/** Succeeded node: solid emerald dot (matches ring-emerald-500) */
export const SUCCEEDED_SWATCH_CLASS = "size-2.5 rounded-full bg-emerald-500";

/** Failed node: solid red dot (matches ring-red-500) */
export const FAILED_SWATCH_CLASS = "size-2.5 rounded-full bg-red-500";

/** Unvisited node: muted dot at reduced opacity (matches opacity-50 dimming) */
export const UNVISITED_SWATCH_CLASS =
  "size-2.5 rounded-full bg-muted-foreground/40";

// ── Re-export types for convenience ───────────────────────────────────────────

export type { NodeRunStatus };

export type RunNodeStatus = NodeRunStatus;

export type EdgeTraversalInput =
  | { traversed: boolean; mostRecent: boolean }
  | undefined;

export type EdgeTraversalStyle = {
  opacity: number;
  strokeWidth: number;
};

// ── mapRunStatusToHeaderStatus ────────────────────────────────────────────────

/**
 * Maps a NodeRunStatus to the NodeHeaderStatus badge variant.
 *
 * Returns undefined when status is absent (builder mode) — so no badge is
 * rendered.
 */
export function mapRunStatusToHeaderStatus(
  status: NodeRunStatus | undefined,
): "idle" | "processing" | "success" | "error" | undefined {
  if (status === undefined) return undefined;
  switch (status) {
    case "running":
      return "processing";
    case "succeeded":
      return "success";
    case "failed":
      return "error";
    case "skipped":
      return "idle";
    case "unvisited":
      return "idle";
  }
}

// ── isNodeDimmed ──────────────────────────────────────────────────────────────

/**
 * Returns true for statuses that should be visually de-emphasized (dimmed):
 * unvisited (not yet reached) and skipped (bypassed by a condition branch).
 *
 * Returns false when status is undefined (builder mode — no dimming).
 */
export function isNodeDimmed(status: NodeRunStatus | undefined): boolean {
  if (status === undefined) return false;
  return status === "unvisited" || status === "skipped";
}

// ── isNodePulsing ─────────────────────────────────────────────────────────────

/**
 * Returns true when the node is the current active node (pulsing ring to draw
 * the operator's eye to where execution is right now).
 *
 * Returns false when isCurrent is undefined or false.
 */
export function isNodePulsing(isCurrent: boolean | undefined): boolean {
  return isCurrent === true;
}

// ── hasFailedRing ─────────────────────────────────────────────────────────────

/**
 * Returns true only for failed nodes — rendered as a red accent ring that
 * distinguishes permanent failure from the orange pulsing current ring.
 *
 * Returns false when status is undefined (builder mode) or any other status.
 */
export function hasFailedRing(status: NodeRunStatus | undefined): boolean {
  return status === "failed";
}

// ── shouldShowVisitPill ───────────────────────────────────────────────────────

/**
 * Returns true when a "×N" visit count pill should appear on the node.
 * Shown only when visitCount > 1 (loop / cycle revisit).
 */
export function shouldShowVisitPill(visitCount: number): boolean {
  return visitCount > 1;
}

// ── getEdgeTraversalStyle ─────────────────────────────────────────────────────

/**
 * Returns CSS-compatible opacity and strokeWidth values for edge rendering
 * based on traversal state:
 *
 *   mostRecent=true  → full opacity (1), thick stroke (4) — the hot path
 *   traversed=true   → near-full opacity (0.85), normal stroke (2) — visited
 *   otherwise        → dimmed opacity (0.3), thin stroke (1.5) — untraversed
 *
 * When traversal is absent (builder mode), returns dimmed values — this is
 * safe because run-graph.tsx only passes traversal data, not the builder.
 * The builder's when-edge.tsx does NOT call this function.
 */
export function getEdgeTraversalStyle(
  traversal: EdgeTraversalInput,
): EdgeTraversalStyle {
  if (!traversal || (!traversal.traversed && !traversal.mostRecent)) {
    return { opacity: 0.3, strokeWidth: 1.5 };
  }

  if (traversal.mostRecent) {
    return { opacity: 1, strokeWidth: 4 };
  }

  // traversed=true, mostRecent=false
  return { opacity: 0.85, strokeWidth: 2 };
}
