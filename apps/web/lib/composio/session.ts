import "server-only";

import type { ToolSet } from "ai";
import {
  getComposioAgentSession,
  getComposioToolProfile,
  getChatComposioSelection,
  getRepositoryComposioSettings,
  getRepositoryComposioSettingsValues,
  touchComposioAgentSession,
  upsertComposioAgentSession,
  isComposioProfileAllowedForRepository,
} from "@/lib/db/composio";
import { getChatById, getSessionById } from "@/lib/db/sessions";
import type { ComposioToolProfile } from "@/lib/db/schema";
import { type ComposioAgentKey } from "./types";
import { getComposioConfig } from "./config";
import { getComposioClient } from "./client";
import {
  buildComposioSessionConfig,
  getComposioProfileConfigHash,
} from "./session-config";
import { toComposioUserId } from "./user-id";
import { getComposioUserFacingError } from "./errors";
import { resolveComposioToolsForToolkitList } from "./resolve-toolkit-list";
import { resolveComposioSlugsForChatMain } from "./resolve-chat-with-agent-row";
import { resolveAgentForRole } from "@/lib/agents/resolve-agent";
import { getEffectiveRepoToolkitSlugs } from "./repo-toolkit-selection";

export {
  buildComposioSessionConfig,
  getComposioProfileConfigHash,
} from "./session-config";
export { toComposioUserId };

export class ComposioSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposioSetupError";
  }
}

export type ResolvedComposioTools =
  | {
      status: "off";
    }
  | {
      status: "ready";
      tools: ToolSet;
      profile: ComposioToolProfile | null;
      composioSessionId: string;
      configHash: string;
      reusedSession: boolean;
      /**
       * Selected direct-list toolkits that have no ACTIVE connected account.
       * Their tools are still offered but cannot authenticate, so the chat
       * surfaces a "not connected" warning. Undefined on the profile path.
       */
      disconnectedToolkits?: string[];
    };

/**
 * Fetches the user's ACTIVE connected accounts from Composio and groups them
 * by toolkit slug → connectedAccountId[].
 *
 * Defensively typed: the Composio SDK response is unknown at the TS level, so
 * we narrow each item before using it.
 */
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

    // toolkit.slug or toolkitSlug depending on SDK version
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

    if (!slug) {
      continue;
    }

    const existing = result[slug];
    if (existing) {
      existing.push(id);
    } else {
      result[slug] = [id];
    }
  }

  return result;
}

function toSetupError(error: unknown): ComposioSetupError {
  if (error instanceof ComposioSetupError) {
    return error;
  }

  return new ComposioSetupError(getComposioUserFacingError(error));
}

/**
 * Resolve the repo/workspace-level toolkit slugs for a session's repo, applying
 * GitHub default-on when the repo has never been configured. Returns null when
 * there is no repo, Composio is unconfigured, or the effective list is empty.
 */
async function resolveRepoSelectedSlugs(params: {
  userId: string;
  sessionId: string;
}): Promise<string[] | null> {
  const sessionRecord = await getSessionById(params.sessionId);
  const repoOwner = sessionRecord?.repoOwner;
  const repoName = sessionRecord?.repoName;
  if (!repoOwner || !repoName) {
    return null;
  }
  if (!getComposioConfig().configured) {
    return null;
  }

  const repoSettings = await getRepositoryComposioSettings({
    userId: params.userId,
    repoOwner,
    repoName,
  });
  const stored =
    getRepositoryComposioSettingsValues(repoSettings)?.selectedToolkitSlugs;
  // `undefined` (no row) and `null` both mean "never configured".
  const selectedToolkitSlugs = stored ?? null;

  // Only resolve connected accounts when needed for the GitHub default-on
  // decision (an unconfigured repo). An explicit selection wins without it.
  let githubConnected = false;
  if (selectedToolkitSlugs === null) {
    const connected = await fetchConnectedAccountsByToolkit(
      getComposioClient(),
      params.userId,
    );
    githubConnected = (connected.github?.length ?? 0) > 0;
  }

  const effective = getEffectiveRepoToolkitSlugs({
    selectedToolkitSlugs,
    githubConnected,
  });
  return effective.length > 0 ? effective : null;
}

