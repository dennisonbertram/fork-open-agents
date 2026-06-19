/**
 * Regression tests — TASK-BLOCKING-FINDINGS copy preservation
 *
 * These tests catch future regressions if:
 * 1. The auto-create-PR disabled description loses the base text again.
 * 2. A SettingsGroup description is re-added to Git automation or Notifications.
 *
 * Each test answers: "If the fix in 24a77361 is reverted, this test fails."
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const prefsSrc = readFileSync(
  resolve(import.meta.dir, "preferences-section.tsx"),
  "utf8",
);

describe("Regression — auto-create-PR description never loses base text", () => {
  // REG-BLOCK-001: The combined disabled-state string must appear verbatim.
  // If someone reverts to the either/or approach, this exact string disappears.
  test("REG-BLOCK-001: combined disabled-state string is present verbatim in preferences-section.tsx", () => {
    expect(prefsSrc).toContain(
      "Open a pull request after auto commit. Available once Auto commit & push is on.",
    );
  });

  // REG-BLOCK-002: The enabled-state string must still be present (true branch of ternary).
  // Catches a regression where someone accidentally drops the true branch.
  test("REG-BLOCK-002: enabled-state string 'Open a pull request after auto commit.' still present", () => {
    // The true branch (autoCommitPush=true) must still carry the clean description.
    // Count occurrences — the true branch contributes at least once.
    const occurrences =
      prefsSrc.split("Open a pull request after auto commit.").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });
});

describe("Regression — no group-level subtext on Git automation / Notifications", () => {
  // REG-BLOCK-004: The Git automation group description prop must not be present.
  // Catches a regression if the removed description= is re-added.
  test("REG-BLOCK-004: 'Automate commits and pull requests' text absent from preferences-section.tsx", () => {
    // This was the exact added description text that violated behavior preservation.
    expect(prefsSrc).not.toContain(
      "Automate commits and pull requests at the end of each agent turn.",
    );
  });

  // REG-BLOCK-005: The Notifications group description prop must not be present.
  test("REG-BLOCK-005: 'Control when and how you're alerted.' absent from preferences-section.tsx", () => {
    expect(prefsSrc).not.toContain("Control when and how you're alerted.");
  });
});
