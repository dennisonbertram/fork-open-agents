"use client";

/**
 * builder-canvas.tsx — ReactFlow canvas for the loop builder.
 *
 * Features:
 * - ReactFlowProvider + ReactFlow with custom nodeTypes/edgeTypes
 * - dotted Background, Controls, MiniMap with per-kind accent colors
 * - fitView on load
 * - Top bar: loop name, dirty indicator, Save button, Back link, ErrorIndicator,
 *   LoopSettingsPanel gear button
 * - Left palette panel: click-to-add for agent_step, github_check, condition, end
 * - Edge creation: onConnect opens WhenPicker to pick when value
 * - Edge click: opens WhenPicker pre-populated with current value for editing
 * - Node deletion: prompts DeleteNodeDialog naming attached edge count
 * - NodeConfigPanel: docked right-side panel, selection-driven
 * - BuilderErrorContext: provides nodeErrorsById map to loop-nodes
 * - Leave-page guard when dirty (beforeunload)
 * - Dark mode: colorMode driven by the app's ThemeContext (html .dark class)
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
  type Connection,
  type ColorMode,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Bot, Flag, Github, GitBranch, Save } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/app/providers";
import { nodeTypes } from "./loop-nodes";
import { WhenEdge } from "./when-edge";
import type { WhenValue } from "./when-picker";
import { WhenPicker } from "./when-picker";
import { ErrorIndicator } from "./error-indicator";
import { NodeConfigPanel } from "./node-config-panel-component";
import { LoopSettingsPanel } from "./loop-settings-panel-component";
import { DeleteNodeDialog } from "./delete-node-dialog";
import { BuilderErrorContext } from "./builder-error-context";
import { nodeErrorsById } from "./node-config-panel";
import { createLoopBuilderStore } from "./use-loop-builder";
import { definitionToFlow } from "./definition-mapping";
import type { LoopDefinition, LoopGuardrails } from "@/lib/agent-loops/types";
import type { LoopFlowEdge } from "./definition-mapping";

const edgeTypes = {
  when: WhenEdge,
};

// Fit-view clamp: keep the auto-fit from zooming out so far that node labels and
// the loop-back arc become unreadable. Wide graphs pan instead of shrinking.
const LOOP_FIT_VIEW_OPTIONS = {
  padding: 0.2,
  minZoom: 0.6,
  maxZoom: 1.1,
} as const;

// Per-kind accent color for MiniMap nodes
const kindMiniMapColor: Record<string, string> = {
  start: "#10b981",
  agent_step: "#8b5cf6",
  github_check: "#64748b",
  condition: "#f59e0b",
  end: "#a3a3a3",
};

type PendingConnection = {
  source: string;
  target: string;
  screenPosition: { x: number; y: number };
};

// Tracks an edge being edited (when-change, not just creation)
type PendingEdgeEdit = {
  edgeId: string;
  sourceNodeId: string;
  screenPosition: { x: number; y: number };
};

// Tracks node pending deletion
type PendingNodeDelete = {
  nodeId: string;
  nodeName: string;
  edgeCount: number;
};

type BuilderCanvasInnerProps = {
  loopId: string;
  loopName: string;
  loopDescription?: string | null;
  loopGuardrails?: LoopGuardrails;
  watchdogEnabled?: boolean;
  watchdogInstructions?: string | null;
  watchdogRetryBudget?: number;
  store: ReturnType<typeof createLoopBuilderStore>;
};

function BuilderCanvasInner({
  loopId,
  loopName,
  loopDescription,
  loopGuardrails,
  watchdogEnabled,
  watchdogInstructions,
  watchdogRetryBudget,
  store,
}: BuilderCanvasInnerProps) {
  const { fitView } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const colorMode: ColorMode = resolvedTheme === "dark" ? "dark" : "light";

  const nodes = useStore(store, (s) => s.nodes);
  const edges = useStore(store, (s) => s.edges);
  const isDirty = useStore(store, (s) => s.isDirty);
  const validationErrors = useStore(store, (s) => s.validationErrors);
  const onNodesChange = useStore(store, (s) => s.onNodesChange);
  const onEdgesChange = useStore(store, (s) => s.onEdgesChange);
  const addNode = useStore(store, (s) => s.addNode);
  const connectEdge = useStore(store, (s) => s.connectEdge);
  const legalWhenValues = useStore(store, (s) => s.legalWhenValues);
  const markClean = useStore(store, (s) => s.markClean);
  const currentDefinition = useStore(store, (s) => s.currentDefinition);
  const updateEdgeWhen = useStore(store, (s) => s.updateEdgeWhen);

  const [saving, setSaving] = useState(false);
  const [pendingConnection, setPendingConnection] =
    useState<PendingConnection | null>(null);
  const [pendingEdgeEdit, setPendingEdgeEdit] =
    useState<PendingEdgeEdit | null>(null);
  const [pendingNodeDelete, setPendingNodeDelete] =
    useState<PendingNodeDelete | null>(null);

  // Compute nodeErrorsById for the error context
  const errorsById = useMemo(
    () => nodeErrorsById(validationErrors),
    [validationErrors],
  );

  // Leave-page guard
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Fit view on mount
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current || nodes.length === 0) return;
    didFitRef.current = true;
    setTimeout(() => fitView({ duration: 300, ...LOOP_FIT_VIEW_OPTIONS }), 100);
  }, [fitView, nodes.length]);

  // Edge connection: show picker before committing
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const el = document.querySelector(".react-flow__renderer");
    const rect = el?.getBoundingClientRect();
    setPendingConnection({
      source: connection.source,
      target: connection.target,
      screenPosition: {
        x: (rect?.left ?? 0) + (rect?.width ?? 300) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 200) / 2,
      },
    });
  }, []);

  function handleWhenPick(when: WhenValue) {
    if (pendingConnection) {
      connectEdge({
        source: pendingConnection.source,
        target: pendingConnection.target,
        when,
      });
      setPendingConnection(null);
    } else if (pendingEdgeEdit) {
      updateEdgeWhen(pendingEdgeEdit.edgeId, when);
      setPendingEdgeEdit(null);
    }
  }

  // Edge click: open picker pre-populated for editing the when value
  const handleEdgeClick: EdgeMouseHandler<LoopFlowEdge> = useCallback(
    (_event, edge) => {
      const el = document.querySelector(".react-flow__renderer");
      const rect = el?.getBoundingClientRect();
      setPendingEdgeEdit({
        edgeId: edge.id,
        sourceNodeId: edge.source,
        screenPosition: {
          x: (rect?.left ?? 0) + (rect?.width ?? 300) / 2,
          y: (rect?.top ?? 0) + (rect?.height ?? 200) / 2,
        },
      });
    },
    [],
  );

  // Node deletion via Delete/Backspace key — handled by our own keydown listener
  // on the canvas div rather than ReactFlow's built-in deleteKeyCode machinery.
  //
  // WHY: ReactFlow's deleteElements() fires onEdgesChange(remove) BEFORE
  // onNodesChange(remove). With onEdgesChange wired directly (unguarded) and
  // onNodesChange going through the dialog guard, a Delete+Cancel sequence
  // stripped the connected edges while keeping the node — silent data loss.
  //
  // FIX: deleteKeyCode={null} disables ReactFlow's handler entirely. Our
  // handler opens the dialog without touching the store. The store is only
  // mutated atomically on CONFIRM (node + edges together) or not at all on
  // CANCEL.
  const handleCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;

      // Guard: skip if focus is in a text input/textarea/select (or contenteditable)
      const target = e.target as HTMLElement;
      const tag = target.tagName.toUpperCase();
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      // Find the first selected node
      const selectedNode = nodes.find((n) => n.selected);
      if (!selectedNode) return;

      // Don't open a second dialog if one is already pending
      if (pendingNodeDelete) return;

      e.preventDefault();

      const attachedEdges = edges.filter(
        (ed) => ed.source === selectedNode.id || ed.target === selectedNode.id,
      );
      setPendingNodeDelete({
        nodeId: selectedNode.id,
        nodeName: selectedNode.data?.label ?? selectedNode.id,
        edgeCount: attachedEdges.length,
      });
    },
    [nodes, edges, pendingNodeDelete],
  );

  // Pass-through for non-remove node changes only.
  // Remove changes are handled exclusively through handleCanvasKeyDown +
  // confirmNodeDelete so the store is never mutated before dialog confirmation.
  const handleNodesChangeWithGuard = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const otherChanges = changes.filter((c) => c.type !== "remove");
      if (otherChanges.length > 0) {
        onNodesChange(otherChanges);
      }
      // Remove changes are silently dropped here — they can only arrive via
      // ReactFlow internals (which we've disabled with deleteKeyCode={null}).
      // All node deletions go through handleCanvasKeyDown → dialog → confirmNodeDelete.
    },
    [onNodesChange],
  );

  function confirmNodeDelete() {
    if (!pendingNodeDelete) return;
    // Apply the remove change
    onNodesChange([{ id: pendingNodeDelete.nodeId, type: "remove" }]);
    // Also remove attached edges
    const attachedEdgeChanges = edges
      .filter(
        (e) =>
          e.source === pendingNodeDelete.nodeId ||
          e.target === pendingNodeDelete.nodeId,
      )
      .map((e) => ({ id: e.id, type: "remove" as const }));
    if (attachedEdgeChanges.length > 0) {
      onEdgesChange(attachedEdgeChanges);
    }
    setPendingNodeDelete(null);
  }

  // Palette node insertion. When a node is selected, auto-connect the new node
  // after it (so it isn't a disconnected orphan); otherwise drop it at viewport
  // center. The store handles collision avoidance and edge legality.
  const { screenToFlowPosition } = useReactFlow();
  function handleAddNode(
    kind: "agent_step" | "github_check" | "condition" | "end",
  ) {
    const selected = nodes.find((n) => n.selected && n.data.kind !== "end");
    const el = document.querySelector(".react-flow__renderer");
    const rect = el?.getBoundingClientRect();
    const centerX = (rect?.left ?? 0) + (rect?.width ?? 600) / 2;
    const centerY = (rect?.top ?? 0) + (rect?.height ?? 400) / 2;
    const position = screenToFlowPosition({ x: centerX, y: centerY });
    addNode(
      kind,
      position,
      selected ? { connectFrom: selected.id } : undefined,
    );
    // Re-frame so the just-added node is visible (it can land off the current
    // viewport, especially when auto-connected to the right of its source).
    setTimeout(() => fitView({ duration: 300, ...LOOP_FIT_VIEW_OPTIONS }), 60);
  }

  // Save
  async function handleSave() {
    if (!isDirty || validationErrors.length > 0 || saving) return;
    setSaving(true);
    try {
      const def = currentDefinition();
      const res = await fetch(`/api/agent-loops/${loopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: def }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          errors?: unknown[];
        };
        toast.error(body.message ?? "Failed to save loop definition.");
        return;
      }
      markClean();
      toast.success("Definition saved.");
    } catch {
      toast.error("Failed to save loop definition.");
    } finally {
      setSaving(false);
    }
  }

  const pickerOpen = Boolean(pendingConnection ?? pendingEdgeEdit);
  const pickerSourceNodeId =
    pendingConnection?.source ?? pendingEdgeEdit?.sourceNodeId ?? null;
  const pendingOptions = pickerSourceNodeId
    ? legalWhenValues(pickerSourceNodeId)
    : [];

  return (
    <BuilderErrorContext.Provider value={errorsById}>
      <div className="flex h-screen flex-col bg-background">
        {/* Top bar */}
        <div className="relative flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <Link
            href={`/loops/${loopId}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {loopName}
          </Link>

          <span className="text-muted-foreground">·</span>
          <span className="text-sm font-medium">Builder</span>

          {isDirty && (
            <span className="rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              Unsaved changes
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <ErrorIndicator errors={validationErrors} />
            <LoopSettingsPanel
              loopId={loopId}
              loopName={loopName}
              loopDescription={loopDescription}
              guardrails={loopGuardrails}
              watchdogEnabled={watchdogEnabled}
              watchdogInstructions={watchdogInstructions}
              watchdogRetryBudget={watchdogRetryBudget}
            />
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={!isDirty || validationErrors.length > 0 || saving}
            >
              <Save className="mr-1.5 size-3.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Canvas + panels */}
        <div className="flex flex-1 overflow-hidden">
          {/* Node palette */}
          <div className="flex w-48 shrink-0 flex-col gap-1 border-r border-border p-3">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Add node
            </p>
            {(() => {
              const selected = nodes.find(
                (n) => n.selected && n.data.kind !== "end",
              );
              return (
                <p className="mb-1 text-[11px] leading-snug text-muted-foreground">
                  {selected
                    ? `Inserts after “${selected.data.label}”`
                    : "Select a node first to insert connected"}
                </p>
              );
            })()}
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-2 text-xs text-violet-700 dark:text-violet-300"
              onClick={() => handleAddNode("agent_step")}
            >
              <Bot className="size-4" />
              Agent step
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-2 text-xs text-slate-600 dark:text-slate-300"
              onClick={() => handleAddNode("github_check")}
            >
              <Github className="size-4" />
              GitHub check
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-2 text-xs text-amber-700 dark:text-amber-300"
              onClick={() => handleAddNode("condition")}
            >
              <GitBranch className="size-4" />
              Condition
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-2 text-xs text-neutral-600 dark:text-neutral-300"
              onClick={() => handleAddNode("end")}
            >
              <Flag className="size-4" />
              End
            </Button>
          </div>

          {/* React Flow canvas — role="application" + tabIndex={-1} makes this
              div focusable so our onKeyDown receives Delete/Backspace.
              deleteKeyCode={null} disables ReactFlow's built-in handler. */}
          <div
            role="application"
            aria-label="Loop flow canvas"
            className="relative flex-1"
            onKeyDown={handleCanvasKeyDown}
            tabIndex={-1}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChangeWithGuard}
              onEdgesChange={onEdgesChange}
              onConnect={handleConnect}
              onEdgeClick={handleEdgeClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode={colorMode}
              fitView
              fitViewOptions={LOOP_FIT_VIEW_OPTIONS}
              deleteKeyCode={null}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={16}
                size={1}
                className="opacity-50"
              />
              <Controls className="nodrag" />
              <MiniMap
                className="nodrag"
                nodeColor={(node) => {
                  const kind = (node.data as { kind?: string } | undefined)
                    ?.kind;
                  return kind
                    ? (kindMiniMapColor[kind] ?? "#b1b1b7")
                    : "#b1b1b7";
                }}
                maskColor={
                  colorMode === "dark"
                    ? "rgb(0 0 0 / 0.6)"
                    : "rgb(240 240 240 / 0.6)"
                }
              />

              {/* Empty state hint */}
              {nodes.length === 0 && (
                <Panel position="top-center">
                  <p className="rounded-md border border-dashed border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground backdrop-blur-sm">
                    Add steps from the palette, connect them, then Save
                  </p>
                </Panel>
              )}
            </ReactFlow>

            {/* When picker (new connection) */}
            {pickerOpen && (
              <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
                <div className="pointer-events-auto">
                  <WhenPicker
                    open={pickerOpen}
                    onClose={() => {
                      setPendingConnection(null);
                      setPendingEdgeEdit(null);
                    }}
                    options={pendingOptions}
                    onPick={handleWhenPick}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Node config panel (docked right) */}
          <NodeConfigPanel store={store} />
        </div>

        {/* Node delete confirmation dialog */}
        {pendingNodeDelete && (
          <DeleteNodeDialog
            open={Boolean(pendingNodeDelete)}
            nodeName={pendingNodeDelete.nodeName}
            edgeCount={pendingNodeDelete.edgeCount}
            onConfirm={confirmNodeDelete}
            onCancel={() => setPendingNodeDelete(null)}
          />
        )}
      </div>
    </BuilderErrorContext.Provider>
  );
}

type BuilderCanvasProps = {
  loopId: string;
  loopName: string;
  loopDescription?: string | null;
  loopGuardrails?: LoopGuardrails;
  watchdogEnabled?: boolean;
  watchdogInstructions?: string | null;
  watchdogRetryBudget?: number;
  definition: LoopDefinition;
};

export function BuilderCanvas({
  loopId,
  loopName,
  loopDescription,
  loopGuardrails,
  watchdogEnabled,
  watchdogInstructions,
  watchdogRetryBudget,
  definition,
}: BuilderCanvasProps) {
  // Create store once and initialize with the definition
  const storeRef = useRef<ReturnType<typeof createLoopBuilderStore> | null>(
    null,
  );
  if (!storeRef.current) {
    storeRef.current = createLoopBuilderStore();
    // Seed with start + end if definition is empty
    if (definition.nodes.length === 0) {
      const seededDef: LoopDefinition = {
        nodes: [
          {
            id: "start",
            kind: "start",
            label: "Start",
            position: { x: 100, y: 200 },
          },
          {
            id: "end",
            kind: "end",
            label: "End",
            position: { x: 400, y: 200 },
          },
        ],
        edges: [],
      };
      storeRef.current.getState().initialize(seededDef);
    } else {
      storeRef.current.getState().initialize(definition);
    }
  }

  return (
    <ReactFlowProvider>
      <BuilderCanvasInner
        loopId={loopId}
        loopName={loopName}
        loopDescription={loopDescription}
        loopGuardrails={loopGuardrails}
        watchdogEnabled={watchdogEnabled}
        watchdogInstructions={watchdogInstructions}
        watchdogRetryBudget={watchdogRetryBudget}
        store={storeRef.current}
      />
    </ReactFlowProvider>
  );
}

// Export for definition seeding in tests
export { definitionToFlow };
