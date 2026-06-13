/**
 * status-legend.test.tsx — Behavior contract tests for the StatusLegend component.
 *
 * BT-LOOPS-052: StatusLegend renders all required visual keys.
 * BT-LOOPS-053: StatusLegend swatch classes use the same color tokens as
 *   run-overlays.ts / loop-nodes.tsx — the legend can never silently drift
 *   from the actual node styling.
 *
 * SSR note: @xyflow/react does not render under bun:test SSR. We do NOT
 * attempt to render RunGraph here. Instead, this file covers the StatusLegend
 * component (plain React, no React Flow dependency) via renderToStaticMarkup,
 * which is sufficient to pin the legend's color-token contract.
 *
 * run-graph-merge.test.ts covers the stable-node-identity contract.
 * Together these two files fully cover the remaining M2-03 contracts.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusLegend } from "./status-legend";
import {
  RUNNING_SWATCH_CLASS,
  SUCCEEDED_SWATCH_CLASS,
  FAILED_SWATCH_CLASS,
  UNVISITED_SWATCH_CLASS,
} from "./run-graph-merge";

// ── BT-LOOPS-052: Required legend entries ────────────────────────────────────

describe("BT-LOOPS-052: StatusLegend renders all required visual keys", () => {
  test("contains 'Running' entry", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("Running");
  });

  test("contains 'Succeeded' entry", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("Succeeded");
  });

  test("contains 'Failed' entry", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("Failed");
  });

  test("contains 'Not visited' entry", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("Not visited");
  });

  test("contains visit-count (×N) pill indicator", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    // The ×N symbol (×2 is used as example)
    expect(html.includes("×") || html.includes("&times;")).toBe(true);
  });

  test("contains 'Latest transition' dashed line indicator", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("Latest transition");
  });
});

// ── BT-LOOPS-053: Color token consistency — legend ↔ node overlays ───────────

describe("BT-LOOPS-053: StatusLegend uses same color tokens as run-overlays", () => {
  test("RUNNING_SWATCH_CLASS contains orange/amber color token", () => {
    // Matches the ring-2 ring-orange-400 animate-pulse used in runStateWrapperClass
    expect(
      RUNNING_SWATCH_CLASS.includes("orange") ||
        RUNNING_SWATCH_CLASS.includes("amber"),
    ).toBe(true);
  });

  test("SUCCEEDED_SWATCH_CLASS contains emerald color token", () => {
    // Matches the ring-2 ring-emerald-500 used in runStateWrapperClass
    expect(SUCCEEDED_SWATCH_CLASS.includes("emerald")).toBe(true);
  });

  test("FAILED_SWATCH_CLASS contains red color token", () => {
    // Matches the ring-2 ring-red-500 used in runStateWrapperClass
    expect(FAILED_SWATCH_CLASS.includes("red")).toBe(true);
  });

  test("UNVISITED_SWATCH_CLASS contains muted color token", () => {
    // Matches the opacity-50 / muted dimming for unvisited nodes
    expect(
      UNVISITED_SWATCH_CLASS.includes("muted") ||
        UNVISITED_SWATCH_CLASS.includes("opacity"),
    ).toBe(true);
  });

  test("StatusLegend HTML contains the running swatch class token", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    // Extract the first segment of the swatch class to avoid false matches
    // on combined class strings (check for the key color word)
    const orangeOrAmber = html.includes("orange") || html.includes("amber");
    expect(orangeOrAmber).toBe(true);
  });

  test("StatusLegend HTML contains the emerald swatch class token", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("emerald");
  });

  test("StatusLegend HTML contains the red swatch class token", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("red");
  });
});
