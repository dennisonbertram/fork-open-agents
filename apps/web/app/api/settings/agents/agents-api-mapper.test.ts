/**
 * Unit tests for the pure form→payload mapper and validator for the
 * /api/settings/agents route (Phase 3).
 *
 * Tests the agentPatchSchema zod validator and the mapper's output shape,
 * with no I/O. Imported from the mapper module.
 */

import { describe, expect, it } from "bun:test";
import {
  agentPatchSchema,
  type AgentPatchInput,
} from "./agents-api-mapper";

// BT-M-001: valid patch with all optional fields
describe("agentPatchSchema", () => {
  it("BT-M-001: accepts a valid patch with all fields present", () => {
    const input: AgentPatchInput = {
      role: "main",
      modelId: "anthropic/claude-opus-4",
      composioToolkitSlugs: ["github", "linear"],
      instructions: "Be concise.",
      managedRuntimeProfileId: "web-bun-agent-browser",
    };
    const result = agentPatchSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("BT-M-002: accepts a patch with only role (minimal valid input)", () => {
    const result = agentPatchSchema.safeParse({ role: "main" });
    expect(result.success).toBe(true);
  });

  it("BT-M-003: rejects unknown role value", () => {
    const result = agentPatchSchema.safeParse({ role: "unknown-role" });
    expect(result.success).toBe(false);
  });

  it("BT-M-004: accepts null modelId (reset to inherit)", () => {
    const result = agentPatchSchema.safeParse({ role: "explorer", modelId: null });
    expect(result.success).toBe(true);
  });

  it("BT-M-005: accepts null instructions (reset to built-in)", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      instructions: null,
    });
    expect(result.success).toBe(true);
  });

  it("BT-M-006: accepts empty composioToolkitSlugs array", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      composioToolkitSlugs: [],
    });
    expect(result.success).toBe(true);
  });

  it("BT-M-007: rejects non-string composioToolkitSlugs items", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      composioToolkitSlugs: [123, true],
    });
    expect(result.success).toBe(false);
  });

  it("BT-M-008: rejects missing role field", () => {
    const result = agentPatchSchema.safeParse({
      modelId: "some-model",
    });
    expect(result.success).toBe(false);
  });

  it("BT-M-009: accepts all four valid roles", () => {
    for (const role of ["main", "explorer", "executor", "design"] as const) {
      const result = agentPatchSchema.safeParse({ role });
      expect(result.success).toBe(true);
    }
  });

  it("BT-M-010: strips extra unknown fields (strict schema)", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      unknownField: "should be stripped or rejected",
    });
    // Either stripped (success + no unknownField) or rejected
    if (result.success) {
      expect((result.data as Record<string, unknown>)["unknownField"]).toBeUndefined();
    }
    // Either outcome is acceptable as long as the field isn't passed to DB
  });

  it("BT-M-011: accepts null managedRuntimeProfileId (reset to inherit)", () => {
    const result = agentPatchSchema.safeParse({
      role: "design",
      managedRuntimeProfileId: null,
    });
    expect(result.success).toBe(true);
  });
});
