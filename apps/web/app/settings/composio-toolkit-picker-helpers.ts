/**
 * Pure helper functions for ComposioToolkitPicker.
 * Extracted so they can be unit-tested without DOM / React.
 *
 * STUB — implementation to be filled in during green phase.
 */
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

export interface PickerEntry extends Pick<ComposioToolkitSummary, "slug" | "name" | "description" | "logo" | "managedAuth" | "noAuth" | "categories"> {
  /** Whether this slug is currently in the selected set. */
  selected: boolean;
  /**
   * True when the slug was in selectedSlugs but not found in the catalog —
   * e.g. a legacy typo like "webseerch". Renders with a subtle "unknown" hint.
   */
  unknown?: boolean;
}

/**
 * Toggle a toolkit slug in/out of the selected array.
 * Returns a new array without mutating the input.
 */
export function toggleSlug(_selected: string[], _slug: string): string[] {
  // STUB — always returns empty
  return [];
}

/**
 * Merge the user's selected slugs with the full catalog into a unified list
 * for rendering. Unknown slugs (not in catalog) appear first so the user can
 * identify and remove them.
 */
export function mergeSelectedWithCatalog(
  _selectedSlugs: string[],
  _catalog: ComposioToolkitSummary[],
): PickerEntry[] {
  // STUB — always returns empty
  return [];
}
