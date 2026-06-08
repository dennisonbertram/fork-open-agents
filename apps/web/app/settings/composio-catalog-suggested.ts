import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

/**
 * Popular toolkit slugs to show as suggestions in the "Connect tools" section
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
 * STUB — not yet implemented. Returns empty array always.
 * Tests should fail until this is replaced with a real implementation.
 */
export function selectSuggestedToolkits(
  _catalog: ComposioToolkitSummary[],
  _connectedSlugs: Set<string>,
  _popularSlugs: ReadonlyArray<string>,
  _max: number,
): ComposioToolkitSummary[] {
  // Stub: not implemented
  return [];
}
