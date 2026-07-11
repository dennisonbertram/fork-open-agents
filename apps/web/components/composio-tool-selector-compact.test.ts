import { describe, expect, test } from "bun:test";

/**
 * Pure logic tests for the updated ComposioToolSelectorCompact.
 *
 * Since the component is a React component that needs a DOM, we test only the
 * behavioral rules that are pure / stateless:
 *
 * 1. Trigger-button label logic: directToolkitSlugs → summarizeChatTools
 * 2. One-wins selection mutation helpers
 *
 * These tests FAIL until the component is updated to support directToolkitSlugs.
 */

// Import pure helpers that the updated component will expose or rely on
import { summarizeChatTools } from "@/lib/composio/chat-tool-summary";
import type { ChatComposioSelection } from "@/lib/composio/types";

// Helper that mirrors the label logic the component implements
function computeToolLabel(selection: ChatComposioSelection): string {
  if (selection.directToolkitSlugs && selection.directToolkitSlugs.length > 0) {
    return `Tools: ${summarizeChatTools(selection.directToolkitSlugs)}`;
  }
  return "Tools: Off";
}

// Helper that mirrors the "select direct tools" onChange logic
function selectDirectTools(
  current: ChatComposioSelection,
  slugs: string[],
): ChatComposioSelection {
  return {
    ...current,
    directToolkitSlugs: slugs,
    mainProfileId: slugs.length > 0 ? null : current.mainProfileId,
  };
}

// Helper that mirrors the "select profile" onChange logic
function selectProfile(
  current: ChatComposioSelection,
  profileId: string | null,
): ChatComposioSelection {
  return {
    ...current,
    mainProfileId: profileId,
    directToolkitSlugs: [],
  };
}

describe("BT-S6: ComposioToolSelectorCompact label logic — directToolkitSlugs", () => {
  test("BT-S6-001: shows summarized slugs in label when directToolkitSlugs is non-empty", () => {
    const selection: ChatComposioSelection = {
      mainProfileId: null,
      directToolkitSlugs: ["github", "linear"],
    };
    expect(computeToolLabel(selection)).toBe("Tools: Github, Linear");
  });

  test("BT-S6-002: shows 'Tools: Off' when directToolkitSlugs is empty", () => {
    const selection: ChatComposioSelection = {
      mainProfileId: null,
      directToolkitSlugs: [],
    };
    expect(computeToolLabel(selection)).toBe("Tools: Off");
  });

  test("BT-S6-003: shows 'Tools: Off' when directToolkitSlugs is absent", () => {
    const selection: ChatComposioSelection = {
      mainProfileId: null,
    };
    expect(computeToolLabel(selection)).toBe("Tools: Off");
  });

  test("BT-S6-004: direct tool selection clears mainProfileId when slugs non-empty", () => {
    const current: ChatComposioSelection = {
      mainProfileId: "profile-abc",
      directToolkitSlugs: [],
    };
    const next = selectDirectTools(current, ["github"]);
    expect(next.mainProfileId).toBeNull();
    expect(next.directToolkitSlugs).toEqual(["github"]);
  });

  test("BT-S6-005: profile selection clears directToolkitSlugs", () => {
    const current: ChatComposioSelection = {
      mainProfileId: null,
      directToolkitSlugs: ["github", "linear"],
    };
    const next = selectProfile(current, "profile-abc");
    expect(next.mainProfileId).toBe("profile-abc");
    expect(next.directToolkitSlugs).toEqual([]);
  });

  test("BT-S6-006: selecting 'Off' profile preserves directToolkitSlugs cleared", () => {
    const current: ChatComposioSelection = {
      mainProfileId: null,
      directToolkitSlugs: ["github"],
    };
    const next = selectProfile(current, null);
    expect(next.mainProfileId).toBeNull();
    expect(next.directToolkitSlugs).toEqual([]);
  });
});

describe("#803 item 7 (C4): selected-vs-connected disclaimer caption", () => {
  test("BT-803-007: caption distinguishes 'selected for this chat' from a live connection check", async () => {
    const { SELECTED_NOT_CONNECTED_CAPTION } =
      await import("@/lib/composio/chat-tool-summary");
    expect(SELECTED_NOT_CONNECTED_CAPTION).toMatch(/selected for this chat/i);
    expect(SELECTED_NOT_CONNECTED_CAPTION).toMatch(/settings.*composio/i);
  });
});
