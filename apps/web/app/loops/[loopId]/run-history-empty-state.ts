/**
 * run-history-empty-state.ts — copy for the loop detail page's run-history
 * panel empty state (#867).
 *
 * For an active loop, "Run now" is enabled, so it's honest to tell the user
 * to click it. For a non-active loop (draft/paused/archived), that same
 * button is disabled — so the copy instead tells the user what to do first
 * (activate the loop) instead of pointing at a control they can't use.
 *
 * Deliberately distinct from the page-level "Loop must be in active status
 * to run manually." notice (loop-detail.tsx) so this doesn't read as a
 * duplicate banner.
 */

export function getRunHistoryEmptyState(status: string): string {
  if (status === "active") {
    return "No runs yet. Click “Run now” to start the first run.";
  }
  return "No runs yet. Set the loop to Active to enable “Run now”.";
}
