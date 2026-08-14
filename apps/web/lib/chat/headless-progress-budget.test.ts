import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildHeadlessNoSandboxCapMessage,
  buildHeadlessProgressFuseMessage,
  DEFAULT_HEADLESS_RUN_CYCLE_REPEATS,
  DEFAULT_HEADLESS_RUN_MAX_CYCLE_PERIOD,
  DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
  DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP,
  getHeadlessRunCycleRepeats,
  getHeadlessRunMaxCyclePeriod,
  getHeadlessRunMaxStaleSteps,
  getHeadlessRunNoSandboxStepCap,
  HEADLESS_RUN_CYCLE_REPEATS_CEILING,
  HEADLESS_RUN_MAX_CYCLE_PERIOD_CEILING,
  HEADLESS_RUN_MAX_STALE_STEPS_CEILING,
  HEADLESS_RUN_NO_SANDBOX_STEP_CAP_CEILING,
} from "./headless-progress-budget";

const ENV_KEY = "HEADLESS_RUN_MAX_STALE_STEPS";
const NO_SANDBOX_ENV_KEY = "HEADLESS_RUN_NO_SANDBOX_STEP_CAP";
const original = process.env[ENV_KEY];
const originalNoSandbox = process.env[NO_SANDBOX_ENV_KEY];

beforeEach(() => {
  delete process.env[ENV_KEY];
  delete process.env[NO_SANDBOX_ENV_KEY];
});

afterEach(() => {
  if (original === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = original;
  }
  if (originalNoSandbox === undefined) {
    delete process.env[NO_SANDBOX_ENV_KEY];
  } else {
    process.env[NO_SANDBOX_ENV_KEY] = originalNoSandbox;
  }
});

describe("getHeadlessRunMaxStaleSteps (#1231)", () => {
  test("defaults when the env var is unset", () => {
    expect(getHeadlessRunMaxStaleSteps()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
    );
  });

  test("reads a valid positive integer from the env var", () => {
    process.env[ENV_KEY] = "7";
    expect(getHeadlessRunMaxStaleSteps()).toBe(7);
  });

  test("falls back to the default for a non-numeric value", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(getHeadlessRunMaxStaleSteps()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
    );
  });

  test("falls back to the default for zero or negative values", () => {
    process.env[ENV_KEY] = "0";
    expect(getHeadlessRunMaxStaleSteps()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
    );
    process.env[ENV_KEY] = "-5";
    expect(getHeadlessRunMaxStaleSteps()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
    );
  });

  test("clamps a value above the ceiling", () => {
    process.env[ENV_KEY] = "999999";
    expect(getHeadlessRunMaxStaleSteps()).toBe(
      HEADLESS_RUN_MAX_STALE_STEPS_CEILING,
    );
  });
});

describe("buildHeadlessProgressFuseMessage (#1231, #1242 follow-up)", () => {
  test("stalled_tree names the stale-step count and the configured limit", () => {
    const message = buildHeadlessProgressFuseMessage({
      reason: "stalled_tree",
      repeatCount: 20,
      cycleLength: null,
      maxStaleSteps: 20,
    });
    expect(message).toContain("20");
    expect(message.toLowerCase()).toContain("progress");
  });

  test("is legible to a reading agent: states what happened and what to do next", () => {
    const message = buildHeadlessProgressFuseMessage({
      reason: "stalled_tree",
      repeatCount: 5,
      cycleLength: null,
      maxStaleSteps: 5,
    });
    // Must read as an explanation, not a bare code/enum value.
    expect(message.length).toBeGreaterThan(40);
    expect(message.toLowerCase()).toContain("stopped");
  });

  test("repeat names the repeated tool call, not 'workspace changes'", () => {
    const message = buildHeadlessProgressFuseMessage({
      reason: "repeat",
      repeatCount: 20,
      cycleLength: null,
      maxStaleSteps: 20,
    });
    expect(message.toLowerCase()).toContain("same tool call");
    expect(message).toContain("20");
    expect(message.toLowerCase()).not.toContain("no workspace changes");
  });

  test("cycle names the repeating pattern and its length", () => {
    const message = buildHeadlessProgressFuseMessage({
      reason: "cycle",
      repeatCount: 4,
      cycleLength: 2,
      maxStaleSteps: 20,
    });
    expect(message.toLowerCase()).toContain("repeating");
    expect(message).toContain("2");
    expect(message.toLowerCase()).not.toContain("no workspace changes");
  });
});

