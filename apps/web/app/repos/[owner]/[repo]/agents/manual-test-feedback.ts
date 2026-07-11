import type { BackgroundDispatchResult } from "@/lib/background-agents/dispatcher";

/**
 * #861: shared contract for the manual "Run a test" dispatch response,
 * consumed by both the new-agent builder and the edit-mode form so every
 * matched:0 outcome is explained with an actionable next step instead of a
 * generic "nothing happened" message.
 */
export type ManualTestSkipReason = NonNullable<
  BackgroundDispatchResult["skipReason"]
>;

export type ManualTestResponse = {
  enabled: boolean;
  matched: number;
  created: number;
  duplicates: number;
  runIds: string[];
  skipReason?: ManualTestSkipReason;
  error?: string;
};

/**
 * A `Record` over the derived union (rather than a plain object literal)
 * enforces exhaustiveness: adding a 4th skipReason value to
 * `BackgroundDispatchResult` breaks this file's typecheck until copy is
 * added here.
 */
export const manualTestSkipMessages: Record<ManualTestSkipReason, string> = {
  agent_disabled:
    "This agent is disabled — enable it above, then run the test again.",
  no_enabled_trigger:
    "This agent has no enabled trigger to test — add or enable one first.",
  repo_allowlist_unconfigured:
    "Background-agent repository access isn't configured — ask an operator to set BACKGROUND_AGENTS_ALLOWED_REPOS.",
  repo_allowlist_invalid:
    "Background-agent repository access is misconfigured — ask an operator to correct BACKGROUND_AGENTS_ALLOWED_REPOS.",
  repo_not_allowlisted:
    "This repository isn't allowlisted for background agents — check Background agent settings.",
};
