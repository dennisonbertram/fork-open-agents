import { describe, expect, test } from "bun:test";
import {
  computeDedupSignature,
  decideDedup,
  scoreOverlap,
  type OverlapInput,
} from "./dedup";

const baseCandidate: OverlapInput = {
  title: "Avoid using global state in React components",
  rootCause: "Shared mutable state causes unpredictable re-renders",
  solution: "Use component-local state or a context with immutable updates",
  affectedPaths: ["src/components/App.tsx", "src/store/global.ts"],
  prevention: "Prefer useState and useReducer; avoid direct mutation",
};

describe("scoreOverlap", () => {
  // BT-004: high overlap (4–5) across all five dimensions
  test("returns score 5 for identical candidates", () => {
    const score = scoreOverlap(baseCandidate, baseCandidate);
    expect(score).toBe(5);
  });

  // BT-005: moderate overlap (2–3) — some dimensions match
  test("returns score in 2–3 range when title and solution match but others differ", () => {
    const partial: OverlapInput = {
      title: "Avoid using global state in React components",
      rootCause: "Different root cause unrelated to original",
      solution: "Use component-local state or a context with immutable updates",
      affectedPaths: ["src/other-file.ts"],
      prevention: "Different prevention strategy",
    };
    const score = scoreOverlap(baseCandidate, partial);
    expect(score).toBeGreaterThanOrEqual(2);
    expect(score).toBeLessThanOrEqual(3);
  });

  // BT-006: low overlap (0–1) — completely different
  test("returns score 0 or 1 for completely different candidates", () => {
    const different: OverlapInput = {
      title: "Use TypeScript strict mode",
      rootCause: "Runtime errors due to implicit any types",
      solution: "Enable strict in tsconfig.json",
      affectedPaths: ["tsconfig.json"],
      prevention: "Set strict: true by default on project creation",
    };
    const score = scoreOverlap(baseCandidate, different);
    expect(score).toBeLessThanOrEqual(1);
  });

  test("returns score between 0 and 5 (inclusive) always", () => {
    const score = scoreOverlap(baseCandidate, baseCandidate);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(5);
  });
});

describe("decideDedup", () => {
  // BT-007: high overlap → update
  test("returns update for score 4", () => {
    expect(decideDedup(4)).toBe("update");
  });

  test("returns update for score 5", () => {
    expect(decideDedup(5)).toBe("update");
  });

  // BT-008: moderate overlap → consolidation_review
  test("returns consolidation_review for score 2", () => {
    expect(decideDedup(2)).toBe("consolidation_review");
  });

  test("returns consolidation_review for score 3", () => {
    expect(decideDedup(3)).toBe("consolidation_review");
  });

  // BT-009: low overlap → create
  test("returns create for score 0", () => {
    expect(decideDedup(0)).toBe("create");
  });

  test("returns create for score 1", () => {
    expect(decideDedup(1)).toBe("create");
  });
});

describe("computeDedupSignature", () => {
  // BT-010: deterministic and non-empty for identical inputs
  test("returns a non-empty string for a valid candidate", () => {
    const sig = computeDedupSignature(baseCandidate);
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
  });

  test("returns the same signature for identical normalized inputs", () => {
    const sig1 = computeDedupSignature(baseCandidate);
    const sig2 = computeDedupSignature({ ...baseCandidate });
    expect(sig1).toBe(sig2);
  });

  test("returns different signatures for different candidates", () => {
    const different: OverlapInput = {
      title: "Use TypeScript strict mode",
      rootCause: "Runtime errors due to implicit any types",
      solution: "Enable strict in tsconfig.json",
      affectedPaths: ["tsconfig.json"],
      prevention: "Set strict: true by default on project creation",
    };
    const sig1 = computeDedupSignature(baseCandidate);
    const sig2 = computeDedupSignature(different);
    expect(sig1).not.toBe(sig2);
  });

  test("returns same signature regardless of affectedPaths order", () => {
    const a: OverlapInput = {
      ...baseCandidate,
      affectedPaths: ["a.ts", "b.ts"],
    };
    const b: OverlapInput = {
      ...baseCandidate,
      affectedPaths: ["b.ts", "a.ts"],
    };
    expect(computeDedupSignature(a)).toBe(computeDedupSignature(b));
  });

  test("is case-insensitive for title normalization", () => {
    const upper: OverlapInput = {
      ...baseCandidate,
      title: "AVOID USING GLOBAL STATE IN REACT COMPONENTS",
    };
    const lower: OverlapInput = {
      ...baseCandidate,
      title: "avoid using global state in react components",
    };
    expect(computeDedupSignature(upper)).toBe(computeDedupSignature(lower));
  });
});
