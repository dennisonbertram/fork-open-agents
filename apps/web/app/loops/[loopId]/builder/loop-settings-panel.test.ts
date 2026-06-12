/**
 * loop-settings-panel.test.ts — RED tests for loop settings panel helpers.
 *
 * Behavioral tests:
 * BT-M2-LS-01: guardrail field ceilings enforced in loopSettingsValidator
 * BT-M2-LS-02: name/description validation
 * BT-M2-LS-03: guardrail values below ceilings pass
 */

import { describe, expect, it } from "bun:test";
import {
  GUARDRAIL_CEILINGS,
  GUARDRAIL_DEFAULTS,
} from "@/lib/agent-loops/types";
import { validateLoopSettings } from "./loop-settings-panel";

describe("BT-M2-LS-01: validateLoopSettings — guardrail ceiling enforcement", () => {
  it("BT-M2-LS-01a: maxStepsPerRun above ceiling returns error", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: { maxStepsPerRun: GUARDRAIL_CEILINGS.maxStepsPerRun + 1 },
    });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-01b: maxIterations above ceiling returns error", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: { maxIterations: GUARDRAIL_CEILINGS.maxIterations + 1 },
    });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-01c: stepTimeoutMs above ceiling returns error", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: { stepTimeoutMs: GUARDRAIL_CEILINGS.stepTimeoutMs + 1 },
    });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-01d: guardrail values at ceiling boundary (equal) pass", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: {
        maxStepsPerRun: GUARDRAIL_CEILINGS.maxStepsPerRun,
        maxIterations: GUARDRAIL_CEILINGS.maxIterations,
        stepTimeoutMs: GUARDRAIL_CEILINGS.stepTimeoutMs,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("BT-M2-LS-01e: default guardrail values all pass", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: {
        maxStepsPerRun: GUARDRAIL_DEFAULTS.maxStepsPerRun,
        maxIterations: GUARDRAIL_DEFAULTS.maxIterations,
        maxRunDurationMs: GUARDRAIL_DEFAULTS.maxRunDurationMs,
        stepTimeoutMs: GUARDRAIL_DEFAULTS.stepTimeoutMs,
      },
    });
    expect(result.ok).toBe(true);
  });
});

describe("BT-M2-LS-02: validateLoopSettings — name validation", () => {
  it("BT-M2-LS-02a: empty name returns error", () => {
    const result = validateLoopSettings({ name: "" });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-02b: whitespace-only name returns error", () => {
    const result = validateLoopSettings({ name: "   " });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-02c: valid name passes", () => {
    const result = validateLoopSettings({ name: "My loop" });
    expect(result.ok).toBe(true);
  });
});

describe("BT-M2-LS-03: validateLoopSettings — guardrail values below ceilings pass", () => {
  it("BT-M2-LS-03a: small values all pass", () => {
    const result = validateLoopSettings({
      name: "Test",
      guardrails: {
        maxStepsPerRun: 5,
        maxIterations: 3,
        maxRunDurationMs: 60_000,
        stepTimeoutMs: 30_000,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("BT-M2-LS-03b: missing guardrails (undefined) passes — they are optional", () => {
    const result = validateLoopSettings({ name: "Test", guardrails: undefined });
    expect(result.ok).toBe(true);
  });

  it("BT-M2-LS-03c: zero value for a guardrail field returns error (must be positive)", () => {
    const result = validateLoopSettings({
      name: "Test",
      guardrails: { maxStepsPerRun: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-03d: negative value for a guardrail field returns error", () => {
    const result = validateLoopSettings({
      name: "Test",
      guardrails: { maxIterations: -1 },
    });
    expect(result.ok).toBe(false);
  });
});
