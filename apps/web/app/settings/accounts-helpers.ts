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
 *
 * This points at GitHub's OAuth app authorization review page
 * (/settings/connections/applications/<client_id>), which is the correct
 * destination for the pre-existing "Manage on GitHub" dropdown item. It is
 * NOT where a user uninstalls the GitHub App itself — for that, use
 * GITHUB_INSTALLATIONS_SETTINGS_URL below.
 */
export function getGitHubManageUrl(
  clientId: string | undefined,
): string | null {
  return clientId
    ? `https://github.com/settings/connections/applications/${clientId}`
    : null;
}

/**
 * GitHub's "Installed GitHub Apps" settings page, where a user can actually
 * uninstall the GitHub App. This is a fixed GitHub URL that needs no env
 * var or client ID, unlike getGitHubManageUrl above (which points at the
 * OAuth app authorization review page instead). Used by the disconnect
 * confirmation dialog (#789 / #828) since disconnecting only revokes this
 * app's OAuth token and never uninstalls the GitHub App.
 */
export const GITHUB_INSTALLATIONS_SETTINGS_URL =
  "https://github.com/settings/installations";

export type ConnectionButtonStatus = "connected" | "degraded" | "reconnect";

/**
 * Maps the GitHub connection-status API result onto the settings
 * connection button. `sync_degraded` (status check failed for a non-auth
 * reason) must be VISIBLE — it never maps to the green "connected" state,
 * but it also must not trigger the OAuth reconnect flow, which cannot fix
 * a transient validation failure.
 */
export function resolveConnectionButtonStatus({
  reconnectRequired,
  syncDegraded,
}: {
  reconnectRequired: boolean;
  syncDegraded: boolean;
}): ConnectionButtonStatus {
  if (reconnectRequired) {
    return "reconnect";
  }
  if (syncDegraded) {
    return "degraded";
  }
  return "connected";
}
