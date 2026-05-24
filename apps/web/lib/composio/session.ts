import "server-only";

import type { ToolSet } from "ai";
import {
  getComposioAgentSession,
  getComposioToolProfile,
  getChatComposioSelection,
  touchComposioAgentSession,
  upsertComposioAgentSession,
} from "@/lib/db/composio";
import { getChatById } from "@/lib/db/sessions";
import type { ComposioToolProfile } from "@/lib/db/schema";
import { type ComposioAgentKey } from "./types";
import { getComposioConfig } from "./config";
import { getComposioClient } from "./client";
import {
  buildComposioSessionConfig,
  getComposioProfileConfigHash,
} from "./session-config";
import { toComposioUserId } from "./user-id";

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
      profile: ComposioToolProfile;
      composioSessionId: string;
      configHash: string;
      reusedSession: boolean;
    };

function toSetupError(error: unknown): ComposioSetupError {
  if (error instanceof ComposioSetupError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ComposioSetupError(
    message || "Composio tools could not be prepared.",
  );
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
  const profileId =
    params.agentKey === undefined || params.agentKey === "main"
      ? selection.mainProfileId
      : (selection.agentProfileOverrides?.[params.agentKey] ?? null);

  if (!profileId) {
    return { status: "off" };
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
