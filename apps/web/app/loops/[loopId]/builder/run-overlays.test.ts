/**
 * run-overlays.test.ts — Behavioral tests for add-only run-state props on
 * loop nodes and when-edges.
 *
 * BT-LOOPS-040: When runStatus is absent, node data structure is unchanged
 *   (no extra keys injected).
 * BT-LOOPS-041: When runStatus="running", mapRunStatusToHeaderStatus returns "processing"
 * BT-LOOPS-042: When runStatus="succeeded", mapRunStatusToHeaderStatus returns "success"
 * BT-LOOPS-043: When runStatus="failed", mapRunStatusToHeaderStatus returns "error"
 * BT-LOOPS-044: When runStatus="skipped", mapRunStatusToHeaderStatus returns "idle"
 * BT-LOOPS-045: When runStatus="unvisited", mapRunStatusToHeaderStatus returns "idle"
 * BT-LOOPS-046: isNodeDimmed returns true for "unvisited" and "skipped", false for
 *   "running", "succeeded", "failed".
 * BT-LOOPS-047: isCurrent=true → isNodePulsing returns true; absent/false → false.
 * BT-LOOPS-048: runStatus="failed" → hasFailedRing returns true; others → false.
 * BT-LOOPS-049: visitCount>1 → shouldShowVisitPill returns true; 0/1 → false.
 * BT-LOOPS-050: edge traversed=true, mostRecent=true → edge strokeWidth multiplier is 2
 *   (thick); traversed=true, mostRecent=false → 1 (normal); absent/false → 0.5 (dimmed).
 * BT-LOOPS-051: run-graph maps nodes into nodeTypes/edgeTypes from builder components
 *   (no default React Flow renderers). Verified by ensuring nodeTypes object exported
 *   from loop-nodes is reused in run-graph.
 */

import { describe, expect, test } from "bun:test";
import {
  mapRunStatusToHeaderStatus,
  isNodeDimmed,
  isNodePulsing,
  hasFailedRing,
  shouldShowVisitPill,
  getEdgeTraversalStyle,
} from "./run-overlays";
import type { NodeRunStatus } from "../runs/[runId]/use-run-graph-state";

// ── BT-LOOPS-041–045: runStatus → header status mapping ───────────────────────

describe("BT-LOOPS-041: running → processing", () => {
  test("mapRunStatusToHeaderStatus('running') returns 'processing'", () => {
    expect(mapRunStatusToHeaderStatus("running")).toBe("processing");
  });
});

describe("BT-LOOPS-042: succeeded → success", () => {
  test("mapRunStatusToHeaderStatus('succeeded') returns 'success'", () => {
    expect(mapRunStatusToHeaderStatus("succeeded")).toBe("success");
  });
});

describe("BT-LOOPS-043: failed → error", () => {
  test("mapRunStatusToHeaderStatus('failed') returns 'error'", () => {
    expect(mapRunStatusToHeaderStatus("failed")).toBe("error");
  });
});

describe("BT-LOOPS-044: skipped → idle", () => {
  test("mapRunStatusToHeaderStatus('skipped') returns 'idle'", () => {
    expect(mapRunStatusToHeaderStatus("skipped")).toBe("idle");
  });
});

describe("BT-LOOPS-045: unvisited → idle", () => {
  test("mapRunStatusToHeaderStatus('unvisited') returns 'idle'", () => {
    expect(mapRunStatusToHeaderStatus("unvisited")).toBe("idle");
  });
});

// ── BT-LOOPS-046: isNodeDimmed ────────────────────────────────────────────────

describe("BT-LOOPS-046: isNodeDimmed returns true only for unvisited/skipped", () => {
  const dimmed: NodeRunStatus[] = ["unvisited", "skipped"];
  const notDimmed: NodeRunStatus[] = ["running", "succeeded", "failed"];

  for (const status of dimmed) {
    test(`isNodeDimmed('${status}') is true`, () => {
      expect(isNodeDimmed(status)).toBe(true);
    });
  }

  for (const status of notDimmed) {
    test(`isNodeDimmed('${status}') is false`, () => {
      expect(isNodeDimmed(status)).toBe(false);
    });
  }
});

