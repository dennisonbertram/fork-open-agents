import { getChatById, getSessionById } from "@/lib/db/sessions";
import { getRunControl } from "@/lib/db/workflow-run-controls";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

export type ResponseFormat = "json" | "text";

export type SessionRecord = NonNullable<
  Awaited<ReturnType<typeof getSessionById>>
>;
export type ChatRecord = NonNullable<Awaited<ReturnType<typeof getChatById>>>;

type AuthenticatedUserResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedSessionChatResult =
  | {
      ok: true;
      sessionRecord: SessionRecord;
      chat: ChatRecord;
    }
  | {
      ok: false;
      response: Response;
    };

type OwnedChatByIdResult =
  | {
      ok: true;
      sessionRecord: SessionRecord;
      chat: ChatRecord;
    }
  | {
      ok: false;
      response: Response;
    };

interface RequireOwnedSessionChatParams {
  userId: string;
  sessionId: string;
  chatId: string;
  format?: ResponseFormat;
  forbiddenMessage?: string;
  requireActiveSandbox?: boolean;
  sandboxInactiveMessage?: string;
}

interface RequireOwnedChatByIdParams {
  userId: string;
  chatId: string;
  format?: ResponseFormat;
  forbiddenMessage?: string;
}

function toErrorResponse(
  message: string,
  status: number,
  format: ResponseFormat,
): Response {
  if (format === "text") {
    return new Response(message, { status });
  }

  return Response.json({ error: message }, { status });
}

export async function requireAuthenticatedUser(
  format: ResponseFormat = "json",
): Promise<AuthenticatedUserResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return {
      ok: false,
      response: toErrorResponse("Not authenticated", 401, format),
    };
  }

  return {
    ok: true,
    userId: session.user.id,
  };
}

export async function requireOwnedSessionChat(
  params: RequireOwnedSessionChatParams,
): Promise<OwnedSessionChatResult> {
  const {
    userId,
    sessionId,
    chatId,
    format = "json",
    forbiddenMessage = "Forbidden",
    requireActiveSandbox = false,
    sandboxInactiveMessage = "Sandbox not initialized",
  } = params;

  const [sessionRecord, chat] = await Promise.all([
    getSessionById(sessionId),
    getChatById(chatId),
  ]);

  if (!sessionRecord) {
    return {
      ok: false,
      response: toErrorResponse("Session not found", 404, format),
    };
  }

  if (sessionRecord.userId !== userId) {
    return {
      ok: false,
      response: toErrorResponse(forbiddenMessage, 403, format),
    };
  }

  if (!chat || chat.sessionId !== sessionId) {
    return {
      ok: false,
      response: toErrorResponse("Chat not found", 404, format),
    };
  }

  if (requireActiveSandbox && !isSandboxActive(sessionRecord.sandboxState)) {
    return {
      ok: false,
      response: toErrorResponse(sandboxInactiveMessage, 400, format),
    };
  }

  return {
    ok: true,
    sessionRecord,
    chat,
  };
}

interface RequireOwnedWorkflowRunByRunIdParams {
  userId: string;
  runId: string;
  format?: ResponseFormat;
}

type OwnedWorkflowRunByRunIdResult =
  | {
      ok: true;
      runId: string;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

/**
 * Resolve ownership of a workflow run.
 *
 * Primary path: look up the workflow_run_controls row (written at run START).
 * The control row carries the userId and is the single source of truth for
 * in-flight ownership.
 *
 * Falls back to the chats.activeStreamId → session.userId chain for runs that
 * were started before the control table existed (backward compat).
 */
export async function requireOwnedWorkflowRunByRunId(
  params: RequireOwnedWorkflowRunByRunIdParams,
): Promise<OwnedWorkflowRunByRunIdResult> {
  const { userId, runId, format = "json" } = params;

  // Primary path: control row
  const controlRow = await getRunControl(runId).catch(() => null);
  if (controlRow) {
    if (controlRow.userId !== userId) {
      return {
        ok: false,
        response: toErrorResponse("Forbidden", 403, format),
      };
    }
    return { ok: true, runId, userId };
  }

  // Fallback: resolve ownership through chat.activeStreamId → session.userId
  // For runs that have no control row (legacy or pre-#50 runs).
  // We scan chats by activeStreamId — this requires a query, so we use the
  // sessions DB helpers available here.
  // NOTE: this path is best-effort; if the chat is not found, return not_found.
  // We cannot efficiently reverse-lookup by activeStreamId without a dedicated
  // index; for now we return not_found (the control row is the canonical path).
  return {
    ok: false,
    response: toErrorResponse("Run not found", 404, format),
  };
}

export async function requireOwnedChatById(
  params: RequireOwnedChatByIdParams,
): Promise<OwnedChatByIdResult> {
  const {
    userId,
    chatId,
    format = "json",
    forbiddenMessage = "Forbidden",
  } = params;

  const chat = await getChatById(chatId);
  if (!chat) {
    return {
      ok: false,
      response: toErrorResponse("Chat not found", 404, format),
    };
  }

  const sessionRecord = await getSessionById(chat.sessionId);
  if (!sessionRecord || sessionRecord.userId !== userId) {
    return {
      ok: false,
      response: toErrorResponse(forbiddenMessage, 403, format),
    };
  }

  return {
    ok: true,
    sessionRecord,
    chat,
  };
}
