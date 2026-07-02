import "server-only";

import { toComposioUserId } from "./user-id";

/**
 * Structural view of the Composio SDK client's `connectedAccounts.list` method
 * — the ONE shape this module depends on. Kept minimal (mirrors the pattern in
 * `resolve-toolkit-list.ts`'s `ComposioClientLike`) so the real `@composio/core`
 * client and lightweight test fakes are both structurally assignable without
 * importing the full SDK response type.
 *
 * Deliberately does NOT accept a `statuses` filter — this module always fetches
 * every status so callers can distinguish ACTIVE from EXPIRED/INITIATED/FAILED
 * instead of the SDK silently dropping non-ACTIVE accounts (the bug this
 * module replaces, per issue #800).
 */
export type ComposioConnectedAccountsClientLike = {
  connectedAccounts: {
    list: (params: { userIds: string[] }) => Promise<unknown>;
  };
};

export interface ComposioConnectedAccount {
  id: string;
  toolkitSlug: string;
  /**
   * The real status string returned by the SDK — "ACTIVE", "EXPIRED",
   * "INITIATED", "FAILED", or any other value Composio introduces. Never
   * narrowed to a hardcoded enum: an unrecognized status is preserved as-is
   * rather than silently dropped or coerced.
   */
  status: string;
  alias: string | null;
}

/**
 * Structural view of a single connected-account item from the SDK response.
 * SDK types vary across versions; we narrow defensively rather than trust a
 * specific shape.
 */
interface RawConnectedAccount {
  id?: string;
  status?: string;
  alias?: string | null;
  toolkit?: {
    slug?: string;
  };
  /** Some SDK versions expose the slug directly on the item. */
  toolkitSlug?: string;
}

function normalizeConnectedAccount(
  raw: unknown,
): ComposioConnectedAccount | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const item = raw as RawConnectedAccount;

  const id = typeof item.id === "string" ? item.id : null;
  if (!id) {
    return null;
  }

  const toolkitSlug =
    typeof item.toolkit?.slug === "string"
      ? item.toolkit.slug
      : typeof item.toolkitSlug === "string"
        ? item.toolkitSlug
        : null;

  if (!toolkitSlug) {
    return null;
  }

  return {
    id,
    toolkitSlug,
    status: typeof item.status === "string" ? item.status : "UNKNOWN",
    alias: typeof item.alias === "string" ? item.alias : null,
  };
}

/**
 * Narrows a `connectedAccounts.list()` response (unknown at the TS level,
 * and known to vary between a bare array and an `{ items: [...] }` wrapper
 * depending on SDK version/environment) into a raw item array.
 */
function extractRawItems(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }
  const items = (response as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * The ONE place that calls `composio.connectedAccounts.list(...)`.
 *
 * Fetches ALL of the user's connected accounts (every status — ACTIVE,
 * EXPIRED, INITIATED, FAILED, or anything else the SDK returns) and
 * normalizes both known response shapes (bare array or `{ items }`) into a
 * single account list. Malformed items (missing id or toolkit slug) are
 * defensively skipped.
 *
 * Does NOT catch/swallow a client throw — it propagates so callers can
 * distinguish "SDK call failed" from "SDK call succeeded, zero accounts".
 * Callers that need non-fatal degradation (e.g. `session.ts`,
 * `composio-tools.ts`) catch at their own call site; callers that need to
 * surface a distinguishable "unavailable" response (the connected-accounts
 * route) catch here too, at their own call site.
 */
export async function listComposioConnectedAccounts(params: {
  composio: ComposioConnectedAccountsClientLike;
  userId: string;
}): Promise<ComposioConnectedAccount[]> {
  const response = await params.composio.connectedAccounts.list({
    userIds: [toComposioUserId(params.userId)],
  });

  return extractRawItems(response)
    .map(normalizeConnectedAccount)
    .filter((account): account is ComposioConnectedAccount => account !== null);
}

/**
 * Convenience wrapper for callers that only ever needed ACTIVE connected
 * account IDs grouped by toolkit slug (today: `session.ts`'s direct-list path
 * and `composio-tools.ts`'s background-run resolution, both of which only
 * authenticate with ACTIVE accounts). Reuses the same underlying fetch/parse
 * as `listComposioConnectedAccounts` — never issues a second SDK call.
 */
export async function listActiveConnectedAccountIdsByToolkit(params: {
  composio: ComposioConnectedAccountsClientLike;
  userId: string;
}): Promise<Record<string, string[]>> {
  const accounts = await listComposioConnectedAccounts(params);

  const result: Record<string, string[]> = {};
  for (const account of accounts) {
    if (account.status !== "ACTIVE") {
      continue;
    }
    const existing = result[account.toolkitSlug];
    if (existing) {
      existing.push(account.id);
    } else {
      result[account.toolkitSlug] = [account.id];
    }
  }
  return result;
}
