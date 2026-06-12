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
      return { id, kind: "github_check", label: "GitHub check", position };
    case "condition":
      return {
        id,
        kind: "condition",
        label: "Condition",
        position,
        condition: { path: "", op: "exists" },
      };
    case "end":
      return { id, kind: "end", label: "End", position };
  }
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
      set({
        nodes: nextNodes,
        isDirty: true,
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
      const data = defaultNodeData(id, kind, position);
      const newNode: LoopFlowNode = {
        id,
        type: "loopNode",
        position,
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

// ── Default singleton store (for non-test usage) ──────────────────────────────

export const loopBuilderStore = createLoopBuilderStore();
