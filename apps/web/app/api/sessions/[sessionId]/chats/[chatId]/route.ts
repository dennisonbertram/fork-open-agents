import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import type { WebAgentUIMessage } from "@/app/types";
import {
  deleteChat,
  getChatMessages,
  getChatsBySessionId,
  updateChat,
} from "@/lib/db/sessions";
import { getInferenceProfileByIdForUser } from "@/lib/db/inference-profiles";
import { isComposioProfileAllowedForRepository } from "@/lib/db/composio";
import {
  chatComposioSelectionInputSchema,
  type ChatComposioSelection,
} from "@/lib/composio/types";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

interface UpdateChatRequest {
  title?: string;
  modelId?: string;
  inferenceProfileId?: string | null;
  composioSelection?: ChatComposioSelection;
}

export interface ChatRefreshResponse {
  chat: {
    id: string;
    modelId: string | null;
    inferenceProfileId: string | null;
    composioSelection: ChatComposioSelection;
    activeStreamId: string | null;
  };
  isStreaming: boolean;
  messages: WebAgentUIMessage[];
}

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const messages = await getChatMessages(chatId);
  const modelId = chatContext.chat.modelId ?? null;

  return Response.json({
    chat: {
      id: chatContext.chat.id,
      modelId,
      inferenceProfileId: chatContext.chat.inferenceProfileId ?? null,
      composioSelection: chatContext.chat.composioSelection,
      activeStreamId: chatContext.chat.activeStreamId,
    },
    isStreaming: chatContext.chat.activeStreamId !== null,
    messages: messages.map((message) => message.parts as WebAgentUIMessage),
  } satisfies ChatRefreshResponse);
}

export async function PATCH(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  let body: UpdateChatRequest;
  try {
    body = (await req.json()) as UpdateChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nextTitle = body.title?.trim();
  const nextModelId = body.modelId?.trim();
  const hasInferenceProfileUpdate = "inferenceProfileId" in body;
  const nextInferenceProfileId =
    body.inferenceProfileId === null
      ? null
      : typeof body.inferenceProfileId === "string"
        ? body.inferenceProfileId.trim()
        : undefined;
  const nextComposioSelection =
    body.composioSelection === undefined
      ? undefined
      : chatComposioSelectionInputSchema.safeParse(body.composioSelection);

  if (
    !nextTitle &&
    !nextModelId &&
    !hasInferenceProfileUpdate &&
    nextComposioSelection === undefined
  ) {
    return Response.json(
      { error: "At least one field is required" },
      { status: 400 },
    );
  }
  if (nextComposioSelection && !nextComposioSelection.success) {
    return Response.json(
      { error: "Invalid composioSelection" },
      { status: 400 },
    );
  }
  if (nextComposioSelection?.success) {
    const profileId = nextComposioSelection.data.mainProfileId;
    if (profileId) {
      const policy = await isComposioProfileAllowedForRepository({
        userId: authResult.userId,
        profileId,
        repoOwner: chatContext.sessionRecord.repoOwner,
        repoName: chatContext.sessionRecord.repoName,
      });
      if (!policy.allowed) {
        return Response.json(
          {
            error:
              policy.reason ??
              "Selected Composio profile is blocked by repository policy",
          },
          { status: 400 },
        );
      }
    }
  }
  if (hasInferenceProfileUpdate) {
    if (
      nextInferenceProfileId !== null &&
      (typeof nextInferenceProfileId !== "string" ||
        nextInferenceProfileId.length === 0)
    ) {
      return Response.json(
        { error: "Invalid inferenceProfileId" },
        { status: 400 },
      );
    }

    if (nextInferenceProfileId !== null) {
      const profile = await getInferenceProfileByIdForUser(
        authResult.userId,
        nextInferenceProfileId,
      );
      if (!profile || !profile.enabled) {
        return Response.json(
          { error: "Inference profile not found" },
          { status: 404 },
        );
      }

      const effectiveModelId =
        nextModelId ?? chatContext.chat.modelId ?? undefined;
      if (!effectiveModelId?.startsWith("anthropic/")) {
        return Response.json(
          {
            error:
              "User inference profiles currently support Anthropic models only",
          },
          { status: 400 },
        );
      }
    }
  }

  const updatePayload: {
    title?: string;
    modelId?: string;
    inferenceProfileId?: string | null;
    composioSelection?: ChatComposioSelection;
  } = {};
  if (nextTitle) {
    updatePayload.title = nextTitle;
  }
  if (nextModelId) {
    updatePayload.modelId = nextModelId;
  }
  if (hasInferenceProfileUpdate) {
    updatePayload.inferenceProfileId = nextInferenceProfileId ?? null;
  }
  if (nextComposioSelection?.success) {
    updatePayload.composioSelection = nextComposioSelection.data;
  }

  const updatedChat = await updateChat(chatId, updatePayload);
  if (!updatedChat) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  return Response.json({
    chat: updatedChat,
  });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const chats = await getChatsBySessionId(sessionId);
  if (chats.length <= 1) {
    return Response.json(
      { error: "Cannot delete the only chat in a session" },
      { status: 400 },
    );
  }

  await deleteChat(chatId);
  return Response.json({ success: true });
}
