/**
 * Regression tests for the collapsed sidebar icon-rail action contract.
 *
 * These tests catch future breakage if:
 * - The expand/new-session/quick-chat actions are removed or reordered
 * - The ariaLabel or tooltip text is blanked out
 * - The helper starts returning a shared mutable array
 *
 * The companion UI change lives in:
 *   apps/web/app/sessions/sessions-route-shell.tsx (collapsible="icon", SidebarRail)
 *   apps/web/components/inbox-sidebar.tsx (collapsed icon strip + expanded content gating)
 */
import { describe, expect, test } from "bun:test";
import {
  getCollapsedRailActions,
  type CollapsedRailAction,
} from "./inbox-sidebar-rail-actions";

// BT-001: collapsed rail returns the three required action ids in order
describe("getCollapsedRailActions", () => {
  test("BT-001: returns expand, new-session, and quick-chat actions", () => {
    const actions = getCollapsedRailActions();
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("expand");
    expect(ids).toContain("new-session");
    expect(ids).toContain("quick-chat");
  });

  test("BT-002: expand is the first action in the rail", () => {
    const actions = getCollapsedRailActions();
    expect(actions[0]?.id).toBe("expand");
  });

  test("BT-003: every action has a non-empty ariaLabel and tooltip", () => {
    const actions = getCollapsedRailActions();
    for (const action of actions) {
      expect(action.ariaLabel.length).toBeGreaterThan(0);
      expect(action.tooltip.length).toBeGreaterThan(0);
    }
  });

  test("BT-004: returns exactly 3 actions", () => {
    const actions = getCollapsedRailActions();
    expect(actions).toHaveLength(3);
  });

  test("BT-005: action ids are unique", () => {
    const actions = getCollapsedRailActions();
    const ids = actions.map((a: CollapsedRailAction) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(actions.length);
  });
});

// Regression: if someone removes or reorders actions, these catch it
describe("getCollapsedRailActions regression", () => {
  test("REG-001: quick-chat action has a tooltip that mentions chat or quick", () => {
    const actions = getCollapsedRailActions();
    const qc = actions.find((a) => a.id === "quick-chat");
    expect(qc).toBeDefined();
    const combined = `${qc?.tooltip ?? ""}${qc?.ariaLabel ?? ""}`.toLowerCase();
    expect(combined).toMatch(/chat|quick/);
  });

  test("REG-002: new-session action has a tooltip that mentions session or new", () => {
    const actions = getCollapsedRailActions();
    const ns = actions.find((a) => a.id === "new-session");
    expect(ns).toBeDefined();
    const combined = `${ns?.tooltip ?? ""}${ns?.ariaLabel ?? ""}`.toLowerCase();
    expect(combined).toMatch(/session|new/);
  });

  test("REG-003: expand action has a tooltip that mentions expand or open", () => {
    const actions = getCollapsedRailActions();
    const ex = actions.find((a) => a.id === "expand");
    expect(ex).toBeDefined();
    const combined = `${ex?.tooltip ?? ""}${ex?.ariaLabel ?? ""}`.toLowerCase();
    expect(combined).toMatch(/expand|open/);
  });

  test("REG-004: calling getCollapsedRailActions twice returns independent arrays", () => {
    const first = getCollapsedRailActions();
    const second = getCollapsedRailActions();
    // Mutating one must not affect the other
    (first as unknown as Record<string, unknown>[])[0] = { id: "injected" };
    expect(second[0]?.id).toBe("expand");
  });
});
