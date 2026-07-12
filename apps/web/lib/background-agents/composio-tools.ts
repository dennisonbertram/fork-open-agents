import "server-only";

import type { ToolSet } from "ai";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { backgroundAgentToolSessions } from "@/lib/db/schema";
import { getComposioConfig } from "@/lib/composio/config";
import { getComposioClient } from "@/lib/composio/client";
import { resolveComposioToolsForToolkitList } from "@/lib/composio/resolve-toolkit-list";
import { redactComposioErrorMessage } from "@/lib/composio/errors";
import {
  listComposioConnectedAccounts,
  type ComposioConnectedAccount,
} from "@/lib/composio/connected-accounts";
import { applyRepoToolkitPolicy } from "@/lib/composio/repo-policy";

// ---------------------------------------------------------------------------
// Internal: connected-account state (shared helper — full status, one fetch)
// ---------------------------------------------------------------------------

/**
 * Fetches the user's full-status connected accounts once (via the shared
 * `connected-accounts` helper — the ONE place that calls
 * `connectedAccounts.list`) and derives both:
 * - `connectedAccountIdsByToolkit`: ACTIVE-only ids grouped by toolkit slug,
 *   for session-building (existing behavior — only ACTIVE accounts
 *   authenticate).
 * - `accountsByToolkit`: the full-status accounts grouped by toolkit slug,
 *   used to compute expiredToolkits below.
 */
async function resolveConnectedAccountState(
  composio: ReturnType<typeof getComposioClient>,
  userId: string,
): Promise<{
  connectedAccountIdsByToolkit: Record<string, string[]>;
  accountsByToolkit: Record<string, ComposioConnectedAccount[]>;
}> {
  const accounts = await listComposioConnectedAccounts({ composio, userId });

  const connectedAccountIdsByToolkit: Record<string, string[]> = {};
  const accountsByToolkit: Record<string, ComposioConnectedAccount[]> = {};
  for (const account of accounts) {
    const existingGroup = accountsByToolkit[account.toolkitSlug];
    if (existingGroup) {
      existingGroup.push(account);
    } else {
      accountsByToolkit[account.toolkitSlug] = [account];
    }

    if (account.status !== "ACTIVE") {
      continue;
    }
    const existingIds = connectedAccountIdsByToolkit[account.toolkitSlug];
    if (existingIds) {
      existingIds.push(account.id);
    } else {
      connectedAccountIdsByToolkit[account.toolkitSlug] = [account.id];
    }
  }

  return { connectedAccountIdsByToolkit, accountsByToolkit };
}

/**
 * Selected toolkit slugs whose accounts exist (at least one) but are ALL
 * status EXPIRED — distinct from "zero accounts at all" (which
 * resolveComposioToolsForToolkitList already reports via
 * disconnectedToolkits). (#800)
 */
function computeExpiredToolkits(
  slugs: string[],
  accountsByToolkit: Record<string, ComposioConnectedAccount[]>,
): string[] {
  return slugs.filter((slug) => {
    const accountsForSlug = accountsByToolkit[slug];
    if (!accountsForSlug || accountsForSlug.length === 0) {
      return false;
    }
    return accountsForSlug.every((account) => account.status === "EXPIRED");
  });
}

// ---------------------------------------------------------------------------
// Cache helpers backed by backgroundAgentToolSessions
// ---------------------------------------------------------------------------

async function getBgRunToolSession(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  configHash: string;
}): Promise<
  import("@/lib/composio/resolve-toolkit-list").ToolkitListCacheRow | null
> {
  const row = await db.query.backgroundAgentToolSessions.findFirst({
    where: and(
      eq(backgroundAgentToolSessions.runId, params.runId),
      eq(backgroundAgentToolSessions.userId, params.userId),
      eq(backgroundAgentToolSessions.configHash, params.configHash),
    ),
  });
  if (!row) return null;

  // Map from backgroundAgentToolSessions schema to the ToolkitListCacheRow shape.
  // providerSessionId in this table corresponds to composioSessionId in the cache.
  return {
    id: row.id,
    composioSessionId: row.providerSessionId ?? "",
  };
}

