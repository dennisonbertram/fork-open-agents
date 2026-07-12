/**
 * error-copy.ts — the pure map from every background-agent run `errorKind`
 * to plain-language copy: what happened, what to do, and an optional action
 * link. Colocated with the background-runs surface, mirroring the sibling
 * pattern in `apps/web/app/loops/error-copy.ts` (#767) but scoped to
 * `BackgroundAgentErrorKind` (`apps/web/lib/background-agents/types.ts`),
 * which is a distinct vocabulary from the loops subsystem (#795).
 *
 * Coverage discipline: `ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS` is the durable
 * net — the coverage test in error-copy.test.ts fails if a kind is added
 * here without copy, or copy is added for a kind not enumerated. Keep this
 * list in sync with `backgroundAgentErrorKinds` in
 * `apps/web/lib/background-agents/types.ts`.
 *
 * Security: whatHappened/whatToDo must NEVER include raw `errorMessage`
 * content — it may contain hostnames, tokens, or other internals. The
 * existing `errorMessage` mono text already rendered in the sidebar "Run"
 * card is untouched by this module.
 */

export type BackgroundRunErrorCopy = {
  /** Plain-language, one-line statement of what happened. Never raw errorMessage. */
  whatHappened: string;
  /** Plain-language, one-line statement of what to do next. */
  whatToDo: string;
  /** Optional link for the "what to do" action (e.g. Settings → GitHub). */
  actionHref?: string;
  /** Optional link label; defaults to a generic "Learn more" when omitted. */
  actionLabel?: string;
  /** Whether this kind has dedicated copy (true) or fell back to generic (false). */
  isKnown: boolean;
  /** The raw kind string, always present so operators can see it in the disclosure. */
  rawKind: string;
};

/**
 * Every errorKind this module has dedicated copy for. This is the coverage
 * test's source of truth — every entry here MUST have a matching case in
 * `getBackgroundRunErrorCopy`'s switch, and MUST mirror
 * `backgroundAgentErrorKinds` in `apps/web/lib/background-agents/types.ts`.
 */
export const ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS = [
  "duplicate_event",
  "agent_disabled",
  "agent_deleted",
  "snapshot_missing",
  "snapshot_invalid",
  "snapshot_version_unsupported",
  "snapshot_hash_mismatch",
  "permission_missing",
  "installation_missing",
  "sandbox_unavailable",
  "workflow_failed",
  "checks_failed",
  "pr_creation_failed",
  "model_resolution_failed",
  "webhook_signature_invalid",
  "agent_turn_budget_exceeded",
  "agent_stalled",
  "token_budget_exceeded",
] as const;

export type KnownBackgroundRunErrorKind =
  (typeof ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS)[number];

const GITHUB_SETTINGS_HREF = "/settings/connections";

