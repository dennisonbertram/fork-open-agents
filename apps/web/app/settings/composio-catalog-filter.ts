import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

/**
 * Filter toolkits by a search query, matching against name, description, and slug.
 * An empty/whitespace-only query returns all toolkits unchanged.
 *
 * Exported as a pure function so it can be unit-tested independently of any React component.
 */
export function filterToolkits(
  toolkits: ComposioToolkitSummary[],
  query: string,
): ComposioToolkitSummary[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return toolkits;
  }

  const lower = trimmed.toLowerCase();

  return toolkits.filter((toolkit) => {
    if (toolkit.slug.toLowerCase().includes(lower)) return true;
    if (toolkit.name.toLowerCase().includes(lower)) return true;
    if (toolkit.description?.toLowerCase().includes(lower)) return true;
    return false;
  });
}
