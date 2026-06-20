import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebAgentUIMessage } from "@/app/types";
import type { ChatUiStatus } from "@/lib/chat-streaming-state";

const retryChatStream = mock(() => undefined);
const stopChatStream = mock(() => undefined);
const sendMessage = mock(async () => undefined);
const addToolApprovalResponse = mock(async () => undefined);
const updateChatModel = mock(async () => undefined);
const useStreamRecoveryMock = mock(() => undefined);

let chatStatus: ChatUiStatus = "ready";
let chatMessages: WebAgentUIMessage[] = [];
let chatListIsStreaming = false;

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

mock.module("sonner", () => ({
  toast: { error: () => undefined },
}));

mock.module("@/hooks/use-session-chats", () => ({
  useSessionChats: () => ({
    chats: [{ id: "chat-1", isStreaming: chatListIsStreaming }],
  }),
}));

mock.module(
  "@/app/sessions/[sessionId]/chats/[chatId]/session-chat-context",
  () => ({
    useSessionChatRuntimeContext: () => ({
      chat: {
        messages: chatMessages,
        status: chatStatus,
        addToolApprovalResponse,
        sendMessage,
      },
      stopChatStream,
      workspaceStatus: null,
      retryChatStream,
    }),
    useSessionChatMetadataContext: () => ({
      modelOptions: [
        {
          id: "model-1",
          label: "Model 1",
          shortLabel: "Model 1",
          provider: "openai",
          source: "recommended",
        },
      ],
      modelOptionsLoading: false,
      selectedModelOptionId: "model-1",
      updateChatModel,
    }),
  }),
);

mock.module(
  "@/app/sessions/[sessionId]/chats/[chatId]/hooks/use-stream-recovery",
  () => ({
    useStreamRecovery: useStreamRecoveryMock,
  }),
);

const modulePromise = import("./mobile-chat-screen");

describe("MobileChatScreen stream recovery", () => {
  beforeEach(() => {
    retryChatStream.mockClear();
    stopChatStream.mockClear();
    sendMessage.mockClear();
    addToolApprovalResponse.mockClear();
    updateChatModel.mockClear();
    useStreamRecoveryMock.mockClear();
    chatStatus = "ready";
    chatMessages = [];
    chatListIsStreaming = false;
  });

  test("wires mobile chat state into stream recovery so app resume can reconnect dropped streams", async () => {
    chatStatus = "error";
    chatMessages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Working" }],
      } as WebAgentUIMessage,
    ];

    const { MobileChatScreen } = await modulePromise;

    renderToStaticMarkup(
      <MobileChatScreen
        chatId="chat-1"
        sessionId="session-1"
        sessionTitle="Mobile session"
        _repoOwner={null}
        repoName={null}
        branch={null}
        _cloneUrl={null}
      />,
    );

    expect(useStreamRecoveryMock).toHaveBeenCalledTimes(1);
    expect(useStreamRecoveryMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      chatId: "chat-1",
      status: "error",
      isChatInFlight: false,
      hasAssistantRenderableContent: true,
      retryChatStream,
    });
  });
});
