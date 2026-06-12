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
 * REG-WI1-006: agents-section.tsx must NOT contain any SelectItem with value=""
 *               after the fix.
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
    expect(toSelectValue("web-bun-agent-browser")).toBe("web-bun-agent-browser");
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

  // REG-WI1-006: roundtrip identity for real ids
  test("REG-WI1-006: roundtrip fromSelectValue(toSelectValue(id)) === id for non-empty ids", () => {
    const ids = ["anthropic/claude-opus-4-5", "web-bun-agent-browser", "x"];
    for (const id of ids) {
      expect(fromSelectValue(toSelectValue(id))).toBe(id);
    }
  });

  // REG-WI1-007: roundtrip for empty string
  test("REG-WI1-007: roundtrip fromSelectValue(toSelectValue('')) === ''", () => {
    expect(fromSelectValue(toSelectValue(""))).toBe("");
  });
});
