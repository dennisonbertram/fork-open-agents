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

// ---------------------------------------------------------------------------
// MR-4 (#812): New-Chat runtime picker
// ---------------------------------------------------------------------------

export type SessionRuntimeMode = "classic" | "managed_runtime";

/**
 * Plain-language label for the New-Chat runtime picker (consistent with
 * MR-3's copy conventions). "managed_runtime" names the active profile so
 * the user always knows which toolchain a new session will run in.
 */
export function getRuntimeModeLabel(
  runtimeMode: SessionRuntimeMode,
  profileDisplayName: string,
): string {
  if (runtimeMode === "classic") {
    return "Directly in a sandbox (classic)";
  }
  return `Through a verified environment (managed): ${profileDisplayName}`;
}

export interface RuntimeSelection {
  runtimeMode: SessionRuntimeMode;
  managedRuntimeProfileId?: string;
}

export interface GetEffectiveRuntimeSelectionParams {
  /** The user's explicit in-dialog choice, or null if untouched. */
  userSelection: RuntimeSelection | null;
  /** The resolved default runtime mode (from Preferences / repo defaults). */
  defaultRuntimeMode: SessionRuntimeMode;
  /** The resolved default managed-runtime profile id. */
  defaultProfileId: string;
}

/**
 * Resolves the effective New-Chat runtime selection: an explicit user choice
 * always wins; otherwise the picker is prefilled from the resolved default
 * (Decision D1). Never invents a profile id for "classic" mode.
 */
export function getEffectiveRuntimeSelection(
  params: GetEffectiveRuntimeSelectionParams,
): RuntimeSelection {
  if (params.userSelection) {
    if (params.userSelection.runtimeMode === "classic") {
      return { runtimeMode: "classic", managedRuntimeProfileId: undefined };
    }
    return {
      runtimeMode: "managed_runtime",
      managedRuntimeProfileId: params.userSelection.managedRuntimeProfileId,
    };
  }

  if (params.defaultRuntimeMode === "classic") {
    return { runtimeMode: "classic", managedRuntimeProfileId: undefined };
  }

  return {
    runtimeMode: "managed_runtime",
    managedRuntimeProfileId: params.defaultProfileId,
  };
}

export interface GetRuntimeSelectionForSubmitParams {
  /** The resolved effective selection (see getEffectiveRuntimeSelection). */
  effectiveRuntimeSelection: RuntimeSelection;
  /** True once the user has made an explicit choice in the runtime picker. */
  hasExplicitUserSelection: boolean;
  /**
   * True once repo defaults have loaded, or are not applicable (empty mode,
   * or no repo selected yet — there is no repo default to wait for).
   */
  repoDefaultsResolved: boolean;
}

/**
 * Codex #834 P2 fix: decides what runtime fields to actually send in the
 * onSubmit payload.
 *
 * When a repo is selected but repo defaults haven't resolved yet (still
 * loading, or errored) and the user hasn't made an explicit picker choice,
 * effectiveRuntimeSelection is only a not-yet-resolved "classic" fallback —
 * not a real choice. Sending it as an explicit runtimeMode would win over
 * the server's repo-defaults precedence (body > repo defaults > system
 * "classic"), silently overriding a saved managed_runtime repo default with
 * "classic". Omitting the fields here lets the server-side repoDefaults
 * precedence apply instead.
 */
export function getRuntimeSelectionForSubmit(
  params: GetRuntimeSelectionForSubmitParams,
): Partial<RuntimeSelection> {
  if (params.hasExplicitUserSelection || params.repoDefaultsResolved) {
    return params.effectiveRuntimeSelection;
  }
  return {};
}

export interface ShouldConfirmDiscardOnChangeParams {
  sessionTitle: string;
  mode: SessionMode;
  selectedOwner: string;
  selectedRepo: string;
}

/**
 * Returns true when the New-Chat dialog holds user input that a navigate-
 * away "Change" link would silently discard (fixes the #812 defect where
 * <Link href="/settings/preferences">Change</Link> dropped the in-progress
 * form with no warning).
 */
export function shouldConfirmDiscardOnChange(
  params: ShouldConfirmDiscardOnChangeParams,
): boolean {
  if (params.sessionTitle.trim().length > 0) {
    return true;
  }
  if (params.mode === "repo" && (params.selectedOwner || params.selectedRepo)) {
    return true;
  }
  return false;
}
