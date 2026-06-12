"use client";

/**
 * when-edge.tsx — custom React Flow edge showing the `when` label as a badge.
 *
 * Color coding: success=emerald, failure=red, true=sky, false=slate, always=muted.
 * Selected edge = thicker stroke + ring on badge.
 *
 * ADD-ONLY run-state props (optional — builder behavior 100% unchanged when absent):
 *   data.traversed?   — true when this edge was traversed during a run
 *   data.mostRecent?  — true when this edge was on the most-recent traversal path
 *
 * When traversed/mostRecent are absent, rendering is identical to the original
 * builder behavior.
 */

import {
  type EdgeProps,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
} from "@xyflow/react";
import type { LoopFlowEdgeData } from "./definition-mapping";
import { getEdgeTraversalStyle } from "./run-overlays";

// ── Add-only run-state fields for when-edge data ──────────────────────────────

export type WhenEdgeRunOverlay = {
  traversed?: boolean;
  mostRecent?: boolean;
};

export type WhenEdgeData = LoopFlowEdgeData & WhenEdgeRunOverlay;

// ── Parallel-edge curvature offset ────────────────────────────────────────────

/**
 * Compute a curvature value for getBezierPath when multiple edges share the
 * same (source, target) pair. The middle edge (index ⌊n/2⌋) gets curvature=0
 * (straight / default), while edges above/below are offset by ±step each.
 *
 * For a single edge (parallelCount=1) this always returns 0 (no change).
 */
function parallelCurvature(
  parallelIndex: number,
  parallelCount: number,
): number {
  if (parallelCount <= 1) return 0;
  // Step size chosen to be visually distinct without extreme arcs
  const step = 0.35;
  const mid = (parallelCount - 1) / 2;
  return (parallelIndex - mid) * step;
}

/**
 * Compute a perpendicular label Y-offset (px) so parallel edge labels don't
 * stack on top of each other. The middle edge stays at 0; others shift by ±step.
 */
function parallelLabelOffset(
  parallelIndex: number,
  parallelCount: number,
): number {
  if (parallelCount <= 1) return 0;
  const step = 18; // px per slot
  const mid = (parallelCount - 1) / 2;
  return (parallelIndex - mid) * step;
}

export type WhenEdge = Edge<WhenEdgeData, "when">;

const whenColors: Record<string, { badge: string; stroke: string }> = {
  success: {
    badge:
      "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
    stroke: "#10b981",
  },
  failure: {
    badge: "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300",
    stroke: "#ef4444",
  },
  true: {
    badge: "bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300",
    stroke: "#0ea5e9",
  },
  false: {
    badge:
      "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300",
    stroke: "#94a3b8",
  },
  always: {
    badge: "bg-muted text-muted-foreground border-border",
    stroke: "#b1b1b7",
  },
};

export function WhenEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  id,
}: EdgeProps<WhenEdge>) {
  // Parallel-edge offsets: spread curvature + label Y when siblings share same (source,target)
  const parallelIndex = data?.parallelIndex ?? 0;
  const parallelCount = data?.parallelCount ?? 1;
  const curvature = parallelCurvature(parallelIndex, parallelCount);
  const labelYOffset = parallelLabelOffset(parallelIndex, parallelCount);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: curvature !== 0 ? curvature : undefined,
  });

  const when = data?.when ?? "always";
  const colors = whenColors[when] ?? whenColors.always!;

  // Run-state overlay: only active when traversed/mostRecent are present.
  // When absent, falls through to builder defaults (opacity=1, selected width).
  const hasRunState =
    data?.traversed !== undefined || data?.mostRecent !== undefined;

  let edgeStyle: React.CSSProperties;

  if (hasRunState) {
    const traversalStyle = getEdgeTraversalStyle(
      data?.traversed !== undefined || data?.mostRecent !== undefined
        ? {
            traversed: data?.traversed ?? false,
            mostRecent: data?.mostRecent ?? false,
          }
        : undefined,
    );
    const isMostRecent = data?.mostRecent === true;
    edgeStyle = {
      stroke: colors.stroke,
      strokeWidth: traversalStyle.strokeWidth,
      opacity: traversalStyle.opacity,
      transition: "opacity 0.2s, stroke-width 0.2s",
      // Subtle animated dash for the most-recent traversal path
      ...(isMostRecent
        ? {
            strokeDasharray: "6 3",
            // loop-edge-dash is defined in globals.css — @keyframes cannot
            // be declared in React inline styles (silently ignored by browsers)
            animation: "loop-edge-dash 1s linear infinite",
          }
        : {}),
    };
  } else {
    // Builder default behavior — unchanged
    edgeStyle = {
      stroke: colors.stroke,
      strokeWidth: selected ? 3 : 2,
      transition: "stroke 0.2s, stroke-width 0.2s",
    };
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY + labelYOffset}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-all ${colors.badge} ${selected ? "ring-2 ring-offset-1 ring-offset-background ring-current" : ""}`}
          >
            {when}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
