import { getRun } from "workflow/api";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import {
  compareAndSetChatActiveStreamId,
  deleteChatMessageAndFollowing,
} from "@/lib/db/sessions";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string; messageId: string }>;
};

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId, messageId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const { chat } = chatContext;

  if (chat.activeStreamId) {
    const runId = chat.activeStreamId;
    // Check if the workflow is actually still running. If it terminated
    // without cleaning up (e.g. due to a failure), clear the stale ID
    // and allow the delete to proceed.
    try {
      const run = getRun(runId);
      const status = await run.status;
      if (status === "running" || status === "pending") {
        return Response.json(
          {
            error: "Cannot delete messages while a response is streaming",
            errorKind: "conflict",
          },
          { status: 409 },
        );
      }
    } catch {
      // Workflow run not found — treat as stale.
    }

    // Workflow is terminal or not found — clear the stale activeStreamId.
    await clearStaleActiveStreamId(chatId, runId);
  }

  const result = await deleteChatMessageAndFollowing(chatId, messageId);

  if (result.status === "not_found") {
    return Response.json(
      { error: "Message not found", errorKind: "not_found" },
      { status: 404 },
    );
  }

  if (result.status === "not_user_message") {
    return Response.json(
      {
        error: "Only user messages can be deleted",
        errorKind: "invalid_request",
      },
      { status: 400 },
    );
  }

  return Response.json({
    success: true,
    deletedMessageIds: result.deletedMessageIds,
  });
}

async function clearStaleActiveStreamId(chatId: string, runId: string) {
  const cleared = await compareAndSetChatActiveStreamId(chatId, runId, null);
  if (!cleared) {
    console.info("[workflow] chat_stream_stale_clear_skipped", {
      chatId,
      expectedRunId: runId,
    });
  }
}
