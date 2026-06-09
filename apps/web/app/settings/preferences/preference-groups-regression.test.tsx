/**
 * Regression tests for preference-groups.ts and the models extraction.
 *
 * These tests catch future breakage if:
 * - The 6-group structure is collapsed back to a single "General" group.
 * - The sandbox-vs-profile clarification is removed.
 * - The auto-PR caption is removed (so the disabled state is the only signal).
 * - The Skills precedence note is removed.
 * - ModelPreferencesSection is defined back in preferences-section.tsx
 *   instead of being re-exported from models-preferences-section.tsx.
 * - The models/page.tsx import source reverts to ../preferences-section.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PREFERENCE_GROUPS } from "../preferences/preference-groups";

describe("preference-groups regression", () => {
  test("regression: no 'General' group title — the old single-catch-all was removed", () => {
    const general = PREFERENCE_GROUPS.find(
      (g) => g.title.toLowerCase() === "general",
    );
    expect(general).toBeUndefined();
  });

  test("regression: every group title is sentence-case (no ALL CAPS or ALL Title Case outliers)", () => {
    for (const group of PREFERENCE_GROUPS) {
      // First character must be uppercase; subsequent words must NOT all be capitalized.
      // We check that the title is not fully Title Case by verifying at least the
      // last word (if multi-word) is lower-case.
      const words = group.title.split(" ");
      if (words.length > 1) {
        // At least one non-first word should start lowercase (sentence case).
        const hasLowerWord = words.slice(1).some((w) => {
          const firstChar = w[0];
          return (
            firstChar !== undefined && firstChar === firstChar.toLowerCase()
          );
        });
        expect(hasLowerWord).toBe(true);
      }
    }
  });

  test("regression: sandbox helper copy still distinguishes sandbox from runtime profile", () => {
    const defaultsGroup = PREFERENCE_GROUPS.find(
      (g) => g.title === "Defaults for new chats",
    );
    // This sentence must remain — it's the key disambiguation for users.
    expect(defaultsGroup?.sandboxVsProfileCaption).toContain("runtime profile");
    expect(defaultsGroup?.sandboxVsProfileCaption).toContain("sandbox");
  });

  test("regression: auto-PR caption is present (not only relying on disabled state)", () => {
    const gitGroup = PREFERENCE_GROUPS.find(
      (g) => g.title === "Git automation",
    );
    // If the caption is removed, the user sees no explanation for why the toggle is greyed.
    expect(typeof gitGroup?.autoCreatePrCaption).toBe("string");
    expect((gitGroup?.autoCreatePrCaption ?? "").length).toBeGreaterThan(0);
  });

  test("regression: skills precedence caption mentions repo", () => {
    const skillsGroup = PREFERENCE_GROUPS.find((g) => g.title === "Skills");
    // This sentence prevents the confusion "which version wins?".
    expect(skillsGroup?.precedenceCaption).toContain("repo");
  });
});

// Regression: ModelPreferencesSection and ModelPreferencesSectionSkeleton must
// be exported from models-preferences-section.tsx (not only from preferences-section.tsx).
describe("model section extraction regression", () => {
  test("regression: ModelPreferencesSection is the canonical export from models-preferences-section", async () => {
    const mod = await import("../models/models-preferences-section");
    expect(typeof mod.ModelPreferencesSection).toBe("function");
    expect(typeof mod.ModelPreferencesSectionSkeleton).toBe("function");
  });

  test("regression: models/page.tsx renders stub injected via models-preferences-section mock", async () => {
    mock.module("../models/models-preferences-section", () => ({
      ModelPreferencesSection: () => <div>REGRESSION_MODEL_PREFS_STUB</div>,
      ModelPreferencesSectionSkeleton: () => <div>REGRESSION_SKEL</div>,
    }));
    mock.module("../inference-profiles-section", () => ({
      InferenceProfilesSection: () => <div>INF_STUB</div>,
      InferenceProfilesSectionSkeleton: () => <div>INF_SKEL</div>,
    }));
    mock.module("../model-variants-section", () => ({
      ModelVariantsSection: () => <div>VAR_STUB</div>,
      ModelVariantsSectionSkeleton: () => <div>VAR_SKEL</div>,
    }));

    const { default: ModelsPage } = await import("../models/page");
    const html = renderToStaticMarkup(<ModelsPage />);
    // If page.tsx reverts to ../preferences-section, this stub won't show.
    expect(html).toContain("REGRESSION_MODEL_PREFS_STUB");
  });
});