describe("getHeadlessRunMaxCyclePeriod (#1242 follow-up)", () => {
  const CYCLE_PERIOD_ENV_KEY = "HEADLESS_RUN_MAX_CYCLE_PERIOD";
  afterEach(() => {
    delete process.env[CYCLE_PERIOD_ENV_KEY];
  });

  test("defaults when the env var is unset", () => {
    expect(getHeadlessRunMaxCyclePeriod()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_CYCLE_PERIOD,
    );
  });

  test("reads a valid positive integer from the env var", () => {
    process.env[CYCLE_PERIOD_ENV_KEY] = "5";
    expect(getHeadlessRunMaxCyclePeriod()).toBe(5);
  });

  test("falls back to the default for a non-numeric or non-positive value", () => {
    process.env[CYCLE_PERIOD_ENV_KEY] = "nope";
    expect(getHeadlessRunMaxCyclePeriod()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_CYCLE_PERIOD,
    );
    process.env[CYCLE_PERIOD_ENV_KEY] = "0";
    expect(getHeadlessRunMaxCyclePeriod()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_CYCLE_PERIOD,
    );
  });

  test("clamps a value above the ceiling", () => {
    process.env[CYCLE_PERIOD_ENV_KEY] = "999999";
    expect(getHeadlessRunMaxCyclePeriod()).toBe(
      HEADLESS_RUN_MAX_CYCLE_PERIOD_CEILING,
    );
  });
});

describe("getHeadlessRunCycleRepeats (#1242 follow-up)", () => {
  const CYCLE_REPEATS_ENV_KEY = "HEADLESS_RUN_CYCLE_REPEATS";
  afterEach(() => {
    delete process.env[CYCLE_REPEATS_ENV_KEY];
  });

  test("defaults when the env var is unset", () => {
    expect(getHeadlessRunCycleRepeats()).toBe(
      DEFAULT_HEADLESS_RUN_CYCLE_REPEATS,
    );
  });

  test("reads a valid positive integer from the env var", () => {
    process.env[CYCLE_REPEATS_ENV_KEY] = "3";
    expect(getHeadlessRunCycleRepeats()).toBe(3);
  });

  test("falls back to the default for a non-numeric or non-positive value", () => {
    process.env[CYCLE_REPEATS_ENV_KEY] = "nope";
    expect(getHeadlessRunCycleRepeats()).toBe(
      DEFAULT_HEADLESS_RUN_CYCLE_REPEATS,
    );
  });

  test("clamps a value above the ceiling", () => {
    process.env[CYCLE_REPEATS_ENV_KEY] = "999999";
    expect(getHeadlessRunCycleRepeats()).toBe(
      HEADLESS_RUN_CYCLE_REPEATS_CEILING,
    );
  });
});

// #1231 follow-up: a headless run with no sandbox (no-repo session) cannot be
// probed — every fingerprint is null, so the no-progress budget above never
// trips. This fixed cap is the only signal available for that case.
describe("getHeadlessRunNoSandboxStepCap (#1231)", () => {
  test("defaults when the env var is unset", () => {
    expect(getHeadlessRunNoSandboxStepCap()).toBe(
      DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP,
    );
  });

  test("reads a valid positive integer from the env var", () => {
    process.env[NO_SANDBOX_ENV_KEY] = "12";
    expect(getHeadlessRunNoSandboxStepCap()).toBe(12);
  });

  test("falls back to the default for a non-numeric or non-positive value", () => {
    process.env[NO_SANDBOX_ENV_KEY] = "nope";
    expect(getHeadlessRunNoSandboxStepCap()).toBe(
      DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP,
    );
    process.env[NO_SANDBOX_ENV_KEY] = "0";
    expect(getHeadlessRunNoSandboxStepCap()).toBe(
      DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP,
    );
  });

  test("clamps a value above the ceiling", () => {
    process.env[NO_SANDBOX_ENV_KEY] = "999999";
    expect(getHeadlessRunNoSandboxStepCap()).toBe(
      HEADLESS_RUN_NO_SANDBOX_STEP_CAP_CEILING,
    );
  });

  // Independently tunable, as required: overriding the stale-steps budget
  // must not move the no-sandbox cap and vice versa.
  test("is independent of HEADLESS_RUN_MAX_STALE_STEPS", () => {
    process.env[ENV_KEY] = "3";
    expect(getHeadlessRunNoSandboxStepCap()).toBe(
      DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP,
    );
  });
});

describe("buildHeadlessNoSandboxCapMessage (#1231)", () => {
  test("names the cap and explains why a sandbox-free run cannot use the progress fuse", () => {
    const message = buildHeadlessNoSandboxCapMessage(50);
    expect(message).toContain("50");
    expect(message.toLowerCase()).toContain("stopped");
    expect(message.length).toBeGreaterThan(40);
  });
});
