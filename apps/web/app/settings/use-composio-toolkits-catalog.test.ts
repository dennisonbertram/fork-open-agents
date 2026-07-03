/**
 * Tests for the shared Composio toolkits-catalog fetch error-derivation
 * helper (#801, epic #796 T5, finding C2).
 *
 * `composio-tool-catalog.tsx` and `composio-toolkit-picker.tsx` previously
 * duplicated their own `useSWR("/api/composio/toolkits", jsonFetcher)` calls
 * and neither destructured `error`, so a 502 from the toolkits API rendered
 * the whole catalog section as `null` under an intact header with no
 * explanation. `deriveCatalogLoadState` is the pure piece of that fix: given
 * SWR's `data`/`error`/`isLoading` triple, it decides whether the caller
 * should render loading skeletons, a retry error state, or the loaded
 * toolkit list — used identically by both consumers so their error handling
 * can't drift apart again.
 *
 * BT-801-010: error present (even with stale data) surfaces the "error" load
 *             state so a retry control renders instead of silently returning
 *             null.
 * BT-801-011: no error, isLoading true, no data yet -> "loading".
 * BT-801-012: no error, data present -> "loaded" with the toolkits list.
 * BT-801-013: no error, no data, not loading (SWR's initial tick) -> "loading"
 *             (never silently "loaded" with an empty list that could be
 *             confused with a genuinely empty catalog).
 */
import { describe, expect, test } from "bun:test";
import { deriveCatalogLoadState } from "./use-composio-toolkits-catalog";
import type { ComposioToolkitsResponse } from "@/app/api/composio/toolkits/route";

const FIXTURE_RESPONSE: ComposioToolkitsResponse = {
  toolkits: [
    {
      slug: "slack",
      name: "Slack",
      description: "Team messaging.",
      logo: null,
      categories: [],
      managedAuth: true,
      noAuth: false,
    },
  ],
};

describe("deriveCatalogLoadState", () => {
  test("BT-801-010: an error (even alongside stale data) derives 'error'", () => {
    const state = deriveCatalogLoadState({
      data: FIXTURE_RESPONSE,
      error: new Error("Failed to load /api/composio/toolkits"),
      isLoading: false,
    });
    expect(state.status).toBe("error");
  });

  test("BT-801-010b: error message is carried through for the retry UI", () => {
    const state = deriveCatalogLoadState({
      data: undefined,
      error: new Error("Failed to load /api/composio/toolkits"),
      isLoading: false,
    });
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toContain("Failed to load");
    }
  });

  test("BT-801-011: isLoading true with no data derives 'loading'", () => {
    const state = deriveCatalogLoadState({
      data: undefined,
      error: undefined,
      isLoading: true,
    });
    expect(state.status).toBe("loading");
  });

  test("BT-801-012: data present with no error derives 'loaded' with the toolkits", () => {
    const state = deriveCatalogLoadState({
      data: FIXTURE_RESPONSE,
      error: undefined,
      isLoading: false,
    });
    expect(state.status).toBe("loaded");
    if (state.status === "loaded") {
      expect(state.toolkits).toEqual(FIXTURE_RESPONSE.toolkits);
    }
  });

  test("BT-801-013: no data, no error, not loading (initial SWR tick) derives 'loading', not 'loaded'", () => {
    const state = deriveCatalogLoadState({
      data: undefined,
      error: undefined,
      isLoading: false,
    });
    expect(state.status).toBe("loading");
  });
});
