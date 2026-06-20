import type { ModelMessage } from "ai";
import { describe, expect, it } from "bun:test";
import { sanitizeUnattendedToolCalls } from "./sanitize-tool-calls";

type Part = Record<string, unknown>;

function partsOf(message: ModelMessage | undefined): Part[] {
  if (!message || !Array.isArray(message.content)) {
    throw new Error("expected a message with array content");
  }
  return message.content as Part[];
}

function lastToolMessage(messages: ModelMessage[]): ModelMessage | undefined {
  return [...messages].toReversed().find((m) => m.role === "tool");
}

describe("sanitizeUnattendedToolCalls", () => {
  it("returns the same array reference when there are no tool calls", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    expect(sanitizeUnattendedToolCalls(messages)).toBe(messages);
  });

  it("leaves messages untouched when every tool call has a result", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "do it" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "t1", toolName: "bash", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "t1",
            toolName: "bash",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ];
    expect(sanitizeUnattendedToolCalls(messages)).toBe(messages);
  });

  it("appends an execution-denied result for a dangling tool call", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "fetch it" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "toolu_abc",
            toolName: "web_fetch",
            input: { url: "https://example.com" },
          },
        ],
      },
    ];

    const result = sanitizeUnattendedToolCalls(messages);
    expect(result).not.toBe(messages);
    expect(result.length).toBe(3);

    const toolMsg = lastToolMessage(result);
    expect(toolMsg?.role).toBe("tool");
    const parts = partsOf(toolMsg);
    expect(parts).toHaveLength(1);
    const part = parts[0] as Part;
    expect(part).toMatchObject({
      type: "tool-result",
      toolCallId: "toolu_abc",
      toolName: "web_fetch",
    });
    expect((part.output as Part).type).toBe("execution-denied");
  });

  it("inserts the synthetic result immediately after the offending assistant message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "t1", toolName: "bash", input: {} },
        ],
      },
      { role: "user", content: "are you done?" },
    ];

    const result = sanitizeUnattendedToolCalls(messages);
    // assistant at index 1 → synthetic tool result must be at index 2,
    // before the trailing user message.
    expect(result.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "user",
    ]);
  });

  it("strips an orphan tool-approval-request and denies its call", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "curl something" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "t1", toolName: "bash", input: {} },
          {
            type: "tool-approval-request",
            approvalId: "appr_1",
            toolCallId: "t1",
          },
        ],
      },
    ];

    const result = sanitizeUnattendedToolCalls(messages);
    const assistantParts = partsOf(result[1]);
    // approval-request stripped, tool-call kept
    expect(assistantParts.some((p) => p.type === "tool-approval-request")).toBe(
      false,
    );
    expect(assistantParts.some((p) => p.type === "tool-call")).toBe(true);
    // denied result present
    const parts = partsOf(lastToolMessage(result));
    const part = parts[0] as Part;
    expect((part.output as Part).type).toBe("execution-denied");
  });

  it("denies multiple dangling calls in a single assistant message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "two things" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "t1", toolName: "bash", input: {} },
          {
            type: "tool-call",
            toolCallId: "t2",
            toolName: "web_fetch",
            input: {},
          },
        ],
      },
    ];

    const result = sanitizeUnattendedToolCalls(messages);
    const parts = partsOf(result[2]);
    expect(parts.map((p) => p.toolCallId).sort()).toEqual(["t1", "t2"]);
  });
});
