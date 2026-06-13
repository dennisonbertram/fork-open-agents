"use client";

/**
 * useRepoAgents — SWR hook that fetches all background agents for the
 * authenticated user once and returns them, plus a helper that filters
 * by a specific repo.
 *
 * The agents list is fetched globally (one call), so mounting multiple
 * repo groups does not trigger N requests.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/swr";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SidebarAgent = {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  status: "enabled" | "disabled";
};

type AgentsResponse = {
  agents: SidebarAgent[];
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAllAgents(): {
  agents: SidebarAgent[] | null;
  loading: boolean;
  error: string | null;
} {
  const { data, error, isLoading } = useSWR<AgentsResponse>(
    "/api/background-agents",
    fetcher,
    {
      // Sidebar agents are relatively stable — only revalidate on focus when
      // the user is actively looking at the sidebar.
      revalidateOnFocus: true,
      // No polling per feature spec.
      refreshInterval: 0,
    },
  );

  return {
    agents: data?.agents ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
  };
}
