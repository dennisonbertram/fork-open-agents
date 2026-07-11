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
import { updateAgentLoopBodySchema } from "@/lib/agent-loops/request-schemas";
import {
  buildInitialLoopSettings,
  settingsToUpdatePayload,
  validateLoopSettings,
  WATCHDOG_RETRY_BUDGET_DEFAULT,
  WATCHDOG_RETRY_BUDGET_MAX,
} from "./loop-settings-panel";

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
    const result = validateLoopSettings({
      name: "Test",
      guardrails: undefined,
    });
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

describe("BT-M2-LS-04: validateLoopSettings — watchdog validation (M3-01)", () => {
  it("BT-M2-LS-04a: watchdog disabled — budget not validated even if out of range", () => {
    // When watchdog is disabled, budget validation is skipped
    const result = validateLoopSettings({
      name: "Test",
      watchdog: { watchdogEnabled: false, watchdogRetryBudget: 99 },
    });
    expect(result.ok).toBe(true);
  });

  it("BT-M2-LS-04b: watchdog enabled with budget within range passes", () => {
    const result = validateLoopSettings({
      name: "Test",
      watchdog: {
        watchdogEnabled: true,
        watchdogRetryBudget: WATCHDOG_RETRY_BUDGET_DEFAULT,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("BT-M2-LS-04c: watchdog enabled with budget above max returns error", () => {
    const result = validateLoopSettings({
      name: "Test",
      watchdog: {
        watchdogEnabled: true,
        watchdogRetryBudget: WATCHDOG_RETRY_BUDGET_MAX + 1,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.field === "watchdog.watchdogRetryBudget"),
      ).toBe(true);
    }
  });

  it("BT-M2-LS-04d: watchdog enabled with budget at ceiling (WATCHDOG_RETRY_BUDGET_MAX) passes", () => {
    const result = validateLoopSettings({
      name: "Test",
      watchdog: {
        watchdogEnabled: true,
        watchdogRetryBudget: WATCHDOG_RETRY_BUDGET_MAX,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("BT-M2-LS-04e: watchdog enabled with budget zero passes (budget=0 means no retries allowed)", () => {
    const result = validateLoopSettings({
      name: "Test",
      watchdog: { watchdogEnabled: true, watchdogRetryBudget: 0 },
    });
    expect(result.ok).toBe(true);
  });

  it("BT-M2-LS-04f: watchdog enabled with negative budget returns error", () => {
    const result = validateLoopSettings({
      name: "Test",
      watchdog: { watchdogEnabled: true, watchdogRetryBudget: -1 },
    });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-04g: watchdog enabled with no budget specified passes (budget is optional)", () => {
    const result = validateLoopSettings({
      name: "Test",
      watchdog: { watchdogEnabled: true },
    });
    expect(result.ok).toBe(true);
  });
});

describe("BT-M2-LS-05: validateLoopSettings — maxAgentTurnsPerStep (#862)", () => {
  it("BT-M2-LS-05a: value above ceiling returns error", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: { maxAgentTurnsPerStep: 33 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.field).toBe("guardrails.maxAgentTurnsPerStep");
    }
  });

  it("BT-M2-LS-05b: zero value returns error", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: { maxAgentTurnsPerStep: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-05c: non-integer value returns error", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: { maxAgentTurnsPerStep: 2.5 },
    });
    expect(result.ok).toBe(false);
  });

  it("BT-M2-LS-05d: valid value passes", () => {
    const result = validateLoopSettings({
      name: "My loop",
      guardrails: { maxAgentTurnsPerStep: 12 },
    });
    expect(result.ok).toBe(true);
  });
});

describe("buildInitialLoopSettings (#877)", () => {
  it("maps all provided props", () => {
    const state = buildInitialLoopSettings({
      loopName: "My loop",
      loopDescription: "A loop",
      loopGuardrails: { maxAgentTurnsPerStep: 8 },
      watchdogEnabled: true,
      watchdogInstructions: "Never retry deploys.",
      watchdogRetryBudget: 3,
    });
    expect(state).toEqual({
      name: "My loop",
      description: "A loop",
      guardrails: { maxAgentTurnsPerStep: 8 },
      watchdogEnabled: true,
      watchdogInstructions: "Never retry deploys.",
      watchdogRetryBudget: 3,
    });
  });

  it("defaults missing optional props", () => {
    const state = buildInitialLoopSettings({ loopName: "My loop" });
    expect(state).toEqual({
      name: "My loop",
      description: "",
      guardrails: {},
      watchdogEnabled: false,
      watchdogInstructions: "",
      watchdogRetryBudget: WATCHDOG_RETRY_BUDGET_DEFAULT,
    });
  });
});

describe("settingsToUpdatePayload (#877)", () => {
  it("sends guardrails: null when the guardrails set is empty (clears the column)", () => {
    const payload = settingsToUpdatePayload({
      name: "My loop",
      description: "",
      guardrails: {},
      watchdogEnabled: false,
      watchdogInstructions: "",
      watchdogRetryBudget: 2,
    });
    expect(payload.guardrails).toBeNull();
  });

  it("sends description: null when description is empty", () => {
    const payload = settingsToUpdatePayload({
      name: "My loop",
      description: "",
      guardrails: {},
      watchdogEnabled: false,
      watchdogInstructions: "",
      watchdogRetryBudget: 2,
    });
    expect(payload.description).toBeNull();
  });

  it("sends watchdogInstructions: null when watchdog is disabled, even if text was typed", () => {
    const payload = settingsToUpdatePayload({
      name: "My loop",
      description: "",
      guardrails: {},
      watchdogEnabled: false,
      watchdogInstructions: "Never retry deploys.",
      watchdogRetryBudget: 2,
    });
    expect(payload.watchdogInstructions).toBeNull();
  });

  it("preserves non-empty guardrails and enabled-watchdog instructions", () => {
    const payload = settingsToUpdatePayload({
      name: "My loop",
      description: "A loop",
      guardrails: { maxAgentTurnsPerStep: 24 },
      watchdogEnabled: true,
      watchdogInstructions: "Never retry deploys.",
      watchdogRetryBudget: 3,
    });
    expect(payload.guardrails).toEqual({ maxAgentTurnsPerStep: 24 });
    expect(payload.watchdogInstructions).toBe("Never retry deploys.");
  });

  it("the payload's keys all parse under updateAgentLoopBodySchema's .strict()", () => {
    const payload = settingsToUpdatePayload({
      name: "My loop",
      description: "",
      guardrails: {},
      watchdogEnabled: false,
      watchdogInstructions: "",
      watchdogRetryBudget: 2,
    });
    const result = updateAgentLoopBodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
