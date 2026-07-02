import { createHash } from "crypto";
import type { ToolRouterCreateSessionConfig } from "@composio/core";
import { normalizeComposioToolkitSlugs } from "./types";

/** Re-exported so callers don't need to import from session.ts. */
export class ComposioDirectListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioDirectListError";
  }
}

/**
 * Builds a Composio session config from a direct list of toolkit slugs,
 * independent of any saved profile.
 *
 * One-wins rule: this function is only called when directToolkitSlugs is
 * non-empty. It normalizes the slugs, filters connectedAccounts to selected
 * toolkits only, and always disables manageConnections and workbench.
 */
export function buildComposioSessionConfigFromDirectList(params: {
  toolkitSlugs: string[];
  connectedAccountIdsByToolkit: Record<string, string[]>;
}): ToolRouterCreateSessionConfig {
  const normalized = normalizeComposioToolkitSlugs(params.toolkitSlugs);

  if (normalized.length === 0) {
    throw new ComposioDirectListError(
      "Direct toolkit list is empty after normalization.",
    );
  }

  const selectedSet = new Set(normalized);

  // Only include connectedAccounts for selected toolkits that have accounts.
  const connectedAccounts: Record<string, string[]> = {};
  for (const slug of normalized) {
    const ids = params.connectedAccountIdsByToolkit[slug];
    if (selectedSet.has(slug) && Array.isArray(ids) && ids.length > 0) {
      connectedAccounts[slug] = ids;
    }
  }

  const hasConnectedAccounts = Object.keys(connectedAccounts).length > 0;

  return {
    toolkits: normalized,
    ...(hasConnectedAccounts ? { connectedAccounts } : {}),
    manageConnections: false,
    workbench: { enable: false },
  };
}

/**
 * A stable SHA-256 hash of a sorted toolkit slug array plus a stable
 * representation of connected-account membership for those slugs, used as
 * configHash for the synthetic "direct" profile entry in the session cache.
 *
 * Incorporating connected-account state (issue #797 / finding G8) ensures a
 * user disconnecting, reconnecting, or having a token expire rotates the
 * cache key so a stale session (built against the old connected-account
 * state) is never reused. connectedAccountIdsByToolkit entries for slugs NOT
 * in toolkitSlugs are ignored — only accounts relevant to the selected
 * toolkits affect the hash.
 */
export function hashDirectConfig(
  toolkitSlugs: string[],
  connectedAccountIdsByToolkit: Record<string, string[]> = {},
): string {
  const sorted = [...toolkitSlugs].sort();
  const accountState = sorted.map((slug) => {
    const ids = connectedAccountIdsByToolkit[slug];
    const sortedIds = Array.isArray(ids) ? [...ids].sort() : [];
    return [slug, sortedIds] as const;
  });
  return createHash("sha256")
    .update(JSON.stringify({ slugs: sorted, accountState }))
    .digest("hex");
}
