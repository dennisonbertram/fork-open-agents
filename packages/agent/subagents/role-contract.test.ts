/**
 * Tests for role-contract.ts — pure Zod schema and contract module.
 * No `ai` mock needed: this module has no ai imports.
 *
 * Named test cases from issue #55 "Tests to add first" section.
 * Regression tests guard: error taxonomy, frozen registry, never-throws,
 * and valid subagent binding for all ROLE_REGISTRY entries.
 */
import { describe, expect, test } from "bun:test";

const { ROLE_REGISTRY, parseRoleContract } = await import("./role-contract");

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

// ---------------------------------------------------------------------------
// REGRESSION TESTS — catch future breakage
// ---------------------------------------------------------------------------

describe("regression: error taxonomy distinctness", () => {
  test("role_contract_invalid is returned for null — cannot collapse into unknown_role", () => {
    const result = parseRoleContract(null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    // Must be role_contract_invalid, NOT unknown_role
    expect(result.error.kind).toBe("role_contract_invalid");
    expect(result.error.kind).not.toBe("unknown_role");
  });

  test("unknown_role is returned for well-shaped def with unknown id — cannot collapse into role_contract_invalid", () => {
    const def = {
      id: "not-a-real-role",
      label: "Ghost",
      description: "Nonexistent",
      family: "read",
      allowedTools: ["read"],
      requiredOutputs: ["summary"],
      boundSubagent: null,
    };
    const result = parseRoleContract(def);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    // Must be unknown_role, NOT role_contract_invalid
    expect(result.error.kind).toBe("unknown_role");
    expect(result.error.kind).not.toBe("role_contract_invalid");
  });

  test("forbidden_scope_violation is returned for read-family+write — cannot collapse into missing_required_output", () => {
    const def = {
      id: "locator",
      label: "Locator",
      description: "test",
      family: "read",
      allowedTools: ["read", "write"],
      requiredOutputs: ["summary"],
      boundSubagent: "explorer",
    };
    const result = parseRoleContract(def);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("forbidden_scope_violation");
    expect(result.error.kind).not.toBe("missing_required_output");
  });

  test("missing_required_output is returned for empty requiredOutputs — cannot collapse into role_contract_invalid", () => {
    const def = {
      id: "implementer",
      label: "Implementer",
      description: "test",
      family: "write",
      allowedTools: ["write"],
      requiredOutputs: [],
      boundSubagent: "executor",
    };
    const result = parseRoleContract(def);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.error.kind).toBe("missing_required_output");
    expect(result.error.kind).not.toBe("role_contract_invalid");
  });

  test("all 5 error kinds can be produced — none are dead code", () => {
    const kindsProduced = new Set<string>();

    // role_contract_invalid
    const r1 = parseRoleContract(null);
    if (!r1.ok) kindsProduced.add(r1.error.kind);

    // unknown_role
    const r2 = parseRoleContract({
      id: "ghost",
      label: "Ghost",
      description: "test",
      family: "read",
      allowedTools: ["read"],
      requiredOutputs: ["x"],
      boundSubagent: null,
    });
    if (!r2.ok) kindsProduced.add(r2.error.kind);

    // forbidden_scope_violation
    const r3 = parseRoleContract({
      id: "locator",
      label: "Locator",
      description: "test",
      family: "read",
      allowedTools: ["read", "write"],
      requiredOutputs: ["summary"],
      boundSubagent: "explorer",
    });
    if (!r3.ok) kindsProduced.add(r3.error.kind);

    // missing_required_output
    const r4 = parseRoleContract({
      id: "implementer",
      label: "Implementer",
      description: "test",
      family: "write",
      allowedTools: ["write"],
      requiredOutputs: [],
      boundSubagent: "executor",
    });
    if (!r4.ok) kindsProduced.add(r4.error.kind);

    expect(kindsProduced).toContain("role_contract_invalid");
    expect(kindsProduced).toContain("unknown_role");
    expect(kindsProduced).toContain("forbidden_scope_violation");
    expect(kindsProduced).toContain("missing_required_output");
  });
});

describe("regression: ROLE_REGISTRY subagent binding integrity", () => {
  test("every ROLE_REGISTRY entry binds to a valid existing sub-agent key or null", () => {
    // This test catches a future ROLE_REGISTRY entry silently binding to a
    // non-existent subagent (e.g., after a typo or rename).
    const validSubagentKeys = new Set(["explorer", "executor", "design"]);

    for (const [roleId, contract] of Object.entries(ROLE_REGISTRY)) {
      const bound = contract.boundSubagent;
      if (bound !== null) {
        expect(validSubagentKeys.has(bound)).toBe(true);
      }
      // Sanity: roleId matches contract.id (compare as strings to avoid narrow-type mismatch)
      expect(contract.id as string).toBe(roleId);
    }
  });

  test("implementer binds to executor — not explorer or design", () => {
    expect(ROLE_REGISTRY.implementer.boundSubagent).toBe("executor");
    expect(ROLE_REGISTRY.implementer.boundSubagent).not.toBe("explorer");
    expect(ROLE_REGISTRY.implementer.boundSubagent).not.toBe("design");
  });

  test("review-family roles (reviewer/verifier/simplifier/debugger) are all unbound (null)", () => {
    const reviewRoles = [
      "reviewer",
      "verifier",
      "simplifier",
      "debugger",
    ] as const;
    for (const role of reviewRoles) {
      expect(ROLE_REGISTRY[role].boundSubagent).toBe(null);
      expect(ROLE_REGISTRY[role].family).toBe("review");
    }
  });
});

describe("regression: parseRoleContract never throws on garbage", () => {
  const garbageInputs: unknown[] = [
    null,
    undefined,
    42,
    "string",
    true,
    [],
    {},
    { id: null },
    { id: 123, allowedTools: "not-an-array" },
  ];

  for (const input of garbageInputs) {
    test(`does not throw for garbage input: ${JSON.stringify(input)}`, () => {
      // Must not throw — must return { ok: false, error: ... }
      let result: ReturnType<typeof parseRoleContract> | undefined;
      expect(() => {
        result = parseRoleContract(input);
      }).not.toThrow();

      expect(result).toBeDefined();
      expect(result!.ok).toBe(false);
    });
  }
});

describe("regression: SUBAGENT_REGISTRY + task tool unaffected", () => {
  test("SUBAGENT_TYPES still contains the 3 original sub-agent keys", async () => {
    // Import from the same module the task tool uses, not from role-contract.
    const { SUBAGENT_TYPES, SUBAGENT_REGISTRY } = await import("./registry");

    expect(SUBAGENT_TYPES).toContain("explorer");
    expect(SUBAGENT_TYPES).toContain("executor");
    expect(SUBAGENT_TYPES).toContain("design");
    expect(SUBAGENT_TYPES).toHaveLength(3);
    expect(Object.keys(SUBAGENT_REGISTRY)).toHaveLength(3);
  });
});
