import { describe, expect, test } from "bun:test";
import { Bot, Cpu, Lightbulb, Sparkles, Users } from "lucide-react";
import {
  findActiveNavItem,
  flattenNavItems,
  resolveSettingsFallbackRouteId,
  SETTINGS_NAV_GROUPS,
  visibleNavGroups,
} from "./nav-items";

// #805: Repositories item must exist and resolve to the effective-status
// view once a repo is chosen (behavior contract: "/settings nav includes a
// Repositories entry that reaches the same effective-status view").

describe("settings nav data", () => {
  test("groups are ordered Account, Workspace, Advanced, Admin", () => {
    expect(SETTINGS_NAV_GROUPS.map((g) => g.id)).toEqual([
      "account",
      "workspace",
      "advanced",
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
      "/settings/usage",
    ]);
    expect(byId.workspace).toEqual([
      "/settings/agents",
      "/settings/models",
      "/settings/composio",
      "/settings/mcp",
      "/settings/skills",
      "/settings/repositories",
    ]);
    expect(byId.advanced).toEqual([
      "/settings/runtime-profiles",
      "/settings/learnings",
      "/settings/leaderboard",
    ]);
    expect(byId.admin).toEqual(["/settings/admin"]);
  });

  test("admin group is flagged adminOnly and no group exceeds 10 items", () => {
    const admin = SETTINGS_NAV_GROUPS.find((g) => g.id === "admin");
    expect(admin?.adminOnly).toBe(true);
    for (const group of SETTINGS_NAV_GROUPS) {
      expect(group.items.length).toBeLessThanOrEqual(10);
    }
  });

  test("visibleNavGroups hides the admin group unless isAdmin", () => {
    expect(visibleNavGroups(false).map((g) => g.id)).toEqual([
      "account",
      "workspace",
      "advanced",
    ]);
    expect(visibleNavGroups(true).map((g) => g.id)).toEqual([
      "account",
      "workspace",
      "advanced",
      "admin",
    ]);
  });

  test("visibleNavGroups removes empty groups", () => {
    expect(
      visibleNavGroups(false, [
        ...SETTINGS_NAV_GROUPS,
        { id: "empty", label: "Empty", items: [] },
      ]).map((group) => group.id),
    ).not.toContain("empty");
  });

  test("flattenNavItems lists every item once with unique ids", () => {
    const items = flattenNavItems();
    expect(items).toHaveLength(14);
    expect(new Set(items.map((i) => i.id)).size).toBe(14);
  });

  test("findActiveNavItem resolves exact and nested routes", () => {
    expect(findActiveNavItem("/settings/usage")?.id).toBe("usage");
    expect(findActiveNavItem("/settings/usage/2025")?.id).toBe("usage");
    expect(findActiveNavItem("/settings/profile")?.id).toBe("profile");
    expect(findActiveNavItem("/settings/nonexistent")).toBeUndefined();
  });

  // NAV-001: agents item resolves correctly
  test("NAV-001: findActiveNavItem resolves /settings/agents to the agents item", () => {
    const item = findActiveNavItem("/settings/agents");
    expect(item?.id).toBe("agents");
    expect(item?.href).toBe("/settings/agents");
    expect(item?.label).toBe("Chat roles");
  });

  // NAV-002: agents item is in the workspace group
  test("NAV-002: agents item is in the workspace group and is the first item", () => {
    const workspaceGroup = SETTINGS_NAV_GROUPS.find(
      (g) => g.id === "workspace",
    );
    expect(workspaceGroup).toBeDefined();
    expect(workspaceGroup?.items[0]?.id).toBe("agents");
  });

  // NAV-003: chat roles remain visually distinct from unattended Automations.
  test("NAV-003: agents item uses Users icon (not Bot)", () => {
    const item = findActiveNavItem("/settings/agents");
    // Verify by reference equality — lucide icons don't expose .name
    expect(item?.icon).toBe(Users);
    expect(item?.icon).not.toBe(Bot);
  });

  // NAV-004: skills item lives in the tools group with the Sparkles icon
  test("NAV-004: skills item resolves to the tools group with Sparkles icon", () => {
    const item = findActiveNavItem("/settings/skills");
    expect(item?.id).toBe("skills");
    expect(item?.href).toBe("/settings/skills");
    expect(item?.icon).toBe(Sparkles);

    const workspaceGroup = SETTINGS_NAV_GROUPS.find(
      (g) => g.id === "workspace",
    );
    expect(workspaceGroup?.items.map((i) => i.id)).toContain("skills");
  });

  // NAV-005: runtime-profiles item resolves correctly and is in Tools group
  test("NAV-005: runtime-profiles item resolves to the correct href and label", () => {
    const item = findActiveNavItem("/settings/runtime-profiles");
    expect(item?.id).toBe("runtime-profiles");
    expect(item?.href).toBe("/settings/runtime-profiles");
    expect(item?.label).toBe("Runtime profiles");
  });

  // NAV-006: runtime-profiles uses Cpu icon (distinct from other tools icons)
  test("NAV-006: runtime-profiles item uses Cpu icon", () => {
    const item = findActiveNavItem("/settings/runtime-profiles");
    expect(item?.icon).toBe(Cpu);
  });

  // NAV-007: runtime-profiles is in the advanced group
  test("NAV-007: runtime-profiles item is in the advanced group", () => {
    const advancedGroup = SETTINGS_NAV_GROUPS.find((g) => g.id === "advanced");
    const ids = advancedGroup?.items.map((i) => i.id);
    expect(ids).toContain("runtime-profiles");
  });

  test("NAV-008: legacy definition routes remain direct-only", () => {
    expect(findActiveNavItem("/loops")).toBeUndefined();
    expect(findActiveNavItem("/settings/background-agents")).toBeUndefined();
  });

  test("NAV-008b: legacy Automation alias retains valid Settings fallback metadata", () => {
    expect(resolveSettingsFallbackRouteId("/settings/background-agents")).toBe(
      "background-agents",
    );
    expect(resolveSettingsFallbackRouteId("/settings/usage")).toBe("usage");
    expect(resolveSettingsFallbackRouteId("/settings/nonexistent")).toBe(
      "profile",
    );
  });

  test("NAV-012: top-level navigation owns Automations without a duplicate Settings entry", () => {
    const workspaceGroup = SETTINGS_NAV_GROUPS.find(
      (group) => group.id === "workspace",
    );
    const ids = workspaceGroup?.items.map((item) => item.id);

    expect(ids).not.toContain("automations");
    expect(ids).not.toContain("background-agents");
    expect(ids).not.toContain("loops");
    expect(findActiveNavItem("/automations")).toBeUndefined();
  });

  // NAV-010 (#805): Repositories item exists in the tools group and points
  // at the repositories index route.
  test("NAV-010: repositories item is present in the tools group with href /settings/repositories", () => {
    const item = findActiveNavItem("/settings/repositories");
    expect(item?.id).toBe("repositories");
    expect(item?.href).toBe("/settings/repositories");

    expect(item?.label).toBe("Repository settings");

    const workspaceGroup = SETTINGS_NAV_GROUPS.find(
      (g) => g.id === "workspace",
    );
    expect(workspaceGroup?.items.map((i) => i.id)).toContain("repositories");
  });

  // NAV-011 (#805): nested per-repo routes still resolve to the same nav item.
  test("NAV-011: repositories item is active for nested per-repo routes", () => {
    const item = findActiveNavItem("/settings/repositories/acme/widgets");
    expect(item?.id).toBe("repositories");
  });

  test("learnings item lives in Advanced and uses its route slug for active matching", () => {
    const item = findActiveNavItem("/settings/learnings");
    expect(item?.id).toBe("learnings");
    expect(item?.href).toBe("/settings/learnings");
    expect(item?.icon).toBe(Lightbulb);

    const advancedGroup = SETTINGS_NAV_GROUPS.find((g) => g.id === "advanced");
    expect(advancedGroup?.items.map((i) => i.id)).toContain("learnings");
  });

  test("non-admin active matching cannot resolve the Admin item", () => {
    expect(
      findActiveNavItem("/settings/admin", visibleNavGroups(false)),
    ).toBeUndefined();
    expect(
      findActiveNavItem("/settings/admin", visibleNavGroups(true))?.id,
    ).toBe("admin");
  });
});
