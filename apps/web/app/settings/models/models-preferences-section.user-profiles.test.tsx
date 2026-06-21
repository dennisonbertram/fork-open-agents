import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const userModelId = "user-profile:profile-openai:local-mini";
const secondUserModelId = "user-profile:profile-openai:local-pro";

type ComboboxItem = {
  id: string;
  label: string;
  description?: string;
  isVariant?: boolean;
  provider?: string;
};

const capturedComboboxes: Array<{
  value: string;
  items: ComboboxItem[];
}> = [];

mock.module("@/components/model-combobox", () => ({
  ModelCombobox: ({
    value,
    items,
  }: {
    value: string;
    items: ComboboxItem[];
  }) => {
    capturedComboboxes.push({ value, items });
    return (
      <div>
        {items.map((item) => (
          <span key={item.id}>{item.label}</span>
        ))}
      </div>
    );
  },
}));

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
        id: secondUserModelId,
        label: "Local Pro",
        shortLabel: "Local Pro",
        description: "Via Local OpenAI endpoint (your key)",
        isVariant: false,
        provider: "user",
        source: "user",
        baseModelId: "local-pro",
        inferenceProfileId: "profile-openai",
        secondaryLabel: "Local OpenAI endpoint",
        searchText: "local-pro Local Pro Local OpenAI endpoint",
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
      defaultSubagentModelId: secondUserModelId,
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
      modelSystemPrompts: {},
    },
    loading: false,
    error: null,
    updatePreferences: async () => ({}),
  }),
}));

describe("ModelPreferencesSection user inference models", () => {
  beforeEach(() => {
    capturedComboboxes.length = 0;
  });

  test("passes multiple discovered user profile models to model pickers", async () => {
    const { ModelPreferencesSection } =
      await import("./models-preferences-section");

    const html = renderToStaticMarkup(<ModelPreferencesSection />);

    expect(html).toContain("Local Mini");
    expect(html).toContain("Local Pro");
    expect(html).not.toContain("missing profile");

    expect(capturedComboboxes).toHaveLength(3);
    expect(capturedComboboxes[0]).toMatchObject({
      value: userModelId,
      items: [
        { id: userModelId, label: "Local Mini", provider: "user" },
        { id: secondUserModelId, label: "Local Pro", provider: "user" },
        { id: "openai/gpt-5.4", label: "GPT 5.4", provider: "openai" },
      ],
    });
    expect(capturedComboboxes[1]).toMatchObject({
      value: secondUserModelId,
      items: [
        { id: "auto", label: "Same as main model" },
        { id: userModelId, label: "Local Mini", provider: "user" },
        { id: secondUserModelId, label: "Local Pro", provider: "user" },
        { id: "openai/gpt-5.4", label: "GPT 5.4", provider: "openai" },
      ],
    });
    expect(capturedComboboxes[2]).toMatchObject({
      value: userModelId,
      items: [
        { id: userModelId, label: "Local Mini" },
        { id: secondUserModelId, label: "Local Pro" },
        { id: "openai/gpt-5.4", label: "GPT 5.4" },
      ],
    });
  });
});
