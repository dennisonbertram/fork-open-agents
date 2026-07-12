/**
 * Agent Loops — resolveWorkingBranch helper
 *
 * Determines the working branch for an agent_step, in priority order:
 *
 *   1. context[nodeId].branch — own-node branch from a prior run of the same
 *      node (re-run continuity). A node that was already executed keeps its
 *      own branch entry in the run context, so subsequent iterations use the
 *      same ref it committed to before.
 *
 *   2. Scan context entries in INSERTION ORDER, take the LAST entry whose
 *      value is a plain object (not null, not array) with a non-empty string
 *      "branch" field. This allows a downstream agent_step to automatically
 *      continue on the branch that the most-recently-completed producing step
 *      declared in its output JSON (which was merged into run context under
 *      that node's id).
 *
 *   3. defaultBranch — the repo default branch from the access result.
 *
 * Pure function — no I/O, no side effects, no throws.
 */

/**
 * Resolves the working branch for an agent_step.
 *
 * @param context      - The current run context (insertion order matters).
 * @param nodeId       - The id of the agent_step node being executed.
 * @param defaultBranch - The repo default branch to fall back to.
 * @returns The resolved branch name (never empty).
 */
export function resolveWorkingBranch(
  context: Record<string, unknown>,
  nodeId: string,
  defaultBranch: string,
): string {
  return resolveWorkingBranchIntent(context, nodeId, defaultBranch).ref;
}

export function resolveWorkingBranchIntent(
  context: Record<string, unknown>,
  nodeId: string,
  defaultBranch: string,
): {
  ref: string;
  source: "context_branch" | "live_default_branch";
} {
  // 1. Own-node branch: context[nodeId].branch (re-run continuity)
  const ownEntry = context[nodeId];
  if (
    ownEntry !== null &&
    ownEntry !== undefined &&
    typeof ownEntry === "object" &&
    !Array.isArray(ownEntry)
  ) {
    const ownBranch = (ownEntry as Record<string, unknown>)["branch"];
    if (typeof ownBranch === "string" && ownBranch.length > 0) {
      return { ref: ownBranch, source: "context_branch" };
    }
  }

  // 2. Scan ALL entries in insertion order, keep the LAST valid one.
  //    An entry is valid if:
  //      - its value is a plain object (not null, not array)
  //      - it has a "branch" field that is a non-empty string
  //      - its key is not the own-node id (already checked above)
  let lastValidBranch: string | null = null;
  for (const [key, value] of Object.entries(context)) {
    if (key === nodeId) {
      // Already handled above (own-node didn't match, skip it here too)
      continue;
    }
    if (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const branch = (value as Record<string, unknown>)["branch"];
      if (typeof branch === "string" && branch.length > 0) {
        lastValidBranch = branch;
        // Keep looping — we want the LAST valid entry
      }
    }
  }

  if (lastValidBranch !== null) {
    return { ref: lastValidBranch, source: "context_branch" };
  }

  // 3. Fall back to repo default branch
  return { ref: defaultBranch, source: "live_default_branch" };
}
