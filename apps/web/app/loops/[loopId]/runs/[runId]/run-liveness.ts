/**
 * getLoopRunLiveness — pure liveness classifier for the loop run-detail poll
 * (#880).
 *
 * Terminal statuses stop polling and render nothing. Active statuses render
 * "live" while a poll has succeeded recently, and "stalled" once the feed
 * has gone quiet for longer than staleAfterMs — so the UI never claims to
 * be refreshing when it demonstrably is not (the production wedge this
 * fixes: a hung poll fetch froze the page's snapshot while the footer kept
 * advertising "Refreshing every 2s").
 */

export const STALE_AFTER_MS = 15_000;

export type LoopRunLiveness =
  | { kind: "terminal" }
  | { kind: "live"; secondsSinceUpdate: number }
  | { kind: "stalled"; secondsSinceUpdate: number };

export function getLoopRunLiveness(args: {
  isActive: boolean;
  lastSuccessAtMs: number;
  nowMs: number;
  staleAfterMs?: number;
}): LoopRunLiveness {
  const { isActive, lastSuccessAtMs, nowMs } = args;
  const staleAfterMs = args.staleAfterMs ?? STALE_AFTER_MS;

  if (!isActive) {
    return { kind: "terminal" };
  }

  const delta = Math.max(0, nowMs - lastSuccessAtMs);
  const secondsSinceUpdate = Math.floor(delta / 1000);

  if (delta > staleAfterMs) {
    return { kind: "stalled", secondsSinceUpdate };
  }

  return { kind: "live", secondsSinceUpdate };
}
