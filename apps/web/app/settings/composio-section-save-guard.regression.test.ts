/**
 * Regression tests for the ComposioSection save-guard UX predicates.
 *
 * Protected path: zero-tool Save guard and hint in the profile editor.
 * A profile with no toolkits selected must never be saveable, and the
 * inline hint must appear exactly when the name has been entered but no
 * tool is selected yet.
 *
 * These predicates are extracted into composio-section-helpers.ts so they
 * can be tested here without a React/DOM environment.
 */
import { describe, expect, test } from "bun:test";
import {
  canSaveProfile,
  shouldShowZeroToolHint,
} from "./composio-section-helpers";

describe("canSaveProfile", () => {
  test("returns false when isSaving=true regardless of name/toolkits", () => {
    expect(canSaveProfile("My profile", ["github"], true)).toBe(false);
  });

  test("returns false when name is blank", () => {
    expect(canSaveProfile("", ["github"], false)).toBe(false);
    expect(canSaveProfile("   ", ["github"], false)).toBe(false);
  });

  test("returns false when no toolkits are selected", () => {
    expect(canSaveProfile("My profile", [], false)).toBe(false);
  });

  test("returns true only when name is non-blank, toolkits non-empty, and not saving", () => {
    expect(canSaveProfile("My profile", ["github"], false)).toBe(true);
    expect(canSaveProfile("  Work tools  ", ["gmail", "slack"], false)).toBe(
      true,
    );
  });
});

describe("shouldShowZeroToolHint", () => {
  test("returns false when name is blank (untouched form)", () => {
    // No hint on an empty new-profile form.
    expect(shouldShowZeroToolHint("", [])).toBe(false);
    expect(shouldShowZeroToolHint("   ", [])).toBe(false);
  });

  test("returns false when toolkits are already selected", () => {
    expect(shouldShowZeroToolHint("My profile", ["github"])).toBe(false);
    expect(shouldShowZeroToolHint("My profile", ["gmail", "slack"])).toBe(
      false,
    );
  });

  test("returns true when name entered but no toolkits selected", () => {
    // This is the case where the hint should appear.
    expect(shouldShowZeroToolHint("My profile", [])).toBe(true);
    expect(shouldShowZeroToolHint("  work  ", [])).toBe(true);
  });
});
