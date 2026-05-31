/**
 * Deterministic FAKE agent for the eval.
 *
 * Stands in for `start(runAgentWorkflow, [...])`. It writes an assistant
 * `chat_messages` row into the materialized chat — the same place the real
 * workflow's `persistAssistantMessage` step writes — so the eval can assert
 * the result actually "landed" and is linked to the job via the chat/session.
 *
 * If `prUrlFor` is provided it also reports a PR url, mirroring the
 * workflow's auto-create-PR output path.
 */
import { chatMessages } from "./schema";
import type { Db } from "./db";
import type { RunAgent, RunAgentOptions } from "./agent-seam";

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function createFakeAgent(
  db: Db,
  opts: { prUrlFor?: (o: RunAgentOptions) => string | undefined } = {},
): RunAgent {
  return async (options: RunAgentOptions) => {
    const userPrompt =
      options.messages.find((m) => m.role === "user")?.parts[0]?.text ?? "";

    // Deterministic "agent" output derived from the saved prompt + repo.
    const responseText =
      `Standing agent ran on ${options.repoOwner}/${options.repoName}` +
      `${options.branch ? `@${options.branch}` : ""} for prompt: "${userPrompt}". ` +
      `Completed at tick.`;

    // This is the load-bearing assertion target: the result lands as an
    // assistant message row in the chat materialized for this job run.
    const messageId = id("msg");
    db.insert(chatMessages)
      .values({
        id: messageId,
        chatId: options.chatId,
        role: "assistant",
        parts: [{ type: "text", text: responseText }],
      })
      .run();

    const prUrl = opts.prUrlFor?.(options);
    return { chatId: options.chatId, prUrl };
  };
}
