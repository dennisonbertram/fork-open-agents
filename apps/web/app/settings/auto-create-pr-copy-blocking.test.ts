/**
 * Blocking findings fix tests — TASK-BLOCKING-FINDINGS
 *
 * Finding 1: Auto create PR — both description strings must appear when disabled.
 *   Pre-retrofit: "Open a pull request after auto commit." was ALWAYS shown;
 *   "Available once Auto commit & push is on." was shown additionally when disabled.
 *   The retrofit made it either/or.
 *
 * Finding 2: Git automation and Notifications SettingsGroup must NOT carry description
 *   props — the original GroupHeader had no subtext.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const prefsSrc = readFileSync(
  resolve(import.meta.dir, "preferences-section.tsx"),
  "utf8",
);

describe("Finding 1 — Auto create PR copy preservation", () => {
  // BT-BLOCK-001: When autoCommitPush is OFF, BOTH the base description and the
  // availability hint must appear in the same description value.
  // Original: two separate <p> elements.
  // Acceptable retrofit: one combined description string containing both phrases.
  test("BT-BLOCK-001: disabled-state branch (false/left branch of ternary) contains 'Open a pull request after auto commit.'", () => {
    // Pre-retrofit: when autoCommitPush=false, the row showed:
    //   <p>Open a pull request after auto commit.</p>
    //   <p><em>Available once Auto commit & push is on.</em></p>
    //
    // The retrofit made it either/or: the false branch of the ternary only has the hint.
    // Fix: the false branch must include BOTH phrases so no copy is lost.
    //
    // We identify the false branch by extracting the string literal that appears BEFORE
    // the colon in the ternary for the auto-create-pr description.
    // Ternary form: condition ? FALSE_BRANCH : TRUE_BRANCH
    // The false-branch is the first string literal after `?` in the ternary.
    const autoCreatePrMatch = prefsSrc.match(
      /label="Auto create PR"[\s\S]*?description=\{[\s\S]*?\?\s*"([^"]*)"[\s\S]*?\}/,
    );
    expect(autoCreatePrMatch).not.toBeNull();

    const falseBranchValue = autoCreatePrMatch![1];
    // The false branch (disabled state, hint shown) MUST also include the base description.
    // Currently it only has "Available once Auto commit & push is on."
    // After fix it should be "Open a pull request after auto commit. Available once Auto commit & push is on."
    expect(falseBranchValue).toContain(
      "Open a pull request after auto commit.",
    );
    expect(falseBranchValue).toContain("Available once Auto commit");
  });

  // BT-BLOCK-002: When autoCommitPush is ON, the description shows just the base text
  // (no hint clutter when the row is enabled).
  test("BT-BLOCK-002: enabled state description still contains 'Open a pull request after auto commit.'", () => {
    // The true-branch must contain the base description
    expect(prefsSrc).toContain("Open a pull request after auto commit.");
  });
});

describe("Finding 2 — No new group descriptions on Git automation / Notifications", () => {
  // BT-BLOCK-004: Git automation SettingsGroup must NOT have a description prop.
  // Original: <GroupHeader>Git automation</GroupHeader> — no subtext.
  test("BT-BLOCK-004: Git automation SettingsGroup has no description prop", () => {
    // Find the Git automation group section.
    // It must use SettingsGroup title="Git automation" WITHOUT a description= prop.
    const gitGroupMatch = prefsSrc.match(
      /title="Git automation"([^>]*?)(?:>|\/\s*>)/,
    );
    expect(gitGroupMatch).not.toBeNull();
    const gitGroupAttribs = gitGroupMatch![1];
    // Must NOT contain a description= prop
    expect(gitGroupAttribs).not.toContain("description=");
  });

  // BT-BLOCK-005: Notifications SettingsGroup must NOT have a description prop.
  // Original: <GroupHeader>Notifications</GroupHeader> — no subtext.
  test("BT-BLOCK-005: Notifications SettingsGroup has no description prop", () => {
    const notifGroupMatch = prefsSrc.match(
      /title="Notifications"([^>]*?)(?:>|\/\s*>)/,
    );
    expect(notifGroupMatch).not.toBeNull();
    const notifGroupAttribs = notifGroupMatch![1];
    // Must NOT contain a description= prop
    expect(notifGroupAttribs).not.toContain("description=");
  });
});
