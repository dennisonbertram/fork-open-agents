/**
 * Regression tests for composio-section-helpers.ts.
 * These would fail if the implementation in eeb4026b were reverted to stubs.
 *
 * Scenarios covered:
 * 1. Reverting shouldShowResults to always-false would break all "visible" assertions
 * 2. Reverting shouldShowMainDefaultTip to always-false would break the tip-show assertion
 * 3. Clearing AGENT_ROLE_DESCRIPTIONS entries would break the non-empty assertions
 */
import { describe, expect, test } from "bun:test";
import {
  shouldShowResults,
  shouldShowMainDefaultTip,
  AGENT_ROLE_DESCRIPTIONS,
} from "./composio-section-helpers";
import { COMPOSIO_AGENT_KEYS } from "@/lib/composio/types";

// Regression: if shouldShowResults always returned false (stub behavior),
// focusing the input would not show the dropdown, breaking the core UX.
describe("regression: shouldShowResults focus/query gating", () => {
  test("focused=true with empty query must show results — catches always-false stub", () => {
    // This would fail if reverted to `return false`
    expect(shouldShowResults(true, "")).toBe(true);
  });

  test("focused=false with a query must show results — catches ignored-query stub", () => {
    // This would fail if reverted to `return isFocused` only
    expect(shouldShowResults(false, "github")).toBe(true);
  });

  test("the boundary case — unfocused + empty — stays hidden", () => {
    // Ensures 'return true' is not a lazy fix: the closed state must hold
    expect(shouldShowResults(false, "")).toBe(false);
  });

  test("whitespace-only query is treated as no query (closed when unfocused)", () => {
    // `query.trim()` must be used, not raw `query`
    expect(shouldShowResults(false, "   ")).toBe(false);
  });
});

// Regression: if shouldShowMainDefaultTip always returned false,
// users would never see the "set a default for Main" guidance.
describe("regression: shouldShowMainDefaultTip tip visibility", () => {
  test("shows tip when profiles exist and main is null — catches always-false stub", () => {
    expect(shouldShowMainDefaultTip([{ id: "profile-abc" }], null)).toBe(true);
  });

  test("hides tip when no profiles exist — tip must not show if there's nothing to assign", () => {
    expect(shouldShowMainDefaultTip([], null)).toBe(false);
  });

  test("hides tip when main already has a profile — tip is not needed", () => {
    expect(
      shouldShowMainDefaultTip([{ id: "profile-abc" }], "profile-abc"),
    ).toBe(false);
  });
});

// Regression: if AGENT_ROLE_DESCRIPTIONS were reset to empty strings,
// the compact agent-defaults row would show no role context.
describe("regression: AGENT_ROLE_DESCRIPTIONS non-empty for all agent keys", () => {
  for (const key of COMPOSIO_AGENT_KEYS) {
    test(`${key} description is a non-empty string`, () => {
      const description = AGENT_ROLE_DESCRIPTIONS[key];
      expect(typeof description).toBe("string");
      expect(description.length).toBeGreaterThan(5);
    });
  }

  test("all four keys are present — no key was accidentally dropped", () => {
    const keys = Object.keys(AGENT_ROLE_DESCRIPTIONS).sort();
    expect(keys).toEqual(["design", "executor", "explorer", "main"]);
  });
});
