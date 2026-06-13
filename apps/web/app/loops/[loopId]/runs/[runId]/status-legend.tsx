"use client";

/**
 * status-legend.tsx — Compact status legend for the live run graph.
 *
 * Passive caption (text-xs, muted) placed at bottom-left of the React Flow
 * canvas via <Panel position="bottom-left"> so it lives with the canvas and
 * disappears when the run-graph section is collapsed.
 *
 * Color tokens are sourced from run-graph-merge.ts (RUNNING_SWATCH_CLASS etc.)
 * which match the exact Tailwind classes used in loop-nodes.tsx runStateWrapperClass.
 * This ensures the legend can never silently drift from the actual node styling
 * (pinned by BT-LOOPS-053 in status-legend.test.tsx).
 *
 * Design: single-row flex (flex-wrap on narrow screens), gap-3, no border chrome.
 * It reads as a caption, not a card.
 */

import {
  RUNNING_SWATCH_CLASS,
  SUCCEEDED_SWATCH_CLASS,
  FAILED_SWATCH_CLASS,
  UNVISITED_SWATCH_CLASS,
} from "./run-graph-merge";

// ── Individual legend item ────────────────────────────────────────────────────

function LegendItem({
  swatch,
  label,
}: {
  swatch: React.ReactNode;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1">
      {swatch}
      <span>{label}</span>
    </span>
  );
}

// ── Dashed line sample ────────────────────────────────────────────────────────

function DashedLineSample() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="4"
      viewBox="0 0 20 4"
      className="shrink-0"
    >
      <line
        x1="0"
        y1="2"
        x2="20"
        y2="2"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="4 3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── StatusLegend ──────────────────────────────────────────────────────────────

/**
 * StatusLegend — compact, passive run-graph key.
 *
 * Renders inside a React Flow <Panel position="bottom-left"> in run-graph.tsx.
 * No toggles, no tooltips — complexity hidden by default means the legend is
 * simply there and quiet.
 */
export function StatusLegend() {
  return (
    <div
      aria-label="Run graph status legend"
      className="flex flex-wrap items-center gap-3 rounded-md bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground backdrop-blur-sm"
    >
      {/* Running — pulsing orange dot */}
      <LegendItem
        swatch={<span className={RUNNING_SWATCH_CLASS} aria-hidden="true" />}
        label="Running"
      />

      {/* Succeeded — solid emerald dot */}
      <LegendItem
        swatch={<span className={SUCCEEDED_SWATCH_CLASS} aria-hidden="true" />}
        label="Succeeded"
      />

      {/* Failed — solid red dot */}
      <LegendItem
        swatch={<span className={FAILED_SWATCH_CLASS} aria-hidden="true" />}
        label="Failed"
      />

      {/* Not visited — muted/opacity dot */}
      <LegendItem
        swatch={<span className={UNVISITED_SWATCH_CLASS} aria-hidden="true" />}
        label="Not visited"
      />

      {/* Visit count pill */}
      <span className="flex items-center gap-1">
        <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-muted-foreground">
          ×2
        </span>
        <span>Visited n times</span>
      </span>

      {/* Latest transition — dashed line sample */}
      <span className="flex items-center gap-1">
        <DashedLineSample />
        <span>Latest transition</span>
      </span>
    </div>
  );
}
