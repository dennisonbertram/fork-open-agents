import { describe, expect, test } from "bun:test";

import {
  WorkflowCatalogError,
  type WorkflowDefinition,
  buildRegistry,
  lookupWorkflow,
  listWorkflows,
  SUPPORTED_PROOF_LEVELS,
  DEFAULT_CATALOG,
} from "./catalog";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const VALID_DEFINITION: WorkflowDefinition = {
  id: "test-workflow",
  version: "1.0.0",
  name: "Test Workflow",
  description: "A workflow used for testing",
  capabilities: ["code-execution"],
  proofLevel: "level-1",
  enabled: true,
};

// ── BT-001: Lookup by id returns the fully-typed definition ──────────────────

describe("lookupWorkflow", () => {
  test("BT-001: returns the definition for a known workflow id", () => {
    const registry = buildRegistry([VALID_DEFINITION]);
    const result = lookupWorkflow(registry, "test-workflow");
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    // Assert exact shape — not just truthy
    expect(result?.id).toBe("test-workflow");
    expect(result?.version).toBe("1.0.0");
    expect(result?.name).toBe("Test Workflow");
    expect(result?.proofLevel).toBe("level-1");
    expect(result?.enabled).toBe(true);
  });

  // BT-002: Unknown id returns typed not-found (undefined) — NOT a string
  test("BT-002: returns undefined for an unknown workflow id", () => {
    const registry = buildRegistry([VALID_DEFINITION]);
    const result = lookupWorkflow(registry, "does-not-exist");
    expect(result).toBeUndefined();
    // Must not be a string fallback like "not found"
    expect(typeof result).not.toBe("string");
  });
});

// ── BT-003: list() returns registered definitions respecting enabled flag ────

