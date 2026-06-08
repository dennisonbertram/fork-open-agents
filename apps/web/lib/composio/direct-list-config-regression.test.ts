import { describe, expect, test } from "bun:test";
import {
  buildComposioSessionConfigFromDirectList,
  hashDirectConfig,
} from "./direct-list-config";
import {
  normalizeChatComposioSelection,
  chatComposioSelectionInputSchema,
  defaultChatComposioSelection,
} from "./types";

/**
 * Regression tests for the per-chat direct tool picker (TASK-224 / green: 57e03111).
 * These tests catch regressions if:
 * - directToolkitSlugs is removed from ChatComposioSelection
 * - The one-wins rule is reverted
 * - buildComposioSessionConfigFromDirectList is removed or signature changes
 * - hashDirectConfig produces different hashes for the same input
 */

describe("Regression: direct toolkit list schema round-trips correctly", () => {
  test("REG-001: directToolkitSlugs survives a parse→normalize round-trip unchanged", () => {
    const parsed = chatComposioSelectionInputSchema.safeParse({
      mainProfileId: null,
      directToolkitSlugs: ["github", "linear", "slack"],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const normalized = normalizeChatComposioSelection(parsed.data);
    expect(normalized.directToolkitSlugs).toEqual([
      "github",
      "linear",
      "slack",
    ]);
    expect(normalized.mainProfileId).toBeNull();
  });

  test("REG-002: reverting one-wins rule would cause this test to fail — profile is null when directSlugs present", () => {
    // If someone removes the one-wins rule and lets mainProfileId coexist with
    // directToolkitSlugs, this test fails.
    const result = normalizeChatComposioSelection({
      mainProfileId: "profile-should-be-cleared",
      directToolkitSlugs: ["github"],
    });
    expect(result.mainProfileId).toBeNull();
  });

  test("REG-003: absence of directToolkitSlugs does not break existing profile behavior", () => {
    // Guard against regressions on the existing (pre-TASK-224) path
    const result = normalizeChatComposioSelection({
      mainProfileId: "profile-abc",
    });
    expect(result).toEqual({ mainProfileId: "profile-abc" });
    expect(result.directToolkitSlugs).toBeUndefined();
  });

  test("REG-004: defaultChatComposioSelection is still {mainProfileId:null} with no directToolkitSlugs", () => {
    expect(defaultChatComposioSelection).toEqual({ mainProfileId: null });
    expect(
      (defaultChatComposioSelection as Record<string, unknown>)
        .directToolkitSlugs,
    ).toBeUndefined();
  });
});

describe("Regression: buildComposioSessionConfigFromDirectList config shape", () => {
  test("REG-005: toolkits field is always present and non-empty", () => {
    const config = buildComposioSessionConfigFromDirectList({
      toolkitSlugs: ["github"],
      connectedAccountIdsByToolkit: {},
    });
    // toolkits is a string[] per our direct-list contract
    const toolkits = config.toolkits as string[] | undefined;
    expect(Array.isArray(toolkits)).toBe(true);
    expect((toolkits as string[]).length).toBeGreaterThan(0);
  });

  test("REG-006: manageConnections is always false (no in-chat connection management for direct list)", () => {
    const config = buildComposioSessionConfigFromDirectList({
      toolkitSlugs: ["github"],
      connectedAccountIdsByToolkit: { github: ["acct-1"] },
    });
    // Must be exactly false, not { enable: true }
    expect(config.manageConnections).toBe(false);
  });

  test("REG-007: workbench is always disabled for direct list", () => {
    const config = buildComposioSessionConfigFromDirectList({
      toolkitSlugs: ["github"],
      connectedAccountIdsByToolkit: {},
    });
    expect(config.workbench).toEqual({ enable: false });
  });

  test("REG-008: gmail account excluded when github+linear selected", () => {
    // Regression: if connected-account filtering is broken, gmail leaks into config
    const config = buildComposioSessionConfigFromDirectList({
      toolkitSlugs: ["github", "linear"],
      connectedAccountIdsByToolkit: {
        github: ["acct-gh"],
        gmail: ["acct-gmail-should-not-appear"],
      },
    });
    const accts = config.connectedAccounts as
      | Record<string, unknown>
      | undefined;
    expect(accts?.gmail).toBeUndefined();
    expect(accts?.github).toEqual(["acct-gh"]);
  });
});

describe("Regression: hashDirectConfig is stable and order-independent", () => {
  test("REG-009: same slugs in different order produce same hash", () => {
    const h1 = hashDirectConfig(["github", "linear", "slack"]);
    const h2 = hashDirectConfig(["slack", "github", "linear"]);
    expect(h1).toBe(h2);
  });

  test("REG-010: adding a slug changes the hash", () => {
    const h1 = hashDirectConfig(["github"]);
    const h2 = hashDirectConfig(["github", "linear"]);
    expect(h1).not.toBe(h2);
  });

  test("REG-011: empty list throws (cannot create session cache row for empty direct list)", () => {
    // If this stops throwing, an empty direct list could create an invalid session record
    expect(() =>
      buildComposioSessionConfigFromDirectList({
        toolkitSlugs: [],
        connectedAccountIdsByToolkit: {},
      }),
    ).toThrow();
  });
});
