/**
 * Tests for role-contract.ts — pure Zod schema and contract module.
 * No `ai` mock needed: this module has no ai imports.
 *
 * Named test cases from issue #55 "Tests to add first" section.
 */
import { describe, expect, test } from "bun:test";

const {
  ROLE_REGISTRY,
  parseRoleContract,
} = await import("./role-contract");

describe("parseRoleContract — valid roles", () => {
  test("valid implementer role contract parses successfully with boundSubagent executor", () => {
    const def = {
      id: "implementer",
      label: "Implementer",
      description: "Implements changes in code",
      family: "write",
      allowedTools: ["read", "write", "edit", "bash"],
      forbiddenScope: [],
      requiredOutputs: ["diff"],
      boundSubagent: "executor",
    };

    const result = parseRoleContract(def);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.data.boundSubagent).toBe("executor");
    expect(result.data.id).toBe("implementer");
  });

  test("locator role has boundSubagent explorer", () => {
    expect(ROLE_REGISTRY.locator.boundSubagent).toBe("explorer");
  });

  test("researcher role has boundSubagent explorer", () => {
    expect(ROLE_REGISTRY.researcher.boundSubagent).toBe("explorer");
  });

  test("reviewer role has boundSubagent null (unbound)", () => {
    expect(ROLE_REGISTRY.reviewer.boundSubagent).toBe(null);
  });

  test("ROLE_REGISTRY covers all 7 expected role ids", () => {
    const expectedIds = [
      "locator",
      "researcher",
      "implementer",
      "reviewer",
      "verifier",
      "simplifier",
      "debugger",
    ];

    const registryKeys = Object.keys(ROLE_REGISTRY);

    for (const id of expectedIds) {
      expect(registryKeys).toContain(id);
    }

    expect(registryKeys).toHaveLength(7);
  });
});

describe("parseRoleContract — error kinds", () => {
  test("unknown role id returns unknown_role error", () => {
    const def = {
      id: "unknown",
      label: "Unknown",
      description: "Not a real role",
      family: "read",
      allowedTools: ["read"],
      requiredOutputs: ["summary"],
      boundSubagent: null,
    };

    const result = parseRoleContract(def);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("unknown_role");
    if (result.error.kind !== "unknown_role") throw new Error("Wrong kind");
    expect(result.error.id).toBe("unknown");
  });

  test("read-family role with write in allowedTools returns forbidden_scope_violation error", () => {
    const def = {
      id: "locator",
      label: "Locator",
      description: "Locates files",
      family: "read",
      allowedTools: ["read", "write"],
      requiredOutputs: ["summary"],
      boundSubagent: "explorer",
    };

    const result = parseRoleContract(def);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("forbidden_scope_violation");
  });

  test("read-family role with edit in allowedTools returns forbidden_scope_violation error", () => {
    const def = {
      id: "researcher",
      label: "Researcher",
      description: "Researches topics",
      family: "read",
      allowedTools: ["read", "edit"],
      requiredOutputs: ["summary"],
      boundSubagent: "explorer",
    };

    const result = parseRoleContract(def);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("forbidden_scope_violation");
    if (result.error.kind !== "forbidden_scope_violation")
      throw new Error("Wrong kind");
    expect(["write", "edit"]).toContain(result.error.violation);
  });

  test("role with empty requiredOutputs returns missing_required_output error", () => {
    const def = {
      id: "implementer",
      label: "Implementer",
      description: "Implements changes",
      family: "write",
      allowedTools: ["read", "write"],
      requiredOutputs: [],
      boundSubagent: "executor",
    };

    const result = parseRoleContract(def);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("missing_required_output");
    if (result.error.kind !== "missing_required_output")
      throw new Error("Wrong kind");
    expect(result.error.roleId).toBe("implementer");
  });

  test("completely invalid shape returns role_contract_invalid error", () => {
    const result = parseRoleContract(null);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("role_contract_invalid");
  });

  test("parseRoleContract never throws on undefined", () => {
    const result = parseRoleContract(undefined);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("role_contract_invalid");
  });

  test("parseRoleContract never throws on bare number", () => {
    const result = parseRoleContract(42);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("role_contract_invalid");
  });

  test("parseRoleContract never throws on empty object", () => {
    const result = parseRoleContract({});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("role_contract_invalid");
  });
});

describe("ROLE_REGISTRY — registry invariants", () => {
  test("ROLE_REGISTRY is frozen (mutation attempt is no-op or throws in strict mode)", () => {
    // In strict mode frozen objects throw on mutation attempt.
    // In non-strict, the mutation silently fails. Either way the value must not change.
    const originalLocator = ROLE_REGISTRY.locator;

    expect(() => {
      // @ts-expect-error — intentional mutation attempt
      (ROLE_REGISTRY as Record<string, unknown>).locator = null;
    }).toThrow();

    expect(ROLE_REGISTRY.locator).toBe(originalLocator);
  });

  test("ROLE_REGISTRY only binds to valid existing sub-agent keys or null", () => {
    const validSubagentKeys = ["explorer", "executor", "design"];

    for (const [roleId, contract] of Object.entries(ROLE_REGISTRY)) {
      const bound = contract.boundSubagent;
      if (bound !== null) {
        expect(validSubagentKeys).toContain(bound);
      }
      // All contracts exist (not undefined)
      expect(contract).toBeDefined();
      expect(typeof roleId).toBe("string");
    }
  });

  test("each ROLE_REGISTRY entry has non-empty label, description, and requiredOutputs", () => {
    for (const [roleId, contract] of Object.entries(ROLE_REGISTRY)) {
      expect(contract.label.length).toBeGreaterThan(0);
      expect(contract.description.length).toBeGreaterThan(0);
      expect(contract.requiredOutputs.length).toBeGreaterThan(0);
      expect(typeof roleId).toBe("string");
    }
  });
});
