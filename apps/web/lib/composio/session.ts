import "server-only";

import type { ToolSet } from "ai";
import {
  getComposioAgentSession,
  getComposioToolProfile,
  getChatComposioSelection,
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
import {
  buildComposioSessionConfigFromDirectList,
  hashDirectConfig,
} from "./direct-list-config";
import { toComposioUserId } from "./user-id";
import { getComposioUserFacingError } from "./errors";

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
  const directSlugs =
    isMainAgentKey && selection.directToolkitSlugs?.length
      ? selection.directToolkitSlugs
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
    const configHash = hashDirectConfig(directSlugs);
    const syntheticProfileId = "direct";
    const agentKey = params.agentKey ?? "main";

    // Fetch user's active connected accounts, grouped by toolkit slug.
    const connectedAccountIdsByToolkit = await fetchConnectedAccountsByToolkit(
      composio,
      params.userId,
    );

    try {
      const existingSession = await getComposioAgentSession({
        userId: params.userId,
        chatId: params.chatId,
        agentKey,
        profileId: syntheticProfileId,
        configHash,
      });

      if (existingSession) {
        const session = await composio.use(existingSession.composioSessionId);
        const tools = await session.tools();
        await touchComposioAgentSession(existingSession.id);
        return {
          status: "ready",
          tools,
          profile: null,
          composioSessionId: existingSession.composioSessionId,
          configHash,
          reusedSession: true,
        };
      }

      const sessionConfig = buildComposioSessionConfigFromDirectList({
        toolkitSlugs: directSlugs,
        connectedAccountIdsByToolkit,
      });
      const session = await composio.create(
        toComposioUserId(params.userId),
        sessionConfig,
      );
      const tools = await session.tools();
      await upsertComposioAgentSession({
        userId: params.userId,
        chatId: params.chatId,
        agentKey,
        profileId: syntheticProfileId,
        configHash,
        composioSessionId: session.sessionId,
      });
      return {
        status: "ready",
        tools,
        profile: null,
        composioSessionId: session.sessionId,
        configHash,
        reusedSession: false,
      };
    } catch (error) {
      throw toSetupError(error);
    }
  }

  // ── Profile path (existing behavior, unchanged) ───────────────────────────
  const profileId = isMainAgentKey
    ? selection.mainProfileId
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
