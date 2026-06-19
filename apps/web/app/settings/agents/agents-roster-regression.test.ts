/**
 * Regression tests for buildAgentRoster.
 *
 * These tests catch specific breakage scenarios that would occur if the
 * implementation in c152f72f were reverted or corrupted.
 */
import { describe, expect, test } from "bun:test";
import { buildAgentRoster } from "./agents-roster";
import { SETTINGS_NAV_GROUPS } from "../nav-items";
import type { ComposioAgentDefaults } from "@/lib/composio/types";
import type { ManagedRuntimeProfile } from "@open-agents/sandbox/managed-runtime-profiles";

const noComposioDefaults: ComposioAgentDefaults = {
  main: { defaultProfileId: null, allowChatOverride: true },
  explorer: { defaultProfileId: null, allowChatOverride: false },
  executor: { defaultProfileId: null, allowChatOverride: false },
  design: { defaultProfileId: null, allowChatOverride: false },
};

const emptyRuntimeProfiles: ManagedRuntimeProfile[] = [];

const basePrefs = {
  defaultModelId: "anthropic/claude-opus-4-5",
  defaultSubagentModelId: null as string | null,
  defaultManagedRuntimeProfileId: "web-bun-agent-browser",
};

describe("buildAgentRoster regression", () => {
  // REG-001: Main must never be modelInherited — if the isMain check is broken,
  // Main would incorrectly show as inherited.
  test("REG-001: Main row is never marked modelInherited", () => {
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: noComposioDefaults,
      runtimeProfiles: emptyRuntimeProfiles,
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.modelInherited).toBe(false);
  });

  // REG-002: Subagents must all be modelInherited when defaultSubagentModelId is null.
  // If the inheritance logic were removed, all three would incorrectly show main's model.
  test("REG-002: all three subagents are modelInherited when defaultSubagentModelId is null", () => {
    const rows = buildAgentRoster({
      preferences: { ...basePrefs, defaultSubagentModelId: null },
      composioDefaults: noComposioDefaults,
      runtimeProfiles: emptyRuntimeProfiles,
    });
    const subagentKeys = ["explorer", "executor", "design"] as const;
    for (const key of subagentKeys) {
      const row = rows.find((r) => r.key === key);
      expect(row?.modelInherited).toBe(true);
    }
  });

  // REG-003: Profile lookup must be keyed per-agent, not shared.
  // If a single profile id were applied to all agents, this test would fail
  // because explorer's profile would incorrectly use the main profile.
  test("REG-003: profile lookup is per-agent — different agents show their own profile", () => {
    const defaults: ComposioAgentDefaults = {
      main: { defaultProfileId: "main-profile", allowChatOverride: true },
      explorer: {
        defaultProfileId: "explorer-profile",
        allowChatOverride: false,
      },
      executor: { defaultProfileId: null, allowChatOverride: false },
      design: { defaultProfileId: null, allowChatOverride: false },
    };
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: defaults,
      runtimeProfiles: emptyRuntimeProfiles,
      profileSummaries: [
        {
          id: "main-profile",
          name: "Main Tools",
          toolkitSlugs: [],
          authConfigIdsByToolkit: {},
          connectedAccountIdsByToolkit: {},
          workbenchEnabled: false,
          allowInChatConnectionManagement: false,
          userId: "u1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "explorer-profile",
          name: "Explorer Tools",
          toolkitSlugs: [],
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

    expect(rows.find((r) => r.key === "main")?.toolsLabel).toBe("Main Tools");
    expect(rows.find((r) => r.key === "explorer")?.toolsLabel).toBe(
      "Explorer Tools",
    );
    expect(rows.find((r) => r.key === "executor")?.toolsLabel).toBe("None");
    expect(rows.find((r) => r.key === "design")?.toolsLabel).toBe("None");
  });

  // REG-004: Row order must be canonical (main first).
  // If the order were shuffled, pages using index-based rendering would break.
  test("REG-004: rows are always in canonical order regardless of input variation", () => {
    const withSubagentModel = buildAgentRoster({
      preferences: {
        ...basePrefs,
        defaultSubagentModelId: "anthropic/claude-3-5-haiku",
      },
      composioDefaults: noComposioDefaults,
      runtimeProfiles: emptyRuntimeProfiles,
    });
    expect(withSubagentModel.map((r) => r.key)).toEqual([
      "main",
      "explorer",
      "executor",
      "design",
    ]);
  });

  // REG-005: If a profileId is set but no matching summary is provided,
  // toolsLabel must fall back to "None" rather than crash or show undefined.
  test("REG-005: unknown profileId falls back to None without crashing", () => {
    const defaults: ComposioAgentDefaults = {
      ...noComposioDefaults,
      main: {
        defaultProfileId: "nonexistent-profile",
        allowChatOverride: true,
      },
    };
    const rows = buildAgentRoster({
      preferences: basePrefs,
      composioDefaults: defaults,
      runtimeProfiles: emptyRuntimeProfiles,
      // No matching summary provided
      profileSummaries: [],
    });
    const main = rows.find((r) => r.key === "main");
    expect(main?.toolsLabel).toBe("None");
  });

  // REG-006: agents nav item must be in the tools group (not a different group).
  // Catches regressions where the nav-items reorganization moves the item.
  test("REG-006: agents nav item is in the tools group", () => {
    const toolsGroup = SETTINGS_NAV_GROUPS.find((g) => g.id === "tools");
    const agentsItem = toolsGroup?.items.find((i) => i.id === "agents");
    expect(agentsItem).toBeDefined();
    expect(agentsItem?.href).toBe("/settings/agents");
  });
});
