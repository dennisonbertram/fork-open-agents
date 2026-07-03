/**
 * Tests for composio-workspace-settings-panel.tsx (#799, finding B4).
 *
 * This repo's test setup has no DOM/testing-library and no DOM environment
 * registered for bun:test (see repo-selector-compact.test.tsx), so
 * useEffect-driven state (e.g. the panel's data-load effect that seeds
 * selectedToolkitSlugs from the fetched settings) never fires under
 * renderToStaticMarkup — only the first-paint useState initializer is
 * observable. That means the G6 null-preservation behavior (does an
 * unconfigured repo's null selectedToolkitSlugs get saved back as
 * `["github"]`?) cannot be honestly proven at the component level here;
 * it is proven at the pure-helper level instead in
 * composio-workspace-settings-panel-save-payload.test.ts (BT-WP-001..003),
 * which is unconditionally exercised by the component's savePolicy body.
 *
 * BT-WP-004: "Leaving this empty allows all connected profiles; it does not
 *   block any profile." copy is present near the profile-restriction control
 *   (finding B4) — this is static, unconditional JSX, so it IS observable
 *   under renderToStaticMarkup.
 */
import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/settings/composio-toolkit-picker", () => ({
  ComposioToolkitPicker: () => null,
}));

type RepositorySettings = {
  inheritGlobalDefaults: boolean;
  allowedProfileIds: string[];
  blockedToolkitSlugs: string[];
  agentDefaults: Record<string, unknown>;
  selectedToolkitSlugs: string[] | null;
};

let mockData: {
  profiles: Array<{ id: string; name: string; toolkitSlugs: string[] }>;
  profileOptions: Array<{
    id: string;
    name: string;
    available: boolean;
    disabledReason: string | null;
  }>;
  repositorySettings: RepositorySettings | null;
} | null = null;

mock.module("swr", () => ({
  default: () => ({
    data: mockData,
    error: null,
    isLoading: false,
    mutate: async () => mockData,
  }),
}));

const modulePromise = import("./composio-workspace-settings-panel");

describe("ComposioWorkspaceSettingsPanel — profile-restriction copy (B4)", () => {
  test("BT-WP-004: renders the 'empty allowlist = no restriction' copy near the profile-restriction control", async () => {
    mockData = {
      profiles: [],
      profileOptions: [],
      repositorySettings: null,
    };
    const { ComposioWorkspaceSettingsPanel } = await modulePromise;

    const html = renderToStaticMarkup(
      createElement(ComposioWorkspaceSettingsPanel, {
        repoOwner: "acme",
        repoName: "widgets",
      }),
    );

    expect(html).toContain("Leaving this empty allows all connected profiles");
    expect(html).toContain("it does not block any profile");
  });
});
