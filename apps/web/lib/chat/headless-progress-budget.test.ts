import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildHeadlessNoSandboxCapMessage,
  buildHeadlessProgressFuseMessage,
  DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
  DEFAULT_HEADLESS_RUN_NO_SANDBOX_STEP_CAP,
  getHeadlessRunMaxStaleSteps,
  getHeadlessRunNoSandboxStepCap,
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

describe("buildHeadlessProgressFuseMessage (#1231)", () => {
  test("names the stale-step count and the configured limit", () => {
    const message = buildHeadlessProgressFuseMessage(20, 20);
    expect(message).toContain("20");
    expect(message.toLowerCase()).toContain("progress");
  });

  test("is legible to a reading agent: states what happened and what to do next", () => {
    const message = buildHeadlessProgressFuseMessage(5, 5);
    // Must read as an explanation, not a bare code/enum value.
    expect(message.length).toBeGreaterThan(40);
    expect(message.toLowerCase()).toContain("stopped");
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
