"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSessionChatRuntimeContext } from "@/app/sessions/[sessionId]/chats/[chatId]/session-chat-context";
import { useSessionChats } from "@/hooks/use-session-chats";
import {
  isChatInFlight,
  shouldUseChatListStreamingState,
  hasRenderableAssistantPart,
} from "@/lib/chat-streaming-state";
import type { MobileStatusDescriptor } from "@/components/mobile/lib/types";
import { MobileChatHeader } from "./mobile-chat-header";
import { MobileMessageThread } from "./mobile-message-thread";
import {
  MobileToolApprovalBar,
  findPendingApproval,
} from "./mobile-tool-approval-bar";
import { MobileComposer } from "./mobile-composer";

export interface MobileChatScreenProps {
  chatId: string;
  sessionId: string;
  sessionTitle: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
}

/**
 * Full-page mobile chat orchestrator.
 *
 * - Reads live messages, status, and send/stop from useSessionChatRuntimeContext.
 * - Derives effectiveStatus mirroring the desktop pattern (userStopped +
 *   hasPendingResponse guard) so the iOS/Safari fetch-abort race is handled.
 * - Scans messages for a pending approval and pins MobileToolApprovalBar when found.
 * - Passes send/stop down to MobileComposer; approval callbacks to MobileToolApprovalBar.
 */
export function MobileChatScreen({
  chatId,
  sessionId,
  sessionTitle,
  repoName,
  branch,
}: MobileChatScreenProps) {
  const router = useRouter();

  // Runtime context provides the live chat state
  const { chat, stopChatStream, workspaceStatus } =
    useSessionChatRuntimeContext();

  const { messages, status, addToolApprovalResponse, sendMessage } = chat;

  // Keep the chats list updated so the activity list stays in sync
  const { chats } = useSessionChats(sessionId);
  const currentChatListItem = useMemo(
    () => chats.find((c) => c.id === chatId) ?? null,
    [chats, chatId],
  );

  // --- Effective status (mirrors desktop logic) ---
  const [userStopped, setUserStopped] = useState(false);

  // Reset userStopped when chatId changes
  useEffect(() => {
    setUserStopped(false);
  }, [chatId]);

  const isChatInFlightNow = isChatInFlight(status) && !userStopped;

  const lastMessage = messages[messages.length - 1];
  const hasAssistantRenderableContent = useMemo(
    () =>
      lastMessage?.role === "assistant"
        ? lastMessage.parts.some(hasRenderableAssistantPart)
        : false,
    [lastMessage],
  );

  const shouldUseChatListStreaming = useMemo(
    () =>
      shouldUseChatListStreamingState({
        status,
        hasChatListStreaming: currentChatListItem?.isStreaming ?? false,
        userStopped,
        hasAssistantRenderableContent,
        lastMessageRole: lastMessage?.role,
      }),
    [
      status,
      currentChatListItem?.isStreaming,
      userStopped,
      hasAssistantRenderableContent,
      lastMessage?.role,
    ],
  );

  const [hasPendingResponse, setHasPendingResponse] = useState(false);

  useEffect(() => {
    if (isChatInFlightNow || shouldUseChatListStreaming) {
      setHasPendingResponse(true);
      return;
    }
    if (status === "error" || status === "ready") {
      setHasPendingResponse(false);
      setUserStopped(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChatInFlightNow, shouldUseChatListStreaming, status]);

  const effectiveIsInFlight = userStopped
    ? false
    : hasPendingResponse || isChatInFlightNow || shouldUseChatListStreaming;

  // --- Pending approval detection ---
  const pendingApproval = useMemo(
    () => findPendingApproval(messages),
    [messages],
  );

  const handleApprove = useCallback(
    (id: string) => {
      addToolApprovalResponse({ id, approved: true });
    },
    [addToolApprovalResponse],
  );

  const handleDeny = useCallback(
    (id: string) => {
      addToolApprovalResponse({ id, approved: false });
    },
    [addToolApprovalResponse],
  );

  // --- Stop ---
  const handleStop = useCallback(() => {
    setUserStopped(true);
    stopChatStream();
  }, [stopChatStream]);

  // --- Send ---
  const handleSend = useCallback(
    (text: string) => {
      if (effectiveIsInFlight) {
        return;
      }
      setHasPendingResponse(true);
      setUserStopped(false);
      sendMessage({ text });
    },
    [effectiveIsInFlight, sendMessage],
  );

  // Derived repo label
  const repoLabel = repoName
    ? branch
      ? `${repoName} @ ${branch}`
      : repoName
    : null;

  // Status descriptor for the header pill
  const statusDescriptor: MobileStatusDescriptor = effectiveIsInFlight
    ? { label: "Working", tone: "working", prNumber: null }
    : pendingApproval
      ? { label: "Waiting", tone: "waiting", prNumber: null }
      : { label: "Ready", tone: "idle", prNumber: null };

  // Find the active approvalId (from last pending tool part)
  const activeApprovalId = pendingApproval?.id ?? null;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <MobileChatHeader
        title={sessionTitle}
        repoLabel={repoLabel}
        branch={branch}
        status={statusDescriptor}
        onBack={() => router.push("/m")}
      />

      <MobileMessageThread
        messages={messages}
        status={effectiveIsInFlight ? "streaming" : status}
        workspaceStatus={workspaceStatus}
        activeApprovalId={activeApprovalId}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />

      {/* Approval bar is pinned above the composer when approval is pending */}
      <MobileToolApprovalBar
        pending={pendingApproval}
        onApprove={handleApprove}
        onDeny={handleDeny}
      />

      <MobileComposer
        disabled={!!pendingApproval}
        isInFlight={effectiveIsInFlight}
        onSend={handleSend}
        onStop={handleStop}
      />
    </div>
  );
}
