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
  splitAgentPatchModel,
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
    const result = agentPatchSchema.safeParse({
      role: "explorer",
      modelId: null,
    });
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
      expect(
        (result.data as Record<string, unknown>)["unknownField"],
      ).toBeUndefined();
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

  // BT-M-012: githubToolsEnabled boolean field
  it("BT-M-012a: accepts githubToolsEnabled: true", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      githubToolsEnabled: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.githubToolsEnabled).toBe(true);
    }
  });

  it("BT-M-012b: accepts githubToolsEnabled: false", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      githubToolsEnabled: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.githubToolsEnabled).toBe(false);
    }
  });

  it("BT-M-012c: rejects non-boolean githubToolsEnabled (string)", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      githubToolsEnabled: "yes",
    });
    expect(result.success).toBe(false);
  });

  // BT-M-013: toolAuthoringEnabled boolean field (#388)
  it("BT-M-013a: accepts toolAuthoringEnabled: true", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      toolAuthoringEnabled: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolAuthoringEnabled).toBe(true);
    }
  });

  it("BT-M-013b: accepts toolAuthoringEnabled: false", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      toolAuthoringEnabled: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolAuthoringEnabled).toBe(false);
    }
  });

  it("BT-M-013c: rejects non-boolean toolAuthoringEnabled (string)", () => {
    const result = agentPatchSchema.safeParse({
      role: "main",
      toolAuthoringEnabled: "yes",
    });
    expect(result.success).toBe(false);
  });
});

// #1157 (write path): the Settings -> Agents "User model" picker can emit a
// "user-profile:<profileId>:<modelId>" composite id (buildModelOptions splits
// a saved AI SDK model id from a real inference profile). That composite must
// never land in agents.model_id while inference_profile_id stays null — the
// same normalization already applied to updateUserPreferences and the three
// chat-creation routes (#1154 / #1160).
describe("splitAgentPatchModel", () => {
  it("BT-M-014a: splits a composite modelId into its bare model id + profile id", () => {
    const result = splitAgentPatchModel({
      role: "executor",
      modelId: "user-profile:profile-abc:anthropic/claude-opus-4",
    });
    expect(result.modelId).toBe("anthropic/claude-opus-4");
    expect(result.inferenceProfileId).toBe("profile-abc");
  });

  it("BT-M-014b: leaves a plain gateway modelId untouched with a null profile id", () => {
    const result = splitAgentPatchModel({
      role: "executor",
      modelId: "openai/gpt-4o",
    });
    expect(result.modelId).toBe("openai/gpt-4o");
    expect(result.inferenceProfileId).toBeNull();
  });

  it("BT-M-014c: a null modelId (reset to inherit) stays null with a null profile id", () => {
    const result = splitAgentPatchModel({ role: "executor", modelId: null });
    expect(result.modelId).toBeNull();
    expect(result.inferenceProfileId).toBeNull();
  });

  it("BT-M-014d: an absent modelId (field not in the patch) is omitted from the result", () => {
    const result = splitAgentPatchModel({ role: "executor" });
    expect("modelId" in result).toBe(false);
    expect("inferenceProfileId" in result).toBe(false);
  });

  // Regression: the result is a DB patch object (upsertUserDefaultAgent takes
  // role as its own positional argument; UserDefaultAgentPatch has no role
  // field), so role must never survive into it — otherwise every PATCH sends
  // an extra unrecognized "role" key through to the DB layer.
  it("BT-M-014f: role is dropped from the result, not passed through", () => {
    const result = splitAgentPatchModel({
      role: "executor",
      instructions: "Be careful.",
    });
    expect("role" in result).toBe(false);
  });

  it("BT-M-014e: other patch fields pass through unchanged", () => {
    const result = splitAgentPatchModel({
      role: "main",
      modelId: "user-profile:profile-xyz:openai/gpt-5",
      instructions: "Be concise.",
      composioToolkitSlugs: ["github"],
      githubToolsEnabled: true,
      toolAuthoringEnabled: true,
      managedRuntimeProfileId: "web-bun-agent-browser",
    });
    expect(result).toMatchObject({
      instructions: "Be concise.",
      composioToolkitSlugs: ["github"],
      githubToolsEnabled: true,
      toolAuthoringEnabled: true,
      managedRuntimeProfileId: "web-bun-agent-browser",
    });
  });
});
