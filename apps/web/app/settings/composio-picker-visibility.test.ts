/**
 * BT-224B: Tests for picker visibility and agent-defaults hint helpers.
 *
 * Behavioral contracts:
 * - BT-224B-001: shouldShowResults(focused, query) returns false when not focused AND query is empty
 * - BT-224B-002: shouldShowResults returns true when focused (even with empty query)
 * - BT-224B-003: shouldShowResults returns true when query is non-empty (even if not focused)
 * - BT-224B-004: shouldShowResults returns true when focused AND has a query
 * - BT-224B-005: shouldShowMainDefaultTip returns false when there are no profiles
 * - BT-224B-006: shouldShowMainDefaultTip returns false when main has a profile already set
 * - BT-224B-007: shouldShowMainDefaultTip returns true when profiles exist AND main is null
 * - BT-224B-008: AGENT_ROLE_DESCRIPTIONS has an entry for every COMPOSIO_AGENT_KEY
 * - BT-224B-009: Each AGENT_ROLE_DESCRIPTIONS entry is a non-empty string
 *
 * These tests FAIL until the helpers are exported from
 * apps/web/app/settings/composio-section-helpers.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  shouldShowResults,
  shouldShowMainDefaultTip,
  AGENT_ROLE_DESCRIPTIONS,
} from "./composio-section-helpers";
import { COMPOSIO_AGENT_KEYS } from "@/lib/composio/types";

describe("BT-224B-001: shouldShowResults — hidden when unfocused and no query", () => {
  test("returns false when not focused and query is empty string", () => {
    expect(shouldShowResults(false, "")).toBe(false);
  });

  test("returns false when not focused and query is whitespace only", () => {
    expect(shouldShowResults(false, "   ")).toBe(false);
  });
});

describe("BT-224B-002: shouldShowResults — visible when focused", () => {
  test("returns true when focused with empty query", () => {
    expect(shouldShowResults(true, "")).toBe(true);
  });

  test("returns true when focused with whitespace query", () => {
    expect(shouldShowResults(true, "   ")).toBe(true);
  });
});

describe("BT-224B-003: shouldShowResults — visible when query is non-empty", () => {
  test("returns true when not focused but query has content", () => {
    expect(shouldShowResults(false, "gmail")).toBe(true);
  });

  test("returns true when not focused but query has a single character", () => {
    expect(shouldShowResults(false, "g")).toBe(true);
  });
});

describe("BT-224B-004: shouldShowResults — visible when focused AND has query", () => {
  test("returns true when focused and query is 'slack'", () => {
    expect(shouldShowResults(true, "slack")).toBe(true);
  });
});

describe("BT-224B-005: shouldShowMainDefaultTip — false when no profiles exist", () => {
  test("returns false when profiles array is empty", () => {
    expect(shouldShowMainDefaultTip([], null)).toBe(false);
  });
});

describe("BT-224B-006: shouldShowMainDefaultTip — false when main already has a profile", () => {
  test("returns false when profiles exist and main has a defaultProfileId", () => {
    expect(
      shouldShowMainDefaultTip([{ id: "p1" }], "p1"),
    ).toBe(false);
  });
});

describe("BT-224B-007: shouldShowMainDefaultTip — true when profiles exist and main is null", () => {
  test("returns true when at least one profile exists and mainDefaultProfileId is null", () => {
    expect(
      shouldShowMainDefaultTip([{ id: "p1" }], null),
    ).toBe(true);
  });

  test("returns true when multiple profiles exist and main is null", () => {
    expect(
      shouldShowMainDefaultTip([{ id: "p1" }, { id: "p2" }], null),
    ).toBe(true);
  });
});

describe("BT-224B-008 + BT-224B-009: AGENT_ROLE_DESCRIPTIONS covers all agent keys with non-empty strings", () => {
  test("has an entry for every COMPOSIO_AGENT_KEY", () => {
    for (const key of COMPOSIO_AGENT_KEYS) {
      expect(AGENT_ROLE_DESCRIPTIONS).toHaveProperty(key);
    }
  });

  test("each description is a non-empty string", () => {
    for (const key of COMPOSIO_AGENT_KEYS) {
      const description = AGENT_ROLE_DESCRIPTIONS[key];
      expect(typeof description).toBe("string");
      expect((description as string).length).toBeGreaterThan(0);
    }
  });

  test("descriptions cover all four known agent keys", () => {
    expect(Object.keys(AGENT_ROLE_DESCRIPTIONS).sort()).toEqual(
      [...COMPOSIO_AGENT_KEYS].sort(),
    );
  });
});
