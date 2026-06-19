"use client";

import useSWR from "swr";
import type { ResolvedRepoDefaults } from "@/lib/repo-settings/resolve-repo-defaults";

interface RepoDefaultsResponse {
  resolved: ResolvedRepoDefaults;
  raw: unknown;
}

async function fetchRepoDefaults(url: string): Promise<RepoDefaultsResponse> {
  const response = await fetch(url);
  const json = (await response.json()) as unknown;

  if (!response.ok) {
    const error =
      json && typeof json === "object" && "error" in json
        ? (json as { error?: unknown }).error
        : undefined;
    throw new Error(
      typeof error === "string" ? error : "Failed to load repository settings",
    );
  }

  if (
    !json ||
    typeof json !== "object" ||
    !("resolved" in json) ||
    typeof (json as { resolved?: unknown }).resolved !== "object" ||
    (json as { resolved?: unknown }).resolved === null
  ) {
    throw new Error("Received an invalid repository settings response");
  }

  return json as RepoDefaultsResponse;
}

export function useRepoDefaults(params: {
  enabled: boolean;
  repoOwner: string;
  repoName: string;
}) {
  const key =
    params.enabled && params.repoOwner && params.repoName
      ? `/api/settings/repositories/${encodeURIComponent(params.repoOwner)}/${encodeURIComponent(params.repoName)}`
      : null;

  const { data, error, isLoading } = useSWR(key, fetchRepoDefaults, {
    revalidateOnFocus: false,
  });

  return {
    defaults: data?.resolved,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
  };
}
