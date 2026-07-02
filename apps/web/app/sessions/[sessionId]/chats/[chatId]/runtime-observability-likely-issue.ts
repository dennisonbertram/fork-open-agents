import {
  getComposioUserFacingError,
  redactComposioErrorMessage,
} from "@/lib/composio/errors";
import type { SessionEventJson } from "./hooks/use-session-observability";

/**
 * Selects the "Likely Issue" card's summary text for a given event.
 *
 * Typed Composio-tool-resolution failures (chat/session/background-agent
 * paths) already set `summary` to a final, specific, actionable message
 * (e.g. "Blocked toolkit for this repository: gmail.") — this must be
 * rendered verbatim, not re-derived via getComposioUserFacingError, which
 * re-classifies from scratch and can downgrade it to a more generic message
 * (the double-wrap bug, issue #800). We only fall back to
 * getComposioUserFacingError when the event carries no usable summary at
 * all (empty/nullish) — a legacy/generic composio event without a finished
 * message.
 *
 * Non-composio issues keep using the existing generic
 * (redaction-only) normalization.
 */
export function selectLikelyIssueSummary(
  issueEvent: SessionEventJson,
  isComposioIssue: boolean,
): string {
  if (!isComposioIssue) {
    return redactComposioErrorMessage(
      issueEvent.summary ?? issueEvent.eventName,
    );
  }

  if (issueEvent.summary && issueEvent.summary.trim().length > 0) {
    return redactComposioErrorMessage(issueEvent.summary);
  }

  return getComposioUserFacingError(issueEvent.summary ?? issueEvent.eventName);
}
