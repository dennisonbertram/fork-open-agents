import type { ModelMessage } from "ai";

/**
 * Remove assistant `reasoning` parts from converted model messages.
 *
 * The AI SDK's openai-compatible provider serializes prior assistant reasoning
 * back onto the request as a `reasoning_content` field. Strict OpenAI-compatible
 * endpoints reject that field on input messages, which fails every later turn in
 * a chat once any turn has produced reasoning — including turns using a model
 * that worked moments earlier, because the poison lives in the history rather
 * than in the model selection.
 *
 * Only apply this for providers that cannot accept reasoning back. Anthropic
 * requires thinking blocks to be preserved alongside tool use, so stripping
 * them unconditionally would break that path.
 */
export function stripModelMessageReasoning(
  messages: ModelMessage[],
): ModelMessage[] {
  const stripped: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      stripped.push(message);
      continue;
    }

    const content = message.content.filter((part) => part.type !== "reasoning");
    if (content.length === message.content.length) {
      stripped.push(message);
      continue;
    }

    // An assistant turn that was nothing but reasoning leaves no content at
    // all; sending an empty assistant message is itself a provider error.
    if (content.length === 0) {
      continue;
    }

    stripped.push({ ...message, content });
  }

  return stripped;
}
