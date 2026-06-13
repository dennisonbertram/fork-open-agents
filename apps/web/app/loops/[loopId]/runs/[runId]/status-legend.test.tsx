/**
 * status-legend.test.tsx — Behavior contract tests for the StatusLegend component.
 *
 * BT-LOOPS-052: StatusLegend renders all required visual keys.
 * BT-LOOPS-053: StatusLegend swatch classes use the same color tokens as
 *   run-overlays.ts / loop-nodes.tsx — the legend cannot silently drift from
 *   the actual node styling. Swatch constants live in run-overlays.ts alongside
 *   the RING_* fragment constants consumed by runStateWrapperClass, enforcing
 *   shade-level correspondence by construction (orange-400/emerald-500/red-500).
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
  RING_RUNNING_CLASS,
  RING_FAILED_CLASS,
  RING_SUCCEEDED_CLASS,
} from "@/app/loops/[loopId]/builder/run-overlays";

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
//
// These tests assert shade-level correspondence between the swatch constants
// (used by StatusLegend) and the RING_* fragment constants (used by
// runStateWrapperClass in loop-nodes.tsx). Both live in run-overlays.ts, so a
// drift between legend and node colors requires changing a constant in the same
// file — making the drift immediately visible.
//
// Shade-level assertions (orange-400, emerald-500, red-500) are deliberate:
// allowing only "orange" would pass if the swatch changed to orange-600 while
// the ring stayed orange-400 — a visible shade mismatch that tests would miss.

describe("BT-LOOPS-053: StatusLegend uses same color tokens as run-overlays", () => {
  // ── Swatch constant shade-level assertions ──────────────────────────────────

  test("RUNNING_SWATCH_CLASS contains orange-400 (shade-level match with RING_RUNNING_CLASS)", () => {
    // ring-orange-400 in node ring → bg-orange-400 in swatch: same hue AND shade
    expect(RUNNING_SWATCH_CLASS).toContain("orange-400");
    expect(RING_RUNNING_CLASS).toContain("orange-400");
  });

  test("SUCCEEDED_SWATCH_CLASS contains emerald-500 (shade-level match with RING_SUCCEEDED_CLASS)", () => {
    // ring-emerald-500 in node ring → bg-emerald-500 in swatch: same hue AND shade
    expect(SUCCEEDED_SWATCH_CLASS).toContain("emerald-500");
    expect(RING_SUCCEEDED_CLASS).toContain("emerald-500");
  });

  test("FAILED_SWATCH_CLASS contains red-500 (shade-level match with RING_FAILED_CLASS)", () => {
    // ring-red-500 in node ring → bg-red-500 in swatch: same hue AND shade
    expect(FAILED_SWATCH_CLASS).toContain("red-500");
    expect(RING_FAILED_CLASS).toContain("red-500");
  });

  test("UNVISITED_SWATCH_CLASS contains muted color token", () => {
    // Matches the opacity-50 / muted dimming for unvisited nodes
    expect(
      UNVISITED_SWATCH_CLASS.includes("muted") ||
        UNVISITED_SWATCH_CLASS.includes("opacity"),
    ).toBe(true);
  });

  // ── RING_* constants contain animate-pulse / rounded-md markers ────────────

  test("RING_RUNNING_CLASS contains animate-pulse (current node pulsing affordance)", () => {
    expect(RING_RUNNING_CLASS).toContain("animate-pulse");
  });

  test("RING_FAILED_CLASS does NOT contain animate-pulse (failed nodes are static)", () => {
    expect(RING_FAILED_CLASS).not.toContain("animate-pulse");
  });

  test("RING_SUCCEEDED_CLASS does NOT contain animate-pulse (succeeded nodes are static)", () => {
    expect(RING_SUCCEEDED_CLASS).not.toContain("animate-pulse");
  });

  // ── StatusLegend HTML contains the expected shade tokens ───────────────────

  test("StatusLegend HTML contains orange-400 token (not just 'orange')", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("orange-400");
  });

  test("StatusLegend HTML contains emerald-500 token (not just 'emerald')", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("emerald-500");
  });

  test("StatusLegend HTML contains red-500 token (not just 'red')", () => {
    const html = renderToStaticMarkup(<StatusLegend />);
    expect(html).toContain("red-500");
  });
});
