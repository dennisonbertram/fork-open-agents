"use client";

/**
 * run-graph.tsx — Read-only React Flow canvas for live run graph view (M2-03)
 *
 * Renders the run's definitionSnapshot as a read-only React Flow canvas with
 * execution state overlays driven by deriveRunGraphState.
 *
 * SNAPSHOT RULE: always uses run.definitionSnapshot, never the live loop definition.
 *
 * Visual language: uses the SAME nodeTypes/edgeTypes as the builder, so the run
 * view shares icons, kind accents, config summaries, and color language with the
 * builder. Run-state is layered on top via optional add-only props:
 *   node.data.runStatus, .visitCount, .isCurrent
 *   edge.data.traversed, .mostRecent
 *
 * Read-only mode:
 *   - nodesDraggable={false}
 *   - nodesConnectable={false}
 *   - elementsSelectable={true} (for node click → timeline focus)
 *   - No palette, no save
 *
 * Status overlays (rendered inside builder node components):
 *   - Current node: pulsing orange ring + "processing" badge
 *   - Succeeded: green ring + "success" badge
 *   - Failed: red ring + "error" badge
 *   - Skipped/unvisited: dimmed (opacity-50)
 *   - Visit count badge (×N) when visitCount > 1
 *
 * Edge overlays (rendered inside WhenEdge component):
 *   - Most-recent traversal: thicker stroke (4) + full opacity + animated dash
 *   - Older traversed: normal stroke (2) + near-full opacity
 *   - Untraversed: thin stroke + dimmed opacity
 *
 * MiniMap: per-node status color
 * Iteration meter: "Iteration 2/10 · Step 5/50"
 * aria-live: announces node transitions
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { nodeTypes } from "@/app/loops/[loopId]/builder/loop-nodes";
import { WhenEdge } from "@/app/loops/[loopId]/builder/when-edge";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import type {
  AgentLoopEvent,
  AgentLoopRun,
  AgentLoopStepRun,
} from "@/lib/db/schema";
import {
  deriveRunGraphState,
  type NodeRunStatus,
  type RunGraphState,
} from "./use-run-graph-state";

// ── Edge types registry ────────────────────────────────────────────────────────

const edgeTypes = {
  when: WhenEdge,
};

// ── Per-node status color for MiniMap ─────────────────────────────────────────

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

// ── Map run graph state into node.data and edge.data ──────────────────────────

/**
 * Merges run-state into each node's data so that the builder node components
 * can render status badges, rings, and visit count pills.
 * Builder rendering is unchanged when runStatus is absent; these props are
 * add-only and never remove or replace existing data fields.
 */
function applyNodeRunState(
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

/**
 * Merges traversal state into each edge's data so that WhenEdge can render
 * traversal overlays (opacity, stroke width, animation).
 * Builder WhenEdge rendering is unchanged when traversed/mostRecent are absent.
 */
function applyEdgeRunState(
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

// ── aria-live announcement hook ────────────────────────────────────────────────

/**
 * Produces a human-readable announcement whenever the current node or its
 * status changes. Returns null when there is no active transition.
 */
function useNodeTransitionAnnouncement(
  currentNodeId: string | null,
  graphState: RunGraphState,
  definition: LoopDefinition,
): string | null {
  const nodeLabel = currentNodeId
    ? (definition.nodes.find((n) => n.id === currentNodeId)?.label ??
      currentNodeId)
    : null;

  const nodeStatus = currentNodeId
    ? (graphState.nodes[currentNodeId]?.status ?? null)
    : null;

  const visitCount = currentNodeId
    ? (graphState.nodes[currentNodeId]?.visitCount ?? 1)
    : null;

  if (!nodeLabel || !nodeStatus) return null;

  const iterationSuffix =
    visitCount && visitCount > 1 ? ` — iteration ${visitCount}` : "";

  switch (nodeStatus) {
    case "running":
      return `${nodeLabel} running${iterationSuffix}`;
    case "succeeded":
      return `${nodeLabel} succeeded${iterationSuffix}`;
    case "failed":
      return `${nodeLabel} failed${iterationSuffix}`;
    case "skipped":
      return `${nodeLabel} skipped`;
    default:
      return null;
  }
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

  // Merge run-state into node/edge data — fed to builder components
  const nodes = useMemo(
    () => applyNodeRunState(baseNodes, graphState),
    [baseNodes, graphState],
  );

  const edges = useMemo(
    () => applyEdgeRunState(baseEdges, graphState),
    [baseEdges, graphState],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  // aria-live: announce node transitions
  const announcement = useNodeTransitionAnnouncement(
    graphState.currentNodeId,
    graphState,
    definitionSnapshot,
  );

  // Track the previous announcement to avoid repeating the same message
  const prevAnnouncementRef = useRef<string | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    if (announcement && announcement !== prevAnnouncementRef.current) {
      prevAnnouncementRef.current = announcement;
      setLiveAnnouncement(announcement);
    }
  }, [announcement]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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

      {/* aria-live region for node transition announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement ?? ""}
      </div>
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
  /** Run events from the poll response — enables exact edge attribution. */
  events?: AgentLoopEvent[];
  onNodeClick?: (nodeId: string) => void;
};

/**
 * RunGraph — read-only React Flow canvas for live run graph view.
 *
 * Drives overlays from the existing SWR poll data (no new fetches).
 * Snapshot rule: always uses definitionSnapshot, never the live definition.
 * Visual language: shares the builder's nodeTypes and edgeTypes exactly.
 */
export function RunGraph({
  definitionSnapshot,
  steps,
  run,
  guardrails,
  events,
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
        events,
      }),
    [definitionSnapshot, steps, run, guardrails, events],
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
