/**
 * status-trigger-notice.ts — status-honesty copy that depends on BOTH the
 * loop's status and whether it has any triggers (#762).
 *
 * Kept separate from status-meanings.ts (which only needs status) because
 * mixing a triggerCount parameter into that module's per-status meaning
 * table would change its existing, already-tested contract.
 */

export type LoopStatusForNotice = "draft" | "active" | "paused" | "archived";

/**
 * Warns that a loop's triggers won't fire while the loop isn't Active.
 * Returns null when the warning doesn't apply (loop is active, or has no
 * triggers at all — nothing to warn about).
 */
export function getTriggersInactiveWarning(params: {
  status: string;
  triggerCount: number;
}): string | null {
  if (params.triggerCount <= 0) {
    return null;
  }
  if (params.status === "active") {
    return null;
  }
  return "Triggers only fire while the loop is Active.";
}

/**
 * States that an Active loop with zero triggers only runs when the user
 * presses "Run now" — shown under the status control so a first-time user
 * doesn't assume Active alone makes the loop automated.
 * Returns null when the loop is not active, or already has a trigger.
 */
export function getActiveStatusNote(params: {
  status: string;
  triggerCount: number;
}): string | null {
  if (params.status !== "active") {
    return null;
  }
  if (params.triggerCount > 0) {
    return null;
  }
  return "Active — runs manually only. Add a trigger to run automatically.";
}
