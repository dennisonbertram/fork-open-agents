/**
 * Shared scoped-empty-state helper for the repo pickers (#785).
 *
 * When a GitHub App installation is scoped to `repositorySelection: "selected"`
 * and the fetched repo list is empty (or a search yields no matches), the
 * picker should tell the user their installation is limiting visibility
 * instead of implying they truly have zero repositories. This is distinct
 * from the generic "No repositories found." copy shown for `"all"`-scope
 * installs with genuinely zero repos.
 *
 * Reuses the vocabulary already established in
 * `apps/web/app/settings/accounts-section.tsx` (`InstallBadge` tooltips
 * "All Repositories" / "Select Repositories" / "No Repository Access", and
 * `OrgRow`'s "Configure" link to `installationUrl`).
 */

import type { ReactNode } from "react";

export const GENERIC_EMPTY_REPOS_COPY = "No repositories found.";
export const SCOPED_EMPTY_REPOS_COPY =
  "This installation only covers selected repositories.";
export const MANAGE_ACCESS_LABEL = "Manage access";
export const FRIENDLY_REPOS_ERROR_COPY = "We couldn't load your repositories.";
export const RETRY_LABEL = "Retry";
export const REFRESH_FAILED_COPY = "Refresh failed. Please try again.";

export function isScopedEmpty(
  repositorySelection: "all" | "selected" | null | undefined,
  repoCount: number,
): boolean {
  return repositorySelection === "selected" && repoCount === 0;
}

interface RepoPickerScopeEmptyStateProps {
  installationUrl: string | null | undefined;
  className?: string;
  linkClassName?: string;
  renderLink: (props: {
    href: string;
    className?: string;
    children: ReactNode;
  }) => ReactNode;
}

/**
 * Renders the scoped-empty copy plus an optional "Manage access" deep link
 * to the installation's configuration page. When `installationUrl` is
 * `null` (installation exists but no URL is available), the link is
 * omitted and only the copy is shown — never a dead `href="#"`.
 */
export function RepoPickerScopeEmptyState({
  installationUrl,
  className,
  linkClassName,
  renderLink,
}: RepoPickerScopeEmptyStateProps) {
  return (
    <div className={className}>
      <p>{SCOPED_EMPTY_REPOS_COPY}</p>
      {installationUrl &&
        renderLink({
          href: installationUrl,
          className: linkClassName,
          children: MANAGE_ACCESS_LABEL,
        })}
    </div>
  );
}

interface RepoPickerErrorRetryProps {
  className?: string;
  onRetry: () => void;
  retryButtonClassName?: string;
}

/**
 * Renders friendly copy (never the raw `Error.message`) plus a co-located
 * Retry action that re-invokes the fetch (e.g. `refreshRepos`).
 */
export function RepoPickerErrorRetry({
  className,
  onRetry,
  retryButtonClassName,
}: RepoPickerErrorRetryProps) {
  return (
    <div className={className}>
      <p>{FRIENDLY_REPOS_ERROR_COPY}</p>
      <button type="button" onClick={onRetry} className={retryButtonClassName}>
        {RETRY_LABEL}
      </button>
    </div>
  );
}
