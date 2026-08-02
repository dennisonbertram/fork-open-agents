import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { stripModelMessageReasoning } from "./strip-model-message-reasoning";

describe("stripModelMessageReasoning", () => {
  test("removes reasoning parts but keeps the rest of the assistant turn", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking out loud" },
          { type: "text", text: "hello" },
        ],
      },
    ];

    const result = stripModelMessageReasoning(messages);

    expect(result).toHaveLength(2);
    expect(result[1]?.content).toEqual([{ type: "text", text: "hello" }]);
  });

  test("drops an assistant turn that was nothing but reasoning", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "thinking out loud" }],
      },
      { role: "user", content: "still there?" },
    ];

    const result = stripModelMessageReasoning(messages);

    expect(result).toHaveLength(2);
    expect(result.every((message) => message.role === "user")).toBe(true);
  });

  test("leaves messages without reasoning untouched by identity", () => {
    const assistant: ModelMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    };
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      assistant,
    ];

    const result = stripModelMessageReasoning(messages);

    expect(result[1]).toBe(assistant);
  });

  test("leaves string-content assistant messages untouched", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: "plain string content" },
    ];

    expect(stripModelMessageReasoning(messages)).toEqual(messages);
  });

  test("preserves tool calls that share the turn with reasoning", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "deciding to run a command" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { command: "ls" },
          },
        ],
      },
    ];

    const result = stripModelMessageReasoning(messages);

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toEqual([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "bash",
        input: { command: "ls" },
      },
    ]);
  });
});
