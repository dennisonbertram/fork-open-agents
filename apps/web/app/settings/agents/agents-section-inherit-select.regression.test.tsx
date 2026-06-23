/**
 * Regression tests for WI-1 / #377:
 *
 * Radix UI Select v2 throws at mount when any <SelectItem value=""> is rendered.
 * AgentEditor in agents-section.tsx had two such nodes (Model select, Runtime
 * profile select), crashing the whole page and making the GitHub tools toggle
 * unreachable.
 *
 * Fix: introduce an INHERIT_SENTINEL string ("__inherit__") and round-trip
 * helpers (toSelectValue / fromSelectValue) so SelectItem never receives an
 * empty-string value, while the internal state and API contract (empty string
 * → null) remain unchanged.
 *
 * REG-WI1-001 through REG-WI1-005: unit tests for the sentinel helpers.
 * REG-WI1-006: source-content assertion — agents-section.tsx must NOT contain
 *               any SelectItem with value="" and must use INHERIT_SENTINEL for
 *               both the Model and Runtime profile selects. This test fails if
 *               the two `value={INHERIT_SENTINEL}` lines are reverted to
 *               `value=""`, proving the regression cannot silently return.
 * REG-WI1-007: roundtrip for empty string (fromSelectValue(toSelectValue('')) === '').
 * REG-WI1-008: collapsed row edit/done controls include the agent name.
 */

import { describe, expect, test } from "bun:test";
import {
  INHERIT_SENTINEL,
  toSelectValue,
  fromSelectValue,
} from "./inherit-select-value";

describe("Regression WI-1: inherit-select sentinel helpers", () => {
  // REG-WI1-001: sentinel is a non-empty stable string
  test("REG-WI1-001: INHERIT_SENTINEL is a non-empty string", () => {
    expect(typeof INHERIT_SENTINEL).toBe("string");
    expect(INHERIT_SENTINEL.length).toBeGreaterThan(0);
  });

  // REG-WI1-002: empty string maps to sentinel (the crash case)
  test("REG-WI1-002: toSelectValue converts empty string to INHERIT_SENTINEL", () => {
    expect(toSelectValue("")).toBe(INHERIT_SENTINEL);
  });

  // REG-WI1-003: real model id passes through unchanged
  test("REG-WI1-003: toSelectValue passes non-empty ids through unchanged", () => {
    expect(toSelectValue("anthropic/claude-opus-4-5")).toBe(
      "anthropic/claude-opus-4-5",
    );
    expect(toSelectValue("web-bun-agent-browser")).toBe(
      "web-bun-agent-browser",
    );
  });

  // REG-WI1-004: sentinel maps back to empty string
  test("REG-WI1-004: fromSelectValue converts INHERIT_SENTINEL back to empty string", () => {
    expect(fromSelectValue(INHERIT_SENTINEL)).toBe("");
  });

  // REG-WI1-005: real model id passes through unchanged on the way back
  test("REG-WI1-005: fromSelectValue passes non-sentinel values through unchanged", () => {
    expect(fromSelectValue("anthropic/claude-opus-4-5")).toBe(
      "anthropic/claude-opus-4-5",
    );
    expect(fromSelectValue("web-bun-agent-browser")).toBe(
      "web-bun-agent-browser",
    );
  });

  // REG-WI1-006: source-content guard — agents-section.tsx must not have value=""
  // on any SelectItem, and must use INHERIT_SENTINEL for both the Model and
  // Runtime profile inherit options.
  //
  // NOTE: renderToStaticMarkup cannot catch this crash because Radix Select
  // renders closed-Select items into a DocumentFragment after a layout effect
  // (client-side only). Source assertion is the correct deterministic guard.
  test('REG-WI1-006: agents-section.tsx has no SelectItem with value="" and uses INHERIT_SENTINEL for both selects', async () => {
    const source = await Bun.file(
      new URL("agents-section.tsx", import.meta.url),
    ).text();

    // Must not contain any bare value="" on a SelectItem — this is the crash.
    // The pattern covers `value=""` and `value=''` forms.
    expect(source).not.toMatch(/SelectItem[^>]*value=""/);
    expect(source).not.toMatch(/SelectItem[^>]*value=''/);

    // Must use INHERIT_SENTINEL as the value for the "inherit" option.
    // Both the Model select and the Runtime profile select need it.
    // Count occurrences: expect at least 2 (one per select).
    const sentinelMatches = source.match(/value=\{INHERIT_SENTINEL\}/g);
    expect(sentinelMatches).not.toBeNull();
    expect((sentinelMatches ?? []).length).toBeGreaterThanOrEqual(2);

    // Must import INHERIT_SENTINEL (proves it's not just a string literal)
    expect(source).toContain("INHERIT_SENTINEL");
    expect(source).toContain("toSelectValue");
    expect(source).toContain("fromSelectValue");
  });

  // REG-WI1-007: roundtrip for empty string
  test("REG-WI1-007: roundtrip fromSelectValue(toSelectValue('')) === ''", () => {
    expect(fromSelectValue(toSelectValue(""))).toBe("");
  });

  test("REG-WI1-008: agent row edit toggle labels include the target agent name", async () => {
    const source = await Bun.file(
      new URL("agents-section.tsx", import.meta.url),
    ).text();
    const labelExpression =
      "aria-label={`" +
      "$" +
      '{expanded ? "Done editing" : "Edit"} ' +
      "$" +
      "{row.name}`}";

    expect(source).toContain(labelExpression);
  });
});
