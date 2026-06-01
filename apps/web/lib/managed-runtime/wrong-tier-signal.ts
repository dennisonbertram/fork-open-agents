// Stub — implementation pending (RED state)
// Typed wrong-tier classification for managed runtime verification failures.

export type VerificationFailureKind = "wrong_tier" | "setup_failure";

export type VerificationFailureResult =
  | { kind: "wrong_tier"; message: string }
  | { kind: "setup_failure" };

/** Map of profileId → command ids that are classified as wrong-tier failures */
export const WRONG_TIER_SIGNALS: Record<string, string[]> = {};

export function isWrongTierVerificationFailure(
  _profileId: string,
  _commandId: string,
): boolean {
  // Not implemented yet — tests will fail
  return false;
}

export function classifyVerificationFailure(
  _profileId: string,
  _commandId: string,
): VerificationFailureResult {
  // Not implemented yet — tests will fail
  return { kind: "setup_failure" };
}
