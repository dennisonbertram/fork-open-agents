import { describe, expect, test } from "bun:test";
import {
  classifyVerificationFailure,
  isWrongTierVerificationFailure,
  WRONG_TIER_SIGNALS,
} from "./wrong-tier-signal";

// BT-006: wrong-tier classification

describe("wrong-tier signal", () => {
  // BT-006a: docker verify-docker-daemon failure is classified "wrong_tier"
  test("docker-in-sandbox verify-docker-daemon failure is classified wrong_tier", () => {
    expect(
      isWrongTierVerificationFailure("docker-in-sandbox", "verify-docker-daemon"),
    ).toBe(true);
  });

  test("classifyVerificationFailure returns wrong_tier for docker-in-sandbox verify-docker-daemon", () => {
    const result = classifyVerificationFailure(
      "docker-in-sandbox",
      "verify-docker-daemon",
    );
    expect(result.kind).toBe("wrong_tier");
  });

  test("wrong_tier result includes an actionable message about privileged tier", () => {
    const result = classifyVerificationFailure(
      "docker-in-sandbox",
      "verify-docker-daemon",
    );
    expect(result.kind).toBe("wrong_tier");
    if (result.kind === "wrong_tier") {
      expect(result.message).toContain("privileged");
    }
  });

  // BT-006b: python setup failure is NOT wrong_tier
  test("python-uv verify-python failure is classified setup_failure, not wrong_tier", () => {
    expect(
      isWrongTierVerificationFailure("python-uv", "verify-python"),
    ).toBe(false);
  });

  test("classifyVerificationFailure returns setup_failure for python-uv verify-python", () => {
    const result = classifyVerificationFailure("python-uv", "verify-python");
    expect(result.kind).toBe("setup_failure");
  });

  // BT-006c: unknown profile/command returns setup_failure (safe default)
  test("unknown profile and command returns setup_failure", () => {
    const result = classifyVerificationFailure(
      "some-other-profile",
      "some-command",
    );
    expect(result.kind).toBe("setup_failure");
  });

  test("isWrongTierVerificationFailure returns false for unknown profile", () => {
    expect(
      isWrongTierVerificationFailure("unknown-profile", "verify-docker-daemon"),
    ).toBe(false);
  });

  // BT-006d: WRONG_TIER_SIGNALS map is exported and contains docker entry
  test("WRONG_TIER_SIGNALS map contains docker-in-sandbox verify-docker-daemon entry", () => {
    expect(
      WRONG_TIER_SIGNALS["docker-in-sandbox"]?.includes("verify-docker-daemon"),
    ).toBe(true);
  });

  // BT-006e: other docker commands (non-daemon) are NOT wrong_tier
  test("docker-in-sandbox verify-docker-cli is not wrong_tier (CLI presence is not tier-gated)", () => {
    expect(
      isWrongTierVerificationFailure("docker-in-sandbox", "verify-docker-cli"),
    ).toBe(false);
  });

  test("docker-in-sandbox verify-docker-run is not wrong_tier (optional check)", () => {
    expect(
      isWrongTierVerificationFailure("docker-in-sandbox", "verify-docker-run"),
    ).toBe(false);
  });
});
