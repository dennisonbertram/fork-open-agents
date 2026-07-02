import "server-only";

import type { ToolSet } from "ai";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db/client";
import { backgroundAgentToolSessions } from "@/lib/db/schema";
import { getComposioConfig } from "@/lib/composio/config";
import { getComposioClient } from "@/lib/composio/client";
import { toComposioUserId } from "@/lib/composio/user-id";
import { resolveComposioToolsForToolkitList } from "@/lib/composio/resolve-toolkit-list";
import { redactComposioErrorMessage } from "@/lib/composio/errors";
import {
  getRepositoryComposioSettings,
  getRepositoryComposioSettingsValues,
} from "@/lib/db/composio";

// ---------------------------------------------------------------------------
// Internal: connected-account fetch (mirrors composio/session.ts)
// ---------------------------------------------------------------------------

async function fetchConnectedAccountsByToolkit(
  composio: ReturnType<typeof getComposioClient>,
  userId: string,
): Promise<Record<string, string[]>> {
  const response = await composio.connectedAccounts.list({
    userIds: [toComposioUserId(userId)],
    statuses: ["ACTIVE"],
  });

  const items: unknown[] = Array.isArray(
    (response as { items?: unknown }).items,
  )
    ? (response as { items: unknown[] }).items
    : [];

  const result: Record<string, string[]> = {};
  for (const item of items) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).id !== "string"
    ) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = record.id as string;

    const toolkit = record.toolkit;
    let slug: string | null = null;
    if (
      typeof toolkit === "object" &&
      toolkit !== null &&
      typeof (toolkit as Record<string, unknown>).slug === "string"
    ) {
      slug = (toolkit as Record<string, unknown>).slug as string;
    } else if (typeof record.toolkitSlug === "string") {
      slug = record.toolkitSlug;
    }

    if (!slug) continue;

    const existing = result[slug];
    if (existing) {
      existing.push(id);
    } else {
      result[slug] = [id];
    }
  }

  return result;
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
// Repo-policy slug filter
// ---------------------------------------------------------------------------

/**
 * Filters the provided toolkit slugs through the repository's blocked-toolkit
 * list. Returns only slugs that the repository policy permits.
 *
 * Mirrors the slug-level gate in applyRepositoryComposioPolicy (composio/db.ts).
 */
async function filterSlugsByRepoPolicy(params: {
  userId: string;
  slugs: string[];
  repoOwner: string;
  repoName: string;
}): Promise<string[]> {
  const settings = await getRepositoryComposioSettings({
    userId: params.userId,
    repoOwner: params.repoOwner,
    repoName: params.repoName,
  });
  const settingsValues = getRepositoryComposioSettingsValues(settings);
  if (!settingsValues) {
    // No repo policy configured — all slugs are allowed
    return params.slugs;
  }

  const blockedSlugs = new Set(
    settingsValues.blockedToolkitSlugs.map((s) => s.toLowerCase()),
  );

  return params.slugs.filter((slug) => !blockedSlugs.has(slug.toLowerCase()));
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

/**
 * errorKind taxonomy this resolver can actually produce today.
 *
 * Scoped intentionally: the full cross-surface taxonomy (e.g.
 * "composio_auth_expired") belongs to the honest-connection-state ticket
 * (#800). This resolver only ever hits "composio_missing_api_key" (config
 * gate) or "composio_unknown" (SDK/network failure in the catch block).
 */
export type ResolveComposioToolsForBgRunErrorKind =
  | "composio_missing_api_key"
  | "composio_unknown";

/**
 * Reasons the resolver can report an "off" (no tools) outcome.
 *
 * The union is intentionally extensible: the repo-policy ticket (#799) adds
 * "not_in_repo_allowlist" when a non-null repo allowlist drops slugs.
 */
export type ResolveComposioToolsForBgRunOffReason =
  | "no_slugs_selected"
  | "repo_policy_blocked";

export type ResolveComposioToolsForBgRunResult =
  | {
      status: "ready";
      tools: ToolSet;
      toolkitSlugs: string[];
      /**
       * Selected toolkits with no ACTIVE connected account, threaded from
       * resolveComposioToolsForToolkitList instead of being discarded.
       */
      disconnectedToolkits: string[];
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
 * - Repo policy blocks every requested slug → { status: "off",
 *   reason: "repo_policy_blocked", blockedSlugs } (surviving slugs, if any,
 *   proceed to resolution below).
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

  // Gate by repo policy (blocked toolkit slugs)
  const gatedSlugs = await filterSlugsByRepoPolicy({
    userId,
    slugs,
    repoOwner,
    repoName,
  });

  if (gatedSlugs.length === 0) {
    return {
      status: "off",
      reason: "repo_policy_blocked",
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
    const connectedAccountIdsByToolkit = await fetchConnectedAccountsByToolkit(
      composio,
      userId,
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

    return {
      status: "ready",
      tools: resolved.tools,
      toolkitSlugs: gatedSlugs,
      disconnectedToolkits: resolved.disconnectedToolkits ?? [],
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
