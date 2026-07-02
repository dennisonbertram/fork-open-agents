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
 * Builds a slug -> status lookup from the full connected-accounts list. When
 * a toolkit has multiple accounts, the LAST one wins (matches existing
 * `Set`-based "has a connected account" semantics elsewhere in this file
 * tree, which also don't disambiguate multiple accounts per toolkit).
 */
export function buildToolkitStatusMap(
  accounts: ComposioConnectedAccount[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const account of accounts) {
    map.set(account.toolkitSlug, account.status);
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
