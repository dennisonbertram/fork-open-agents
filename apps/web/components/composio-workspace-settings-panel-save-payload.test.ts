/**
 * Unit tests for computeSelectedToolkitSlugsForSave (#799, finding G6).
 *
 * The workspace settings panel must preserve `selectedToolkitSlugs: null`
 * (never configured, GitHub default-on) through a save that does not touch
 * toolkit selection — instead of always materializing `["github"]` and
 * persisting it as an explicit choice the user never made.
 *
 * BT-WP-001: user has never touched the toolkit picker this session → save
 *   payload's selectedToolkitSlugs is null, regardless of the display value
 *   used to render the (unset) picker.
 * BT-WP-002: user has touched the picker → save payload uses the current
 *   picker value verbatim, even if it happens to equal ["github"].
 * BT-WP-003: user touches the picker then clears every toolkit → save
 *   payload is [] (explicit empty selection), not null.
 */
import { describe, expect, test } from "bun:test";
import { computeSelectedToolkitSlugsForSave } from "./composio-workspace-settings-panel-save-payload";

describe("computeSelectedToolkitSlugsForSave", () => {
  test("BT-WP-001: untouched picker saves null, not the display default", () => {
    const result = computeSelectedToolkitSlugsForSave({
      touched: false,
      currentSlugs: ["github"],
    });
    expect(result).toBeNull();
  });

  test("BT-WP-002: touched picker saves the current value even when it equals the display default", () => {
    const result = computeSelectedToolkitSlugsForSave({
      touched: true,
      currentSlugs: ["github"],
    });
    expect(result).toEqual(["github"]);
  });

  test("BT-WP-002b: touched picker saves a custom multi-slug selection verbatim", () => {
    const result = computeSelectedToolkitSlugsForSave({
      touched: true,
      currentSlugs: ["slack", "linear"],
    });
    expect(result).toEqual(["slack", "linear"]);
  });

  test("BT-WP-003: touched picker with everything cleared saves an explicit empty array, not null", () => {
    const result = computeSelectedToolkitSlugsForSave({
      touched: true,
      currentSlugs: [],
    });
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });
});
