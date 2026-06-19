import { describe, expect, test } from "bun:test";
import {
  defaultChatComposioSelection,
  defaultComposioAgentDefaults,
  normalizeChatComposioSelection,
  normalizeComposioAgentDefaults,
  normalizeComposioToolProfileValues,
  normalizeRepositoryComposioSettings,
} from "./types";

describe("Composio profile normalization", () => {
  test("normalizes toolkit slugs and scoped account maps", () => {
    const profile = normalizeComposioToolProfileValues({
      name: "  GitHub + Gmail  ",
      toolkitSlugs: [" GitHub ", "github", "gmail", "bad slug!"],
      authConfigIdsByToolkit: {
        GitHub: "auth-github",
        slack: "auth-slack",
      },
      connectedAccountIdsByToolkit: {
        gmail: [" acct-1 ", "acct-1", ""],
        slack: ["acct-slack"],
      },
      workbenchEnabled: true,
      allowInChatConnectionManagement: false,
    });

    expect(profile).toEqual({
      name: "GitHub + Gmail",
      toolkitSlugs: ["github", "gmail"],
      authConfigIdsByToolkit: {
        github: "auth-github",
      },
      connectedAccountIdsByToolkit: {
        gmail: ["acct-1"],
      },
      workbenchEnabled: true,
      allowInChatConnectionManagement: false,
    });
  });

  test("rejects profiles without valid toolkit slugs", () => {
    expect(() =>
      normalizeComposioToolProfileValues({
        name: "Empty",
        toolkitSlugs: ["bad slug!"],
      }),
    ).toThrow("At least one toolkit slug is required");
  });
});

describe("Composio agent and chat selection normalization", () => {
  test("defaults subagents off unless explicitly configured", () => {
    expect(
      normalizeComposioAgentDefaults({
        main: {
          defaultProfileId: "profile-main",
          allowChatOverride: true,
        },
        executor: {
          defaultProfileId: "profile-executor",
          allowChatOverride: true,
        },
      }),
    ).toEqual({
      ...defaultComposioAgentDefaults,
      main: {
        defaultProfileId: "profile-main",
        allowChatOverride: true,
      },
      executor: {
        defaultProfileId: "profile-executor",
        allowChatOverride: true,
      },
    });
  });

  test("falls back to tools off for invalid chat selection payloads", () => {
    expect(normalizeChatComposioSelection({ unknown: "profile-1" })).toEqual(
      defaultChatComposioSelection,
    );
  });
});

describe("Repository Composio settings normalization", () => {
  test("normalizes allowed profiles and blocked toolkits", () => {
    expect(
      normalizeRepositoryComposioSettings({
        inheritGlobalDefaults: false,
        allowedProfileIds: ["profile-1", "profile-1", "profile-2"],
        blockedToolkitSlugs: [" Gmail ", "bad slug!", "github"],
        agentDefaults: {
          main: {
            defaultProfileId: "profile-1",
            allowChatOverride: true,
          },
        },
      }),
    ).toEqual({
      inheritGlobalDefaults: false,
      allowedProfileIds: ["profile-1", "profile-2"],
      blockedToolkitSlugs: ["gmail", "github"],
      agentDefaults: {
        main: {
          defaultProfileId: "profile-1",
          allowChatOverride: true,
        },
      },
      selectedToolkitSlugs: null,
    });
  });

  test("preserves null selectedToolkitSlugs when unset (never configured)", () => {
    const result = normalizeRepositoryComposioSettings({
      inheritGlobalDefaults: true,
      allowedProfileIds: [],
      blockedToolkitSlugs: [],
      agentDefaults: {},
    });
    expect(result.selectedToolkitSlugs).toBeNull();
  });

  test("normalizes an explicit selectedToolkitSlugs array", () => {
    const result = normalizeRepositoryComposioSettings({
      inheritGlobalDefaults: true,
      allowedProfileIds: [],
      blockedToolkitSlugs: [],
      agentDefaults: {},
      selectedToolkitSlugs: [" GitHub ", "github", "bad slug!", "linear"],
    });
    expect(result.selectedToolkitSlugs).toEqual(["github", "linear"]);
  });
});
