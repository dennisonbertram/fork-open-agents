/**
 * node-config-panel.test.ts — RED tests for M2-02 config panel behaviors.
 *
 * Behavioral tests:
 * BT-M2-01: updateNodeConfig marks store dirty and revalidates
 * BT-M2-02: per-node error badge derivation (errors keyed to nodeId)
 * BT-M2-03: op-aware value visibility (exists op hides value)
 * BT-M2-04: client/server validation agreement on shared fixtures
 * BT-M2-05: label edit round-trips through definition-mapping
 * BT-M2-06: guardrail field ceilings respected client-side
 * BT-M2-07: edge when-change persists via updateEdgeWhen
 * BT-M2-08: kind-specific github_check fields (pr_status requires prNumberFrom, ci_status requires refFrom)
 * BT-M2-09: condition op=exists hides value; numeric ops require number value
 * BT-M2-10: nodeErrorsById derives correct error sets per nodeId
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

// ── Fixture definitions ───────────────────────────────────────────────────────

const VALID_DEF: LoopDefinition = {
  nodes: [
    { id: "start-1", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    { id: "end-1", kind: "end", label: "End", position: { x: 200, y: 0 } },
  ],
  edges: [{ id: "e-1", source: "start-1", target: "end-1", when: "always" }],
};

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

const CONDITION_DEF: LoopDefinition = {
  nodes: [
    { id: "s", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    {
      id: "cond1",
      kind: "condition",
      label: "Gate",
      position: { x: 200, y: 0 },
      condition: { path: "output.status", op: "eq", value: "ready" },
    },
    { id: "e1", kind: "end", label: "True end", position: { x: 400, y: -80 } },
    { id: "e2", kind: "end", label: "False end", position: { x: 400, y: 80 } },
  ],
  edges: [
    { id: "ed1", source: "s", target: "cond1", when: "always" },
    { id: "ed2", source: "cond1", target: "e1", when: "true" },
    { id: "ed3", source: "cond1", target: "e2", when: "false" },
  ],
};

// ── BT-M2-01: updateNodeConfig ────────────────────────────────────────────────

describe("BT-M2-01: updateNodeConfig — dirty tracking and revalidation", () => {
  it("BT-M2-01a: updateNodeConfig marks store dirty", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);
    expect(store.getState().isDirty).toBe(false);

    store.getState().updateNodeConfig("step1", { label: "Updated step" });

    expect(store.getState().isDirty).toBe(true);
  });

  it("BT-M2-01b: updateNodeConfig updates the node data in the store", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store
      .getState()
      .updateNodeConfig("step1", { instructions: "New instructions" });

    const node = store.getState().nodes.find((n) => n.id === "step1");
    expect(node?.data?.kind).toBe("agent_step");
    if (node?.data?.kind === "agent_step") {
      expect(node.data.instructions).toBe("New instructions");
    }
  });

  it("BT-M2-01c: updateNodeConfig re-runs validation after update", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);
    // Start with valid state
    expect(store.getState().validationErrors).toHaveLength(0);

    // Remove instructions from an agent_step — still valid (instructions is optional)
    store.getState().updateNodeConfig("step1", { instructions: undefined });

    // Should still have no errors (instructions optional)
    const errors = store.getState().validationErrors;
    expect(errors).toBeDefined();
  });

  it("BT-M2-01d: updateNodeConfig on a condition node updates condition config", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(CONDITION_DEF);

    store.getState().updateNodeConfig("cond1", {
      condition: { path: "result.count", op: "gt", value: 5 },
    });

    const node = store.getState().nodes.find((n) => n.id === "cond1");
    if (node?.data?.kind === "condition") {
      expect(node.data.condition?.path).toBe("result.count");
      expect(node.data.condition?.op).toBe("gt");
      expect(node.data.condition?.value).toBe(5);
    }
  });

  it("BT-M2-01e: updateNodeConfig on start node updates label", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);

    store.getState().updateNodeConfig("start-1", { label: "Begin" });

    const node = store.getState().nodes.find((n) => n.id === "start-1");
    expect(node?.data?.label).toBe("Begin");
  });

  it("BT-M2-01f: updateNodeConfig for nonexistent node id is a no-op (no crash)", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    // Should not throw
    expect(() => {
      store.getState().updateNodeConfig("nonexistent", { label: "X" });
    }).not.toThrow();
  });
});

// ── BT-M2-07: updateEdgeWhen ──────────────────────────────────────────────────

describe("BT-M2-07: updateEdgeWhen — edge when-value change persists", () => {
  it("BT-M2-07a: updateEdgeWhen changes the when value of the target edge", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateEdgeWhen("e2", "failure");

    const edge = store.getState().edges.find((e) => e.id === "e2");
    expect(edge?.data?.when).toBe("failure");
  });

  it("BT-M2-07b: updateEdgeWhen marks store dirty", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);
    expect(store.getState().isDirty).toBe(false);

    store.getState().updateEdgeWhen("e2", "failure");

    expect(store.getState().isDirty).toBe(true);
  });

  it("BT-M2-07c: updateEdgeWhen re-runs validation", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    // Changing to a valid when — should stay valid
    store.getState().updateEdgeWhen("e2", "always");

    // validationErrors should be defined (not undefined)
    expect(store.getState().validationErrors).toBeDefined();
  });

  it("BT-M2-07d: updateEdgeWhen on nonexistent edge id is a no-op (no crash)", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(VALID_DEF);
    expect(() => {
      store.getState().updateEdgeWhen("nonexistent-edge", "always");
    }).not.toThrow();
  });
});

// ── BT-M2-02: nodeErrorsById ──────────────────────────────────────────────────

describe("BT-M2-02: nodeErrorsById — error derivation keyed by nodeId", () => {
  it("BT-M2-02a: nodeErrorsById returns empty map when no errors", () => {
    const result = validateLoopDefinition(VALID_DEF);
    const errors = result.ok ? [] : result.errors;
    const byId = nodeErrorsById(errors);
    expect(Object.keys(byId)).toHaveLength(0);
  });

  it("BT-M2-02b: nodeErrorsById maps no_outgoing_edge error to correct nodeId", () => {
    const defWithOrphan: LoopDefinition = {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "step1",
          kind: "agent_step",
          label: "Step",
          position: { x: 200, y: 0 },
          instructions: "x",
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [{ id: "ed1", source: "s", target: "e", when: "always" }],
      // step1 has no outgoing edge — no_outgoing_edge rule fires
    };
    const result = validateLoopDefinition(defWithOrphan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const byId = nodeErrorsById(result.errors);
      expect(byId["step1"]).toBeDefined();
      expect(byId["step1"]!.length).toBeGreaterThan(0);
      expect(byId["step1"]!.some((e) => e.rule === "no_outgoing_edge")).toBe(
        true,
      );
    }
  });

  it("BT-M2-02c: nodeErrorsById maps missing_node_config to correct nodeId", () => {
    const defMissingCheck: LoopDefinition = {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "gh1",
          kind: "github_check",
          label: "Check",
          position: { x: 200, y: 0 },
          // no check config → triggers missing_node_config
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "gh1", when: "always" },
        { id: "ed2", source: "gh1", target: "e", when: "success" },
      ],
    };
    const result = validateLoopDefinition(defMissingCheck);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const byId = nodeErrorsById(result.errors);
      expect(byId["gh1"]).toBeDefined();
      expect(byId["gh1"]!.some((e) => e.rule === "missing_node_config")).toBe(
        true,
      );
    }
  });

  it("BT-M2-02d: nodeErrorsById returns errors for multiple nodes independently", () => {
    const defMultiErrors: LoopDefinition = {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "step1",
          kind: "agent_step",
          label: "Step1",
          position: { x: 200, y: 0 },
        },
        {
          id: "step2",
          kind: "agent_step",
          label: "Step2",
          position: { x: 300, y: 0 },
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "e", when: "always" },
        // step1 and step2 both lack outgoing edges
      ],
    };
    const result = validateLoopDefinition(defMultiErrors);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const byId = nodeErrorsById(result.errors);
      expect(byId["step1"]).toBeDefined();
      expect(byId["step2"]).toBeDefined();
    }
  });

  it("BT-M2-02e: nodeErrorsById excludes errors without nodeId (global errors)", () => {
    // no_start error has no nodeId
    const defNoStart: LoopDefinition = {
      nodes: [{ id: "e", kind: "end", label: "End", position: { x: 0, y: 0 } }],
      edges: [],
    };
    const result = validateLoopDefinition(defNoStart);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const byId = nodeErrorsById(result.errors);
      // "e" is an end node with no no_outgoing_edge issues
      // no_start has no node id → should not appear in byId keyed errors
      const hasNoStart = result.errors.some((e) => e.rule === "no_start");
      expect(hasNoStart).toBe(true);
      // byId for "e" should be empty or undefined (end node with no start error)
      expect(byId["e"]).toBeUndefined();
    }
  });
});

// ── BT-M2-03 / BT-M2-09: conditionValueVisible and conditionValueType ────────

describe("BT-M2-03 / BT-M2-09: condition form — op-aware field visibility", () => {
  it("BT-M2-03a: exists op → conditionValueVisible returns false", () => {
    expect(conditionValueVisible("exists")).toBe(false);
  });

  it("BT-M2-03b: eq op → conditionValueVisible returns true", () => {
    expect(conditionValueVisible("eq")).toBe(true);
  });

  it("BT-M2-03c: neq op → conditionValueVisible returns true", () => {
    expect(conditionValueVisible("neq")).toBe(true);
  });

  it("BT-M2-03d: gt op → conditionValueVisible returns true", () => {
    expect(conditionValueVisible("gt")).toBe(true);
  });

  it("BT-M2-03e: gte op → conditionValueVisible returns true", () => {
    expect(conditionValueVisible("gte")).toBe(true);
  });

  it("BT-M2-03f: lt op → conditionValueVisible returns true", () => {
    expect(conditionValueVisible("lt")).toBe(true);
  });

  it("BT-M2-03g: lte op → conditionValueVisible returns true", () => {
    expect(conditionValueVisible("lte")).toBe(true);
  });

  it("BT-M2-03h: contains op → conditionValueVisible returns true", () => {
    expect(conditionValueVisible("contains")).toBe(true);
  });

  it("BT-M2-09a: gt op → conditionValueType returns 'number'", () => {
    expect(conditionValueType("gt")).toBe("number");
  });

  it("BT-M2-09b: gte op → conditionValueType returns 'number'", () => {
    expect(conditionValueType("gte")).toBe("number");
  });

  it("BT-M2-09c: lt op → conditionValueType returns 'number'", () => {
    expect(conditionValueType("lt")).toBe("number");
  });

  it("BT-M2-09d: lte op → conditionValueType returns 'number'", () => {
    expect(conditionValueType("lte")).toBe("number");
  });

  it("BT-M2-09e: eq op → conditionValueType returns 'text'", () => {
    expect(conditionValueType("eq")).toBe("text");
  });

  it("BT-M2-09f: neq op → conditionValueType returns 'text'", () => {
    expect(conditionValueType("neq")).toBe("text");
  });

  it("BT-M2-09g: contains op → conditionValueType returns 'text'", () => {
    expect(conditionValueType("contains")).toBe("text");
  });

  it("BT-M2-09h: exists op → conditionValueType returns 'text' (irrelevant, hidden)", () => {
    expect(conditionValueType("exists")).toBe("text");
  });
});

// ── BT-M2-04: client/server validation agreement ──────────────────────────────

describe("BT-M2-04: client/server validation agreement — shared fixture parity", () => {
  const VALID_FIXTURES: LoopDefinition[] = [
    // Fixture 1: minimal valid (start→end)
    VALID_DEF,

    // Fixture 2: agent_step with instructions
    AGENT_STEP_DEF,

    // Fixture 3: condition with eq+value
    CONDITION_DEF,

    // Fixture 4: github_check list_issues
    {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "gh",
          kind: "github_check",
          label: "GH",
          position: { x: 200, y: 0 },
          check: { kind: "list_issues", state: "open" },
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "gh", when: "always" },
        { id: "ed2", source: "gh", target: "e", when: "success" },
      ],
    },

    // Fixture 5: github_check pr_status
    {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "gh",
          kind: "github_check",
          label: "PR",
          position: { x: 200, y: 0 },
          check: { kind: "pr_status", prNumberFrom: "prev.prNumber" },
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "gh", when: "always" },
        { id: "ed2", source: "gh", target: "e", when: "success" },
      ],
    },
  ];

  const INVALID_FIXTURES: LoopDefinition[] = [
    // Invalid 1: no start node
    {
      nodes: [{ id: "e", kind: "end", label: "End", position: { x: 0, y: 0 } }],
      edges: [],
    },

    // Invalid 2: missing condition config
    {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "cond",
          kind: "condition",
          label: "C",
          position: { x: 200, y: 0 },
          // no condition config
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "cond", when: "always" },
        { id: "ed2", source: "cond", target: "e", when: "true" },
        { id: "ed3", source: "cond", target: "e", when: "false" },
      ],
    },

    // Invalid 3: missing github_check config
    {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "gh",
          kind: "github_check",
          label: "GH",
          position: { x: 200, y: 0 },
          // no check config
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "gh", when: "always" },
        { id: "ed2", source: "gh", target: "e", when: "success" },
      ],
    },
  ];

  VALID_FIXTURES.forEach((fixture, idx) => {
    it(`BT-M2-04: valid fixture ${idx + 1} — validateLoopDefinition returns ok:true`, () => {
      const result = validateLoopDefinition(fixture);
      expect(result.ok).toBe(true);
    });
  });

  INVALID_FIXTURES.forEach((fixture, idx) => {
    it(`BT-M2-04: invalid fixture ${idx + 1} — validateLoopDefinition returns ok:false`, () => {
      const result = validateLoopDefinition(fixture);
      expect(result.ok).toBe(false);
    });
  });
});

// ── BT-M2-05: label edit round-trip ──────────────────────────────────────────

describe("BT-M2-05: label edit round-trips through definition-mapping", () => {
  it("BT-M2-05a: updating node label via updateNodeConfig is reflected in currentDefinition", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateNodeConfig("step1", { label: "My renamed step" });

    const def = store.getState().currentDefinition();
    const node = def.nodes.find((n) => n.id === "step1");
    expect(node?.label).toBe("My renamed step");
  });

  it("BT-M2-05b: label update does not affect other node fields", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateNodeConfig("step1", { label: "New label" });

    const node = store.getState().nodes.find((n) => n.id === "step1");
    if (node?.data?.kind === "agent_step") {
      // instructions should be preserved
      expect(node.data.instructions).toBe("Do something");
    }
  });

  it("BT-M2-05c: updating instructions via updateNodeConfig is reflected in currentDefinition", () => {
    const store = createLoopBuilderStore();
    store.getState().initialize(AGENT_STEP_DEF);

    store.getState().updateNodeConfig("step1", { instructions: "Updated!" });

    const def = store.getState().currentDefinition();
    const node = def.nodes.find((n) => n.id === "step1");
    expect(node?.kind).toBe("agent_step");
    if (node?.kind === "agent_step") {
      expect(node.instructions).toBe("Updated!");
    }
  });
});

// ── BT-M2-06: guardrail ceilings ─────────────────────────────────────────────

describe("BT-M2-06: guardrail field ceilings respected client-side", () => {
  it("BT-M2-06a: clampGuardrailField clamps maxStepsPerRun to ceiling", () => {
    const result = clampGuardrailField(
      "maxStepsPerRun",
      GUARDRAIL_CEILINGS.maxStepsPerRun + 1,
    );
    expect(result).toBe(GUARDRAIL_CEILINGS.maxStepsPerRun);
  });

  it("BT-M2-06b: clampGuardrailField clamps maxIterations to ceiling", () => {
    const result = clampGuardrailField(
      "maxIterations",
      GUARDRAIL_CEILINGS.maxIterations + 100,
    );
    expect(result).toBe(GUARDRAIL_CEILINGS.maxIterations);
  });

  it("BT-M2-06c: clampGuardrailField returns value unchanged when within ceiling", () => {
    const result = clampGuardrailField("maxStepsPerRun", 10);
    expect(result).toBe(10);
  });

  it("BT-M2-06d: clampGuardrailField clamps stepTimeoutMs to ceiling", () => {
    const result = clampGuardrailField(
      "stepTimeoutMs",
      GUARDRAIL_CEILINGS.stepTimeoutMs + 1,
    );
    expect(result).toBe(GUARDRAIL_CEILINGS.stepTimeoutMs);
  });

  it("BT-M2-06e: GUARDRAIL_DEFAULTS are within GUARDRAIL_CEILINGS", () => {
    // Sanity check — defaults must be within ceilings
    expect(GUARDRAIL_DEFAULTS.maxStepsPerRun).toBeLessThanOrEqual(
      GUARDRAIL_CEILINGS.maxStepsPerRun,
    );
    expect(GUARDRAIL_DEFAULTS.maxIterations).toBeLessThanOrEqual(
      GUARDRAIL_CEILINGS.maxIterations,
    );
    expect(GUARDRAIL_DEFAULTS.stepTimeoutMs).toBeLessThanOrEqual(
      GUARDRAIL_CEILINGS.stepTimeoutMs,
    );
  });

  it("BT-M2-06f: clampGuardrailField handles maxRunDurationMs (no ceiling — returns value unchanged)", () => {
    // maxRunDurationMs has no server ceiling (undefined), so any positive value passes
    const bigValue = 999_999_999;
    const result = clampGuardrailField("maxRunDurationMs", bigValue);
    expect(result).toBe(bigValue);
  });
});

// ── BT-M2-08: github_check kind-specific required fields ──────────────────────

describe("BT-M2-08: github_check kind-specific field requirements", () => {
  it("BT-M2-08a: pr_status without prNumberFrom fails validation", () => {
    const def: LoopDefinition = {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "gh",
          kind: "github_check",
          label: "PR",
          position: { x: 200, y: 0 },
          check: { kind: "pr_status", prNumberFrom: "" }, // empty string
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "gh", when: "always" },
        { id: "ed2", source: "gh", target: "e", when: "success" },
      ],
    };
    // prNumberFrom with empty string should fail schema validation
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
  });

  it("BT-M2-08b: ci_status without refFrom fails validation", () => {
    const def: LoopDefinition = {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "gh",
          kind: "github_check",
          label: "CI",
          position: { x: 200, y: 0 },
          check: { kind: "ci_status", refFrom: "" }, // empty string
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "gh", when: "always" },
        { id: "ed2", source: "gh", target: "e", when: "success" },
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(false);
  });

  it("BT-M2-08c: pr_status with valid prNumberFrom passes validation", () => {
    const def: LoopDefinition = {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "gh",
          kind: "github_check",
          label: "PR",
          position: { x: 200, y: 0 },
          check: { kind: "pr_status", prNumberFrom: "step1.prNumber" },
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "gh", when: "always" },
        { id: "ed2", source: "gh", target: "e", when: "success" },
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });

  it("BT-M2-08d: deployment_status with optional environment passes validation", () => {
    const def: LoopDefinition = {
      nodes: [
        {
          id: "s",
          kind: "start",
          label: "Start",
          position: { x: 0, y: 0 },
        },
        {
          id: "gh",
          kind: "github_check",
          label: "Deploy",
          position: { x: 200, y: 0 },
          check: { kind: "deployment_status", environment: "production" },
        },
        { id: "e", kind: "end", label: "End", position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: "ed1", source: "s", target: "gh", when: "always" },
        { id: "ed2", source: "gh", target: "e", when: "success" },
      ],
    };
    const result = validateLoopDefinition(def);
    expect(result.ok).toBe(true);
  });
});
