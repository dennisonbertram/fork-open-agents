/**
 * Pure helper for the workspace settings panel's null-preservation contract
 * (#799, finding G6).
 *
 * The repository's selectedToolkitSlugs column is `string[] | null`, where
 * `null` means "never configured" (GitHub default-on applies at resolution
 * time). The panel's toolkit picker can only emit concrete string arrays —
 * it has no way to represent "untouched" — so the panel must track whether
 * the user has actually interacted with the picker THIS session, separately
 * from the picker's current display value, and use that to decide what to
 * send in the save payload.
 */

export type ComputeSelectedToolkitSlugsForSaveParams = {
  /** Whether the user has changed the toolkit picker's selection this session. */
  touched: boolean;
  /** The picker's current display value (used only when touched is true). */
  currentSlugs: string[];
};

/**
 * Decides what to persist for selectedToolkitSlugs on save.
 *
 * - Untouched → null (preserve "never configured", do not materialize a
 *   display default like ["github"] as if the user chose it).
 * - Touched → the current picker value verbatim, including an explicit
 *   empty array if the user cleared every toolkit.
 */
export function computeSelectedToolkitSlugsForSave(
  params: ComputeSelectedToolkitSlugsForSaveParams,
): string[] | null {
  if (!params.touched) {
    return null;
  }
  return params.currentSlugs;
}
