import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getSettingsRouteMetadata,
  SETTINGS_ROUTE_METADATA,
  type SettingsRouteId,
} from "./settings-routes";

mock.module("server-only", () => ({}));

mock.module("./preferences-section", () => ({
  PreferencesSection: () => <div>PREFERENCES_SECTION_STUB</div>,
  PreferencesSectionSkeleton: () => <div>PREFERENCES_SKELETON_STUB</div>,
  ModelPreferencesSection: () => <div>MODEL_PREFERENCES_SECTION_STUB</div>,
  ModelPreferencesSectionSkeleton: () => (
    <div>MODEL_PREFERENCES_SKELETON_STUB</div>
  ),
}));

mock.module("./leaderboard-section", () => ({
  LeaderboardSection: () => <div>LEADERBOARD_SECTION_STUB</div>,
  LeaderboardSectionSkeleton: () => <div>LEADERBOARD_SKELETON_STUB</div>,
}));

mock.module("./profile/profile-content", () => ({
  ProfileContent: () => <div>PROFILE_CONTENT_STUB</div>,
}));

describe("settings route metadata", () => {
  test("covers the settings routes that render pages", () => {
    expect(Object.keys(SETTINGS_ROUTE_METADATA).sort()).toEqual([
      "admin",
      "agents",
      "background-agents",
      "composio",
      "connections",
      "leaderboard",
      "mcp",
      "models",
      "preferences",
      "profile",
      "runtime-profiles",
      "skills",
      "usage",
    ]);
  });

  test.each([
    "preferences",
    "leaderboard",
    "profile",
  ] satisfies SettingsRouteId[])(
    "%s loading and loaded headers use shared title and description",
    async (routeId) => {
      const meta = getSettingsRouteMetadata(routeId);
      const loadedHtml = await renderLoadedRoute(routeId);
      const loadingHtml = await renderLoadingRoute(routeId);

      for (const html of [loadedHtml, loadingHtml]) {
        expect(html).toContain("<header");
        expect(html).toContain(meta.title);
        expect(html).toContain(meta.description);
      }
    },
  );
});

async function renderLoadedRoute(routeId: SettingsRouteId) {
  if (routeId === "preferences") {
    const { default: PreferencesPage } = await import("./preferences/page");
    return renderToStaticMarkup(<PreferencesPage />);
  }
  if (routeId === "leaderboard") {
    const { default: LeaderboardPage } = await import("./leaderboard/page");
    return renderToStaticMarkup(<LeaderboardPage />);
  }
  if (routeId === "profile") {
    const { default: ProfilePage } = await import("./profile/page");
    return renderToStaticMarkup(<ProfilePage />);
  }
  throw new Error(`Unsupported route: ${routeId}`);
}

async function renderLoadingRoute(routeId: SettingsRouteId) {
  if (routeId === "preferences") {
    const { default: PreferencesLoading } =
      await import("./preferences/loading");
    return renderToStaticMarkup(<PreferencesLoading />);
  }
  if (routeId === "leaderboard") {
    const { default: LeaderboardLoading } =
      await import("./leaderboard/loading");
    return renderToStaticMarkup(<LeaderboardLoading />);
  }
  if (routeId === "profile") {
    const { default: ProfileLoading } = await import("./profile/loading");
    return renderToStaticMarkup(<ProfileLoading />);
  }
  throw new Error(`Unsupported route: ${routeId}`);
}
