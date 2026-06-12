"use client";

/**
 * run-graph.tsx — Read-only React Flow canvas for live run graph view (M2-03)
 *
 * Renders the run's definitionSnapshot as a read-only React Flow canvas with
 * execution state overlays driven by deriveRunGraphState.
 *
 * SNAPSHOT RULE: always uses run.definitionSnapshot, never the live loop definition.
 *
 * Read-only mode:
 *   - nodesDraggable={false}
 *   - nodesConnectable={false}
 *   - elementsSelectable={true} (for node click → timeline focus)
 *   - No palette, no save
 *
 * Status overlays:
 *   - Current node: pulsing ring animation (animate-pulse) + processing badge
 *   - Succeeded: green tint ring
 *   - Failed: red ring + error badge
 *   - Skipped: muted/dimmed
 *   - Unvisited: muted/dimmed
 *   - Visit count badge (×N) when visitCount > 1
 *
 * Edge overlays:
 *   - Most-recent traversal: thicker (strokeWidth 4) + brighter color
 *   - Older traversed: normal (strokeWidth 2)
 *   - Untraversed: dimmed opacity
 *
 * MiniMap: per-node status color
 * Iteration meter: "Iteration 2/10 · Step 5/50"
 * aria-live status region for accessibility
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  useReactFlow,
  type ColorMode,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "@/app/providers";
import {
  definitionToFlow,
  type LoopFlowNode,
  type LoopFlowEdge,
} from "@/app/loops/[loopId]/builder/definition-mapping";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import type { AgentLoopStepRun, AgentLoopRun } from "@/lib/db/schema";
import {
  deriveRunGraphState,
  type NodeRunStatus,
  type RunGraphState,
} from "./use-run-graph-state";

// ── Status color mapping ───────────────────────────────────────────────────────

const nodeStatusRingClass: Record<NodeRunStatus, string> = {
  unvisited: "opacity-50",
  running: "ring-2 ring-orange-400 animate-pulse",
  succeeded: "ring-2 ring-emerald-500",
  failed: "ring-2 ring-red-500",
  skipped: "opacity-40",
};

const nodeStatusMiniMapColor: Record<NodeRunStatus, string> = {
  unvisited: "#b1b1b7",
  running: "#f97316",
  succeeded: "#22c55e",
  failed: "#ef4444",
  skipped: "#94a3b8",
};

// ── Per-kind accent color for MiniMap (fallback when unvisited) ────────────────

const kindMiniMapColor: Record<string, string> = {
  start: "#10b981",
  agent_step: "#8b5cf6",
  github_check: "#64748b",
  condition: "#f59e0b",
  end: "#a3a3a3",
};

// ── Overlay node wrapper ───────────────────────────────────────────────────────

/**
 * We don't change the node's internal data — we apply overlay via className
 * on the outer div that React Flow renders.  We achieve this by passing
 * className through node.style / node.className (supported in RF12).
 * The simplest approach: inject a className string onto the RF node object
 * so the host div picks it up as an additional class.
 */
function applyNodeOverlays(
  nodes: LoopFlowNode[],
  graphState: RunGraphState,
): Node[] {
  return nodes.map((node: LoopFlowNode) => {
    const nodeState = graphState.nodes[node.id];
    const status: NodeRunStatus = nodeState?.status ?? "unvisited";
    const visitCount = nodeState?.visitCount ?? 0;

    // Build overlay className
    const ringClass = nodeStatusRingClass[status];

    return {
      ...node,
      // className gets applied to the React Flow wrapper div
      className: `transition-all duration-200 rounded-md ${ringClass}`,
      // Store overlay data for the node component to render badges
      data: {
        ...node.data,
        _overlay: {
          status,
          visitCount,
          isCurrentNode: node.id === graphState.currentNodeId,
        },
      },
    };
  });
}

/**
 * Apply edge overlays: traversed=brighter+thicker, mostRecent=brightest,
 * untraversed=dimmed.
 */
function applyEdgeOverlays(
  edges: LoopFlowEdge[],
  graphState: RunGraphState,
): Edge[] {
  return edges.map((edge: LoopFlowEdge) => {
    const edgeState = graphState.edges[edge.id];
    const traversed = edgeState?.traversed ?? false;
    const mostRecent = edgeState?.mostRecent ?? false;

    let opacity = 0.3;
    let strokeWidth = 2;

    if (mostRecent) {
      opacity = 1;
      strokeWidth = 4;
    } else if (traversed) {
      opacity = 0.85;
      strokeWidth = 2;
    }

    return {
      ...edge,
      style: {
        ...edge.style,
        opacity,
        strokeWidth,
        transition: "opacity 0.2s, stroke-width 0.2s",
      },
      animated: mostRecent,
    };
  });
}

// ── Meter display ──────────────────────────────────────────────────────────────

