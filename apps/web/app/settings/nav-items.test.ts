import { describe, expect, test } from "bun:test";
import {
  findActiveNavItem,
  flattenNavItems,
  SETTINGS_NAV_GROUPS,
  visibleNavGroups,
} from "./nav-items";

describe("settings nav data", () => {
  test("groups are ordered Account, Tools, Insights, Admin", () => {
    expect(SETTINGS_NAV_GROUPS.map((g) => g.id)).toEqual([
      "account",
      "tools",
      "insights",
      "admin",
    ]);
  });

  test("each group maps to the expected item hrefs", () => {
    const byId = Object.fromEntries(
      SETTINGS_NAV_GROUPS.map((g) => [g.id, g.items.map((i) => i.href)]),
    );
    expect(byId.account).toEqual([
      "/settings/profile",
      "/settings/preferences",
      "/settings/connections",
    ]);
    expect(byId.tools).toEqual([
      "/settings/models",
      "/settings/composio",
      "/settings/background-agents",
    ]);
    expect(byId.insights).toEqual(["/settings/usage", "/settings/leaderboard"]);
    expect(byId.admin).toEqual(["/settings/admin"]);
  });

  test("admin group is flagged adminOnly and no group exceeds 7 items", () => {
    const admin = SETTINGS_NAV_GROUPS.find((g) => g.id === "admin");
    expect(admin?.adminOnly).toBe(true);
    for (const group of SETTINGS_NAV_GROUPS) {
      expect(group.items.length).toBeLessThanOrEqual(7);
    }
  });

  test("visibleNavGroups hides the admin group unless isAdmin", () => {
    expect(visibleNavGroups(false).map((g) => g.id)).not.toContain("admin");
    expect(visibleNavGroups(true).map((g) => g.id)).toContain("admin");
  });

  test("flattenNavItems lists every item once with unique ids", () => {
    const items = flattenNavItems();
    expect(items).toHaveLength(9);
    expect(new Set(items.map((i) => i.id)).size).toBe(9);
  });

  test("findActiveNavItem resolves exact and nested routes", () => {
    expect(findActiveNavItem("/settings/usage")?.id).toBe("usage");
    expect(findActiveNavItem("/settings/usage/2025")?.id).toBe("usage");
    expect(findActiveNavItem("/settings/profile")?.id).toBe("profile");
    expect(findActiveNavItem("/settings/nonexistent")).toBeUndefined();
  });
});
