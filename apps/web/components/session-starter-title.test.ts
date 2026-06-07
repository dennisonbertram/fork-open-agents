/**
 * Tests for session title collection behavior added in issue #182.
 *
 * BT-001: When a user types a title, the onSubmit callback receives `title` in
 *         the payload passed to createSession.
 * BT-002: When the title field is blank (or whitespace-only), the payload omits
 *         `title` so the server-side random-city fallback applies.
 */

import { describe, expect, test } from "bun:test";
import { prepareSessionTitle } from "./session-starter-title";

describe("prepareSessionTitle — BT-001, BT-002", () => {
  test("BT-001: returns trimmed title when user enters a non-empty value", () => {
    expect(prepareSessionTitle("  My Sprint Session  ")).toBe(
      "My Sprint Session",
    );
  });

  test("BT-001: returns the title unchanged when it has no surrounding whitespace", () => {
    expect(prepareSessionTitle("Fix login bug")).toBe("Fix login bug");
  });

  test("BT-002: returns undefined when the input is an empty string", () => {
    expect(prepareSessionTitle("")).toBeUndefined();
  });

  test("BT-002: returns undefined when the input is whitespace-only", () => {
    expect(prepareSessionTitle("   ")).toBeUndefined();
  });

  test("BT-002: returns undefined when the input is undefined", () => {
    expect(prepareSessionTitle(undefined)).toBeUndefined();
  });
});