describe("listWorkflows", () => {
  test("BT-003a: returns all registered definitions when no filter is applied", () => {
    const definitions = [
      VALID_DEFINITION,
      { ...VALID_DEFINITION, id: "second-workflow", enabled: false },
    ];
    const registry = buildRegistry(definitions);
    const all = listWorkflows(registry);
    expect(all).toHaveLength(2);
  });

  test("BT-003b: when enabledOnly=true, returns only enabled definitions", () => {
    const definitions = [
      VALID_DEFINITION,
      { ...VALID_DEFINITION, id: "disabled-workflow", enabled: false },
    ];
    const registry = buildRegistry(definitions);
    const enabled = listWorkflows(registry, { enabledOnly: true });
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.id).toBe("test-workflow");
    // Verify the disabled one is absent
    const ids = enabled.map((d) => d.id);
    expect(ids).not.toContain("disabled-workflow");
  });

  test("BT-003c: returns an empty array when no workflows match the filter", () => {
    const disabled = { ...VALID_DEFINITION, enabled: false };
    const registry = buildRegistry([disabled]);
    const result = listWorkflows(registry, { enabledOnly: true });
    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── BT-004: Invalid definition is rejected with definition_invalid ───────────

describe("buildRegistry — validation", () => {
  test("BT-004a: rejects a definition missing the required id field", () => {
    const bad = { ...VALID_DEFINITION, id: "" };
    let thrown: unknown;
    try {
      buildRegistry([bad]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("definition_invalid");
  });

  test("BT-004b: rejects a definition missing the required name field", () => {
    const bad = { ...VALID_DEFINITION, name: "" };
    let thrown: unknown;
    try {
      buildRegistry([bad]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("definition_invalid");
  });

  // BT-005: Duplicate workflow id is rejected with duplicate_workflow_id
  test("BT-005: rejects a registry built with duplicate workflow ids", () => {
    const dupe = { ...VALID_DEFINITION }; // same id
    let thrown: unknown;
    try {
      buildRegistry([VALID_DEFINITION, dupe]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("duplicate_workflow_id");
    expect(err.message).toContain("test-workflow");
  });

  // BT-006: Unsupported proof level is rejected with unsupported_proof_level
  test("BT-006: rejects a definition with an unsupported proof level", () => {
    const bad = {
      ...VALID_DEFINITION,
      proofLevel: "level-99" as (typeof SUPPORTED_PROOF_LEVELS)[number],
    };
    let thrown: unknown;
    try {
      buildRegistry([bad as WorkflowDefinition]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("unsupported_proof_level");
  });

  // BT-007: Version validation — malformed version is rejected
  test("BT-007: rejects a definition with a malformed version string", () => {
    const bad = { ...VALID_DEFINITION, version: "not-a-version" };
    let thrown: unknown;
    try {
      buildRegistry([bad]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("definition_invalid");
  });

  test("BT-007b: accepts valid semver-ish versions (major.minor.patch)", () => {
    const valid = { ...VALID_DEFINITION, version: "2.3.4" };
    // Should NOT throw
    const registry = buildRegistry([valid]);
    const result = lookupWorkflow(registry, "test-workflow");
    expect(result?.version).toBe("2.3.4");
  });

  test("BT-007c: accepts versions with pre-release suffix (e.g. 1.0.0-beta.1)", () => {
    const valid = { ...VALID_DEFINITION, version: "1.0.0-beta.1" };
    const registry = buildRegistry([valid]);
    expect(lookupWorkflow(registry, "test-workflow")?.version).toBe(
      "1.0.0-beta.1",
    );
  });
});

// ── Proof level enum coverage ────────────────────────────────────────────────

describe("SUPPORTED_PROOF_LEVELS", () => {
  test("contains level-1, level-2, and level-3 as required by the proof standard", () => {
    expect(SUPPORTED_PROOF_LEVELS).toContain("level-1");
    expect(SUPPORTED_PROOF_LEVELS).toContain("level-2");
    expect(SUPPORTED_PROOF_LEVELS).toContain("level-3");
    expect(SUPPORTED_PROOF_LEVELS).toHaveLength(3);
  });
});

// ── Stub catalog entry ───────────────────────────────────────────────────────

describe("DEFAULT_CATALOG (stub entry)", () => {
  test("the stub catalog exports at least one entry and it is valid", async () => {
    const { DEFAULT_CATALOG } = await import("./catalog");
    expect(Array.isArray(DEFAULT_CATALOG)).toBe(true);
    // At least one stub entry is seeded per spec (AT MOST ONE)
    expect(DEFAULT_CATALOG.length).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_CATALOG.length).toBeLessThanOrEqual(1);
    const entry = DEFAULT_CATALOG[0];
    expect(entry).toBeDefined();
    expect(typeof entry?.id).toBe("string");
    expect(entry?.id.length).toBeGreaterThan(0);
  });

  test("the stub catalog entry is valid (buildRegistry does not throw)", async () => {
    // This is the integration check: the default catalog can be built successfully
    const { DEFAULT_CATALOG } = await import("./catalog");
    expect(() => buildRegistry(DEFAULT_CATALOG)).not.toThrow();
  });
});

// ── REGRESSION tests ─────────────────────────────────────────────────────────
// These tests catch regressions if the green implementation is reverted or
// broken. They cover angles not already exercised by the behavioral tests.

describe("regression: registry is immutable after construction", () => {
  test("REG-001: mutating the source array after buildRegistry does not affect the registry", () => {
    const defs = [VALID_DEFINITION];
    const registry = buildRegistry(defs);
    // Clear the source array — registry must remain intact
    defs.length = 0;
    const result = lookupWorkflow(registry, "test-workflow");
    expect(result?.id).toBe("test-workflow");
  });
});

describe("regression: error kinds are exact string literals", () => {
  test("REG-002: WorkflowCatalogError for empty id carries kind === 'definition_invalid'", () => {
    let err: WorkflowCatalogError | undefined;
    try {
      buildRegistry([{ ...VALID_DEFINITION, id: "" }]);
    } catch (e) {
      if (e instanceof WorkflowCatalogError) err = e;
    }
    // If this regresses (e.g. kind renamed), the strict equality fails
    expect(err?.kind).toBe("definition_invalid");
  });

  test("REG-003: duplicate id error kind is exactly 'duplicate_workflow_id'", () => {
    let err: WorkflowCatalogError | undefined;
    try {
      buildRegistry([VALID_DEFINITION, { ...VALID_DEFINITION }]);
    } catch (e) {
      if (e instanceof WorkflowCatalogError) err = e;
    }
    expect(err?.kind).toBe("duplicate_workflow_id");
  });

  test("REG-004: unsupported proof level kind is exactly 'unsupported_proof_level'", () => {
    let err: WorkflowCatalogError | undefined;
    try {
      buildRegistry([
        {
          ...VALID_DEFINITION,
          proofLevel: "level-0" as (typeof SUPPORTED_PROOF_LEVELS)[number],
        } as WorkflowDefinition,
      ]);
    } catch (e) {
      if (e instanceof WorkflowCatalogError) err = e;
    }
    expect(err?.kind).toBe("unsupported_proof_level");
  });
});

describe("regression: all three proof levels can be registered successfully", () => {
  test("REG-005: level-1, level-2, and level-3 are all accepted without error", () => {
    for (const level of SUPPORTED_PROOF_LEVELS) {
      const def = {
        ...VALID_DEFINITION,
        id: `workflow-${level}`,
        proofLevel: level,
      };
      expect(() => buildRegistry([def])).not.toThrow();
    }
  });
});

describe("regression: listWorkflows without options returns all entries", () => {
  test("REG-006: calling listWorkflows with no options does NOT silently filter disabled entries", () => {
    const disabled = {
      ...VALID_DEFINITION,
      id: "disabled-one",
      enabled: false,
    };
    const registry = buildRegistry([VALID_DEFINITION, disabled]);
    const all = listWorkflows(registry);
    // Both the enabled and disabled workflow must appear
    const ids = all.map((d) => d.id);
    expect(ids).toContain("test-workflow");
    expect(ids).toContain("disabled-one");
    expect(all).toHaveLength(2);
  });
});

describe("regression: empty capabilities array is valid", () => {
  test("REG-007: a workflow definition with an empty capabilities array is accepted", () => {
    const def = { ...VALID_DEFINITION, capabilities: [] };
    const registry = buildRegistry([def]);
    const result = lookupWorkflow(registry, "test-workflow");
    expect(result?.capabilities).toHaveLength(0);
  });
});

// ── FIX-1: typed-error contract — null/undefined/non-object → definition_invalid ──
// These tests were RED before the fix: null and undefined threw raw TypeError,
// and 42 / {} threw unsupported_proof_level instead of definition_invalid.

describe("FIX-1: buildRegistry rejects non-object entries with definition_invalid", () => {
  test("FIX1-001: null entry throws WorkflowCatalogError with kind definition_invalid", () => {
    let thrown: unknown;
    try {
      buildRegistry([null as unknown as WorkflowDefinition]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("definition_invalid");
  });

  test("FIX1-002: undefined entry throws WorkflowCatalogError with kind definition_invalid", () => {
    let thrown: unknown;
    try {
      buildRegistry([undefined as unknown as WorkflowDefinition]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("definition_invalid");
  });

  test("FIX1-003: primitive (number 42) entry throws WorkflowCatalogError with kind definition_invalid", () => {
    let thrown: unknown;
    try {
      buildRegistry([42 as unknown as WorkflowDefinition]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("definition_invalid");
  });

  test("FIX1-004: empty object {} entry throws WorkflowCatalogError with kind definition_invalid", () => {
    let thrown: unknown;
    try {
      buildRegistry([{} as unknown as WorkflowDefinition]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("definition_invalid");
  });

  test("FIX1-005: valid object with unrecognized proofLevel still yields unsupported_proof_level", () => {
    // An otherwise structurally complete definition but with an invalid proofLevel
    // should yield unsupported_proof_level (not definition_invalid)
    const bad = {
      ...VALID_DEFINITION,
      proofLevel: "level-99" as (typeof SUPPORTED_PROOF_LEVELS)[number],
    };
    let thrown: unknown;
    try {
      buildRegistry([bad as unknown as WorkflowDefinition]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WorkflowCatalogError);
    const err = thrown as WorkflowCatalogError;
    expect(err.kind).toBe("unsupported_proof_level");
  });
});

// ── FIX-2: true immutability — frozen definitions and protected map ────────────
// These tests were RED before the fix: callers could mutate capabilities arrays,
// fields, DEFAULT_CATALOG, and the registry Map.

describe("FIX-2: registry values and DEFAULT_CATALOG are immutable after construction", () => {
  test("FIX2-001: pushing to a definition's capabilities array does not affect the registry", () => {
    const def = {
      ...VALID_DEFINITION,
      capabilities: ["initial-cap"],
    };
    const registry = buildRegistry([def]);
    const result = lookupWorkflow(registry, "test-workflow");

    // Attempt to mutate — either throws (frozen) or silently fails
    if (result) {
      try {
        result.capabilities.push("injected");
      } catch {
        // expected when frozen — test will pass either way
      }
    }

    // The registry must return the original value unchanged
    const result2 = lookupWorkflow(registry, "test-workflow");
    expect(result2?.capabilities).toHaveLength(1);
    expect(result2?.capabilities[0]).toBe("initial-cap");
    expect(result2?.capabilities).not.toContain("injected");
  });

  test("FIX2-002: reassigning a field on a returned definition does not affect subsequent lookups", () => {
    const registry = buildRegistry([VALID_DEFINITION]);
    const result = lookupWorkflow(registry, "test-workflow");

    // Attempt field mutation — either throws (frozen) or silently fails
    if (result) {
      try {
        (result as { id: string }).id = "mutated-id";
      } catch {
        // expected when frozen
      }
    }

    // The registry must still return the original id
    const result2 = lookupWorkflow(registry, "test-workflow");
    expect(result2?.id).toBe("test-workflow");
  });

  test("FIX2-003: calling .set on registry.definitions does not add entries visible to lookupWorkflow", () => {
    const registry = buildRegistry([VALID_DEFINITION]);
    const extraDef = { ...VALID_DEFINITION, id: "injected-workflow" };

    // Attempt to mutate the exposed map
    try {
      (registry.definitions as Map<string, WorkflowDefinition>).set(
        "injected-workflow",
        extraDef,
      );
    } catch {
      // expected if the map is protected
    }

    // Whether set throws or is a no-op, the injected id must not be discoverable
    const injected = lookupWorkflow(registry, "injected-workflow");
    expect(injected).toBeUndefined();
  });

  test("FIX2-004: DEFAULT_CATALOG cannot be mutated by pushing a new entry", () => {
    const originalLength = DEFAULT_CATALOG.length;

    // Attempt to push into the exported catalog array
    try {
      (DEFAULT_CATALOG as WorkflowDefinition[]).push({
        ...VALID_DEFINITION,
        id: "injected-catalog-entry",
      });
    } catch {
      // expected when frozen
    }

    // The exported DEFAULT_CATALOG must be the same length
    expect(DEFAULT_CATALOG.length).toBe(originalLength);
    const ids = DEFAULT_CATALOG.map((d) => d.id);
    expect(ids).not.toContain("injected-catalog-entry");
  });

  test("FIX2-005: DEFAULT_CATALOG entry capabilities array cannot be mutated", () => {
    const entry = DEFAULT_CATALOG[0];
    if (!entry) return; // guard for type narrowing

    const originalCapabilities = [...entry.capabilities];

    try {
      (entry.capabilities as string[]).push("injected-cap");
    } catch {
      // expected when frozen
    }

    // capabilities length must be unchanged
    expect(entry.capabilities.length).toBe(originalCapabilities.length);
  });
});
