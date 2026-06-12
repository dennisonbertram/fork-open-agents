/**
 * when-edge-dash-animation.test.ts — BT-DASH-001: verify the dash animation
 * is properly wired so it actually runs.
 *
 * BT-DASH-001: The animated dash on the most-recent traversal edge must use an
 *   animation name defined in the global stylesheet. @keyframes cannot be defined
 *   in React inline styles — they are silently ignored by the browser. The
 *   animation name referenced in when-edge.tsx must exist in globals.css.
 *
 * BT-DASH-002: globals.css must define the @keyframes under a prefers-reduced-
 *   motion: reduce media query that disables the animation for accessibility.
 *
 * BT-DASH-003: The animation name in when-edge.tsx must NOT be "dash" (the
 *   buggy name). It must be "loop-edge-dash" (or similar namespaced name) to
 *   avoid collisions and confirm the fix was applied.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// Resolve file paths relative to this test file
// import.meta.dir = apps/web/app/loops/[loopId]/builder
// globals.css is at  apps/web/app/globals.css (3 dirs up from import.meta.dir)
const GLOBALS_CSS = join(import.meta.dir, "../../..", "globals.css");
const WHEN_EDGE = join(import.meta.dir, "when-edge.tsx");

describe("BT-DASH-001: animation name must exist in global stylesheet", () => {
  it("when-edge.tsx references a named animation (not empty)", () => {
    const source = readFileSync(WHEN_EDGE, "utf-8");
    // The animation property must reference some animation name in an inline style
    expect(source).toContain("animation:");
  });

  it("globals.css defines @keyframes loop-edge-dash", () => {
    const css = readFileSync(GLOBALS_CSS, "utf-8");
    expect(css).toContain("@keyframes loop-edge-dash");
  });

  it("when-edge.tsx uses animation name 'loop-edge-dash' (not the broken 'dash')", () => {
    const source = readFileSync(WHEN_EDGE, "utf-8");
    // Must use the correct namespaced keyframe name
    expect(source).toContain("loop-edge-dash");
    // Must NOT use the bare "dash" name which has no @keyframes in the stylesheet
    // (bare "dash" without "loop-edge-dash" would mean the fix wasn't applied)
    const hasBare = source.includes('"dash"') || source.includes("'dash'");
    expect(hasBare).toBe(false);
  });
});

describe("BT-DASH-002: prefers-reduced-motion disables the animation", () => {
  it("globals.css contains a prefers-reduced-motion: reduce rule that disables loop-edge-dash", () => {
    const css = readFileSync(GLOBALS_CSS, "utf-8");
    // Must have a reduced-motion media query
    expect(css).toContain("prefers-reduced-motion: reduce");
    // The reduced-motion section must mention loop-edge-dash or the class that uses it
    const reducedMotionIdx = css.lastIndexOf("prefers-reduced-motion: reduce");
    const afterReducedMotion = css.slice(reducedMotionIdx);
    expect(afterReducedMotion).toContain("loop-edge-dash");
  });
});

describe("BT-DASH-003: animation name is properly namespaced", () => {
  it("globals.css @keyframes uses 'loop-edge-dash' not bare 'dash'", () => {
    const css = readFileSync(GLOBALS_CSS, "utf-8");
    // The keyframes block must use the namespaced name
    expect(css).toContain("@keyframes loop-edge-dash");
    // Must NOT define a bare @keyframes dash (which would be a global name collision)
    expect(css).not.toContain("@keyframes dash");
  });
});
