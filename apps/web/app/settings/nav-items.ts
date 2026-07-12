import type { LucideIcon } from "lucide-react";
import {
  getSettingsRouteMetadata,
  type SettingsRouteId,
} from "./settings-routes";

export type SettingsNavItem = {
  id: SettingsRouteId;
  label: string;
  href: string;
  icon: LucideIcon;
};

export type SettingsNavGroup = {
  id: string;
  label: string;
  items: SettingsNavItem[];
  /** Rendered only for workspace admins. */
  adminOnly?: boolean;
};

function settingsNavItem(id: SettingsRouteId): SettingsNavItem {
  const route = getSettingsRouteMetadata(id);
  return {
    id,
    label: route.title,
    href: route.href,
    icon: route.icon,
  };
}

/**
 * Single source of truth for the settings navigation. Grouped by scope
 * (personal → shared → operator) so the rail reads as a map, not a flat pile.
 */
export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "account",
    label: "Account",
    items: [
      settingsNavItem("profile"),
      settingsNavItem("preferences"),
      settingsNavItem("connections"),
      settingsNavItem("usage"),
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    items: [
      settingsNavItem("agents"),
      settingsNavItem("models"),
      settingsNavItem("composio"),
      settingsNavItem("mcp"),
      settingsNavItem("skills"),
      settingsNavItem("repositories"),
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    items: [
      settingsNavItem("runtime-profiles"),
      settingsNavItem("learnings"),
      settingsNavItem("leaderboard"),
    ],
  },
  {
    id: "admin",
    label: "Admin",
    adminOnly: true,
    items: [settingsNavItem("admin")],
  },
];

/** Groups visible to the current user (admin-only groups require isAdmin). */
export function visibleNavGroups(
  isAdmin: boolean,
  groups = SETTINGS_NAV_GROUPS,
) {
  return groups.filter(
    (group) => group.items.length > 0 && (!group.adminOnly || isAdmin),
  );
}

export function flattenNavItems(groups = SETTINGS_NAV_GROUPS) {
  return groups.flatMap((group) => group.items);
}

/**
 * Resolve the active nav item for a pathname. Matches exact hrefs and nested
 * routes (e.g. `/settings/usage/foo` highlights "Usage").
 */
export function findActiveNavItem(
  pathname: string,
  groups = SETTINGS_NAV_GROUPS,
) {
  const items = flattenNavItems(groups);
  return items.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

/**
 * Resolve metadata for the Settings auth-loading fallback. External product
 * destinations may own nav state without being SettingsRouteId values.
 */
export function resolveSettingsFallbackRouteId(
  pathname: string,
  groups = SETTINGS_NAV_GROUPS,
): SettingsRouteId {
  if (
    pathname === "/settings/background-agents" ||
    pathname.startsWith("/settings/background-agents/")
  ) {
    return "background-agents";
  }
  const activeId = findActiveNavItem(pathname, groups)?.id;
  return activeId ?? "profile";
}
