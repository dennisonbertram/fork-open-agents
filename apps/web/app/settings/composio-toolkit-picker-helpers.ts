/**
 * Pure helper functions for ComposioToolkitPicker.
 * Extracted so they can be unit-tested without DOM / React.
 */
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";
import { prettifyToolkitSlug } from "@/lib/composio/chat-tool-summary";

export interface PickerEntry extends Pick<
  ComposioToolkitSummary,
  | "slug"
  | "name"
  | "description"
  | "logo"
  | "managedAuth"
  | "noAuth"
  | "categories"
> {
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
export function toggleSlug(selected: string[], slug: string): string[] {
  if (selected.includes(slug)) {
    return selected.filter((s) => s !== slug);
  }
  return [...selected, slug];
}

/**
 * Merge the user's selected slugs with the full catalog into a unified list
 * for rendering.
 *
 * - Catalog toolkits appear in catalog order, marked selected/unselected.
 * - Unknown slugs (selected but absent from catalog) appear first so the
 *   user can easily identify and remove them (e.g. legacy typos like "webseerch").
 */
export function mergeSelectedWithCatalog(
  selectedSlugs: string[],
  catalog: ComposioToolkitSummary[],
): PickerEntry[] {
  const catalogSlugs = new Set(catalog.map((t) => t.slug));
  const selectedSet = new Set(selectedSlugs);

  // Unknown slugs — selected but not in catalog
  const unknownEntries: PickerEntry[] = selectedSlugs
    .filter((slug) => !catalogSlugs.has(slug))
    .map((slug) => ({
      slug,
      name: prettifyToolkitSlug(slug),
      description: null,
      logo: null,
      managedAuth: false,
      noAuth: false,
      categories: [],
      selected: true,
      unknown: true,
    }));

  // Catalog entries in catalog order
  const catalogEntries: PickerEntry[] = catalog.map((toolkit) => ({
    ...toolkit,
    selected: selectedSet.has(toolkit.slug),
    unknown: false,
  }));

  return [...unknownEntries, ...catalogEntries];
}
