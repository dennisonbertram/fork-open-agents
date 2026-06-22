import { describe, expect, mock, test } from "bun:test";
import { defaultComposioAgentDefaults } from "@/lib/composio/types";

mock.module("./client", () => ({
  db: {},
}));

const userPreferencesModulePromise = import("./user-preferences");

describe("toUserPreferencesData", () => {
  test("returns defaults when row is undefined", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    expect(toUserPreferencesData()).toEqual({
      defaultModelId: "openai/gpt-5.4",
      defaultSubagentModelId: null,
      defaultInferenceProfileId: null,
      defaultSubagentInferenceProfileId: null,
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "unified",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      agentCustomInstructions: "",
      globalSkillRefs: [],
      modelVariants: [],
      enabledModelIds: [],
      composioAgentDefaults: defaultComposioAgentDefaults,
    });
  });

  test("normalizes invalid sandbox and diff mode values to defaults", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: "openai/gpt-5-mini",
      defaultSandboxType: "invalid" as never,
      defaultManagedRuntimeProfileId: "unknown-profile",
      defaultDiffMode: "invalid" as never,
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      agentCustomInstructions: "",
      globalSkillRefs: [],
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.defaultSandboxType).toBe("vercel");
    expect(result.defaultManagedRuntimeProfileId).toBe("web-bun-agent-browser");
    expect(result.defaultDiffMode).toBe("unified");
  });

  test("normalizes legacy hybrid sandbox types to vercel", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "hybrid" as never,
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "unified",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      agentCustomInstructions: "",
      globalSkillRefs: [],
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.defaultSandboxType).toBe("vercel");
    expect(result.defaultDiffMode).toBe("unified");
  });

  test("drops invalid globalSkillRefs payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultInferenceProfileId: null,
      defaultSubagentInferenceProfileId: null,
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      globalSkillRefs: [
        { source: "vercel/ai", skillName: "bad name" },
      ] as never,
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.globalSkillRefs).toEqual([]);
  });

  test("keeps valid globalSkillRefs payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      globalSkillRefs: [
        { source: "vercel/ai", skillName: "ai-sdk" },
        { source: "vercel/ai", skillName: "ai-sdk" },
      ],
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.globalSkillRefs).toEqual([
      { source: "vercel/ai", skillName: "ai-sdk" },
    ]);
  });

  test("drops invalid modelVariants payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      agentCustomInstructions: "",
      globalSkillRefs: [],
      modelVariants: [{ id: "bad-id" }] as never,
      enabledModelIds: [],
    });

    expect(result.modelVariants).toEqual([]);
  });

  test("keeps valid modelVariants payloads", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "split",
      autoCommitPush: true,
      autoCreatePr: true,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      agentCustomInstructions: "",
      globalSkillRefs: [],
      modelVariants: [
        {
          id: "variant:test",
          name: "Test Variant",
          baseModelId: "openai/gpt-5",
          providerOptions: { reasoningEffort: "low" },
        },
      ],
      enabledModelIds: [],
    });

    expect(result).toEqual({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultInferenceProfileId: null,
      defaultSubagentInferenceProfileId: null,
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "split",
      autoCommitPush: true,
      autoCreatePr: true,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      agentCustomInstructions: "",
      globalSkillRefs: [],
      modelVariants: [
        {
          id: "variant:test",
          name: "Test Variant",
          baseModelId: "openai/gpt-5",
          providerOptions: { reasoningEffort: "low" },
        },
      ],
      enabledModelIds: [],
      composioAgentDefaults: defaultComposioAgentDefaults,
    });
  });

  test("keeps default subagent inference profile when provided", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultSubagentModelId: "cursor/composer-2.5",
      defaultSubagentInferenceProfileId: "profile-cursor",
    });

    expect(result.defaultSubagentModelId).toBe("cursor/composer-2.5");
    expect(result.defaultSubagentInferenceProfileId).toBe("profile-cursor");
  });

  test("keeps publicUsageEnabled when provided", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      defaultModelId: "openai/gpt-5",
      defaultSubagentModelId: null,
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "split",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: true,
      globalSkillRefs: [],
      modelVariants: [],
      enabledModelIds: [],
    });

    expect(result.publicUsageEnabled).toBe(true);
  });

  test("keeps agentCustomInstructions when provided", async () => {
    const { toUserPreferencesData } = await userPreferencesModulePromise;

    const result = toUserPreferencesData({
      agentCustomInstructions: "Always use GitHub tools.",
    });

    expect(result.agentCustomInstructions).toBe("Always use GitHub tools.");
  });
});
