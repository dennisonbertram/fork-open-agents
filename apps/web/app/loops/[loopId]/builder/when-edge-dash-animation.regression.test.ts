/**
 * when-edge-dash-animation.regression.test.ts — Regression coverage for the
 * animated-dash CSS bug fixed in commit 090a2ca8.
 *
 * These tests would fail if the fix in commit 090a2ca8 is reverted:
 *
 *   Regression 1: If when-edge.tsx reverts to animation:"dash …", the bare
 *     "dash" name has no @keyframes in globals.css, so the animation silently
 *     never runs. BT-DASH-001 catches this by asserting "loop-edge-dash" is
 *     present and bare '"dash"' is absent.
 *
 *   Regression 2: If @keyframes loop-edge-dash is removed from globals.css,
 *     the animation name in when-edge.tsx references a nonexistent keyframe
 *     and the animation silently fails. BT-DASH-001 and BT-DASH-002 catch this.
 *
 *   Regression 3: If the prefers-reduced-motion guard is removed, users with
 *     vestibular disorders would see constant motion on active run edges.
 *     BT-DASH-002 catches this.
 *
 *   Regression 4: If the @keyframes is renamed to "dash" (a global namespace
 *     collision), future stylesheets or third-party CSS could override it
 *     silently. BT-DASH-003 catches this by asserting the namespaced name.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// import.meta.dir = apps/web/app/loops/[loopId]/builder
const GLOBALS_CSS = join(import.meta.dir, "../../..", "globals.css");
const WHEN_EDGE = join(import.meta.dir, "when-edge.tsx");

// ── Regression 1: reverted animation name would break the dash ──────────────

describe("regression: animation name must not revert to bare 'dash'", () => {
  it("regression: when-edge.tsx must NOT contain bare '\"dash\"' animation string", () => {
    const source = readFileSync(WHEN_EDGE, "utf-8");
    // If this fails, someone reverted the fix and "dash" is back
    expect(source).not.toContain('"dash"');
    expect(source).not.toContain("'dash'");
  });

  it("regression: when-edge.tsx must contain 'loop-edge-dash' animation", () => {
    const source = readFileSync(WHEN_EDGE, "utf-8");
    // The correctly namespaced keyframe name must be present
    expect(source).toContain("loop-edge-dash");
  });
});

// ── Regression 2: @keyframes must exist in globals.css ──────────────────────

describe("regression: @keyframes loop-edge-dash must exist in globals.css", () => {
  it("regression: @keyframes loop-edge-dash present — removing it breaks the animation", () => {
    const css = readFileSync(GLOBALS_CSS, "utf-8");
    expect(css).toContain("@keyframes loop-edge-dash");
  });

  it("regression: @keyframes defines stroke-dashoffset (SVG dash crawl)", () => {
    const css = readFileSync(GLOBALS_CSS, "utf-8");
    // The keyframe must animate stroke-dashoffset to create the crawling dash
    expect(css).toContain("stroke-dashoffset");
  });
});

// ── Regression 3: prefers-reduced-motion guard must be present ───────────────

describe("regression: prefers-reduced-motion guard protects vestibular accessibility", () => {
  it("regression: globals.css disables loop-edge-dash under reduced-motion", () => {
    const css = readFileSync(GLOBALS_CSS, "utf-8");
    // The last prefers-reduced-motion block must reference loop-edge-dash
    const lastReducedIdx = css.lastIndexOf("prefers-reduced-motion: reduce");
    expect(lastReducedIdx).toBeGreaterThan(-1);
    const afterLast = css.slice(lastReducedIdx);
    expect(afterLast).toContain("loop-edge-dash");
  });
});

// ── Regression 4: namespacing prevents global collision ──────────────────────

describe("regression: @keyframes name must be namespaced, not bare 'dash'", () => {
  it("regression: globals.css must NOT define @keyframes dash (bare/collision name)", () => {
    const css = readFileSync(GLOBALS_CSS, "utf-8");
    expect(css).not.toContain("@keyframes dash");
  });
});
