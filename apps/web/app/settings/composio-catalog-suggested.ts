import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

/**
 * Popular toolkit slugs shown as suggestions in the "Connect tools" section
 * when the user has no search query active.
 */
export const POPULAR_TOOLKIT_SLUGS = [
  "github",
  "gmail",
  "slack",
  "linear",
  "notion",
] as const;

/**
 * Returns at most `max` toolkits from `popularSlugs` that:
 * 1. Exist in `catalog`
 * 2. Are NOT already in `connectedSlugs`
 *
 * Results are ordered by `popularSlugs` order, not catalog order.
 *
 * @param catalog        Full list of available toolkits from the API
 * @param connectedSlugs Set of slugs the user has already connected
 * @param popularSlugs   Ordered list of popular toolkit slugs to suggest
 * @param max            Maximum number of suggestions to return
 */
export function selectSuggestedToolkits(
  catalog: ComposioToolkitSummary[],
  connectedSlugs: Set<string>,
  popularSlugs: ReadonlyArray<string>,
  max: number,
): ComposioToolkitSummary[] {
  const catalogBySlug = new Map(catalog.map((t) => [t.slug, t]));
  const suggestions: ComposioToolkitSummary[] = [];

  for (const slug of popularSlugs) {
    if (suggestions.length >= max) break;
    if (connectedSlugs.has(slug)) continue;
    const toolkit = catalogBySlug.get(slug);
    if (!toolkit) continue;
    suggestions.push(toolkit);
  }

  return suggestions;
}
