import { describe, expect, test } from "bun:test";
import type { HarnessConfig } from "@/lib/harness/config";
import { decideVerifiedBuildMode } from "./mode-policy";

const enabledConfig: HarnessConfig = {
  enabled: true,
  baseUrl: "https://harness.example.com",
  serviceToken: "token",
  tenantId: "tenant",
  allowedDirectMode: false,
  logJson: false,
  requestTimeoutMs: 1000,
  sseReplayLimit: 100,
};

describe("verified build mode policy", () => {
  test("starts verified build when enabled", () => {
    expect(
      decideVerifiedBuildMode({
        config: enabledConfig,
        classification: {
          mode: "verified_build",
          reasonCode: "mutating_software_work",
          confidence: 0.9,
          summary: "Fix it",
        },
      }),
    ).toEqual({
      action: "start_verified_build",
      reason: "mutating_software_work",
    });
  });

  test("rejects direct mode when disabled", () => {
    expect(
      decideVerifiedBuildMode({
        config: enabledConfig,
        directModeRequested: true,
        classification: {
          mode: "verified_build",
          reasonCode: "mutating_software_work",
          confidence: 0.9,
          summary: "Fix it",
        },
      }),
    ).toEqual({
      action: "reject_direct_mode",
      reason: "direct_mode_disabled",
    });
  });
});
