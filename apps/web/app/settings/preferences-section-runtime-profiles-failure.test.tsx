/**
 * #1092: PreferencesSection dropped the runtime-profiles SWR `error`, so a
 * failed fetch fell back to `[]` and the Default runtime profile control
 * confidently reported "None / No options available" — built-in profiles
 * always exist server-side, so that statement is always wrong.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

type ProfileOption = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  source: "built_in" | "user_default";
};

let runtimeProfilesSwrState: {
  data?: { profiles: ProfileOption[] };
  error?: Error | null;
  isLoading?: boolean;
} = {};

mock.module("@/app/providers", () => ({
  useTheme: () => ({ theme: "system", setTheme: () => {} }),
}));

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({ session: { user: { username: "nico" } } }),
}));

mock.module("@/hooks/use-user-preferences", () => ({
  useUserPreferences: () => ({
    preferences: {
      defaultSandboxType: "vercel",
      defaultManagedRuntimeProfileId: "web-bun-agent-browser",
      defaultDiffMode: "unified",
      autoCommitPush: false,
      autoCreatePr: false,
      alertsEnabled: true,
      alertSoundEnabled: true,
      publicUsageEnabled: false,
      globalSkillRefs: [],
    },
    loading: false,
    updatePreferences: async () => ({}),
  }),
}));

mock.module("swr", () => ({
  default: (key: string | null) => {
    if (key?.startsWith("/api/settings/runtime-profiles")) {
      return {
        data: runtimeProfilesSwrState.data,
        error: runtimeProfilesSwrState.error ?? null,
        isLoading: runtimeProfilesSwrState.isLoading ?? false,
        mutate: () => {},
      };
    }
    return { data: undefined, error: null, isLoading: false, mutate: () => {} };
  },
}));

const sectionModulePromise = import("./preferences-section");

describe("PreferencesSection runtime-profiles load failure (#1092)", () => {
  beforeEach(() => {
    runtimeProfilesSwrState = {};
  });

  test('failed fetch renders a load failure, not "No options available"', async () => {
    runtimeProfilesSwrState = { error: new Error("boom") };

    const { PreferencesSection } = await sectionModulePromise;
    const html = renderToStaticMarkup(<PreferencesSection />);

    expect(html).toContain("Failed to load runtime profiles");
    expect(html).not.toContain("No options available");
  });

  test("a genuinely empty profile list still reports no options", async () => {
    runtimeProfilesSwrState = { data: { profiles: [] } };

    const { PreferencesSection } = await sectionModulePromise;
    const html = renderToStaticMarkup(<PreferencesSection />);

    expect(html).toContain("No options available");
    expect(html).not.toContain("Failed to load runtime profiles");
  });
});