async function upsertBgRunToolSession(params: {
  runId: string;
  agentId: string | null;
  userId: string;
  composioSessionId: string;
  configHash: string;
}): Promise<{ id: string }> {
  const now = new Date();
  const [row] = await db
    .insert(backgroundAgentToolSessions)
    .values({
      id: nanoid(),
      runId: params.runId,
      agentId: params.agentId ?? null,
      userId: params.userId,
      provider: "composio",
      profileId: "direct",
      agentRole: "main",
      phase: "always",
      providerSessionId: params.composioSessionId,
      configHash: params.configHash,
      status: "ready",
      createdAt: now,
      lastUsedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: backgroundAgentToolSessions.id });

  return { id: row?.id ?? nanoid() };
}

async function touchBgRunToolSession(id: string): Promise<void> {
  await db
    .update(backgroundAgentToolSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(backgroundAgentToolSessions.id, id));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ResolveComposioToolsForBgRunParams = {
  agentId: string | null;
  runId: string;
  userId: string;
  /** Toolkit slugs declared on the background agent row. Empty = no tools. */
  slugs: string[];
  repoOwner: string;
  repoName: string;
};

export class ComposioRepoPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioRepoPolicyError";
  }
}

/**
 * Rechecks the live repository policy immediately before a cached Composio
 * tool executes. This intentionally does not resolve accounts or provider
 * sessions again: it is a cheap revocation check over the toolkits that were
 * already admitted when the ToolSet was created.
 */
export async function assertComposioRepoToolkitsStillAllowed(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
  toolkitSlugs: string[];
}): Promise<void> {
  let policyResult: Awaited<ReturnType<typeof applyRepoToolkitPolicy>>;
  try {
    policyResult = await applyRepoToolkitPolicy({
      userId: params.userId,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      requestedSlugs: params.toolkitSlugs,
    });
  } catch {
    throw new ComposioRepoPolicyError(
      "Repository Composio policy could not be verified.",
    );
  }

  if (policyResult.blocked.length > 0) {
    const revoked = policyResult.blocked.map(({ slug }) => slug).sort();
    throw new ComposioRepoPolicyError(
      `Repository policy revoked Composio toolkit access: ${revoked.join(", ")}.`,
    );
  }
}

/**
 * errorKind taxonomy this resolver can actually produce today.
 *
 * "composio_missing_api_key" (config gate) and "composio_unknown"
 * (SDK/network failure in the catch block) are the two kinds this resolver's
 * control flow can currently reach. The full cross-surface taxonomy lives in
 * `apps/web/lib/composio/errors.ts` (#800); this type is intentionally widened
 * to admit `composio_auth_expired` too so a future wiring of that path (e.g.
 * surfacing an auth-expiry failure as a typed "error" outcome rather than a
 * "ready" outcome with expiredToolkits) has a slot without another type
 * change — but no code path in this file returns it today. Callers must not
 * assume this union is exhaustively reachable end-to-end yet.
 */
export type ResolveComposioToolsForBgRunErrorKind =
  | "composio_missing_api_key"
  | "composio_auth_expired"
  | "composio_unknown";

/**
 * Reasons the resolver can report an "off" (no tools) outcome.
 *
 * The union is intentionally extensible: the repo-policy ticket (#799) adds
 * "not_in_repo_allowlist" when a non-null repo allowlist drops every
 * requested slug.
 */
export type ResolveComposioToolsForBgRunOffReason =
  | "no_slugs_selected"
  | "repo_policy_blocked"
  | "not_in_repo_allowlist";

export type ResolveComposioToolsForBgRunResult =
  | {
      status: "ready";
      tools: ToolSet;
      toolkitSlugs: string[];
      /**
       * Selected toolkits with no connected account at all, threaded from
       * resolveComposioToolsForToolkitList instead of being discarded.
       */
      disconnectedToolkits: string[];
      /**
       * Selected toolkits whose connected account(s) exist but are ALL
       * status EXPIRED (none ACTIVE) — distinct from disconnectedToolkits
       * (zero accounts at all). Computed from the same shared
       * connected-accounts fetch as disconnectedToolkits/
       * connectedAccountIdsByToolkit, not a second SDK round-trip. (#800)
       */
      expiredToolkits: string[];
    }
  | {
      status: "off";
      reason: ResolveComposioToolsForBgRunOffReason;
      /** Present only when reason is "repo_policy_blocked". */
      blockedSlugs?: string[];
    }
  | {
      status: "error";
      errorKind: ResolveComposioToolsForBgRunErrorKind;
      /**
       * Redacted, user-safe message. Never includes raw SDK error text that
       * could contain account identifiers or tokens.
       */
      message: string;
    };

