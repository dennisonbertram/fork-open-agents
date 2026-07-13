"use client";

/**
 * repo-combobox.tsx — a single "owner/repo" picker for the loop create form.
 *
 * Replaces two free-text "Repository owner" / "Repository name" inputs with a
 * connected GitHub repository search. A free-typed "owner/repo" remains
 * available for repositories outside the installation scope.
 */

import {
  GitHubRepositoryCombobox,
  parseGitHubRepositorySlug,
} from "@/components/github-repository-combobox";

/** Parse "owner/repo" → {owner, name}, or null if it isn't a valid pair. */
export function parseRepoSlug(
  raw: string,
): { owner: string; name: string } | null {
  return parseGitHubRepositorySlug(raw);
}

type RepoComboboxProps = {
  owner: string;
  name: string;
  onChange: (owner: string, name: string) => void;
};

export function RepoCombobox({ owner, name, onChange }: RepoComboboxProps) {
  return (
    <GitHubRepositoryCombobox
      value={{ owner, name }}
      allowFreeform
      placeholder="Select a repository"
      onChange={(next) => onChange(next.owner, next.name)}
    />
  );
}
