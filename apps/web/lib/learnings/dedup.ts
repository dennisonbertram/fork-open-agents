import { createHash } from "crypto";

export type OverlapInput = {
  title: string;
  rootCause?: string;
  solution?: string;
  affectedPaths?: string[];
  prevention?: string;
};

function normalizeText(text: string | undefined | null): string {
  if (!text) return "";
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePaths(paths: string[] | undefined | null): string[] {
  if (!paths || paths.length === 0) return [];
  return [...paths].map((p) => p.trim().toLowerCase()).sort();
}

/**
 * Score the overlap between two candidates across 5 dimensions.
 * Returns an integer 0–5 (one point per dimension that matches).
 */
export function scoreOverlap(a: OverlapInput, b: OverlapInput): number {
  let score = 0;

  // Dimension 1: title
  if (normalizeText(a.title) === normalizeText(b.title)) {
    score += 1;
  }

  // Dimension 2: rootCause
  const aCause = normalizeText(a.rootCause);
  const bCause = normalizeText(b.rootCause);
  if (aCause && bCause && aCause === bCause) {
    score += 1;
  }

  // Dimension 3: solution
  const aSol = normalizeText(a.solution);
  const bSol = normalizeText(b.solution);
  if (aSol && bSol && aSol === bSol) {
    score += 1;
  }

  // Dimension 4: affectedPaths overlap — at least one common path
  const aPaths = normalizePaths(a.affectedPaths);
  const bPaths = normalizePaths(b.affectedPaths);
  if (
    aPaths.length > 0 &&
    bPaths.length > 0 &&
    aPaths.some((p) => bPaths.includes(p))
  ) {
    score += 1;
  }

  // Dimension 5: prevention
  const aPrev = normalizeText(a.prevention);
  const bPrev = normalizeText(b.prevention);
  if (aPrev && bPrev && aPrev === bPrev) {
    score += 1;
  }

  return score;
}

/**
 * Given an overlap score (0–5), decide what to do.
 *
 * 4–5 → update (high overlap, merge into existing row)
 * 2–3 → consolidation_review (moderate overlap, flag for review)
 * 0–1 → create (low overlap, new row)
 */
export function decideDedup(
  score: number,
): "update" | "consolidation_review" | "create" {
  if (score >= 4) return "update";
  if (score >= 2) return "consolidation_review";
  return "create";
}

/**
 * Compute a deterministic, NOT-NULL dedup signature for a candidate.
 * The signature is a SHA-256 hash of the normalized fields joined by `|`.
 * Paths are sorted before hashing so order is irrelevant.
 */
export function computeDedupSignature(candidate: OverlapInput): string {
  const parts = [
    normalizeText(candidate.title),
    normalizeText(candidate.rootCause),
    normalizeText(candidate.solution),
    normalizePaths(candidate.affectedPaths).join(","),
    normalizeText(candidate.prevention),
  ];
  const input = parts.join("|");
  return createHash("sha256").update(input, "utf8").digest("hex");
}
