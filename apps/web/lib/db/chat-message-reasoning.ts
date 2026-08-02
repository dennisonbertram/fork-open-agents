import { eq } from "drizzle-orm";
import { db } from "./client";
import { chatMessages } from "./schema";

type StoredUIMessage = {
  parts?: unknown[];
};

/**
 * Remove persisted `reasoning` parts from every message in a chat.
 *
 * Offered as an explicit recovery when a provider refuses a request that
 * carries earlier model thinking: the transcript is the user's, so dropping
 * part of it is their call rather than something done silently on their
 * behalf. Returns how many messages actually changed so the caller can tell
 * the user whether there was anything to remove.
 */
export async function stripChatMessageReasoning(
  chatId: string,
): Promise<{ updatedMessages: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: chatMessages.id, parts: chatMessages.parts })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId));

    let updatedMessages = 0;

    for (const row of rows) {
      const stored = row.parts as StoredUIMessage | null;
      const parts = stored?.parts;
      if (!Array.isArray(parts)) {
        continue;
      }

      const kept = parts.filter(
        (part) =>
          !(
            typeof part === "object" &&
            part !== null &&
            (part as { type?: unknown }).type === "reasoning"
          ),
      );
      if (kept.length === parts.length) {
        continue;
      }

      await tx
        .update(chatMessages)
        .set({ parts: { ...stored, parts: kept } })
        .where(eq(chatMessages.id, row.id));
      updatedMessages += 1;
    }

    return { updatedMessages };
  });
}
