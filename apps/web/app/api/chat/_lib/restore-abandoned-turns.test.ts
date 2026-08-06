import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";

let abandonedIds: string[] = [];
let shouldThrow = false;

const getAbandonedAssistantMessageIdsSpy = mock((_chatId: string) => {
  if (shouldThrow) {
    return Promise.reject(new Error("db down"));
  }
  return Promise.resolve(abandonedIds);
});

mock.module("@/lib/db/sessions", () => ({
  getAbandonedAssistantMessageIds: getAbandonedAssistantMessageIdsSpy,
}));

const { restoreAbandonedTurnFlags } = await import("./restore-abandoned-turns");

function userMessage(id: string, text: string): WebAgentUIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantMessage(
  id: string,
  text: string,
  metadata?: WebAgentUIMessage["metadata"],
): WebAgentUIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
    ...(metadata ? { metadata } : {}),
  };
}

describe("restoreAbandonedTurnFlags", () => {
  beforeEach(() => {
    abandonedIds = [];
    shouldThrow = false;
    getAbandonedAssistantMessageIdsSpy.mockClear();
  });

  // (a) The regression the #1134 review names: same open chat, no reload. The
  // client re-posts its own copy of the failed assistant turn, which never
  // received `metadata.abandoned` because the live stream only carries text.
  // The server must re-derive the flag from the persisted row.
  test("restores the persisted abandoned flag onto a client copy that lacks it", async () => {
    abandonedIds = ["assistant-1"];
    const messages: WebAgentUIMessage[] = [
      userMessage("user-1", "please read github access tools"),
      assistantMessage(
        "assistant-1",
        "Workspace setup failed. Try again in a moment.",
      ),
      userMessage("user-2", "Hi here is the second turn."),
    ];

    const restored = await restoreAbandonedTurnFlags("chat-1", messages);

    expect(restored[1]?.metadata?.abandoned).toBe(true);
    // Everything else passes through untouched.
    expect(restored[0]).toBe(messages[0]);
    expect(restored[2]).toBe(messages[2]);
  });

  // (c) A normal successful turn is unchanged — nothing persisted as
  // abandoned means the client history is returned as-is.
  test("leaves a history with no persisted abandoned turn unchanged", async () => {
    const messages: WebAgentUIMessage[] = [
      userMessage("user-1", "hello"),
      assistantMessage("assistant-1", "Here is the answer."),
      userMessage("user-2", "thanks"),
    ];

    const restored = await restoreAbandonedTurnFlags("chat-1", messages);

    expect(restored).toBe(messages);
  });

  // (d) An explicit retry of the failed request still works: the flag is
  // restored on the failed turn only, and the retry message reaches the model
  // exactly as the user wrote it.
  test("passes an explicit retry user message through unchanged", async () => {
    const retryText = "please read github access tools";
    abandonedIds = ["assistant-1"];
    const messages: WebAgentUIMessage[] = [
      userMessage("user-1", retryText),
      assistantMessage(
        "assistant-1",
        "Workspace setup failed. Try again in a moment.",
      ),
      userMessage("user-2", retryText),
    ];

    const restored = await restoreAbandonedTurnFlags("chat-1", messages);

    expect(restored[2]).toEqual(messages[2]);
    expect(restored[2]?.metadata?.abandoned).toBeUndefined();
  });

  test("does not query the database when the history has no assistant turns", async () => {
    const messages: WebAgentUIMessage[] = [userMessage("user-1", "hello")];

    const restored = await restoreAbandonedTurnFlags("chat-1", messages);

    expect(restored).toBe(messages);
    expect(getAbandonedAssistantMessageIdsSpy).not.toHaveBeenCalled();
  });

  test("does not query the database when the client copy already carries the flag", async () => {
    const messages: WebAgentUIMessage[] = [
      userMessage("user-1", "please read github access tools"),
      assistantMessage("assistant-1", "Workspace setup failed.", {
        abandoned: true,
      }),
    ];

    const restored = await restoreAbandonedTurnFlags("chat-1", messages);

    expect(restored).toBe(messages);
    expect(getAbandonedAssistantMessageIdsSpy).not.toHaveBeenCalled();
  });

  test("returns the client history unchanged when the lookup fails", async () => {
    shouldThrow = true;
    const messages: WebAgentUIMessage[] = [
      userMessage("user-1", "hi"),
      assistantMessage("assistant-1", "Workspace setup failed."),
    ];

    const restored = await restoreAbandonedTurnFlags("chat-1", messages);

    expect(restored).toBe(messages);
  });

  test("does not mutate the caller's messages", async () => {
    abandonedIds = ["assistant-1"];
    const messages: WebAgentUIMessage[] = [
      userMessage("user-1", "hi"),
      assistantMessage("assistant-1", "Workspace setup failed."),
    ];

    await restoreAbandonedTurnFlags("chat-1", messages);

    expect(messages[1]?.metadata?.abandoned).toBeUndefined();
  });

  // Preserves existing metadata (model id, usage, timings) while adding the
  // flag — the persisted row is authoritative for `abandoned` only.
  test("preserves other metadata on the restored message", async () => {
    abandonedIds = ["assistant-1"];
    const messages: WebAgentUIMessage[] = [
      userMessage("user-1", "hi"),
      assistantMessage("assistant-1", "Workspace setup failed.", {
        modelId: "gpt-oss-120b",
      }),
    ];

    const restored = await restoreAbandonedTurnFlags("chat-1", messages);

    expect(restored[1]?.metadata).toEqual({
      modelId: "gpt-oss-120b",
      abandoned: true,
    });
  });
});
