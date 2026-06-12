/**
 * run-overlays.regression.test.ts — Regression harness for TASK-366 visual
 * language parity changes.
 *
 * These tests would fail if the changes in commit 29ef6a15 are reverted:
 *
 *   Regression 1: If run-overlays.ts is removed, the run-graph cannot import
 *     mapRunStatusToHeaderStatus and will crash.
 *
 *   Regression 2: If "running" → "processing" mapping is changed or dropped,
 *     the NodeHeaderStatus badge would show the wrong color (orange for running
 *     is a key visual affordance).
 *
 *   Regression 3: If isNodeDimmed is broadened to include "running" or "failed",
 *     critical nodes would be invisible when the run is active or errored —
 *     breaking the operator's ability to see what went wrong.
 *
 *   Regression 4: If getEdgeTraversalStyle collapses mostRecent and traversed
 *     to the same opacity/strokeWidth, the "hot path" visual affordance is lost
 *     (operator cannot tell which edges are current).
 *
 *   Regression 5: If shouldShowVisitPill becomes >=1 (instead of >1), every
 *     single-visit node gets a "×1" pill — cluttering the run view.
 *
 *   Regression 6: If the mapping table is expanded to map skipped→"processing"
 *     or skipped→"error", skipped nodes would show incorrect status badges.
 *
 *   Regression 7: hasFailedRing must NOT fire for "running" — otherwise the
 *     current node would simultaneously show a red ring AND pulse, which would
 *     be visually confusing and incorrect.
 *
 *   Regression 8: getEdgeTraversalStyle must return dimmed opacity for the
 *     undefined/absent case — the run-graph always passes explicit traversal
 *     state, so builder edges (absent) are never accidentally dimmed, but if
 *     this function is called without args it must produce safe output.
 */

import { describe, expect, it } from "bun:test";
import {
  mapRunStatusToHeaderStatus,
  isNodeDimmed,
  isNodePulsing,
  hasFailedRing,
  shouldShowVisitPill,
  getEdgeTraversalStyle,
} from "./run-overlays";

// ── Regression 1 & 2: running → processing mapping ────────────────────────────

describe("regression: running maps to processing badge (NOT error/success)", () => {
  it("regression: if running→processing removed, NodeHeaderStatus shows wrong color", () => {
    const result = mapRunStatusToHeaderStatus("running");
    // Must be "processing" specifically — not "error" or "success"
    expect(result).toBe("processing");
    expect(result).not.toBe("error");
    expect(result).not.toBe("success");
    expect(result).not.toBe("idle");
  });

  it("regression: succeeded must map to success (not processing) — confirms table order", () => {
    expect(mapRunStatusToHeaderStatus("succeeded")).toBe("success");
    expect(mapRunStatusToHeaderStatus("succeeded")).not.toBe("processing");
  });
});

// ── Regression 3: isNodeDimmed must NOT dim running or failed ─────────────────

describe("regression: isNodeDimmed never dims active or failed nodes", () => {
  it("regression: running is NOT dimmed — operator must see the active node clearly", () => {
    expect(isNodeDimmed("running")).toBe(false);
  });

  it("regression: failed is NOT dimmed — operator must see error nodes clearly", () => {
    expect(isNodeDimmed("failed")).toBe(false);
  });

  it("regression: succeeded is NOT dimmed — completed nodes stay visible", () => {
    expect(isNodeDimmed("succeeded")).toBe(false);
  });
});

// ── Regression 4: edge traversal style distinctly separates mostRecent from traversed ──

describe("regression: mostRecent and traversed edges have visually distinct styles", () => {
  it("regression: mostRecent must have higher opacity than traversed-only", () => {
    const mostRecent = getEdgeTraversalStyle({
      traversed: true,
      mostRecent: true,
    });
    const traversed = getEdgeTraversalStyle({
      traversed: true,
      mostRecent: false,
    });
    expect(mostRecent.opacity).toBeGreaterThan(traversed.opacity);
  });

  it("regression: mostRecent must have thicker strokeWidth than traversed-only", () => {
    const mostRecent = getEdgeTraversalStyle({
      traversed: true,
      mostRecent: true,
    });
    const traversed = getEdgeTraversalStyle({
      traversed: true,
      mostRecent: false,
    });
    expect(mostRecent.strokeWidth).toBeGreaterThan(traversed.strokeWidth);
  });

  it("regression: traversed-only must have higher opacity than untraversed", () => {
    const traversed = getEdgeTraversalStyle({
      traversed: true,
      mostRecent: false,
    });
    const untraversed = getEdgeTraversalStyle({
      traversed: false,
      mostRecent: false,
    });
    expect(traversed.opacity).toBeGreaterThan(untraversed.opacity);
  });
});

// ── Regression 5: shouldShowVisitPill boundary ────────────────────────────────

describe("regression: shouldShowVisitPill boundary at >1 not >=1", () => {
  it("regression: visitCount=1 produces NO pill — single-visit nodes stay clean", () => {
    expect(shouldShowVisitPill(1)).toBe(false);
  });

  it("regression: visitCount=2 produces pill — cycle detection visible", () => {
    expect(shouldShowVisitPill(2)).toBe(true);
  });
});

// ── Regression 6: skipped badge is idle, not error ────────────────────────────

describe("regression: skipped maps to idle badge, not error", () => {
  it("regression: skipped→idle badge prevents false alarm coloring", () => {
    expect(mapRunStatusToHeaderStatus("skipped")).toBe("idle");
    expect(mapRunStatusToHeaderStatus("skipped")).not.toBe("error");
  });
});

// ── Regression 7: hasFailedRing never fires for running ───────────────────────

describe("regression: hasFailedRing does not fire for running nodes", () => {
  it("regression: running node must NOT get red ring (would conflict with pulse)", () => {
    expect(hasFailedRing("running")).toBe(false);
  });

  it("regression: isCurrent=true overrides the orange pulse (not the red ring)", () => {
    // isNodePulsing fires for isCurrent=true regardless of status
    expect(isNodePulsing(true)).toBe(true);
    // The failed ring only fires for failed status
    expect(hasFailedRing("failed")).toBe(true);
    // A running+isCurrent node should pulse but not show red ring
    expect(hasFailedRing("running")).toBe(false);
    expect(isNodePulsing(true)).toBe(true);
  });
});

// ── Regression 8: absent traversal returns safe dimmed output ─────────────────

describe("regression: absent traversal input returns safe dimmed output", () => {
  it("regression: getEdgeTraversalStyle(undefined) returns low opacity — safe default", () => {
    const style = getEdgeTraversalStyle(undefined);
    // Must return a valid style object, not throw
    expect(style).toBeDefined();
    expect(typeof style.opacity).toBe("number");
    expect(typeof style.strokeWidth).toBe("number");
    // Must be dimmed (opacity <= 0.4) — the safe default
    expect(style.opacity).toBeLessThanOrEqual(0.4);
  });
});
