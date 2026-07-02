/**
 * Pure helper: returns true when at least one account is missing the GitHub
 * App install, meaning the org list should default to expanded so the user
 * can see the recovery path without a click.
 *
 * The list stays collapsed in the all-installed happy path (installedCount ===
 * allAccountsCount) and when there are no accounts at all.
 */
export function shouldAutoExpandOrgs(
  installedCount: number,
  allAccountsCount: number,
): boolean {
  if (allAccountsCount === 0) return false;
  return installedCount < allAccountsCount;
}

/**
 * Account-level GitHub "manage installations" URL, derived from the OAuth
 * app's client ID. Returns null when the client ID isn't configured so
 * callers can omit the link rather than render a dead href="#".
 */
export function getGitHubManageUrl(
  clientId: string | undefined,
): string | null {
  return clientId
    ? `https://github.com/settings/connections/applications/${clientId}`
    : null;
}
