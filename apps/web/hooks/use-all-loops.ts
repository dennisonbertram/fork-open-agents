"use client";

/**
 * useAllLoops — fetches every agent loop for the authenticated user (one global
 * call, no repo filter), so the sidebar can keep a repo group visible while it
 * has loops even after all its sessions/branches are gone.
 *
 * Mirrors useRepoLoops' handling of the AGENT_LOOPS_ENABLED 403 feature_disabled
 * response: featureDisabled is surfaced (not an error) and the caller treats the
 * loop set as empty.
 */

import useSWR from "swr";

export type SidebarLoopWithRepo = {
  id: string;
  name: string;
  status: string;
  repoOwner: string;
  repoName: string;
};

type AllLoopsResponse = {
  loops: SidebarLoopWithRepo[];
};

async function allLoopsFetcher(url: string): Promise<AllLoopsResponse> {
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
      (body as { errorKind?: string }).errorKind === "feature_disabled"
    ) {
      throw Object.assign(new Error("feature_disabled"), {
        kind: "feature_disabled",
      });
    }
  }

  if (!res.ok) {
    throw new Error(res.statusText);
  }

  return res.json() as Promise<AllLoopsResponse>;
}

export function useAllLoops(): {
  loops: SidebarLoopWithRepo[] | null;
  featureDisabled: boolean;
  loading: boolean;
  error: string | null;
} {
  const { data, error, isLoading } = useSWR<AllLoopsResponse>(
    "/api/agent-loops",
    allLoopsFetcher,
    { revalidateOnFocus: true, refreshInterval: 0 },
  );

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
