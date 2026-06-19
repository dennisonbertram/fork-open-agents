"use client";

/**
 * useRepoLoops — SWR hook that lazily fetches loops for a specific repo.
 *
 * The fetch is deferred until `enabled` is true (i.e. the Loops sub-group
 * is first expanded), preventing N calls on initial sidebar mount.
 *
 * When the API returns 403 with errorKind "feature_disabled" (AGENT_LOOPS_ENABLED
 * is off), the hook sets featureDisabled: true and the caller hides the sub-group
 * entirely. No error UI is shown for the disabled case.
 */

import useSWR from "swr";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SidebarLoop = {
  id: string;
  name: string;
  status: string;
};

type LoopsResponse = {
  loops: SidebarLoop[];
};

type FeatureDisabledResponse = {
  errorKind: "feature_disabled";
  message: string;
};

// ── Fetcher that handles 403 feature_disabled ─────────────────────────────────

async function loopsFetcher(url: string): Promise<LoopsResponse> {
  const res = await fetch(url);

  if (res.status === 403) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // keep going
    }
    if (
      body !== null &&
      typeof body === "object" &&
      "errorKind" in (body as object) &&
      (body as FeatureDisabledResponse).errorKind === "feature_disabled"
    ) {
      // Signal to the hook via a typed sentinel value
      throw Object.assign(new Error("feature_disabled"), {
        kind: "feature_disabled",
      });
    }
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error ?? res.statusText;
    } catch {
      // keep statusText
    }
    throw new Error(message);
  }

  return res.json() as Promise<LoopsResponse>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useRepoLoops(params: {
  repoOwner: string;
  repoName: string;
  /** Only fetch when true — set to true on first expand of Loops sub-group */
  enabled: boolean;
}): {
  loops: SidebarLoop[] | null;
  featureDisabled: boolean;
  loading: boolean;
  error: string | null;
} {
  const { repoOwner, repoName, enabled } = params;

  const key = enabled
    ? `/api/agent-loops?repoOwner=${encodeURIComponent(repoOwner)}&repoName=${encodeURIComponent(repoName)}`
    : null;

  const { data, error, isLoading } = useSWR<LoopsResponse>(key, loopsFetcher, {
    revalidateOnFocus: false,
    refreshInterval: 0,
  });

  const isFeatureDisabled =
    error instanceof Error &&
    "kind" in error &&
    (error as Error & { kind?: string }).kind === "feature_disabled";

  return {
    loops: data?.loops ?? null,
    featureDisabled: isFeatureDisabled,
    loading: isLoading && !isFeatureDisabled,
    error: error instanceof Error && !isFeatureDisabled ? error.message : null,
  };
}
