import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_MAX_LENGTH_CONTINUATIONS,
  getMaxLengthContinuations,
  MAX_LENGTH_CONTINUATIONS_CEILING,
} from "./length-continuation-budget";

const ENV_KEY = "CHAT_MAX_LENGTH_CONTINUATIONS";
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

describe("getMaxLengthContinuations (#1247)", () => {
  test("defaults when the env var is unset", () => {
    expect(getMaxLengthContinuations()).toBe(DEFAULT_MAX_LENGTH_CONTINUATIONS);
  });

  test("reads a valid positive integer from the env var", () => {
    process.env[ENV_KEY] = "5";
    expect(getMaxLengthContinuations()).toBe(5);
  });

  test("falls back to the default for a non-numeric value", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(getMaxLengthContinuations()).toBe(DEFAULT_MAX_LENGTH_CONTINUATIONS);
  });

  test("falls back to the default for zero or negative values", () => {
    process.env[ENV_KEY] = "0";
    expect(getMaxLengthContinuations()).toBe(DEFAULT_MAX_LENGTH_CONTINUATIONS);
    process.env[ENV_KEY] = "-5";
    expect(getMaxLengthContinuations()).toBe(DEFAULT_MAX_LENGTH_CONTINUATIONS);
  });

  test("clamps a value above the ceiling instead of allowing an unbounded loop", () => {
    process.env[ENV_KEY] = "1000";
    expect(getMaxLengthContinuations()).toBe(MAX_LENGTH_CONTINUATIONS_CEILING);
  });
});
