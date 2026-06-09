/**
 * Pure helper: returns true when at least one account is missing the GitHub
 * App install, meaning the org list should default to expanded so the user
 * can see the recovery path without a click.
 */
export function shouldAutoExpandOrgs(
  installedCount: number,
  allAccountsCount: number,
): boolean {
  // STUB — implementation pending
  return false;
}
