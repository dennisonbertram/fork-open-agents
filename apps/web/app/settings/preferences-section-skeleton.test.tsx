/**
 * Tests for Finding 3: PreferencesSectionSkeleton Appearance block structure.
 *
 * The loaded Appearance UI is now a single bordered SettingsGroup card with one row.
 * The skeleton must mirror this structure to prevent a layout shift on load.
 *
 * Old structure (before fix):
 *   GroupHeader "Appearance" + a grid with two h-16 skeleton tiles
 *
 * New required structure (after fix):
 *   A bordered card (rounded-xl border overflow-hidden) containing a header line
 *   skeleton + one row-height skeleton inside the rows slot.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesSectionSkeleton } from "./preferences-section";

describe("Finding 3 — Skeleton: Appearance block mirrors new single-card structure", () => {
  test("BT-SKEL-001: skeleton Appearance block renders as a bordered card (not a GroupHeader + grid)", () => {
    // The old skeleton had: <GroupHeader>Appearance</GroupHeader> + <div class="grid gap-6 sm:grid-cols-2">
    // The new skeleton must render a bordered card like the loaded SettingsGroup card.
    const html = renderToStaticMarkup(<PreferencesSectionSkeleton />);

    // The old structure used a flat grid of two tiles — that grid must be gone from Appearance region.
    // We find the Appearance section by locating its heading skeleton before the first divider.
    // The card must contain overflow-hidden and rounded-xl (SettingsGroup card classes).
    expect(html).toContain("overflow-hidden");
    expect(html).toContain("rounded-xl");
  });

  test("BT-SKEL-002: skeleton Appearance block no longer renders two h-16 side-by-side tiles", () => {
    // The old skeleton used sm:grid-cols-2 + two h-16 tiles for Appearance.
    // The new Appearance skeleton must be a single-row card — two h-16 tiles no longer appear
    // in the Appearance region (which is before the first divider in the skeleton output).
    const html = renderToStaticMarkup(<PreferencesSectionSkeleton />);

    // Locate where the Appearance section ends (the first border-t divider after it).
    // The first <div class="border-t ..."> marks the end of the Appearance block.
    const firstDividerIdx = html.indexOf("border-t");
    expect(firstDividerIdx).toBeGreaterThan(-1);
    const appearanceRegion = html.slice(0, firstDividerIdx);

    // In the OLD skeleton, the appearance region contained sm:grid-cols-2.
    // After the fix, the appearance section uses a SettingsGroup card, not a grid.
    expect(appearanceRegion).not.toContain("sm:grid-cols-2");
  });

  test("BT-SKEL-003: skeleton Appearance block contains a single row-height skeleton (not two tiles)", () => {
    // After fix: one row-height skeleton inside the card rows slot.
    // We check that the Appearance region (before first divider) contains a settings-group-rows slot.
    const html = renderToStaticMarkup(<PreferencesSectionSkeleton />);

    const firstDividerIdx = html.indexOf("border-t");
    const appearanceRegion = html.slice(0, firstDividerIdx);

    // The rows slot is present (meaning a SettingsGroup card was used)
    expect(appearanceRegion).toContain('data-slot="settings-group-rows"');
  });

  test("REG-SKEL-001: other skeleton sections (Defaults, Git automation) are unaffected", () => {
    // Regression: make sure the fix only touched Appearance, not the other sections.
    const html = renderToStaticMarkup(<PreferencesSectionSkeleton />);
    // The Defaults for new chats and Git automation sections still use grid/space-y layout.
    expect(html).toContain("sm:grid-cols-2"); // Defaults section still has this
    expect(html).toContain("space-y-3"); // Git automation section still has this
  });
});
