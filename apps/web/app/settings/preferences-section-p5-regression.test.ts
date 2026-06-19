/**
 * P5 regression tests — preferences-section.tsx SettingsGroup/SettingRow retrofit
 *
 * These tests read the preferences-section.tsx source text to assert that:
 * 1. The Git automation group uses SettingsGroup (not the old bespoke div).
 * 2. The Notifications group uses SettingsGroup (not the old bespoke div).
 * 3. The auto-PR hint copy is preserved in the description prop.
 * 4. The alert-sound SettingRow is still guarded by the alertsEnabled conditional.
 * 5. All control ids (auto-commit-push, auto-create-pr, alerts-enabled, alert-sound-enabled)
 *    remain present so Label htmlFor still targets the right element.
 *
 * Source-text approach: the live component uses hooks (can't easily render it in
 * bun:test without heavy mocking). Source-text checks are reliable for authoring
 * patterns — they catch "someone reverted to the old bespoke div" regressions.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const src = readFileSync(
  resolve(import.meta.dir, "preferences-section.tsx"),
  "utf8",
);

describe("P5 preferences-section retrofit regression", () => {
  // REG-P5-PREFS-001: Git automation group uses SettingsGroup, not old bespoke header
  test("REG-P5-PREFS-001: Git automation uses SettingsGroup title prop (not GroupHeader)", () => {
    // The old markup was: <GroupHeader>Git automation</GroupHeader>
    // After retrofit: <SettingsGroup title="Git automation" ...>
    // We check that the title prop form exists in the live section (not just the skeleton).
    // The skeleton still has <GroupHeader>Git automation</GroupHeader>, so we can't simply
    // assert absence of GroupHeader — we check the SettingsGroup title form is present.
    expect(src).toContain('title="Git automation"');
  });

  // REG-P5-PREFS-002: Notifications group uses SettingsGroup, not old bespoke header
  test("REG-P5-PREFS-002: Notifications uses SettingsGroup title prop (not only GroupHeader)", () => {
    expect(src).toContain('title="Notifications"');
  });

  // REG-P5-PREFS-003: Auto-PR hint copy is in the source (not only relying on disabled state)
  test("REG-P5-PREFS-003: auto-PR hint copy is present in preferences-section source", () => {
    expect(src).toContain("Available once Auto commit");
  });

  // REG-P5-PREFS-004: Alert-sound SettingRow is still guarded by alertsEnabled conditional
  // The guard must be an `&&` expression around a SettingRow for alert-sound-enabled.
  test("REG-P5-PREFS-004: alert-sound SettingRow is inside an alertsEnabled && guard", () => {
    // The conditional guard: {(preferences?.alertsEnabled ?? true) && (
    // The controlled element below it references alert-sound-enabled.
    const alertGuardIndex = src.indexOf("preferences?.alertsEnabled");
    expect(alertGuardIndex).toBeGreaterThan(-1);
    // alert-sound-enabled id must appear AFTER the guard in the source
    const alertSoundIndex = src.indexOf("alert-sound-enabled", alertGuardIndex);
    expect(alertSoundIndex).toBeGreaterThan(alertGuardIndex);
  });

  // REG-P5-PREFS-005: All four control ids are present in the live section
  test("REG-P5-PREFS-005: all four Switch control ids remain in source", () => {
    expect(src).toContain('"auto-commit-push"');
    expect(src).toContain('"auto-create-pr"');
    expect(src).toContain('"alerts-enabled"');
    expect(src).toContain('"alert-sound-enabled"');
  });

  // REG-P5-PREFS-006: SettingRow with htmlFor="auto-create-pr" is present
  // (verifies the label is properly wired, not just the Switch id)
  test("REG-P5-PREFS-006: SettingRow htmlFor=auto-create-pr is present", () => {
    expect(src).toContain('htmlFor="auto-create-pr"');
  });

  // REG-P5-PREFS-007: SettingRow with htmlFor="alert-sound-enabled" is present
  test("REG-P5-PREFS-007: SettingRow htmlFor=alert-sound-enabled is present", () => {
    expect(src).toContain('htmlFor="alert-sound-enabled"');
  });

  // REG-P5-PREFS-008: The two untouched groups (Defaults, Sharing & privacy) still use
  // GroupHeader, confirming they were not accidentally converted (scope discipline).
  test("REG-P5-PREFS-008: Defaults for new chats still uses GroupHeader (not retrofitted)", () => {
    expect(src).toContain("<GroupHeader>Defaults for new chats</GroupHeader>");
  });

  test("REG-P5-PREFS-009: Sharing & privacy still uses GroupHeader (not retrofitted)", () => {
    expect(src).toContain("<GroupHeader>Sharing &amp; privacy</GroupHeader>");
  });
});
