import { describe, expect, test } from "bun:test";
import { getActiveWorkspaceNavigationItem } from "@/components/workspace-navigation";
import { findActiveNavItem, resolveSettingsFallbackRouteId } from "./nav-items";
import {
  getSettingsRouteMetadata,
  SETTINGS_ROUTE_METADATA,
} from "./settings-routes";

describe("Settings vocabulary compatibility (#964)", () => {
  test("stable Chat roles identifiers and URLs do not churn", () => {
    expect("chat-roles" in SETTINGS_ROUTE_METADATA).toBe(false);
    expect(getSettingsRouteMetadata("agents").href).toBe("/settings/agents");
    expect(findActiveNavItem("/settings/agents")?.id).toBe("agents");
  });

  test("legacy background settings keeps metadata while Automations owns nav", () => {
    const path = "/settings/background-agents/example";
    expect(findActiveNavItem(path)).toBeUndefined();
    expect(resolveSettingsFallbackRouteId(path)).toBe("background-agents");
    expect(getActiveWorkspaceNavigationItem(path)?.id).toBe("automations");
  });
});
