/**
 * Pure helpers extracted from session-starter.tsx.
 * Stubs — implementation will follow in the green phase.
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
  /** Kept in signature for backward compat but no longer a blocker. */
  requiresVercelChoice: boolean;
}

/**
 * Returns the footer text for the session-starter card.
 * Empty mode → reassurance (no sandbox claim).
 * Repo mode  → "Using {sandboxName} sandbox · Change".
 */
export function getSessionFooter(
  _mode: SessionMode,
  _sandboxName: string,
): string {
  throw new Error("not implemented");
}

/**
 * Returns true when the Start button should be disabled.
 * Note: requiresVercelChoice no longer blocks submit.
 */
export function isSubmitBlocked(_params: IsSubmitBlockedParams): boolean {
  throw new Error("not implemented");
}

/**
 * Returns the primary button label.
 */
export function getButtonLabel(
  _mode: SessionMode,
  _selectedOwner: string,
  _selectedRepo: string,
): string {
  throw new Error("not implemented");
}
