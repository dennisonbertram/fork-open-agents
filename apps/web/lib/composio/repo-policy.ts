import "server-only";

import {
  getRepositoryComposioSettings,
  getRepositoryComposioSettingsValues,
} from "@/lib/db/composio";

/**
 * Shared repo-policy resolver (#799, epic #796 T3).
 *
 * This is the ONE place selectedToolkitSlugs (allowlist) and
 * blockedToolkitSlugs (denylist) filtering happens. Every surface that can
 * run an agent against a repo — chat direct-slug, chat profile, background
 * agents, and loops (via resolveComposioToolsForBgRun) — must route through
 * this function so the same repo config produces the same result everywhere
 * (finding E2).
 *
 * Precedence: the denylist is checked FIRST for each requested slug. If a
 * slug is blocked, it is reported as "repo_policy_blocked" even when it also
 * happens to be outside a non-null allowlist ("denylist wins on overlap").
 * Otherwise, when selectedToolkitSlugs is a non-null allowlist, any
 * requested slug not present in it is reported as "not_in_repo_allowlist".
 * A requested slug that survives both checks is allowed.
 */

export type RepoToolkitPolicyBlockReason =
  | "not_in_repo_allowlist"
  | "repo_policy_blocked";

export type RepoToolkitPolicyBlockedSlug = {
  slug: string;
  reason: RepoToolkitPolicyBlockReason;
};

export type RepoToolkitPolicyResult = {
  allowed: string[];
  blocked: RepoToolkitPolicyBlockedSlug[];
};

export type ApplyRepoToolkitPolicyParams = {
  userId: string;
  repoOwner: string;
  repoName: string;
  requestedSlugs: string[];
};

/**
 * Applies the repository's Composio toolkit policy (allowlist + denylist)
 * to a list of requested toolkit slugs.
 *
 * Loads the repo settings row ONCE (a single getRepositoryComposioSettings
 * call), then filters requestedSlugs against it. When there is no settings
 * row, or neither selectedToolkitSlugs nor blockedToolkitSlugs is set, every
 * requested slug passes through unchanged (unrestricted).
 */
export async function applyRepoToolkitPolicy(
  params: ApplyRepoToolkitPolicyParams,
): Promise<RepoToolkitPolicyResult> {
  const { userId, repoOwner, repoName, requestedSlugs } = params;

  if (requestedSlugs.length === 0) {
    return { allowed: [], blocked: [] };
  }

  const settings = await getRepositoryComposioSettings({
    userId,
    repoOwner,
    repoName,
  });
  const settingsValues = getRepositoryComposioSettingsValues(settings);

  if (!settingsValues) {
    return { allowed: [...requestedSlugs], blocked: [] };
  }

  const blockedSlugSet = new Set(
    settingsValues.blockedToolkitSlugs.map((slug) => slug.toLowerCase()),
  );
  const allowlist = settingsValues.selectedToolkitSlugs;
  const allowlistSet = allowlist
    ? new Set(allowlist.map((slug) => slug.toLowerCase()))
    : null;

  const allowed: string[] = [];
  const blocked: RepoToolkitPolicyBlockedSlug[] = [];

  for (const slug of requestedSlugs) {
    const normalized = slug.toLowerCase();
    if (blockedSlugSet.has(normalized)) {
      blocked.push({ slug, reason: "repo_policy_blocked" });
      continue;
    }
    if (allowlistSet && !allowlistSet.has(normalized)) {
      blocked.push({ slug, reason: "not_in_repo_allowlist" });
      continue;
    }
    allowed.push(slug);
  }

  return { allowed, blocked };
}
