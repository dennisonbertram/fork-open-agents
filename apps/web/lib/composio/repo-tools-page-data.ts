import "server-only";

import { getComposioClient } from "./client";
import { getComposioConfig } from "./config";
import { listComposioConnectedAccounts } from "./connected-accounts";
import { applyRepoToolkitPolicy } from "./repo-policy";
import { fetchComposioToolkitCatalog } from "./toolkit-catalog";
import { prettifyToolkitSlug } from "./chat-tool-summary";
import {
  deriveRepoToolkitEffectiveStatuses,
  type RepoToolkitEffectiveStatus,
} from "./repo-tools-effective-status";
import {
  buildToolkitStatusMap,
  getToolkitConnectionState,
  type ComposioToolkitConnectionState,
} from "@/app/settings/composio-connection-state";
import {
  getRepositoryComposioSettings,
  getRepositoryComposioSettingsValues,
} from "@/lib/db/composio";

/**
 * Server-side data loader for the repo Tools surface (#805, epic #796 T9).
 *
 * Composes, in order:
 * 1. The relevant toolkit set — the platform catalog, unioned with any slug
 *    already referenced in this repo's blockedToolkitSlugs/
 *    selectedToolkitSlugs (so a pre-emptively blocked or previously-selected
 *    toolkit that has since left the catalog still appears — never silently
 *    dropped).
 * 2. applyRepoToolkitPolicy over that full slug set — the ONE policy
 *    authority (#799). This module never re-implements allow/block logic.
 * 3. Connection state via listComposioConnectedAccounts +
 *    buildToolkitStatusMap/getToolkitConnectionState (#800) — the ONE
 *    connection-honesty authority. This module never re-implements
 *    ACTIVE/EXPIRED/not-connected detection.
 * 4. deriveRepoToolkitEffectiveStatuses composes (2) and (3) into one
 *    effective status per toolkit.
 *
 * Degrades sanely when Composio isn't configured or an SDK call fails: an
 * empty toolkit catalog or a failed connected-accounts fetch does not throw
 * — every requested slug still gets a status ("not_connected" when
 * connection state can't be determined, rather than crashing the repo
 * dashboard render).
 *
 * Codex P2-3 (PR #848): the catalog's `noAuth` flag is threaded through to
 * `deriveRepoToolkitEffectiveStatuses` as `noAuthSlugs` — a no-auth toolkit
 * (works without a connected account) must never render "not_connected"
 * merely because it has no connected-account row.
 */
export async function getRepoToolsEffectiveStatuses(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
}): Promise<RepoToolkitEffectiveStatus[]> {
  const { userId, repoOwner, repoName } = params;

  const [catalogResult, settings] = await Promise.all([
    fetchComposioToolkitCatalog(),
    getRepositoryComposioSettings({ userId, repoOwner, repoName }),
  ]);
  const settingsValues = getRepositoryComposioSettingsValues(settings);

  const catalogToolkits = catalogResult.ok ? catalogResult.toolkits : [];
  const namesBySlug: Record<string, string> = Object.fromEntries(
    catalogToolkits.map((toolkit) => [toolkit.slug, toolkit.name]),
  );
  // Codex P2-3: preserve the catalog's noAuth flag per slug so the
  // derivation can skip the connection check for toolkits that are usable
  // without a connected account.
  const noAuthSlugs = new Set(
    catalogToolkits.filter((toolkit) => toolkit.noAuth).map((t) => t.slug),
  );

  // Union: catalog slugs + any slug already referenced by this repo's policy
  // (blocked or selected) even if it fell out of (or never was in) the
  // catalog — never silently drop a configured toolkit from the surface.
  const slugSet = new Set(catalogToolkits.map((toolkit) => toolkit.slug));
  for (const slug of settingsValues?.blockedToolkitSlugs ?? []) {
    slugSet.add(slug);
  }
  for (const slug of settingsValues?.selectedToolkitSlugs ?? []) {
    slugSet.add(slug);
  }
  const toolkitSlugs = Array.from(slugSet);

  for (const slug of toolkitSlugs) {
    if (!namesBySlug[slug]) {
      namesBySlug[slug] = prettifyToolkitSlug(slug);
    }
  }

  if (toolkitSlugs.length === 0) {
    return [];
  }

  const [policyResult, connectionStateBySlug] = await Promise.all([
    applyRepoToolkitPolicy({
      userId,
      repoOwner,
      repoName,
      requestedSlugs: toolkitSlugs,
    }),
    getConnectionStateBySlug(userId),
  ]);

  return deriveRepoToolkitEffectiveStatuses({
    toolkitSlugs,
    namesBySlug,
    selectedToolkitSlugs: settingsValues?.selectedToolkitSlugs ?? null,
    policyResult,
    connectionStateBySlug,
    noAuthSlugs,
  });
}

/**
 * Fetches connected accounts and reduces them to a per-slug connection
 * state map, tolerating a missing Composio configuration (treated as "no
 * known state" — every slug falls through to not_connected downstream,
 * matching `/api/composio/connected-accounts`'s configured:false
 * short-circuit) or an SDK failure (same fallback — this loader's job is to
 * never crash the repo dashboard render on a Composio outage).
 */
async function getConnectionStateBySlug(
  userId: string,
): Promise<Map<string, ComposioToolkitConnectionState>> {
  if (!getComposioConfig().configured) {
    return new Map();
  }

  try {
    const accounts = await listComposioConnectedAccounts({
      composio: getComposioClient(),
      userId,
    });
    const statusMap = buildToolkitStatusMap(accounts);
    const result = new Map<string, ComposioToolkitConnectionState>();
    for (const slug of statusMap.keys()) {
      result.set(
        slug,
        getToolkitConnectionState({ slug, statusMap, unavailable: false }),
      );
    }
    return result;
  } catch {
    return new Map();
  }
}
