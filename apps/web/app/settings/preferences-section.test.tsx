/**
 * MR-4 (#812): Preferences must list the caller's own managed-runtime
 * profiles (scope=user_default), not just the built-ins, and group them
 * Built-in / Yours. Before this change, MANAGED_RUNTIME_PROFILE_OPTIONS was
 * built from listManagedRuntimeProfiles() (built-ins only), so a user who
 * created "Python 3.12" could never see it as a default-profile option.
 *
 * Radix Select renders its option list in a portal that is closed by
 * default, so renderToStaticMarkup cannot see dropdown items. These tests
 * exercise (1) the pure grouping helper that must source options from the
 * merged GET /api/settings/runtime-profiles response, and (2) the
 * description line that IS always rendered (outside the closed dropdown) so
 * a naive-user path is still covered end to end.
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
} = {
  data: {
    profiles: [
      {
        id: "web-bun-agent-browser",
        version: "1",
        displayName: "Web (Bun + Agent Browser)",
        description: "Built-in default",
        source: "built_in",
      },
    ],
  },
};

let userPreferencesState: {
  preferences: Record<string, unknown> | undefined;
  loading: boolean;
} = {
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
};

mock.module("@/app/providers", () => ({
  useTheme: () => ({ theme: "system", setTheme: () => {} }),
}));

mock.module("@/hooks/use-session", () => ({
  useSession: () => ({ session: { user: { username: "nico" } } }),
}));

mock.module("@/hooks/use-user-preferences", () => ({
  useUserPreferences: () => ({
    preferences: userPreferencesState.preferences,
    loading: userPreferencesState.loading,
    updatePreferences: async () => userPreferencesState.preferences,
  }),
}));

// Stub swr default export used for the merged runtime-profiles fetch.
mock.module("swr", () => ({
  default: (key: string | null) => {
    if (key && key.startsWith("/api/settings/runtime-profiles")) {
      return {
        data: runtimeProfilesSwrState.data,
        error: runtimeProfilesSwrState.error ?? null,
        isLoading: runtimeProfilesSwrState.isLoading ?? false,
      };
    }
    return { data: undefined, error: null, isLoading: false };
  },
}));

const sectionModulePromise = import("./preferences-section");
const helpersModulePromise = import("./preferences-helpers");

function resetState() {
  runtimeProfilesSwrState = {
    data: {
      profiles: [
        {
          id: "web-bun-agent-browser",
          version: "1",
          displayName: "Web (Bun + Agent Browser)",
          description: "Built-in default",
          source: "built_in",
        },
      ],
    },
  };
  userPreferencesState = {
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
  };
}

describe("PreferencesSection — merged runtime profiles (MR-4/#812)", () => {
  beforeEach(resetState);

  // BT: groupRuntimeProfileOptions must expose a user_default profile from
  // the merged endpoint, grouped separately from built-ins — fails today
  // because no such helper exists (the component hardcodes built-ins only).
  test("MR-4/#812: groupRuntimeProfileOptions splits built_in and user_default profiles into labeled groups", async () => {
    const { groupRuntimeProfileOptions } = await helpersModulePromise;

    const groups = groupRuntimeProfileOptions([
      {
        id: "web-bun-agent-browser",
        displayName: "Web (Bun + Agent Browser)",
        source: "built_in",
      },
      {
        id: "user-profile-python312",
        displayName: "Python 3.12",
        source: "user_default",
      },
    ]);

    expect(groups).toEqual([
      {
        label: "Built-in",
        options: [
          { id: "web-bun-agent-browser", name: "Web (Bun + Agent Browser)" },
        ],
      },
      {
        label: "Yours",
        options: [{ id: "user-profile-python312", name: "Python 3.12" }],
      },
    ]);
  });

  // BT: when the user's saved default is a user_default profile, its
  // description renders in Preferences (proves the component actually reads
  // from the merged fetch, not the built-ins-only constant).
  test("MR-4/#812: renders the description of a selected user_default default profile", async () => {
    runtimeProfilesSwrState.data = {
      profiles: [
        {
          id: "web-bun-agent-browser",
          version: "1",
          displayName: "Web (Bun + Agent Browser)",
          description: "Built-in default",
          source: "built_in",
        },
        {
          id: "user-profile-python312",
          version: "created-1",
          displayName: "Python 3.12",
          description: "My custom Python profile description",
          source: "user_default",
        },
      ],
    };
    userPreferencesState.preferences = {
      ...userPreferencesState.preferences,
      defaultManagedRuntimeProfileId: "user-profile-python312",
    };

    const { PreferencesSection } = await sectionModulePromise;
    const html = renderToStaticMarkup(<PreferencesSection />);

    expect(html).toContain("My custom Python profile description");
  });
});
