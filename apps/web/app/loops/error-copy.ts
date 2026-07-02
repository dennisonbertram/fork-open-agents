/**
 * error-copy.ts — the single, pure map from every loop `errorKind` (plus the
 * repo-access denial reasons that collapse into `installation_missing` /
 * `permission_missing`, and the retry-conflict message) to plain-language
 * copy: what happened, what to do, and an optional action link.
 *
 * Consumed by run-detail.tsx, run-actions.tsx, and loop-detail.tsx (#767).
 *
 * Coverage discipline: `ALL_KNOWN_LOOP_ERROR_KINDS` is the durable net — the
 * coverage test in error-copy.test.ts fails if a kind is added here without
 * copy, or copy is added for a kind not enumerated. Keep this list in sync
 * with every `errorKind:` literal assigned under lib/agent-loops (grep
 * `errorKind:\s*"` there when adding a new failure path).
 *
 * Security: whatHappened/whatToDo must NEVER include raw `errorMessage`
 * content — it may contain hostnames, tokens, or other internals. Only
 * `sanitizeErrorDetail` output (truncated + redacted) may be shown, and only
 * inside the collapsible technical-details disclosure.
 */

export type LoopErrorCopy = {
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
 * `getLoopErrorCopy`'s switch.
 */
export const ALL_KNOWN_LOOP_ERROR_KINDS = [
  "installation_missing",
  "permission_missing",
  "dispatch_failed",
  "repo_not_allowed",
  "loop_inactive",
  "loop_invalid",
  "active_run",
  "ownership_fail",
  "feature_disabled",
  "sandbox_unavailable",
  "workflow_failed",
  "step_output_invalid",
  "checks_failed",
  "commit_failed",
  "guardrail_exceeded",
  "chain_route_missing",
  "condition_path_missing",
  "condition_type_mismatch",
  "github_check_failed",
  "step_failed",
  "stall_sweep",
  "retry_conflict",
] as const;

export type KnownLoopErrorKind = (typeof ALL_KNOWN_LOOP_ERROR_KINDS)[number];

const GITHUB_SETTINGS_HREF = "/settings/github";

function knownCopy(
  kind: KnownLoopErrorKind,
): Omit<LoopErrorCopy, "isKnown" | "rawKind"> {
  switch (kind) {
    case "installation_missing":
      return {
        whatHappened:
          "The loop couldn't access this repository — no GitHub App installation (or user token) was found.",
        whatToDo: "Connect your GitHub account in Settings → GitHub.",
        actionHref: GITHUB_SETTINGS_HREF,
        actionLabel: "Open GitHub settings",
      };
    case "permission_missing":
      return {
        whatHappened:
          "The loop doesn't have write access to this repository.",
        whatToDo:
          "Ask a repository admin to grant write access, or reconnect your GitHub account with the right permissions.",
        actionHref: GITHUB_SETTINGS_HREF,
        actionLabel: "Open GitHub settings",
      };
    case "dispatch_failed":
      return {
        whatHappened:
          "The run couldn't start — the execution backend rejected the dispatch.",
        whatToDo: "Retry the run. If it keeps failing, check the step log for details.",
      };
    case "repo_not_allowed":
      return {
        whatHappened:
          "This repository isn't enabled for loops on this deployment.",
        whatToDo:
          "Ask your workspace administrator to add this repository to the loops allowlist.",
      };
    case "loop_inactive":
      return {
        whatHappened: "The loop isn't active, so it didn't run.",
        whatToDo: "Set the loop status to Active, then try again.",
      };
    case "loop_invalid":
      return {
        whatHappened: "The loop's step definition is invalid or incomplete.",
        whatToDo: "Open the builder and fix the highlighted step configuration.",
      };
    case "active_run":
      return {
        whatHappened: "A run is already active for this loop.",
        whatToDo: "Wait for it to finish, resume it, or cancel it before starting a new run.",
      };
    case "ownership_fail":
      return {
        whatHappened: "This loop couldn't be verified as belonging to your account.",
        whatToDo: "Refresh the page and try again, or contact support if this persists.",
      };
    case "feature_disabled":
      return {
        whatHappened: "The loops feature is disabled on this deployment.",
        whatToDo: "Ask your workspace administrator to enable the loops feature flag.",
      };
    case "sandbox_unavailable":
      return {
        whatHappened: "The run's execution sandbox couldn't be started.",
        whatToDo: "Retry the run. If it keeps failing, check the step log for details.",
      };
    case "workflow_failed":
      return {
        whatHappened:
          "A step timed out or ran out of retries before it could finish.",
        whatToDo: "Retry the run, or open the builder to adjust step limits.",
      };
    case "step_output_invalid":
      return {
        whatHappened:
          "A step produced output that didn't match the expected shape.",
        whatToDo: "Open the builder and check that step's expected output format.",
      };
    case "checks_failed":
      return {
        whatHappened: "Required GitHub checks did not pass for this step's changes.",
        whatToDo: "Review the failing checks on GitHub, then retry once they're fixed.",
      };
    case "commit_failed":
      return {
        whatHappened: "The step couldn't commit or push its changes.",
        whatToDo: "Check repository permissions and branch protection rules, then retry.",
      };
    case "guardrail_exceeded":
      return {
        whatHappened: "The run hit one of its configured guardrail limits.",
        whatToDo: "Open the builder to review or raise the guardrail limits for this loop.",
      };
    case "chain_route_missing":
      return {
        whatHappened: "The loop's step chain has no route for this outcome.",
        whatToDo: "Open the builder and add a route for this condition.",
      };
    case "condition_path_missing":
      return {
        whatHappened: "A condition step referenced a field that wasn't present in the data.",
        whatToDo: "Open the builder and check that condition's field path.",
      };
    case "condition_type_mismatch":
      return {
        whatHappened: "A condition step compared values of different types.",
        whatToDo: "Open the builder and check that condition's comparison.",
      };
    case "github_check_failed":
      return {
        whatHappened: "A GitHub check step could not be completed.",
        whatToDo: "Check the repository's GitHub Actions/checks configuration, then retry.",
      };
    case "step_failed":
      return {
        whatHappened: "A step in this run failed.",
        whatToDo: "Check the step log for details, then retry the run.",
      };
    case "stall_sweep":
      return {
        whatHappened: "No activity was seen for a while — the run appears stuck.",
        whatToDo: "Retry the run, or check the step log for what it was last doing.",
      };
    case "retry_conflict":
      return {
        whatHappened: "Someone else already retried this run.",
        whatToDo: "Refresh the page to see the latest attempt.",
      };
    default: {
      // Exhaustiveness guard: if a new kind is added to
      // ALL_KNOWN_LOOP_ERROR_KINDS without a case above, this fails to compile.
      const _exhaustive: never = kind;
      throw new Error(`Unhandled known loop error kind: ${_exhaustive}`);
    }
  }
}

function isKnownKind(kind: string): kind is KnownLoopErrorKind {
  return (ALL_KNOWN_LOOP_ERROR_KINDS as readonly string[]).includes(kind);
}

/**
 * Returns plain-language copy for a loop errorKind. Unknown kinds get an
 * honest generic message; the raw kind is always returned separately for a
 * details disclosure. `errorMessage`, if passed, is NEVER read into the
 * returned copy — it exists only so callers remember not to pass it through;
 * use `sanitizeErrorDetail` separately for the disclosure.
 */
export function getLoopErrorCopy(
  kind: string,
  _context?: { errorMessage?: string | null },
): LoopErrorCopy {
  if (isKnownKind(kind)) {
    return { ...knownCopy(kind), isKnown: true, rawKind: kind };
  }
  return {
    whatHappened: "Something went wrong that we don't have specific guidance for yet.",
    whatToDo:
      "Check the technical details below, retry the run, or check the step log.",
    isKnown: false,
    rawKind: kind,
  };
}

const MAX_DETAIL_LENGTH = 500;

/** Patterns for common secret-shaped tokens that must never leak into the UI. */
const SECRET_PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /ghu_[A-Za-z0-9]{20,}/g,
  /ghs_[A-Za-z0-9]{20,}/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /Bearer\s+[A-Za-z0-9._-]{16,}/gi,
];

/**
 * Sanitizes and truncates a raw errorMessage for display ONLY inside a
 * collapsible technical-details disclosure (operator-facing). Redacts
 * common secret-shaped substrings and caps length so a runaway message
 * can't blow out the layout or leak more than a bounded amount of internals.
 */
export function sanitizeErrorDetail(raw: string): string {
  let sanitized = raw;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[redacted]");
  }
  if (sanitized.length > MAX_DETAIL_LENGTH) {
    return `${sanitized.slice(0, MAX_DETAIL_LENGTH)}…`;
  }
  return sanitized;
}
