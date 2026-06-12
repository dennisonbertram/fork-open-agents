/**
 * definition-parity.test.ts — Builder/JSON parity suite (M2-04)
 *
 * For every fixture in the shared corpus:
 *   (a) Server validateLoopDefinition verdict matches expected (ok/not-ok)
 *   (b) Builder round-trip (definitionToFlow → flowToDefinition) is deep-equal
 *       for valid fixtures
 *   (c) Double round-trip is byte-stable (JSON.stringify idempotent)
 *   (d) Valid/invalid verdicts agree across server validation and builder store
 *       validation (validateLoopDefinition called by use-loop-builder store)
 *
 * The canonical serializer (flowToDefinition) lives in definition-mapping.ts
 * and is the single source of truth for builder → JSON conversion. The builder
 * store's currentDefinition() calls flowToDefinition directly, so there is no
 * separate per-surface serializer to drift.
 *
 * Extension mandate: see apps/web/lib/agent-loops/fixtures/index.ts header.
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
import type { LoopDefinition } from "@/lib/agent-loops/types";

// ── A: Server validation verdicts ────────────────────────────────────────────

describe("A — server validateLoopDefinition: VALID fixtures → ok:true", () => {
  for (const fixture of VALID_FIXTURES) {
    it(`${fixture.id} — ${fixture.intent}`, () => {
      const result = validateLoopDefinition(fixture.definition);
      expect(result.ok).toBe(true);
    });
  }
});

describe("A — server validateLoopDefinition: INVALID fixtures → ok:false with expected rule", () => {
  for (const fixture of INVALID_FIXTURES) {
    it(`${fixture.id} rule=${fixture.rule} — ${fixture.intent}`, () => {
      const result = validateLoopDefinition(fixture.definition);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const rules = result.errors.map((e) => e.rule);
        expect(rules).toContain(fixture.rule);
      }
    });
  }
});

// ── B: Builder round-trip (valid fixtures only) ───────────────────────────────

describe("B — definitionToFlow → flowToDefinition round-trip (valid fixtures)", () => {
  for (const fixture of VALID_FIXTURES) {
    it(`${fixture.id} — round-trip is deep-equal`, () => {
      const { nodes, edges } = definitionToFlow(fixture.definition);
      const result = flowToDefinition(nodes, edges);
      expect(result).toEqual(fixture.definition);
    });
  }
});

// ── C: Double round-trip byte-stability (valid fixtures) ──────────────────────

describe("C — double round-trip byte-stability (JSON.stringify idempotent)", () => {
  for (const fixture of VALID_FIXTURES) {
    it(`${fixture.id} — JSON.stringify stable after two round-trips`, () => {
      const { nodes: n1, edges: e1 } = definitionToFlow(fixture.definition);
      const def1 = flowToDefinition(n1, e1);
      const { nodes: n2, edges: e2 } = definitionToFlow(def1);
      const def2 = flowToDefinition(n2, e2);
      // First round-trip matches original
      expect(JSON.stringify(def1)).toBe(JSON.stringify(fixture.definition));
      // Second round-trip matches first (idempotent)
      expect(JSON.stringify(def2)).toBe(JSON.stringify(def1));
    });
  }
});

// ── D: Builder store verdict agrees with server validation ────────────────────

describe("D — builder store validation agrees with server validateLoopDefinition (VALID)", () => {
  for (const fixture of VALID_FIXTURES) {
    it(`${fixture.id} — store has no validation errors after initialize`, () => {
      const store = createLoopBuilderStore();
      store.getState().initialize(fixture.definition);
      const storeErrors = store.getState().validationErrors;
      const serverResult = validateLoopDefinition(fixture.definition);
      // Both must agree: server says ok, store must have zero errors
      expect(serverResult.ok).toBe(true);
      expect(storeErrors).toHaveLength(0);
    });
  }
});

// ── E: Canonical serializer is the single source (builder save path) ──────────
//
// The builder's "save" path calls store.getState().currentDefinition(),
// which calls flowToDefinition(nodes, edges) from definition-mapping.ts.
// This test asserts that the store's currentDefinition() and a direct
// flowToDefinition() call produce identical output — proving there is
// no second serializer that could drift.

describe("E — canonical serializer: store.currentDefinition() === flowToDefinition(nodes,edges)", () => {
  for (const fixture of VALID_FIXTURES) {
    it(`${fixture.id} — store.currentDefinition matches direct flowToDefinition`, () => {
      const store = createLoopBuilderStore();
      store.getState().initialize(fixture.definition);
      const storeNodes = store.getState().nodes;
      const storeEdges = store.getState().edges;

      const viaStore = store.getState().currentDefinition();
      const viaDirect = flowToDefinition(storeNodes, storeEdges);

      expect(JSON.stringify(viaStore)).toBe(JSON.stringify(viaDirect));
    });
  }
});

// ── F: Cross-surface agreement — valid definition authored in builder ──────────
//
// A definition round-tripped through the builder store (initialize → mutate
// no-op → currentDefinition) must produce a result that server validation
// also accepts. Verifies no surface introduces structural corruption.

describe("F — cross-surface: builder-produced definition passes server validation", () => {
  for (const fixture of VALID_FIXTURES) {
    it(`${fixture.id} — server accepts definition produced by builder store`, () => {
      const store = createLoopBuilderStore();
      store.getState().initialize(fixture.definition);
      const definition = store.getState().currentDefinition() as LoopDefinition;
      const serverResult = validateLoopDefinition(definition);
      expect(serverResult.ok).toBe(true);
    });
  }
});

// ── G: parallelIndex/parallelCount do NOT survive round-trip into definition ───
//
// These are ADD-ONLY display fields on flow edges; flowToDefinition must NOT
// persist them into the LoopEdge output. The definition must contain only
// the four canonical fields: id, source, target, when.

describe("G — parallelIndex / parallelCount are NOT serialized into LoopEdge", () => {
  it("edges in flowToDefinition output have exactly {id,source,target,when} — no parallel fields", () => {
    // Use a fixture with multiple edges to trigger parallelIndex computation
    const fixture = VALID_FIXTURES.find((f) => f.id === "V-23-parallel-edges");
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const { nodes, edges } = definitionToFlow(fixture.definition);
    // Verify parallelIndex IS set on flow edges
    const hasParallel = edges.some((e) => e.data?.parallelIndex !== undefined);
    expect(hasParallel).toBe(true);

    // Verify it is NOT in the definition
    const definition = flowToDefinition(nodes, edges);
    for (const edge of definition.edges) {
      const edgeAsRecord = edge as Record<string, unknown>;
      expect(edgeAsRecord["parallelIndex"]).toBeUndefined();
      expect(edgeAsRecord["parallelCount"]).toBeUndefined();
    }
  });
});

// ── H: Fixture corpus coverage assertion ──────────────────────────────────────
//
// Regression guard: the corpus must have at least one fixture per node kind
// and at least one invalid fixture per validation rule. This test catches
// corpus shrinkage if a refactor accidentally removes fixtures.

describe("H — fixture corpus coverage", () => {
  it("has at least one valid fixture per node kind", () => {
    const kinds = new Set<string>();
    for (const fixture of VALID_FIXTURES) {
      for (const node of fixture.definition.nodes) {
        const n = node as { kind: string };
        kinds.add(n.kind);
      }
    }
    expect(kinds).toContain("start");
    expect(kinds).toContain("agent_step");
    expect(kinds).toContain("github_check");
    expect(kinds).toContain("condition");
    expect(kinds).toContain("end");
  });

  it("has at least one valid fixture per edge when value (success, failure, always, true, false)", () => {
    const whens = new Set<string>();
    for (const fixture of VALID_FIXTURES) {
      for (const edge of fixture.definition.edges) {
        const e = edge as { when: string };
        whens.add(e.when);
      }
    }
    expect(whens).toContain("success");
    expect(whens).toContain("failure");
    expect(whens).toContain("always");
    expect(whens).toContain("true");
    expect(whens).toContain("false");
  });

  it("has at least one invalid fixture per VR rule", () => {
    const rules = new Set(INVALID_FIXTURES.map((f) => f.rule));
    // VR-01 produces two distinct rule names
    expect(rules).toContain("no_start");
    expect(rules).toContain("multiple_start");
    // VR-02
    expect(rules).toContain("no_end");
    // VR-03
    expect(rules).toContain("dangling_edge");
    // VR-04
    expect(rules).toContain("no_outgoing_edge");
    // VR-05
    expect(rules).toContain("missing_condition_edge");
    // VR-06
    expect(rules).toContain("invalid_when");
    // VR-07
    expect(rules).toContain("duplicate_when");
    // VR-08
    expect(rules).toContain("end_unreachable");
    // VR-10
    expect(rules).toContain("definition_too_large");
    // VR-11
    expect(rules).toContain("forbidden_node_id");
    // VR-12/VR-13
    expect(rules).toContain("missing_node_config");
    // VR-14
    expect(rules).toContain("missing_condition_value");
    // VR-15
    expect(rules).toContain("schema_error");
    // VR-17
    expect(rules).toContain("duplicate_node_id");
    // VR-18
    expect(rules).toContain("invalid_condition_edge");
  });

  it("has at least one fixture per github_check kind", () => {
    const ghKinds = new Set<string>();
    for (const fixture of VALID_FIXTURES) {
      for (const node of fixture.definition.nodes) {
        const n = node as { kind: string; check?: { kind: string } };
        if (n.kind === "github_check" && n.check) {
          ghKinds.add(n.check.kind);
        }
      }
    }
    expect(ghKinds).toContain("list_issues");
    expect(ghKinds).toContain("pr_status");
    expect(ghKinds).toContain("deployment_status");
    expect(ghKinds).toContain("ci_status");
  });

  it("has at least one fixture per condition op", () => {
    const ops = new Set<string>();
    for (const fixture of VALID_FIXTURES) {
      for (const node of fixture.definition.nodes) {
        const n = node as {
          kind: string;
          condition?: { op: string };
        };
        if (n.kind === "condition" && n.condition) {
          ops.add(n.condition.op);
        }
      }
    }
    expect(ops).toContain("eq");
    expect(ops).toContain("neq");
    expect(ops).toContain("gt");
    expect(ops).toContain("gte");
    expect(ops).toContain("lt");
    expect(ops).toContain("lte");
    expect(ops).toContain("exists");
    expect(ops).toContain("contains");
  });

  it("corpus has the expected minimum fixture counts", () => {
    // Guard against accidental shrinkage
    expect(VALID_FIXTURES.length).toBeGreaterThanOrEqual(25);
    expect(INVALID_FIXTURES.length).toBeGreaterThanOrEqual(18);
  });
});
