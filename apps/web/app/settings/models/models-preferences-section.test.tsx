/**
 * Tests for models-preferences-section — the single home for
 * ModelPreferencesSection and EnabledModelsSection after extraction
 * from preferences-section.tsx.
 *
 * BT-001: ModelPreferencesSection and ModelPreferencesSectionSkeleton are
 *         exported from the new file, not just from preferences-section.tsx.
 * BT-002: models/page.tsx imports ModelPreferencesSection from the new file.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelOption } from "@/lib/model-options";

function modelOption(
  id: string,
  overrides: Partial<ModelOption> = {},
): ModelOption {
  return {
    id,
    isVariant: false,
    label: id,
    provider: id.split("/")[0] ?? "openai",
    shortLabel: id,
    source: "catalog",
    ...overrides,
  };
}

// The new file must export both components.
describe("models-preferences-section exports", () => {
  test("BT-001a: ModelPreferencesSection is exported from models-preferences-section", async () => {
    const mod = await import("./models-preferences-section");
    expect(typeof mod.ModelPreferencesSection).toBe("function");
  });

  test("BT-001b: ModelPreferencesSectionSkeleton is exported from models-preferences-section", async () => {
    const mod = await import("./models-preferences-section");
    expect(typeof mod.ModelPreferencesSectionSkeleton).toBe("function");
  });

  test("BT-001c: ModelPreferencesSectionSkeleton is a distinct named export (not undefined)", async () => {
    const mod = await import("./models-preferences-section");
    // Skeleton must be a separate named export, not the same reference as ModelPreferencesSection
    expect(mod.ModelPreferencesSectionSkeleton).not.toBe(
      mod.ModelPreferencesSection,
    );
  });
});

// BT-002: models/page.tsx must import from the new location.
describe("models page imports from models-preferences-section", () => {
  test("BT-002: page.tsx renders MODEL_PREFERENCES stub from models-preferences-section", async () => {
    mock.module("./models-preferences-section", () => ({
      ModelPreferencesSection: () => <div>MODEL_PREFS_FROM_NEW_LOCATION</div>,
      ModelPreferencesSectionSkeleton: () => <div>SKELETON_NEW</div>,
    }));
    mock.module("../inference-profiles-section", () => ({
      InferenceProfilesSection: () => <div>INFERENCE_STUB</div>,
      InferenceProfilesSectionSkeleton: () => <div>INFERENCE_SKEL</div>,
    }));
    mock.module("../model-variants-section", () => ({
      ModelVariantsSection: () => <div>VARIANTS_STUB</div>,
      ModelVariantsSectionSkeleton: () => <div>VARIANTS_SKEL</div>,
    }));

    const { default: ModelsPage } = await import("./page");
    const html = renderToStaticMarkup(<ModelsPage />);
    expect(html).toContain("MODEL_PREFS_FROM_NEW_LOCATION");
  });
});

describe("enabled model picker preferences", () => {
  const modelOptions = [
    modelOption("openai/gpt-5.5"),
    modelOption("anthropic/claude-opus-4.6"),
    modelOption("google/gemini-2.5-pro"),
  ];

  test("empty enabled model preference effectively shows every model", async () => {
    const { getEffectiveEnabledModelIdSet } =
      await import("./models-preferences-section");

    expect(
      Array.from(
        getEffectiveEnabledModelIdSet({
          enabledModelIds: new Set(),
          modelOptions,
        }),
      ),
    ).toEqual([
      "openai/gpt-5.5",
      "anthropic/claude-opus-4.6",
      "google/gemini-2.5-pro",
    ]);
  });

  test("selecting all known models serializes back to show-all preference", async () => {
    const { toEnabledModelPreferenceIds } =
      await import("./models-preferences-section");

    expect(
      toEnabledModelPreferenceIds({
        modelOptions,
        selectedModelIds: [
          "openai/gpt-5.5",
          "anthropic/claude-opus-4.6",
          "google/gemini-2.5-pro",
        ],
      }),
    ).toEqual([]);
  });

  test("selected subset serializes in live model order", async () => {
    const { toEnabledModelPreferenceIds } =
      await import("./models-preferences-section");

    expect(
      toEnabledModelPreferenceIds({
        modelOptions,
        selectedModelIds: [
          "google/gemini-2.5-pro",
          "openai/gpt-5.5",
          "stale/provider-model",
        ],
      }),
    ).toEqual(["openai/gpt-5.5", "google/gemini-2.5-pro"]);
  });

  test("keeps the model picker list short and prevents horizontal row overflow", async () => {
    const {
      ENABLED_MODELS_BULK_ACTION_LABELS,
      ENABLED_MODELS_LIST_CLASS_NAME,
      ENABLED_MODELS_ROW_CLASS_NAME,
    } = await import("./models-preferences-section");

    expect(ENABLED_MODELS_LIST_CLASS_NAME).toContain("max-h-[10.5rem]");
    expect(ENABLED_MODELS_LIST_CLASS_NAME).toContain("overflow-x-hidden");
    expect(ENABLED_MODELS_ROW_CLASS_NAME).toContain(
      "grid-cols-[auto_auto_minmax(0,1fr)_auto]",
    );
    expect(ENABLED_MODELS_ROW_CLASS_NAME).toContain("max-w-full");
    expect(ENABLED_MODELS_BULK_ACTION_LABELS).toEqual([
      "Select all",
      "Clear all",
    ]);
    expect(ENABLED_MODELS_BULK_ACTION_LABELS).not.toContain("Only visible");
    expect(ENABLED_MODELS_BULK_ACTION_LABELS).not.toContain("Show all");
  });

  test("clearing visible models preserves at least one selectable model", async () => {
    const { clearVisibleModelSelection } =
      await import("./models-preferences-section");

    expect(
      clearVisibleModelSelection({
        allModelIds: [
          "openai/gpt-5.5",
          "anthropic/claude-opus-4.6",
          "google/gemini-2.5-pro",
        ],
        currentSelectedIds: [
          "openai/gpt-5.5",
          "anthropic/claude-opus-4.6",
          "google/gemini-2.5-pro",
        ],
        visibleModelIds: ["openai/gpt-5.5", "anthropic/claude-opus-4.6"],
      }),
    ).toEqual(["google/gemini-2.5-pro"]);

    expect(
      clearVisibleModelSelection({
        allModelIds: ["openai/gpt-5.5", "anthropic/claude-opus-4.6"],
        currentSelectedIds: ["openai/gpt-5.5", "anthropic/claude-opus-4.6"],
        visibleModelIds: ["openai/gpt-5.5", "anthropic/claude-opus-4.6"],
      }),
    ).toEqual(["openai/gpt-5.5"]);
  });

  test("builds inference source filters from Vercel AI Gateway and user profiles", async () => {
    const { buildInferenceSourceOptions } =
      await import("./models-preferences-section");

    expect(
      buildInferenceSourceOptions([
        modelOption("openai/gpt-5.5"),
        modelOption("anthropic/claude-opus-4.6"),
        modelOption("user-profile:profile-fireworks:glm-5.2", {
          baseModelId: "glm-5.2",
          inferenceProfileId: "profile-fireworks",
          provider: "user",
          secondaryLabel: "Fireworks",
          source: "user",
        }),
        modelOption("user-profile:profile-zai:glm-4.6", {
          baseModelId: "glm-4.6",
          inferenceProfileId: "profile-zai",
          provider: "user",
          secondaryLabel: "ZAI",
          source: "user",
        }),
      ]),
    ).toEqual([
      { id: "all", label: "All inference sources", modelCount: 4 },
      { id: "gateway", label: "Vercel AI Gateway", modelCount: 2 },
      { id: "profile:profile-fireworks", label: "Fireworks", modelCount: 1 },
      { id: "profile:profile-zai", label: "ZAI", modelCount: 1 },
    ]);
  });

  test("filters model options by selected inference profile or Vercel AI Gateway", async () => {
    const {
      deriveModelProvidersForInferenceSource,
      filterModelOptionsByInferenceSource,
    } = await import("./models-preferences-section");
    const options = [
      modelOption("openai/gpt-5.5"),
      modelOption("anthropic/claude-opus-4.6"),
      modelOption("user-profile:profile-fireworks:glm-5.2", {
        baseModelId: "glm-5.2",
        inferenceProfileId: "profile-fireworks",
        provider: "user",
        secondaryLabel: "Fireworks",
        source: "user",
      }),
      modelOption("user-profile:profile-zai:glm-4.6", {
        baseModelId: "glm-4.6",
        inferenceProfileId: "profile-zai",
        provider: "user",
        secondaryLabel: "ZAI",
        source: "user",
      }),
    ];

    expect(
      filterModelOptionsByInferenceSource(options, "gateway").map(
        (option) => option.id,
      ),
    ).toEqual(["openai/gpt-5.5", "anthropic/claude-opus-4.6"]);
    expect(
      filterModelOptionsByInferenceSource(
        options,
        "profile:profile-fireworks",
      ).map((option) => option.id),
    ).toEqual(["user-profile:profile-fireworks:glm-5.2"]);
    expect(deriveModelProvidersForInferenceSource(options, "gateway")).toEqual([
      "anthropic",
      "openai",
    ]);
    expect(
      deriveModelProvidersForInferenceSource(
        options,
        "profile:profile-fireworks",
      ),
    ).toEqual(["user"]);
  });
});
