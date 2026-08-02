import { getRun } from "workflow/api";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import { stripChatMessageReasoning } from "@/lib/db/chat-message-reasoning";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

/**
 * Removes earlier model thinking from a chat so it can be sent to a provider
 * that refuses to accept reasoning back. One of the two recoveries offered
 * when a provider rejects a request; the other is switching back to a model
 * that accepted the history.
 */
export async function POST(_req: Request, context: RouteContext) {
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

  // Rewriting the transcript underneath a live stream would race the writer
  // that is still appending to it.
  const activeStreamId = chatContext.chat.activeStreamId;
  if (activeStreamId) {
    try {
      const status = await getRun(activeStreamId).status;
      if (status === "running" || status === "pending") {
        return Response.json(
          { error: "Cannot edit this chat while a response is streaming" },
          { status: 409 },
        );
      }
    } catch {
      // Run is gone; the stream id is stale and safe to ignore.
    }
  }

  const { updatedMessages } = await stripChatMessageReasoning(chatId);

  return Response.json({ updatedMessages });
}
