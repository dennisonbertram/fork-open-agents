/**
 * Pure state-derivation functions for the honest connect flow (#801, epic
 * #796 T5, findings C1/W7).
 *
 * These are the testable core of `useComposioConnect` — kept dependency-free
 * (no `window`, no `fetch`, no React) so the popup-block detection and
 * poll-to-ACTIVE/timeout contract can be unit-tested without a DOM, matching
 * the split already used by `use-background-run-polling.ts`
 * (`computeBackgroundRunRefreshInterval` is pure; the SWR-driven hook shell
 * around it is not separately unit-tested).
 */

/** Outcome of attempting to open the OAuth popup/tab. */
export type PopupOutcome = "connecting" | "blocked";

/**
 * Derives whether a `window.open(...)` call actually produced a usable
 * window. Browsers signal a blocked popup either by returning `null`
 * (`window.open` result) or — depending on blocker implementation — by
 * returning a `Window` object that is already `.closed` immediately after
 * the call. Both must be treated as "blocked", never as "connecting" (the
 * honest-UX contract requires a visible, actionable message rather than
 * silently doing nothing).
 */
export function derivePopupOutcome(
  popupWindow: Window | null | undefined,
): PopupOutcome {
  if (!popupWindow || popupWindow.closed) {
    return "blocked";
  }
  return "connecting";
}

/** Outcome of a single poll tick against /api/composio/connected-accounts. */
export type ConnectPollOutcome = "confirmed" | "pending" | "timed_out";

export interface DeriveConnectPollOutcomeParams {
  /** The toolkit slug the user is connecting. */
  slug: string;
  /** slug -> status map, as built by buildToolkitStatusMap. */
  statusMap: Map<string, string>;
  /** True when the connected-accounts fetch itself failed this tick. */
  unavailable: boolean;
  /** Milliseconds elapsed since the connect attempt started. */
  elapsedMs: number;
  /** Milliseconds after which an unconfirmed connect gives up waiting. */
  timeoutMs: number;
}

/**
 * Derives the honest connect-poll outcome for a single tick.
 *
 * Priority order matters for honesty:
 * 1. ACTIVE always wins, even past the timeout boundary — if the connection
 *    genuinely completed, a slow final tick must still report success, not a
 *    stale timeout race.
 * 2. Otherwise, once elapsed >= timeout, the outcome is "timed_out" — never
 *    "error" (a timeout is not necessarily a failure; Composio's own OAuth
 *    step may simply be slow) and never "confirmed" (no optimistic success).
 * 3. Otherwise "pending" — including when the connected-accounts fetch
 *    itself failed (`unavailable: true`) this tick. A single failed status
 *    check must never be misread as either a false "confirmed" or an early
 *    "timed_out" — it just means try again next tick, same as if the target
 *    slug were simply not yet ACTIVE.
 */
export function deriveConnectPollOutcome(
  params: DeriveConnectPollOutcomeParams,
): ConnectPollOutcome {
  const status = params.statusMap.get(params.slug);
  if (status === "ACTIVE") {
    return "confirmed";
  }
  if (params.elapsedMs >= params.timeoutMs) {
    return "timed_out";
  }
  return "pending";
}
