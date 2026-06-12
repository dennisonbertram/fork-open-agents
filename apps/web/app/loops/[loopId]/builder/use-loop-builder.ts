/**
 * use-loop-builder.ts — Zustand store for the React Flow loop builder.
 *
 * Adapted from simple-ai's use-workflow.ts pattern (MIT © 2025 Alwurts).
 * Execution/SSE logic is stripped — this store is UI-only.
 *
 * On every graph change, validateLoopDefinition(flowToDefinition(...)) runs
 * and the structured errors are stored for the ErrorIndicator component.
 */

import type { EdgeChange, NodeChange } from "@xyflow/react";
import { applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import { nanoid } from "nanoid";
import { createStore } from "zustand/vanilla";
import type {
  LoopDefinition,
  LoopNode,
  LoopNodeKind,
  LoopValidationError,
} from "@/lib/agent-loops/types";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";
import {
  definitionToFlow,
  flowToDefinition,
  type LoopFlowEdge,
  type LoopFlowNode,
} from "./definition-mapping";

// ── Legal when values by source kind ─────────────────────────────────────────

const CONDITION_WHEN_VALUES = ["true", "false"] as const;
const NON_CONDITION_WHEN_VALUES = ["success", "failure", "always"] as const;

type WhenValue = "true" | "false" | "success" | "failure" | "always";

// ── Store state ───────────────────────────────────────────────────────────────

export interface LoopBuilderState {
  nodes: LoopFlowNode[];
  edges: LoopFlowEdge[];
  isDirty: boolean;
  validationErrors: LoopValidationError[];

  // Lifecycle
  initialize: (def: LoopDefinition) => void;
  markClean: () => void;

  // React Flow handlers
  onNodesChange: (changes: NodeChange<LoopFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<LoopFlowEdge>[]) => void;

  // Graph mutations
  addNode: (
    kind: Exclude<LoopNodeKind, "start">,
    position: { x: number; y: number },
  ) => string;
  connectEdge: (params: {
    source: string;
    target: string;
    when: WhenValue;
  }) => string;

  /**
   * Update config fields on an existing node by id.
   * Merges partial fields into the node's data, marks dirty, and revalidates.
   * No-op if the nodeId does not exist.
   */
  updateNodeConfig: (nodeId: string, patch: Partial<LoopNode>) => void;

  /**
   * Change the `when` value of an existing edge by id.
   * Marks dirty and revalidates.
   * No-op if the edgeId does not exist.
   */
  updateEdgeWhen: (edgeId: string, when: WhenValue) => void;

  // Edge when legality
  legalWhenValues: (sourceNodeId: string) => WhenValue[];

  // Current definition snapshot
  currentDefinition: () => LoopDefinition;
}

// ── Default config for new palette nodes ─────────────────────────────────────

function defaultNodeData(
  id: string,
  kind: Exclude<LoopNodeKind, "start">,
  position: { x: number; y: number },
): LoopFlowNode["data"] {
  switch (kind) {
    case "agent_step":
      return { id, kind: "agent_step", label: "Agent step", position };
    case "github_check":
      return {
        id,
        kind: "github_check",
        label: "GitHub check",
        position,
        // Default to list_issues/open — a genuinely runnable check that needs
        // no required fields beyond kind. VR-12 requires check config; this
        // satisfies it immediately so Save is never bricked before M2-02 panels.
        check: { kind: "list_issues", state: "open" },
      };
    case "condition":
      return {
        id,
        kind: "condition",
        label: "Condition",
        position,
        // 'previous_step.output' is a self-explanatory placeholder: it names
        // the context-reference pattern (dot-separated path), communicates
        // "you need to fill this in", and uses op:exists which needs no value.
        // At runtime, exists on a missing key deterministically routes false
        // (safe M1 semantics). VR-13 requires condition config with path min(1);
        // this satisfies it immediately so Save is never bricked before M2-02.
        condition: { path: "previous_step.output", op: "exists" },
      };
    case "end":
      return { id, kind: "end", label: "End", position };
  }
}

// ── Collision-free position helper ───────────────────────────────────────────

const COLLISION_RADIUS = 120;
const OFFSET_STEP = 40;

/**
 * Given a desired drop position and existing node positions, find a position
 * that is at least COLLISION_RADIUS away from every existing node.
 * Cascades by (OFFSET_STEP, OFFSET_STEP) until a free slot is found.
 */
function isColliding(
  candidate: { x: number; y: number },
  others: Array<{ x: number; y: number }>,
): boolean {
  for (const ep of others) {
    if (Math.hypot(ep.x - candidate.x, ep.y - candidate.y) < COLLISION_RADIUS) {
      return true;
    }
  }
  return false;
}

function findFreePosition(
  desired: { x: number; y: number },
  existingPositions: Array<{ x: number; y: number }>,
): { x: number; y: number } {
  const maxAttempts = 100;
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = {
      x: desired.x + i * OFFSET_STEP,
      y: desired.y + i * OFFSET_STEP,
    };
    if (!isColliding(candidate, existingPositions)) {
      return candidate;
    }
  }
  return {
    x: desired.x + maxAttempts * OFFSET_STEP,
    y: desired.y + maxAttempts * OFFSET_STEP,
  };
}

