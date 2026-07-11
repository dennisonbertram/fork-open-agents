/**
 * Contract tests for sessions sidebar toggle affordances.
 *
 * The sessions sidebar uses collapsible="icon": the panel collapses to a
 * narrow desktop rail.  The rail affordances own the toggle contract:
 *   - "collapse": shown in the sidebar header (visible when expanded).
 *   - "expand": shown in the sidebar rail (visible when collapsed).
 *
 * These tests catch future breakage if aria-labels or tooltip text are blanked
 * out, actions are removed, or the helper returns a shared mutable array.
 *
 * Companion implementation files:
 *   apps/web/app/sessions/sessions-route-shell.tsx  (collapsible="icon")
 *   apps/web/components/inbox-sidebar.tsx (expanded header + collapsed rail)
 */
import { describe, expect, test } from "bun:test";
import {
  getCollapsedRepoRailActions,
  getSidebarToggleActions,
  type CollapsedRepoRailAction,
  type SidebarToggleAction,
  getCollapsedRailActions,
  type CollapsedRailAction,
} from "./inbox-sidebar-rail-actions";

// ---------------------------------------------------------------------------
// Expanded sidebar toggle contract
// ---------------------------------------------------------------------------

describe("getSidebarToggleActions", () => {
  test("RAIL-001: returns the expanded collapse action only", () => {
    const actions = getSidebarToggleActions();
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("collapse");
    expect(ids).not.toContain("open");
  });

  test("RAIL-002: collapse is the first action", () => {
    const actions = getSidebarToggleActions();
    expect(actions[0]?.id).toBe("collapse");
  });

  test("RAIL-003: returns exactly 1 action", () => {
    const actions = getSidebarToggleActions();
    expect(actions).toHaveLength(1);
  });

  test("RAIL-004: every action has a non-empty ariaLabel and tooltip", () => {
    const actions = getSidebarToggleActions();
    for (const action of actions) {
      expect(action.ariaLabel.length).toBeGreaterThan(0);
      expect(action.tooltip.length).toBeGreaterThan(0);
    }
  });

  test("RAIL-005: action ids are unique", () => {
    const actions = getSidebarToggleActions();
    const ids = actions.map((a: SidebarToggleAction) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(actions.length);
  });

  test("RAIL-006: collapse action mentions collapse or close", () => {
    const actions = getSidebarToggleActions();
    const col = actions.find((a) => a.id === "collapse");
    expect(col).toBeDefined();
    const combined =
      `${col?.tooltip ?? ""}${col?.ariaLabel ?? ""}`.toLowerCase();
    expect(combined).toMatch(/collapse|close/);
  });

  test("RAIL-007: calling getSidebarToggleActions twice returns independent arrays", () => {
    const first = getSidebarToggleActions();
    const second = getSidebarToggleActions();
    (first as unknown as Record<string, unknown>[])[0] = { id: "injected" };
    expect(second[0]?.id).toBe("collapse");
  });
});

// ---------------------------------------------------------------------------
// Collapsed icon rail contract
// ---------------------------------------------------------------------------

describe("getCollapsedRailActions", () => {
  test("RAIL-008: returns expand, new-session, quick-chat, Runs, and settings actions", () => {
    const actions = getCollapsedRailActions();
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("expand");
    expect(ids).toContain("new-session");
    expect(ids).toContain("quick-chat");
    expect(ids).toContain("runs");
    expect(ids).toContain("settings");
    expect(actions.find((action) => action.id === "runs")?.href).toBe("/runs");
  });

  test("RAIL-009: expand is the first action in the rail", () => {
    const actions = getCollapsedRailActions();
    expect(actions[0]?.id).toBe("expand");
  });

  test("RAIL-010: every action has a non-empty ariaLabel and tooltip", () => {
    const actions = getCollapsedRailActions();
    for (const action of actions) {
      expect(action.ariaLabel.length).toBeGreaterThan(0);
      expect(action.tooltip.length).toBeGreaterThan(0);
    }
  });

  test("RAIL-011: returns exactly 5 actions", () => {
    const actions = getCollapsedRailActions();
    expect(actions).toHaveLength(5);
  });

  test("RAIL-012: action ids are unique", () => {
    const actions = getCollapsedRailActions();
    const ids = actions.map((a: CollapsedRailAction) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(actions.length);
  });
});

describe("getCollapsedRepoRailActions", () => {
  test("RAIL-013: returns repo dashboard, branch, settings, new session, agents, and loops actions", () => {
    const actions = getCollapsedRepoRailActions("dennison", "open-agents");
    const ids = actions.map((a) => a.id);

    expect(ids).toEqual([
      "repo-dashboard",
      "repo-branch",
      "repo-settings",
      "repo-new-session",
      "repo-agents",
      "repo-loops",
    ]);
  });

  test("RAIL-014: repo links use the target repo", () => {
    const actions = getCollapsedRepoRailActions("dennison", "open-agents");
    const byId = new Map(actions.map((action) => [action.id, action]));

    expect(byId.get("repo-dashboard")?.href).toBe(
      "/repos/dennison/open-agents",
    );
    expect(byId.get("repo-agents")?.href).toBe(
      "/repos/dennison/open-agents/agents",
    );
    expect(byId.get("repo-loops")?.href).toBe(
      "/loops?repoOwner=dennison&repoName=open-agents",
    );
  });

  test("RAIL-015: every repo action has accessible label metadata", () => {
    const actions = getCollapsedRepoRailActions("dennison", "open-agents");

    for (const action of actions) {
      expect(action.ariaLabel).toContain("dennison/open-agents");
      expect(action.tooltip.length).toBeGreaterThan(0);
    }

    const ids = actions.map((a: CollapsedRepoRailAction) => a.id);
    expect(new Set(ids).size).toBe(actions.length);
  });
});
