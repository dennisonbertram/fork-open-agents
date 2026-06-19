/**
 * Regression tests for repo-settings-form pure helpers.
 * These would fail if the GREEN commit (87196ac2) were reverted.
 *
 * Scenarios:
 * - REG-FORM-001: buildPatchBody never includes unchanged fields — not even as undefined
 * - REG-FORM-002: computeDirty detects null-vs-value changes (inherited vs overridden)
 * - REG-FORM-003: VCPU_OPTIONS values are all positive integers
 * - REG-FORM-004: repoSettingsPatchSchema is strict about runtimeMode enum
 * - REG-FORM-005: buildPatchBody with all fields changed includes every field
 */
import { describe, expect, test } from "bun:test";
import {
  buildPatchBody,
  computeDirty,
  VCPU_OPTIONS,
  repoSettingsPatchSchema,
  type RepoEditState,
} from "./repo-settings-form";

const BASE: RepoEditState = {
  fullClone: false,
  prewarmEnabled: false,
  runtimeMode: "classic",
  managedRuntimeProfileId: "web-bun-agent-browser",
  vcpus: 1,
  autoCommitPush: false,
  autoCreatePr: false,
  defaultBranch: null,
  isNewBranch: false,
};

describe("Regression — repo-settings-form", () => {
  test("REG-FORM-001: buildPatchBody keys are exactly the changed ones", () => {
    const state = { ...BASE, vcpus: 4 };
    const patch = buildPatchBody(state, BASE);
    const patchKeys = Object.keys(patch);
    expect(patchKeys).toEqual(["vcpus"]);
    expect(patch.vcpus).toBe(4);
  });

  test("REG-FORM-002: computeDirty detects null-vs-false difference (inherited vs overridden)", () => {
    const state = { ...BASE, fullClone: null }; // null = cleared to inherit
    expect(computeDirty(state, BASE)).toBe(true);
  });

  test("REG-FORM-003: all VCPU_OPTIONS have positive integer values", () => {
    for (const opt of VCPU_OPTIONS) {
      expect(Number.isInteger(opt.value)).toBe(true);
      expect(opt.value).toBeGreaterThan(0);
    }
  });

  test("REG-FORM-004: runtimeMode=classic is the only 'classic'-like value accepted", () => {
    const valid = repoSettingsPatchSchema.safeParse({ runtimeMode: "classic" });
    const invalid = repoSettingsPatchSchema.safeParse({
      runtimeMode: "Classic",
    });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  test("REG-FORM-005: buildPatchBody includes all fields when everything changed", () => {
    const all: RepoEditState = {
      fullClone: true,
      prewarmEnabled: true,
      runtimeMode: "managed_runtime",
      managedRuntimeProfileId: "other",
      vcpus: 8,
      autoCommitPush: true,
      autoCreatePr: true,
      defaultBranch: "main",
      isNewBranch: true,
    };
    const patch = buildPatchBody(all, BASE);
    const patchKeys = Object.keys(patch);
    // All 9 fields should be in the patch
    expect(patchKeys.length).toBe(9);
  });
});
