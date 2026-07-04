/**
 * run-history-empty-state.ts tests (#867)
 *
 * Behavior contract:
 *   RHE-001: active loops keep the existing "Click Run now" instruction.
 *   RHE-002: non-active loops (draft/paused/archived) get copy that does not
 *            tell the user to click a disabled button, and is textually
 *            distinct from the page-level "Loop must be in active status to
 *            run manually." notice.
 */

import { describe, expect, test } from "bun:test";
import { getRunHistoryEmptyState } from "./run-history-empty-state";

describe("getRunHistoryEmptyState", () => {
  test("RHE-001: active loop keeps the existing click-run-now copy", () => {
    expect(getRunHistoryEmptyState("active")).toBe(
      "No runs yet. Click “Run now” to start the first run.",
    );
  });

  test.each(["draft", "paused", "archived"])(
    "RHE-002: %s loop copy does not instruct clicking a disabled button",
    (status) => {
      const copy = getRunHistoryEmptyState(status);

      expect(copy).not.toContain("Click");
      expect(copy).toContain("Active");
      expect(copy).not.toBe("Loop must be in active status to run manually.");
    },
  );
});
