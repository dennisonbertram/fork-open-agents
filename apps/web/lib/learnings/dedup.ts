export type OverlapInput = {
  title: string;
  rootCause?: string;
  solution?: string;
  affectedPaths?: string[];
  prevention?: string;
};

export function scoreOverlap(_a: OverlapInput, _b: OverlapInput): number {
  throw new Error("scoreOverlap not implemented");
}

export function decideDedup(
  _score: number,
): "update" | "consolidation_review" | "create" {
  throw new Error("decideDedup not implemented");
}

export function computeDedupSignature(_candidate: OverlapInput): string {
  throw new Error("computeDedupSignature not implemented");
}
