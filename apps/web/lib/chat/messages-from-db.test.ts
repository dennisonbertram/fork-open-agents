import { describe, expect, mock, test } from "bun:test";

const getRecentChatMessages = mock(
  async (_chatId: string, _limit: number) => [] as unknown[],
);

mock.module("@/lib/db/sessions", () => ({
  getRecentChatMessages,
}));

const modulePromise = import("./messages-from-db");

describe("buildMessagesFromDb", () => {
  test("tolerates rows where parts holds the whole persisted UIMessage object", async () => {
    const { buildMessagesFromDb } = await modulePromise;
    getRecentChatMessages.mockImplementation(async () => [
      {
        id: "row-1",
        role: "user",
        parts: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
          metadata: { modelId: "x" },
        },
      },
    ]);

    const result = await buildMessagesFromDb("chat-1", {
      id: "msg-2",
      role: "user",
      parts: [{ type: "text", text: "new prompt" }],
    } as never);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "hi" }],
      metadata: { modelId: "x" },
    });
    expect(result[1]).toMatchObject({ id: "msg-2" });
  });

  test("tolerates rows where parts is the bare parts array", async () => {
    const { buildMessagesFromDb } = await modulePromise;
    getRecentChatMessages.mockImplementation(async () => [
      {
        id: "row-1",
        role: "assistant",
        parts: [{ type: "text", text: "legacy row" }],
      },
    ]);

    const result = await buildMessagesFromDb("chat-1", {
      id: "msg-2",
      role: "user",
      parts: [{ type: "text", text: "new prompt" }],
    } as never);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "row-1",
      role: "assistant",
      parts: [{ type: "text", text: "legacy row" }],
    });
  });

  test("degrades an unrecognized parts shape to an empty parts array instead of throwing", async () => {
    const { buildMessagesFromDb } = await modulePromise;
    getRecentChatMessages.mockImplementation(async () => [
      { id: "row-1", role: "user", parts: null },
    ]);

    const result = await buildMessagesFromDb("chat-1", {
      id: "msg-2",
      role: "user",
      parts: [],
    } as never);

    expect(result[0]).toEqual({ id: "row-1", role: "user", parts: [] });
  });

  test("appends the new user message last and passes the limit through", async () => {
    const { buildMessagesFromDb } = await modulePromise;
    getRecentChatMessages.mockImplementation(async (_chatId, limit) => {
      expect(limit).toBe(5);
      return [];
    });

    const result = await buildMessagesFromDb(
      "chat-1",
      { id: "msg-only", role: "user", parts: [] } as never,
      5,
    );

    expect(result).toEqual([{ id: "msg-only", role: "user", parts: [] }]);
  });
});
