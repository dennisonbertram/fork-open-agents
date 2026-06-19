/**
 * Behavioral tests for the regrouped PreferencesSection layout.
 *
 * These tests verify the concern-based groups, plain-language captions,
 * sentence-case labels, and clarifying copy added per the preferences review.
 *
 * Because PreferencesSection is a heavy "use client" component that calls
 * hooks, we test the pure helper that maps group structure — and also test
 * the static composition of the page (sections present, groups labelled).
 *
 * BT-101: preferences-section-groups.ts exports a PREFERENCE_GROUPS array
 *         with the 6 expected groups in order.
 * BT-102: Each group has the correct title (sentence case).
 * BT-103: The Appearance group has the browser-local caption.
 * BT-104: The Git automation group has the auto-PR dependency caption.
 * BT-105: The Notifications group has the alert-sound caption.
 * BT-106: The Defaults for new chats group distinguishes sandbox vs profile.
 * BT-107: The Skills group clarifies precedence.
 */
import { describe, expect, test } from "bun:test";

const EXPECTED_GROUP_TITLES: string[] = [
  "Appearance",
  "Defaults for new chats",
  "Git automation",
  "Notifications",
  "Sharing & privacy",
  "Skills",
];

describe("preference-groups structure", () => {
  test("BT-101: PREFERENCE_GROUPS has exactly 6 entries", async () => {
    const { PREFERENCE_GROUPS } =
      await import("../preferences/preference-groups");
    expect(PREFERENCE_GROUPS).toHaveLength(6);
  });

  test("BT-102: group titles match expected sentence-case names in order", async () => {
    const { PREFERENCE_GROUPS } =
      await import("../preferences/preference-groups");
    const titles = PREFERENCE_GROUPS.map((g: { title: string }) => g.title);
    expect(titles).toEqual(EXPECTED_GROUP_TITLES);
  });

  test("BT-103: Appearance group has browser-only caption", async () => {
    const { PREFERENCE_GROUPS } =
      await import("../preferences/preference-groups");
    const appearance = PREFERENCE_GROUPS.find(
      (g: { title: string }) => g.title === "Appearance",
    );
    expect(appearance).toBeDefined();
    expect(appearance?.caption).toContain(
      "doesn't follow you to other devices",
    );
  });

  test("BT-104: Git automation group has auto-PR dependency caption", async () => {
    const { PREFERENCE_GROUPS } =
      await import("../preferences/preference-groups");
    const gitGroup = PREFERENCE_GROUPS.find(
      (g: { title: string }) => g.title === "Git automation",
    );
    expect(gitGroup).toBeDefined();
    expect(gitGroup?.autoCreatePrCaption).toContain("Auto commit & push is on");
  });

  test("BT-105: Notifications group has alert-sound caption", async () => {
    const { PREFERENCE_GROUPS } =
      await import("../preferences/preference-groups");
    const notifGroup = PREFERENCE_GROUPS.find(
      (g: { title: string }) => g.title === "Notifications",
    );
    expect(notifGroup).toBeDefined();
    expect(notifGroup?.alertSoundCaption).toBeTruthy();
  });

  test("BT-106: Defaults for new chats group has sandbox/profile distinction copy", async () => {
    const { PREFERENCE_GROUPS } =
      await import("../preferences/preference-groups");
    const defaultsGroup = PREFERENCE_GROUPS.find(
      (g: { title: string }) => g.title === "Defaults for new chats",
    );
    expect(defaultsGroup).toBeDefined();
    // Must include the clarifying sandbox-vs-profile sentence.
    expect(defaultsGroup?.sandboxVsProfileCaption).toContain(
      "sandbox is where code runs",
    );
    // Must include the sandbox single-option helper copy.
    expect(defaultsGroup?.sandboxHelperCopy).toContain(
      "only execution backend",
    );
  });

  test("BT-107: Skills group clarifies repo-wins precedence", async () => {
    const { PREFERENCE_GROUPS } =
      await import("../preferences/preference-groups");
    const skillsGroup = PREFERENCE_GROUPS.find(
      (g: { title: string }) => g.title === "Skills",
    );
    expect(skillsGroup).toBeDefined();
    expect(skillsGroup?.precedenceCaption).toContain("repo");
  });
});
