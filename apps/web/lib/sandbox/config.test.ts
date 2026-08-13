import { describe, expect, test } from "bun:test";
import { resolveBackgroundAgentVcpus } from "./config";

/**
 * Vercel allocates sandbox CPU in fixed tiers (1, 2, 4, 8 — the same set the
 * repository-settings form validates against). An operator override is a
 * plain env string, so "3" and "2.5" are easy to type and are accepted by a
 * naive positive-number check. Vercel then refuses the allocation and EVERY
 * background-agent sandbox fails to connect — an override meant to give a
 * heavy repo more room would instead take the whole feature down.
 */
describe("resolveBackgroundAgentVcpus", () => {
  test("uses the profile default when unset", () => {
    expect(resolveBackgroundAgentVcpus(undefined, 2)).toBe(2);
  });

  test("accepts a supported tier", () => {
    expect(resolveBackgroundAgentVcpus("4", 2)).toBe(4);
  });

  test("falls back when the value is a positive but unsupported tier", () => {
    expect(resolveBackgroundAgentVcpus("3", 2)).toBe(2);
  });

  test("falls back on a fractional value", () => {
    expect(resolveBackgroundAgentVcpus("2.5", 2)).toBe(2);
  });

  test("falls back on junk, empty, zero and negative input", () => {
    for (const raw of ["", "  ", "two", "0", "-4"]) {
      expect(resolveBackgroundAgentVcpus(raw, 2)).toBe(2);
    }
  });
});
