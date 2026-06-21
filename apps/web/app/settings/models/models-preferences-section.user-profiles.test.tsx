import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const userModelId = "user-profile:profile-openai:local-mini";

mock.module("@/hooks/use-model-options", () => ({
  useModelOptions: () => ({
    modelOptions: [
      {
        id: userModelId,
        label: "Local Mini",
        shortLabel: "Local Mini",
        description: "Via Local OpenAI endpoint (your key)",
        isVariant: false,
        provider: "user",
        source: "user",
        baseModelId: "local-mini",
        inferenceProfileId: "profile-openai",
        secondaryLabel: "Local OpenAI endpoint",
        searchText: "local-mini Local Mini Local OpenAI endpoint",
      },
      {
        id: "openai/gpt-5.4",
        label: "GPT 5.4",
        shortLabel: "GPT 5.4",
        isVariant: false,
        provider: "openai",
        source: "catalog",
      },
    ],
    loading: false,
  }),
}));

mock.module("@/hooks/use-user-preferences", () => ({
  useUserPreferences: () => ({
    preferences: {
      defaultModelId: userModelId,
      defaultSubagentModelId: null,
      defaultInferenceProfileId: null,
      defaultSandboxType: "standard",
      defaultManagedRuntimeProfileId: "",
      defaultDiffMode: "unified",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: false,
      alertSoundEnabled: false,
      publicUsageEnabled: false,
      globalSkillRefs: [],
      modelVariants: [],
      enabledModelIds: [],
    },
    loading: false,
    error: null,
    updatePreferences: async () => ({}),
  }),
}));

describe("ModelPreferencesSection user inference models", () => {
  test("renders a selected user profile model as the discovered model, not a missing fallback", async () => {
    const { ModelPreferencesSection } =
      await import("./models-preferences-section");

    const html = renderToStaticMarkup(<ModelPreferencesSection />);

    expect(html).toContain("Local Mini");
    expect(html).not.toContain("missing profile");
  });
});
