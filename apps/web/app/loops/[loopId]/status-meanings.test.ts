/**
 * status-meanings.ts tests (#768)
 *
 * Behavior contract:
 *   BT-SM-001: every loop status has a one-line, naive-user-readable meaning.
 *   BT-SM-002: getStatusMeaning is defined for all four loop statuses used by
 *              the status dropdown (draft, active, paused, archived).
 */

import { describe, expect, test } from "bun:test";
import { getStatusMeaning, LOOP_STATUS_MEANINGS } from "./status-meanings";

describe("status-meanings", () => {
  test("BT-SM-001: draft means editable, can't run", () => {
    expect(getStatusMeaning("draft")).toMatch(/edit/i);
    expect(getStatusMeaning("draft")).toMatch(/can'?t run|cannot run/i);
  });

  test("BT-SM-001: active means can run and triggers fire", () => {
    expect(getStatusMeaning("active")).toMatch(/run/i);
    expect(getStatusMeaning("active")).toMatch(/trigger/i);
  });

  test("BT-SM-001: paused means nothing fires", () => {
    expect(getStatusMeaning("paused")).toMatch(/nothing fires|won'?t (run|fire)/i);
  });

  test("BT-SM-001: archived means read-only", () => {
    expect(getStatusMeaning("archived")).toMatch(/read-only/i);
  });

  test("BT-SM-002: all four statuses used by the dropdown have a meaning", () => {
    for (const status of ["draft", "active", "paused", "archived"] as const) {
      expect(LOOP_STATUS_MEANINGS[status]).toBeTruthy();
      expect(LOOP_STATUS_MEANINGS[status].length).toBeGreaterThan(0);
    }
  });

  test("getStatusMeaning falls back gracefully for unknown status", () => {
    expect(getStatusMeaning("unknown_status")).toBe("");
  });
});
