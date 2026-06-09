/**
 * Pure helpers extracted from session-starter.tsx.
 *
 * Keeping these as standalone functions makes them trivially unit-testable and
 * removes logic from the render body.
 */

export type SessionMode = "empty" | "repo";

export interface IsSubmitBlockedParams {
  controlsDisabled: boolean;
  mode: SessionMode;
  isRepoModeDisabled: boolean;
  githubConnectionLoading: boolean;
  reconnectRequired: boolean;
  isRepoSelectionComplete: boolean;
  isVercelLookupPending: boolean;
  /**
   * Kept in the signature for forward-compat but is intentionally NOT used as
   * a blocking signal (fixes #219 — the funnel must not hard-block on an
   * unresolved Vercel env-sync choice).
   */
  requiresVercelChoice: boolean;
}

/**
 * Returns the footer copy for the session-starter card.
 *
 * - empty mode: reassurance that no sandbox is provisioned immediately.
 * - repo mode:  "Using {sandboxName} sandbox · Change" — a sandbox really is
 *               provisioned here.
 */
export function getSessionFooter(
  mode: SessionMode,
  sandboxName: string,
): string {
  if (mode === "empty") {
    return "Starts instantly — no sandbox. Add one later if the agent needs to run code.";
  }
  return `Using ${sandboxName} sandbox`;
}

/**
 * Returns true when the Start/Submit button should be disabled.
 *
 * Note: requiresVercelChoice is intentionally excluded from the blocking
 * conditions. The env-sync card is now optional (collapses by default), so
 * users can proceed with one click and configure Vercel sync later.
 */
export function isSubmitBlocked({
  controlsDisabled,
  mode,
  isRepoModeDisabled,
  githubConnectionLoading,
  reconnectRequired,
  isRepoSelectionComplete,
  isVercelLookupPending,
}: IsSubmitBlockedParams): boolean {
  if (controlsDisabled) return true;
  if (mode === "repo" && isRepoModeDisabled) return true;
  if (mode === "repo" && (githubConnectionLoading || reconnectRequired))
    return true;
  if (!isRepoSelectionComplete) return true;
  if (isVercelLookupPending) return true;
  return false;
}

/**
 * Returns the label for the primary submit button.
 *
 * - empty mode or repo mode with no repo selected: "Start chat"
 * - repo mode with owner + repo:                   "Start with {owner}/{repo}"
 */
export function getButtonLabel(
  mode: SessionMode,
  selectedOwner: string,
  selectedRepo: string,
): string {
  if (mode === "repo" && selectedOwner && selectedRepo) {
    return `Start with ${selectedOwner}/${selectedRepo}`;
  }
  return "Start chat";
}
