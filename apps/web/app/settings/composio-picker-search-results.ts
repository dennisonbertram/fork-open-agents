/**
 * Pure helper: builds ComposioToolkitPicker's search-result rows, including
 * unconnected-but-connectable toolkits (#801, epic #796 T5, finding W9 /
 * #736 item 2).
 *
 * Before this ticket, the picker's search results were derived from
 * `selectableToolkits(...)` (composio-selectable-toolkits.ts), which in
 * "connected" mode returns ONLY connected + noAuth toolkits — so searching
 * an unconnected-but-real toolkit (e.g. "gmail") in the agent builder's
 * "Other tools" picker produced zero rows and the dead-end "No tools
 * matching 'gmail'" message, with no way to connect it from there.
 *
 * `selectableToolkits` is intentionally left unchanged — its existing
 * BT-224-8-xxx suite is a locked-in contract used by other call sites (the
 * empty-connected-state check, the merge-with-selected logic). This module
 * adds a NEW helper used only for search-result rendering: it returns every
 * catalog match (not just the connected/noAuth subset), tagging each row
 * `connectable` so the picker can render a compact "Connect" affordance
 * instead of filtering the row out entirely.
 */
import type { ComposioToolkitSummary } from "@/app/api/composio/toolkits/route";
import { filterToolkits } from "./composio-catalog-filter";
import type { ToolkitSource } from "./composio-selectable-toolkits";

export interface PickerSearchResult extends ComposioToolkitSummary {
  /**
   * True when this toolkit needs a "Connect" affordance before it can be
   * selected — i.e. it is neither connected nor noAuth. Always false in
   * "all" mode (the full catalog is directly selectable there; the
   * connect-affordance dead-end this fixes only exists in "connected" mode).
   */
  connectable: boolean;
}

export interface BuildPickerSearchResultsParams {
  catalog: ComposioToolkitSummary[];
  connectedSlugs: Set<string>;
  source?: ToolkitSource;
  query: string;
}

export function buildPickerSearchResults({
  catalog,
  connectedSlugs,
  source = "connected",
  query,
}: BuildPickerSearchResultsParams): PickerSearchResult[] {
  const filtered = filterToolkits(catalog, query);

  return filtered.map((toolkit) => {
    const connectable =
      source === "connected" &&
      !toolkit.noAuth &&
      !connectedSlugs.has(toolkit.slug);
    return { ...toolkit, connectable };
  });
}
