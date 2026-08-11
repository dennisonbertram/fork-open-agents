import type { WebAgentUIMessage } from "@/app/types";
import { getRecentChatMessages } from "@/lib/db/sessions";

type ChatMessageRow = Awaited<ReturnType<typeof getRecentChatMessages>>[number];

// Generous enough to cover a normal chat's full history for workflow context;
// bump if MCP-driven chats regularly run longer than this.
const DEFAULT_HISTORY_LIMIT = 200;

/**
 * `chat_messages.parts` normally holds the WHOLE persisted `WebAgentUIMessage`
 * object (see every `createChatMessageIfNotExists` caller), but some rows —
 * the same ones `generate-pr-helpers.ts`'s `getConversationContext` tolerates
 * — store just the parts array. Handle both, exactly like
 * `lib/mcp-server/tools/sessions-read.ts`'s `extractMessageParts`.
 */
function rowToUIMessage(row: ChatMessageRow): WebAgentUIMessage {
  const raw: unknown = row.parts;
  const isWholeMessage =
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Array.isArray((raw as { parts?: unknown }).parts);

  if (isWholeMessage) {
    return raw as WebAgentUIMessage;
  }

  return {
    id: row.id,
    role: row.role,
    parts: (Array.isArray(raw) ? raw : []) as WebAgentUIMessage["parts"],
  } as WebAgentUIMessage;
}

/**
 * Reconstructs the workflow's `WebAgentUIMessage[]` input for an MCP-driven
 * turn. The browser posts its full in-memory history on every request; an
 * MCP caller has none, so this rebuilds it from persisted rows and appends
 * the new user message the caller is about to send.
 */
export async function buildMessagesFromDb(
  chatId: string,
  newUserMessage: WebAgentUIMessage,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<WebAgentUIMessage[]> {
  const rows = await getRecentChatMessages(chatId, limit);
  return [...rows.map(rowToUIMessage), newUserMessage];
}
