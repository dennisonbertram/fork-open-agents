import { describe, expect, it } from "bun:test";
import { buildChatRequestBody } from "./build-chat-request-body";

describe("buildChatRequestBody", () => {
  it("includes workflowId, inputValues, and workflowSchema when selectedWorkflowId is non-null", () => {
    const result = buildChatRequestBody({
      sessionId: "session-1",
      chatId: "chat-1",
      contextLimit: null,
      selectedWorkflowId: "verified-build",
    });

    expect(result).toMatchObject({
      sessionId: "session-1",
      chatId: "chat-1",
      workflowId: "verified-build",
      inputValues: {},
      workflowSchema: { fields: [] },
    });
  });

  it("omits all three workflow keys when selectedWorkflowId is null", () => {
    const result = buildChatRequestBody({
      sessionId: "session-2",
      chatId: "chat-2",
      contextLimit: null,
      selectedWorkflowId: null,
    });

    expect(result).toMatchObject({
      sessionId: "session-2",
      chatId: "chat-2",
    });
    expect("workflowId" in result).toBe(false);
    expect("inputValues" in result).toBe(false);
    expect("workflowSchema" in result).toBe(false);
  });

  it("includes context when contextLimit is non-null", () => {
    const result = buildChatRequestBody({
      sessionId: "session-3",
      chatId: "chat-3",
      contextLimit: 8192,
      selectedWorkflowId: null,
    });

    expect(result).toMatchObject({
      sessionId: "session-3",
      chatId: "chat-3",
      context: { contextLimit: 8192 },
    });
  });

  it("omits context when contextLimit is null", () => {
    const result = buildChatRequestBody({
      sessionId: "session-4",
      chatId: "chat-4",
      contextLimit: null,
      selectedWorkflowId: null,
    });

    expect("context" in result).toBe(false);
  });
});
