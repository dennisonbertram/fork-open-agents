"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { z } from "zod";
import { fetcher } from "@/lib/swr";

const installationSchema = z.object({
  installationId: z.number(),
  accountLogin: z.string(),
});

const installationsSchema = z.array(installationSchema);

const repositorySchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  updated_at: z.string().optional(),
});

const repositoriesSchema = z.array(repositorySchema);

export type GitHubRepositoryOption = {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  updatedAt?: string;
};

type Installation = z.infer<typeof installationSchema>;

async function fetchInstallations(): Promise<Installation[]> {
  const response = await fetch("/api/github/installations");
  if (!response.ok) {
    throw new Error("Failed to load GitHub installations");
  }

  const parsed = installationsSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Received an invalid GitHub installations response");
  }

  return parsed.data;
}

async function fetchRepositories(
  installations: Installation[],
  query: string,
): Promise<GitHubRepositoryOption[]> {
  const results = await Promise.allSettled(
    installations.map(async (installation) => {
      const params = new URLSearchParams({
        installation_id: String(installation.installationId),
        limit: "25",
      });
      if (query) params.set("query", query);

      const response = await fetcher<unknown>(
        `/api/github/installations/repos?${params.toString()}`,
      );
      const parsed = repositoriesSchema.safeParse(response);
      if (!parsed.success) {
        throw new Error("Received an invalid GitHub repositories response");
      }

      return parsed.data.map((repository) => {
        const [owner] = repository.full_name.split("/");
        return {
          owner: owner || installation.accountLogin,
          name: repository.name,
          fullName: repository.full_name,
          description: repository.description,
          private: repository.private,
          ...(repository.updated_at
            ? { updatedAt: repository.updated_at }
            : {}),
        } satisfies GitHubRepositoryOption;
      });
    }),
  );

  const options = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (
    options.length === 0 &&
    results.some((result) => result.status === "rejected")
  ) {
    throw new Error("Failed to load GitHub repositories");
  }

  const unique = new Map(options.map((option) => [option.fullName, option]));
  return [...unique.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

export function useGitHubRepositoryOptions({
  enabled = true,
  query = "",
}: {
  enabled?: boolean;
  query?: string;
} = {}) {
  const normalizedQuery = query.trim();
  const {
    data: installationsData,
    error: installationsError,
    isLoading: installationsLoading,
  } = useSWR<Installation[]>(
    enabled ? "/api/github/installations" : null,
    fetchInstallations,
  );
  const installations = Array.isArray(installationsData)
    ? installationsData
    : [];

  const installationKey = installations
    ?.map((installation) => installation.installationId)
    .join(",");
  const repositoriesKey =
    enabled && installationKey
      ? `/api/github/repository-options?installations=${installationKey}&query=${encodeURIComponent(normalizedQuery)}`
      : null;
  const {
    data: repositoriesData,
    error: repositoriesError,
    isLoading: repositoriesLoading,
    mutate,
  } = useSWR<GitHubRepositoryOption[]>(
    repositoriesKey,
    () => fetchRepositories(installations ?? [], normalizedQuery),
    { keepPreviousData: true, dedupingInterval: 5_000 },
  );

  const options = useMemo(
    () => (Array.isArray(repositoriesData) ? repositoriesData : []),
    [repositoriesData],
  );

  return {
    installations: installations ?? [],
    options,
    isLoading: installationsLoading || repositoriesLoading,
    error: installationsError?.message ?? repositoriesError?.message ?? null,
    refresh: async () => {
      if (typeof mutate === "function") await mutate();
    },
  };
}
