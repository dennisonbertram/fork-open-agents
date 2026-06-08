/**
 * Pure helper: derive the set of toolkits selectable in the picker,
 * scoped to either connected-only or the full catalog.
 */
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";

export type ToolkitSource = "connected" | "all";

export interface SelectableToolkitsOptions {
  catalog: ComposioToolkitSummary[];
  connectedSlugs: Set<string>;
  source?: ToolkitSource;
}

/**
 * Returns the subset of catalog toolkits that are selectable given the source mode.
 *
 * - "connected" (default): only toolkits the user has connected + all noAuth toolkits.
 *   Slugs that are connected but absent from the catalog are excluded (they are
 *   handled separately as "legacy/unknown" chips in the picker).
 * - "all": the full catalog, unchanged.
 *
 * Result is always deduplicated and preserves catalog order.
 */
export function selectableToolkits({
  catalog,
  connectedSlugs,
  source = "connected",
}: SelectableToolkitsOptions): ComposioToolkitSummary[] {
  // This stub always returns empty — tests should fail until implementation lands.
  return [];
}
