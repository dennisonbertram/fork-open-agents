"use client";

/**
 * when-edge.tsx — custom React Flow edge showing the `when` label as a badge.
 *
 * Color coding: success=emerald, failure=red, true=sky, false=slate, always=muted.
 * Selected edge = thicker stroke + ring on badge.
 */

import {
  type EdgeProps,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
} from "@xyflow/react";
import type { LoopFlowEdgeData } from "./definition-mapping";

export type WhenEdge = Edge<LoopFlowEdgeData, "when">;

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
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const when = data?.when ?? "always";
  const colors = whenColors[when] ?? whenColors.always!;

  const edgeStyle = {
    stroke: colors.stroke,
    strokeWidth: selected ? 3 : 2,
    transition: "stroke 0.2s, stroke-width 0.2s",
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
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