export async function resolveComposioToolsForChat(params: {
  userId: string;
  chatId: string;
  agentKey?: ComposioAgentKey;
  runtimeMode?: "classic" | "managed_runtime";
}): Promise<ResolvedComposioTools> {
  const chat = await getChatById(params.chatId);
  if (!chat) {
    throw new ComposioSetupError("Chat not found for Composio tool setup.");
  }

  const selection = getChatComposioSelection(chat.composioSelection);

  // ── Direct-list path ──────────────────────────────────────────────────────
  // When the chat has directToolkitSlugs (one-wins over profile), build the
  // session config from the user's active connected accounts instead of a
  // saved profile.
  const isMainAgentKey =
    params.agentKey === undefined || params.agentKey === "main";

  // ── Phase 3: resolve agent row defaults for the main agent ────────────────
  // For the main agent, consult resolveAgentForRole to get the user_default
  // composio config. The explicit per-chat selection ALWAYS wins; the agent
  // row only fills in when the chat has no explicit value.
  // PRECEDENCE:
  //   explicit per-chat directToolkitSlugs > explicit per-chat mainProfileId
  //   > agent row composioToolkitSlugs > agent row composioProfileId
  //   > null (no tools, today's behavior)
  let agentRowComposioSlugs: string[] | null = null;
  let agentRowComposioProfileId: string | null = null;

  if (isMainAgentKey) {
    try {
      const agentRow = await resolveAgentForRole({
        userId: params.userId,
        role: "main",
        sessionId: chat.sessionId,
      });
      // Only use agent row values when they differ from empty defaults
      // (composioToolkitSlugs defaults to [] in synthetic fallback, which means
      // "no row" — treat both [] and null as "no agent-row selection")
      agentRowComposioSlugs =
        agentRow.composioToolkitSlugs.length > 0
          ? agentRow.composioToolkitSlugs
          : null;
      agentRowComposioProfileId = agentRow.composioProfileId;
    } catch {
      // Graceful degradation: if agent row resolution fails, fall back to
      // today's behavior (no agent row contribution)
    }
  }

  // ── Repo/workspace-level toolkit selection (lowest precedence) ────────────
  // Governs when the chat has no explicit selection — the case that otherwise
  // yields no Composio tools and forces the model onto unauthenticated
  // web_fetch for GitHub. GitHub is default-on for an unconfigured repo.
  let repoSelectedSlugs: string[] | null = null;
  if (isMainAgentKey) {
    try {
      repoSelectedSlugs = await resolveRepoSelectedSlugs({
        userId: params.userId,
        sessionId: chat.sessionId,
      });
    } catch {
      // Non-fatal: fall back to today's behavior (no repo contribution).
    }
  }

  const resolvedForMain = isMainAgentKey
    ? resolveComposioSlugsForChatMain({
        chatDirectSlugs: selection.directToolkitSlugs ?? null,
        chatMainProfileId: selection.mainProfileId,
        agentRowComposioSlugs,
        agentRowComposioProfileId,
        repoSelectedSlugs,
      })
    : null;

  const directSlugs = isMainAgentKey
    ? (resolvedForMain?.directSlugs ?? null)
    : null;

  if (directSlugs) {
    if ((params.runtimeMode ?? "classic") !== "classic") {
      throw new ComposioSetupError(
        "Composio tools are currently available only in classic runtime mode.",
      );
    }

    const config = getComposioConfig();
    if (!config.configured) {
      throw new ComposioSetupError(
        "Composio tools are selected, but COMPOSIO_API_KEY is not configured.",
      );
    }

    const composio = getComposioClient();
    const syntheticProfileId = "direct";
    const agentKey = params.agentKey ?? "main";

    // Fetch user's active connected accounts, grouped by toolkit slug.
    const connectedAccountIdsByToolkit = await fetchConnectedAccountsByToolkit(
      composio,
      params.userId,
    );

    try {
      return await resolveComposioToolsForToolkitList({
        userId: params.userId,
        slugs: directSlugs,
        composio,
        connectedAccountIdsByToolkit,
        getCachedSession: (configHash) =>
          getComposioAgentSession({
            userId: params.userId,
            chatId: params.chatId,
            agentKey,
            profileId: syntheticProfileId,
            configHash,
          }),
        upsertSession: ({ composioSessionId, configHash }) =>
          upsertComposioAgentSession({
            userId: params.userId,
            chatId: params.chatId,
            agentKey,
            profileId: syntheticProfileId,
            configHash,
            composioSessionId,
          }),
        touchSession: (id) => touchComposioAgentSession(id),
      });
    } catch (error) {
      throw toSetupError(error);
    }
  }

  // ── Profile path ─────────────────────────────────────────────────────────
  // For the main agent, use the resolved profileId (which already applies the
  // precedence: explicit chat profile > agent row profile > null).
  // For subagents, use the existing agentProfileOverrides logic unchanged.
  const profileId = isMainAgentKey
    ? (resolvedForMain?.profileId ?? null)
    : (selection.agentProfileOverrides?.[params.agentKey!] ?? null);

  if (!profileId) {
    return { status: "off" };
  }

  const sessionRecord = await getSessionById(chat.sessionId);
  const policy = await isComposioProfileAllowedForRepository({
    userId: params.userId,
    profileId,
    repoOwner: sessionRecord?.repoOwner,
    repoName: sessionRecord?.repoName,
  });
  if (!policy.allowed) {
    throw new ComposioSetupError(
      policy.reason ??
        "Selected Composio profile is blocked by repository policy.",
    );
  }

  if ((params.runtimeMode ?? "classic") !== "classic") {
    throw new ComposioSetupError(
      "Composio tools are currently available only in classic runtime mode.",
    );
  }

  const config = getComposioConfig();
  if (!config.configured) {
    throw new ComposioSetupError(
      "Composio tools are selected, but COMPOSIO_API_KEY is not configured.",
    );
  }

  const profile = await getComposioToolProfile(params.userId, profileId);
  if (!profile) {
    throw new ComposioSetupError(
      "The selected Composio profile no longer exists.",
    );
  }

  const agentKey = params.agentKey ?? "main";
  const configHash = getComposioProfileConfigHash(profile);
  const composio = getComposioClient();
  const existingSession = await getComposioAgentSession({
    userId: params.userId,
    chatId: params.chatId,
    agentKey,
    profileId: profile.id,
    configHash,
  });

  try {
    if (existingSession) {
      const session = await composio.use(existingSession.composioSessionId);
      const tools = await session.tools();
      await touchComposioAgentSession(existingSession.id);
      return {
        status: "ready",
        tools,
        profile,
        composioSessionId: existingSession.composioSessionId,
        configHash,
        reusedSession: true,
      };
    }

    const session = await composio.create(
      toComposioUserId(params.userId),
      buildComposioSessionConfig(profile),
    );
    const tools = await session.tools();
    await upsertComposioAgentSession({
      userId: params.userId,
      chatId: params.chatId,
      agentKey,
      profileId: profile.id,
      configHash,
      composioSessionId: session.sessionId,
    });

    return {
      status: "ready",
      tools,
      profile,
      composioSessionId: session.sessionId,
      configHash,
      reusedSession: false,
    };
  } catch (error) {
    throw toSetupError(error);
  }
}
