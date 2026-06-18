"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useSessionChatMetadataContext,
  useSessionChatRuntimeContext,
} from "@/app/sessions/[sessionId]/chats/[chatId]/session-chat-context";
import { useSessionChats } from "@/hooks/use-session-chats";
import {
  isChatInFlight,
  shouldUseChatListStreamingState,
  hasRenderableAssistantPart,
} from "@/lib/chat-streaming-state";
import type { MobileStatusDescriptor } from "@/components/mobile/lib/types";
import { ModelSelectorCompact } from "@/components/model-selector-compact";
import { parseModelOptionSelection } from "@/lib/inference/model-option-id";
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
  const {
    modelOptions,
    modelOptionsLoading,
    selectedModelOptionId,
    updateChatModel,
  } = useSessionChatMetadataContext();

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
    async (id: string) => {
      try {
        await addToolApprovalResponse({ id, approved: true });
      } catch {
        toast.error("Couldn't approve the action — please try again.");
      }
    },
    [addToolApprovalResponse],
  );

  const handleDeny = useCallback(
    async (id: string) => {
      try {
        await addToolApprovalResponse({ id, approved: false });
      } catch {
        toast.error("Couldn't deny the action — please try again.");
      }
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
    async (text: string) => {
      if (effectiveIsInFlight) {
        return;
      }
      setHasPendingResponse(true);
      setUserStopped(false);
      try {
        await sendMessage({ text });
      } catch {
        setHasPendingResponse(false);
        toast.error("Couldn't send your message — please try again.");
      }
    },
    [effectiveIsInFlight, sendMessage],
  );

  // Send the New-session task as the first message exactly once when this chat
  // opens. The /m/new flow stashes it under a per-chat sessionStorage key.
  const prefillHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (prefillHandledRef.current === chatId) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    prefillHandledRef.current = chatId;
    const key = `mobile-chat-prefill:${chatId}`;
    const prefill = window.sessionStorage.getItem(key);
    if (!prefill) {
      return;
    }
    window.sessionStorage.removeItem(key);
    // Only auto-send into an empty conversation.
    if (messages.length > 0) {
      return;
    }
    setHasPendingResponse(true);
    sendMessage({ text: prefill }).catch(() => {
      setHasPendingResponse(false);
      toast.error("Couldn't send your message — please try again.");
    });
  }, [chatId, messages.length, sendMessage]);

  // Change the chat's model inline (reuses the desktop selection parsing +
  // runtime updateChatModel).
  const handleModelChange = useCallback(
    (optionId: string) => {
      if (!optionId || optionId === selectedModelOptionId) {
        return;
      }
      const selection = parseModelOptionSelection(optionId);
      updateChatModel(selection.modelId, selection.inferenceProfileId).catch(
        () => {
          toast.error("Couldn't change the model — please try again.");
        },
      );
    },
    [selectedModelOptionId, updateChatModel],
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
    <div className="flex h-dvh flex-col bg-background">
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

      {/* Inline model selector above the composer */}
      <div className="flex items-center border-t border-border px-2 pt-1.5">
        <ModelSelectorCompact
          value={selectedModelOptionId}
          modelOptions={modelOptions}
          onChange={handleModelChange}
          disabled={modelOptionsLoading || effectiveIsInFlight}
        />
      </div>

      <MobileComposer
        disabled={!!pendingApproval}
        isInFlight={effectiveIsInFlight}
        onSend={handleSend}
        onStop={handleStop}
      />
    </div>
  );
}
