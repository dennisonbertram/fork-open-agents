import type { RepoAccessDeniedReason } from "@/lib/github/access";

/**
 * Decides how a page should react to a `verifyRepoAccess` denial.
 *
 * Not every denial means "this repo does not exist for you". Some are
 * conditions the user can fix, and answering those with a 404 is a wrong
 * answer confidently given: a user whose GitHub token expired was told the
 * repository was not found, with no route back to reconnecting.
 *
 * - `not_found`  — the user genuinely has no relationship with this repo.
 * - `actionable` — something the user or an operator can resolve; show the
 *   guidance from `getRepoAccessErrorMessage` instead of hiding the page.
 */
export type RepoAccessPageOutcome = "not_found" | "actionable";

const ACTIONABLE_REASONS: ReadonlySet<RepoAccessDeniedReason> = new Set([
  // The connection is broken or absent — reconnecting fixes it.
  "no_user_token",
  "user_token_rejected",
  // Transient; retrying fixes it.
  "rate_limited",
  // The App is not installed for this owner — installing fixes it.
  "no_installation",
  // The App is installed but cannot see this repo — adjusting the
  // installation's repository selection fixes it.
  "app_no_access",
]);

export function resolveRepoAccessPageOutcome(
  reason: RepoAccessDeniedReason,
): RepoAccessPageOutcome {
  return ACTIONABLE_REASONS.has(reason) ? "actionable" : "not_found";
}
