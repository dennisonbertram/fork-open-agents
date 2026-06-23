import { describe, expect, test } from "bun:test";
import {
  areMessageRowPropsEqual,
  type MessageRowMemoProps,
} from "./message-row-memo";

function makeProps(
  overrides: Partial<MessageRowMemoProps> = {},
): MessageRowMemoProps {
  const stableGroupedMessage = {
    message: { id: "assistant-done" },
    groups: [],
    isStreaming: false,
  };
  const stableComponents = {};
  const stableModelOptions: unknown[] = [];
  const noop = () => {};

  return {
    groupedMessage: stableGroupedMessage,
    sessionId: "session-1",
    chatId: "chat-1",
    durationMs: 1200,
    startedAt: "2026-06-19T12:00:00.000Z",
    streamdownComponents: stableComponents,
    hasMessageActionInFlight: false,
    resendingMessageId: null,
    deletingMessageId: null,
    copiedAssistantMessageId: null,
    forkingAssistantMessageId: null,
    modelOptions: stableModelOptions,
    onResendUserMessage: noop,
    onDeleteUserMessage: noop,
    onCopyAssistantMessage: noop,
    onForkAssistantMessage: noop,
    onApproveTool: noop,
    onDenyTool: noop,
    onApproveAllToolsForSession: noop,
    onManagedRuntimeProfileOutput: noop,
    onOpenVerifiedBuildPanel: noop,
    onOpenRuntimePanel: noop,
    ...overrides,
  };
}

describe("areMessageRowPropsEqual", () => {
  test("keeps completed rows memoized when an unrelated streaming row changes", () => {
    const completedRowProps = makeProps();

    expect(
      areMessageRowPropsEqual(completedRowProps, {
        ...completedRowProps,
      }),
    ).toBe(true);
  });

  test("re-renders when the row's grouped message identity changes", () => {
    const completedRowProps = makeProps();

    expect(
      areMessageRowPropsEqual(completedRowProps, {
        ...completedRowProps,
        groupedMessage: {
          message: { id: "assistant-done" },
          groups: [],
          isStreaming: false,
        },
      }),
    ).toBe(false);
  });

  test("re-renders rows affected by action status changes", () => {
    const completedRowProps = makeProps();

    expect(
      areMessageRowPropsEqual(completedRowProps, {
        ...completedRowProps,
        copiedAssistantMessageId: "assistant-done",
      }),
    ).toBe(false);
  });

  test("re-renders when the session-wide approval handler changes", () => {
    const completedRowProps = makeProps();

    expect(
      areMessageRowPropsEqual(completedRowProps, {
        ...completedRowProps,
        onApproveAllToolsForSession: () => {},
      }),
    ).toBe(false);
  });
});
