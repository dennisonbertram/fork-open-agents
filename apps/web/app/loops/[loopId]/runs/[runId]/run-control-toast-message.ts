/**
 * run-control-toast-message.ts — maps a run-control API error response
 * (pause/resume/cancel/retry) to the toast message shown to the user.
 *
 * The store's retry-conflict message ("... TOCTOU race — retry rejected",
 * store.ts) is an internal, developer-facing string — it must be humanized
 * at this UI surface rather than shown verbatim. Do NOT reword the store's
 * own error text; other tests pin it as-is.
 */

const DISPATCH_FAILED_MESSAGE =
  "Couldn't start the run — the execution backend rejected the dispatch. The run is marked failed; see the run page for details.";

const RETRY_CONFLICT_MESSAGE =
  "Someone else already retried this run — refresh to see the latest attempt.";

export type RunControlErrorBody = {
  message?: string;
  errorKind?: string;
};

/**
 * Returns the humanized toast message for a failed run-control `action`
 * (pause/resume/cancel/retry) given the API's error response body.
 */
export function getRunControlToastMessage(
  action: string,
  body: RunControlErrorBody,
): string {
  if (body.errorKind === "dispatch_failed") {
    return DISPATCH_FAILED_MESSAGE;
  }
  if (body.errorKind === "illegal_transition" && action === "retry") {
    return RETRY_CONFLICT_MESSAGE;
  }
  return body.message ?? `Failed to ${action} run`;
}
