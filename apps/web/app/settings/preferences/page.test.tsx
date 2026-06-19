import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock heavy data-fetching sections so we test page composition, not data.
// Include all named exports from preferences-section so the mock is valid
// when run alongside other test files that share this module path.
mock.module("../preferences-section", () => ({
  PreferencesSection: () => <div>PREFERENCES_SECTION_STUB</div>,
  PreferencesSectionSkeleton: () => <div>PREFERENCES_SKELETON_STUB</div>,
  ModelPreferencesSection: () => <div>MODEL_PREFERENCES_SECTION_STUB</div>,
  ModelPreferencesSectionSkeleton: () => (
    <div>MODEL_PREFERENCES_SKELETON_STUB</div>
  ),
}));

describe("Preferences page", () => {
  test("renders SettingsPageHeader with title and plain-language description", async () => {
    const { default: PreferencesPage } = await import("./page");
    const html = renderToStaticMarkup(<PreferencesPage />);
    expect(html).toContain("Preferences");
    expect(html).toContain(
      "Tune how Open Agents behaves for you. Changes apply to new chats right away.",
    );
    expect(html).toContain("PREFERENCES_SECTION_STUB");
  });

  test("regression: uses shared SettingsPageHeader wrapper, not a bare inline h1", async () => {
    const { default: PreferencesPage } = await import("./page");
    const html = renderToStaticMarkup(<PreferencesPage />);
    // SettingsPageHeader renders <header …><div class="space-y-1"><h1 …>
    // A bare inline h1 would appear as the very first tag with no parent header element.
    // If someone reverts to a bare h1 without the description, this assertion catches it.
    expect(html).toContain("<header");
    expect(html).toContain(
      "Tune how Open Agents behaves for you. Changes apply to new chats right away.",
    );
  });
});
