import type { LucideIcon } from "lucide-react";
import { Workflow } from "lucide-react";
import {
  getSettingsRouteMetadata,
  type SettingsRouteId,
} from "./settings-routes";

export type SettingsNavItem = {
  id: string;
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
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [
      settingsNavItem("agents"),
      settingsNavItem("models"),
      settingsNavItem("composio"),
      settingsNavItem("mcp"),
      settingsNavItem("skills"),
      {
        id: "automations",
        label: "Automations",
        href: "/automations",
        icon: Workflow,
      },
      settingsNavItem("repositories"),
      settingsNavItem("runtime-profiles"),
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      settingsNavItem("usage"),
      settingsNavItem("leaderboard"),
      settingsNavItem("learnings"),
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
  return groups.filter((group) => !group.adminOnly || isAdmin);
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
  if (
    pathname === "/settings/background-agents" ||
    pathname.startsWith("/settings/background-agents/")
  ) {
    return items.find((item) => item.id === "automations");
  }
  return items.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
