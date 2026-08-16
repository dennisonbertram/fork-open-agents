import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildDiffAcceptanceViolationMessage,
  buildHeadlessNoFileChangesMessage,
  buildRunOuterStepCeilingMessage,
  DEFAULT_HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF,
  DEFAULT_RUN_OUTER_STEP_CEILING,
  getHeadlessRunMaxStepsWithoutDiff,
  getRunOuterStepCeiling,
  HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF_CEILING,
  resolveStepsWithoutDiffAllowance,
  RUN_OUTER_STEP_CEILING_CEILING,
} from "./declared-expectation-budget";

const NO_DIFF_ENV_KEY = "HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF";
const OUTER_CEILING_ENV_KEY = "RUN_OUTER_STEP_CEILING";
const originalNoDiff = process.env[NO_DIFF_ENV_KEY];
const originalOuterCeiling = process.env[OUTER_CEILING_ENV_KEY];

beforeEach(() => {
  delete process.env[NO_DIFF_ENV_KEY];
  delete process.env[OUTER_CEILING_ENV_KEY];
});

afterEach(() => {
  if (originalNoDiff === undefined) {
    delete process.env[NO_DIFF_ENV_KEY];
  } else {
    process.env[NO_DIFF_ENV_KEY] = originalNoDiff;
  }
  if (originalOuterCeiling === undefined) {
    delete process.env[OUTER_CEILING_ENV_KEY];
  } else {
    process.env[OUTER_CEILING_ENV_KEY] = originalOuterCeiling;
  }
});

describe("getHeadlessRunMaxStepsWithoutDiff (#1288)", () => {
  test("defaults when the env var is unset", () => {
    expect(getHeadlessRunMaxStepsWithoutDiff()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF,
    );
  });

  test("reads a valid positive integer from the env var", () => {
    process.env[NO_DIFF_ENV_KEY] = "7";
    expect(getHeadlessRunMaxStepsWithoutDiff()).toBe(7);
  });

  test("falls back to the default for a non-numeric or non-positive value", () => {
    process.env[NO_DIFF_ENV_KEY] = "not-a-number";
    expect(getHeadlessRunMaxStepsWithoutDiff()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF,
    );
    process.env[NO_DIFF_ENV_KEY] = "0";
    expect(getHeadlessRunMaxStepsWithoutDiff()).toBe(
      DEFAULT_HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF,
    );
  });

  test("clamps a value above the ceiling", () => {
    process.env[NO_DIFF_ENV_KEY] = "999999";
    expect(getHeadlessRunMaxStepsWithoutDiff()).toBe(
      HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF_CEILING,
    );
  });
});

describe("getRunOuterStepCeiling (#1288)", () => {
  test("defaults when the env var is unset", () => {
    expect(getRunOuterStepCeiling()).toBe(DEFAULT_RUN_OUTER_STEP_CEILING);
  });

  test("reads a valid positive integer from the env var", () => {
    process.env[OUTER_CEILING_ENV_KEY] = "42";
    expect(getRunOuterStepCeiling()).toBe(42);
  });

  test("falls back to the default for a non-numeric or non-positive value", () => {
    process.env[OUTER_CEILING_ENV_KEY] = "nope";
    expect(getRunOuterStepCeiling()).toBe(DEFAULT_RUN_OUTER_STEP_CEILING);
    process.env[OUTER_CEILING_ENV_KEY] = "-1";
    expect(getRunOuterStepCeiling()).toBe(DEFAULT_RUN_OUTER_STEP_CEILING);
  });

  test("clamps a value above the ceiling", () => {
    process.env[OUTER_CEILING_ENV_KEY] = "999999999";
    expect(getRunOuterStepCeiling()).toBe(RUN_OUTER_STEP_CEILING_CEILING);
  });

  // The default must sit above the browser route's own 500-step maxSteps
  // default, or this "backstop under everything" would become the PRIMARY
  // bound for every ordinary browser chat, which the design explicitly
  // rejects ("a backstop under everything, not the primary bound").
  test("the default is generous enough to never preempt the browser route's own 500-step default", () => {
    expect(DEFAULT_RUN_OUTER_STEP_CEILING).toBeGreaterThan(500);
  });
});

describe("buildHeadlessNoFileChangesMessage (#1288)", () => {
  test("names the stale-step count and the configured allowance", () => {
    const message = buildHeadlessNoFileChangesMessage(20, 20);
    expect(message).toContain("20");
    expect(message.toLowerCase()).toContain("stopped");
    expect(message.length).toBeGreaterThan(40);
  });

  test("distinguishes itself from the generic no-progress fuse wording", () => {
    const message = buildHeadlessNoFileChangesMessage(5, 5);
    expect(message.toLowerCase()).toContain("declared");
  });
});

describe("buildRunOuterStepCeilingMessage (#1288)", () => {
  test("names the ceiling and reads as a backstop, not a normal completion", () => {
    const message = buildRunOuterStepCeilingMessage(1000);
    expect(message).toContain("1000");
    expect(message.toLowerCase()).toContain("stopped");
  });
});

describe("buildDiffAcceptanceViolationMessage (#1288)", () => {
  test("lists every offending path", () => {
    const message = buildDiffAcceptanceViolationMessage([
      "unexpected.ts",
      "also-bad.ts",
    ]);
    expect(message).toContain("unexpected.ts");
    expect(message).toContain("also-bad.ts");
    expect(message.toLowerCase()).toContain("stopped");
  });
});

describe("caller-supplied no-diff allowance (#1307 follow-up)", () => {
  // Three dispatched slices died at the 20-step default on 2026-08-16 while
  // doing legitimate research — reading the files they had been told to match
  // conventions with, before writing anything. The dispatcher knew those tasks
  // needed to read first; it had no way to say so. The env var is global, and
  // the run that needs 40 steps sits beside the run that should stop at 5.
  test("a caller number sets the allowance", () => {
    expect(resolveStepsWithoutDiffAllowance(45)).toBe(45);
  });

  test("`true` keeps the configured default", () => {
    expect(resolveStepsWithoutDiffAllowance(true)).toBe(
      getHeadlessRunMaxStepsWithoutDiff(),
    );
  });

  test("a caller cannot exceed the ceiling", () => {
    expect(resolveStepsWithoutDiffAllowance(10_000)).toBe(
      HEADLESS_RUN_MAX_STEPS_WITHOUT_DIFF_CEILING,
    );
  });

  test("a nonsense allowance falls back to the default rather than disabling the fuse", () => {
    // 0 or negative must not mean "never stop" — that would turn a cost
    // control into an unbounded run, which is the failure this fuse exists
    // to prevent.
    expect(resolveStepsWithoutDiffAllowance(0)).toBe(
      getHeadlessRunMaxStepsWithoutDiff(),
    );
    expect(resolveStepsWithoutDiffAllowance(-5)).toBe(
      getHeadlessRunMaxStepsWithoutDiff(),
    );
    expect(resolveStepsWithoutDiffAllowance(1.5)).toBe(1);
  });

  test("false and undefined mean the fuse is not armed at all", () => {
    expect(resolveStepsWithoutDiffAllowance(false)).toBeNull();
    expect(resolveStepsWithoutDiffAllowance(undefined)).toBeNull();
  });
});
