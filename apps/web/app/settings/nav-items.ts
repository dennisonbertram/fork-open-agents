import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Blocks,
  Bot,
  Boxes,
  Cable,
  ShieldAlert,
  SlidersHorizontal,
  Trophy,
  User,
  Users,
} from "lucide-react";

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

/**
 * Single source of truth for the settings navigation. Grouped by scope
 * (personal → shared → operator) so the rail reads as a map, not a flat pile.
 */
export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "account",
    label: "Account",
    items: [
      {
        id: "profile",
        label: "Profile",
        href: "/settings/profile",
        icon: User,
      },
      {
        id: "preferences",
        label: "Preferences",
        href: "/settings/preferences",
        icon: SlidersHorizontal,
      },
      {
        id: "connections",
        label: "Connections",
        href: "/settings/connections",
        icon: Cable,
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [
      {
        id: "agents",
        label: "Agents",
        href: "/settings/agents",
        icon: Users,
      },
      { id: "models", label: "Models", href: "/settings/models", icon: Boxes },
      {
        id: "composio",
        label: "Composio",
        href: "/settings/composio",
        icon: Blocks,
      },
      {
        id: "background-agents",
        label: "Background agents",
        href: "/settings/background-agents",
        icon: Bot,
      },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      { id: "usage", label: "Usage", href: "/settings/usage", icon: BarChart3 },
      {
        id: "leaderboard",
        label: "Leaderboard",
        href: "/settings/leaderboard",
        icon: Trophy,
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    adminOnly: true,
    items: [
      {
        id: "admin",
        label: "Admin",
        href: "/settings/admin",
        icon: ShieldAlert,
      },
    ],
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
  return flattenNavItems(groups).find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
