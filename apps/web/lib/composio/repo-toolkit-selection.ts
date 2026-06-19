/**
 * Resolve the effective Composio toolkit slugs for a repo/workspace.
 *
 * Two-tier model: the repo selection is a subset of the user's globally
 * connected toolkits. `selectedToolkitSlugs` is NULL when the repo has never
 * been configured — in that case GitHub is default-on (only when actually
 * connected, so we never hand the model dead, unauthenticated tools). Once the
 * user makes an explicit choice (any array, including empty), it wins as-is.
 */
export function getEffectiveRepoToolkitSlugs(params: {
  selectedToolkitSlugs: string[] | null | undefined;
  githubConnected: boolean;
}): string[] {
  const { selectedToolkitSlugs, githubConnected } = params;

  // Never configured → GitHub default-on (only if connected).
  if (selectedToolkitSlugs == null) {
    return githubConnected ? ["github"] : [];
  }

  // Explicit choice (incl. empty) wins verbatim.
  return selectedToolkitSlugs;
}
