/**
 * status-meanings.ts — one-line, naive-user-readable meanings for each loop
 * status, shown under the status dropdown on the loop detail page (#768).
 *
 * The status vocabulary (draft/active/paused/archived) isn't self-explanatory
 * to a first-time user; this module is the single source of truth for the
 * plain-language meaning of each status so the dropdown and any other
 * surface stay in sync.
 */

export type LoopStatus = "draft" | "active" | "paused" | "archived";

export const LOOP_STATUS_MEANINGS: Record<LoopStatus, string> = {
  draft: "Editable, can't run yet.",
  active: "Can run — triggers fire and Run now works.",
  paused: "Nothing fires. Runs and triggers are paused.",
  archived: "Read-only. Kept for reference; can't run or edit.",
};

/** Returns the one-line meaning for a status, or "" for an unknown status. */
export function getStatusMeaning(status: string): string {
  return LOOP_STATUS_MEANINGS[status as LoopStatus] ?? "";
}