function IterationMeter({
  iterationCount,
  maxIterations,
  stepCount,
  maxStepsPerRun,
}: {
  iterationCount: number;
  maxIterations: number;
  stepCount: number;
  maxStepsPerRun: number;
}) {
  return (
    <div className="rounded-md border border-border bg-background/90 px-3 py-1.5 text-[11px] font-medium backdrop-blur-sm">
      <span className="text-muted-foreground">Iteration </span>
      <span className="tabular-nums text-foreground">
        {iterationCount}/{maxIterations}
      </span>
      <span className="mx-2 text-muted-foreground">·</span>
      <span className="text-muted-foreground">Step </span>
      <span className="tabular-nums text-foreground">
        {stepCount}/{maxStepsPerRun}
      </span>
    </div>
  );
}

// ── Inner canvas (needs ReactFlow context) ─────────────────────────────────────

type RunGraphInnerProps = {
  definitionSnapshot: LoopDefinition;
  graphState: RunGraphState;
  onNodeClick?: (nodeId: string) => void;
};

function RunGraphInner({
  definitionSnapshot,
  graphState,
  onNodeClick,
}: RunGraphInnerProps) {
  const { fitView } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const colorMode: ColorMode = resolvedTheme === "dark" ? "dark" : "light";

  // Fit view on first mount only
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current) return;
    didFitRef.current = true;
    setTimeout(() => fitView({ duration: 300 }), 100);
  }, [fitView]);

  // Derive nodes/edges from snapshot — stable shape, updated overlays
  const { nodes: baseNodes, edges: baseEdges } = useMemo(
    () => definitionToFlow(definitionSnapshot),
    [definitionSnapshot],
  );

  const nodes = useMemo(
    () => applyNodeOverlays(baseNodes, graphState),
    [baseNodes, graphState],
  );

  const edges = useMemo(
    () => applyEdgeOverlays(baseEdges, graphState),
    [baseEdges, graphState],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  const currentNodeId = graphState.currentNodeId;
  const currentNodeLabel = currentNodeId
    ? (definitionSnapshot.nodes.find((n) => n.id === currentNodeId)?.label ??
      currentNodeId)
    : null;

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        onNodeClick={handleNodeClick}
        colorMode={colorMode}
        fitView
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          className="opacity-30"
        />
        <Controls className="nodrag" />
        <MiniMap
          className="nodrag"
          nodeColor={(node) => {
            const nodeId = node.id;
            const nodeState = graphState.nodes[nodeId];
            if (nodeState && nodeState.status !== "unvisited") {
              return nodeStatusMiniMapColor[nodeState.status];
            }
            const kind = (node.data as { kind?: string } | undefined)?.kind;
            return kind ? (kindMiniMapColor[kind] ?? "#b1b1b7") : "#b1b1b7";
          }}
          maskColor={
            colorMode === "dark" ? "rgb(0 0 0 / 0.6)" : "rgb(240 240 240 / 0.6)"
          }
        />

        {/* Iteration meter panel */}
        <Panel position="bottom-center">
          <IterationMeter
            iterationCount={graphState.meter.iterationCount}
            maxIterations={graphState.meter.maxIterations}
            stepCount={graphState.meter.stepCount}
            maxStepsPerRun={graphState.meter.maxStepsPerRun}
          />
        </Panel>
      </ReactFlow>

      {/* aria-live region for status announcements */}
      {currentNodeLabel && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {`Step '${currentNodeLabel}' ${graphState.currentNodeId ? "running" : "done"}`}
        </div>
      )}
    </div>
  );
}

// ── Public component ───────────────────────────────────────────────────────────

export type RunGraphProps = {
  definitionSnapshot: LoopDefinition;
  steps: AgentLoopStepRun[];
  run: Pick<
    AgentLoopRun,
    "status" | "currentNodeId" | "iterationCount" | "stepCount"
  >;
  guardrails: Record<string, unknown> | null;
  onNodeClick?: (nodeId: string) => void;
};

/**
 * RunGraph — read-only React Flow canvas for live run graph view.
 *
 * Drives overlays from the existing SWR poll data (no new fetches).
 * Snapshot rule: always uses definitionSnapshot, never the live definition.
 */
export function RunGraph({
  definitionSnapshot,
  steps,
  run,
  guardrails,
  onNodeClick,
}: RunGraphProps) {
  // Derive graph state on every render (pure function, cheap)
  const graphState = useMemo(
    () =>
      deriveRunGraphState({
        definitionSnapshot,
        steps,
        run,
        guardrails,
      }),
    [definitionSnapshot, steps, run, guardrails],
  );

  return (
    <ReactFlowProvider>
      <RunGraphInner
        definitionSnapshot={definitionSnapshot}
        graphState={graphState}
        onNodeClick={onNodeClick}
      />
    </ReactFlowProvider>
  );
}