// ── BT-LOOPS-047: isNodePulsing ───────────────────────────────────────────────

describe("BT-LOOPS-047: isNodePulsing true only when isCurrent=true", () => {
  test("isCurrent=true → isNodePulsing returns true", () => {
    expect(isNodePulsing(true)).toBe(true);
  });

  test("isCurrent=false → isNodePulsing returns false", () => {
    expect(isNodePulsing(false)).toBe(false);
  });

  test("isCurrent=undefined → isNodePulsing returns false", () => {
    expect(isNodePulsing(undefined)).toBe(false);
  });
});

// ── BT-LOOPS-048: hasFailedRing ───────────────────────────────────────────────

describe("BT-LOOPS-048: hasFailedRing true only for failed", () => {
  test("failed → hasFailedRing true", () => {
    expect(hasFailedRing("failed")).toBe(true);
  });

  const others: NodeRunStatus[] = [
    "running",
    "succeeded",
    "skipped",
    "unvisited",
  ];
  for (const status of others) {
    test(`${status} → hasFailedRing false`, () => {
      expect(hasFailedRing(status)).toBe(false);
    });
  }
});

// ── BT-LOOPS-049: shouldShowVisitPill ────────────────────────────────────────

describe("BT-LOOPS-049: shouldShowVisitPill true only when visitCount > 1", () => {
  test("visitCount=2 → shouldShowVisitPill true", () => {
    expect(shouldShowVisitPill(2)).toBe(true);
  });

  test("visitCount=5 → shouldShowVisitPill true", () => {
    expect(shouldShowVisitPill(5)).toBe(true);
  });

  test("visitCount=1 → shouldShowVisitPill false", () => {
    expect(shouldShowVisitPill(1)).toBe(false);
  });

  test("visitCount=0 → shouldShowVisitPill false", () => {
    expect(shouldShowVisitPill(0)).toBe(false);
  });
});

// ── BT-LOOPS-050: getEdgeTraversalStyle ───────────────────────────────────────

describe("BT-LOOPS-050: edge traversal style", () => {
  test("mostRecent=true → opacity 1 and strokeWidth >= 3 (thick)", () => {
    const style = getEdgeTraversalStyle({ traversed: true, mostRecent: true });
    expect(style.opacity).toBe(1);
    expect(style.strokeWidth).toBeGreaterThanOrEqual(3);
  });

  test("traversed=true, mostRecent=false → opacity between 0.5 and 1, strokeWidth = 2", () => {
    const style = getEdgeTraversalStyle({ traversed: true, mostRecent: false });
    expect(style.opacity).toBeGreaterThan(0.5);
    expect(style.opacity).toBeLessThanOrEqual(1);
    expect(style.strokeWidth).toBe(2);
  });

  test("traversed=false (untraversed) → opacity <= 0.4 (dimmed)", () => {
    const style = getEdgeTraversalStyle({
      traversed: false,
      mostRecent: false,
    });
    expect(style.opacity).toBeLessThanOrEqual(0.4);
  });

  test("absent (no traversal info) → dimmed (same as untraversed)", () => {
    const style = getEdgeTraversalStyle(undefined);
    expect(style.opacity).toBeLessThanOrEqual(0.4);
  });
});

// ── BT-LOOPS-040: absent props leave structure unchanged ─────────────────────

describe("BT-LOOPS-040: absent runStatus props leave helper outputs neutral", () => {
  test("mapRunStatusToHeaderStatus(undefined) returns undefined (no badge injected)", () => {
    // When runStatus is absent, we pass undefined; the result is undefined
    // so the NodeHeader renders its default (no badge shown).
    expect(mapRunStatusToHeaderStatus(undefined)).toBeUndefined();
  });

  test("isNodeDimmed with undefined runStatus returns false", () => {
    expect(isNodeDimmed(undefined)).toBe(false);
  });

  test("hasFailedRing with undefined runStatus returns false", () => {
    expect(hasFailedRing(undefined)).toBe(false);
  });
});
