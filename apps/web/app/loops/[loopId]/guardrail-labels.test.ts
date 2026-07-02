/**
 * guardrail-labels.test.ts (#767)
 *
 * The loop-detail guardrails sidebar renders raw camelCase keys
 * (`maxStepsPerRun`) today. This module maps each known guardrail key to a
 * humanized label; unknown keys fall back to a readable spaced version of
 * the key so a future guardrail field never renders blank.
 */

import { describe, expect, it } from "bun:test";
import { getGuardrailLabel } from "./guardrail-labels";

describe("getGuardrailLabel", () => {
  it("humanizes maxStepsPerRun", () => {
    expect(getGuardrailLabel("maxStepsPerRun")).toBe("Max steps per run");
  });

  it("humanizes maxIterations", () => {
    expect(getGuardrailLabel("maxIterations")).toBe("Max iterations");
  });

  it("humanizes maxRunDurationMs", () => {
    expect(getGuardrailLabel("maxRunDurationMs")).toBe("Max run duration");
  });

  it("humanizes stepTimeoutMs as a cumulative budget", () => {
    expect(getGuardrailLabel("stepTimeoutMs")).toBe("Step time budget");
  });

  it("falls back to a spaced-out label for an unknown key", () => {
    expect(getGuardrailLabel("someNewGuardrailKey")).toBe(
      "Some new guardrail key",
    );
  });
});
