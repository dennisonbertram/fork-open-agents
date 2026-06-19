/**
 * Contract tests for sessions sidebar toggle affordances.
 *
 * The sessions sidebar uses collapsible="offcanvas": the panel slides fully
 * off-screen when collapsed.  Two affordances own the toggle contract:
 *   - "collapse": shown in the sidebar header (visible when expanded).
 *   - "open": shown in the content shell (visible when collapsed, because the
 *     sidebar is entirely hidden and cannot host its own reopen control).
 *
 * These tests catch future breakage if aria-labels or tooltip text are blanked
 * out, actions are removed, or the helper returns a shared mutable array.
 *
 * Companion implementation files:
 *   apps/web/app/sessions/sessions-route-shell.tsx  (collapsible="offcanvas",
 *     RouteContentShell "Open panel" trigger)
 *   apps/web/components/inbox-sidebar.tsx (header "Collapse panel" toggle)
 */
import { describe, expect, test } from "bun:test";
import {
  getSidebarToggleActions,
  type SidebarToggleAction,
  // Legacy export — kept for backward compat; tested below.
  getCollapsedRailActions,
  type CollapsedRailAction,
} from "./inbox-sidebar-rail-actions";

// ---------------------------------------------------------------------------
// Offcanvas toggle contract (current)
// ---------------------------------------------------------------------------

describe("getSidebarToggleActions", () => {
  test("OC-001: returns collapse and open actions", () => {
    const actions = getSidebarToggleActions();
    const ids = actions.map((a) => a.id);
    expect(ids).toContain("collapse");
    expect(ids).toContain("open");
  });

  test("OC-002: collapse is the first action", () => {
    const actions = getSidebarToggleActions();
    expect(actions[0]?.id).toBe("collapse");
  });

  test("OC-003: open is the second action", () => {
    const actions = getSidebarToggleActions();
    expect(actions[1]?.id).toBe("open");
  });

  test("OC-004: returns exactly 2 actions", () => {
    const actions = getSidebarToggleActions();
    expect(actions).toHaveLength(2);
  });

  test("OC-005: every action has a non-empty ariaLabel and tooltip", () => {
    const actions = getSidebarToggleActions();
    for (const action of actions) {
      expect(action.ariaLabel.length).toBeGreaterThan(0);
      expect(action.tooltip.length).toBeGreaterThan(0);
    }
  });

  test("OC-006: action ids are unique", () => {
    const actions = getSidebarToggleActions();
    const ids = actions.map((a: SidebarToggleAction) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(actions.length);
  });

  test("OC-007: collapse action mentions collapse or close", () => {
    const actions = getSidebarToggleActions();
    const col = actions.find((a) => a.id === "collapse");
    expect(col).toBeDefined();
    const combined =
      `${col?.tooltip ?? ""}${col?.ariaLabel ?? ""}`.toLowerCase();
    expect(combined).toMatch(/collapse|close/);
  });

  test("OC-008: open action mentions open or expand", () => {
    const actions = getSidebarToggleActions();
    const op = actions.find((a) => a.id === "open");
    expect(op).toBeDefined();
    const combined = `${op?.tooltip ?? ""}${op?.ariaLabel ?? ""}`.toLowerCase();
    expect(combined).toMatch(/open|expand/);
  });

  test("OC-009: calling getSidebarToggleActions twice returns independent arrays", () => {
    const first = getSidebarToggleActions();
    const second = getSidebarToggleActions();
    (first as unknown as Record<string, unknown>[])[0] = { id: "injected" };
    expect(second[0]?.id).toBe("collapse");
  });
});

// ---------------------------------------------------------------------------
// Legacy icon-rail export (deprecated — icon mode replaced by offcanvas)
// These tests are retained for backward compatibility while any callers that
// imported getCollapsedRailActions migrate to getSidebarToggleActions.
// ---------------------------------------------------------------------------

describe("getCollapsedRailActions (deprecated)", () => {
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
