import { nanoid } from "nanoid";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import {
  createChat,
  getChatById,
  getChatSummariesBySessionId,
} from "@/lib/db/sessions";
import { isComposioProfileAllowedForRepository } from "@/lib/db/composio";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { splitModelSelection } from "@/lib/inference/model-option-id";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const [chats, preferences] = await Promise.all([
    getChatSummariesBySessionId(sessionId, authResult.userId),
    getUserPreferences(authResult.userId),
  ]);
  return Response.json({ chats, defaultModelId: preferences.defaultModelId });
}

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  let requestedChatId: string | null = null;
  try {
    const body = await req.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "id" in body &&
      body.id !== undefined
    ) {
      if (typeof body.id !== "string" || body.id.length === 0) {
        return Response.json(
          { error: "Invalid chat id", errorKind: "invalid_request" },
          { status: 400 },
        );
      }
      requestedChatId = body.id;
    }
  } catch {
    requestedChatId = null;
  }

  if (requestedChatId) {
    const existing = await getChatById(requestedChatId);
    if (existing) {
      if (existing.sessionId !== sessionId) {
        return Response.json(
          { error: "Chat ID conflict", errorKind: "conflict" },
          { status: 409 },
        );
      }
      return Response.json({ chat: existing });
    }
  }

  const preferences = await getUserPreferences(authResult.userId);
  const defaultComposioProfileId =
    preferences.composioAgentDefaults.main.defaultProfileId;
  const composioPolicy = defaultComposioProfileId
    ? await isComposioProfileAllowedForRepository({
        userId: authResult.userId,
        profileId: defaultComposioProfileId,
        repoOwner: sessionContext.sessionRecord.repoOwner,
        repoName: sessionContext.sessionRecord.repoName,
      })
    : { allowed: true };
  const chat = await createChat({
    id: requestedChatId ?? nanoid(),
    sessionId,
    title: "New chat",
    ...splitModelSelection(
      preferences.defaultModelId,
      sessionContext.sessionRecord.inferenceProfileId ??
        preferences.defaultInferenceProfileId,
    ),
    composioSelection: {
      mainProfileId:
        defaultComposioProfileId && composioPolicy.allowed
          ? defaultComposioProfileId
          : null,
    },
  });

  return Response.json({ chat });
}
