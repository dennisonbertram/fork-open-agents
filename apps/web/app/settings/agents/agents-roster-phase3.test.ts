/**
 * Phase 3 tests for buildAgentRoster — verifies that userDefaultAgentRows
 * are merged so the collapsed summary reflects saved values.
 *
 * These tests are the RED step for Part B of Phase 3.
 */

import { describe, expect, test } from "bun:test";
import { buildAgentRoster } from "./agents-roster";
import type { ComposioAgentDefaults } from "@/lib/composio/types";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

// ── Minimal fixtures ─────────────────────────────────────────────────────────

const basePrefs = {
  defaultModelId: "anthropic/claude-opus-4-5",
  defaultSubagentModelId: null as string | null,
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
};

const noComposioDefaults: ComposioAgentDefaults = {
  main: { defaultProfileId: null, allowChatOverride: true },
  explorer: { defaultProfileId: null, allowChatOverride: false },
  executor: { defaultProfileId: null, allowChatOverride: false },
  design: { defaultProfileId: null, allowChatOverride: false },
};

const runtimeProfiles: ManagedRuntimeProfile[] = [
  {
    id: "web-bun-agent-browser",
    version: "2026-05-23.2",
    displayName: "Web app with Bun and browser checks",
    description: "desc",
    setupCommands: [],
    verificationCommands: [],
    expectedTools: [],
    optionalTools: [],
    defaultPorts: [],
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildAgentRoster — Phase 3: merging user_default agent rows", () => {
  // BT-P3-001: When no user_default rows, roster still returns 4 rows (no regression)
  test("BT-P3-001: returns exactly four rows when userDefaultAgentRows is empty or omitted", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [],
    });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.key)).toEqual([
      "main",
      "explorer",
      "executor",
      "design",
    ]);

    // Also test with omitted (backward compat)
    const rowsOmitted = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    expect(rowsOmitted).toHaveLength(4);
  });

  // BT-P3-002: user_default row with modelId overrides the preference model
  test("BT-P3-002: user_default row modelId overrides the preference default model for that role", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: "openai/gpt-5.4",
          composioToolkitSlugs: [],
          instructions: null,
          managedRuntimeProfileId: null,
          composioProfileId: null,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.model).toBe("openai/gpt-5.4");
    expect(main?.modelCustom).toBe(true);
  });

  // BT-P3-003: user_default row null modelId → modelCustom=false (inherits pref)
  test("BT-P3-003: user_default row with null modelId does not override (still inherits pref)", () => {
    const rows = buildAgentRoster({
      preferences: {
        ...basePrefs,
        defaultModelId: "anthropic/claude-opus-4-5",
      },
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: [],
          instructions: null,
          managedRuntimeProfileId: null,
          composioProfileId: null,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.model).toBe("anthropic/claude-opus-4-5");
    expect(main?.modelCustom).toBe(false);
  });

  // BT-P3-004: user_default row composioToolkitSlugs overrides tools display
  test("BT-P3-004: user_default row with composioToolkitSlugs reflects in toolsLabel", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: ["github", "linear"],
          instructions: null,
          managedRuntimeProfileId: null,
          composioProfileId: null,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.toolsLabel).toMatch(/github|linear|2/i);
    expect(main?.toolsCustom).toBe(true);
  });

  // BT-P3-005: user_default row instructions override
  test("BT-P3-005: user_default row instructions shows as custom when non-null", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: [],
          instructions: "Be concise.",
          managedRuntimeProfileId: null,
          composioProfileId: null,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.instructions).toBe("Be concise.");
    expect(main?.instructionsCustom).toBe(true);
  });

  // BT-P3-006: user_default row null instructions → not custom
  test("BT-P3-006: user_default row with null instructions shows not custom", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: [],
          instructions: null,
          managedRuntimeProfileId: null,
          composioProfileId: null,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.instructionsCustom).toBe(false);
  });

  // BT-P3-007: rows for different roles only affect their own role
  test("BT-P3-007: user_default row for explorer does not affect main row", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "explorer",
          modelId: "openai/gpt-5.4",
          composioToolkitSlugs: ["github"],
          instructions: null,
          managedRuntimeProfileId: null,
          composioProfileId: null,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    const explorer = rows.find((r) => r.key === "explorer");

    // Main is unaffected
    expect(main?.model).toBe("anthropic/claude-opus-4-5");
    expect(main?.modelCustom).toBe(false);

    // Explorer has the custom row
    expect(explorer?.model).toBe("openai/gpt-5.4");
    expect(explorer?.modelCustom).toBe(true);
  });

  // BT-P3-008: managedRuntimeProfileId from user_default row takes precedence
  test("BT-P3-008: user_default row managedRuntimeProfileId shown in runtimeLabel when set", () => {
    const rows = buildAgentRoster({
      preferences: {
        ...basePrefs,
        defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      },
      composioDefaults: noComposioDefaults,
      runtimeProfiles: [
        ...runtimeProfiles,
        {
          id: "node-agent",
          version: "1.0",
          displayName: "Node.js environment",
          description: "desc",
          setupCommands: [],
          verificationCommands: [],
          expectedTools: [],
          optionalTools: [],
          defaultPorts: [],
        },
      ],
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: [],
          instructions: null,
          managedRuntimeProfileId: "node-agent",
          composioProfileId: null,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.runtimeLabel).toBe("Node.js environment");
    expect(main?.runtimeCustom).toBe(true);
  });

  // BT-P3-009: when no user_default row for a role, existing fields unchanged
  test("BT-P3-009: roles with no user_default row continue to show inherited values", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        // Only main has a row
        {
          role: "main",
          modelId: "openai/gpt-5.4",
          composioToolkitSlugs: [],
          instructions: null,
          managedRuntimeProfileId: null,
          composioProfileId: null,
        },
      ],
    });

    for (const role of ["explorer", "executor", "design"] as const) {
      const row = rows.find((r) => r.key === role);
      expect(row?.modelCustom).toBe(false);
      expect(row?.toolsCustom).toBe(false);
    }
  });
});

// BT-P3-GH: githubToolsEnabled threading through roster builder
describe("buildAgentRoster — githubToolsEnabled (BT-P3-GH)", () => {
  // BT-P3-GH-001: githubToolsEnabled=true from user_default row flows to roster row
  test("BT-P3-GH-001: user_default row githubToolsEnabled=true flows to the Main roster row", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: [],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
          githubToolsEnabled: true,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main).toHaveProperty("githubToolsEnabled");
    expect(main?.githubToolsEnabled).toBe(true);
  });

  // BT-P3-GH-002: githubToolsEnabled=false (or absent) defaults to false
  test("BT-P3-GH-002: roster row githubToolsEnabled defaults to false when no user_default row", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.githubToolsEnabled).toBe(false);
  });

  // BT-P3-GH-003: githubToolsEnabled from user_default row with explicit false
  test("BT-P3-GH-003: user_default row githubToolsEnabled=false flows to the roster row as false", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
      userDefaultAgentRows: [
        {
          role: "main",
          modelId: null,
          composioToolkitSlugs: [],
          composioProfileId: null,
          instructions: null,
          managedRuntimeProfileId: null,
          githubToolsEnabled: false,
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.githubToolsEnabled).toBe(false);
  });
});
