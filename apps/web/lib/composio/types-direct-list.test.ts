import { describe, expect, test } from "bun:test";
import {
  chatComposioSelectionInputSchema,
  normalizeChatComposioSelection,
  defaultChatComposioSelection,
} from "./types";

/**
 * Tests for the new directToolkitSlugs field on ChatComposioSelection.
 * All tests in this file will FAIL until the types.ts implementation is updated.
 */
describe("chatComposioSelectionInputSchema — directToolkitSlugs", () => {
  test("BT-S0-001: schema accepts directToolkitSlugs array", () => {
    const result = chatComposioSelectionInputSchema.safeParse({
      mainProfileId: null,
      directToolkitSlugs: ["github", "linear"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.directToolkitSlugs).toEqual(["github", "linear"]);
    }
  });

  test("BT-S0-002: schema allows directToolkitSlugs to be absent (optional)", () => {
    const result = chatComposioSelectionInputSchema.safeParse({
      mainProfileId: "profile-1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.directToolkitSlugs).toBeUndefined();
    }
  });

  test("BT-S0-003: schema allows empty directToolkitSlugs array", () => {
    const result = chatComposioSelectionInputSchema.safeParse({
      mainProfileId: null,
      directToolkitSlugs: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("normalizeChatComposioSelection — directToolkitSlugs one-wins rule", () => {
  test("BT-S0-004: non-empty directToolkitSlugs forces mainProfileId to null", () => {
    const result = normalizeChatComposioSelection({
      mainProfileId: "profile-abc",
      directToolkitSlugs: ["github"],
    });

    // One-wins: direct list beats profile
    expect(result.mainProfileId).toBeNull();
    expect(result.directToolkitSlugs).toBeDefined();
    expect(result.directToolkitSlugs).toEqual(["github"]);
  });

  test("BT-S0-005: empty directToolkitSlugs falls back to profile path (no override)", () => {
    const result = normalizeChatComposioSelection({
      mainProfileId: "profile-abc",
      directToolkitSlugs: [],
    });

    // Empty list does NOT trigger one-wins — profile is retained
    expect(result.mainProfileId).toBe("profile-abc");
    // directToolkitSlugs should be absent or empty, not forcing null
    expect(!result.directToolkitSlugs?.length).toBe(true);
  });

  test("BT-S0-006: whitespace-only slugs in directToolkitSlugs are treated as empty (falls back)", () => {
    const result = normalizeChatComposioSelection({
      mainProfileId: "profile-abc",
      directToolkitSlugs: ["   ", "bad slug!"],
    });

    // All slugs invalid after normalization → falls back to profile path
    expect(result.mainProfileId).toBe("profile-abc");
  });

  test("BT-S0-007: directToolkitSlugs are deduplicated and trimmed", () => {
    const result = normalizeChatComposioSelection({
      mainProfileId: null,
      directToolkitSlugs: [" GitHub ", "github", "Linear"],
    });

    expect(result.directToolkitSlugs).toEqual(["github", "linear"]);
  });

  test("BT-S0-008: absence of directToolkitSlugs behaves exactly as today", () => {
    const result = normalizeChatComposioSelection({
      mainProfileId: null,
    });
    expect(result).toEqual(defaultChatComposioSelection);
  });
});
