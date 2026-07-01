"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OutputMode, WriteScopeMode } from "@/lib/background-agents/agent-spec";

export interface GitHubWriteScopeSectionProps {
  /**
   * Only rendered when outputMode === "ready_pr" — write scope is
   * meaningless for read-only agents (buildAgentPayload forces
   * "this_repo"/[] for every other output mode).
   */
  outputMode: OutputMode;
  /**
   * The agent's GitHub App installation's repositorySelection, re-fetched by
   * the caller on every render — "all_repos" can only be offered when this is
   * "all". null means unknown (e.g. installation not yet resolved), which is
   * treated the same as "selected" (disabled) to fail closed.
   */
  repositorySelection: "all" | "selected" | null;
  /** Installation ID used to query GET /api/github/installations/repos. */
  installationId: number | null;
  repoOwner: string;
  repoName: string;
  writeScopeMode: WriteScopeMode;
  /** owner/repo full names selected in addition to the home repo. */
  writeScopeRepos: string[];
  onChange: (next: {
    writeScopeMode: WriteScopeMode;
    writeScopeRepos: string[];
  }) => void;
  disabled?: boolean;
}

type InstallationRepoSummary = {
  id: number;
  full_name: string;
  private: boolean;
};

async function jsonFetcher(url: string): Promise<InstallationRepoSummary[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to load repositories");
  }
  return (await res.json()) as InstallationRepoSummary[];
}

const ALL_REPOS_DISABLED_CAPTION =
  "Only available because your installation is set to all repos.";

/**
 * Pure helper: returns the user-facing description of a write-scope mode,
 * for both this section's own copy and the agent detail page's scope
 * summary — kept in one place so the two surfaces never drift.
 */
export function describeWriteScope(
  mode: WriteScopeMode,
  repoCount: number,
): string {
  switch (mode) {
    case "this_repo":
      return "this repo";
    case "all_repos":
      return "all repos your installation can reach";
    case "repo_list":
      return `${repoCount} repo${repoCount === 1 ? "" : "s"}`;
  }
}

/**
 * Three-way write-scope selector for a ready_pr agent's GitHub row:
 * "This repo" (default) / "All repos" / "Specific repos". Rendered
 * inside/adjacent to StandardToolpackSection's fixed GitHub row, visible
 * only when outputMode === "ready_pr".
 *
 * "All repos" is disabled with an explanatory caption unless the
 * installation's repositorySelection is "all" — a user can never request
 * broader write scope than the installation itself was granted on GitHub.
 * This is a display-only gate; the authoritative run-time gate lives in
 * write-scope.ts's resolveWriteScopeRepositoryIds, re-checked on every run.
 */
export function GitHubWriteScopeSection({
  outputMode,
  repositorySelection,
  installationId,
  repoOwner,
  repoName,
  writeScopeMode,
  writeScopeRepos,
  onChange,
  disabled = false,
}: GitHubWriteScopeSectionProps) {
  const [query, setQuery] = useState("");

  const allReposDisabled = repositorySelection !== "all";

  const searchUrl =
    writeScopeMode === "repo_list" && installationId
      ? `/api/github/installations/repos?installation_id=${installationId}${
          query.trim() ? `&query=${encodeURIComponent(query.trim())}` : ""
        }`
      : null;

  const { data: fetchedRepos } = useSWR<InstallationRepoSummary[]>(
    searchUrl,
    jsonFetcher,
  );

  if (outputMode !== "ready_pr") {
    return null;
  }

  const homeFullName = `${repoOwner}/${repoName}`;
  const candidateRepos = (fetchedRepos ?? []).filter(
    (r) => r.full_name !== homeFullName && !writeScopeRepos.includes(r.full_name),
  );

  function handleModeChange(mode: WriteScopeMode) {
    if (disabled) return;
    if (mode === "all_repos" && allReposDisabled) return;
    onChange({
      writeScopeMode: mode,
      writeScopeRepos: mode === "repo_list" ? writeScopeRepos : [],
    });
  }

  function handleAddRepo(fullName: string) {
    if (disabled || writeScopeRepos.includes(fullName)) return;
    onChange({
      writeScopeMode: "repo_list",
      writeScopeRepos: [...writeScopeRepos, fullName],
    });
  }

  function handleRemoveRepo(fullName: string) {
    if (disabled) return;
    onChange({
      writeScopeMode: "repo_list",
      writeScopeRepos: writeScopeRepos.filter((r) => r !== fullName),
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-background p-2.5">
      <p className="text-xs font-medium text-foreground">Write scope</p>
      <p className="text-xs text-muted-foreground">
        Which repos this agent's minted GitHub token can open pull requests
        on.
      </p>
      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="write-scope-mode"
            value="this_repo"
            checked={writeScopeMode === "this_repo"}
            disabled={disabled}
            onChange={() => handleModeChange("this_repo")}
            className="mt-0.5 shrink-0"
          />
          <span>This repo</span>
        </label>
        <label
          className={cn(
            "flex items-start gap-2 text-sm",
            allReposDisabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <input
            type="radio"
            name="write-scope-mode"
            value="all_repos"
            checked={writeScopeMode === "all_repos"}
            disabled={disabled || allReposDisabled}
            onChange={() => handleModeChange("all_repos")}
            className="mt-0.5 shrink-0"
          />
          <span>
            All repos
            {allReposDisabled && (
              <span className="block text-xs text-muted-foreground">
                {ALL_REPOS_DISABLED_CAPTION}
              </span>
            )}
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="write-scope-mode"
            value="repo_list"
            checked={writeScopeMode === "repo_list"}
            disabled={disabled}
            onChange={() => handleModeChange("repo_list")}
            className="mt-0.5 shrink-0"
          />
          <span>Specific repos</span>
        </label>
      </div>

      {writeScopeMode === "repo_list" && (
        <div className="space-y-2 pt-1">
          {writeScopeRepos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {writeScopeRepos.map((fullName) => (
                <span
                  key={fullName}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
                >
                  {fullName}
                  <button
                    type="button"
                    onClick={() => handleRemoveRepo(fullName)}
                    disabled={disabled}
                    aria-label={`Remove ${fullName}`}
                    className="ml-0.5 rounded-full hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search repos to add…"
              disabled={disabled}
              className="pl-8"
              aria-label="Search repos"
            />
          </div>
          {candidateRepos.length > 0 && (
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
              {candidateRepos.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => handleAddRepo(repo.full_name)}
                  disabled={disabled}
                  className="flex w-full items-center rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {repo.full_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
