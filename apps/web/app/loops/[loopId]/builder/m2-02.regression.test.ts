/**
 * m2-02.regression.test.ts — regression harness for M2-02 config panels.
 *
 * These tests catch future breakage if the changes in 41ef327c are reverted.
 * They cover different angles than the behavioral tests:
 *   - updateNodeConfig atomicity: label + config field update together
 *   - updateEdgeWhen must not drop other edge fields
 *   - nodeErrorsById: global errors (no nodeId) must NOT appear in any nodeId key
 *   - clampGuardrailField: identity for values under ceiling
 *   - validateLoopSettings: field error shape has { field, message }
 *   - updateNodeConfig: multiple sequential updates are cumulative, not additive to previous state only
 *   - conditionValueVisible / conditionValueType exhaustive cross-check
 *   - nodeErrorsById: duplicate_when error (has sourceNodeId, not nodeId) must not appear in byId
 */

import { describe, expect, it } from "bun:test";
import type { LoopDefinition } from "@/lib/agent-loops/types";
import {
  GUARDRAIL_CEILINGS,
  GUARDRAIL_DEFAULTS,
} from "@/lib/agent-loops/types";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";
import { createLoopBuilderStore } from "./use-loop-builder";
import {
  nodeErrorsById,
  conditionValueVisible,
  conditionValueType,
  clampGuardrailField,
} from "./node-config-panel";
import { validateLoopSettings } from "./loop-settings-panel";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AGENT_STEP_DEF: LoopDefinition = {
  nodes: [
    { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "step1",
      kind: "agent_step",
      label: "My step",
      position: { x: 200, y: 0 },
      instructions: "Do something",
    },
    { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "s", target: "step1", when: "always" },
    { id: "e2", source: "step1", target: "e", when: "success" },
  ],
};

// ── Regression: updateNodeConfig atomicity ─────────────────────────────────────

describe("REG-M2-02-01: updateNodeConfig atomicity", () => {
  it("REG-M2-02-01a: two sequential updateNodeConfig calls accumulate independently", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateNodeConfig("step1", { label: "Renamed" });
    store
      .getState()
      .updateNodeConfig("step1", { instructions: "New instructions" });

    const node = store.getState().nodes.find((n) => n.id === "step1");
    if (node?.data?.kind === "agent_step") {
      // Both updates should be visible
      expect(node.data.label).toBe("Renamed");
      expect(node.data.instructions).toBe("New instructions");
    }
  });

  it("REG-M2-02-01b: updateNodeConfig does not corrupt other nodes", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateNodeConfig("step1", { label: "Changed step" });

    // Start node should be unaffected
    const startNode = store.getState().nodes.find((n) => n.id === "s");
    expect(startNode?.data?.label).toBe("Start");

    // End node should be unaffected
    const endNode = store.getState().nodes.find((n) => n.id === "e");
    expect(endNode?.data?.label).toBe("End");
  });
});

// ── Regression: updateEdgeWhen field preservation ─────────────────────────────

describe("REG-M2-02-02: updateEdgeWhen must not drop edge source/target", () => {
  it("REG-M2-02-02a: after updateEdgeWhen, edge source and target are unchanged", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateEdgeWhen("e2", "failure");

    const edge = store.getState().edges.find((e) => e.id === "e2");
    expect(edge?.source).toBe("step1");
    expect(edge?.target).toBe("e");
    expect(edge?.data?.when).toBe("failure");
  });

  it("REG-M2-02-02b: changing when from always → success → failure round-trips correctly", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateEdgeWhen("e1", "success");
    expect(store.getState().edges.find((e) => e.id === "e1")?.data?.when).toBe(
      "success",
    );

    store.getState().updateEdgeWhen("e1", "always");
    expect(store.getState().edges.find((e) => e.id === "e1")?.data?.when).toBe(
      "always",
    );
  });
});

// ── Regression: nodeErrorsById global error isolation ─────────────────────────

