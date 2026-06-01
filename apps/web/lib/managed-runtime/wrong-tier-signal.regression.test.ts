/**
 * Regression tests for wrong-tier signal classification.
 *
 * These tests catch future breakage when:
 * - WRONG_TIER_SIGNALS map entries are removed or renamed
 * - The docker-in-sandbox profile id changes
 * - The verify-docker-daemon command id changes
 * - New profiles accidentally get wrong-tier signals
 */

import { describe, expect, test } from "bun:test";
import {
  classifyVerificationFailure,
  isWrongTierVerificationFailure,
  WRONG_TIER_SIGNALS,
} from "./wrong-tier-signal";

describe("wrong-tier signal — regression", () => {
  // If the WRONG_TIER_SIGNALS map is cleared or the key renamed, this fails
  test("WRONG_TIER_SIGNALS contains exactly one entry for docker-in-sandbox", () => {
    expect(Object.keys(WRONG_TIER_SIGNALS)).toContain("docker-in-sandbox");
    expect(WRONG_TIER_SIGNALS["docker-in-sandbox"]).toContain(
      "verify-docker-daemon",
    );
  });

  // If docker-in-sandbox profile id is renamed, this fails
  test("docker-in-sandbox verify-docker-daemon is always classified wrong_tier (id mutation guard)", () => {
    expect(
      isWrongTierVerificationFailure(
        "docker-in-sandbox",
        "verify-docker-daemon",
      ),
    ).toBe(true);
  });

  // The message must mention 'privileged' — regression if message text changes
  test("wrong_tier result always contains 'privileged' in message (message contract guard)", () => {
    const result = classifyVerificationFailure(
      "docker-in-sandbox",
      "verify-docker-daemon",
    );
    expect(result.kind).toBe("wrong_tier");
    if (result.kind === "wrong_tier") {
      expect(result.message.toLowerCase()).toContain("privileged");
    }
  });

  // Safety: verify non-docker profiles never classified wrong_tier (no leakage)
  test.each([
    ["python-uv", "verify-uv"],
    ["python-uv", "verify-python"],
    ["go-toolchain", "verify-go"],
    ["go-toolchain", "verify-go-env"],
    ["rust-cargo", "verify-rustc"],
    ["rust-cargo", "verify-cargo"],
    ["rust-cargo", "verify-linker"],
    ["web-bun-agent-browser", "verify-bun"],
    ["web-bun-agent-browser", "verify-agent-browser"],
  ])(
    "%s/%s is never classified wrong_tier (no leakage regression)",
    (profileId, commandId) => {
      expect(isWrongTierVerificationFailure(profileId, commandId)).toBe(false);
      expect(classifyVerificationFailure(profileId, commandId).kind).toBe(
        "setup_failure",
      );
    },
  );
});
