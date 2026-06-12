/**
 * definition-parity.regression.test.ts — Regression harness for M2-04
 *
 * These tests catch future breakage in:
 *   1. The canonical serializer (flowToDefinition) — if key order changes,
 *      byte-stable tests fail.
 *   2. The fixture corpus — if fixtures are accidentally removed.
 *   3. The round-trip contract — if a new field is added to a node kind
 *      but not handled in the switch in flowToDefinition.
 *   4. The store save path — if currentDefinition() is accidentally
 *      replaced with a different serializer.
 *   5. The invalid fixture rules — if validateLoopDefinition drops a rule.
 *
 * If the change in e7ef3136 (feat: TASK-333) is reverted, these tests fail
 * because the fixture corpus module would no longer exist.
 */

import { describe, expect, it } from "bun:test";
import {
  INVALID_FIXTURES,
  VALID_FIXTURES,
} from "@/lib/agent-loops/fixtures/index";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";
import {
  definitionToFlow,
  flowToDefinition,
} from "@/app/loops/[loopId]/builder/definition-mapping";
import { createLoopBuilderStore } from "@/app/loops/[loopId]/builder/use-loop-builder";

// ── REG-PAR-01: Fixture corpus is non-empty ───────────────────────────────────

describe("REG-PAR-01: fixture corpus non-empty (catches accidental corpus removal)", () => {
  it("VALID_FIXTURES is non-empty", () => {
    expect(VALID_FIXTURES.length).toBeGreaterThan(0);
  });

  it("INVALID_FIXTURES is non-empty", () => {
    expect(INVALID_FIXTURES.length).toBeGreaterThan(0);
  });

  it("fixture ids are unique (no duplicates within valid set)", () => {
    const ids = VALID_FIXTURES.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("fixture ids are unique (no duplicates within invalid set)", () => {
    const ids = INVALID_FIXTURES.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── REG-PAR-02: The ALL_NODE_KINDS fixture covers all 5 node kinds ─────────────

describe("REG-PAR-02: ALL_NODE_KINDS fixture (catches removal of a node kind from the corpus)", () => {
  it("ALL_NODE_KINDS fixture exists and round-trips all 5 node kinds", () => {
    const fixture = VALID_FIXTURES.find((f) => f.id === "V-22-all-node-kinds");
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const kinds = new Set(
      fixture.definition.nodes.map((n) => (n as { kind: string }).kind),
    );
    expect(kinds).toContain("start");
    expect(kinds).toContain("agent_step");
    expect(kinds).toContain("github_check");
    expect(kinds).toContain("condition");
    expect(kinds).toContain("end");

    const { nodes, edges } = definitionToFlow(fixture.definition);
    const result = flowToDefinition(nodes, edges);
    expect(JSON.stringify(result)).toBe(JSON.stringify(fixture.definition));
  });
});

// ── REG-PAR-03: flowToDefinition does not drop optional agent_step fields ──────
//
// If the switch in flowToDefinition is changed and agent_step loses its spread
// of optional fields, this test fails.

describe("REG-PAR-03: optional agent_step fields survive flowToDefinition", () => {
  it("instructions, outputSchema, checkCommand are preserved", () => {
    const fixture = VALID_FIXTURES.find((f) => f.id === "V-02-agent-step-full");
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const { nodes, edges } = definitionToFlow(fixture.definition);
    const result = flowToDefinition(nodes, edges);
    const step = result.nodes.find((n) => n.id === "step1");
    expect(step?.kind).toBe("agent_step");
    if (step?.kind === "agent_step") {
      expect(step.instructions).toBe(
        "Do useful work and output structured JSON.",
      );
      expect(step.checkCommand).toBe("bun test");
      expect(step.outputSchema).toEqual({
        type: "object",
        properties: { result: { type: "string" } },
      });
    }
  });
});

// ── REG-PAR-04: cycle fixture is accepted by server validation ────────────────
//
// VR-09 explicitly accepts cycles. If this rule changes or BFS logic breaks,
// this test catches it.

describe("REG-PAR-04: cycle fixtures pass server validation (VR-09 accepts cycles)", () => {
  it("self-loop condition cycle passes validateLoopDefinition", () => {
    const fixture = VALID_FIXTURES.find(
      (f) => f.id === "V-16-self-loop-condition",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const result = validateLoopDefinition(fixture.definition);
    expect(result.ok).toBe(true);
  });

  it("multi-hop cycle passes validateLoopDefinition", () => {
    const fixture = VALID_FIXTURES.find((f) => f.id === "V-17-multi-hop-cycle");
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const result = validateLoopDefinition(fixture.definition);
    expect(result.ok).toBe(true);
  });
});

// ── REG-PAR-05: invalid fixture VR-10 (size cap) is caught before Zod ─────────
//
// The size cap check (VR-10) runs before Zod for performance. If the ordering
// changes and Zod runs first on large definitions, rule name would be different.

describe("REG-PAR-05: VR-10 definition_too_large triggers before schema_error", () => {
  it("oversized definition returns definition_too_large rule (not schema_error)", () => {
    const fixture = INVALID_FIXTURES.find((f) => f.id === "I-VR-10-too-large");
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const result = validateLoopDefinition(fixture.definition);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const rules = result.errors.map((e) => e.rule);
      expect(rules).toContain("definition_too_large");
      expect(rules).not.toContain("schema_error");
    }
  });
});

// ── REG-PAR-06: currentDefinition() is backed by flowToDefinition ─────────────
//
// If the builder store's currentDefinition() is replaced with a different
// implementation, the byte-comparison against flowToDefinition will fail.

describe("REG-PAR-06: store.currentDefinition() is identical to flowToDefinition(nodes,edges)", () => {
  it("using the SELF_LOOP_CONDITION fixture to exercise cycle handling", () => {
    const fixture = VALID_FIXTURES.find(
      (f) => f.id === "V-16-self-loop-condition",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const store = createLoopBuilderStore();
    store.getState().initialize(fixture.definition);

    const viaStore = store.getState().currentDefinition();
    const viaDirect = flowToDefinition(
      store.getState().nodes,
      store.getState().edges,
    );
    expect(JSON.stringify(viaStore)).toBe(JSON.stringify(viaDirect));
  });
});

// ── REG-PAR-07: exists op condition needs no value (VR-14 exemption) ──────────
//
// If VALUE_EXEMPT_OPS set loses "exists", the V-14-condition-exists fixture
// would start failing. This regression test asserts the exemption is active.

describe("REG-PAR-07: exists op requires no value (VR-14 exemption)", () => {
  it("condition with op=exists and no value passes server validation", () => {
    const fixture = VALID_FIXTURES.find(
      (f) => f.id === "V-14-condition-exists",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const result = validateLoopDefinition(fixture.definition);
    expect(result.ok).toBe(true);
  });

  it("condition with op=eq and no value fails with missing_condition_value", () => {
    const fixture = INVALID_FIXTURES.find(
      (f) => f.id === "I-VR-14-condition-missing-value",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const result = validateLoopDefinition(fixture.definition);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.rule)).toContain(
        "missing_condition_value",
      );
    }
  });
});

// ── REG-PAR-08: parallelIndex not in LoopEdge (catches serializer regression) ──

describe("REG-PAR-08: parallelIndex/parallelCount never appear in LoopEdge output", () => {
  it("flowToDefinition strips parallel fields from all edges", () => {
    // Use a definition with parallel edges to ensure parallelIndex is computed
    const definition = VALID_FIXTURES.find(
      (f) => f.id === "V-22-all-node-kinds",
    )?.definition;
    expect(definition).toBeDefined();
    if (!definition) return;

    const { nodes, edges } = definitionToFlow(definition);
    const result = flowToDefinition(nodes, edges);

    for (const edge of result.edges) {
      const rec = edge as Record<string, unknown>;
      expect(rec["parallelIndex"]).toBeUndefined();
      expect(rec["parallelCount"]).toBeUndefined();
      // Only canonical fields should be present
      const keys = Object.keys(rec).sort();
      expect(keys).toEqual(["id", "source", "target", "when"].sort());
    }
  });
});
