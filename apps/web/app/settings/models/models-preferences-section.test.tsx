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

describe("model preference option ids", () => {
  test("encodes profile-backed main defaults for the combobox value", async () => {
    const mod = await import("./models-preferences-section");

    expect(
      mod.getSelectedDefaultModelOptionId(
        {
          defaultModelId: "cursor/composer-2.5",
          defaultInferenceProfileId: "profile-cursor",
        },
        [],
      ),
    ).toBe("user-profile:profile-cursor:cursor%2Fcomposer-2.5");
  });

  test("encodes profile-backed subagent defaults independently", async () => {
    const mod = await import("./models-preferences-section");

    expect(
      mod.getSelectedSubagentModelOptionId({
        defaultSubagentModelId: "openai-compatible/fugu-ultra",
        defaultSubagentInferenceProfileId: "profile-sakana",
      }),
    ).toBe("user-profile:profile-sakana:openai-compatible%2Ffugu-ultra");
  });

  test("decodes profile-backed main default updates", async () => {
    const mod = await import("./models-preferences-section");

    expect(
      mod.toDefaultModelPreferenceUpdate(
        "user-profile:profile-cursor:cursor%2Fcomposer-2.5",
      ),
    ).toEqual({
      defaultModelId: "cursor/composer-2.5",
      defaultInferenceProfileId: "profile-cursor",
    });
  });

  test("decodes profile-backed subagent updates and clears auto", async () => {
    const mod = await import("./models-preferences-section");

    expect(
      mod.toSubagentModelPreferenceUpdate(
        "user-profile:profile-sakana:openai-compatible%2Ffugu-mini",
      ),
    ).toEqual({
      defaultSubagentModelId: "openai-compatible/fugu-mini",
      defaultSubagentInferenceProfileId: "profile-sakana",
    });
    expect(mod.toSubagentModelPreferenceUpdate("auto")).toEqual({
      defaultSubagentModelId: null,
      defaultSubagentInferenceProfileId: null,
    });
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