// ── Store factory (exported for testing) ─────────────────────────────────────

export function createLoopBuilderStore() {
  return createStore<LoopBuilderState>((set, get) => ({
    nodes: [],
    edges: [],
    isDirty: false,
    validationErrors: [],

    initialize(def) {
      const { nodes, edges } = definitionToFlow(def);
      const validResult = validateLoopDefinition(def);
      set({
        nodes,
        edges,
        isDirty: false,
        validationErrors: validResult.ok ? [] : validResult.errors,
      });
    },

    markClean() {
      set({ isDirty: false });
    },

    onNodesChange(changes) {
      const nextNodes = applyNodeChanges<LoopFlowNode>(changes, get().nodes);
      const def = flowToDefinition(nextNodes, get().edges);
      const validResult = validateLoopDefinition(def);
      // Only mark dirty for user mutations — ignore React Flow lifecycle events
      // that fire on mount (dimensions measurement, selection state).
      const hasMutation = changes.some(
        (c) => c.type !== "dimensions" && c.type !== "select",
      );
      set({
        nodes: nextNodes,
        ...(hasMutation ? { isDirty: true } : {}),
        validationErrors: validResult.ok ? [] : validResult.errors,
      });
    },

    onEdgesChange(changes) {
      const nextEdges = applyEdgeChanges(
        changes,
        get().edges,
      ) as LoopFlowEdge[];
      const def = flowToDefinition(get().nodes, nextEdges);
      const validResult = validateLoopDefinition(def);
      set({
        edges: nextEdges,
        isDirty: true,
        validationErrors: validResult.ok ? [] : validResult.errors,
      });
    },

    addNode(kind, position) {
      const id = nanoid();
      const freePosition = findFreePosition(
        position,
        get().nodes.map((n) => n.position),
      );
      const data = defaultNodeData(id, kind, freePosition);
      const newNode: LoopFlowNode = {
        id,
        type: "loopNode",
        position: freePosition,
        data,
      };
      const nextNodes = [...get().nodes, newNode];
      const def = flowToDefinition(nextNodes, get().edges);
      const validResult = validateLoopDefinition(def);
      set({
        nodes: nextNodes,
        isDirty: true,
        validationErrors: validResult.ok ? [] : validResult.errors,
      });
      return id;
    },

    connectEdge({ source, target, when: whenValue }) {
      const id = nanoid();
      const newEdge: LoopFlowEdge = {
        id,
        source,
        target,
        type: "when",
        data: { when: whenValue },
      };
      const nextEdges = [...get().edges, newEdge];
      const def = flowToDefinition(get().nodes, nextEdges);
      const validResult = validateLoopDefinition(def);
      set({
        edges: nextEdges,
        isDirty: true,
        validationErrors: validResult.ok ? [] : validResult.errors,
      });
      return id;
    },

    updateNodeConfig(nodeId, patch) {
      const idx = get().nodes.findIndex((n) => n.id === nodeId);
      if (idx === -1) return;
      const node = get().nodes[idx]!;
      const updatedData = { ...node.data, ...patch } as LoopNode;
      const nextNodes = [
        ...get().nodes.slice(0, idx),
        { ...node, data: updatedData },
        ...get().nodes.slice(idx + 1),
      ];
      const def = flowToDefinition(nextNodes, get().edges);
      const validResult = validateLoopDefinition(def);
      set({
        nodes: nextNodes,
        isDirty: true,
        validationErrors: validResult.ok ? [] : validResult.errors,
      });
    },

    updateEdgeWhen(edgeId, when: WhenValue) {
      const idx = get().edges.findIndex((e) => e.id === edgeId);
      if (idx === -1) return;
      const edge = get().edges[idx]!;
      const updatedEdge: LoopFlowEdge = {
        ...edge,
        data: { ...edge.data, when },
      };
      const nextEdges = [
        ...get().edges.slice(0, idx),
        updatedEdge,
        ...get().edges.slice(idx + 1),
      ];
      const def = flowToDefinition(get().nodes, nextEdges);
      const validResult = validateLoopDefinition(def);
      set({
        edges: nextEdges,
        isDirty: true,
        validationErrors: validResult.ok ? [] : validResult.errors,
      });
    },

    legalWhenValues(sourceNodeId) {
      const node = get().nodes.find((n) => n.id === sourceNodeId);
      if (!node) return [...NON_CONDITION_WHEN_VALUES];
      return node.data.kind === "condition"
        ? [...CONDITION_WHEN_VALUES]
        : [...NON_CONDITION_WHEN_VALUES];
    },

    currentDefinition() {
      return flowToDefinition(get().nodes, get().edges);
    },
  }));
}

// ── Type alias for store instance ─────────────────────────────────────────────

export type CreateLoopBuilderStoreReturn = ReturnType<
  typeof createLoopBuilderStore
>;

// ── Default singleton store (for non-test usage) ──────────────────────────────

export const loopBuilderStore = createLoopBuilderStore();
