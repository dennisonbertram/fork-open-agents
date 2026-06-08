import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

/**
 * Filter toolkits by a search query, matching against name, description, and slug.
 * An empty/whitespace-only query returns all toolkits unchanged.
 */
export function filterToolkits(
  toolkits: ComposioToolkitSummary[],
  query: string,
): ComposioToolkitSummary[] {
  // Stub — always returns empty to make tests fail meaningfully
  if (query.trim() === "") {
    return [];
  }
  return [];
}
