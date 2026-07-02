import "server-only";

import type { ToolSet } from "ai";
import type { ToolRouterCreateSessionConfig } from "@composio/core";
import {
  buildComposioSessionConfigFromDirectList,
  hashDirectConfig,
} from "./direct-list-config";
import { toComposioUserId } from "./user-id";
import type { ResolvedComposioTools } from "./session";

export type ToolkitListCacheRow = {
  id: string;
  composioSessionId: string;
};

type ComposioClientLike = {
  create: (
    userId: string,
    config: ToolRouterCreateSessionConfig,
  ) => Promise<{ sessionId: string; tools: () => Promise<ToolSet> }>;
  use: (sessionId: string) => Promise<{ tools: () => Promise<ToolSet> }>;
  /**
   * Toolkit metadata lookup, used to detect toolkits that don't require a
   * connected account (finding G9) so they are never falsely reported as
   * disconnected. Optional so existing lightweight test fakes that don't
   * exercise the no-auth path keep compiling.
   */
  toolkits?: {
    get: (slug: string) => Promise<{ noAuth?: boolean }>;
  };
};

export type ResolveComposioToolsForToolkitListParams = {
  /** Application userId (not yet Composio-prefixed). */
  userId: string;
  /** Toolkit slugs selected for this resolution. Empty → { status: "off" }. */
  slugs: string[];
  /** Composio SDK client (already constructed and configured). */
  composio: ComposioClientLike;
  /** Connected account IDs grouped by toolkit slug, from Composio. */
  connectedAccountIdsByToolkit: Record<string, string[]>;
  /**
   * Look up a cached session row by configHash.
   * Returns the row if a valid cached session exists, or null/undefined on miss.
   */
  getCachedSession: (
    configHash: string,
  ) => Promise<ToolkitListCacheRow | null | undefined>;
  /**
   * Persist a new session row after creating a Composio session.
   * Must include at least composioSessionId and configHash.
   */
  upsertSession: (data: {
    composioSessionId: string;
    configHash: string;
  }) => Promise<{ id: string }>;
  /**
   * Update the last-used timestamp on a cached session row.
   * Called on cache hits.
   */
  touchSession: (id: string) => Promise<void>;
};

/**
 * Returns true when the given toolkit slug requires a connected account to
 * authenticate (the common case), and false when Composio's toolkit metadata
 * marks it as `noAuth` (finding G9) — a no-auth toolkit is never "disconnected"
 * even with zero connected accounts.
 *
 * Defensive: if the toolkit metadata lookup is unavailable or fails, assume
 * auth IS required (today's behavior) rather than silently hiding a real
 * disconnected-toolkit warning.
 */
async function toolkitRequiresAuth(
  composio: ComposioClientLike,
  slug: string,
): Promise<boolean> {
  if (!composio.toolkits) {
    return true;
  }
  try {
    const toolkit = await composio.toolkits.get(slug);
    return toolkit.noAuth !== true;
  } catch {
    return true;
  }
}

/**
 * Scope-agnostic create/use + config-hash session cache loop.
 *
 * Builds a Composio session from a direct list of toolkit slugs, using the
 * injected cache callbacks so the caller can supply any backing store
 * (chat sessions, background-run sessions, agent-row sessions, …).
 *
 * The cache key is hashDirectConfig(slugs, connectedAccountIdsByToolkit) — it
 * incorporates connected-account membership so reconnecting or disconnecting
 * a toolkit rotates the cache key instead of reusing a stale session (finding
 * G8). If a matching row is found the existing Composio session is reused
 * (composio.use); otherwise a new session is created (composio.create) and
 * the row is upserted.
 *
 * Returns { status: "off" } when slugs is empty after normalisation.
 */
export async function resolveComposioToolsForToolkitList(
  params: ResolveComposioToolsForToolkitListParams,
): Promise<ResolvedComposioTools> {
  if (params.slugs.length === 0) {
    return { status: "off" };
  }

  const configHash = hashDirectConfig(
    params.slugs,
    params.connectedAccountIdsByToolkit,
  );

  // Selected toolkits with no ACTIVE connected account: their tools are offered
  // but cannot authenticate. Surfaced so the chat can warn instead of silently
  // handing the model dead, unauthenticated tools. Toolkits that don't require
  // auth at all (finding G9) are excluded — they were never "disconnected".
  const candidateDisconnected = params.slugs.filter((slug) => {
    const ids = params.connectedAccountIdsByToolkit[slug];
    return !(Array.isArray(ids) && ids.length > 0);
  });

  const disconnectedToolkits: string[] = [];
  for (const slug of candidateDisconnected) {
    const requiresAuth = await toolkitRequiresAuth(params.composio, slug);
    if (requiresAuth) {
      disconnectedToolkits.push(slug);
    }
  }

  const existingRow = await params.getCachedSession(configHash);

  if (existingRow) {
    const session = await params.composio.use(existingRow.composioSessionId);
    const tools = await session.tools();
    await params.touchSession(existingRow.id);
    return {
      status: "ready",
      tools,
      profile: null,
      composioSessionId: existingRow.composioSessionId,
      configHash,
      reusedSession: true,
      disconnectedToolkits,
    };
  }

  const sessionConfig = buildComposioSessionConfigFromDirectList({
    toolkitSlugs: params.slugs,
    connectedAccountIdsByToolkit: params.connectedAccountIdsByToolkit,
  });

  const session = await params.composio.create(
    toComposioUserId(params.userId),
    sessionConfig,
  );
  const tools = await session.tools();

  await params.upsertSession({
    composioSessionId: session.sessionId,
    configHash,
  });

  return {
    status: "ready",
    tools,
    profile: null,
    composioSessionId: session.sessionId,
    configHash,
    reusedSession: false,
    disconnectedToolkits,
  };
}