function knownCopy(
  kind: KnownBackgroundRunErrorKind,
): Omit<BackgroundRunErrorCopy, "isKnown" | "rawKind"> {
  switch (kind) {
    case "duplicate_event":
      return {
        whatHappened:
          "This run was skipped because an identical event was already processed.",
        whatToDo: "No action needed — this is expected de-duplication.",
      };
    case "agent_disabled":
      return {
        whatHappened: "This background agent is turned off.",
        whatToDo:
          "Re-enable the agent in the repo agents dashboard, then retry.",
      };
    case "agent_deleted":
      return {
        whatHappened:
          "The source Automation was deleted before this run could continue.",
        whatToDo:
          "The preserved evidence remains available. Create a new Automation before running this work again.",
      };
    case "snapshot_missing":
      return {
        whatHappened: "This run is missing its accepted execution definition.",
        whatToDo:
          "Do not retry this run. Create a new run from the current Automation.",
      };
    case "snapshot_invalid":
      return {
        whatHappened: "The accepted execution definition is malformed.",
        whatToDo:
          "Do not retry this run. Inspect the snapshot validation event and create a new run.",
      };
    case "snapshot_version_unsupported":
      return {
        whatHappened:
          "This run uses an execution-definition version the service cannot execute.",
        whatToDo:
          "Create a new run from the current Automation or restore a compatible service version.",
      };
    case "snapshot_hash_mismatch":
      return {
        whatHappened:
          "The accepted execution definition failed its integrity check.",
        whatToDo:
          "Do not execute or retry this run. Inspect the audit evidence and create a new run.",
      };
    case "permission_missing":
      return {
        whatHappened: "The agent doesn't have write access to this repository.",
        whatToDo:
          "Connect GitHub or ask a repository admin to grant write access.",
        actionHref: GITHUB_SETTINGS_HREF,
        actionLabel: "Open GitHub settings",
      };
    case "installation_missing":
      return {
        whatHappened:
          "The agent couldn't access this repository — no GitHub App installation was found.",
        whatToDo: "Connect your GitHub account in Settings → GitHub.",
        actionHref: GITHUB_SETTINGS_HREF,
        actionLabel: "Open GitHub settings",
      };
    case "sandbox_unavailable":
      return {
        whatHappened: "The run's execution sandbox couldn't be started.",
        whatToDo:
          "Retry the run. If it keeps failing, check the event log for details.",
      };
    case "workflow_failed":
      return {
        whatHappened:
          "A step timed out or ran out of retries before it could finish.",
        whatToDo: "Retry the run, or check the event log for details.",
      };
    case "checks_failed":
      return {
        whatHappened: "Required checks did not pass for this run's changes.",
        whatToDo: "Review the failing checks, fix them, then retry the run.",
      };
    case "pr_creation_failed":
      return {
        whatHappened: "The agent couldn't create or update the pull request.",
        whatToDo:
          "Check repository permissions and branch protection rules, then retry.",
      };
    case "model_resolution_failed":
      return {
        whatHappened: "The configured model couldn't be resolved for this run.",
        whatToDo: "Check the agent's model configuration, then retry the run.",
      };
    case "webhook_signature_invalid":
      return {
        whatHappened: "An incoming webhook failed signature verification.",
        whatToDo:
          "Check the GitHub App webhook secret configuration, then retry.",
      };
    case "agent_turn_budget_exceeded":
      return {
        whatHappened:
          "The agent reached its configured turn limit before it could finish.",
        whatToDo:
          "Review the partial work and event log, then retry with a narrower task or a higher turn limit.",
      };
    case "agent_stalled":
      return {
        whatHappened:
          "The agent stopped making progress after its recovery attempts.",
        whatToDo:
          "Review the preserved work and event log, then retry with clearer or narrower instructions.",
      };
    case "token_budget_exceeded":
      return {
        whatHappened: "The run reached its configured token safety limit.",
        whatToDo:
          "Review the partial work and usage evidence, then retry with a narrower task or adjust the token limit.",
      };
    default: {
      // Exhaustiveness guard: if a new kind is added to
      // ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS without a case above, this
      // fails to compile.
      const _exhaustive: never = kind;
      throw new Error(
        `Unhandled known background run error kind: ${_exhaustive}`,
      );
    }
  }
}

function isKnownKind(kind: string): kind is KnownBackgroundRunErrorKind {
  return (ALL_KNOWN_BACKGROUND_RUN_ERROR_KINDS as readonly string[]).includes(
    kind,
  );
}

/**
 * Returns plain-language copy for a background run errorKind. Unknown kinds
 * get an honest generic message; the raw kind is always returned separately
 * for a details disclosure. `errorMessage`, if passed, is NEVER read into
 * the returned copy.
 */
export function getBackgroundRunErrorCopy(
  kind: string,
  _context?: { errorMessage?: string | null },
): BackgroundRunErrorCopy {
  if (isKnownKind(kind)) {
    return { ...knownCopy(kind), isKnown: true, rawKind: kind };
  }
  return {
    whatHappened:
      "Something went wrong that we don't have specific guidance for yet.",
    whatToDo:
      "Check the technical details below, retry the run, or check the event log.",
    isKnown: false,
    rawKind: kind,
  };
}
