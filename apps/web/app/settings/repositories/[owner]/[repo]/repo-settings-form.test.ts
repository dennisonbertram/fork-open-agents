/**
 * BT-FORM-001: buildPatchBody emits null for cleared-to-inherit fields
 * BT-FORM-002: buildPatchBody omits untouched (undefined) fields
 * BT-FORM-003: buildPatchBody includes only changed fields
 * BT-FORM-004: computeDirty returns true when any field differs from base
 * BT-FORM-005: computeDirty returns false when all fields match base
 * BT-FORM-006: VCPU_OPTIONS contains the expected allowed set
 * BT-FORM-007: RUNTIME_MODE_OPTIONS contains classic and managed_runtime
 * BT-FORM-008: repoSettingsPatchSchema accepts boolean|enum|int|string|null
 * BT-FORM-009: repoSettingsPatchSchema rejects invalid runtimeMode
 * BT-FORM-010: repoSettingsPatchSchema rejects invalid vcpus type
 */
import { describe, expect, test } from "bun:test";
import {
  buildPatchBody,
  computeDirty,
  VCPU_OPTIONS,
  RUNTIME_MODE_OPTIONS,
  repoSettingsPatchSchema,
} from "./repo-settings-form";
import type { RepoEditState } from "./repo-settings-form";

const BASE_STATE: RepoEditState = {
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

describe("buildPatchBody", () => {
  test("BT-FORM-001: cleared-to-inherit fields emit null in the patch", () => {
    const state: RepoEditState = { ...BASE_STATE, fullClone: null };
    const patch = buildPatchBody(state, BASE_STATE);
    expect(patch.fullClone).toBe(null);
  });

  test("BT-FORM-002: untouched fields are omitted from the patch", () => {
    const state: RepoEditState = { ...BASE_STATE, fullClone: true };
    const patch = buildPatchBody(state, BASE_STATE);
    // Only fullClone changed — others should be absent
    expect("prewarmEnabled" in patch).toBe(false);
    expect("runtimeMode" in patch).toBe(false);
    expect("vcpus" in patch).toBe(false);
  });

  test("BT-FORM-003: changed fields appear with the new value", () => {
    const state: RepoEditState = {
      ...BASE_STATE,
      autoCommitPush: true,
      autoCreatePr: true,
    };
    const patch = buildPatchBody(state, BASE_STATE);
    expect(patch.autoCommitPush).toBe(true);
    expect(patch.autoCreatePr).toBe(true);
    // Unchanged fields absent
    expect("fullClone" in patch).toBe(false);
  });

  test("BT-FORM-003b: vcpus and runtimeMode changes appear", () => {
    const state: RepoEditState = {
      ...BASE_STATE,
      vcpus: 4,
      runtimeMode: "managed_runtime",
    };
    const patch = buildPatchBody(state, BASE_STATE);
    expect(patch.vcpus).toBe(4);
    expect(patch.runtimeMode).toBe("managed_runtime");
  });
});

describe("computeDirty", () => {
  test("BT-FORM-004: returns true when any field differs", () => {
    const state: RepoEditState = { ...BASE_STATE, fullClone: true };
    expect(computeDirty(state, BASE_STATE)).toBe(true);
  });

  test("BT-FORM-005: returns false when all fields match base", () => {
    expect(computeDirty(BASE_STATE, BASE_STATE)).toBe(false);
  });

  test("BT-FORM-005b: null vs false counts as different (clearing override)", () => {
    const state: RepoEditState = { ...BASE_STATE, fullClone: null };
    expect(computeDirty(state, BASE_STATE)).toBe(true);
  });
});

describe("VCPU_OPTIONS", () => {
  test("BT-FORM-006: contains at least one vCPU option", () => {
    expect(VCPU_OPTIONS.length).toBeGreaterThan(0);
  });

  test("BT-FORM-006b: every option has a numeric value and string label", () => {
    for (const option of VCPU_OPTIONS) {
      expect(typeof option.value).toBe("number");
      expect(option.value).toBeGreaterThan(0);
      expect(typeof option.label).toBe("string");
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});

describe("RUNTIME_MODE_OPTIONS", () => {
  test("BT-FORM-007: contains classic option", () => {
    expect(RUNTIME_MODE_OPTIONS.some((o) => o.value === "classic")).toBe(true);
  });

  test("BT-FORM-007b: contains managed_runtime option", () => {
    expect(
      RUNTIME_MODE_OPTIONS.some((o) => o.value === "managed_runtime"),
    ).toBe(true);
  });

  test("BT-FORM-007c: exactly two runtime mode options", () => {
    expect(RUNTIME_MODE_OPTIONS.length).toBe(2);
  });
});

describe("repoSettingsPatchSchema", () => {
  test("BT-FORM-008: accepts boolean fields", () => {
    const result = repoSettingsPatchSchema.safeParse({ fullClone: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fullClone).toBe(true);
  });

  test("BT-FORM-008b: accepts null to clear field to inherit", () => {
    const result = repoSettingsPatchSchema.safeParse({ fullClone: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fullClone).toBeNull();
  });

  test("BT-FORM-008c: accepts valid runtimeMode enum", () => {
    const result = repoSettingsPatchSchema.safeParse({
      runtimeMode: "managed_runtime",
    });
    expect(result.success).toBe(true);
  });

  test("BT-FORM-008d: accepts integer vcpus", () => {
    const result = repoSettingsPatchSchema.safeParse({ vcpus: 4 });
    expect(result.success).toBe(true);
  });

  test("BT-FORM-008e: accepts string managedRuntimeProfileId", () => {
    const result = repoSettingsPatchSchema.safeParse({
      managedRuntimeProfileId: "web-bun-agent-browser",
    });
    expect(result.success).toBe(true);
  });

  test("BT-FORM-009: rejects invalid runtimeMode value", () => {
    const result = repoSettingsPatchSchema.safeParse({
      runtimeMode: "invalid_mode",
    });
    expect(result.success).toBe(false);
  });

  test("BT-FORM-010: rejects string for vcpus (must be number)", () => {
    const result = repoSettingsPatchSchema.safeParse({ vcpus: "four" });
    expect(result.success).toBe(false);
  });

  test("BT-FORM-010b: empty object is accepted (all fields optional)", () => {
    const result = repoSettingsPatchSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
