import type { ComposioConnectedAccount } from "@/app/api/composio/connected-accounts/route";

/**
 * The four distinguishable connection states a toolkit can render as,
 * per issue #800's honest-connection-states contract:
 * - "active": an ACTIVE connected account exists — the tool works.
 * - "expired": a connected account exists but is EXPIRED (or all known
 *   accounts for the slug are EXPIRED) — needs reconnecting.
 * - "not_connected": no connected account has ever been recorded for this
 *   toolkit.
 * - "other": a connected account exists in some other non-ACTIVE,
 *   non-EXPIRED status (e.g. INITIATED, FAILED) — treated distinctly from
 *   both "active" and "not_connected" so it isn't silently misrepresented
 *   as either.
 * - "unavailable": the connected-accounts fetch itself failed, so this
 *   toolkit's real state could not be determined (distinct from
 *   "not_connected" — the issue's honesty fix depends on never collapsing
 *   "can't check" into "definitely zero").
 */
export type ComposioToolkitConnectionState =
  | "active"
  | "expired"
  | "not_connected"
  | "other"
  | "unavailable";

/**
 * Priority order used to resolve multiple connected accounts for the same
 * toolkit slug into a single status. A toolkit with both an ACTIVE and an
 * EXPIRED account (the core reconnect scenario — the user just reconnected
 * and the old expired account hasn't been cleaned up yet) must always
 * report ACTIVE: the connection genuinely works, regardless of what order
 * the SDK happened to list the accounts in.
 */
const STATUS_PRIORITY: readonly string[] = ["ACTIVE", "EXPIRED"];

/**
 * Builds a slug -> status lookup from the full connected-accounts list.
 *
 * When a toolkit has multiple accounts, this aggregates by priority instead
 * of last-write-wins: any ACTIVE account makes the toolkit ACTIVE; failing
 * that, any EXPIRED account makes it EXPIRED; otherwise the last-seen status
 * is kept (there is no meaningful priority among the remaining statuses,
 * e.g. INITIATED vs FAILED, so this preserves the account exactly as before
 * for the true single-status-of-that-kind case, rather than dropping it).
 * This makes the result deterministic regardless of the SDK response's
 * array order (issue #800 P2-B, Codex review on PR #826).
 */
export function buildToolkitStatusMap(
  accounts: ComposioConnectedAccount[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const account of accounts) {
    const existing = map.get(account.toolkitSlug);
    if (existing === undefined) {
      map.set(account.toolkitSlug, account.status);
      continue;
    }

    const existingPriority = STATUS_PRIORITY.indexOf(existing);
    const nextPriority = STATUS_PRIORITY.indexOf(account.status);

    // Lower index = higher priority; -1 (not in the priority list) always
    // loses to a status that IS in the list. Between two non-priority
    // statuses, keep the later one (unchanged pre-fix behavior for that
    // case — there's no meaningful ranking among them).
    const existingRank = existingPriority === -1 ? Infinity : existingPriority;
    const nextRank = nextPriority === -1 ? Infinity : nextPriority;

    if (nextRank < existingRank) {
      map.set(account.toolkitSlug, account.status);
    } else if (nextRank === Infinity && existingRank === Infinity) {
      map.set(account.toolkitSlug, account.status);
    }
  }
  return map;
}

/**
 * Derives the four-state connection state for a single toolkit slug.
 *
 * `unavailable` only wins when the slug has no known status from a
 * (possibly earlier, cached) successful fetch — if we already know a
 * toolkit's real status, a subsequent failed re-fetch must not regress a
 * known "active"/"expired"/"other" state back to "can't check right now".
 */
export function getToolkitConnectionState(params: {
  slug: string;
  statusMap: Map<string, string>;
  unavailable: boolean;
}): ComposioToolkitConnectionState {
  const status = params.statusMap.get(params.slug);

  if (status === "ACTIVE") {
    return "active";
  }
  if (status === "EXPIRED") {
    return "expired";
  }
  if (status) {
    return "other";
  }

  return params.unavailable ? "unavailable" : "not_connected";
}

/**
 * Whether a selected toolkit chip should render with "problem" (amber
 * warning) styling. Only states that actually need the user's attention are
 * flagged — "active" is a healthy, working connection and must render
 * unflagged even though it is still a non-null connection state (issue
 * #800 P2-A, Codex review on PR #826: the previous `Boolean(connectionState)`
 * check flagged every non-null state, including "active").
 */
export function isToolkitChipFlagged(params: {
  unknown: boolean;
  connectionState: ComposioToolkitConnectionState | null;
}): boolean {
  if (params.unknown) {
    return true;
  }
  return params.connectionState !== null && params.connectionState !== "active";
}
