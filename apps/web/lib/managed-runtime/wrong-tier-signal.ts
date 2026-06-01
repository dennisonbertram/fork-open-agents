/**
 * wrong-tier-signal — typed classification of managed-runtime verification failures.
 *
 * A "wrong tier" failure means the profile requires sandbox capabilities
 * (e.g. a privileged container for Docker-in-sandbox) that the current
 * runtime tier does not provide. This is distinct from a generic setup
 * failure (missing package, network error, etc.).
 *
 * Consumers can use classifyVerificationFailure to decide whether to render
 * an actionable "needs privileged tier" message or a generic retry/debug UI.
 */

export type VerificationFailureKind = "wrong_tier" | "setup_failure";

export type VerificationFailureResult =
  | { kind: "wrong_tier"; message: string }
  | { kind: "setup_failure" };

/**
 * Map of profileId → list of verificationCommand ids whose failure signals
 * a "wrong tier" condition rather than a recoverable setup error.
 *
 * Only entries explicitly listed here are classified as wrong_tier. All
 * other failures fall back to setup_failure.
 */
export const WRONG_TIER_SIGNALS: Record<string, string[]> = {
  "docker-in-sandbox": ["verify-docker-daemon"],
};

const WRONG_TIER_MESSAGES: Record<string, Record<string, string>> = {
  "docker-in-sandbox": {
    "verify-docker-daemon":
      "The Docker daemon could not be reached inside this sandbox. " +
      "The docker-in-sandbox profile requires a privileged sandbox tier " +
      "(--privileged or dind-capable). Switch to a privileged tier to use this profile.",
  },
};

/**
 * Returns true when a verification command failure for the given profile
 * is a typed wrong-tier signal (as opposed to a generic setup failure).
 */
export function isWrongTierVerificationFailure(
  profileId: string,
  commandId: string,
): boolean {
  return WRONG_TIER_SIGNALS[profileId]?.includes(commandId) === true;
}

/**
 * Classifies a verification failure as either "wrong_tier" (with an
 * actionable message) or "setup_failure" (generic).
 */
export function classifyVerificationFailure(
  profileId: string,
  commandId: string,
): VerificationFailureResult {
  if (isWrongTierVerificationFailure(profileId, commandId)) {
    const message =
      WRONG_TIER_MESSAGES[profileId]?.[commandId] ??
      `Profile ${profileId} requires a privileged runtime tier for ${commandId}.`;
    return { kind: "wrong_tier", message };
  }
  return { kind: "setup_failure" };
}
