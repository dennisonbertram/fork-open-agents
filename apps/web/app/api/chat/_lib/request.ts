import type { WebAgentUIMessage } from "@/app/types";

export interface ChatRequestBody {
  messages: WebAgentUIMessage[];
  sessionId?: string;
  chatId?: string;
  /**
   * Named workflow identifier. Present only for named workflow runs (#46).
   * When present, the chat route gate calls validateWorkflowInputs (pure)
   * BEFORE start(runAgentWorkflow, ...), then persistWorkflowInputSnapshot
   * AFTER start() with the real run.runId. Absent for classic/freeform chat
   * runs — the validation gate is bypassed entirely.
   */
  workflowId?: string;
  /**
   * Submitted input values for the named workflow. Present only when
   * workflowId is provided. Validated server-side against the workflow's
   * WorkflowInputSchema before the durable run is started.
   */
  inputValues?: Record<string, unknown>;
  /**
   * The declared input schema for the named workflow. The client supplies
   * this so the server can validate inputValues against it. Accepted as
   * unknown and parsed server-side via parseWorkflowInputSchema (#45).
   * Required when workflowId is present.
   * Note: once the #30 catalog lands, the server will look up the schema
   * by workflowId instead of accepting it from the client.
   */
  workflowSchema?: unknown;
  /**
   * The client's declared schema version (for version-mismatch detection).
   * Deferred: version check requires #29/#30 catalog. Currently a no-op.
   */
  workflowSchemaVersion?: string;
}

type ParseChatRequestResult =
  | {
      ok: true;
      body: ChatRequestBody;
    }
  | {
      ok: false;
      response: Response;
    };

type RequireChatIdentifiersResult =
  | {
      ok: true;
      sessionId: string;
      chatId: string;
    }
  | {
      ok: false;
      response: Response;
    };

export async function parseChatRequestBody(
  req: Request,
): Promise<ParseChatRequestResult> {
  try {
    const body = (await req.json()) as ChatRequestBody;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
}

export function requireChatIdentifiers(
  body: ChatRequestBody,
): RequireChatIdentifiersResult {
  if (!body.sessionId || !body.chatId) {
    return {
      ok: false,
      response: Response.json(
        { error: "sessionId and chatId are required" },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    sessionId: body.sessionId,
    chatId: body.chatId,
  };
}
