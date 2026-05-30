import { describe, expect, test } from "bun:test";
import { toApiMessageSnapshot } from "./snapshots";
import type { ChatMessage } from "@/lib/db/schema";

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "msg_1",
    chatId: "chat_1",
    role: "assistant",
    parts: {
      id: "msg_1",
      role: "assistant",
      parts: [
        { type: "text", text: "Done" },
        {
          type: "data-commit",
          id: "msg_1:commit",
          data: { status: "success", commitSha: "abc123" },
        },
        {
          type: "data-runtime-proof",
          id: "msg_1:runtime-proof",
          data: { status: "completed", workflowRunId: "workflow_1" },
        },
      ],
      metadata: { modelId: "anthropic/claude-haiku-4.5" },
    },
    createdAt: new Date("2026-05-30T12:00:00.000Z"),
    ...overrides,
  } as ChatMessage;
}

describe("agent API message snapshots", () => {
  test("summarizes text and outputs without raw UI parts by default", () => {
    const snapshot = toApiMessageSnapshot(message({}));

    expect(snapshot.text).toBe("Done");
    expect(snapshot.outputs.commit).toEqual({
      status: "success",
      commitSha: "abc123",
    });
    expect(snapshot.outputs.runtimeProof).toEqual({
      status: "completed",
      workflowRunId: "workflow_1",
    });
    expect("uiParts" in snapshot).toBe(false);
  });

  test("includes UI parts only when explicitly requested", () => {
    const snapshot = toApiMessageSnapshot(message({}), true);

    expect(snapshot.uiParts?.length).toBe(3);
  });
});
