import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock heavy data-fetching sections so we test page composition, not data.
mock.module("../preferences-section", () => ({
  PreferencesSection: () => <div>PREFERENCES_SECTION_STUB</div>,
  PreferencesSectionSkeleton: () => <div>PREFERENCES_SKELETON_STUB</div>,
  ModelPreferencesSection: () => <div>MODEL_PREFERENCES_SECTION_STUB</div>,
  ModelPreferencesSectionSkeleton: () => <div>MODEL_PREFERENCES_SKELETON_STUB</div>,
}));

mock.module("../inference-profiles-section", () => ({
  InferenceProfilesSection: () => <div>INFERENCE_PROFILES_SECTION_STUB</div>,
}));

mock.module("../model-variants-section", () => ({
  ModelVariantsSection: () => <div>MODEL_VARIANTS_SECTION_STUB</div>,
}));

describe("Models page", () => {
  test("renders SettingsPageHeader with title and plain-language description", async () => {
    const { default: ModelsPage } = await import("./page");
    const html = renderToStaticMarkup(<ModelsPage />);
    expect(html).toContain("Models");
    expect(html).toContain(
      "Pick the models your agents use and create named setups for specific jobs.",
    );
    expect(html).toContain("MODEL_PREFERENCES_SECTION_STUB");
    expect(html).toContain("INFERENCE_PROFILES_SECTION_STUB");
    expect(html).toContain("MODEL_VARIANTS_SECTION_STUB");
  });
});
