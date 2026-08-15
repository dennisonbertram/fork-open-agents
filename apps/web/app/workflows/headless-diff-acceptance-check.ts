/**
 * #1288: the acceptance check. When a caller declares `expectedFiles` on
 * `open_agents_start_session`, the run's actual changed paths (see
 * headless-diff-acceptance.ts's sandbox probe) are compared against that
 * list at the end of the run. A path outside the list is a violation, named
 * with its offending paths rather than left for whoever reviews the diff
 * later to notice by hand.
 *
 * Pure and workflow-safe: a plain set comparison, no sandbox, no DB.
 */
export type DiffAcceptanceResult =
  | { violated: false }
  | { violated: true; offendingPaths: string[] };

export function checkDiffAcceptance(
  changedPaths: readonly string[],
  expectedFiles: readonly string[],
): DiffAcceptanceResult {
  const allowed = new Set(expectedFiles);
  const offendingPaths = changedPaths.filter((path) => !allowed.has(path));
  return offendingPaths.length > 0
    ? { violated: true, offendingPaths }
    : { violated: false };
}
