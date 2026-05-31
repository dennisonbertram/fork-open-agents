import { describe, expect, test } from "bun:test";

import {
  WorkflowCatalogError,
  type WorkflowDefinition,
  buildRegistry,
  lookupWorkflow,
  listWorkflows,
  SUPPORTED_PROOF_LEVELS,
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

  test("the stub catalog entry is valid (buildRegistry does not throw)", () => {
    // This is the integration check: the default catalog can be built successfully
    const { DEFAULT_CATALOG } = require("./catalog");
    expect(() => buildRegistry(DEFAULT_CATALOG)).not.toThrow();
  });
});
