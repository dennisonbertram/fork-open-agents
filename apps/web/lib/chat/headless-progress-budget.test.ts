import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildHeadlessProgressFuseMessage,
  DEFAULT_HEADLESS_RUN_MAX_STALE_STEPS,
  getHeadlessRunMaxStaleSteps,
  HEADLESS_RUN_MAX_STALE_STEPS_CEILING,
} from "./headless-progress-budget";

const ENV_KEY = "HEADLESS_RUN_MAX_STALE_STEPS";
const original = process.env[ENV_KEY];

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (original === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = original;
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
