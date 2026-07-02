/**
 * TDD RED tests for #762 — status-honesty copy that depends on both the
 * loop's status AND whether it has any triggers.
 *
 * Behavior contract (issue #762):
 *   - loop has >=1 trigger but status !== 'active': the Triggers card warns
 *     "Triggers only fire while the loop is Active."
 *   - loop is active with zero triggers: the status area states
 *     "Active — runs manually only. Add a trigger to run automatically."
 *
 * Kept in a new colocated file (not status-meanings.ts) because this copy
 * needs both status AND triggerCount, unlike the existing per-status meaning.
 */
import { describe, expect, test } from "bun:test";
import {
  getActiveStatusNote,
  getTriggersInactiveWarning,
} from "./status-trigger-notice";

describe("getTriggersInactiveWarning (#762)", () => {
  test("warns when the loop has triggers but is not active (draft)", () => {
    const warning = getTriggersInactiveWarning({
      status: "draft",
      triggerCount: 1,
    });
    expect(warning).toBe("Triggers only fire while the loop is Active.");
  });

  test("warns when the loop has triggers but is not active (paused)", () => {
    const warning = getTriggersInactiveWarning({
      status: "paused",
      triggerCount: 2,
    });
    expect(warning).toBe("Triggers only fire while the loop is Active.");
  });

  test("does not warn when the loop is active", () => {
    expect(
      getTriggersInactiveWarning({ status: "active", triggerCount: 1 }),
    ).toBeNull();
  });

  test("does not warn when the loop has zero triggers", () => {
    expect(
      getTriggersInactiveWarning({ status: "draft", triggerCount: 0 }),
    ).toBeNull();
  });
});

describe("getActiveStatusNote (#762)", () => {
  test("states runs-manually-only when active with zero triggers", () => {
    expect(getActiveStatusNote({ status: "active", triggerCount: 0 })).toBe(
      "Active — runs manually only. Add a trigger to run automatically.",
    );
  });

  test("returns null when active with at least one trigger", () => {
    expect(
      getActiveStatusNote({ status: "active", triggerCount: 1 }),
    ).toBeNull();
  });

  test("returns null when not active", () => {
    expect(
      getActiveStatusNote({ status: "draft", triggerCount: 0 }),
    ).toBeNull();
  });
});
