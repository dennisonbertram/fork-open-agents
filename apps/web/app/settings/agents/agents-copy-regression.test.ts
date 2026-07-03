/**
 * Regression tests for agents-copy.ts (#803, W4).
 *
 * Catches future breakage if the "none assigned" reconciliation copy is
 * silently reverted to the old bare "None connected" wording that made the
 * "profiles exist elsewhere but aren't assigned here" distinction invisible.
 *
 * Regression commit: linked to green 2bb8b9a9.
 */
import { describe, expect, test } from "bun:test";
import {
  EXTERNAL_TOOLS_NONE_ASSIGNED_HINT,
  EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL,
} from "./agents-copy";

describe("agents-copy — regression", () => {
  test("REGRESSION-001 label is not the old bare 'None connected' wording", () => {
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_LABEL).not.toBe("None connected");
  });

  test("REGRESSION-002 hint points to Settings -> Composio as the place assignment happens", () => {
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_HINT).toContain("Settings");
    expect(EXTERNAL_TOOLS_NONE_ASSIGNED_HINT).toContain("Composio");
  });
});
