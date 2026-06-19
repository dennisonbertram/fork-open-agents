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

export type ResolveComposioToolsForBgRunResult =
  | { status: "off" }
  | { status: "error"; error: string }
  | { status: "ready"; tools: ToolSet; toolkitSlugs: string[] };

/**
 * Resolve Composio tools for a background agent run.
 *
 * - Empty slugs → { status: "off" } (today's behavior, unchanged).
 * - Repo policy blocks a slug → that slug is excluded; if none remain → "off".
 * - Uses backgroundAgentToolSessions as the per-run cache (not the chat cache).
 * - Never logs secrets or API keys.
 */
export async function resolveComposioToolsForBgRun(
  params: ResolveComposioToolsForBgRunParams,
): Promise<ResolveComposioToolsForBgRunResult> {
  const { agentId, runId, userId, slugs, repoOwner, repoName } = params;

  if (slugs.length === 0) {
    return { status: "off" };
  }

  // Gate by repo policy (blocked toolkit slugs)
  const gatedSlugs = await filterSlugsByRepoPolicy({
    userId,
    slugs,
    repoOwner,
    repoName,
  });

  if (gatedSlugs.length === 0) {
    return { status: "off" };
  }

  const config = getComposioConfig();
  if (!config.configured) {
    return {
      status: "error",
      error: "Composio tools selected but COMPOSIO_API_KEY is not configured.",
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
      return { status: "off" };
    }

    return {
      status: "ready",
      tools: resolved.tools,
      toolkitSlugs: gatedSlugs,
    };
  } catch (error) {
    return {
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Composio tool resolution failed.",
    };
  }
}
