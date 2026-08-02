/**
 * Pins the wire format that made a whole chat unusable in production.
 *
 * Once any turn produced a reasoning block, every later turn against an
 * OpenAI-compatible inference profile failed with an HTTP 400 — including
 * turns using a model that had succeeded moments earlier, because the cause
 * travelled in the history rather than in the model selection.
 *
 * These tests observe the actual request body against a local server instead
 * of reading the provider's source, and pin both halves: that prior assistant
 * reasoning is serialized onto the request as `reasoning_content`, and that
 * dropping reasoning parts removes it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type ModelMessage } from "ai";

type WireMessage = Record<string, unknown>;

let server: ReturnType<typeof Bun.serve>;

// Held on an object rather than a bare `let`: TypeScript narrows a
// module-scope `let` that is only assigned inside a callback down to `null`.
const captured: { requestBody: { messages?: WireMessage[] } | null } = {
  requestBody: null,
};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      captured.requestBody = (await req.json()) as {
        messages?: WireMessage[];
      };
      return Response.json({
        id: "cmpl-test",
        object: "chat.completion",
        created: 0,
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

function stripReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return [message];
    }
    const content = message.content.filter((part) => part.type !== "reasoning");
    if (content.length === 0) {
      return [];
    }
    return [{ ...message, content }];
  });
}

// Reset through a function: assigning `captured.requestBody = null` inline
// narrows the property to `null` for the rest of the block, so the later read
// collapses to `never`.
function resetCapture(): void {
  captured.requestBody = null;
}

async function sendAndCaptureAssistantMessage(
  messages: ModelMessage[],
): Promise<WireMessage> {
  resetCapture();
  const provider = createOpenAICompatible({
    name: "openai-compatible",
    baseURL: `http://localhost:${server.port}/v1`,
    apiKey: "test-key",
  });

  await generateText({ model: provider.chatModel("mock-model"), messages });

  const sent = captured.requestBody?.messages ?? [];
  const assistant = sent.find((message) => message.role === "assistant");
  expect(assistant).toBeDefined();
  return assistant as WireMessage;
}

const HISTORY_WITH_REASONING: ModelMessage[] = [
  { role: "user", content: "hi" },
  {
    role: "assistant",
    content: [
      { type: "reasoning", text: "internal chain of thought" },
      { type: "text", text: "hello" },
    ],
  },
  { role: "user", content: "continue" },
];

describe("openai-compatible provider wire format", () => {
  test("serializes prior assistant reasoning as reasoning_content", async () => {
    const assistant = await sendAndCaptureAssistantMessage(
      HISTORY_WITH_REASONING,
    );

    expect(assistant).toHaveProperty("reasoning_content");
    expect(assistant.reasoning_content).toBe("internal chain of thought");
  });

  test("sends no reasoning_content once reasoning parts are removed", async () => {
    const assistant = await sendAndCaptureAssistantMessage(
      stripReasoning(HISTORY_WITH_REASONING),
    );

    expect(assistant).not.toHaveProperty("reasoning_content");
    expect(assistant.content).toBe("hello");
  });
});
