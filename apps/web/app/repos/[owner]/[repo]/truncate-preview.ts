/**
 * Server-side text truncation helpers for dashboard card previews.
 *
 * These ensure full prompt/instruction bodies never ship in server-rendered
 * HTML — a requirement from the issue #161 redaction contract.
 */

/** Maximum characters for agent instruction previews in dashboard cards. */
export const INSTRUCTION_PREVIEW_CAP = 140;

/** Maximum characters for run payload summary previews in dashboard cards. */
export const SUMMARY_PREVIEW_CAP = 120;

/**
 * Truncate a string to `cap` characters and append an ellipsis ("…") when the
 * string exceeds the cap. Returns the original string unchanged when it fits
 * within the cap.
 */
export function truncatePreview(text: string, cap: number): string {
  if (text.length <= cap) {
    return text;
  }
  return text.slice(0, cap) + "…";
}
