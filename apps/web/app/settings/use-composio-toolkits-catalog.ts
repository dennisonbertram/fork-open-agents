/**
 * Shared toolkits-catalog fetch hook (#801, epic #796 T5, findings C2 /
 * #736 item 2).
 *
 * Before this ticket, `composio-tool-catalog.tsx` and
 * `composio-toolkit-picker.tsx` each ran their own
 * `useSWR("/api/composio/toolkits", jsonFetcher)` call and neither
 * destructured `error` — so a 502 from the toolkits API silently rendered
 * as an empty/null catalog with no explanation. This hook is now the ONE
 * place that fetches the toolkits catalog; both consumers use it and both
 * get the same error-surfacing behavior for free, via `deriveCatalogLoadState`.
 */
import useSWR from "swr";
import type { ComposioToolkitsResponse } from "@/app/api/composio/toolkits/route";

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return res.json() as Promise<T>;
}

export type CatalogLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "loaded";
      toolkits: ComposioToolkitsResponse["toolkits"];
    };

export interface DeriveCatalogLoadStateParams {
  data: ComposioToolkitsResponse | undefined;
  error: unknown;
  isLoading: boolean;
}

/**
 * Pure decision: given SWR's data/error/isLoading triple for the toolkits
 * catalog, decide what the UI should render.
 *
 * An error always wins over stale data — if the most recent fetch failed,
 * the UI must show a retry state rather than silently falling back to
 * possibly-stale cached data with no indication anything is wrong.
 */
export function deriveCatalogLoadState(
  params: DeriveCatalogLoadStateParams,
): CatalogLoadState {
  if (params.error) {
    const message =
      params.error instanceof Error
        ? params.error.message
        : "Failed to load Composio toolkits.";
    return { status: "error", message };
  }
  if (params.data) {
    return { status: "loaded", toolkits: params.data.toolkits };
  }
  return { status: "loading" };
}

/**
 * Shared SWR hook — the ONE place `/api/composio/toolkits` is fetched from
 * the client. Both `composio-tool-catalog.tsx` and
 * `composio-toolkit-picker.tsx` consume this instead of each running their
 * own `useSWR` call, so their loading/error handling can't drift apart.
 */
export function useComposioToolkitsCatalog() {
  const { data, error, isLoading, mutate } = useSWR<ComposioToolkitsResponse>(
    "/api/composio/toolkits",
    jsonFetcher<ComposioToolkitsResponse>,
  );

  return {
    loadState: deriveCatalogLoadState({ data, error, isLoading }),
    data,
    error,
    isLoading,
    /**
     * Revalidates the toolkits catalog itself — the actual fetch a caller's
     * "Retry" action needs to re-run when the catalog failed to load (Codex
     * P2-1 on PR #847: a retry button that only revalidated
     * connected-accounts left the real toolkits error on screen).
     */
    mutate,
  };
}
