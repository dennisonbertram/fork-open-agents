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

export type ComposioToolkitMetadataClientLike = {
  /**
   * Toolkit metadata lookup, used to detect toolkits that don't require a
   * connected account (finding G9) so they are never falsely reported as
   * disconnected. Optional so existing lightweight test fakes that don't
   * exercise the no-auth path keep compiling.
   *
   * The real Composio SDK's composio.toolkits.get(slug) returns
   * ToolkitRetrieveResponse, whose `authConfigDetails` array lists one entry
   * per supported auth scheme (e.g. "OAUTH2", "NO_AUTH"). We only read that
   * one field, typed loosely (unknown record) so this interface stays
   * structurally assignable from the real SDK client without importing its
   * full response type.
   */
  toolkits?: {
    get: (slug: string) => Promise<{ authConfigDetails?: unknown }>;
  };
};

type ComposioClientLike = {
  create: (
    userId: string,
    config: ToolRouterCreateSessionConfig,
  ) => Promise<{ sessionId: string; tools: () => Promise<ToolSet> }>;
  use: (sessionId: string) => Promise<{ tools: () => Promise<ToolSet> }>;
} & ComposioToolkitMetadataClientLike;

const NO_AUTH_SCHEME = "NO_AUTH";

/**
 * Narrows a toolkits.get() response's authConfigDetails field (typed loosely
 * as unknown at the interface boundary above) and reports whether it lists
 * NO_AUTH as a supported auth scheme.
 *
 * The scheme identifier lives on `mode` ("NO_AUTH", "OAUTH2", …); `name` is a
 * human display label ("No Auth"). `name` is still checked defensively in
 * case a response carries the identifier there.
 */
function toolkitAuthConfigDetailsIncludesNoAuth(
  authConfigDetails: unknown,
): boolean {
  if (!Array.isArray(authConfigDetails)) {
    return false;
  }
  return authConfigDetails.some((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return record.mode === NO_AUTH_SCHEME || record.name === NO_AUTH_SCHEME;
  });
}

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
 *
 * Exported (#802, Codex review on PR #849) so callers outside this file —
 * currently the agent tool preflight (lib/background-agents/tool-preflight.ts)
 * — can apply the IDENTICAL no-auth exclusion the real bg-run path uses,
 * instead of re-deriving their own (and silently drifting from this one).
 * This file remains the canonical source for the check.
 */
export async function toolkitRequiresAuth(
  composio: ComposioToolkitMetadataClientLike,
  slug: string,
): Promise<boolean> {
  if (!composio.toolkits) {
    return true;
  }
  try {
    const toolkit = await composio.toolkits.get(slug);
    return !toolkitAuthConfigDetailsIncludesNoAuth(toolkit.authConfigDetails);
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