describe("REG-M2-02-03: nodeErrorsById excludes global (non-node) errors", () => {
  it("REG-M2-02-03a: no_start error must not appear in nodeErrorsById", () => {
    const defNoStart: LoopDefinition = {
      nodes: [{ id: "e", kind: "end", label: "End", position: { x: 0, y: 0 } }],
      edges: [],
    };
    const result = validateLoopDefinition(defNoStart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hasNoStart = result.errors.some((e) => e.rule === "no_start");
      expect(hasNoStart).toBe(true);

      const byId = nodeErrorsById(result.errors);
      // no_start has no nodeId → should not appear under any key
      const noStartInById = Object.values(byId)
        .flat()
        .some((e) => e.rule === "no_start");
      expect(noStartInById).toBe(false);
    }
  });

  it("REG-M2-02-03b: end_unreachable error must not appear in nodeErrorsById", () => {
    // Create a graph where end is not reachable from start
    const defUnreachable: LoopDefinition = {
      nodes: [
        { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "orphan",
          kind: "end",
          label: "Orphan",
          position: { x: 200, y: 0 },
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      // s has no outgoing edge → end_unreachable fires (and no_outgoing_edge for s)
      edges: [],
    };
    const result = validateLoopDefinition(defUnreachable);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const byId = nodeErrorsById(result.errors);
      // end_unreachable has no nodeId → must not appear in any node's error list
      const unreachableInById = Object.values(byId)
        .flat()
        .some((e) => e.rule === "end_unreachable");
      expect(unreachableInById).toBe(false);
    }
  });

  it("REG-M2-02-03c: duplicate_when error must not appear in nodeErrorsById", () => {
    // duplicate_when has sourceNodeId (not nodeId) — should not appear
    const defDuplicateWhen: LoopDefinition = {
      nodes: [
        { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
        { id: "e1", kind: "end", label: "End1", position: { x: 200, y: 0 } },
        { id: "e2", kind: "end", label: "End2", position: { x: 300, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "e1", when: "always" },
        { id: "ed2", source: "s", target: "e2", when: "always" }, // duplicate when
      ],
    };
    const result = validateLoopDefinition(defDuplicateWhen);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hasDuplicateWhen = result.errors.some(
        (e) => e.rule === "duplicate_when",
      );
      expect(hasDuplicateWhen).toBe(true);

      const byId = nodeErrorsById(result.errors);
      const duplicateWhenInById = Object.values(byId)
        .flat()
        .some((e) => e.rule === "duplicate_when");
      expect(duplicateWhenInById).toBe(false);
    }
  });
});

// ── Regression: clampGuardrailField identity ──────────────────────────────────

describe("REG-M2-02-04: clampGuardrailField identity for values under ceiling", () => {
  it("REG-M2-02-04a: 1 is always within all ceilings", () => {
    expect(clampGuardrailField("maxStepsPerRun", 1)).toBe(1);
    expect(clampGuardrailField("maxIterations", 1)).toBe(1);
    expect(clampGuardrailField("stepTimeoutMs", 1)).toBe(1);
    expect(clampGuardrailField("maxRunDurationMs", 1)).toBe(1);
  });

  it("REG-M2-02-04b: GUARDRAIL_DEFAULTS are below ceilings so clamp returns them unchanged", () => {
    expect(
      clampGuardrailField("maxStepsPerRun", GUARDRAIL_DEFAULTS.maxStepsPerRun),
    ).toBe(GUARDRAIL_DEFAULTS.maxStepsPerRun);
    expect(
      clampGuardrailField("maxIterations", GUARDRAIL_DEFAULTS.maxIterations),
    ).toBe(GUARDRAIL_DEFAULTS.maxIterations);
    expect(
      clampGuardrailField("stepTimeoutMs", GUARDRAIL_DEFAULTS.stepTimeoutMs),
    ).toBe(GUARDRAIL_DEFAULTS.stepTimeoutMs);
  });

  it("REG-M2-02-04c: value exactly at ceiling returns ceiling", () => {
    expect(
      clampGuardrailField("maxStepsPerRun", GUARDRAIL_CEILINGS.maxStepsPerRun),
    ).toBe(GUARDRAIL_CEILINGS.maxStepsPerRun);
  });
});

// ── Regression: validateLoopSettings error shape ───────────────────────────────

describe("REG-M2-02-05: validateLoopSettings error shape", () => {
  it("REG-M2-02-05a: field errors have { field, message } shape", () => {
    const result = validateLoopSettings({ name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      const err = result.errors[0]!;
      expect(typeof err.field).toBe("string");
      expect(typeof err.message).toBe("string");
      expect(err.field.length).toBeGreaterThan(0);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it("REG-M2-02-05b: guardrail ceiling errors carry the field path with 'guardrails.' prefix", () => {
    const result = validateLoopSettings({
      name: "Test",
      guardrails: { maxStepsPerRun: GUARDRAIL_CEILINGS.maxStepsPerRun + 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.field.startsWith("guardrails."));
      expect(err).toBeDefined();
      expect(err?.field).toBe("guardrails.maxStepsPerRun");
    }
  });
});

// ── Regression: conditionValueVisible/Type cross-check ────────────────────────

describe("REG-M2-02-06: conditionValueVisible / conditionValueType exhaustive agreement", () => {
  // exists should be hidden and text (though hidden means type is irrelevant)
  it("REG-M2-02-06a: exists → hidden + text type", () => {
    expect(conditionValueVisible("exists")).toBe(false);
    expect(conditionValueType("exists")).toBe("text");
  });

  // All numeric ops should be visible + number type
  const numericOps = ["gt", "gte", "lt", "lte"] as const;
  for (const op of numericOps) {
    it(`REG-M2-02-06b: ${op} → visible + number type`, () => {
      expect(conditionValueVisible(op)).toBe(true);
      expect(conditionValueType(op)).toBe("number");
    });
  }

  // All text ops should be visible + text type
  const textOps = ["eq", "neq", "contains"] as const;
  for (const op of textOps) {
    it(`REG-M2-02-06c: ${op} → visible + text type`, () => {
      expect(conditionValueVisible(op)).toBe(true);
      expect(conditionValueType(op)).toBe("text");
    });
  }
});

// ── Regression: store dirty tracking after updateNodeConfig ──────────────────

describe("REG-M2-02-07: markClean resets dirty after updateNodeConfig", () => {
  it("REG-M2-02-07a: markClean works after updateNodeConfig has dirtied the store", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateNodeConfig("step1", { label: "X" });
    expect(store.getState().isDirty).toBe(true);

    store.getState().markClean();
    expect(store.getState().isDirty).toBe(false);
  });

  it("REG-M2-02-07b: markClean works after updateEdgeWhen has dirtied the store", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateEdgeWhen("e2", "always");
    expect(store.getState().isDirty).toBe(true);

    store.getState().markClean();
    expect(store.getState().isDirty).toBe(false);
  });
});
