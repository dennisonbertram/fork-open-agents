import { describe, expect, test } from "bun:test";
import { buildAgentRoster } from "./agents-roster";
import type { ComposioAgentDefaults } from "@/lib/composio/types";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

// Minimal fixtures

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

// BT-001: roster always returns exactly four rows in canonical order
describe("buildAgentRoster", () => {
  test("BT-001: returns exactly four rows in order main/explorer/executor/design", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.key)).toEqual([
      "main",
      "explorer",
      "executor",
      "design",
    ]);
  });

  // BT-002: Main model comes from defaultModelId
  test("BT-002: Main row model reflects defaultModelId preference", () => {
    const rows = buildAgentRoster({
      preferences: {
        ...basePrefs,
        defaultModelId: "anthropic/claude-3-7-sonnet",
      },
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.model).toBe("anthropic/claude-3-7-sonnet");
  });

  // BT-003: Subagent rows use defaultSubagentModelId when set
  test("BT-003: subagent rows use defaultSubagentModelId when set", () => {
    const rows = buildAgentRoster({
      preferences: {
        ...basePrefs,
        defaultModelId: "anthropic/claude-opus-4-5",
        defaultSubagentModelId: "anthropic/claude-3-5-haiku",
      },
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    for (const key of ["explorer", "executor", "design"] as const) {
      const row = rows.find((r) => r.key === key);
      expect(row?.model).toBe("anthropic/claude-3-5-haiku");
    }
  });

  // BT-004: When defaultSubagentModelId is null, subagent rows fall back to "Default (inherits Main)"
  test("BT-004: subagent rows fall back to inherited label when defaultSubagentModelId is null", () => {
    const rows = buildAgentRoster({
      preferences: { ...basePrefs, defaultSubagentModelId: null },
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    for (const key of ["explorer", "executor", "design"] as const) {
      const row = rows.find((r) => r.key === key);
      // model should be null or the fallback sentinel indicating inheritance
      expect(row?.modelInherited).toBe(true);
    }
  });

  // BT-005: tools label is "None" when no profile set
  test("BT-005: toolsLabel is None when no composio profile is set", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    for (const row of rows) {
      expect(row.toolsLabel).toBe("None");
    }
  });

  // BT-006: tools label uses profile name when profileSummaries are provided
  test("BT-006: toolsLabel shows profile name when a composio profile is set", () => {
    const defaults: ComposioAgentDefaults = {
      ...noComposioDefaults,
      main: { defaultProfileId: "profile-abc", allowChatOverride: true },
    };
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: defaults,
      runtimeProfiles,
      profileSummaries: [
        {
          id: "profile-abc",
          name: "Research",
          toolkitSlugs: ["github", "linear"],
          authConfigIdsByToolkit: {},
          connectedAccountIdsByToolkit: {},
          workbenchEnabled: false,
          allowInChatConnectionManagement: false,
          userId: "u1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.toolsLabel).toBe("Research");
  });

  // BT-007: runtimeLabel shows the profile displayName
  test("BT-007: runtimeLabel shows the displayName of the matching profile", () => {
    const rows = buildAgentRoster({
      preferences: {
        ...basePrefs,
        defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      },
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    for (const row of rows) {
      expect(row.runtimeLabel).toBe("Web app with Bun and browser checks");
    }
  });

  // BT-008: runtimeLabel falls back to "Default sandbox" when profileId doesn't match
  test("BT-008: runtimeLabel falls back to Default sandbox when profile not found", () => {
    const rows = buildAgentRoster({
      preferences: {
        ...basePrefs,
        defaultManagedRuntimeProfileId: "unknown-profile",
      },
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    for (const row of rows) {
      expect(row.runtimeLabel).toBe("Default sandbox");
    }
  });

  // BT-009: Main row has a human description (not from registry — hardcoded)
  test("BT-009: Main row description is the hardcoded human blurb", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    const main = rows.find((r) => r.key === "main");
    // Must be a non-empty human-readable string and must NOT be undefined
    expect(typeof main?.description).toBe("string");
    expect((main?.description ?? "").length).toBeGreaterThan(10);
  });

  // BT-010: Subagent rows use SUBAGENT_REGISTRY shortDescriptions
  test("BT-010: Explorer/Executor/Design descriptions come from registry shortDescription", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    const explorer = rows.find((r) => r.key === "explorer");
    const executor = rows.find((r) => r.key === "executor");
    const design = rows.find((r) => r.key === "design");
    // Registry short descriptions start with "Use for"
    expect(explorer?.description).toMatch(/Use for/);
    expect(executor?.description).toMatch(/Use for/);
    expect(design?.description).toMatch(/Use for/);
  });

  // BT-011: each row has a name field with the human-friendly role name
  test("BT-011: each row has a non-empty name string", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles,
    });
    for (const row of rows) {
      expect(typeof row.name).toBe("string");
      expect(row.name.length).toBeGreaterThan(0);
    }
  });
});
