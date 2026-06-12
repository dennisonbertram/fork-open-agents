/**
 * Pure function that builds the request body for POST /api/chat.
 *
 * The client supplies workflowSchema alongside workflowId so the server can
 * validate inputValues against it. This is the interim contract until the #30
 * server-authoritative catalog lands — at that point the server will look up
 * the schema by workflowId instead of accepting it from the client.
 *
 * Every workflow in DEFAULT_CATALOG today declares no input fields, and there
 * is no input-collection UI yet, so workflowSchema: { fields: [] } is the
 * truthful contract. Validation and 422 handling stay server-side.
 */

export type BuildChatRequestBodyArgs = {
  sessionId: string;
  chatId: string;
  contextLimit: number | null;
  selectedWorkflowId: string | null;
};

export type ChatRequestBodyPayload = {
  sessionId: string;
  chatId: string;
  context?: { contextLimit: number };
  workflowId?: string;
  inputValues?: Record<string, unknown>;
  workflowSchema?: { fields: [] };
};

export function buildChatRequestBody({
  sessionId,
  chatId,
  contextLimit,
  selectedWorkflowId,
}: BuildChatRequestBodyArgs): ChatRequestBodyPayload {
  const body: ChatRequestBodyPayload = {
    sessionId,
    chatId,
    ...(contextLimit !== null ? { context: { contextLimit } } : {}),
  };

  if (selectedWorkflowId !== null) {
    body.workflowId = selectedWorkflowId;
    body.inputValues = {};
    body.workflowSchema = { fields: [] };
  }

  return body;
}
