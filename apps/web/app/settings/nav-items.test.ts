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
      "/settings/agents",
      "/settings/models",
      "/settings/composio",
      "/settings/mcp",
      "/settings/skills",
      "/automations",
      "/settings/repositories",
      "/settings/runtime-profiles",
    ]);
    expect(byId.insights).toEqual([
      "/settings/usage",
      "/settings/leaderboard",
      "/settings/learnings",
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
    expect(visibleNavGroups(false).map((g) => g.id)).not.toContain("admin");
    expect(visibleNavGroups(true).map((g) => g.id)).toContain("admin");
  });

  test("flattenNavItems lists every item once with unique ids", () => {
    const items = flattenNavItems();
    expect(items).toHaveLength(15);
    expect(new Set(items.map((i) => i.id)).size).toBe(15);
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
  });

  // NAV-002: agents item is in the tools group
  test("NAV-002: agents item is in the tools group and is the first item", () => {
    const toolsGroup = SETTINGS_NAV_GROUPS.find((g) => g.id === "tools");
    expect(toolsGroup).toBeDefined();
    expect(toolsGroup?.items[0]?.id).toBe("agents");
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

    const toolsGroup = SETTINGS_NAV_GROUPS.find((g) => g.id === "tools");
    expect(toolsGroup?.items.map((i) => i.id)).toContain("skills");
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

  // NAV-007: runtime-profiles is in the tools group
  test("NAV-007: runtime-profiles item is in the tools group", () => {
    const toolsGroup = SETTINGS_NAV_GROUPS.find((g) => g.id === "tools");
    const ids = toolsGroup?.items.map((i) => i.id);
    expect(ids).toContain("runtime-profiles");
  });

  test("NAV-008: legacy definition routes remain direct-only", () => {
    expect(findActiveNavItem("/loops")).toBeUndefined();
    expect(findActiveNavItem("/settings/background-agents")?.id).toBe(
      "automations",
    );
  });

  test("NAV-008b: legacy Automation alias retains valid Settings fallback metadata", () => {
    expect(
      resolveSettingsFallbackRouteId("/settings/background-agents"),
    ).toBe("background-agents");
    expect(resolveSettingsFallbackRouteId("/settings/usage")).toBe("usage");
    expect(resolveSettingsFallbackRouteId("/settings/nonexistent")).toBe(
      "profile",
    );
  });

  test("NAV-012: Automations replaces duplicate background-agent and Loops entries", () => {
    const toolsGroup = SETTINGS_NAV_GROUPS.find(
      (group) => group.id === "tools",
    );
    const ids = toolsGroup?.items.map((item) => item.id);

    expect(ids).toContain("automations");
    expect(ids).not.toContain("background-agents");
    expect(ids).not.toContain("loops");
    expect(findActiveNavItem("/automations")?.label).toBe("Automations");
  });

  // NAV-010 (#805): Repositories item exists in the tools group and points
  // at the repositories index route.
  test("NAV-010: repositories item is present in the tools group with href /settings/repositories", () => {
    const item = findActiveNavItem("/settings/repositories");
    expect(item?.id).toBe("repositories");
    expect(item?.href).toBe("/settings/repositories");

    const toolsGroup = SETTINGS_NAV_GROUPS.find((g) => g.id === "tools");
    expect(toolsGroup?.items.map((i) => i.id)).toContain("repositories");
  });

  // NAV-011 (#805): nested per-repo routes still resolve to the same nav item.
  test("NAV-011: repositories item is active for nested per-repo routes", () => {
    const item = findActiveNavItem("/settings/repositories/acme/widgets");
    expect(item?.id).toBe("repositories");
  });

  test("learnings item lives in Insights and uses its route slug for active matching", () => {
    const item = findActiveNavItem("/settings/learnings");
    expect(item?.id).toBe("learnings");
    expect(item?.href).toBe("/settings/learnings");
    expect(item?.icon).toBe(Lightbulb);

    const insightsGroup = SETTINGS_NAV_GROUPS.find((g) => g.id === "insights");
    expect(insightsGroup?.items.map((i) => i.id)).toContain("learnings");
  });
});
