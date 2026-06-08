import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock heavy data-fetching sections so we test page composition, not data.
mock.module("../preferences-section", () => ({
  PreferencesSection: () => <div>PREFERENCES_SECTION_STUB</div>,
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
});