/**
 * Resolve Composio tools for a background agent run.
 *
 * - Empty slugs → { status: "off", reason: "no_slugs_selected" }.
 * - Repo policy (allowlist + denylist, via the shared applyRepoToolkitPolicy
 *   resolver, #799) blocks every requested slug → { status: "off", reason,
 *   blockedSlugs } (surviving slugs, if any, proceed to resolution below).
 *   reason is "repo_policy_blocked" if any dropped slug was denylisted
 *   (denylist wins on overlap), else "not_in_repo_allowlist" when every drop
 *   was purely an allowlist miss.
 * - Uses backgroundAgentToolSessions as the per-run cache (not the chat cache).
 * - Never logs secrets or API keys.
 */
export async function resolveComposioToolsForBgRun(
  params: ResolveComposioToolsForBgRunParams,
): Promise<ResolveComposioToolsForBgRunResult> {
  const { agentId, runId, userId, slugs, repoOwner, repoName } = params;

  if (slugs.length === 0) {
    return { status: "off", reason: "no_slugs_selected" };
  }

  // Gate by repo policy (allowlist + denylist, shared resolver — #799)
  const policyResult = await applyRepoToolkitPolicy({
    userId,
    repoOwner,
    repoName,
    requestedSlugs: slugs,
  });
  const gatedSlugs = policyResult.allowed;

  if (gatedSlugs.length === 0) {
    const anyDenylisted = policyResult.blocked.some(
      (b) => b.reason === "repo_policy_blocked",
    );
    return {
      status: "off",
      reason: anyDenylisted ? "repo_policy_blocked" : "not_in_repo_allowlist",
      blockedSlugs: slugs,
    };
  }

  const config = getComposioConfig();
  if (!config.configured) {
    return {
      status: "error",
      errorKind: "composio_missing_api_key",
      message:
        "Composio tools selected but COMPOSIO_API_KEY is not configured.",
    };
  }

  try {
    const composio = getComposioClient();
    const { connectedAccountIdsByToolkit, accountsByToolkit } =
      await resolveConnectedAccountState(composio, userId);
    const expiredToolkits = computeExpiredToolkits(
      gatedSlugs,
      accountsByToolkit,
    );

    const resolved = await resolveComposioToolsForToolkitList({
      userId,
      slugs: gatedSlugs,
      composio,
      connectedAccountIdsByToolkit,
      getCachedSession: (configHash) =>
        getBgRunToolSession({ runId, agentId, userId, configHash }),
      upsertSession: ({ composioSessionId, configHash }) =>
        upsertBgRunToolSession({
          runId,
          agentId,
          userId,
          composioSessionId,
          configHash,
        }),
      touchSession: (id) => touchBgRunToolSession(id),
    });

    if (resolved.status !== "ready") {
      // Unreachable in practice: gatedSlugs.length > 0 is already guaranteed
      // above, and resolveComposioToolsForToolkitList only returns "off" for
      // an empty slug list. Kept as a defensive fallback so this function
      // always returns a typed outcome even if that invariant changes.
      return {
        status: "off",
        reason: "repo_policy_blocked",
        blockedSlugs: [],
      };
    }

    // A toolkit with only EXPIRED accounts still has SOME account, so it
    // must not double-count in disconnectedToolkits (zero accounts at all)
    // — expiredToolkits and disconnectedToolkits are mutually exclusive from
    // the caller's point of view (#800).
    const expiredSet = new Set(expiredToolkits);
    const disconnectedToolkits = (resolved.disconnectedToolkits ?? []).filter(
      (slug) => !expiredSet.has(slug),
    );

    return {
      status: "ready",
      tools: resolved.tools,
      toolkitSlugs: gatedSlugs,
      disconnectedToolkits,
      expiredToolkits,
    };
  } catch (error) {
    // Redacted, user-safe message — never includes raw SDK error text that
    // might contain account identifiers or tokens.
    const rawMessage =
      error instanceof Error
        ? error.message
        : "Composio tool resolution failed.";
    return {
      status: "error",
      errorKind: "composio_unknown",
      message: redactComposioErrorMessage(rawMessage),
    };
  }
}
